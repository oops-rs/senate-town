// The Senate's observe API, v1 (docs/observe.md), as Town reads it: the
// public state (a snapshot kept current by `state.patch` frames) and the
// domain events, mapped to the TownState the scene draws and the TownEvents
// it animates. Pure: no DOM, no Phaser, no network. Unknown kinds, fields
// and enum values are tolerated as unknown, as the spec asks.
import type { Approval, Committee, Elder, Mood, Runtime, Senator, TownEvent, TownState, ToolKind, ThreadRef } from "./model.ts";

export type Ref = { kind: "senator"; id: string } | { kind: "office" } | { kind: "external" } | { kind: string; id?: string };

export interface OSenator {
  id: string; committee_id: string; alias: string | null; runtime: string | null; kind: string;
  state: string; last_active_at: string | null; hosted: string; viewer_attached: boolean | null;
  card?: unknown; link?: string | null;
}
export interface OCommittee { id: string; name: string; chair_id: string | null; archived: boolean; project_id: string | null; card?: unknown; link?: string | null }
/** Releases on a project: announced as coming (tags, dates, counts; no merge subjects). */
export interface ORelease { tag: string; date?: string | null; merges?: number | null; fixes?: number | null }
export interface OProject { id: string; name: string; releases?: ORelease[]; link?: string | null }
/** A retired senator (announced as a bounded collection): an elder of the town. */
export interface ORetired { id: string; committee_id: string; alias: string | null; runtime: string | null; last_active_at: string | null; link?: string | null }
export interface OThread { committee_id: string; root_seq: string; kind: string; opener?: Ref; addressees?: Ref[]; state: string; waits_on: string; link?: string | null }
export interface ODesk { committee_id: string; root_seq: string; kind: string; awaiting: string; link?: string | null }
export interface OApproval { id: string; committee_id: string; senator_id: string; tool_kind: string; asked_at: string; link?: string | null }
export interface OLink { id: string; kind: string; name: string; state: string; link?: string | null }

export interface ObserveState {
  schema_version: number;
  capabilities: string[];
  as_of: string;
  cursor: string;
  senate: { id: string; name: string; person?: string | null; desk_owner?: string | null; desk_workers?: string[]; card?: unknown };
  navigation?: Partial<Record<"desk" | "approvals" | "inbox" | "history" | "profile", string>> | null;
  links: OLink[];
  committees: OCommittee[];
  projects: OProject[];
  senators: OSenator[];
  threads: OThread[];
  desk_items: ODesk[];
  approvals: OApproval[];
  retired?: ORetired[];
  windows?: unknown;
}

export interface Frame {
  schema_version: number;
  cursor: string;
  at: string;
  kind: string;
  committee_id?: string;
  data: Record<string, unknown>;
}

type Collection = "links" | "committees" | "projects" | "senators" | "threads" | "desk_items" | "approvals" | "retired";
const KEYS: Record<Collection, string[]> = {
  links: ["id"], committees: ["id"], projects: ["id"], senators: ["committee_id", "id"],
  threads: ["committee_id", "root_seq"], desk_items: ["committee_id", "root_seq"], approvals: ["id"], retired: ["committee_id", "id"],
};
const keyOf = (c: Collection, row: Record<string, unknown>) => KEYS[c].map((k) => String(row[k])).join("\u0000");

/** Apply a `state.patch` atomically; returns a new state. */
export function applyPatch(state: ObserveState, data: { upsert?: Record<string, unknown[]>; remove?: Record<string, unknown[]>; replace?: Record<string, unknown> }): ObserveState {
  const next: ObserveState = { ...state };
  for (const c of Object.keys(KEYS) as Collection[]) {
    const ups = (data.upsert?.[c] ?? []) as Record<string, unknown>[];
    const rms = (data.remove?.[c] ?? []) as Record<string, unknown>[];
    if (!ups.length && !rms.length) continue;
    const rows = new Map(((state[c] ?? []) as unknown as Record<string, unknown>[]).map((r) => [keyOf(c, r), r]));
    for (const r of rms) rows.delete(keyOf(c, r));
    for (const r of ups) rows.set(keyOf(c, r), r);
    (next as unknown as Record<string, unknown>)[c] = [...rows.values()];
  }
  const rep = data.replace ?? {};
  if (rep.senate) next.senate = rep.senate as ObserveState["senate"];
  if ("navigation" in rep) next.navigation = rep.navigation as ObserveState["navigation"];
  if ("windows" in rep) next.windows = rep.windows;
  return next;
}

const RUNTIMES = new Set(["claude", "codex", "agy"]);
const runtimeOf = (r: string | null): Runtime => (r && RUNTIMES.has(r) ? (r as Runtime) : "other");
const MOODS: Record<string, Mood> = { working: "working", idle: "idle", waiting_on_person: "waiting", paused: "paused" };
const ELDER = new Set(["stopped", "away"]);
const nameOf = (s: OSenator) => s.alias ?? s.id;
const secondsSince = (iso: string | null, now: number) => (iso ? Math.max(0, (now - Date.parse(iso)) / 1000) : 0);

/** Senator id → the committee name of its first seat (what events address). */
function seats(state: ObserveState) {
  const committee = new Map(state.committees.map((c) => [c.id, c]));
  return { committee };
}

/** The Speaker's desk worker (the Secretary), when the view shows one. */
function secretaryOf(state: ObserveState): Senator | undefined {
  const id = state.senate.desk_workers?.[0];
  const s = id ? state.senators.find((x) => x.id === id) : undefined;
  if (!id) return undefined;
  return s
    ? { id, name: nameOf(s), runtime: runtimeOf(s.runtime), mood: MOODS[s.state] ?? "idle", link: s.link ?? undefined }
    : { id, name: id, runtime: "other", mood: "idle" };
}

/** The public state, drawn as a town. Elders are seated senators that stopped or went away. */
export function toTown(state: ObserveState, now = Date.now()): TownState {
  const { committee } = seats(state);
  const live = state.committees.filter((c) => !c.archived);
  const committees: Committee[] = live.map((c) => {
    const rows = state.senators.filter((s) => s.committee_id === c.id && !ELDER.has(s.state));
    const senators: Senator[] = rows.map((s) => ({
      id: s.id, name: nameOf(s), runtime: runtimeOf(s.runtime), mood: MOODS[s.state] ?? "idle",
      chair: s.id === c.chair_id, watched: s.viewer_attached === true, card: s.card, link: s.link ?? undefined,
    }));
    senators.sort((a, b) => Number(!!b.chair) - Number(!!a.chair));
    const waiting: ThreadRef[] = state.threads
      .filter((t) => t.committee_id === c.id && t.waits_on === "person")
      .map((t) => ({ committee: c.name, root: Number(t.root_seq), title: "", link: t.link ?? undefined }));
    return { name: c.name, senators, waiting, card: c.card, link: c.link ?? undefined };
  });
  const elders: Elder[] = [...state.senators.filter((s) => ELDER.has(s.state)), ...(state.retired ?? [])].map((s) => ({
    id: s.id, name: s.alias ?? s.id, runtime: runtimeOf(s.runtime), idle: secondsSince(s.last_active_at, now),
    committee: committee.get(s.committee_id)?.name, link: s.link ?? state.navigation?.history ?? undefined,
  }));
  const approvals: Approval[] = state.approvals.map((a) => ({ senator: a.senator_id, ask: a.tool_kind, link: a.link ?? undefined }));
  const projects = state.projects.map((p) => ({
    id: p.id, name: p.name,
    releases: (p.releases ?? []).map((r) => ({ name: r.tag, date: r.date ?? undefined, merges: r.merges ?? 0, fixes: r.fixes ?? undefined, plaques: [] })),
    link: p.link ?? undefined,
    committees: state.committees.filter((c) => c.project_id === p.id).map((c) => c.name),
  }));
  const archived = state.committees.filter((c) => c.archived).map((c) => ({
    name: c.name, project: c.project_id ?? undefined, card: c.card, link: c.link ?? undefined,
  }));
  const up = (l: OLink) => l.state === "up";
  const parent = state.links.find((l) => l.kind === "parent");
  return {
    committees,
    hall: { docket: state.desk_items.length, secretary: secretaryOf(state) },
    person: state.senate.person ?? undefined,
    elders, projects, approvals, archived,
    links: {
      parent: parent && { name: parent.name, up: up(parent) },
      children: state.links.filter((l) => l.kind === "child").map((l) => ({ name: l.name, up: up(l) })),
      remotes: state.links.filter((l) => l.kind === "paired_machine").map((l) => ({ name: l.name, up: up(l) })),
    },
    navigation: state.navigation ?? undefined,
  };
}

const TOOLS: Record<string, ToolKind> = { command: "bash", edit: "edit", read: "read", search: "grep", web: "web" };

/**
 * A domain event as the town animates it. State changes (moods, arrivals,
 * approvals appearing) come from the patches via the state diff, so only
 * what the state can't show is mapped here: messages travelling, holds and
 * releases, signatures, tools, link traffic.
 */
export function frameEvents(state: ObserveState, f: Frame): TownEvent[] {
  const d = f.data;
  const cname = state.committees.find((c) => c.id === f.committee_id)?.name ?? f.committee_id ?? "";
  const who = (r: unknown) => ((r as Ref | undefined)?.kind === "senator" ? (r as { id: string }).id : undefined);
  const thread = (root: unknown, link?: unknown): ThreadRef => ({ committee: cname, root: Number(root ?? 0), title: "", link: typeof link === "string" ? link : undefined });
  switch (f.kind) {
    case "message.posted": {
      const from = who(d.from) ?? "external";
      const to = Array.isArray(d.to) ? d.to.map(who).find(Boolean) : undefined;
      return [{ kind: "message", from, to, thread: thread(d.root_seq ?? d.seq, d.link), line: typeof d.line === "string" ? d.line : "" }];
    }
    case "message.routed": {
      const phase = d.phase as string;
      if (phase === "held_for_hook" || phase === "queued") {
        const to = who(d.target);
        if (to) return [{ kind: "message", from: "office", to, thread: thread(d.root_seq ?? d.seq, d.link), line: "", held: String(d.reason ?? "held") }];
      }
      if (phase === "released") return [{ kind: "release", thread: thread(d.root_seq ?? d.seq, d.link) }];
      return [];
    }
    case "approval.decided":
      return d.outcome === "allowed" ? [{ kind: "signed", senator: String(d.senator_id ?? "") }] : [];
    case "tool.started": {
      const tool = typeof d.tool === "string" && d.tool.startsWith("mcp:") ? "mcp" : TOOLS[String(d.tool)];
      return tool ? [{ kind: "tool", senator: String(d.senator_id ?? ""), tool }] : [];
    }
    case "thread.state_changed": {
      if (d.new_state !== "answered" && d.new_state !== "done") return [];
      const row = state.threads.find((t) => t.committee_id === f.committee_id && t.root_seq === String(d.root_seq));
      return [{ kind: "answered", thread: thread(d.root_seq, d.link), a: who(row?.opener), b: who(row?.addressees?.[0]) }];
    }
    default:
      return [];
  }
}
