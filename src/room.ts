// Inside a committee's house: each senator at its own desk, its terminal
// glowing while a turn runs, its desk item, the chair's wider desk at the
// front; tool workers come in at the door to the desk and go; capsules come
// and go by the mail slot; a visitor waits by the door for the person; a
// paused senator sleeps with its head down. No text: hover cards and clicks
// as in the town. Esc (or the back button) returns to the town.
import Phaser from "phaser";
import { character, COLOURS_OF, deskItem, desk, INK, mailSlot, PALETTE, RUNTIME, sprite, terminal, TOOLS, tool as toolArt, unit } from "./art.ts";
import { generateLook, readLook, type HouseSpec } from "./gen.ts";
import type { Committee, Senator, ThreadRef, ToolKind, TownState } from "./model.ts";
import type { Hooks, Target } from "./works.ts";

export interface RoomData {
  committee: string;
  state: TownState;
  spec: HouseSpec;
  hooks: Hooks;
  reduceMotion: boolean;
  onExit: () => void;
}

const W = 1100, H = 700;

export class Room extends Phaser.Scene {
  private data0!: RoomData;
  private desks = new Map<string, { at: { x: number; y: number }; screen: Phaser.GameObjects.Image }>();
  private door = { x: W / 2, y: H - 40 };
  private slot = { x: W / 2 + 70, y: H - 56 };
  private layer: Phaser.GameObjects.GameObject[] = [];
  private busy = 0;

  constructor() {
    super("room");
  }

  init(data: RoomData) {
    this.data0 = data;
  }

  create() {
    const cam = this.cameras.main;
    const fit = () => {
      const z = Math.min(cam.width / (W + 80), cam.height / (H + 80));
      cam.setZoom(z).centerOn(W / 2, H / 2);
    };
    fit();
    this.scale.on("resize", fit, this);
    this.events.once("shutdown", () => this.scale.off("resize", fit, this));
    cam.setBackgroundColor(0x2b2838);
    this.input.keyboard?.on("keydown-ESC", () => this.exit());
    this.draw();
  }

  exit() {
    this.data0.hooks.hover(undefined, 0, 0);
    this.data0.onExit();
  }

  /** Scale a sprite to `k` times its intended size. */
  private big(o: Phaser.GameObjects.Image, k: number) {
    return o.setScale(unit(o.texture.key) * k);
  }

  private hit(o: Phaser.GameObjects.Image, t: () => Target) {
    o.setInteractive({ useHandCursor: true });
    o.on("pointerover", (p: Phaser.Input.Pointer) => this.data0.hooks.hover(t(), p.x, p.y));
    o.on("pointerout", () => this.data0.hooks.hover(undefined, 0, 0));
    o.on("pointerup", () => this.data0.hooks.open(t()));
    return o;
  }

  private committee(): Committee | undefined {
    return this.data0.state.committees.find((c) => c.name === this.data0.committee);
  }

  /** The room as the state has it now. */
  refresh(state: TownState) {
    this.data0.state = state;
    if (this.sys.isActive()) this.draw();
  }

  private draw() {
    for (const o of this.layer) o.destroy();
    this.layer = [];
    this.desks.clear();
    const spec = this.data0.spec;
    const wall = COLOURS_OF(spec.wall), trim = COLOURS_OF(spec.trim);
    const g = this.add.graphics();
    this.layer.push(g);
    // The back wall with windows, the floor in planks, the walls' edge.
    g.fillStyle(wall, 1).fillRoundedRect(0, 0, W, 170, { tl: 24, tr: 24, bl: 0, br: 0 });
    g.fillStyle(Phaser.Display.Color.IntegerToColor(wall).darken(10).color, 1).fillRect(0, 150, W, 20);
    for (let i = 0; i < 5; i++) {
      const x = 90 + i * 220;
      g.fillStyle(0xbfe6ff, 1).fillRoundedRect(x, 34, 120, 86, spec.windows === "arch" ? 40 : spec.windows === "round" ? 43 : 8);
      g.lineStyle(4, INK, 1).strokeRoundedRect(x, 34, 120, 86, spec.windows === "arch" ? 40 : spec.windows === "round" ? 43 : 8);
      g.lineStyle(3, INK, 1).beginPath().moveTo(x + 60, 36).lineTo(x + 60, 118).strokePath();
    }
    g.fillStyle(0xe9d2ab, 1).fillRect(0, 170, W, H - 170);
    g.lineStyle(2, 0xd4b98d, 1);
    for (let y = 200; y < H; y += 34) g.beginPath().moveTo(0, y).lineTo(W, y).strokePath();
    g.fillStyle(trim, 1).fillRect(0, H - 22, W, 22);
    g.lineStyle(6, INK, 1).strokeRoundedRect(0, 0, W, H, 24);
    // The door and the mail slot.
    g.fillStyle(PALETTE.woodDark, 1).fillRoundedRect(this.door.x - 34, H - 92, 68, 92, 20);
    g.lineStyle(3, INK, 1).strokeRoundedRect(this.door.x - 34, H - 92, 68, 92, 20);
    this.layer.push(sprite(this, this.slot.x, this.slot.y, mailSlot(this)));

    const c = this.committee();
    const senators = c?.senators ?? [];
    // The chair's wide desk at the front; the others in two rows behind.
    const chairAt = { x: W / 2, y: 520 };
    const places = [{ x: 220, y: 280 }, { x: 550, y: 280 }, { x: 880, y: 280 }, { x: 220, y: 420 }, { x: 880, y: 420 }, { x: 550, y: 400 }];
    let next = 0;
    for (const s of senators.slice(0, 7)) {
      const at = s.chair ? chairAt : places[next++];
      if (!at) break;
      this.drawDesk(s, at);
    }
    // Someone waits on the person: a visitor by the door with a letter.
    const first = c?.waiting?.[0];
    if (first) {
      const v = this.big(sprite(this, this.door.x - 90, H - 70, character(this, generateLook("visitor"), PALETTE.amber, { pose: "wave" })), 1.6);
      this.layer.push(this.hit(v, () => ({ kind: "waiting", thread: first, person: this.data0.state.person })));
    }
  }

  private drawDesk(s: Senator, at: { x: number; y: number }) {
    const look = readLook((s as Senator & { card?: unknown }).card, generateLook(s.id));
    const working = s.mood === "working" || s.mood === "waiting";
    if (s.mood === "stopped") {
      this.layer.push(this.big(sprite(this, at.x, at.y + 40, desk(this, !!s.chair)), s.chair ? 1.2 : 1).setAlpha(0.6));
      return;
    }
    const who = this.big(sprite(this, at.x, at.y - 4, character(this, look, RUNTIME[s.runtime], {
      pose: s.mood === "waiting" ? "wave" : s.mood === "working" ? "work" : "sit", chair: s.chair, glyph: s.runtime,
    })), 2.2);
    if (s.mood === "paused") who.setAngle(-14).setY(at.y + 16).setAlpha(0.8);
    const target = (): Target => ({ kind: "senator", senator: s, committee: this.data0.committee });
    this.layer.push(this.hit(who, target));
    this.layer.push(this.big(sprite(this, at.x, at.y + 40, desk(this, !!s.chair)), s.chair ? 1.2 : 1));
    const screen = this.big(sprite(this, at.x - 18, at.y + 14, terminal(this, working)), 1.1);
    this.layer.push(this.hit(screen, target));
    this.layer.push(this.big(sprite(this, at.x + 34, at.y + 22, deskItem(this, look.deskItem)), 1.3));
    if (working) {
      const glow = this.add.image(at.x - 18, at.y + 12, "glow").setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.45).setScale(1.3);
      this.layer.push(glow);
    }
    if (s.watched) {
      const viewer = this.big(sprite(this, at.x + 70, 120, character(this, generateLook("viewer"), 0x9a9ab0)), 1.6);
      this.layer.push(viewer);
    }
    this.desks.set(s.id, { at, screen });
  }

  // MARK: Acting

  /** A capsule through the mail slot: in to a desk, or out from one. */
  capsule(from: string, to: string | undefined, thread: ThreadRef, line: string, color: number) {
    const inbound = to !== undefined && this.desks.has(to);
    const desk0 = this.desks.get(inbound ? to! : from);
    if (!desk0) return;
    const start = inbound ? this.slot : { x: desk0.at.x - 18, y: desk0.at.y + 10 };
    const end = inbound ? { x: desk0.at.x - 18, y: desk0.at.y + 10 } : this.slot;
    const cap = this.big(sprite(this, start.x, start.y, `capsule-${color.toString(16)}`), 1.2);
    this.hit(cap, () => ({ kind: "capsule", from, to, thread, line }));
    this.busy++;
    this.tweens.add({ targets: cap, x: end.x, y: end.y, duration: this.data0.reduceMotion ? 1 : 1200, ease: "Sine.InOut",
      onComplete: () => this.tweens.add({ targets: cap, alpha: 0, duration: 300, onComplete: () => { cap.destroy(); this.busy--; } }) });
  }

  /** A tool worker comes in at the door, works at the senator's desk, and leaves. */
  worker(senator: string, kind: ToolKind, target?: string) {
    const d = this.desks.get(senator);
    if (!d) return;
    const look = generateLook(`worker-${senator}-${kind}`);
    const body = this.big(sprite(this, this.door.x, this.door.y, character(this, look, TOOLS[kind], { pose: "work", hardhat: kind === "bash" })), 1.8);
    const held = this.big(sprite(this, this.door.x + 22, this.door.y - 30, toolArt(this, kind)), 1.8);
    for (const o of [body, held]) this.hit(o, () => ({ kind: "worker", senator, tool: kind, target }));
    const spot = { x: d.at.x + 70, y: d.at.y + 30 };
    this.busy++;
    const move = (p: { x: number; y: number }, ms: number) => ({ targets: [body, held], x: (o: Phaser.GameObjects.Image) => p.x + (o === held ? 22 : 0), y: (o: Phaser.GameObjects.Image) => p.y + (o === held ? -30 : 0), duration: ms });
    this.tweens.chain({ tweens: [
      move(spot, this.data0.reduceMotion ? 1 : 1100),
      { targets: held, angle: -40, duration: 180, yoyo: true, repeat: 5 },
      move(this.door, this.data0.reduceMotion ? 1 : 1100),
      { targets: [body, held], alpha: 0, duration: 200 },
    ], onComplete: () => { body.destroy(); held.destroy(); this.busy--; } } as unknown as Phaser.Types.Tweens.TweenChainBuilderConfig);
  }

  get moving() { return this.busy > 0; }
}
