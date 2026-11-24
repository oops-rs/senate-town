import { describe, expect, it, vi } from "vitest";
import { applyFrame } from "@senate/observe";
import { cursorOf, diffPatch, ndjson, recording, toObserve } from "../src/encode.ts";
import { Feed } from "../src/feed.ts";
import { connect, type Binding } from "../src/host.ts";
import type { TownEvent, TownState } from "../src/model.ts";
import { frameEvents, toTown, type Frame, type ObserveState } from "../src/observe.ts";
import * as script from "../src/script.ts";
import { parseRecording } from "../src/shell.ts";

const frame = (kind: string, data: Record<string, unknown>, committee_id?: string, n = 1, link?: string): Frame =>
  ({ schema_version: 1, cursor: cursorOf(n), at: "2026-11-25T10:00:00Z", kind, committee_id, link, data }) as unknown as Frame;
const patch = (a: ObserveState, b: ObserveState, n = 1) => frame("state.patch", diffPatch(a, b), undefined, n);
const NOW = Date.parse("2026-11-25T10:00:00Z");

describe("observe → town", () => {
  const town = toTown(toObserve(script.quiet), NOW);

  it("keeps committees, senators, moods, chairs, cards and links", () => {
    const sorted = (xs: string[]) => xs.slice().sort();
    expect(sorted(town.committees.map((c) => c.name))).toEqual(sorted(script.quiet.committees.map((c) => c.name)));
    for (const c of script.quiet.committees) {
      const got = town.committees.find((x) => x.name === c.name)!;
      expect(got.link).toMatch(/^senate:\/\/open\/v1\/committee\//);
      expect(got.card).toEqual(c.card);
      for (const s of c.senators) {
        const g = got.senators.find((x) => x.id === s.id)!;
        expect([g.mood, g.chair, g.runtime, g.card]).toEqual([s.mood, s.chair, s.runtime, s.card]);
        expect(g.link).toMatch(/^senate:\/\/open\/v1\/senator\/.+%3A%3A/);
      }
    }
  });

  it("brings elders, archived houses, approvals, the Secretary, the docket, releases", () => {
    const sorted = (xs: string[]) => xs.slice().sort();
    expect(sorted(town.elders!.map((e) => e.id))).toEqual(sorted(script.quiet.elders!.map((e) => e.id)));
    const e0 = script.quiet.elders![0]!;
    expect(Math.round(town.elders!.find((e) => e.id === e0.id)!.idle)).toBe(e0.idle);
    expect(sorted(town.archived!.map((a) => a.name))).toEqual(sorted(script.quiet.archived!.map((a) => a.name)));
    expect(sorted(town.approvals!.map((a) => a.senator))).toEqual(sorted(script.quiet.approvals!.map((a) => a.senator)));
    expect(town.hall?.secretary?.id).toBe(script.quiet.hall?.secretary?.id);
    expect(town.hall?.docket).toBe(script.quiet.hall?.docket);
    expect(town.navigation?.approvals).toMatch(/^senate:\/\/open\/v1\/approvals/);
    const p0 = script.quiet.projects![0]!;
    expect(town.projects!.find((p) => p.id === p0.id)!.releases.map((r) => r.name)).toEqual(p0.releases.map((r) => r.name));
  });

  it("patches (through the published client) rebuild the same state as a fresh snapshot", () => {
    const a = toObserve(script.quiet), b = toObserve(script.grown());
    expect(toTown(applyFrame(a, patch(a, b) as never), NOW)).toEqual(toTown(b, NOW));
    expect(toTown(applyFrame(b, patch(b, a) as never), NOW)).toEqual(toTown(a, NOW));
  });

  it("tolerates unknown kinds and enum values", () => {
    const s = toObserve(script.quiet);
    expect(frameEvents(s, frame("something.new", {}))).toEqual([]);
    const odd = { ...s, senators: s.senators.map((x) => ({ ...x, state: "levitating", runtime: "zed" })) } as unknown as ObserveState;
    expect(toTown(odd).committees[0]!.senators[0]).toMatchObject({ mood: "idle", runtime: "other" });
  });

  it("maps tools, signatures (found by approval id) and releases", () => {
    const s = toObserve(script.quiet);
    expect(frameEvents(s, frame("tool.started", { senator_id: "claude-town", tool_kind: "command", call_id: "c", session_id: "s" }))).toEqual([{ kind: "tool", senator: "claude-town", tool: "bash" }]);
    expect(frameEvents(s, frame("tool.started", { senator_id: "x", tool_kind: "mcp:senate" }))[0]).toMatchObject({ tool: "mcp" });
    expect(frameEvents(s, frame("approval.decided", { id: "approval-0", decision: "allowed", tool_kind: "command" }))).toEqual([{ kind: "signed", senator: "claude-app" }]);
    expect(frameEvents(s, frame("approval.decided", { id: "approval-0", decision: "denied", tool_kind: "command" }))).toEqual([]);
    expect(frameEvents(s, frame("message.routed", { route_id: "r", phase: "released", seq: "9" }, "docs", 1, "senate://open/v1/thread/docs/9"))[0])
      .toMatchObject({ kind: "release", thread: { committee: "docs", root: 9, link: "senate://open/v1/thread/docs/9" } });
  });
});

describe("feed", () => {
  it("joins a filed message and its hold into one held capsule", () => {
    vi.useFakeTimers();
    const events: TownEvent[] = [];
    const feed = new Feed({ snapshot: () => {}, events: (e) => events.push(...e) });
    feed.snapshot(toObserve(script.quiet));
    feed.frame(frame("message.posted", { seq: "10", message_kind: "question", from: { kind: "senator", id: "claude-docs" }, to: [{ kind: "senator", id: "agy-schema" }], root_seq: "9" }, "docs", 1));
    feed.frame(frame("message.routed", { route_id: "r", phase: "held_for_hook", seq: "10", target: { kind: "senator", id: "agy-schema" }, reason: "paused" }, "docs", 2));
    vi.advanceTimersByTime(1000);
    expect(events).toEqual([expect.objectContaining({ kind: "message", from: "claude-docs", to: "agy-schema", held: "paused" })]);
    vi.useRealTimers();
  });

  it("never animates a retried frame twice", () => {
    const events: TownEvent[] = [];
    const feed = new Feed({ snapshot: () => {}, events: (e) => events.push(...e) });
    feed.snapshot(toObserve(script.quiet));
    const f = frame("tool.started", { senator_id: "claude-town", tool_kind: "edit" }, undefined, 7);
    feed.frame(f);
    feed.frame(f);
    expect(events).toHaveLength(1);
  });

  it("hands the scene a new town on each patch", () => {
    const states: TownState[] = [];
    const feed = new Feed({ snapshot: (s) => states.push(s), events: () => {} });
    const a = toObserve(script.quiet);
    feed.snapshot(a);
    feed.frame(patch(a, toObserve(script.grown())));
    expect(states.at(-1)!.committees.map((c) => c.name)).toContain("release-train");
  });

  it("signs an approval whose row the same decision's patch removes", () => {
    const events: TownEvent[] = [];
    const feed = new Feed({ snapshot: () => {}, events: (e) => events.push(...e) });
    const a = toObserve(script.quiet);
    feed.snapshot(a);
    feed.frame(frame("approval.decided", { id: "approval-0", decision: "allowed", tool_kind: "command" }, undefined, 1));
    feed.frame(patch(a, { ...a, approvals: [] }, 2));
    expect(events).toEqual([{ kind: "signed", senator: "claude-app" }]);
  });
});

describe("recordings", () => {
  it("the scripted day is written in the observe recording format, with valid cursors", () => {
    const text = ndjson(recording(script.quiet, script.busy));
    const { header, rows } = parseRecording(text);
    expect(header.format).toBe("senate-observe-recording");
    expect(rows.at(-1)).toMatchObject({ type: "end" });
    const frames = rows.flatMap((r) => (r.type === "frame" ? [r.data] : []));
    expect(frames.map((f) => f.kind)).toEqual(expect.arrayContaining(["message.posted", "message.routed", "tool.started", "approval.decided", "state.patch", "thread.state_changed"]));
    for (const f of frames) expect(f.cursor).toMatch(/^[A-Za-z0-9_-]{21}[AQgw]$/);
  });

  it("drops a truncated last line, refuses a foreign file", () => {
    const text = ndjson(recording(script.quiet, script.busy));
    expect(() => parseRecording(text.slice(0, -10))).not.toThrow();
    expect(() => parseRecording('{"format":"other","version":1}\n{}')).toThrow();
  });
});

describe("host", () => {
  function pair() {
    const { port1, port2 } = new MessageChannel();
    const sent: Record<string, unknown>[] = [];
    const got: string[] = [];
    port2.onmessage = (e) => {
      const m = e.data as { type: string; request_id?: string };
      sent.push(m);
      if (m.type === "ready") port2.postMessage({ host_version: 1, type: "result", request_id: m.request_id, data: { ok: true, value: { version: 1, capabilities: [] } } });
      if (m.type === "storage.set") port2.postMessage({ host_version: 1, type: "result", request_id: m.request_id, data: { ok: false, code: "quota" } });
      if (m.type === "open") port2.postMessage({ host_version: 1, type: "result", request_id: m.request_id, data: { ok: true } });
    };
    const binding: Binding = { name: "local", port: port1 as unknown as Binding["port"] };
    const host = connect(binding, {
      status: (s) => got.push(`status:${s}`), snapshot: () => got.push("snapshot"), event: (f) => got.push(`event:${f.kind}`), environment: () => got.push("env"),
    });
    const say = (m: Record<string, unknown>) => port2.postMessage({ host_version: 1, ...m });
    return { sent, got, host, say, close: () => { port1.close(); port2.close(); } };
  }
  const tick = () => new Promise((r) => setTimeout(r, 20));

  it("asks ready, then dispatches what the shell sends", async () => {
    const p = pair();
    await p.host;
    expect(p.sent[0]).toMatchObject({ host_version: 1, type: "ready", data: { supported_host_versions: [1] } });
    p.say({ type: "status", data: { state: "ready" } });
    p.say({ type: "observe.event", data: { frame: frame("message.posted", {}) } });
    p.say({ type: "mystery", data: {} });
    await tick();
    expect(p.got).toEqual(["status:ready", "event:message.posted"]);
    p.close();
  });

  it("takes results, refuses bad links", async () => {
    const p = pair();
    const host = await p.host;
    await expect(host.storageSet("look", { hat: 1 })).resolves.toBe(false);
    host.open("https://example.com");
    host.open("senate://open/v1/committee/senate");
    await tick();
    expect(p.sent.filter((m) => m.type === "open").map((m) => m.data)).toEqual([{ url: "senate://open/v1/committee/senate" }]);
    p.close();
  });
});
