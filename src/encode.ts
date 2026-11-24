// The other direction, for development only: a TownState and the scripted
// day's events written as observe data, so the demo plays through exactly
// the path a live Senate does (observe → feed → scene). Used by
// tools/record.mjs to write recordings/*.ndjson and by the tests; never
// bundled into the page.
import type { Frame, ObserveState, OSenator } from "./observe.ts";
import type { Mood, TownEvent, TownState } from "./model.ts";
import type { Step } from "./script.ts";
import type { RecordingHeader, Row } from "./shell.ts";

const STATE: Record<Mood, string> = { working: "working", idle: "idle", waiting: "waiting_on_person", paused: "paused", stopped: "stopped" };
const enc = (v: string) => encodeURIComponent(v).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const daysAgo = (asOf: number, seconds: number) => new Date(asOf - seconds * 1000).toISOString();

export function toObserve(t: TownState, asOf = Date.parse("2026-11-25T10:00:00Z")): ObserveState {
  const at = new Date(asOf).toISOString();
  const home = new Map<string, string>();
  for (const c of t.committees) for (const s of c.senators) if (!home.has(s.id)) home.set(s.id, c.name);
  const projectOf = (name: string) => t.projects?.find((p) => p.committees?.includes(name))?.id ?? null;
  const senators: OSenator[] = t.committees.flatMap((c) => c.senators.map((s) => ({
    id: s.id, committee_id: c.name, alias: s.name, runtime: s.runtime === "other" ? null : s.runtime, kind: "agent",
    state: STATE[s.mood], last_active_at: at, hosted: "here", viewer_attached: s.watched ?? false,
    ...(s.card === undefined ? {} : { card: s.card }),
    link: `senate://open/v1/senator/${enc(`${c.name}::${s.name}`)}`,
  })));
  const sec = t.hall?.secretary;
  return {
    schema_version: 1,
    capabilities: ["state_patch", "message_routing", "hosted_viewers", "approval_metadata", "cards", "desk", "topology", "app_links", "tool_lifecycle", "project_releases"],
    as_of: at,
    cursor: "demo-0",
    senate: { id: "demo", name: "demo", person: t.person ?? null, desk_owner: t.person ?? null, desk_workers: sec ? [sec.id] : [] },
    navigation: { desk: "senate://open/v1/desk", approvals: "senate://open/v1/approvals", inbox: "senate://open/v1/inbox", history: "senate://open/v1/history", profile: "senate://open/v1/profile" },
    links: [
      ...(t.links?.parent ? [{ id: "parent", kind: "parent", name: t.links.parent.name, state: t.links.parent.up ? "up" : "down", link: null }] : []),
      ...(t.links?.children ?? []).map((l, i) => ({ id: `child-${i}`, kind: "child", name: l.name, state: l.up ? "up" : "down", link: null })),
      ...(t.links?.remotes ?? []).map((l, i) => ({ id: `paired-${i}`, kind: "paired_machine", name: l.name, state: l.up ? "up" : "down", link: null })),
    ],
    committees: [
      ...t.committees.map((c) => ({
        id: c.name, name: c.name, chair_id: c.senators.find((s) => s.chair)?.id ?? null, archived: false, project_id: projectOf(c.name),
        ...(c.card === undefined ? {} : { card: c.card }), link: `senate://open/v1/committee/${enc(c.name)}`,
      })),
      ...(t.archived ?? []).map((a) => ({
        id: a.name, name: a.name, chair_id: null, archived: true, project_id: a.project ?? null,
        ...(a.card === undefined ? {} : { card: a.card }), link: `senate://open/v1/committee/${enc(a.name)}`,
      })),
    ],
    projects: (t.projects ?? []).map((p) => ({
      id: p.id, name: p.name, link: null,
      releases: p.releases.map((r) => ({ tag: r.name, date: r.date ?? null, merges: r.merges, fixes: null })),
    })),
    senators: sec && !home.has(sec.id)
      ? [...senators, { id: sec.id, committee_id: "", alias: sec.name, runtime: sec.runtime, kind: "agent", state: STATE[sec.mood], last_active_at: at, hosted: "here", viewer_attached: false, link: null }]
      : senators,
    threads: t.committees.flatMap((c) => (c.waiting ?? []).map((w) => ({
      committee_id: c.name, root_seq: String(w.root), kind: "question", state: "open", waits_on: "person",
      link: `senate://open/v1/thread/${enc(c.name)}/${w.root}`,
    }))),
    desk_items: Array.from({ length: t.hall?.docket ?? 0 }, (_, i) => ({ committee_id: "senate", root_seq: String(9000 + i), kind: "question", awaiting: "pick", link: `senate://open/v1/desk/senate/${9000 + i}` })),
    approvals: (t.approvals ?? []).map((a, i) => ({
      id: `approval-${i}`, committee_id: home.get(a.senator) ?? "", senator_id: a.senator, tool_kind: "command", asked_at: at, link: "senate://open/v1/approvals",
    })),
    retired: (t.elders ?? []).map((e) => ({
      id: e.id, committee_id: e.committee ?? "", alias: e.name, runtime: e.runtime === "other" ? null : e.runtime,
      last_active_at: daysAgo(asOf, e.idle), link: "senate://open/v1/history",
    })),
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
  const rows: Row[] = [{ snapshot: state, offset_ms: 0 }];
  let cursor = 0, at = 0;
  const seqs = new Map<string, number>();
  const heldSeq = new Map<string, number>();
  const ids = new Set(state.senators.map((s) => s.id));
  const ref = (id?: string) => (id && ids.has(id) ? { kind: "senator", id } : { kind: "external" });
  const push = (kind: string, data: Record<string, unknown>, committee_id?: string) => {
    const frame: Frame = { schema_version: 1, cursor: `demo-${++cursor}`, at: state.as_of, kind, ...(committee_id ? { committee_id } : {}), data };
    rows.push({ offset_ms: at, frame });
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
          const link = `senate://open/v1/thread/${enc(c)}/${e.thread.root}`;
          push("message.posted", { seq: String(seq), message_kind: "question", from: ref(e.from), to: e.to ? [ref(e.to)] : [], root_seq: String(e.thread.root), link }, c);
          if (e.held) {
            heldSeq.set(`${c}:${e.thread.root}`, seq);
            push("message.routed", { route_id: `route-${seq}`, phase: "held_for_hook", seq: String(seq), root_seq: String(e.thread.root), target: ref(e.to), reason: "paused", link }, c);
          }
          break;
        }
        case "release": {
          const c = e.thread.committee;
          const seq = heldSeq.get(`${c}:${e.thread.root}`);
          push("message.routed", { route_id: `route-${seq}`, phase: "released", seq: String(seq ?? e.thread.root), root_seq: String(e.thread.root),
            link: `senate://open/v1/thread/${enc(c)}/${e.thread.root}` }, c);
          break;
        }
        case "tool":
          push("tool.started", { senator_id: e.senator, tool: TOOL[e.tool] ?? "other", call_id: `call-${cursor}` });
          break;
        case "signed": {
          const a = state.approvals.find((x) => x.senator_id === e.senator);
          if (!a) break;
          push("approval.decided", { id: a.id, senator_id: a.senator_id, tool_kind: a.tool_kind, outcome: "allowed" }, a.committee_id);
          const next = { ...state, approvals: state.approvals.filter((x) => x !== a) };
          push("state.patch", diffPatch(state, next));
          state = next;
          break;
        }
        case "answered": {
          const c = e.thread.committee, root = String(e.thread.root);
          const row = { committee_id: c, root_seq: root, kind: "question", opener: ref(e.a), addressees: e.b ? [ref(e.b)] : [], state: "answered", waits_on: "none",
            link: `senate://open/v1/thread/${enc(c)}/${root}` };
          const next = { ...state, threads: [...state.threads.filter((t) => !(t.committee_id === c && t.root_seq === root)), row] };
          push("state.patch", diffPatch(state, next));
          state = next;
          push("thread.state_changed", { root_seq: String(e.thread.root), old_state: "open", new_state: "answered",
            link: `senate://open/v1/thread/${enc(e.thread.committee)}/${e.thread.root}` }, e.thread.committee);
          break;
        }
        default:
          break; // link traffic has no observe event (v1 reports link state only)
      }
    }
  }
  rows.push({ offset_ms: at + pause, end: true });
  return {
    header: { format: "senate-observe-recording", version: 1, capabilities: state.capabilities },
    rows,
  };
}

export const ndjson = (r: { header: RecordingHeader; rows: Row[] }) => [r.header, ...r.rows].map((x) => JSON.stringify(x)).join("\n") + "\n";
