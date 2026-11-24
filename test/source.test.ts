import { describe, expect, test } from "vitest";
import { scriptedRecording } from "../src/source.ts";

describe("recordings", () => {
  test("the scripted day as a recording: a snapshot, then steps in time order, a committee appearing", () => {
    const rec = scriptedRecording("small");
    expect(rec.version).toBe(1);
    expect(rec.snapshot.committees.length).toBe(5);
    const ats = rec.steps.map((s) => s.at);
    expect(ats).toEqual([...ats].sort((a, b) => a - b));
    expect(rec.steps.some((s) => s.state && s.state.committees.length === 6)).toBe(true);
    expect(rec.loop).toBeGreaterThan(ats.at(-1)!);
    // It survives a round trip through JSON (what a file is).
    expect(JSON.parse(JSON.stringify(rec))).toEqual(rec);
  });
});
