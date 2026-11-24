import { describe, expect, test } from "vitest";
import { Director } from "../src/director.ts";
import type { TownEvent } from "../src/model.ts";

const ref = (root = 1) => ({ committee: "c", root, title: "t" });
const message = (from: string, to?: string, root = 1): TownEvent => ({ kind: "message", from, to, thread: ref(root), line: "one two three" });

describe("director", () => {
  test("visits are capped, one per senator", () => {
    const d = new Director(2);
    const now = d.accept([message("a", "b", 1), message("a", "c", 2), message("b", "a", 3), message("c", "d", 4)], new Set(["a", "b", "c", "d"]), false);
    expect(now).toHaveLength(2);
    expect([...d.out]).toEqual(["a", "b"]);
    expect(d.queue).toHaveLength(2);
    const next = d.cameHome("a");
    expect(next).toEqual([{ kind: "visit", from: "a", to: "c", thread: ref(2), line: "one two three", walk: true }]);
  });
  test("the queue drops the oldest", () => {
    const d = new Director(1, 3);
    d.accept([0, 1, 2, 3, 4, 5].map((i) => message("a", undefined, i)), new Set(["a"]), false);
    expect(d.queue).toHaveLength(3);
    expect(d.queue[0]).toMatchObject({ thread: { root: 3 } });
  });
  test("a mood waits until the walker is home", () => {
    const d = new Director();
    d.accept([message("a", "b")], new Set(["a", "b"]), false);
    expect(d.accept([{ kind: "mood", senator: "a", mood: "working" }, { kind: "mood", senator: "b", mood: "paused" }], new Set(["a", "b"]), false))
      .toEqual([{ kind: "mood", senator: "b", mood: "paused" }]);
    expect(d.cameHome("a")).toEqual([{ kind: "mood", senator: "a", mood: "working" }]);
  });
  test("reduce motion fades at once", () => {
    const d = new Director(1);
    const now = d.accept([message("a", "b"), message("c", "b")], new Set(["a", "b", "c"]), true);
    expect(now.map((a) => a.kind === "visit" && a.walk)).toEqual([false, false]);
    expect(d.out.size).toBe(0);
  });
  test("strangers come as guests; unknown listeners go to the house", () => {
    const d = new Director();
    expect(d.accept([message("ghost", "a")], new Set(["a"]), false)).toHaveLength(1);
    expect(d.out.has("ghost")).toBe(true);
    const now = d.accept([message("a", "ghost")], new Set(["a"]), false);
    expect(now[0]).toMatchObject({ to: undefined });
  });
  test("arrivals walk while there is room, else appear; settled threads need someone present", () => {
    const d = new Director(1);
    expect(d.accept([{ kind: "arrived", senator: "a" }, { kind: "left", senator: "b" }], new Set(["a", "b"]), false)).toEqual([
      { kind: "arrive", senator: "a", walk: true },
      { kind: "depart", senator: "b", walk: false },
    ]);
    expect(d.accept([{ kind: "answered", thread: ref(), a: "x", b: "y" }], new Set(["a"]), false)).toEqual([]);
  });
});
