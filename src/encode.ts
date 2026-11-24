// The other direction, for development only: a TownState and the scripted
// day's events written as observe data (the published v1 shapes), so the
// demo plays through exactly the path a live Senate does (observe → feed →
// scene). Used by tools/record.mjs to write recordings/*.ndjson (the observe
// recording format) and by the tests; never bundled into the page.
import type { Address, Card, EventFrame, Senator as OSenator, Thread } from "@senate/observe";
import type { ObserveState } from "./observe.ts";
import type { Mood, TownEvent, TownState } from "./model.ts";
import type { Step } from "./script.ts";
import type { RecordingHeader, Row } from "./shell.ts";

const STATE: Record<Mood, OSenator["state"]> = { working: "working", idle: "idle", waiting: "waiting_on_person", paused: "paused", stopped: "stopped" };
const enc = (v: string) => encodeURIComponent(v).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const SENATE = "?senate=id%3Ademo";
const link = (path: string) => `senate://open/v1/${path}${SENATE}`;
const ago = (asOf: number, seconds: number) => new Date(asOf - seconds * 1000).toISOString();

/** A cursor in the published form: 22 base64url characters (the last one of `AQgw`). */
export function cursorOf(n: number): string {
  const digits = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let s = "", v = n;
  for (let i = 0; i < 21; i++) { s = digits[v % 64]! + s; v = Math.floor(v / 64); }
  return s + "A";
}

/** Town's part of a card, as the opaque card the Senate serves. */
const card = (part: "house" | "look", value: unknown, at: string): Card | null =>
  value === undefined ? null : { revision: "1", updated_at: at, value: { town: { [part]: value } } };

/** Rows in the Senate's deterministic order (the published client keeps patched rows in the same order). */
function ordered(s: ObserveState): ObserveState {
  const by = (key: (r: Record<string, unknown>) => string) => <T>(rows: T[] | undefined) =>
    (rows ?? []).slice().sort((a, b) => { const x = key(a as Record<string, unknown>), y = key(b as Record<string, unknown>); return x < y ? -1 : x > y ? 1 : 0; });
  const id = by((r) => String(r.id)), seat = by((r) => JSON.stringify([r.committee_id, r.id])), root = by((r) => JSON.stringify([r.committee_id, r.root_seq]));
  return { ...s, links: id(s.links), committees: id(s.committees), projects: id(s.projects), senators: seat(s.senators), retired: seat(s.retired),
    threads: root(s.threads), desk_items: root(s.desk_items), approvals: id(s.approvals) };
}

export function toObserve(t: TownState, asOf = Date.parse("2026-11-25T10:00:00Z")): ObserveState {
  return ordered(unordered(t, asOf));
}

function unordered(t: TownState, asOf: number): ObserveState {
  const at = new Date(asOf).toISOString();
  const home = new Map<string, string>();
  for (const c of t.committees) for (const s of c.senators) if (!home.has(s.id)) home.set(s.id, c.name);
  const projectOf = (name: string) => t.projects?.find((p) => p.committees?.includes(name))?.id ?? null;
  const senators: OSenator[] = t.committees.flatMap((c) => c.senators.map((s) => ({
    id: s.id, committee_id: c.name, alias: s.name, runtime: s.runtime === "other" ? null : s.runtime, kind: "agent" as const,
    state: STATE[s.mood], last_active_at: at, hosted: "here" as const, viewer_attached: s.watched ?? false,
    card: card("look", s.card, at), link: link(`senator/${enc(`${c.name}::${s.name}`)}`),
  })));
  const sec = t.hall?.secretary;
  if (sec && !home.has(sec.id)) {
    senators.push({ id: sec.id, committee_id: "senate", alias: sec.name, runtime: sec.runtime, kind: "agent", state: STATE[sec.mood],
      last_active_at: at, hosted: "here", viewer_attached: false, card: null, link: link("desk") });
  }
  return {
    schema_version: 1,
    capabilities: ["state_patch", "message_routing", "hosted_viewers", "approval_metadata", "cards", "desk", "topology", "app_links", "tool_lifecycle", "project_releases"],
    as_of: at,
    cursor: cursorOf(0),
    senate: { id: "demo", name: "demo", link: null, person: t.person ? { id: "person", name: t.person, link: link("profile"), card: null } : null,
      desk_owner: t.person ? "person" : null, desk_workers: sec ? [sec.id] : [] },
    navigation: { desk: link("desk"), approvals: link("approvals"), inbox: link("inbox"), history: link("history"), profile: link("profile") },
    links: [
      ...(t.links?.parent ? [{ id: "parent", kind: "parent" as const, name: t.links.parent.name, state: t.links.parent.up ? "up" as const : "down" as const, link: null }] : []),
      ...(t.links?.children ?? []).map((l, i) => ({ id: `child-${i}`, kind: "child" as const, name: l.name, state: l.up ? "up" as const : "down" as const, link: null })),
      ...(t.links?.remotes ?? []).map((l, i) => ({ id: `paired-${i}`, kind: "paired_machine" as const, name: l.name, state: l.up ? "up" as const : "down" as const, link: null })),
    ],
    committees: [
      ...t.committees.map((c) => ({
        id: c.name, name: c.name, chair_id: c.senators.find((s) => s.chair)?.id ?? null, archived: false, project_id: projectOf(c.name),
        card: card("house", c.card, at), link: link(`committee/${enc(c.name)}`),
      })),
      ...(t.archived ?? []).map((a) => ({
        id: a.name, name: a.name, chair_id: null, archived: true, project_id: a.project ?? null,
        card: card("house", a.card, at), link: link(`committee/${enc(a.name)}`),
      })),
    ],
    projects: (t.projects ?? []).map((p, pi) => ({
      id: p.id, name: p.name, link: null,
      releases: p.releases.map((r, i) => ({ tag: r.name, at: ago(asOf, (p.releases.length - i) * 86_400 + pi * 3600), merges: r.merges, fixes: r.fixes ?? 0 })),
    })),
    senators,
    threads: t.committees.flatMap((c) => (c.waiting ?? []).map((w): Thread => ({
      committee_id: c.name, root_seq: String(w.root), kind: "question", opener: { kind: "external" }, addressees: [],
      state: "suspended", waits_on: "person", link: link(`thread/${enc(c.name)}/${w.root}`),
    }))),
    desk_items: Array.from({ length: t.hall?.docket ?? 0 }, (_, i) => ({ committee_id: "senate", root_seq: String(9000 + i), kind: "question" as const, awaiting: "pick" as const, link: link(`desk/senate/${9000 + i}`) })),
    approvals: (t.approvals ?? []).map((a, i) => ({
      id: `approval-${i}`, committee_id: home.get(a.senator) ?? "", senator_id: a.senator, tool_kind: "command" as const, asked_at: at, link: link("approvals"),
    })),
    retired: (t.elders ?? []).map((e) => ({
      id: e.id, committee_id: e.committee ?? "senate", alias: e.name, runtime: e.runtime === "other" ? null : e.runtime,
      last_active_at: ago(asOf, e.idle), retired_at: ago(asOf, e.idle), card: null, link: link("history"),
    })),
    windows: { open_threads_per_committee: 40, settled_threads_per_committee: 10, desk_items_per_committee: 50, truncated: [] },
  };
}

type Collection = "links" | "committees" | "projects" | "senators" | "threads" | "desk_items" | "approvals" | "retired";
const KEYS: Record<Collection, string[]> = {
  links: ["id"], committees: ["id"], projects: ["id"], senators: ["committee_id", "id"],
  threads: ["committee_id", "root_seq"], desk_items: ["committee_id", "root_seq"], approvals: ["id"], retired: ["committee_id", "id"],
};

/** The `state.patch` data that turns `a` into `b`. */
export function diffPatch(a: ObserveState, b: ObserveState) {
  const upsert: Record<string, unknown[]> = {};
  const remove: Record<string, unknown[]> = {};
  for (const c of Object.keys(KEYS) as Collection[]) {
    const key = (r: Record<string, unknown>) => KEYS[c].map((k) => String(r[k])).join("\u0000");
    const before = new Map(((a[c] ?? []) as unknown as Record<string, unknown>[]).map((r) => [key(r), JSON.stringify(r)]));
    const after = (b[c] ?? []) as unknown as Record<string, unknown>[];
    const ups = after.filter((r) => before.get(key(r)) !== JSON.stringify(r));
    const keep = new Set(after.map(key));
    const rms = ((a[c] ?? []) as unknown as Record<string, unknown>[]).filter((r) => !keep.has(key(r)))
      .map((r) => Object.fromEntries(KEYS[c].map((k) => [k, r[k]])));
    if (ups.length) upsert[c] = ups;
    if (rms.length) remove[c] = rms;
  }
  return { upsert, remove };
}

const TOOL: Record<string, string> = { bash: "command", edit: "edit", read: "read", grep: "search", web: "web", mcp: "mcp:senate" };

/** The scripted day as an observe recording: a header, the snapshot, timed frames, an end mark. */
export function recording(snapshot: TownState, steps: Step[], pause = 16_000): { header: RecordingHeader; rows: Row[] } {
  let state = toObserve(snapshot);
  const rows: Row[] = [{ offset_ms: 0, type: "snapshot", data: state }];
  let cursor = 0, at = 0;
  const seqs = new Map<string, number>();
  const heldSeq = new Map<string, number>();
  const ids = new Set(state.senators.map((s) => s.id));
  const ref = (id?: string): Address => (id && ids.has(id) ? { kind: "senator", id } : { kind: "external" });
  const push = (kind: string, data: Record<string, unknown>, committee_id?: string, frameLink?: string) => {
    const frame = { schema_version: 1, cursor: cursorOf(++cursor), at: state.as_of, kind, committee_id: committee_id ?? null, link: frameLink ?? null, data } as unknown as EventFrame;
    rows.push({ offset_ms: at, type: "frame", data: frame });
  };
  for (const [delay, step] of steps) {
    at += delay;
    if (typeof step === "function") {
      const next = toObserve(step());
      push("state.patch", diffPatch(state, next));
      state = next;
      continue;
    }
    for (const e of step as TownEvent[]) {
      switch (e.kind) {
        case "message": {
          const c = e.thread.committee;
          const seq = Math.max(seqs.get(c) ?? 0, e.thread.root) + 1;
          seqs.set(c, seq);
          const thread = link(`thread/${enc(c)}/${e.thread.root}`);
          push("message.posted", { seq: String(seq), message_kind: "question", from: ref(e.from), to: e.to ? [ref(e.to)] : [], root_seq: String(e.thread.root) }, c, thread);
          if (e.held) {
            heldSeq.set(`${c}:${e.thread.root}`, seq);
            push("message.routed", { route_id: `route-${seq}`, phase: "held_for_hook", seq: String(seq), target: ref(e.to), reason: "paused" }, c, thread);
          }
          break;
        }
        case "release": {
          const c = e.thread.committee;
          const seq = heldSeq.get(`${c}:${e.thread.root}`) ?? e.thread.root;
          push("message.routed", { route_id: `route-${seq}`, phase: "released", seq: String(seq) }, c, link(`thread/${enc(c)}/${e.thread.root}`));
          break;
        }
        case "tool":
          push("tool.started", { senator_id: e.senator, tool_kind: TOOL[e.tool] ?? "other", call_id: `call-${cursor}`, session_id: `session-${e.senator}` });
          break;
        case "signed": {
          const a = state.approvals.find((x) => x.senator_id === e.senator);
          if (!a) break;
          push("approval.decided", { id: a.id, tool_kind: a.tool_kind, decision: "allowed" }, a.committee_id, link("approvals"));
          const next = { ...state, approvals: state.approvals.filter((x) => x !== a) };
          push("state.patch", diffPatch(state, next));
          state = next;
          break;
        }
        case "answered": {
          const c = e.thread.committee, root = String(e.thread.root);
          const row: Thread = { committee_id: c, root_seq: root, kind: "question", opener: ref(e.a), addressees: e.b ? [ref(e.b)] : [],
            state: "active", waits_on: "agents", link: link(`thread/${enc(c)}/${root}`) };
          const next = { ...state, threads: [...state.threads.filter((t) => !(t.committee_id === c && t.root_seq === root)), row] };
          push("state.patch", diffPatch(state, next));
          state = next;
          push("thread.state_changed", { root_seq: root, previous_state: "active", state: "archived", waits_on: "none" }, c, row.link ?? undefined);
          break;
        }
        default:
          break; // link traffic has no observe event (v1 reports link state only)
      }
    }
  }
  rows.push({ offset_ms: at + pause, type: "end" });
  return {
    header: { format: "senate-observe-recording", version: 1, capabilities: state.capabilities },
    rows,
  };
}

export const ndjson = (r: { header: RecordingHeader; rows: Row[] }) => [r.header, ...r.rows].map((x) => JSON.stringify(x)).join("\n") + "\n";
