// The village's ambient life: townspeople strolling the cobblestone streets
// and Town Square, sitting on benches, chatting in pairs, stepping aside for
// message walkers, sheltering from rain, going home at night, plus a pixel cat
// and birds. None of it invents Senate data or named-senator visits.
import Phaser from "phaser";
import { INK, PX } from "./art.ts";
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

const SHIRTS = [0x6e85a3, 0xb59c72, 0x629684, 0x997990, 0x839c64, 0xb88663, 0xc98265, 0x7392b8];

type Plan = "idle" | "going" | "sitting" | "chatting" | "waiting" | "home" | "away";
interface Civ { p: Person; plan: Plan; until: number; bench?: number; partner?: Civ; child: boolean; rnd: () => number }

interface Cat { img: Phaser.GameObjects.Image; to?: Pt; until: number; dist: number }
interface Bird { img: Phaser.GameObjects.Image; vx: number; vy: number; dist: number }

export class Life {
  civilians: Civ[] = [];
  private scene: Phaser.Scene;
  private grid: Grid;
  private places: Places;
  private messengers: () => Pt[];
  private reduce: boolean;
  private benchTaken = new Set<number>();
  private cat?: Cat;
  private birds: Bird[] = [];
  private nextFlock = 0;
  private rnd = seeded("life");
  weather: Weather = "clear";
  life = 1;
  cap = 16;

  constructor(scene: Phaser.Scene, grid: Grid, places: Places, messengers: () => Pt[], reduceMotion: boolean) {
    this.scene = scene;
    this.grid = grid;
    this.places = places;
    this.messengers = messengers;
    this.reduce = reduceMotion;
    catArt(scene);
    birdArt(scene);
  }

  populate(n: number, hit: (img: Phaser.GameObjects.Image) => void) {
    const spots = [...this.places.spots, ...this.places.benches];
    for (let i = 0; i < n; i++) {
      const rnd = seeded(`civ-${i}`);
      const child = i % 7 === 3;
      const at = this.grid.nearestWalkable(spots[Math.floor(rnd() * spots.length)] ?? { x: 0, y: 0 }) ?? { x: 0, y: 0 };
      const p = new Person(this.scene, { x: at.x + (rnd() - 0.5) * 28, y: at.y + (rnd() - 0.5) * 22 }, generateLook(`civilian-${i}`),
        SHIRTS[i % SHIRTS.length]!, { gait: child ? "run" : "stroll", child, reduceMotion: this.reduce });
      hit(p.sprite);
      this.civilians.push({ p, plan: "idle", until: performance.now() + rnd() * 4000, child, rnd });
    }
    if (!this.reduce && this.places.gardens.length) {
      const at = this.places.gardens[0]!;
      this.cat = { img: this.scene.add.image(at.x, at.y, "cat", "cat-sit").setScale(PX).setOrigin(0.5, 0.9).setDepth(at.y), until: 0, dist: 0 };
    }
  }

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

  dismiss(p: Person) { p.owner = undefined; }

  private release(c: Civ) {
    if (c.bench !== undefined) this.benchTaken.delete(c.bench);
    c.bench = undefined;
    if (c.partner) { const q = c.partner; c.partner = undefined; q.partner = undefined; q.until = 0; q.plan = "idle"; }
  }

  private go(c: Civ, to: Pt, then: Plan, hold: number, now: number) {
    const path = this.grid.path({ x: c.p.x, y: c.p.y }, to);
    if (!path) { c.until = now + 1500; return false; }
    c.plan = "going";
    c.p.walk(path, () => { c.plan = then; c.until = performance.now() + hold; if (then === "sitting") c.p.sit(); },
      c.child ? (c.rnd() < 0.5 ? "run" : "walk") : c.rnd() < 0.35 ? "walk" : "stroll");
    return true;
  }

  private decide(c: Civ, now: number, active: number) {
    const r = c.rnd();
    const pick = <T>(xs: T[]) => xs[Math.floor(c.rnd() * xs.length)];
    const index = this.civilians.indexOf(c);
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
    if (r < 0.22) {
      const free = this.places.benches.map((_, i) => i).filter((i) => !this.benchTaken.has(i));
      const i = pick(free);
      if (i !== undefined) {
        this.benchTaken.add(i);
        c.bench = i;
        if (this.go(c, this.places.benches[i]!, "sitting", 10_000 + c.rnd() * 18_000, now)) return;
        this.benchTaken.delete(i);
      }
    }
    if (r < 0.44) {
      const other = this.civilians
        .filter((o, j) => o !== c && j < active && !o.p.owner && (o.plan === "idle" || o.plan === "waiting") && !o.partner)
        .sort((a, b) => Math.hypot(a.p.x - c.p.x, a.p.y - c.p.y) - Math.hypot(b.p.x - c.p.x, b.p.y - c.p.y))[0];
      if (other && Math.hypot(other.p.x - c.p.x, other.p.y - c.p.y) < 420) {
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
              if (them) who.p.face({ x: them.p.x === who.p.x ? who.p.x - dx : them.p.x, y: who.p.y });
            }, "stroll");
            return true;
          };
          if (meet(c, -12) && meet(other, 12)) return;
          this.release(c);
        }
      }
    }
    if (r < 0.56) { c.plan = "waiting"; c.p.stop(); c.until = now + 3000 + c.rnd() * 5000; return; }
    const to = pick(this.places.spots);
    if (to) this.go(c, { x: to.x + (c.rnd() - 0.5) * 44, y: to.y + (c.rnd() - 0.5) * 32 }, "idle", 1500 + c.rnd() * 3000, now);
  }

  update(dt: number, now: number, view: Rect) {
    const on = (p: Pt) => p.x > view.x - 40 && p.x < view.x + view.w + 40 && p.y > view.y - 60 && p.y < view.y + view.h + 60;
    const active = Math.min(this.cap, Math.round(this.civilians.length * this.life));
    const walkers = this.messengers();
    for (const c of this.civilians) {
      const p = c.p;
      if (!p.owner) {
        if (c.plan === "home" && now >= c.until) { c.plan = "away"; p.sprite.setAlpha(0); c.until = now + 20_000; }
        if ((c.plan === "idle" || c.plan === "waiting" || c.plan === "sitting" || c.plan === "chatting" || c.plan === "away") && now >= c.until) {
          if (c.plan === "chatting" || c.plan === "sitting") this.release(c);
          c.plan = c.plan === "away" ? "away" : "idle";
          this.decide(c, now, active);
        }
        p.hold = p.moving && walkers.some((k) => Math.abs(k.x - p.x) < 22 && Math.abs(k.y - p.y) < 22);
      }
      if (c.plan !== "away") p.update(dt, now, on(p));
    }
    for (let i = 0; i < this.civilians.length; i++) {
      const a = this.civilians[i]!.p;
      if (!a.moving) continue;
      for (let j = i + 1; j < this.civilians.length; j++) {
        const b = this.civilians[j]!.p;
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        if (d > 0 && d < 14) { const k = ((14 - d) / d) * 0.5; a.nudge(-dy * k * 0.5, dx * k * 0.5); b.nudge(dy * k * 0.5, -dx * k * 0.5); }
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
      cat.to = { x: g.x + (this.rnd() - 0.5) * 32, y: g.y + 8 };
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
          .setScale(PX).setDepth(20_000).setFlipX(!fromLeft);
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
  const c = document.createElement("canvas");
  c.width = 36; c.height = 10;
  const ctx = c.getContext("2d")!;
  const ink = `#${INK.toString(16).padStart(6, "0")}`;
  const fur = "#8a7564", dark = "#635245";
  const draw = (ox: number, leg: number, sit: boolean) => {
    ctx.fillStyle = "rgba(0,0,0,0.2)"; ctx.fillRect(ox + 2, 8, 8, 2);
    ctx.fillStyle = fur;
    if (sit) {
      ctx.fillRect(ox + 4, 4, 4, 5); ctx.fillRect(ox + 4, 1, 4, 3);
      ctx.fillRect(ox + 4, 0, 1, 1); ctx.fillRect(ox + 7, 0, 1, 1);
      ctx.fillStyle = dark; ctx.fillRect(ox + 8, 6, 2, 2);
      ctx.fillStyle = ink; ctx.fillRect(ox + 5, 2, 1, 1); ctx.fillRect(ox + 6, 2, 1, 1);
    } else {
      ctx.fillRect(ox + 2, 4, 7, 3); ctx.fillRect(ox + 7, 2, 3, 3);
      ctx.fillRect(ox + 7, 1, 1, 1); ctx.fillRect(ox + 9, 1, 1, 1);
      ctx.fillRect(ox + 1, 3, 1, 2);
      ctx.fillStyle = dark;
      ctx.fillRect(ox + 3 + leg, 7, 1, 2); ctx.fillRect(ox + 7 - leg, 7, 1, 2);
      ctx.fillStyle = ink; ctx.fillRect(ox + 9, 3, 1, 1);
    }
  };
  draw(0, 1, false); draw(12, -1, false); draw(24, 0, true);
  const t = scene.textures.addCanvas("cat", c)!;
  t.setFilter(Phaser.Textures.FilterMode.NEAREST);
  t.add("cat-a", 0, 0, 0, 12, 10);
  t.add("cat-b", 0, 12, 0, 12, 10);
  t.add("cat-sit", 0, 24, 0, 12, 10);
}

function birdArt(scene: Phaser.Scene) {
  if (scene.textures.exists("bird")) return;
  const c = document.createElement("canvas");
  c.width = 16; c.height = 6;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = `#${INK.toString(16).padStart(6, "0")}`;
  // Wing up
  ctx.fillRect(1, 1, 2, 1); ctx.fillRect(3, 2, 2, 1); ctx.fillRect(5, 1, 2, 1);
  // Wing down
  ctx.fillRect(9, 3, 2, 1); ctx.fillRect(11, 2, 2, 1); ctx.fillRect(13, 3, 2, 1);
  const t = scene.textures.addCanvas("bird", c)!;
  t.setFilter(Phaser.Textures.FilterMode.NEAREST);
  t.add("bird-a", 0, 0, 0, 8, 6);
  t.add("bird-b", 0, 8, 0, 8, 6);
}
