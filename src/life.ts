// The town's ambient life: townspeople with small routines (stroll to a
// bench, the pond, the monuments, the gate; sit; chat in pairs facing each
// other; wait at a crossing for a capsule; shelter from rain; go home at
// night), a cat, birds. None of it is Senate data and none of it pretends
// to be: civilians are free; named senators never take part here.
import Phaser from "phaser";
import { INK, PALETTE } from "./art.ts";
import { generateLook } from "./gen.ts";
import { seeded } from "./model.ts";
import type { Grid, Pt, Rect } from "./nav.ts";
import { Person } from "./people.ts";
import type { Weather } from "./world.ts";

export interface Places {
  benches: Pt[];
  spots: Pt[];
  homes: Pt[];
  shelters: Pt[];
  gardens: Pt[];
}

const SHIRTS = [0x9aa7b8, 0xc4b59a, 0x8fb3a6, 0xb79fae, 0xa9b78f, 0xc9a98f, 0xe0a989, 0x9fb6d6];

type Plan = "idle" | "going" | "sitting" | "chatting" | "waiting" | "home" | "away";
interface Civ { p: Person; plan: Plan; until: number; bench?: number; partner?: Civ; child: boolean; rnd: () => number }

interface Cat { img: Phaser.GameObjects.Image; to?: Pt; until: number; dist: number }
interface Bird { img: Phaser.GameObjects.Image; vx: number; vy: number; dist: number }

export class Life {
  civilians: Civ[] = [];
  private scene: Phaser.Scene;
  private grid: Grid;
  private places: Places;
  private capsules: () => Pt[];
  private reduce: boolean;
  private benchTaken = new Set<number>();
  private cat?: Cat;
  private birds: Bird[] = [];
  private nextFlock = 0;
  private rnd = seeded("life");
  weather: Weather = "clear";
  /** 0..1: how many are out (the hour), times the town's load. */
  life = 1;
  /** The population cap (viewport and device). */
  cap = 16;

  constructor(scene: Phaser.Scene, grid: Grid, places: Places, capsules: () => Pt[], reduceMotion: boolean) {
    this.scene = scene;
    this.grid = grid;
    this.places = places;
    this.capsules = capsules;
    this.reduce = reduceMotion;
    catArt(scene);
    birdArt(scene);
  }

  /** Townspeople, generated and placed (deterministic per town). */
  populate(n: number, hit: (img: Phaser.GameObjects.Image) => void) {
    const spots = [...this.places.spots, ...this.places.benches];
    for (let i = 0; i < n; i++) {
      const rnd = seeded(`civ-${i}`);
      const child = i % 7 === 3;
      const at = this.grid.nearestWalkable(spots[Math.floor(rnd() * spots.length)] ?? { x: 0, y: 0 }) ?? { x: 0, y: 0 };
      const p = new Person(this.scene, { x: at.x + (rnd() - 0.5) * 40, y: at.y + (rnd() - 0.5) * 30 }, generateLook(`civilian-${i}`),
        SHIRTS[i % SHIRTS.length]!, { gait: child ? "run" : "stroll", child, reduceMotion: this.reduce });
      hit(p.sprite);
      this.civilians.push({ p, plan: "idle", until: performance.now() + rnd() * 4000, child, rnd });
    }
    if (!this.reduce && this.places.gardens.length) {
      const at = this.places.gardens[0]!;
      this.cat = { img: this.scene.add.image(at.x, at.y, "cat", "cat-sit").setScale(0.5).setOrigin(0.5, 0.9).setDepth(at.y), until: 0, dist: 0 };
    }
  }

  /** A free townsperson nearest a point, taken off the street for a job. */
  recruit(at: Pt): Person | undefined {
    let best: Civ | undefined, d = Infinity;
    for (const c of this.civilians) {
      if (c.p.owner || c.plan === "away" || c.child) continue;
      const k = Math.hypot(c.p.x - at.x, c.p.y - at.y);
      if (k < d) { d = k; best = c; }
    }
    if (!best) return undefined;
    this.release(best);
    best.p.owner = "job";
    best.plan = "idle";
    best.p.sprite.setAlpha(1);
    return best.p;
  }

  /** Back to the street. */
  dismiss(p: Person) {
    p.owner = undefined;
  }

  private release(c: Civ) {
    if (c.bench !== undefined) this.benchTaken.delete(c.bench);
    c.bench = undefined;
    if (c.partner) { const q = c.partner; c.partner = undefined; q.partner = undefined; q.until = 0; q.plan = "idle"; }
  }

  private go(c: Civ, to: Pt, then: Plan, hold: number, now: number) {
    const path = this.grid.path({ x: c.p.x, y: c.p.y }, to);
    if (!path) { c.until = now + 1500; return false; }
    c.plan = "going";
    c.p.walk(path, () => { c.plan = then; c.until = performance.now() + hold; if (then === "sitting") c.p.sit(); }, c.child ? (c.rnd() < 0.5 ? "run" : "walk") : c.rnd() < 0.3 ? "walk" : "stroll");
    return true;
  }

  private decide(c: Civ, now: number, active: number) {
    const r = c.rnd();
    const pick = <T>(xs: T[]) => xs[Math.floor(c.rnd() * xs.length)];
    const index = this.civilians.indexOf(c);
    // Night, or too many out for the hour: home.
    if (index >= active) {
      if (c.plan === "away") { c.until = now + 20_000; return; }
      const home = pick(this.places.homes);
      if (home && this.go(c, home, "home", 2000, now)) return;
      c.plan = "away";
      return;
    }
    if (c.plan === "away") c.p.sprite.setAlpha(1);
    if (this.weather === "rain" && r < 0.7) {
      const near = this.places.shelters.slice().sort((a, b) => Math.hypot(a.x - c.p.x, a.y - c.p.y) - Math.hypot(b.x - c.p.x, b.y - c.p.y))[0];
      if (near && this.go(c, near, "waiting", 20_000 + c.rnd() * 20_000, now)) return;
    }
    if (r < 0.2) {
      const free = this.places.benches.map((b, i) => i).filter((i) => !this.benchTaken.has(i));
      const i = pick(free);
      if (i !== undefined) {
        this.benchTaken.add(i);
        c.bench = i;
        if (this.go(c, this.places.benches[i]!, "sitting", 10_000 + c.rnd() * 18_000, now)) return;
        this.benchTaken.delete(i);
      }
    }
    if (r < 0.42) {
      // A chat: the nearest free neighbour; they meet halfway and face each other.
      const other = this.civilians
        .filter((o, j) => o !== c && j < active && !o.p.owner && (o.plan === "idle" || o.plan === "waiting") && !o.partner)
        .sort((a, b) => Math.hypot(a.p.x - c.p.x, a.p.y - c.p.y) - Math.hypot(b.p.x - c.p.x, b.p.y - c.p.y))[0];
      if (other && Math.hypot(other.p.x - c.p.x, other.p.y - c.p.y) < 500) {
        const mid = this.grid.nearestWalkable({ x: (c.p.x + other.p.x) / 2, y: (c.p.y + other.p.y) / 2 });
        if (mid) {
          const hold = 6000 + c.rnd() * 8000;
          c.partner = other;
          other.partner = c;
          const meet = (who: Civ, dx: number) => {
            const path = this.grid.path({ x: who.p.x, y: who.p.y }, { x: mid.x + dx, y: mid.y });
            if (!path) return false;
            who.plan = "going";
            who.p.walk(path, () => {
              who.plan = "chatting";
              who.until = performance.now() + hold;
              const them = who.partner;
              if (them) { who.p.face({ x: them.p.x === who.p.x ? who.p.x - dx : them.p.x, y: who.p.y }); }
            }, "stroll");
            return true;
          };
          if (meet(c, -11) && meet(other, 11)) return;
          this.release(c);
        }
      }
    }
    if (r < 0.55) { c.plan = "waiting"; c.p.stop(); c.until = now + 3000 + c.rnd() * 5000; return; }
    const to = pick(this.places.spots);
    if (to) this.go(c, { x: to.x + (c.rnd() - 0.5) * 60, y: to.y + (c.rnd() - 0.5) * 40 }, "idle", 1500 + c.rnd() * 3000, now);
  }

  update(dt: number, now: number, view: Rect) {
    const on = (p: Pt) => p.x > view.x - 40 && p.x < view.x + view.w + 40 && p.y > view.y - 60 && p.y < view.y + view.h + 60;
    const active = Math.min(this.cap, Math.round(this.civilians.length * this.life));
    const caps = this.capsules();
    for (const c of this.civilians) {
      const p = c.p;
      if (!p.owner) {
        if (c.plan === "home" && now >= c.until) { c.plan = "away"; p.sprite.setAlpha(0); c.until = now + 20_000; }
        if ((c.plan === "idle" || c.plan === "waiting" || c.plan === "sitting" || c.plan === "chatting" || c.plan === "away") && now >= c.until) {
          if (c.plan === "chatting" || c.plan === "sitting") this.release(c);
          c.plan = c.plan === "away" ? "away" : "idle";
          this.decide(c, now, active);
        }
        // Wait at a crossing while a capsule goes by.
        p.hold = p.moving && caps.some((k) => Math.abs(k.x - p.x) < 34 && Math.abs(k.y - p.y) < 34);
      }
      if (c.plan !== "away") p.update(dt, now, on(p));
    }
    // Passing: two walkers too close step aside.
    for (let i = 0; i < this.civilians.length; i++) {
      const a = this.civilians[i]!.p;
      if (!a.moving) continue;
      for (let j = i + 1; j < this.civilians.length; j++) {
        const b = this.civilians[j]!.p;
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        if (d > 0 && d < 12) { const k = ((12 - d) / d) * 0.5; a.nudge(-dy * k * 0.5, dx * k * 0.5); b.nudge(dy * k * 0.5, -dx * k * 0.5); }
      }
    }
    if (!this.reduce) { this.updateCat(dt, now); this.updateBirds(dt, now, view); }
  }

  private updateCat(dt: number, now: number) {
    const cat = this.cat;
    if (!cat) return;
    if (!cat.to) {
      if (now < cat.until) return;
      const g = this.places.gardens[Math.floor(this.rnd() * this.places.gardens.length)];
      if (!g) return;
      cat.to = { x: g.x + (this.rnd() - 0.5) * 40, y: g.y + 10 };
    }
    const dx = cat.to.x - cat.img.x, dy = cat.to.y - cat.img.y, d = Math.hypot(dx, dy);
    if (d < 2) { cat.to = undefined; cat.until = now + 8000 + this.rnd() * 20_000; cat.img.setFrame("cat-sit"); return; }
    const step = Math.min(d, 26 * dt);
    cat.img.x += (dx / d) * step;
    cat.img.y += (dy / d) * step;
    cat.dist += step;
    cat.img.setDepth(cat.img.y).setFlipX(dx < 0).setFrame(Math.floor(cat.dist / 5) % 2 ? "cat-a" : "cat-b");
  }

  private updateBirds(dt: number, now: number, view: Rect) {
    if (now >= this.nextFlock && this.birds.length === 0 && this.weather !== "rain" && this.life > 0.3) {
      this.nextFlock = now + 25_000 + this.rnd() * 35_000;
      const n = 3 + Math.floor(this.rnd() * 3), fromLeft = this.rnd() < 0.5;
      const y0 = view.y + view.h * (0.15 + this.rnd() * 0.5);
      for (let i = 0; i < n; i++) {
        const img = this.scene.add.image(fromLeft ? view.x - 30 - i * 18 : view.x + view.w + 30 + i * 18, y0 + (i % 2) * 12 - i * 3, "bird", "bird-a")
          .setScale(0.5).setDepth(20_000).setFlipX(!fromLeft);
        this.birds.push({ img, vx: (fromLeft ? 1 : -1) * (70 + this.rnd() * 20), vy: -6, dist: i * 7 });
      }
    }
    for (const b of this.birds) {
      b.img.x += b.vx * dt;
      b.img.y += b.vy * dt;
      b.dist += Math.abs(b.vx) * dt;
      b.img.setFrame(Math.floor(b.dist / 18) % 2 ? "bird-a" : "bird-b");
    }
    const gone = this.birds.filter((b) => b.img.x < view.x - 300 || b.img.x > view.x + view.w + 300);
    for (const b of gone) b.img.destroy();
    this.birds = this.birds.filter((b) => !gone.includes(b));
  }

  destroy() {
    for (const c of this.civilians) c.p.destroy();
    this.civilians = [];
    this.cat?.img.destroy();
    for (const b of this.birds) b.img.destroy();
    this.birds = [];
  }
}

function catArt(scene: Phaser.Scene) {
  if (scene.textures.exists("cat")) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.scaleX = g.scaleY = 2;
  const body = (ox: number, legs: number, sit: boolean) => {
    g.fillStyle(0x000000, 0.15).fillEllipse(ox + 12, 19, 18, 4);
    if (sit) {
      g.fillStyle(0x8a7a6a, 1).fillEllipse(ox + 12, 13, 12, 12).fillCircle(ox + 12, 6, 5);
      g.fillTriangle(ox + 8, 3, ox + 9, -1 + 1, ox + 11, 2).fillTriangle(ox + 16, 3, ox + 15, 0, ox + 13, 2);
      g.lineStyle(2, 0x8a7a6a, 1).beginPath().moveTo(ox + 17, 17).lineTo(ox + 21, 12).strokePath();
    } else {
      g.fillStyle(0x8a7a6a, 1).fillEllipse(ox + 11, 12, 16, 8).fillCircle(ox + 19, 9, 4.5);
      g.fillTriangle(ox + 16, 6, ox + 17, 2, ox + 19, 5).fillTriangle(ox + 21, 5, ox + 22, 2, ox + 23, 6);
      g.lineStyle(2, 0x8a7a6a, 1).beginPath().moveTo(ox + 4, 11).lineTo(ox + 1, 6).strokePath();
      g.lineStyle(2, 0x6e6052, 1).beginPath().moveTo(ox + 7 - legs, 14).lineTo(ox + 7 + legs, 19).moveTo(ox + 15 + legs, 14).lineTo(ox + 15 - legs, 19).strokePath();
    }
    g.fillStyle(INK, 1).fillCircle(ox + (sit ? 10.5 : 20), sit ? 6 : 8.5, 0.8);
    if (sit) g.fillCircle(ox + 13.5, 6, 0.8);
  };
  body(0, 2, false);
  body(24, -2, false);
  body(48, 0, true);
  g.generateTexture("cat", 72 * 2, 22 * 2);
  g.destroy();
  const t = scene.textures.get("cat");
  t.add("cat-a", 0, 0, 0, 48, 44);
  t.add("cat-b", 0, 48, 0, 48, 44);
  t.add("cat-sit", 0, 96, 0, 48, 44);
}

function birdArt(scene: Phaser.Scene) {
  if (scene.textures.exists("bird")) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.scaleX = g.scaleY = 2;
  g.lineStyle(2, INK, 0.8).beginPath().moveTo(1, 6).lineTo(7, 9).lineTo(13, 6).strokePath();
  g.lineStyle(2, INK, 0.8).beginPath().moveTo(15, 10).lineTo(21, 8).lineTo(27, 10).strokePath();
  g.fillStyle(PALETTE.white, 0).fillRect(0, 0, 1, 1);
  g.generateTexture("bird", 28 * 2, 14 * 2);
  g.destroy();
  const t = scene.textures.get("bird");
  t.add("bird-a", 0, 0, 0, 28, 28);
  t.add("bird-b", 0, 28, 0, 28, 28);
}
