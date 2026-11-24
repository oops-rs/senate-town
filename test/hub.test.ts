import { describe, expect, test } from "vitest";
import { along, bounds, capacity, HALL_R, plan, port, signalAt, tube, WORKSHOP } from "../src/hub.ts";

const names = (n: number) => Array.from({ length: n }, (_, i) => `committee-${i}`);
const box = (at: { x: number; y: number }) => ({ x: at.x - WORKSHOP.w / 2, y: at.y - WORKSHOP.h / 2, w: WORKSHOP.w, h: WORKSHOP.h });
const overlaps = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("hub and ring", () => {
  test("the same names give the same town whatever their order", () => {
    const a = plan(names(30)), b = plan(names(30).reverse());
    expect([...a.slots].sort()).toEqual([...b.slots].sort());
  });
  test("five fill the first ring; thirty take two", () => {
    expect(new Set([...plan(names(5)).slots.values()].map((s) => s.ring))).toEqual(new Set([0]));
    const rings = [...plan(names(30)).slots.values()].map((s) => s.ring);
    expect(Math.max(...rings)).toBe(1);
    expect(rings.filter((r) => r === 0)).toHaveLength(capacity(0));
  });
  test("no two workshops overlap, and none overlaps the civic centre", () => {
    for (const n of [1, 5, 12, 30]) {
      const p = plan(names(n));
      const shops = [...p.slots.values()].map((s) => box(s.at));
      for (let i = 0; i < shops.length; i++) {
        for (let j = i + 1; j < shops.length; j++) expect(overlaps(shops[i]!, shops[j]!)).toBe(false);
        for (const c of [p.civic.archive, p.civic.townHall]) expect(overlaps(shops[i]!, box(c))).toBe(false);
        expect(Math.hypot(p.slots.size ? [...p.slots.values()][i]!.at.x : 0, [...p.slots.values()][i]!.at.y)).toBeGreaterThan(HALL_R + WORKSHOP.w);
      }
      // No tube crosses the archive, the town hall or the uplink north of the hall.
      for (const s of p.slots.values()) {
        const t = tube(s);
        for (let k = 0; k <= 40; k++) {
          const q = along(t, k / 40);
          for (const c of [p.civic.archive, p.civic.townHall]) {
            expect(Math.abs(q.x - c.x) < 78 && Math.abs(q.y - c.y) < 66).toBe(false);
          }
          if (q.y < -HALL_R - 10) expect(Math.abs(q.x)).toBeGreaterThan(20);
        }
      }
    }
  });
  test("a new committee builds on an empty lot; nobody moves", () => {
    const before = plan(names(12)), after = plan([...names(12), "newcomer"], before.slots);
    for (const [n, s] of before.slots) expect(after.slots.get(n)).toEqual(s);
    expect(before.empty.some((e) => e.at.x === after.slots.get("newcomer")!.at.x && e.at.y === after.slots.get("newcomer")!.at.y)).toBe(true);
    expect(after.empty).toHaveLength(before.empty.length - 1);
  });
  test("a fresh plan of the same names is the same town", () => {
    const a = plan(names(20)), b = plan(names(20), a.slots);
    expect([...b.slots].sort()).toEqual([...a.slots].sort());
  });
  test("a tube runs from the workshop's edge facing the hub to the hall's rim", () => {
    const p = plan(names(8));
    for (const s of p.slots.values()) {
      const t = tube(s);
      expect(t[0]).toEqual(port(s));
      expect(Math.hypot(t[2]!.x, t[2]!.y)).toBeCloseTo(HALL_R, 5);
      // Monotonically closer to the hub.
      let last = Infinity;
      for (let k = 0; k <= 10; k++) {
        const q = along(t, k / 10);
        const d = Math.hypot(q.x, q.y);
        expect(d).toBeLessThanOrEqual(last + 1e-6);
        last = d;
      }
      const sig = signalAt(s);
      expect(Math.hypot(sig.x, sig.y)).toBeLessThan(Math.hypot(t[0]!.x, t[0]!.y));
    }
  });
  test("everything is inside the bounds; a small town is compact", () => {
    for (const n of [5, 30]) {
      const p = plan(names(n));
      const b = bounds(p);
      const pts = [...[...p.slots.values()].map((s) => s.at), p.civic.memory, p.civic.monuments, p.civic.gate, p.civic.parent, ...p.civic.children];
      for (const q of pts) {
        expect(q.x).toBeGreaterThanOrEqual(b.x);
        expect(q.x).toBeLessThanOrEqual(b.x + b.w);
        expect(q.y).toBeGreaterThanOrEqual(b.y);
        expect(q.y).toBeLessThanOrEqual(b.y + b.h);
      }
    }
    expect(bounds(plan(names(5))).w).toBeLessThan(bounds(plan(names(30))).w);
  });
});
