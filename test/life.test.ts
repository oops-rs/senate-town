import { describe, expect, it } from "vitest";
import { Grid } from "../src/nav.ts";
import { lightAt, seasonOf, streetLife, weatherOf } from "../src/world.ts";

describe("nav", () => {
  const grid = new Grid({ x: 0, y: 0, w: 400, h: 400 }, 20);
  grid.block({ x: 100, y: 0, w: 40, h: 320 }); // a wall with a gap at the bottom

  it("walks round a building, never through it", () => {
    const path = grid.path({ x: 30, y: 30 }, { x: 300, y: 30 })!;
    expect(path).toBeDefined();
    for (let i = 1; i < path.length; i++) expect(grid.clear(path[i - 1]!, path[i]!)).toBe(true);
    expect(Math.max(...path.map((p) => p.y))).toBeGreaterThan(320);
  });

  it("goes straight when it can, and finds the nearest walkable spot", () => {
    expect(grid.path({ x: 30, y: 30 }, { x: 30, y: 300 })).toHaveLength(2);
    const near = grid.nearestWalkable({ x: 120, y: 100 })!;
    expect(grid.walkable(near)).toBe(true);
  });

  it("gives up when there is no way", () => {
    const shut = new Grid({ x: 0, y: 0, w: 200, h: 200 }, 20);
    shut.block({ x: 90, y: 0, w: 20, h: 200 });
    expect(shut.path({ x: 20, y: 20 }, { x: 180, y: 20 })).toBeUndefined();
  });
});

describe("world", () => {
  it("is the same weather all day for everyone, and varies across days", () => {
    const a = weatherOf(new Date(2026, 10, 25, 11)), b = weatherOf(new Date(2026, 10, 25, 15));
    expect(a).toBe(b);
    const days = new Set(Array.from({ length: 60 }, (_, i) => weatherOf(new Date(2026, 0, 1 + i, 12))));
    expect(days.size).toBeGreaterThan(2);
  });

  it("fog lifts by ten", () => {
    for (let i = 0; i < 200; i++) expect(weatherOf(new Date(2026, 0, 1 + i, 11))).not.toBe("fog");
  });

  it("seasons by month; light moves smoothly; nights are quiet", () => {
    expect([0, 3, 6, 9].map((m) => seasonOf(new Date(2026, m, 1)))).toEqual(["winter", "spring", "summer", "autumn"]);
    expect(lightAt(new Date(2026, 5, 1, 12), false).alpha).toBe(0);
    const a = lightAt(new Date(2026, 5, 1, 17, 30), false).alpha, b = lightAt(new Date(2026, 5, 1, 17, 40), false).alpha;
    expect(Math.abs(a - b)).toBeLessThan(0.05);
    expect(lightAt(new Date(2026, 5, 1, 23), false).lamps).toBe(true);
    expect(streetLife(new Date(2026, 5, 1, 3), false)).toBeLessThan(0.25);
    expect(streetLife(new Date(2026, 5, 1, 13), false)).toBe(1);
  });
});
