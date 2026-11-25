// A person in the village: a crisp 16-bit pixel-art sprite from a 4-dir walk
// sheet that walks along streets and paths (frame follows distance walked,
// no sliding feet), eases in and out, and idles alive. Under Reduce Motion it
// fades from place to place instead.
import Phaser from "phaser";
import { SHEET_UNIT, WALK_FRAMES, walkSheet, where, type FigureOpts } from "./art.ts";
import type { Look } from "./gen.ts";
import type { Pt } from "./nav.ts";

export type Gait = "walk" | "stroll" | "elder" | "run" | "hurry";
const GAIT: Record<Gait, { speed: number; stride: number }> = {
  stroll: { speed: 36, stride: 5 },
  walk: { speed: 54, stride: 6 },
  hurry: { speed: 92, stride: 7.5 },
  run: { speed: 100, stride: 8 },
  elder: { speed: 22, stride: 3.8 },
};

export type Activity = "idle" | "walk" | "sit" | "chat" | "work";

export class Person {
  readonly sprite: Phaser.GameObjects.Image;
  readonly sheet: string;
  readonly look: Look;
  readonly shirt: number;
  activity: Activity = "idle";
  gait: Gait;
  owner?: string;
  private path: Pt[] = [];
  private v = 0;
  private dist = 0;
  private dir: "down" | "up" | "side" = "down";
  private idleAt = 0;
  private idleFrame = "idle-still";
  private arrive?: () => void;
  private reduce: boolean;
  private scale: number;
  private seed: number;

  constructor(scene: Phaser.Scene, at: Pt, look: Look, shirt: number, o: FigureOpts & { gait?: Gait; child?: boolean; reduceMotion?: boolean } = {}) {
    this.sheet = walkSheet(scene, look, shirt, o);
    this.look = look;
    this.shirt = shirt;
    this.gait = o.gait ?? "walk";
    this.reduce = o.reduceMotion ?? false;
    this.scale = SHEET_UNIT * (o.child ? 0.78 : 1);
    this.sprite = scene.add.image(at.x, at.y, where(this.sheet)[0], `${this.sheet}|idle-still`)
      .setOrigin(0.5, 20 / 22)
      .setScale(this.scale)
      .setDepth(at.y);
    this.seed = (at.x * 7 + at.y * 13) % 1000;
  }

  private show(frame: string) {
    this.sprite.setFrame(`${this.sheet}|${frame}`);
  }

  get x() { return this.sprite.x; }
  get y() { return this.sprite.y; }
  get moving() { return this.activity === "walk"; }

  walk(points: Pt[], done?: () => void, gait?: Gait) {
    if (gait) this.gait = gait;
    this.path = points.slice();
    this.arrive = done;
    this.activity = "walk";
    if (this.reduce) this.fadeTo(points[points.length - 1]!);
  }

  private fadeTo(p: Pt) {
    const s = this.sprite;
    s.scene.tweens.chain({ tweens: [
      { targets: s, alpha: 0, duration: 220 },
      { targets: s, alpha: 1, duration: 220, onStart: () => { s.setPosition(p.x, p.y).setDepth(p.y); } },
    ], onComplete: () => this.stop() } as unknown as Phaser.Types.Tweens.TweenChainBuilderConfig);
    this.path = [];
  }

  stop(activity: Activity = "idle") {
    this.path = [];
    this.v = 0;
    this.activity = activity;
    this.show(activity === "sit" ? "sit" : this.dir === "side" ? "side" : this.dir === "up" ? "up" : "idle-still");
    const done = this.arrive;
    this.arrive = undefined;
    done?.();
  }

  face(p: Pt) {
    const dx = p.x - this.x, dy = p.y - this.y;
    if (Math.abs(dx) > Math.abs(dy)) { this.dir = "side"; this.sprite.setFlipX(dx < 0); this.show("side"); }
    else { this.dir = dy < 0 ? "up" : "down"; this.sprite.setFlipX(false); this.show(dy < 0 ? "up" : "idle-still"); }
  }

  sit() {
    this.dir = "down";
    this.sprite.setFlipX(false);
    this.stop("sit");
  }

  nudge(dx: number, dy: number) {
    this.sprite.x += dx;
    this.sprite.y += dy;
  }

  hold = false;

  update(dt: number, now: number, onScreen: boolean) {
    if (this.reduce) return;
    const s = this.sprite;
    if (this.activity === "walk" && this.path.length) {
      const { speed, stride } = GAIT[this.gait];
      const target = this.path[0]!;
      const dx = target.x - s.x, dy = target.y - s.y, d = Math.hypot(dx, dy);
      const remaining = d + this.restOfPath();
      const want = this.hold ? 0 : Math.min(speed, Math.max(12, remaining * 2.4));
      this.v += (want - this.v) * Math.min(1, dt * 6);
      const step = Math.min(d, this.v * dt);
      if (d < 1) {
        this.path.shift();
        if (!this.path.length) { this.stop(); return; }
      } else {
        s.x += (dx / d) * step;
        s.y += (dy / d) * step;
        s.setDepth(s.y);
        this.dist += step;
        this.dir = Math.abs(dx) > Math.abs(dy) * 0.8 ? "side" : dy < 0 ? "up" : "down";
        if (onScreen) {
          s.setFlipX(this.dir === "side" && dx < 0);
          const f = Math.floor(this.dist / stride) % WALK_FRAMES;
          this.show(`walk-${this.dir}-${f}`);
        }
      }
      return;
    }
    if (!onScreen || this.activity === "sit") return;
    if (now >= this.idleAt) {
      const r = (Math.sin(now * 0.0013 + this.seed) + 1) / 2;
      if (this.dir !== "down") { this.idleAt = now + 4000; return; }
      if (this.idleFrame !== "idle-still") { this.idleFrame = "idle-still"; this.idleAt = now + 900 + r * 900; }
      else {
        this.idleFrame = r < 0.6 ? "idle-breathe" : r < 0.75 ? "idle-left" : r < 0.9 ? "idle-right" : this.activity === "chat" ? "idle-left" : "idle-stretch";
        this.idleAt = now + (this.idleFrame === "idle-breathe" ? 700 : this.idleFrame === "idle-stretch" ? 1400 : 1100);
      }
      this.show(this.idleFrame);
    }
  }

  private restOfPath() {
    let d = 0;
    for (let i = 1; i < this.path.length; i++) d += Math.hypot(this.path[i]!.x - this.path[i - 1]!.x, this.path[i]!.y - this.path[i - 1]!.y);
    return d;
  }

  destroy() { this.sprite.destroy(); }
}
