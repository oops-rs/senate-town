import { describe, expect, test } from "vitest";
import { bounds, capacity, LOT_TILES, plan, TILE, type TileRect } from "../src/layout.ts";

const names = (n: number) => Array.from({ length: n }, (_, i) => `committee-${i}`);
const overlaps = (a: TileRect, b: TileRect) =>
  a.tx < b.tx + b.tw && b.tx < a.tx + a.tw && a.ty < b.ty + b.th && b.ty < a.ty + a.th;

describe("village street-grid layout", () => {
  test("the same names give the same town whatever their order", () => {
    const a = plan(names(30)), b = plan(names(30).reverse());
    expect([...a.slots].sort()).toEqual([...b.slots].sort());
  });

  test("five committees fit in the inner village tier; thirty expand cleanly across tiers", () => {
    const small = plan(names(5));
    expect(new Set([...small.slots.values()].map((s) => s.tier))).toEqual(new Set([0]));
    const big = plan(names(30));
    expect(big.slots.size).toBe(30);
    const tiers = [...big.slots.values()].map((s) => s.tier);
    expect(tiers.filter((t) => t === 0)).toHaveLength(capacity(0));
    expect(Math.max(...tiers)).toBeGreaterThanOrEqual(2);
  });

  test("no two buildings overlap, and none overlaps civic buildings or Town Square", () => {
    for (const n of [1, 5, 12, 30]) {
      const p = plan(names(n));
      const c = p.civic;
      const fixed: TileRect[] = [
        { tx: c.townHall.tx, ty: c.townHall.ty, tw: c.townHall.tw, th: c.townHall.th },
        { tx: c.postOffice.tx, ty: c.postOffice.ty, tw: c.postOffice.tw, th: c.postOffice.th },
        { tx: c.archive.tx, ty: c.archive.ty, tw: c.archive.tw, th: c.archive.th },
        { tx: c.memory.tx, ty: c.memory.ty, tw: c.memory.tw, th: c.memory.th },
        c.monuments,
        ...p.plazas,
        p.river,
      ];
      const lots: TileRect[] = [...p.slots.values()].map((s) => ({ tx: s.tx, ty: s.ty, tw: LOT_TILES.tw, th: LOT_TILES.th }));
      for (let i = 0; i < lots.length; i++) {
        for (let j = i + 1; j < lots.length; j++) expect(overlaps(lots[i]!, lots[j]!)).toBe(false);
        for (const f of fixed) expect(overlaps(lots[i]!, f)).toBe(false);
      }
      // Every committee door sits south of its building footprint on a paved street.
      for (const s of p.slots.values()) {
        expect(s.door.y).toBeGreaterThan(s.at.y);
        const doorTx = Math.floor(s.door.x / TILE);
        const doorTy = Math.floor(s.door.y / TILE);
        const onStreet = p.streets.some((st) => doorTx >= st.tx && doorTx < st.tx + st.tw && doorTy >= st.ty && doorTy < st.ty + st.th);
        expect(onStreet).toBe(true);
      }
    }
  });

  test("a new committee builds on an empty lot; nobody moves", () => {
    const before = plan(names(12));
    const after = plan([...names(12), "newcomer"], before.slots);
    for (const [n, s] of before.slots) expect(after.slots.get(n)).toEqual(s);
    const added = after.slots.get("newcomer")!;
    expect(before.empty.some((e) => e.tx === added.tx && e.ty === added.ty)).toBe(true);
  });

  test("everything is inside the bounds; a small town is much more compact than a large one", () => {
    for (const n of [1, 5, 30]) {
      const p = plan(names(n));
      const b = bounds(p);
      const pts = [
        ...[...p.slots.values()].map((s) => s.at),
        p.civic.townHall.at, p.civic.postOffice.at, p.civic.archive.at, p.civic.memory.at,
        p.civic.gate, p.civic.parent, ...p.civic.children, p.civic.station,
      ];
      for (const q of pts) {
        expect(q.x).toBeGreaterThanOrEqual(b.x);
        expect(q.x).toBeLessThanOrEqual(b.x + b.w);
        expect(q.y).toBeGreaterThanOrEqual(b.y);
        expect(q.y).toBeLessThanOrEqual(b.y + b.h);
      }
    }
    const b5 = bounds(plan(names(5)));
    const b30 = bounds(plan(names(30)));
    expect(b5.w).toBeLessThan(b30.w);
    expect(b5.h).toBeLessThan(b30.h);
  });
});
