// The Senate's observe API, v1 (docs/observe.md, `@senate/observe`), as Town
// reads it: the public state (a snapshot kept current by `state.patch`
// frames, applied by the published client) and the domain events, mapped to
// the TownState the scene draws and the TownEvents it animates. Pure: no DOM,
// no Phaser, no network. Unknown kinds, fields and enum values are tolerated
// as unknown, as the spec asks. Town needs metadata only: no line, no title.
import type { Address, Card, EventFrame, Snapshot, UnknownFrame } from "@senate/observe";
import type { Approval, Committee, Elder, Mood, Runtime, Senator, TownEvent, TownState, ToolKind, ThreadRef } from "./model.ts";

export type ObserveState = Snapshot;
export type Frame = EventFrame | UnknownFrame;

const RUNTIMES = new Set(["claude", "codex", "agy"]);
const runtimeOf = (r: string | null | undefined): Runtime => (r && RUNTIMES.has(r) ? (r as Runtime) : "other");
const MOODS: Record<string, Mood> = { working: "working", idle: "idle", waiting_on_person: "waiting", paused: "paused" };
const ELDER = new Set(["stopped", "away"]);
const secondsSince = (iso: string | null | undefined, now: number) => (iso ? Math.max(0, (now - Date.parse(iso)) / 1000) : 0);

/**
 * A card's Town part. Cards are opaque to Senate; Town keeps its own under
 * `town` (`town.house` for a committee, `town.look` for a senator or the
 * person), each read strictly by gen.ts.
 */
function townCard(card: Card | null | undefined, part: "house" | "look"): unknown {
  const town = (card?.value as { town?: Record<string, unknown> } | undefined)?.town;
  return town && typeof town === "object" ? town[part] : undefined;
}

/** The Speaker's desk worker (the Secretary), when the view shows one. */
function secretaryOf(state: ObserveState): Senator | undefined {
  const id = state.senate.desk_workers?.[0];
  if (!id) return undefined;
  const s = state.senators.find((x) => x.id === id);
  return s
    ? { id, name: s.alias ?? id, runtime: runtimeOf(s.runtime), mood: MOODS[s.state] ?? "idle", link: s.link ?? undefined, card: townCard(s.card, "look") }
    : { id, name: id, runtime: "other", mood: "idle" };
}

/** The public state, drawn as a town. Elders are seated senators that stopped or went away, and retired ones. */
export function toTown(state: ObserveState, now = Date.now()): TownState {
  const byId = new Map(state.committees.map((c) => [c.id, c]));
  const workers = new Set(state.senate.desk_workers ?? []);
  const committees: Committee[] = state.committees.filter((c) => !c.archived).map((c) => {
    const rows = state.senators.filter((s) => s.committee_id === c.id && !ELDER.has(s.state) && !workers.has(s.id));
    const senators: Senator[] = rows.map((s) => ({
      id: s.id, name: s.alias ?? s.id, runtime: runtimeOf(s.runtime), mood: MOODS[s.state] ?? "idle",
      chair: s.id === c.chair_id, watched: s.viewer_attached === true, card: townCard(s.card, "look"), link: s.link ?? undefined,
    }));
    senators.sort((a, b) => Number(!!b.chair) - Number(!!a.chair));
    const waiting: ThreadRef[] = state.threads
      .filter((t) => t.committee_id === c.id && t.waits_on === "person")
      .map((t) => ({ committee: c.name, root: Number(t.root_seq), title: "", link: t.link ?? undefined }));
    return { name: c.name, senators, waiting, card: townCard(c.card, "house"), link: c.link ?? undefined };
  });
  const elders: Elder[] = [...state.senators.filter((s) => ELDER.has(s.state)), ...(state.retired ?? [])].map((s) => ({
    id: s.id, name: s.alias ?? s.id, runtime: runtimeOf(s.runtime), idle: secondsSince(s.last_active_at, now),
    committee: byId.get(s.committee_id)?.name, link: s.link ?? state.navigation?.history ?? undefined,
  }));
  const approvals: Approval[] = state.approvals.map((a) => ({ senator: a.senator_id, ask: a.tool_kind, link: a.link ?? undefined }));
  const projects = state.projects.map((p) => ({
    id: p.id, name: p.name, link: p.link ?? undefined,
    // Releases as the Senate saw them: tag, when, merges and fixes (no merge subjects).
    releases: (p.releases ?? []).map((r) => ({ name: r.tag, date: r.at.slice(0, 10), merges: r.merges, fixes: r.fixes, plaques: [] })),
    committees: state.committees.filter((c) => c.project_id === p.id).map((c) => c.name),
  }));
  const archived = state.committees.filter((c) => c.archived).map((c) => ({
    name: c.name, project: c.project_id ?? undefined, card: townCard(c.card, "house"), link: c.link ?? undefined,
  }));
  const up = (s: string) => s === "up";
  const parent = state.links.find((l) => l.kind === "parent");
  const nav = state.navigation
    ? Object.fromEntries(Object.entries(state.navigation).filter((e): e is [string, string] => typeof e[1] === "string"))
    : undefined;
  return {
    committees,
    hall: { docket: state.desk_items.length, secretary: secretaryOf(state) },
    person: state.senate.person?.name ?? undefined,
    elders, projects, approvals, archived,
    links: {
      parent: parent && { name: parent.name, up: up(parent.state) },
      children: state.links.filter((l) => l.kind === "child").map((l) => ({ name: l.name, up: up(l.state) })),
      remotes: state.links.filter((l) => l.kind === "paired_machine").map((l) => ({ name: l.name, up: up(l.state) })),
    },
    navigation: nav,
  };
}

const TOOLS: Record<string, ToolKind> = { command: "bash", edit: "edit", read: "read", search: "grep", web: "web" };
const who = (a: Address | null | undefined) => (a?.kind === "senator" ? a.id : undefined);

/**
 * A domain event as the town animates it. State changes (moods, arrivals,
 * approvals appearing and going) come from the patches through the state
 * diff, so only what the state can't show is mapped here: messages
 * travelling, holds and releases, signatures, tools. `before` is the state
 * as it was before this frame (an approval's senator is found there).
 */
export function frameEvents(before: ObserveState, f: Frame): TownEvent[] {
  const d = (f.data ?? {}) as Record<string, unknown>;
  const cname = before.committees.find((c) => c.id === f.committee_id)?.name ?? f.committee_id ?? "";
  const link = typeof f.link === "string" ? f.link : undefined;
  const thread = (root: unknown): ThreadRef => ({ committee: cname, root: Number(root ?? 0), title: "", link });
  switch (f.kind) {
    case "message.posted": {
      const from = who(d.from as Address) ?? "external";
      const to = Array.isArray(d.to) ? (d.to as Address[]).map(who).find(Boolean) : undefined;
      return [{ kind: "message", from, to, thread: thread(d.root_seq ?? d.seq), line: "" }];
    }
    case "message.routed": {
      const phase = d.phase as string;
      if (phase === "held_for_hook" || phase === "queued") {
        const to = who(d.target as Address);
        if (to) return [{ kind: "message", from: "office", to, thread: thread(d.seq), line: "", held: String(d.reason ?? "held") }];
      }
      if (phase === "released") return [{ kind: "release", thread: thread(d.seq) }];
      return [];
    }
    case "approval.decided": {
      if (d.decision !== "allowed") return [];
      const a = before.approvals.find((x) => x.id === d.id);
      return a ? [{ kind: "signed", senator: a.senator_id }] : [];
    }
    case "tool.started": {
      const kind = String(d.tool_kind ?? "");
      const tool = kind.startsWith("mcp:") ? "mcp" : TOOLS[kind];
      return tool && typeof d.senator_id === "string" ? [{ kind: "tool", senator: d.senator_id, tool }] : [];
    }
    case "thread.state_changed": {
      // Settled: the answer came back.
      if (d.state !== "archived") return [];
      const row = before.threads.find((t) => t.committee_id === f.committee_id && t.root_seq === String(d.root_seq));
      return [{ kind: "answered", thread: thread(d.root_seq), a: who(row?.opener), b: who(row?.addressees?.[0]) }];
    }
    default:
      return [];
  }
}
