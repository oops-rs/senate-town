// The observe feed as the scene consumes it: keeps the public state current
// from snapshots and `state.patch` frames (applied by the published client's
// `applyFrame`), hands the scene a TownState on every change and the
// animations from domain events. A message filed and then held for its
// receiver arrives as two frames (`message.posted`, then `message.routed`
// held); the feed waits briefly to join them into one capsule that stops at
// the receiver's red signal.
import { applyFrame } from "@senate/observe";
import { frameEvents, toTown, type Frame, type ObserveState } from "./observe.ts";
import type { TownEvent, TownState } from "./model.ts";

export interface Sink {
  snapshot(state: TownState, events?: TownEvent[]): void;
  events(events: TownEvent[]): void;
}

const JOIN_MS = 250;

export class Feed {
  state?: ObserveState;
  private sink: Sink;
  private seen = new Set<string>();
  private posted = new Map<string, { event: Extract<TownEvent, { kind: "message" }>; timer: ReturnType<typeof setTimeout> }>();
  private now: () => number;
  constructor(sink: Sink, now: () => number = Date.now) {
    this.sink = sink;
    this.now = now;
  }

  /** A snapshot supersedes everything before it (first, and after a reset or a resume). */
  snapshot(s: ObserveState) {
    if (s.schema_version !== 1) return;
    for (const p of this.posted.values()) clearTimeout(p.timer);
    this.posted.clear();
    this.seen.clear();
    this.state = s;
    this.sink.snapshot(toTown(s, this.now()));
  }

  frame(f: Frame) {
    if (!this.state || f.schema_version !== 1) return;
    if (f.kind === "stream.reset") return; // the shell refetches and sends a new snapshot
    // A retried frame is applied again (keyed rows) but never animated twice.
    const repeat = this.seen.has(f.cursor);
    this.seen.add(f.cursor);
    if (this.seen.size > 1024) this.seen.delete(this.seen.values().next().value!);
    const before = this.state;
    this.state = applyFrame(before, f as Parameters<typeof applyFrame>[1]);
    if (f.kind === "state.patch") {
      this.sink.snapshot(toTown(this.state, this.now()));
      return;
    }
    if (repeat) return;
    const d = (f.data ?? {}) as Record<string, unknown>;
    const key = `${f.committee_id}:${String(d.seq ?? "")}`;
    if (f.kind === "message.routed" && (d.phase === "held_for_hook" || d.phase === "queued")) {
      const p = this.posted.get(key);
      if (p) {
        clearTimeout(p.timer);
        this.posted.delete(key);
        this.sink.events([{ ...p.event, held: String(d.reason ?? "held") }]);
        return;
      }
    }
    const events = frameEvents(before, f);
    const first = events[0];
    if (f.kind === "message.posted" && events.length === 1 && first?.kind === "message") {
      const event = first;
      this.posted.set(key, { event, timer: setTimeout(() => { this.posted.delete(key); this.sink.events([event]); }, JOIN_MS) });
      return;
    }
    if (events.length) this.sink.events(events);
  }
}
