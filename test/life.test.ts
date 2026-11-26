import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Phaser from "phaser";
import { Grid } from "../src/nav.ts";
import { lightAt, seasonOf, streetLife, weatherOf } from "../src/world.ts";

vi.mock("phaser", () => ({
  default: { Textures: { FilterMode: { NEAREST: 0 } } },
}));

const { Life } = await import("../src/life.ts");
const { Person } = await import("../src/people.ts");
const { generateLook } = await import("../src/gen.ts");

interface MockSprite {
  x: number;
  y: number;
  frame: string;
  flipX: boolean;
  alpha: number;
  depth: number;
  visible: boolean;
  scale: number;
  setOrigin(): MockSprite;
  setScale(s: number): MockSprite;
  setDepth(d: number): MockSprite;
  setFrame(f: string): MockSprite;
  setFlipX(f: boolean): MockSprite;
  setAlpha(a: number): MockSprite;
  setVisible(v: boolean): MockSprite;
  setPosition(x: number, y: number): MockSprite;
  destroy(): void;
}

function makeScene(): Phaser.Scene {
  const textures = new Set<string>();
  const fakeTex = { setFilter() { return fakeTex; }, add() {} };
  return {
    textures: {
      exists: (k: string) => textures.has(k),
      addCanvas: (k: string) => { textures.add(k); return fakeTex; },
    },
    add: {
      image(x: number, y: number, _texture: string, frame?: string) {
        const img: MockSprite = {
          x, y, frame: frame ?? "", flipX: false, alpha: 1, depth: 0, visible: true, scale: 1,
          setOrigin() { return img; },
          setScale(s: number) { img.scale = s; return img; },
          setDepth(d: number) { img.depth = d; return img; },
          setFrame(f: string) { img.frame = f; return img; },
          setFlipX(f: boolean) { img.flipX = f; return img; },
          setAlpha(a: number) { img.alpha = a; return img; },
          setVisible(v: boolean) { img.visible = v; return img; },
          setPosition(nx: number, ny: number) { img.x = nx; img.y = ny; return img; },
          destroy() {},
        };
        return img;
      },
    },
  } as unknown as Phaser.Scene;
}

function facingOf(sprite: MockSprite): string {
  const part = sprite.frame.includes("|") ? sprite.frame.split("|")[1]! : sprite.frame;
  if (part.startsWith("walk-down")) return "down";
  if (part.startsWith("walk-up") || part === "up") return "up";
  if (part.startsWith("walk-side") || part === "side") return sprite.flipX ? "left" : "right";
  return part;
}

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

describe("life crowd movement", () => {
  const origDocument = globalThis.document;
  const origNow = performance.now.bind(performance);
  let simNow = 1000;

  beforeEach(() => {
    simNow = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => simNow);
    const ctx = {
      imageSmoothingEnabled: false,
      fillStyle: "",
      fillRect() {},
    };
    (globalThis as { document: unknown }).document = {
      createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    performance.now = origNow;
    (globalThis as { document: unknown }).document = origDocument;
  });

  function makeLife(grid = new Grid({ x: -200, y: -200, w: 400, h: 400 }, 16)) {
    const scene = makeScene();
    const places = {
      benches: [{ x: 80, y: 0 }],
      spots: [{ x: 0, y: 0 }, { x: 80, y: 0 }],
      homes: [{ x: 100, y: 100 }],
      shelters: [{ x: 40, y: 40 }],
      gardens: [],
    };
    const life = new Life(scene, grid, places, () => [], false);
    return { life, scene, grid };
  }

  it("does not spin in place or drag a stationary villager when walking to an occupied spot", () => {
    const { life, scene } = makeLife();
    const target = { x: 60, y: 0 };
    const walker = new Person(scene, { x: 0, y: 0 }, generateLook("a"), 0x6e85a3, { gait: "stroll" });
    const sitter = new Person(scene, { x: 60.5, y: 0.2 }, generateLook("b"), 0xb59c72, { gait: "stroll" });
    sitter.sit();
    life.civilians.push(
      { p: walker, plan: "going", until: 999_999, child: false, rnd: () => 0.5 },
      { p: sitter, plan: "sitting", until: 999_999, child: false, rnd: () => 0.5 },
    );
    let arrived = false;
    walker.walk([{ x: 0, y: 0 }, target], () => { arrived = true; }, "stroll");

    const view = { x: -200, y: -200, w: 400, h: 400 };
    const faces: string[] = [];
    for (let f = 0; f < 180; f++) {
      simNow += 1000 / 30;
      life.update(1 / 30, simNow, view);
      faces.push(facingOf(walker.sprite as unknown as MockSprite));
    }

    expect(arrived).toBe(true);
    expect(walker.moving).toBe(false);
    expect(Math.hypot(walker.x - target.x, walker.y - target.y)).toBeLessThan(1.5);
    // Stationary sitter never drifted off its bench.
    expect(sitter.x).toBe(60.5);
    expect(sitter.y).toBe(0.2);
    // Walker faced right throughout its horizontal walk instead of cycling directions.
    const dirChanges = faces.filter((f, i) => i > 0 && f !== faces[i - 1] && ["up", "down", "left", "right"].includes(f) && ["up", "down", "left", "right"].includes(faces[i - 1]!)).length;
    expect(dirChanges).toBe(0);
  });

  it("arrives cleanly when multiple villagers converge on the same shelter without orbiting", () => {
    const { life, scene } = makeLife();
    const shelter = { x: 50, y: 50 };
    const starts = [{ x: 10, y: 50 }, { x: 90, y: 50 }, { x: 50, y: 10 }, { x: 50, y: 90 }];
    const arrived = starts.map(() => false);
    const turnCounts = starts.map(() => 0);
    const prevFace = starts.map(() => "");

    starts.forEach((pt, i) => {
      const p = new Person(scene, pt, generateLook(`s-${i}`), 0x6e85a3, { gait: "stroll" });
      p.walk([pt, shelter], () => { arrived[i] = true; }, "stroll");
      life.civilians.push({ p, plan: "going", until: 999_999, child: false, rnd: () => 0.5 });
    });

    const view = { x: -200, y: -200, w: 400, h: 400 };
    for (let f = 0; f < 240; f++) {
      simNow += 1000 / 30;
      life.update(1 / 30, simNow, view);
      life.civilians.forEach((c, i) => {
        const face = facingOf(c.p.sprite as unknown as MockSprite);
        if (prevFace[i] && face !== prevFace[i] && ["up", "down", "left", "right"].includes(face) && ["up", "down", "left", "right"].includes(prevFace[i]!)) {
          turnCounts[i]!++;
        }
        prevFace[i] = face;
      });
    }

    expect(arrived).toEqual([true, true, true, true]);
    for (const turns of turnCounts) expect(turns).toBeLessThanOrEqual(2);
  });

  it("preserves passing separation, corner turning, facing, and stationary idle behavior", () => {
    const grid = new Grid({ x: -200, y: -200, w: 400, h: 400 }, 16);
    const { life, scene } = makeLife(grid);
    // Two offset villagers passing each other mid-street gently separate radially and both arrive.
    const a = new Person(scene, { x: -80, y: -2 }, generateLook("p1"), 0x6e85a3, { gait: "walk" });
    const b = new Person(scene, { x: 80, y: 2 }, generateLook("p2"), 0xb59c72, { gait: "walk" });
    const stander = new Person(scene, { x: -120, y: 80 }, generateLook("idle"), 0x629684, { gait: "stroll" });
    let aDone = false, bDone = false;
    a.walk([{ x: -80, y: -2 }, { x: 80, y: -2 }], () => { aDone = true; }, "walk");
    b.walk([{ x: 80, y: 2 }, { x: -80, y: 2 }], () => { bDone = true; }, "walk");
    life.civilians.push(
      { p: a, plan: "going", until: 999_999, child: false, rnd: () => 0.5 },
      { p: b, plan: "going", until: 999_999, child: false, rnd: () => 0.5 },
      { p: stander, plan: "waiting", until: 999_999, child: false, rnd: () => 0.5 },
    );

    const view = { x: -200, y: -200, w: 400, h: 400 };
    let maxVertSep = 0;
    const idleFrames = new Set<string>();
    for (let f = 0; f < 240; f++) {
      simNow += 1000 / 30;
      life.update(1 / 30, simNow, view);
      if (Math.abs(a.x - b.x) < 14) maxVertSep = Math.max(maxVertSep, Math.abs(a.y - b.y));
      idleFrames.add((stander.sprite as unknown as MockSprite).frame.split("|")[1]!);
    }

    expect(aDone && bDone).toBe(true);
    expect(maxVertSep).toBeGreaterThan(4); // nudged slightly apart beyond their initial 4px y-offset
    expect(stander.x).toBe(-120);
    expect(stander.y).toBe(80);
    expect(idleFrames.size).toBeGreaterThan(1); // still breathes/glances while stationary

    // Turning around a corner still changes direction cleanly.
    const turner = new Person(scene, { x: 0, y: 0 }, generateLook("turn"), 0x6e85a3, { gait: "walk" });
    const seen = new Set<string>();
    turner.walk([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }], undefined, "walk");
    for (let f = 0; f < 120; f++) {
      simNow += 1000 / 30;
      turner.update(1 / 30, simNow, true);
      seen.add(facingOf(turner.sprite as unknown as MockSprite));
    }
    expect(seen.has("right")).toBe(true);
    expect(seen.has("down")).toBe(true);
  });
});
