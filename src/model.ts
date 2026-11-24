// The Town's model: what the scene draws is a pure function of a small
// TownState, and what it animates is a stream of TownEvents. Nothing here
// knows Phaser, the DOM or the app; the app (or a script) feeds it.

export type Runtime = "claude" | "codex" | "agy" | "other";
export type Mood = "working" | "idle" | "waiting" | "paused" | "stopped";

export interface Senator {
  /** The senator's bare id (`claude-14ed…`): what messages name. */
  id: string;
  name: string;
  runtime: Runtime;
  mood: Mood;
  chair?: boolean;
  /** This machine's session for it, which a click opens. */
  sessionId?: string;
  /** What it is working on, when known. */
  doing?: string;
  /** Someone is attached to its terminal (looking in at the window). */
  watched?: boolean;
  /** Its own card: how it chose to look (untrusted; read by gen.readLook). */
  card?: unknown;
}

/** A committee that was archived: its house stays as a monument. */
export interface Archived {
  name: string;
  /** The project (repository) whose quarter keeps it. */
  project?: string;
  closed?: string;
  shipped?: string[];
  card?: unknown;
}

/** A senator no longer working: an elder of the town, aged by idle time. */
export interface Elder {
  id: string;
  name: string;
  runtime: Runtime;
  /** Seconds since it last worked. */
  idle: number;
  /** Its ended session, which a click opens in History. */
  sessionId?: string;
  committee?: string;
}

export interface Release { name: string; date?: string; merges: number; plaques: string[] }

/** A repository the committees work in: its own monument quarter. */
export interface Project {
  id: string;
  name: string;
  /** A building style from the set; by default from the name's hash. */
  style?: string;
  releases: Release[];
  unreleased?: { merges: number; plaques: string[] };
  committees?: string[];
}

/** The links beyond town: the parent Senate, child Senates, paired machines. */
export interface Links {
  parent?: { name: string; up: boolean };
  children?: { name: string; up: boolean }[];
  remotes?: { name: string; up: boolean }[];
}

/** A permission prompt only a person may sign: the gate at a workshop. */
export interface Approval { senator: string; ask: string; person?: string }

export type ToolKind = "bash" | "edit" | "read" | "grep" | "mcp" | "web";

export interface ThreadRef {
  committee: string;
  root: number;
  title: string;
  /** Who asked, for a thread waiting on the person. */
  asker?: string;
}

export interface Committee {
  name: string;
  /** The chair first. */
  senators: Senator[];
  /** Threads waiting on the person here. */
  waiting?: ThreadRef[];
  /** The chair's card for the house (untrusted; read by gen.readHouse). */
  card?: unknown;
}

export interface Hall {
  secretary?: Senator;
  docket?: number;
}

export interface TownState {
  committees: Committee[];
  hall?: Hall;
  person?: string;
  elders?: Elder[];
  projects?: Project[];
  links?: Links;
  approvals?: Approval[];
  /** History: ended sessions kept. */
  history?: number;
  archived?: Archived[];
}

export type TownEvent =
  | { kind: "message"; from: string; to?: string; thread: ThreadRef; line: string; held?: string }
  /** A held delivery may go on. */
  | { kind: "release"; thread: ThreadRef }
  /** A tool call in a senator's turn: a worker comes out. */
  | { kind: "tool"; senator: string; tool: ToolKind; target?: string }
  /** A person signed an approval: the gate opens. */
  | { kind: "signed"; senator: string }
  /** The uplink, a child or a remote carried something. */
  | { kind: "link"; link: "parent" | "child" | "remote"; name: string }
  | { kind: "mood"; senator: string; mood: Mood }
  | { kind: "arrived"; senator: string }
  | { kind: "left"; senator: string }
  | { kind: "answered"; thread: ThreadRef; a?: string; b?: string };

export const threadKey = (t: ThreadRef) => `${t.committee}:${t.root}`;

/** Every senator by id, the Secretary included. */
export function senatorsOf(state: TownState): Map<string, Senator> {
  const all = new Map<string, Senator>();
  for (const c of state.committees) for (const s of c.senators) if (!all.has(s.id)) all.set(s.id, s);
  const sec = state.hall?.secretary;
  if (sec && !all.has(sec.id)) all.set(sec.id, sec);
  return all;
}

/** The committee a senator lives in; undefined for the Secretary (the hall). */
export function homeOf(state: TownState, id: string): string | undefined {
  return state.committees.find((c) => c.senators.some((s) => s.id === id))?.name;
}

/**
 * What happened between two readings: moods, arrivals, departures. Nothing
 * for the first reading: a town that opens is quiet, not a replay.
 */
export function diff(old: TownState | undefined, now: TownState): TownEvent[] {
  if (!old) return [];
  const events: TownEvent[] = [];
  const before = senatorsOf(old);
  const after = senatorsOf(now);
  for (const id of [...after.keys()].sort()) {
    const s = after.get(id)!;
    const was = before.get(id);
    if (was) {
      if (was.mood === s.mood) continue;
      if (s.mood === "stopped") events.push({ kind: "left", senator: id });
      else if (was.mood === "stopped") events.push({ kind: "arrived", senator: id });
      else events.push({ kind: "mood", senator: id, mood: s.mood });
    } else if (s.mood !== "stopped") {
      events.push({ kind: "arrived", senator: id });
    }
  }
  for (const id of [...before.keys()].sort()) if (!after.has(id)) events.push({ kind: "left", senator: id });
  return events;
}

/** One entry of a committee's activity (the core's ActivityEntry). */
export interface ActivityEntry {
  committee: string;
  seq: number;
  kind: string;
  from: string;
  to: string[];
  onBehalfOf?: string;
  thread?: number;
  line: string;
  state?: string;
}

const SPOKEN = new Set(["question", "request", "answer", "note", "escalation", "decision"]);
const SETTLED = new Set(["active", "answered", "closed", "archived", "done"]);

/**
 * The town's events in a batch of activity: what was said (a visit from
 * its real author to the first it was said to) and threads settled.
 * Comings and goings come from the roster's own readings.
 */
export function activityEvents(entries: ActivityEntry[]): TownEvent[] {
  const out: TownEvent[] = [];
  const sorted = [...entries].sort((a, b) => a.seq - b.seq || a.committee.localeCompare(b.committee));
  for (const e of sorted) {
    const author = senatorId(e.onBehalfOf ?? e.from);
    const listener = e.to[0] !== undefined ? senatorId(e.to[0]) : undefined;
    const thread: ThreadRef = { committee: e.committee, root: e.thread ?? e.seq, title: firstWords(e.line, 12, 80) };
    if (SPOKEN.has(e.kind)) {
      if (author === listener) continue;
      out.push({ kind: "message", from: author, to: listener, thread, line: e.line });
    } else if (e.kind === "status" && e.state && SETTLED.has(e.state) && e.thread !== undefined) {
      out.push({ kind: "answered", thread, a: author, b: listener });
    }
  }
  return out;
}

/** `[senator::claude-1]`, `senator::claude-1`, `/acme::office::secretary` → the bare id. */
export function senatorId(mention: string): string {
  let t = mention.trim();
  if (t.startsWith("[") && t.endsWith("]")) t = t.slice(1, -1);
  const i = t.lastIndexOf("::");
  return i >= 0 ? t.slice(i + 2) : t;
}

/** The first words of a message, on one line, `…` when cut. */
export function firstWords(text: string, words = 6, characters = 34): string {
  const line = text.split(/\r?\n/)[0] ?? "";
  const parts = line.split(/\s+/).filter(Boolean);
  let out = parts.slice(0, words).join(" ");
  let cut = parts.length > words;
  if ([...out].length > characters) {
    out = [...out].slice(0, characters - 1).join("").trim();
    cut = true;
  }
  return cut ? out + "…" : out;
}

/** FNV-1a over UTF-8: the same on every launch and machine. */
export function hash(text: string): bigint {
  let h = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) {
    h ^= BigInt(byte);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h;
}

/** A deterministic generator in [0, 1) (SplitMix64), seeded by a string. */
export function seeded(seed: string): () => number {
  let s = hash(seed) | 1n;
  return () => {
    s = (s + 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn;
    let z = s;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & 0xffffffffffffffffn;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & 0xffffffffffffffffn;
    z ^= z >> 31n;
    return Number(z >> 11n) / 2 ** 53;
  };
}
