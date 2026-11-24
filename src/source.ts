// Where the town's data comes from: one shape, three sources. The scene
// never knows which: it gets a snapshot (the whole town now), events (what
// happened) and raw activity entries (mapped to events here).
//
// - scripted: the made-up town of script.ts, looping (a browser, the demo).
// - recorded: a recording file (snapshot + timed steps) replayed in time.
// - bridge: the Senate app pushes state and activity through
//   `window.town`; to be replaced by the public observe API's client.
import { activityEvents, type ActivityEntry, type TownEvent, type TownState } from "./model.ts";
import * as script from "./script.ts";

export interface Sink {
  snapshot(state: TownState, events?: TownEvent[]): void;
  events(events: TownEvent[]): void;
}

export interface Source {
  start(sink: Sink): void;
  stop(): void;
}

/** A recording: what a town looked like, then what happened, in time. */
export interface Recording {
  version: 1;
  snapshot: TownState;
  steps: { at: number; state?: TownState; events?: TownEvent[]; entries?: ActivityEntry[] }[];
  /** Replay from the start after this many ms (absent: play once). */
  loop?: number;
}

/** The made-up town, its scripted day playing on a loop. */
export class ScriptedSource implements Source {
  private timers: number[] = [];
  private kind: "small" | "large";
  private loop: boolean;
  constructor(kind: "small" | "large", loop = true) {
    this.kind = kind;
    this.loop = loop;
  }

  start(sink: Sink) {
    const play = () => {
      sink.snapshot(this.kind === "large" ? script.large() : script.quiet);
      let at = 0;
      for (const [delay, step] of this.kind === "large" ? script.largeBusy() : script.busy) {
        at += delay;
        this.timers.push(window.setTimeout(() => (typeof step === "function" ? sink.snapshot(step()) : sink.events(step)), at));
      }
      if (this.loop) this.timers.push(window.setTimeout(play, at + 16_000));
    };
    play();
  }

  stop() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }
}

/** A recording file (same origin as the page), replayed in time. */
export class RecordedSource implements Source {
  private timers: number[] = [];
  private url: string;
  constructor(url: string) {
    this.url = url;
  }

  start(sink: Sink) {
    void fetch(this.url).then((r) => r.json()).then((rec: Recording) => {
      if (rec.version !== 1) throw new Error(`unknown recording version ${rec.version}`);
      const play = () => {
        sink.snapshot(rec.snapshot);
        for (const step of rec.steps) {
          this.timers.push(window.setTimeout(() => {
            if (step.state) sink.snapshot(step.state);
            const events = [...(step.events ?? []), ...activityEvents(step.entries ?? [])];
            if (events.length) sink.events(events);
          }, step.at));
        }
        if (rec.loop) this.timers.push(window.setTimeout(play, rec.loop));
      };
      play();
    });
  }

  stop() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }
}

/** The Senate app pushes; this only forwards (until observe replaces it). */
export class BridgeSource implements Source {
  private sink?: Sink;
  start(sink: Sink) { this.sink = sink; }
  stop() { this.sink = undefined; }
  state(state: TownState, entries: ActivityEntry[] = []) { this.sink?.snapshot(state, activityEvents(entries)); }
  activity(entries: ActivityEntry[]) { this.sink?.events(activityEvents(entries)); }
  events(events: TownEvent[]) { this.sink?.events(events); }
}

/** The scripted day as a recording (tools/record.mjs writes recordings/demo.json). */
export function scriptedRecording(kind: "small" | "large"): Recording {
  const steps: Recording["steps"] = [];
  let at = 0;
  for (const [delay, step] of kind === "large" ? script.largeBusy() : script.busy) {
    at += delay;
    steps.push(typeof step === "function" ? { at, state: step() } : { at, events: step });
  }
  return { version: 1, snapshot: kind === "large" ? script.large() : script.quiet, steps, loop: at + 16_000 };
}
