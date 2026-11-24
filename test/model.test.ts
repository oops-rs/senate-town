import { describe, expect, test } from "vitest";
import { activityEvents, diff, firstWords, hash, senatorId, type Senator, type TownState } from "../src/model.ts";

const s = (id: string, mood: Senator["mood"] = "idle"): Senator => ({ id, name: id, runtime: "claude", mood });
const town = (senators: Senator[]): TownState => ({ committees: [{ name: "c", senators }] });

describe("diff", () => {
  test("the first reading is quiet", () => {
    expect(diff(undefined, town([s("a"), s("b", "working")]))).toEqual([]);
  });
  test("moods, arrivals and departures", () => {
    expect(diff(town([s("a"), s("b", "working")]), town([s("a", "working"), s("c")]))).toEqual([
      { kind: "mood", senator: "a", mood: "working" },
      { kind: "arrived", senator: "c" },
      { kind: "left", senator: "b" },
    ]);
  });
  test("a session stopping leaves town; starting again comes back", () => {
    expect(diff(town([s("a", "working"), s("b", "stopped")]), town([s("a", "stopped"), s("b"), s("c", "stopped")]))).toEqual([
      { kind: "left", senator: "a" },
      { kind: "arrived", senator: "b" },
    ]);
  });
});

describe("activity", () => {
  const entry = (kind: string, over: Partial<Parameters<typeof activityEvents>[0][number]> = {}) => ({
    committee: "c", seq: 9, kind, from: "/s::c::senator::a", to: ["/s::c::senator::b"], thread: 7, line: "hello there", ...over,
  });
  const t = { committee: "c", root: 7, title: "hello there" };
  test("what is said is a visit from its real author", () => {
    expect(activityEvents([entry("answer")])).toEqual([{ kind: "message", from: "a", to: "b", thread: t, line: "hello there" }]);
    expect(activityEvents([entry("question", { from: "speaker", onBehalfOf: "senator::z" })])).toEqual([
      { kind: "message", from: "z", to: "b", thread: t, line: "hello there" },
    ]);
    expect(activityEvents([entry("question", { to: [], thread: undefined })])).toEqual([
      { kind: "message", from: "a", to: undefined, thread: { ...t, root: 9 }, line: "hello there" },
    ]);
  });
  test("a settled status is settled; other kinds are nothing", () => {
    expect(activityEvents([entry("status", { state: "active" })])).toEqual([{ kind: "answered", thread: t, a: "a", b: "b" }]);
    expect(activityEvents([entry("status", { state: "processing" })])).toEqual([]);
    expect(activityEvents([entry("joined", { state: "unknown" }), entry("left", { state: "away" })])).toEqual([]);
    expect(activityEvents([entry("note", { to: ["senator::a"] })])).toEqual([]);
  });
  test("entries are acted in log order", () => {
    const events = activityEvents([entry("note", { seq: 20 }), entry("answer", { seq: 10, from: "senator::b", to: ["senator::a"] })]);
    expect(events[0]).toMatchObject({ from: "b" });
  });
});

describe("text", () => {
  test("first words and ids", () => {
    expect(firstWords("Hello there\nsecond line")).toBe("Hello there");
    expect(firstWords("a b c d e f g h")).toBe("a b c d e f…");
    expect([...firstWords("x".repeat(50))].length).toBe(34);
    expect(senatorId("[senator::claude-1]")).toBe("claude-1");
    expect(senatorId("office::secretary")).toBe("secretary");
    expect(senatorId("codex-2")).toBe("codex-2");
  });
  test("the hash is FNV-1a, the same as the Swift town's", () => {
    expect(hash("")).toBe(0xcbf29ce484222325n);
    expect(hash("a")).toBe(0xaf63dc4c8601ec8cn);
  });
});
