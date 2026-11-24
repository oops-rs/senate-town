// A made-up town that plays the same way every time: for a plain browser,
// the app's demo and snapshots. Its names are invented; it also carries
// what the daemon does not tell yet (tool calls, held deliveries and their
// reasons, approvals, links, elders, projects), so the look can be seen
// whole while those reads are built.
import type { Elder, Mood, Project, Runtime, Senator, TownEvent, TownState } from "./model.ts";

/** A step of the scripted life: events to act out, or a new state (a committee appears). */
export type Step = [number, TownEvent[] | (() => TownState)];

const s = (id: string, name: string, runtime: Runtime, mood: Mood, chair = false, doing?: string, watched = false): Senator =>
  ({ id, name, runtime, mood, chair, sessionId: `demo-${id}`, doing, watched });
const day = 86_400;

const elders: Elder[] = [
  { id: "codex-flaky", name: "flaky", runtime: "codex", idle: 2 * 3600, sessionId: "demo-past-flaky", committee: "senate" },
  { id: "claude-deploy", name: "deploy", runtime: "claude", idle: 3 * day, sessionId: "demo-past-deploy", committee: "infra" },
  { id: "agy-oncall", name: "oncall", runtime: "agy", idle: 21 * day, sessionId: "demo-past-oncall", committee: "infra" },
  { id: "claude-scout", name: "scout", runtime: "claude", idle: 6 * 3600, sessionId: "demo-past-scout", committee: "web" },
];

const projects: Project[] = [
  { id: "senate", name: "senate", releases: [
    { name: "v0.10.0", date: "Nov 23", merges: 5, plaques: ["app icon & sidebar", "sessions in the app"] },
    { name: "v0.11.0", date: "Nov 24", merges: 10, plaques: ["Markdown as a block tree", "Antigravity timeline", "desk forward"] },
    { name: "v0.12.0", date: "Nov 24", merges: 19, plaques: ["remote hardening", "accessibility audit", "Secretary row"] },
    { name: "v0.12.2", date: "Nov 24", merges: 7, plaques: ["committee archive", "app polish"] },
    { name: "v0.12.3", date: "Nov 24", merges: 8, plaques: ["show archived", "History in the app"] },
  ], unreleased: { merges: 8, plaques: ["senate desk", "watch finder", "profile stats"] }, committees: ["senate", "docs"] },
  { id: "ledger", name: "ledger-app", releases: [
    { name: "v1.4.0", merges: 12, plaques: ["refund tables"] }, { name: "v1.5.0", merges: 6, plaques: ["schema v3"] },
  ], unreleased: { merges: 3, plaques: ["migration window"] }, committees: ["ledger"] },
  { id: "web", name: "storefront", releases: [{ name: "2026.10", merges: 9, plaques: ["colour tokens"] }, { name: "2026.11", merges: 14, plaques: ["new checkout"] }],
    committees: ["web", "ios-duo"] },
];

export const quiet: TownState = {
  person: "alice",
  history: 214,
  elders,
  projects,
  links: { parent: { name: "/acme", up: true }, children: [{ name: "ci-runner", up: true }, { name: "bob-desk", up: false }], remotes: [{ name: "studio-mini", up: true }] },
  approvals: [{ senator: "claude-app", ask: "Bash: cargo publish -p senated", person: "alice" }],
  // A committee that was archived: its house stays as a monument in its project's quarter.
  archived: [{ name: "legacy-api", project: "senate", closed: "Oct 2", shipped: ["the first daemon", "SSE streams", "the CLI's ask"] }],
  committees: [
    { name: "senate", senators: [
      { ...s("claude-chair", "chair", "claude", "working", true, "Town in the Works style"),
        // A senator's own card: how it chose to look.
        card: { hat: "top", accessory: "glasses", deskItem: "cat", body: "round", hairColour: 6 } },
      s("claude-town", "town", "claude", "working", false, "Phaser scene"),
      s("claude-app", "app", "claude", "waiting", false, "Publishing senated"),
      s("codex-timeline", "timeline", "codex", "idle"),
    ], waiting: [{ committee: "senate", root: 2577, title: "Unknown committee in ask", asker: "app" }] },
    // A chair's card for its house: a dome, brick, a windmill beside it, blossom in the garden.
    { name: "ledger", card: { roof: "dome", material: "brick", landmark: "windmill", wall: 1, trim: 3, garden: "pond", plants: ["blossom", "birch", "flowers"] }, senators: [
      s("codex-ledger", "ledger", "codex", "idle", true),
      s("claude-migrate", "migrate", "claude", "working", false, "Migrate the refund tables", true),
      s("agy-schema", "schema", "agy", "paused"),
    ] },
    { name: "web", senators: [s("claude-web", "web", "claude", "idle", true), s("agy-css", "css", "agy", "working", false, "Colour tokens")] },
    { name: "ios-duo", senators: [s("codex-ios", "ios", "codex", "working", true, "Sheet presentation"), s("claude-modal", "modal", "claude", "idle")],
      waiting: [{ committee: "ios-duo", root: 412, title: "Ship the modal?", asker: "ios" }] },
    { name: "docs", senators: [s("claude-docs", "scribe", "claude", "working", true, "Release notes")] },
  ],
  hall: { secretary: s("claude-secretary", "secretary", "claude", "working", false, "Working the docket"), docket: 3 },
};

const ref = (committee: string, root: number, title: string) => ({ committee, root, title });

/** The small town with a committee created while you watch. */
export const grown = (): TownState => ({
  ...quiet,
  committees: [...quiet.committees, { name: "release-train", senators: [s("codex-release", "release", "codex", "working", true, "Cutting 0.13.0")] }],
});

/** One round of the small town's life. */
export const busy: Step[] = [
  [0, [
    { kind: "message", from: "claude-town", to: "claude-chair", thread: ref("senate", 2585, "Town page"), line: "The Works are ready for a look" },
    { kind: "tool", senator: "claude-town", tool: "bash", target: "npm run build" },
    { kind: "tool", senator: "claude-migrate", tool: "edit", target: "migrations/0042_split_ledger.sql" },
  ]],
  [900, [
    { kind: "message", from: "codex-ledger", to: "claude-web", thread: ref("ledger", 88, "Shared schema"), line: "The schema moved to v3" },
    { kind: "tool", senator: "agy-css", tool: "web", target: "contrast guidelines" },
    { kind: "tool", senator: "claude-chair", tool: "mcp", target: "senate · status" },
  ]],
  [900, [
    { kind: "message", from: "claude-docs", to: "agy-schema", thread: ref("docs", 9, "Release notes"), line: "Release notes need the new tables", held: "schema is paused" },
    { kind: "tool", senator: "codex-ios", tool: "read", target: "Sheet.swift" },
    { kind: "tool", senator: "claude-docs", tool: "grep", target: "\"refund\" in docs/" },
  ]],
  [1200, [
    { kind: "message", from: "reviewer", to: "claude-migrate", thread: ref("ledger", 90, "Review"), line: "Can you check the refund policy?" },
    { kind: "link", link: "remote", name: "studio-mini" },
  ]],
  [2600, [{ kind: "answered", thread: ref("ledger", 77, "Migration order"), a: "claude-migrate", b: "codex-ledger" }]],
  [2400, [{ kind: "signed", senator: "claude-app" }]],
  [2600, [{ kind: "release", thread: ref("docs", 9, "Release notes") }]],
  [1500, grown],
];

/** Thirty committees, about sixty senators: the big town. */
export function large(): TownState {
  const moods: Mood[] = ["working", "idle", "idle", "working", "paused", "waiting", "idle", "stopped"];
  const runtimes: Runtime[] = ["claude", "codex", "agy", "claude"];
  let n = 0;
  return {
    ...quiet,
    approvals: [{ senator: "s5", ask: "Bash: rm -rf build/", person: "alice" }],
    committees: Array.from({ length: 30 }, (_, c) => ({
      name: `committee-${c}`,
      senators: [0, 1, 2].slice(0, 1 + (c % 3)).map((k) => {
        const i = n++;
        return s(`s${i}`, `senator-${i}`, runtimes[i % 4]!, moods[(i * 3 + c) % moods.length]!, k === 0, k === 0 ? "Chairing" : undefined);
      }),
      waiting: c % 7 === 0 ? [{ committee: `committee-${c}`, root: c + 1, title: "Question" }] : [],
    })),
  };
}

export function largeBusy(): Step[] {
  return [[0, Array.from({ length: 12 }, (_, i): TownEvent => ({
    kind: "message", from: `s${i * 4}`, to: `s${(i * 4 + 17) % 58}`, thread: ref(`committee-${i * 2}`, 100 + i, "Hello"), line: `Hello from senator ${i * 4}`,
  })).concat(Array.from({ length: 6 }, (_, i): TownEvent => ({ kind: "tool", senator: `s${i * 9}`, tool: (["bash", "edit", "read", "grep", "mcp", "web"] as const)[i]! })))]];
}
