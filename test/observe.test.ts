import { describe, expect, it, vi } from "vitest";
import { diffPatch, ndjson, recording, toObserve } from "../src/encode.ts";
import { Feed } from "../src/feed.ts";
import { connect, type Binding, type Message } from "../src/host.ts";
import type { TownEvent, TownState } from "../src/model.ts";
import { applyPatch, frameEvents, toTown, type Frame } from "../src/observe.ts";
import * as script from "../src/script.ts";
import { parseRecording } from "../src/shell.ts";

const frame = (kind: string, data: Record<string, unknown>, committee_id?: string, cursor = kind): Frame =>
  ({ schema_version: 1, cursor, at: "2026-11-25T10:00:00Z", kind, committee_id, data });

describe("observe → town", () => {
  const town = toTown(toObserve(script.quiet), Date.parse("2026-11-25T10:00:00Z"));

  it("keeps committees, senators, moods, chairs, cards and links", () => {
    expect(town.committees.map((c) => c.name)).toEqual(script.quiet.committees.map((c) => c.name));
    for (const c of script.quiet.committees) {
      const got = town.committees.find((x) => x.name === c.name)!;
      expect(got.link).toBe(`senate://open/v1/committee/${encodeURIComponent(c.name)}`);
      expect(got.card).toEqual(c.card);
      for (const s of c.senators) {
        const g = got.senators.find((x) => x.id === s.id)!;
        expect([g.mood, g.chair, g.runtime, g.card]).toEqual([s.mood === "stopped" ? "idle" : s.mood, s.chair, s.runtime, s.card]);
        expect(g.link).toMatch(/^senate:\/\/open\/v1\/senator\/.+%3A%3A/);
      }
    }
  });

  it("brings elders, archived houses, approvals, the Secretary and the docket", () => {
    expect(town.elders!.map((e) => e.id)).toEqual(script.quiet.elders!.map((e) => e.id));
    expect(Math.round(town.elders![0]!.idle)).toBe(script.quiet.elders![0]!.idle);
    expect(town.archived!.map((a) => a.name)).toEqual(script.quiet.archived!.map((a) => a.name));
    expect(town.approvals!.map((a) => a.senator)).toEqual(script.quiet.approvals!.map((a) => a.senator));
    expect(town.hall?.secretary?.id).toBe(script.quiet.hall?.secretary?.id);
    expect(town.hall?.docket).toBe(script.quiet.hall?.docket);
    expect(town.navigation?.approvals).toBe("senate://open/v1/approvals");
  });

  it("patches rebuild the same state as a fresh snapshot", () => {
    const a = toObserve(script.quiet), b = toObserve(script.grown());
    const patched = applyPatch(a, diffPatch(a, b));
    const now = Date.parse("2026-11-25T10:00:00Z"); // elders' ages are counted from now: one clock for both
    expect(toTown(patched, now)).toEqual(toTown(b, now));
    expect(toTown(applyPatch(b, diffPatch(b, a)), now)).toEqual(toTown(a, now));
  });

  it("tolerates unknown kinds and enum values", () => {
    const s = toObserve(script.quiet);
    expect(frameEvents(s, frame("something.new", {}))).toEqual([]);
    const odd = { ...s, senators: s.senators.map((x) => ({ ...x, state: "levitating", runtime: "zed" })) };
    expect(toTown(odd).committees[0]!.senators[0]).toMatchObject({ mood: "idle", runtime: "other" });
  });

  it("maps tools, signatures and releases", () => {
    const s = toObserve(script.quiet);
    expect(frameEvents(s, frame("tool.started", { senator_id: "claude-town", tool: "command" }))).toEqual([{ kind: "tool", senator: "claude-town", tool: "bash" }]);
    expect(frameEvents(s, frame("tool.started", { senator_id: "x", tool: "mcp:senate" }))[0]).toMatchObject({ tool: "mcp" });
    expect(frameEvents(s, frame("approval.decided", { senator_id: "claude-app", outcome: "denied" }))).toEqual([]);
    expect(frameEvents(s, frame("message.routed", { phase: "released", seq: "10", root_seq: "9" }, "docs"))[0]).toMatchObject({ kind: "release", thread: { committee: "docs", root: 9 } });
  });
});

describe("feed", () => {
  it("joins a filed message and its hold into one held capsule", () => {
    vi.useFakeTimers();
    const events: TownEvent[] = [];
    const feed = new Feed({ snapshot: () => {}, events: (e) => events.push(...e) });
    feed.snapshot(toObserve(script.quiet));
    feed.frame(frame("message.posted", { seq: "10", from: { kind: "senator", id: "claude-docs" }, to: [{ kind: "senator", id: "agy-schema" }], root_seq: "9" }, "docs", "c1"));
    feed.frame(frame("message.routed", { phase: "held_for_hook", seq: "10", target: { kind: "senator", id: "agy-schema" }, reason: "paused" }, "docs", "c2"));
    vi.advanceTimersByTime(1000);
    expect(events).toEqual([expect.objectContaining({ kind: "message", from: "claude-docs", to: "agy-schema", held: "paused" })]);
    vi.useRealTimers();
  });

  it("never animates a retried frame twice", () => {
    vi.useFakeTimers();
    const events: TownEvent[] = [];
    const feed = new Feed({ snapshot: () => {}, events: (e) => events.push(...e) });
    feed.snapshot(toObserve(script.quiet));
    const f = frame("tool.started", { senator_id: "claude-town", tool: "edit" }, undefined, "same");
    feed.frame(f);
    feed.frame(f);
    expect(events).toHaveLength(1);
    vi.useRealTimers();
  });

  it("hands the scene a new town on each patch", () => {
    const states: TownState[] = [];
    const feed = new Feed({ snapshot: (s) => states.push(s), events: () => {} });
    const a = toObserve(script.quiet);
    feed.snapshot(a);
    feed.frame(frame("state.patch", diffPatch(a, toObserve(script.grown())), undefined, "p1"));
    expect(states.at(-1)!.committees.map((c) => c.name)).toContain("release-train");
  });
});

describe("recordings", () => {
  it("the scripted day round-trips through the observe recording format", () => {
    const text = ndjson(recording(script.quiet, script.busy));
    const { header, rows } = parseRecording(text);
    expect(header.format).toBe("senate-observe-recording");
    expect(rows.at(-1)).toHaveProperty("end", true);
    const kinds = rows.flatMap((r) => ("frame" in r ? [r.frame.kind] : []));
    expect(kinds).toEqual(expect.arrayContaining(["message.posted", "message.routed", "tool.started", "approval.decided", "state.patch", "thread.state_changed"]));
  });

  it("drops a truncated last line, refuses a foreign file", () => {
    const text = ndjson(recording(script.quiet, script.busy));
    expect(() => parseRecording(text.slice(0, -40))).not.toThrow();
    expect(() => parseRecording('{"format":"other","version":1}\n{}')).toThrow();
  });
});

describe("host", () => {
  function pair() {
    const sent: Message[] = [];
    let deliver: (m: Message) => void = () => {};
    const binding: Binding = { name: "local", send: (m) => sent.push(m), listen: (r) => { deliver = r; } };
    const got: string[] = [];
    const host = connect(binding, {
      status: (s) => got.push(`status:${s}`), snapshot: () => got.push("snapshot"), event: (f) => got.push(`event:${f.kind}`), environment: () => got.push("env"),
    });
    return { sent, deliver: (m: Omit<Message, "host_version">) => deliver({ host_version: 1, ...m }), got, host };
  }

  it("says ready, dispatches shell messages, ignores unknown ones", () => {
    const p = pair();
    expect(p.sent[0]).toEqual({ host_version: 1, type: "ready", data: { supported_host_versions: [1] } });
    p.deliver({ type: "status", data: { state: "ready" } });
    p.deliver({ type: "observe.event", data: { frame: frame("message.posted", {}) } });
    p.deliver({ type: "mystery", data: {} });
    expect(p.got).toEqual(["status:ready", "event:message.posted"]);
  });

  it("correlates requests with results and checks keys and links", async () => {
    const p = pair();
    const r = p.host.storageSet("look", { hat: 1 });
    const req = p.sent.at(-1)!;
    expect(req).toMatchObject({ type: "storage.set", data: { key: "look", value: { hat: 1 } } });
    p.deliver({ type: "result", request_id: req.request_id, data: { ok: false, code: "quota" } });
    await expect(r).resolves.toEqual({ ok: false, code: "quota" });
    await expect(p.host.storageSet("bad key/", 1)).resolves.toEqual({ ok: false, code: "invalid_request" });
    p.host.open("https://example.com");
    p.host.open("senate://open/v1/committee/senate");
    expect(p.sent.filter((m) => m.type === "open")).toEqual([{ host_version: 1, type: "open", data: { url: "senate://open/v1/committee/senate" } }]);
  });
});
