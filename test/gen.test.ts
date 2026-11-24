import { describe, expect, test } from "vitest";
import { generateHouse, generateLook, houseKey, houses, lookKey, readHouse, readLook } from "../src/gen.ts";

const names = (n: number) => Array.from({ length: n }, (_, i) => `committee-${i}`);

describe("houses", () => {
  test("a house is the same on every launch", () => {
    expect(generateHouse("ledger")).toEqual(generateHouse("ledger"));
  });
  test("no two houses in a town of thirty look the same", () => {
    const all = houses(names(30));
    expect(new Set([...all.values()].map(houseKey)).size).toBe(30);
  });
  test("even two committees asking for the same blueprint differ", () => {
    const card = { roof: "dome", material: "brick", wall: 3 };
    const all = houses(["a", "b"], new Map([["a", card], ["b", card]]));
    expect(houseKey(all.get("a")!)).not.toBe(houseKey(all.get("b")!));
    expect(all.get("a")!.roof).toBe("dome");
  });
  test("a card is read strictly: unknown values fall back, junk is ignored", () => {
    const base = generateHouse("x");
    const read = readHouse({ roof: "dome", wall: 2, landmark: "windmill", door: "<script>", wall2: 1, storeys: 7, plants: ["cone", "nope"] }, base);
    expect(read.roof).toBe("dome");
    expect(read.wall).toBe(2);
    expect(read.landmark).toBe("windmill");
    expect(read.door).toBe(base.door);
    expect(read.storeys).toBe(base.storeys);
    expect(read.plants).toEqual(["cone", base.plants[1]]);
    expect(Object.keys(read)).not.toContain("wall2");
    for (const junk of [null, "roof", 42, [1, 2], { roof: "x".repeat(5000) }]) expect(readHouse(junk, base)).toEqual(base);
  });
});

describe("characters", () => {
  test("a look is the same on every launch and differs between senators", () => {
    expect(generateLook("claude-1")).toEqual(generateLook("claude-1"));
    const looks = new Set(Array.from({ length: 60 }, (_, i) => lookKey(generateLook(`s${i}`))));
    expect(looks.size).toBeGreaterThan(55);
  });
  test("a look's card is read strictly", () => {
    const base = generateLook("s");
    const read = readLook({ hat: "top", accessory: "glasses", skin: 9, walk: "teleport" }, base);
    expect(read.hat).toBe("top");
    expect(read.accessory).toBe("glasses");
    expect(read.skin).toBe(base.skin);
    expect(read.walk).toBe(base.walk);
  });
});
