// The Works: the town as a cheerful toy machine. The sorting hall (the
// machine daemon) turns at the centre; every message is a capsule that
// leaves its sender's workshop by tube, is sorted in the hall, stamped and
// filed at the archive (a reel gains a mark), and goes on down the
// receiver's tube, waiting at a red signal when its delivery is held.
// Senators sit in their workshops' terminal bays, lit while they work;
// tool calls come out of the door as workers; elders stroll the promenade;
// each project has a monument quarter. No text is drawn on the town: what
// anything is shows in the hover card, and a click opens it.
import Phaser from "phaser";
import {
  archive, bay, bayPlaces, bench, boards, capsule, character, cottage, daylight, gate, glow, hall, house as houseArt, HOUSE_TOP, INK,
  landmark, memoryHall, monument, PALETTE, person, plant, RUNTIME, sheet, signal, skyline, speakerHouse, sprite, STYLES,
  tool as toolArt, TOOLS, townGate, townHall, train, tree, WASH, type Daylight, type Style,
} from "./art.ts";
import { COLOURS, generateHouse, generateLook, houses, houseSize, readHouse, readLook, type HouseSpec, type Look } from "./gen.ts";
import { Room } from "./room.ts";
import { Director, type Action } from "./director.ts";
import { along, bounds, CIVIC_SCALE, HALL_R, WEDGE, plan, port, signalAt, tube, WORKSHOP, type Plan, type Pt, type Slot } from "./hub.ts";
import {
  diff, hash, homeOf, senatorsOf, seeded, type Approval, type Archived, type Elder, type Project, type Release, type Senator, type ThreadRef,
  type ToolKind, type TownEvent, type TownState,
} from "./model.ts";

export type Target =
  | { kind: "senator"; senator: Senator; committee?: string }
  | { kind: "elder"; elder: Elder }
  | { kind: "workshop"; name: string; senators: number; waiting: number }
  | { kind: "hall"; passed: number }
  | { kind: "archive"; filed: [string, number][] }
  | { kind: "townhall"; docket: number; secretary?: Senator }
  | { kind: "memory"; sessions: number }
  | { kind: "capsule"; from: string; to?: string; thread: ThreadRef; line: string; held?: string }
  | { kind: "signal"; committee: string; held?: string }
  | { kind: "gate"; approval: Approval }
  | { kind: "worker"; senator: string; tool: ToolKind; target?: string }
  | { kind: "monument"; project: Project; release?: Release; next?: boolean }
  | { kind: "link"; link: "parent" | "child" | "remote"; name: string; up: boolean }
  | { kind: "waiting"; thread: ThreadRef; person?: string }
  | { kind: "gatehouse" }
  | { kind: "civilian" }
  | { kind: "archived"; archived: Archived };

export interface Hooks {
  hover(target: Target | undefined, x: number, y: number): void;
  open(target: Target): void;
  /** The town went into a house (a committee) or came out (undefined). */
  room?(committee: string | undefined): void;
}

interface Shop {
  name: string;
  slot: Slot;
  root: Phaser.GameObjects.Container;
  bays: { window: Phaser.GameObjects.Image; who?: Phaser.GameObjects.Image; id?: string }[];
  lamp: Phaser.GameObjects.Image;
  held: number;
  /** What refresh adds (sill, viewers, visitor, window glows): cleared each time. */
  extras: Phaser.GameObjects.GameObject[];
  spec: HouseSpec;
  size: { w: number; h: number };
  bayY: number;
}

interface Civilian { img: Phaser.GameObjects.Image; look: Look; shirt: number; angle: number; busy: boolean }

const CIVILIAN_SHIRTS = [0x9aa7b8, 0xc4b59a, 0x8fb3a6, 0xb79fae, 0xa9b78f, 0xc9a98f];

const BAYS = 4;
const SPEED = 520; // capsule px a second along tubes

export class Works extends Phaser.Scene {
  hooks!: Hooks;
  reduceMotion = false;
  dark = false;
  /** Fixed time of day (snapshots); else the clock. */
  fixedTime?: Daylight;

  private state: TownState = { committees: [] };
  private plan: Plan = plan([]);
  private director = new Director();
  /** Everything built for the current set of committees, destroyed on rebuild. */
  private dynamic: Phaser.GameObjects.GameObject[] = [];
  private tubes!: Phaser.GameObjects.Graphics;
  private lit!: Phaser.GameObjects.Graphics;
  private wash!: Phaser.GameObjects.Rectangle;
  private glows: Phaser.GameObjects.Image[] = [];
  private shops = new Map<string, Shop>();
  private wheel!: Phaser.GameObjects.Image;
  private reels = new Map<string, number>();
  private reelLayer!: Phaser.GameObjects.Container;
  private docket!: Phaser.GameObjects.Container;
  private elders = new Map<string, Phaser.GameObjects.Image>();
  private treesFromMap: Pt[] = [];
  private hubOffset: Pt = { x: 0, y: 0 };
  private passed = 0;
  private busy = 0;
  private awakeUntil = 0;
  private dragging = false;
  private moved = false;
  private lastSize = "";
  private pending?: { state: TownState; events: TownEvent[] };
  private time0 = Date.now();
  private specs = new Map<string, HouseSpec>();
  private civilians: Civilian[] = [];
  private constructing = 0;
  private room?: Room;
  private roomName?: string;
  private hovered?: string;

  constructor() {
    super("works");
  }

  preload() {
    this.load.setPath("assets");
    this.load.tilemapTiledJSON("works", "works.tmj");
    this.load.image("ground", "ground.png");
  }

  create() {
    const map = this.make.tilemap({ key: "works" });
    const props = (map.properties as { name: string; value: number }[]) ?? [];
    this.hubOffset = { x: props.find((p) => p.name === "hubX")?.value ?? 0, y: props.find((p) => p.name === "hubY")?.value ?? 0 };
    const tiles = map.addTilesetImage("ground", "ground")!;
    map.createLayer("ground", tiles, -this.hubOffset.x, -this.hubOffset.y)!.setDepth(-30_000);
    this.treesFromMap = (map.getObjectLayer("trees")?.objects ?? []).map((o) => ({ x: (o.x ?? 0) - this.hubOffset.x, y: (o.y ?? 0) - this.hubOffset.y }));
    for (const make of [hall, archive, townHall, memoryHall, signal, gate, tree, bench, sheet, skyline, townGate, train, glow]) make(this);

    this.tubes = this.add.graphics().setDepth(-15_000);
    this.lit = this.add.graphics().setDepth(-14_999).setBlendMode(Phaser.BlendModes.ADD);
    this.wash = this.add.rectangle(0, 0, 10, 10, 0x000000, 0).setOrigin(0).setScrollFactor(0).setDepth(9_000)
      .setBlendMode(Phaser.BlendModes.MULTIPLY);

    const cam = this.cameras.main;
    cam.setBackgroundColor(PALETTE.grass);
    this.scale.on("resize", () => this.onResize());
    this.onResize();
    this.input.on("pointerdown", () => { this.dragging = false; this.touch(); });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      this.touch();
      if (!p.isDown) return;
      const dx = p.x - p.prevPosition.x, dy = p.y - p.prevPosition.y;
      this.dragging ||= Math.hypot(p.x - p.downX, p.y - p.downY) > 4;
      cam.scrollX -= dx / cam.zoom;
      cam.scrollY -= dy / cam.zoom;
      this.moved = true;
      this.hooks.hover(undefined, 0, 0);
    });
    this.input.on("wheel", (p: Phaser.Input.Pointer, _o: unknown, dx: number, dy: number) => {
      this.touch();
      const e = p.event as WheelEvent;
      if (e.ctrlKey || e.metaKey) this.zoomAt(Math.exp(-dy * 0.01), p.x, p.y);
      else { cam.scrollX += dx / cam.zoom; cam.scrollY += dy / cam.zoom; }
      this.moved = true;
      this.hooks.hover(undefined, 0, 0);
    });
    this.time.addEvent({ delay: 60_000, loop: true, callback: () => this.applyDaylight() });
    this.input.keyboard?.on("keydown-ENTER", () => { if (this.hovered) this.enter(this.hovered); });
    if (!this.scene.get("room")) this.scene.add("room", Room, false);
    if (this.pending) {
      const { state, events } = this.pending;
      this.pending = undefined;
      this.setState(state, events);
    }
  }

  override update() {
    const roomBusy = this.room?.sys.isActive() && this.room.tweens.getTweens().length > 0;
    if (this.busy === 0 && !roomBusy && !this.dragging && performance.now() > this.awakeUntil && this.tweens.getTweens().length === 0) {
      this.game.loop.sleep();
    }
  }

  touch(hold = 500) {
    this.awakeUntil = Math.max(this.awakeUntil, performance.now() + hold);
    if (!this.game.loop.running) this.game.loop.wake();
  }

  // MARK: The page's API

  setState(state: TownState, extra: TownEvent[] = []) {
    if (!this.tubes) { this.pending = { state, events: extra }; return; }
    this.touch(80);
    const first = this.state.committees.length === 0 && !this.shops.size;
    const events = [...diff(first ? undefined : this.state, state), ...extra];
    const before = new Set(this.shops.keys());
    const after = state.committees.map((c) => c.name);
    const added = first ? [] : after.filter((n) => !before.has(n));
    const changed = first || added.length > 0 || before.size !== after.length || after.some((n) => !before.has(n));
    this.state = state;
    if (changed) this.build(added);
    else this.refresh();
    if (this.room?.sys.isActive()) this.room.refresh(state);
    this.perform(this.director.accept(events, new Set(senatorsOf(state).keys()), this.reduceMotion));
    if (!this.moved) this.fit();
  }

  act(events: TownEvent[]) {
    if (!this.tubes) return;
    this.touch(80);
    this.perform(this.director.accept(events, new Set(senatorsOf(this.state).keys()), this.reduceMotion));
  }

  setDark(dark: boolean) {
    this.dark = dark;
    if (this.wash) this.applyDaylight();
  }

  fit() {
    const cam = this.cameras.main;
    const b = bounds(this.plan);
    const zoom = Math.min(cam.width / b.w, cam.height / b.h);
    cam.setZoom(Phaser.Math.Clamp(zoom, 0.15, 3));
    cam.centerOn(b.x + b.w / 2, b.y + b.h / 2);
    this.placeWash();
    this.touch();
  }

  /** Frame one place up close (snapshots): the Speaker's house, the monument quarter, the hall, the memory hall. */
  look(where: string, zoom: number) {
    const c = this.plan.civic;
    const at = where === "speaker" ? c.townHall : where === "quarters" ? { x: c.monuments.x - 30, y: c.monuments.y } : where === "memory" ? c.memory : c.hall;
    const cam = this.cameras.main;
    cam.setZoom(zoom * (this.scale.gameSize.width / 1400));
    cam.centerOn(at.x, at.y);
    this.moved = true;
    this.placeWash();
    this.touch();
  }

  zoomAt(factor: number, sx: number, sy: number) {
    const cam = this.cameras.main;
    const before = cam.getWorldPoint(sx, sy);
    cam.setZoom(Phaser.Math.Clamp(cam.zoom * factor, 0.15, 4));
    const after = cam.getWorldPoint(sx, sy);
    cam.scrollX += before.x - after.x;
    cam.scrollY += before.y - after.y;
    this.placeWash();
    this.touch();
  }

  private placeWash() {
    const cam = this.cameras.main;
    const w = cam.width / cam.zoom, h = cam.height / cam.zoom;
    this.wash?.setSize(w + 4, h + 4).setPosition((cam.width - w) / 2 - 2, (cam.height - h) / 2 - 2);
  }

  private onResize() {
    const { width, height } = this.scale.gameSize;
    const size = `${Math.round(width)}x${Math.round(height)}`;
    if (size === this.lastSize) return;
    this.lastSize = size;
    this.cameras.main.setSize(width, height);
    this.placeWash();
    if (!this.moved && this.shops.size) this.fit();
    this.touch();
  }

  /** The light over the town now: the clock's, or night when dark. */
  private applyDaylight() {
    const when = this.fixedTime ?? daylight(new Date(), this.dark);
    const w = WASH[when];
    this.wash.setFillStyle(w.color, 1).setAlpha(w.alpha).setVisible(w.alpha > 0);
    for (const g of this.glows) g.setVisible(w.glow);
    this.lit.setVisible(w.glow);
    this.touch(50);
  }

  // MARK: Building

  private hitbox(obj: Phaser.GameObjects.GameObject & { setInteractive: Function }, target: () => Target | undefined) {
    obj.setInteractive({ useHandCursor: true });
    obj.on("pointerover", (p: Phaser.Input.Pointer) => { const t = target(); if (t) this.hooks.hover(t, p.x, p.y); });
    obj.on("pointerout", () => this.hooks.hover(undefined, 0, 0));
    obj.on("pointerup", () => { const t = target(); if (t && !this.dragging) this.hooks.open(t); });
    return obj;
  }

  private add2<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.dynamic.push(obj);
    return obj;
  }

  private glowAt(x: number, y: number, scale: number) {
    const g = this.add.image(x, y, "glow").setBlendMode(Phaser.BlendModes.ADD).setScale(scale).setAlpha(0.75).setDepth(9_001);
    this.glows.push(g);
    return g;
  }

  /** Everything again: the committees changed. */
  private build(added: string[] = []) {
    const kept = this.plan.slots;
    // Whatever was moving belonged to the old town: stop it all.
    this.tweens.killAll();
    this.busy = 0;
    this.constructing = 0;
    for (const o of this.dynamic) o.destroy();
    this.dynamic = [];
    for (const g of this.glows) g.destroy();
    this.glows = [];
    this.shops.clear();
    this.elders.clear();
    this.gates.clear();
    this.heldCapsules.clear();
    this.director.reset();
    this.civilians = [];
    this.plan = plan(this.state.committees.map((c) => c.name), kept);
    this.specs = houses(this.state.committees.map((c) => c.name), new Map(this.state.committees.map((k) => [k.name, k.card])));
    const p = this.plan, c = p.civic;

    this.drawGrounds();
    // Trees from the map, where nothing stands.
    const keep = (t: Pt) =>
      Math.hypot(t.x, t.y) > p.outer + 140 && Math.hypot(t.x - c.memory.x, t.y - c.memory.y) > 300 &&
      Math.hypot(t.x - c.monuments.x, t.y - c.monuments.y) > 330 && Math.abs(t.x - c.rail) > 120 &&
      Math.abs(t.x - c.gate.x) > 90 && Math.abs(t.y - (c.parent.y + 90)) > 140 &&
      c.children.every((k) => Math.hypot(t.x - k.x, t.y - k.y) > 200);
    for (const t of this.treesFromMap.filter(keep)) this.add2(sprite(this, t.x, t.y, "tree").setDepth(t.y));

    this.drawTubes();
    // The sorting hall, its wheel; the archive with a reel row per committee; the town hall and its docket.
    this.add2(this.hitbox(sprite(this, 0, 0, "hall").setDepth(1), () => ({ kind: "hall", passed: this.passed })));
    this.wheel = sprite(this, 0, 0, "wheel").setDepth(2);
    this.add2(this.wheel);
    this.glowAt(0, 0, 3.2);
    const civic = (x: number, y: number, key: string) => sprite(this, x, y, key).setScale(0.5 * CIVIC_SCALE).setDepth(y);
    this.add2(this.hitbox(civic(c.archive.x, c.archive.y, "archive"), () => ({ kind: "archive", filed: [...this.reels.entries()] })));
    this.reelLayer = this.add.container(c.archive.x, c.archive.y).setDepth(c.archive.y + 1).setScale(CIVIC_SCALE);
    this.add2(this.reelLayer);
    // The Speaker's house: the desk's home, where the secretaries work.
    speakerHouse(this);
    this.add2(this.hitbox(civic(c.townHall.x, c.townHall.y, "speaker"),
      () => ({ kind: "townhall", docket: this.state.hall?.docket ?? 0, secretary: this.state.hall?.secretary })));
    this.add2(sprite(this, c.townHall.x + 1, c.townHall.y - 105 * CIVIC_SCALE, "speaker-flag").setOrigin(0, 1).setScale(0.5 * CIVIC_SCALE).setDepth(c.townHall.y));
    this.docket = this.add.container(c.townHall.x, c.townHall.y).setDepth(c.townHall.y + 2).setScale(CIVIC_SCALE);
    this.add2(this.docket);
    this.glowAt(c.townHall.x, c.townHall.y + 20, 2.4);
    this.add2(this.hitbox(sprite(this, c.memory.x, c.memory.y, "memory").setDepth(c.memory.y),
      () => ({ kind: "memory", sessions: this.state.history ?? 0 })));
    this.glowAt(c.memory.x, c.memory.y + 10, 2.2);
    for (const [i, q] of c.promenade.entries()) if (i % 2 === 0) this.add2(sprite(this, q.x + 60, q.y + 10, "bench").setDepth(q.y));
    this.add2(this.hitbox(sprite(this, c.gate.x, c.gate.y, "towngate").setDepth(c.gate.y), () => ({ kind: "gatehouse" })));
    this.drawBeyond();

    // The empty lots: paved pads where a new committee will build.
    const pads = this.add.graphics().setDepth(-12_500);
    this.add2(pads);
    for (const e of p.empty) {
      pads.fillStyle(PALETTE.pavingEdge, 0.55).fillRoundedRect(e.at.x - 90, e.at.y - 50, 180, 110, 16);
    }
    for (const committee of this.state.committees) {
      const slot = p.slots.get(committee.name);
      if (slot) this.buildShop(committee.name, slot);
    }
    this.drawReels();
    this.refresh();
    this.populate();
    this.applyDaylight();
    // Committees created while the town is open are built before your eyes (two at a time).
    for (const name of added.slice(0, 2)) this.construct(name);
    this.touch();
  }

  // MARK: Townspeople

  /** Civilians on the ring road: ambient life, recruited as workers and builders. */
  private populate() {
    const n = Math.max(4, Math.min(12, 4 + Math.round(this.state.committees.length / 3)));
    const rnd = seeded("townspeople");
    const r0 = this.roadRadius();
    for (let i = 0; i < n; i++) {
      const look = generateLook(`civilian-${i}`);
      const shirt = CIVILIAN_SHIRTS[i % CIVILIAN_SHIRTS.length]!;
      // On the ring road, but never in the civic wedge north of the hall.
      const angle = -Math.PI / 2 + WEDGE + 0.15 + rnd() * (2 * Math.PI - 2 * WEDGE - 0.3);
      const img = sprite(this, Math.cos(angle) * r0, Math.sin(angle) * r0 - 14, character(this, look, shirt)).setDepth(Math.sin(angle) * r0);
      this.add2(this.hitbox(img, () => ({ kind: "civilian" })));
      this.civilians.push({ img, look, shirt, angle, busy: false });
    }
    this.strollCivilians();
  }

  private roadRadius() {
    const rings = [...this.plan.slots.values()].map((s) => Math.hypot(s.at.x, s.at.y));
    return Math.min(...rings, 560) - WORKSHOP.h / 2 - 34;
  }

  private civStroll?: Phaser.Time.TimerEvent;

  /** Every half minute the townspeople take a few steps round the ring road, together (so the town is still in between). */
  private strollCivilians() {
    this.civStroll?.remove();
    if (this.reduceMotion) return;
    const rnd = seeded(`civ-${this.time0}`);
    this.civStroll = this.time.addEvent({ delay: 30_000, loop: true, callback: () => {
      const r0 = this.roadRadius();
      this.touch();
      for (const c of this.civilians) {
        if (c.busy) continue;
        const lo = -Math.PI / 2 + WEDGE + 0.15, hi = 1.5 * Math.PI - WEDGE - 0.15;
        const from = c.angle, to = Math.min(hi, Math.max(lo, from + (rnd() < 0.5 ? -1 : 1) * (0.12 + rnd() * 0.18)));
        const st = { a: from };
        this.busy++;
        this.tweens.add({ targets: st, a: to, duration: 3200, ease: "Sine.InOut",
          onUpdate: () => { c.angle = st.a; c.img.setPosition(Math.cos(st.a) * r0, Math.sin(st.a) * r0 - 14).setDepth(Math.sin(st.a) * r0); },
          onComplete: () => { this.busy--; } });
      }
    } });
  }

  /** A free townsperson nearest a point, taken off the street for a job. */
  private recruit(at: Pt): Civilian | undefined {
    let best: Civilian | undefined, d = Infinity;
    for (const c of this.civilians) {
      if (c.busy) continue;
      const k = Math.hypot(c.img.x - at.x, c.img.y - at.y);
      if (k < d) { d = k; best = c; }
    }
    if (best) best.busy = true;
    return best;
  }

  /** Back to strolling. */
  private dismiss(c: Civilian, done: () => void) {
    const r0 = this.roadRadius();
    c.img.setTexture(character(this, c.look, c.shirt));
    this.tweens.add({ targets: c.img, x: Math.cos(c.angle) * r0, y: Math.sin(c.angle) * r0 - 14, duration: this.reduceMotion ? 1 : 1400,
      onUpdate: () => c.img.setDepth(c.img.y), onComplete: () => { c.busy = false; done(); } });
  }

  // MARK: Construction

  /** Builders come, scaffolding goes up, the house rises, the senators move in. */
  private construct(name: string) {
    const shop = this.shops.get(name);
    if (!shop) return;
    this.constructing++;
    this.busy++;
    shop.root.setAlpha(0);
    const finish = () => {
      this.tweens.add({ targets: shop.root, alpha: 1, duration: this.reduceMotion ? 400 : 600,
        onComplete: () => { this.constructing--; this.busy--; } });
    };
    if (this.reduceMotion) { finish(); return; }
    const at = shop.slot.at, { w, h } = shop.size;
    const scaffold = this.add2(this.add.graphics().setDepth(at.y + 2));
    const rising = this.add2(sprite(this, at.x, at.y, houseArt(this, shop.spec).key));
    const H = rising.height, Wt = rising.width;
    rising.setOrigin(0.5, (HOUSE_TOP + h / 2) / (h + HOUSE_TOP + 10)).setDepth(at.y + 1).setCrop(0, H, Wt, 0);
    const builders = [this.recruit(at), this.recruit(at)].filter((b): b is Civilian => !!b);
    const spots = [{ x: at.x - w / 2 - 18, y: at.y + h / 2 + 6 }, { x: at.x + w / 2 + 18, y: at.y + h / 2 + 6 }];
    builders.forEach((b, i) => {
      b.img.setTexture(character(this, b.look, b.shirt, { pose: "work", hardhat: true }));
      this.tweens.add({ targets: b.img, x: spots[i]!.x, y: spots[i]!.y, duration: 1500, onUpdate: () => b.img.setDepth(b.img.y + 400) });
      this.tweens.add({ targets: b.img, angle: { from: -6, to: 6 }, duration: 200, yoyo: true, repeat: 14, delay: 1500 });
    });
    const t = { k: 0 };
    this.time.delayedCall(1400, () => {
      // Scaffolding up.
      scaffold.lineStyle(4, PALETTE.woodDark, 1);
      for (let k = 0; k <= 4; k++) scaffold.beginPath().moveTo(at.x - w / 2 - 8 + (k * (w + 16)) / 4, at.y + h / 2).lineTo(at.x - w / 2 - 8 + (k * (w + 16)) / 4, at.y - h / 2 - 30).strokePath();
      for (let k = 0; k < 4; k++) scaffold.beginPath().moveTo(at.x - w / 2 - 14, at.y + h / 2 - 10 - k * (h + 20) / 4).lineTo(at.x + w / 2 + 14, at.y + h / 2 - 10 - k * (h + 20) / 4).strokePath();
      // The house rises from the ground.
      this.tweens.add({ targets: t, k: 1, duration: 3800, ease: "Sine.InOut",
        onUpdate: () => rising.setCrop(0, H * (1 - t.k), Wt, H * t.k),
        onComplete: () => {
          scaffold.destroy();
          this.tweens.add({ targets: rising, alpha: 0, duration: 500, delay: 300, onComplete: () => rising.destroy() });
          let left = builders.length;
          if (!left) finish();
          for (const b of builders) { b.img.setAngle(0); this.dismiss(b, () => { if (--left === 0) finish(); }); }
        } });
    });
  }

  // MARK: Inside a house

  /** Go into a committee's house (double-click, Enter, or the page's API). */
  enter(name: string) {
    const shop = this.shops.get(name);
    if (!shop || this.roomName) return;
    this.roomName = name;
    this.hooks.hover(undefined, 0, 0);
    this.input.enabled = false;
    this.cameras.main.setVisible(false);
    this.wash.setVisible(false);
    this.scene.launch("room", { committee: name, state: this.state, spec: shop.spec, hooks: this.hooks,
      reduceMotion: this.reduceMotion, onExit: () => this.leave() });
    this.room = this.scene.get("room") as Room;
    this.hooks.room?.(name);
    this.touch(1500);
  }

  /** Back out to the town. */
  leave() {
    if (!this.roomName) return;
    this.scene.stop("room");
    this.roomName = undefined;
    this.room = undefined;
    this.input.enabled = true;
    this.cameras.main.setVisible(true);
    this.applyDaylight();
    this.hooks.room?.(undefined);
    this.touch();
  }

  /** Plaza rings, the ring road, the promenade, the river, the rail. */
  private drawGrounds() {
    const g = this.add.graphics().setDepth(-20_000);
    this.add2(g);
    const p = this.plan, c = p.civic;
    const rings = new Set([...p.slots.values()].map((s) => Math.round(Math.hypot(s.at.x, s.at.y))));
    // The paved plaza within the first ring road.
    const inner = Math.min(...rings, 560) - WORKSHOP.h / 2 - 34;
    g.fillStyle(PALETTE.paving, 1).fillCircle(0, 0, inner);
    g.lineStyle(3, PALETTE.pavingEdge, 1);
    for (let k = 1; k < 4; k++) g.strokeCircle(0, 0, (inner * k) / 4);
    for (const r of rings) {
      g.lineStyle(46, PALETTE.pavingEdge, 1).strokeCircle(0, 0, r - WORKSHOP.h / 2 - 34);
      g.lineStyle(40, PALETTE.road, 1).strokeCircle(0, 0, r - WORKSHOP.h / 2 - 34);
    }
    // The promenade by the memory hall.
    g.lineStyle(36, PALETTE.road, 1).strokePoints(c.promenade.map((q) => new Phaser.Math.Vector2(q.x, q.y)), true, true);
    // The river before the parent Senate.
    const ry = c.parent.y + 110;
    g.fillStyle(PALETTE.water, 1).fillRect(c.gate.x - 400, ry - 30, c.rail - c.gate.x + 900, 60);
    // The rail on the east, sleepers and two rails.
    const y0 = -p.outer - 500, y1 = p.outer + 500;
    g.fillStyle(PALETTE.woodDark, 1);
    for (let y = y0; y < y1; y += 22) g.fillRect(c.rail - 26, y, 52, 8);
    g.lineStyle(5, PALETTE.rail, 1).beginPath().moveTo(c.rail - 16, y0).lineTo(c.rail - 16, y1).moveTo(c.rail + 16, y0).lineTo(c.rail + 16, y1).strokePath();
    // The road out west to the town gate.
    g.lineStyle(40, PALETTE.road, 1).beginPath().moveTo(c.gate.x, c.gate.y + 30).lineTo(-p.outer + 60, c.gate.y + 30).strokePath();
  }

  private drawTubes() {
    const g = this.tubes;
    g.clear();
    for (const [name, slot] of this.plan.slots) {
      const pts = tube(slot);
      // A tube whose workshop is at work is clear; the others fade back.
      const busy = this.state.committees.find((c) => c.name === name)?.senators.some((s) => s.mood === "working" || s.mood === "waiting");
      const a = busy ? 1 : 0.35;
      const curve = new Phaser.Curves.QuadraticBezier(
        new Phaser.Math.Vector2(pts[0]!.x, pts[0]!.y), new Phaser.Math.Vector2(pts[1]!.x, pts[1]!.y), new Phaser.Math.Vector2(pts[2]!.x, pts[2]!.y));
      g.lineStyle(22, PALETTE.glassEdge, a);
      curve.draw(g, 32);
      g.lineStyle(16, PALETTE.glass, a);
      curve.draw(g, 32);
      g.lineStyle(4, 0xffffff, 0.8 * a);
      curve.draw(g, 32);
    }
    // The archive's short tube from the hall.
    const [from, to] = this.archiveTube();
    g.lineStyle(22, PALETTE.glassEdge, 1).beginPath().moveTo(from.x, from.y).lineTo(to.x, to.y).strokePath();
    g.lineStyle(16, PALETTE.glass, 1).beginPath().moveTo(from.x, from.y).lineTo(to.x, to.y).strokePath();
  }

  /** From the hall's rim to the archive's door. */
  private archiveTube(): [Pt, Pt] {
    const a = this.plan.civic.archive;
    const d = Math.hypot(a.x, a.y), ux = a.x / d, uy = a.y / d;
    return [{ x: ux * (HALL_R - 6), y: uy * (HALL_R - 6) }, { x: a.x - ux * 60, y: a.y - uy * 60 }];
  }

  private buildShop(name: string, slot: Slot) {
    const spec = this.specs.get(name) ?? generateHouse(name);
    const art = houseArt(this, spec);
    const { w, h } = houseSize(spec);
    const root = this.add.container(slot.at.x, slot.at.y).setDepth(slot.at.y);
    this.add2(root);
    // The garden first (behind), then the house.
    const rnd = seeded(`garden:${name}`);
    const gardenSpots = [{ x: -w / 2 - 22, y: h / 2 - 8 }, { x: w / 2 + 22, y: h / 2 - 8 }, { x: -w / 2 - 26, y: -h / 2 + 30 }];
    spec.plants.forEach((species, i) => {
      const sp = gardenSpots[i]!;
      root.add(sprite(this, sp.x, sp.y - 20, plant(this, species, Math.floor(rnd() * 4))));
    });
    const g = this.add.graphics();
    if (spec.garden === "flowers") for (let i = 0; i < 9; i++) g.fillStyle([0xffb7c5, 0xfff2a8, 0xffffff, 0xd6bfe6][i % 4]!, 1).fillCircle(-w / 2 + 14 + i * 8, h / 2 + 12, 3.5);
    if (spec.garden === "hedge") g.fillStyle(PALETTE.leafDark, 1).fillRoundedRect(-w / 2, h / 2 + 6, w * 0.32, 12, 6).fillRoundedRect(w / 2 - w * 0.32, h / 2 + 6, w * 0.32, 12, 6);
    if (spec.garden === "rocks") for (let i = 0; i < 4; i++) g.fillStyle(PALETTE.stoneDark, 1).fillEllipse(w / 2 - 20 - i * 14, h / 2 + 12, 10, 7);
    if (spec.garden === "pond") g.fillStyle(PALETTE.water, 1).fillEllipse(w / 2 + 10, h / 2 + 16, 46, 18).lineStyle(2, INK, 1).strokeEllipse(w / 2 + 10, h / 2 + 16, 46, 18);
    root.add(g);
    if (spec.landmark !== "none") root.add(sprite(this, w / 2 + 34, -h / 2 + 10, landmark(this, spec.landmark, COLOURS[spec.trim]!)).setOrigin(0.5, 0.75));
    const body = sprite(this, 0, 0, art.key).setOrigin(0.5, (HOUSE_TOP + h / 2) / (h + HOUSE_TOP + 10));
    root.add(body);
    let clickTimer: Phaser.Time.TimerEvent | undefined;
    const target = (): Target => {
      const c = this.state.committees.find((k) => k.name === name);
      return { kind: "workshop", name, senators: c?.senators.length ?? 0, waiting: c?.waiting?.length ?? 0 };
    };
    body.setInteractive({ useHandCursor: true });
    body.on("pointerover", (p: Phaser.Input.Pointer) => { this.hovered = name; this.hooks.hover(target(), p.x, p.y); });
    body.on("pointerout", () => { this.hovered = undefined; this.hooks.hover(undefined, 0, 0); });
    body.on("pointerup", () => {
      if (this.dragging) return;
      // A double click goes in; a single click (once it is clearly single) opens the committee.
      if (clickTimer) { clickTimer.remove(); clickTimer = undefined; this.enter(name); return; }
      clickTimer = this.time.delayedCall(320, () => { clickTimer = undefined; this.hooks.open(target()); });
      this.touch(400);
    });
    const places = bayPlaces(spec);
    const bays: Shop["bays"] = places.xs.map((x) => {
      const win = sprite(this, x, places.y, bay(this, false)).setScale(0.5 * places.scale);
      root.add(win);
      return { window: win };
    });
    // The signal by this end of the tube.
    const s0 = signalAt(slot);
    const post = sprite(this, s0.x + 18, s0.y - 16, "signal").setDepth(s0.y);
    this.add2(post);
    const lamp = sprite(this, s0.x + 18, s0.y - 31, "lamp-green").setDepth(s0.y + 1);
    this.add2(lamp);
    this.hitbox(post, () => ({ kind: "signal", committee: name, held: this.shops.get(name)?.held ? "a delivery is held" : undefined }));
    this.shops.set(name, { name, slot, root, bays, lamp, held: 0, extras: [], spec, size: { w, h }, bayY: places.y });
    this.reels.set(name, this.reels.get(name) ?? 0);
  }

  /** The districts beyond: the parent across the river, children south, the rail's station. */
  private drawBeyond() {
    const c = this.plan.civic, links = this.state.links;
    const sky = sprite(this, c.parent.x, c.parent.y, "skyline").setDepth(c.parent.y);
    this.add2(this.hitbox(sky, () => ({ kind: "link", link: "parent", name: links?.parent?.name ?? "/acme", up: links?.parent?.up ?? true })));
    this.glowAt(c.parent.x, c.parent.y, 4);
    // The uplink: an elevated line on pillars from the hall over the river.
    const g = this.add.graphics().setDepth(-14_000);
    this.add2(g);
    const top = c.parent.y + 60;
    g.fillStyle(PALETTE.stoneDark, 1);
    for (let y = top + 40; y < -HALL_R - 20; y += 90) g.fillRoundedRect(-8, y, 16, 34, 4);
    g.lineStyle(14, INK, 1).beginPath().moveTo(0, -HALL_R + 4).lineTo(0, top).strokePath();
    g.lineStyle(9, PALETTE.amber, 1).beginPath().moveTo(0, -HALL_R + 4).lineTo(0, top).strokePath();
    const walls = [0xf6a97a, 0x9fd3ea, 0xbfe39a, 0xffd57e, 0xd6bfe6];
    (links?.children ?? [{ name: "ci-runner", up: true }, { name: "bob-desk", up: true }]).slice(0, c.children.length).forEach((child, i) => {
      const at = c.children[i]!;
      g.lineStyle(30, PALETTE.road, 1).beginPath().moveTo(at.x * 0.3, this.plan.outer * 0.55).lineTo(at.x, at.y - 40).strokePath();
      for (let k = 0; k < 3; k++) {
        const h = sprite(this, at.x - 70 + k * 70, at.y + (k % 2) * 24, cottage(this, walls[(i * 3 + k) % walls.length]!)).setDepth(at.y + k);
        this.add2(this.hitbox(h, () => ({ kind: "link", link: "child", name: child.name, up: child.up })));
      }
    });
    const remote = links?.remotes?.[0] ?? { name: "studio-mini", up: true };
    const t = sprite(this, c.rail, 120, "train").setDepth(130);
    this.add2(this.hitbox(t, () => ({ kind: "link", link: "remote", name: remote.name, up: remote.up })));
    t.setName("train");
    this.drawMonuments();
  }

  private drawMonuments() {
    const c = this.plan.civic;
    const projects = this.state.projects ?? [];
    const quarters = new Map<string, Pt>();
    projects.slice(0, 4).forEach((proj, pi) => {
      const style = (STYLES as readonly string[]).includes(proj.style ?? "") ? (proj.style as Style)
        : STYLES[Number(hash(proj.name) % BigInt(STYLES.length))]!;
      const ox = c.monuments.x - 200 + (pi % 2) * 260, oy = c.monuments.y - 60 + Math.floor(pi / 2) * 220;
      quarters.set(proj.id, { x: ox, y: oy });
      const g = this.add.graphics().setDepth(-13_000);
      this.add2(g);
      g.fillStyle(PALETTE.paving, 1).fillRoundedRect(ox - 20, oy - 110, 250, 190, 18);
      g.lineStyle(3, PALETTE.pavingEdge, 1).strokeRoundedRect(ox - 20, oy - 110, 250, 190, 18);
      const rel = proj.releases.slice(-5);
      rel.forEach((r, i) => {
        const m = sprite(this, ox + 20 + i * 44, oy, monument(this, style, 28 + Math.min(r.merges, 25) * 3));
        m.setOrigin(0.5, 1).setDepth(oy);
        this.add2(this.hitbox(m, () => ({ kind: "monument", project: proj, release: r })));
      });
      if (proj.unreleased) {
        const x = ox + 20 + rel.length * 44;
        const m = sprite(this, x, oy, monument(this, style, 26)).setOrigin(0.5, 1).setAlpha(0.55).setDepth(oy);
        this.add2(this.hitbox(m, () => ({ kind: "monument", project: proj, next: true })));
        g.lineStyle(3, PALETTE.woodDark, 1);
        for (let k = 0; k < 3; k++) g.beginPath().moveTo(x - 18 + k * 18, oy).lineTo(x - 18 + k * 18, oy - 64).strokePath();
        for (let k = 0; k < 3; k++) g.beginPath().moveTo(x - 22, oy - 14 - k * 22).lineTo(x + 22, oy - 14 - k * 22).strokePath();
      }
    });
    // An archived committee's house stays, boarded up, in its project's quarter.
    (this.state.archived ?? []).slice(0, 4).forEach((a, i) => {
      const q = quarters.get(a.project ?? "") ?? [...quarters.values()][0] ?? c.monuments;
      const spec = readHouse(a.card, generateHouse(a.name));
      const at = { x: q.x + 190 - i * 8, y: q.y + 52 + i * 6 };
      const img = sprite(this, at.x, at.y, houseArt(this, spec).key).setScale(0.5 * 0.42).setTint(0xb9b4ae).setDepth(at.y + 5);
      this.add2(this.hitbox(img, () => ({ kind: "archived", archived: a })));
      this.add2(sprite(this, at.x, at.y + 10, boards(this)).setScale(0.5 * 0.42).setDepth(at.y + 6));
    });
  }

  /** People, lights, signals, gates, the docket, elders: the state as it is now. */
  private refresh() {
    for (const shop of this.shops.values()) {
      for (const o of shop.extras) {
        const i = this.glows.indexOf(o as Phaser.GameObjects.Image);
        if (i >= 0) this.glows.splice(i, 1);
        o.destroy();
      }
      shop.extras = [];
      const committee = this.state.committees.find((c) => c.name === shop.name);
      const senators = committee?.senators ?? [];
      shop.bays.forEach((b, i) => {
        b.who?.destroy();
        b.who = undefined;
        b.id = undefined;
        const s = senators[i];
        const on = s?.mood === "working" || s?.mood === "waiting";
        b.window.setTexture(bay(this, on));
        b.window.removeAllListeners();
        if (!s || s.mood === "stopped") return;
        const pose = s.mood === "waiting" ? "wave" : s.mood === "working" ? "work" : "stand";
        const look = readLook(s.card, generateLook(s.id));
        const who = sprite(this, b.window.x, b.window.y + 2, character(this, look, RUNTIME[s.runtime], { pose, chair: s.chair, glyph: s.runtime }));
        if (s.mood === "paused") who.setAngle(-80).setY(b.window.y + 12).setAlpha(0.7);
        shop.root.add(who);
        b.who = who;
        b.id = s.id;
        this.hitbox(who, () => ({ kind: "senator", senator: senatorsOf(this.state).get(s.id) ?? s, committee: shop.name }));
        this.hitbox(b.window, () => ({ kind: "senator", senator: senatorsOf(this.state).get(s.id) ?? s, committee: shop.name }));
        if (s.watched) {
          const viewer = sprite(this, b.window.x + 6, shop.size.h / 2 - 6, character(this, generateLook("viewer"), 0x9a9ab0));
          shop.root.add(viewer);
          shop.extras.push(viewer);
        }
      });
      // A sill over the bays' foot, so the senators sit inside.
      const wall = COLOURS[shop.spec.wall]!;
      const sill = this.add.rectangle(0, shop.bayY + 26, shop.size.w - 36, 10, wall).setStrokeStyle(2, INK);
      shop.root.add(sill);
      shop.extras.push(sill);
      const litBays = shop.bays.filter((b) => b.window.texture.key === "bay-lit");
      for (const b of litBays) {
        shop.extras.push(this.glowAt(shop.slot.at.x + b.window.x, shop.slot.at.y + b.window.y, 0.9)
          .setVisible(WASH[this.fixedTime ?? daylight(new Date(), this.dark)].glow));
      }
      // Something waiting on the person: a visitor with a letter by the door.
      const first = committee?.waiting?.[0];
      if (first) {
        const v = sprite(this, 50, shop.size.h / 2 + 12, character(this, generateLook("visitor"), PALETTE.amber, { pose: "wave" }));
        shop.root.add(v);
        shop.extras.push(v);
        this.hitbox(v, () => ({ kind: "waiting", thread: first, person: this.state.person }));
      }
    }
    // Approval gates: shut before the workshop until a person signs.
    for (const a of this.state.approvals ?? []) this.raiseGate(a);
    this.drawDocket();
    this.drawElders();
    this.drawTubes();
    this.drawTubeLights();
  }

  private gates = new Map<string, Phaser.GameObjects.Container>();

  private raiseGate(a: Approval) {
    if (this.gates.has(a.senator)) return;
    const home = homeOf(this.state, a.senator);
    const shop = home ? this.shops.get(home) : undefined;
    if (!shop) return;
    const p = along(tube(shop.slot), 0.08);
    const c = this.add.container(p.x, p.y).setDepth(p.y + 5);
    this.add2(c);
    c.add([sprite(this, -36, -10, "gate-post"), sprite(this, 36, -10, "gate-post")]);
    const bar = sprite(this, 0, -22, "barrier");
    c.add(bar);
    const signer = sprite(this, 52, 4, person(this, 0xd6a63b, { pose: "wave", hair: 0x2e2622 }));
    c.add(signer);
    for (const o of [bar, signer]) this.hitbox(o, () => ({ kind: "gate", approval: a }));
    c.setData("bar", bar).setData("signer", signer);
    this.gates.set(a.senator, c);
  }

  private openGate(senator: string) {
    const c = this.gates.get(senator);
    if (!c) return;
    this.gates.delete(senator);
    const bar = c.getData("bar") as Phaser.GameObjects.Image, signer = c.getData("signer") as Phaser.GameObjects.Image;
    this.busy++;
    this.tweens.add({
      targets: bar, angle: -80, x: -30, y: -50, duration: this.reduceMotion ? 1 : 500,
      onComplete: () => this.tweens.add({ targets: [c], alpha: 0, delay: 1200, duration: 500, onComplete: () => { c.destroy(); this.busy--; } }),
    });
    this.tweens.add({ targets: signer, x: 120, alpha: 0, duration: this.reduceMotion ? 1 : 900 });
  }

  /** The Speaker's house: secretaries at the desk window, the docket on the porch, the person at home. */
  private drawDocket() {
    this.docket.removeAll(true);
    const n = Math.min(this.state.hall?.docket ?? 0, 12);
    for (let i = 0; i < n; i++) this.docket.add(sprite(this, 88 + (i % 2) * 2, 70 - i * 5, "sheet"));
    const sec = this.state.hall?.secretary;
    if (sec) {
      const look = readLook(sec.card, generateLook(sec.id));
      const s = sprite(this, -60, 22, character(this, look, RUNTIME[sec.runtime], { pose: sec.mood === "working" ? "work" : "sit", glyph: sec.runtime }));
      this.docket.add(s);
      this.hitbox(s, () => ({ kind: "senator", senator: sec }));
    }
    if (this.state.person) {
      const me = sprite(this, 0, 78, character(this, generateLook(`person:${this.state.person}`), 0xd6a63b, { pose: "wave" }));
      this.docket.add(me);
    }
  }

  private drawElders() {
    for (const e of this.elders.values()) e.destroy();
    this.elders.clear();
    const prom = this.plan.civic.promenade;
    (this.state.elders ?? []).slice(0, 10).forEach((e, i) => {
      const age = e.idle > 14 * 86_400 ? 3 : e.idle > 86_400 ? 2 : 1;
      const hair = [0, 0x8d7b6e, 0xc9c3bc, 0xf4f1ec][age]!;
      const shirt = Phaser.Display.Color.IntegerToColor(RUNTIME[e.runtime]).lighten(18 + age * 6).color;
      const leg = i % prom.length, t = (i * 0.37) % 1;
      const a = prom[leg]!, b = prom[(leg + 1) % prom.length]!;
      const at = age >= 3 ? { x: prom[(i % 2) * 2]!.x + 60 + (i % 3) * 14, y: prom[(i % 2) * 2]!.y + 2 } : { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const base = generateLook(e.id);
      const look: Look = { ...base, hairColour: 5, hair: age >= 3 && base.hair === "long" ? "bun" : base.hair, hat: age >= 2 ? base.hat : "none" };
      void hair;
      const img = sprite(this, at.x, at.y - 18, character(this, look, shirt, { cane: age >= 2, pose: age >= 3 ? "sit" : "stand" })).setDepth(at.y);
      if (age >= 2) img.setAngle(age === 2 ? 4 : 0);
      this.add2(this.hitbox(img, () => ({ kind: "elder", elder: e })));
      img.setData("leg", leg).setData("age", age);
      this.elders.set(e.id, img);
    });
    this.scheduleStroll();
  }

  private strolling?: Phaser.Time.TimerEvent;

  /** Now and then an elder takes a few slow steps along the promenade. */
  private scheduleStroll() {
    this.strolling?.remove();
    if (this.reduceMotion) return;
    const rnd = seeded(`stroll-${this.time0}`);
    this.strolling = this.time.addEvent({
      delay: 40_000, loop: true, callback: () => {
        const walkers = [...this.elders.values()].filter((e) => (e.getData("age") as number) < 3);
        const e = walkers[Math.floor(rnd() * walkers.length)];
        if (!e) return;
        const prom = this.plan.civic.promenade;
        const leg = ((e.getData("leg") as number) + 1) % prom.length;
        const to = prom[leg]!;
        const age = e.getData("age") as number;
        e.setData("leg", leg);
        this.busy++;
        this.touch();
        this.tweens.add({ targets: e, x: to.x, y: to.y - 18, duration: Math.hypot(to.x - e.x, to.y - e.y) / (age === 1 ? 60 : 35) * 1000,
          onUpdate: () => e.setDepth(e.y), onComplete: () => { this.busy--; } });
      },
    });
  }

  /** Tubes carrying something glow; the rest stay plain (at dusk and night). */
  private drawTubeLights() {
    this.lit.clear();
    for (const shop of this.shops.values()) {
      const c = this.state.committees.find((k) => k.name === shop.name);
      if (!c?.senators.some((s) => s.mood === "working")) continue;
      const pts = tube(shop.slot);
      const curve = new Phaser.Curves.QuadraticBezier(
        new Phaser.Math.Vector2(pts[0]!.x, pts[0]!.y), new Phaser.Math.Vector2(pts[1]!.x, pts[1]!.y), new Phaser.Math.Vector2(pts[2]!.x, pts[2]!.y));
      this.lit.lineStyle(10, PALETTE.glassLit, 0.55);
      curve.draw(this.lit, 32);
    }
  }

  // MARK: Acting

  private perform(actions: Action[]) {
    for (const a of actions) {
      switch (a.kind) {
        case "visit":
          this.send(a);
          if (this.room && this.roomName && (homeOf(this.state, a.from) === this.roomName || (a.to && homeOf(this.state, a.to) === this.roomName))) {
            this.room.capsule(a.from, a.to, a.thread, a.line, RUNTIME[senatorsOf(this.state).get(a.from)?.runtime ?? "other"]);
          }
          break;
        case "mood": this.refresh(); break;
        case "arrive": case "depart": this.refresh(); if (a.walk) this.perform(this.director.cameHome(a.senator)); break;
        case "settled": this.stamp(a.thread.committee); break;
        case "release": this.release(a.thread); break;
        case "tool":
          this.worker(a.senator, a.tool, a.target);
          if (this.room && homeOf(this.state, a.senator) === this.roomName) this.room.worker(a.senator, a.tool, a.target);
          break;
        case "signed": this.openGate(a.senator); break;
        case "link": this.linkPulse(a.link); break;
      }
    }
  }

  private shopOf(id: string | undefined): Shop | undefined {
    const home = id ? homeOf(this.state, id) : undefined;
    return home ? this.shops.get(home) : undefined;
  }

  private heldCapsules = new Map<string, () => void>();

  /** A message: out of the sender's tube, round the hall, stamped at the archive, down the receiver's tube. */
  private send(a: Extract<Action, { kind: "visit" }>) {
    const from = this.shopOf(a.from);
    const to = (a.to ? this.shopOf(a.to) : undefined) ?? this.shops.get(a.thread.committee);
    const color = RUNTIME[senatorsOf(this.state).get(a.from)?.runtime ?? "other"];
    const capKey = capsule(this, color);
    const cap = sprite(this, 0, 0, capKey).setDepth(5_000);
    cap.setScale(cap.scale * 1.5);
    this.add2(this.hitbox(cap, () => ({ kind: "capsule", from: a.from, to: a.to, thread: a.thread, line: a.line, held: a.held })));
    const done = () => { cap.destroy(); this.busy--; this.perform(this.director.cameHome(a.from)); };
    this.busy++;
    if (!a.walk) {
      // Reduce Motion: the capsule shows at the sender, then at the receiver.
      const p0 = from ? port(from.slot) : { x: 0, y: -HALL_R };
      const p1 = to ? port(to.slot) : { x: 0, y: 0 };
      cap.setPosition(p0.x, p0.y).setAlpha(0);
      this.tweens.chain({ tweens: [
        { targets: cap, alpha: 1, duration: 250 }, { targets: cap, alpha: 0, delay: 900, duration: 250 },
        { targets: cap, x: p1.x, y: p1.y, duration: 1 }, { targets: cap, alpha: 1, duration: 250 },
        { targets: cap, alpha: 0, delay: 1100, duration: 250 },
      ], onComplete: done } as unknown as Phaser.Types.Tweens.TweenChainBuilderConfig);
      this.stamp(a.thread.committee);
      return;
    }
    const legs: Phaser.Types.Tweens.TweenBuilderConfig[] = [];
    const follow = (pts: Pt[], reverse: boolean, until = 0) => {
      const state = { t: reverse ? 1 : 0 };
      const len = Math.hypot(pts[0]!.x - pts[2]!.x, pts[0]!.y - pts[2]!.y);
      legs.push({ targets: state, t: reverse ? until : 1, duration: (len / SPEED) * 1000 * (reverse ? 1 - until : 1), ease: "Sine.InOut",
        onUpdate: () => { const q = along(pts, state.t); cap.setPosition(q.x, q.y); } } as unknown as Phaser.Types.Tweens.TweenBuilderConfig);
    };
    // Out of the sender's workshop (a guest from elsewhere comes down the uplink).
    if (from) follow(tube(from.slot), false);
    else {
      const top = this.plan.civic.parent.y + 60;
      cap.setPosition(0, top);
      legs.push({ targets: cap, y: -HALL_R, duration: ((-HALL_R - top) / SPEED) * 1000 } as unknown as Phaser.Types.Tweens.TweenBuilderConfig);
      this.linkPulse("parent");
    }
    // Round the hall's wheel, to the archive to be stamped, back to the hall.
    const arc = { a: 0 };
    legs.push({ targets: arc, a: Math.PI, duration: 600, onStart: () => this.spin(),
      onUpdate: () => cap.setPosition(Math.cos(arc.a - Math.PI / 2) * 60, Math.sin(arc.a - Math.PI / 2) * 60) } as unknown as Phaser.Types.Tweens.TweenBuilderConfig);
    const arch = this.plan.civic.archive;
    const door = this.archiveTube()[1];
    void arch;
    legs.push({ targets: cap, x: door.x, y: door.y, duration: 380, onComplete: () => this.stamp(a.thread.committee) } as unknown as Phaser.Types.Tweens.TweenBuilderConfig);
    legs.push({ targets: cap, x: 0, y: 0, duration: 380, delay: 220 } as unknown as Phaser.Types.Tweens.TweenBuilderConfig);
    this.passed++;
    if (!to) {
      // Nobody in town to take it: up to the town hall.
      const th = this.plan.civic.townHall;
      legs.push({ targets: cap, x: th.x, y: th.y + 40, duration: 500 } as unknown as Phaser.Types.Tweens.TweenBuilderConfig);
      this.tweens.chain({ tweens: legs, onComplete: done } as unknown as Phaser.Types.Tweens.TweenChainBuilderConfig);
      return;
    }
    const pts = tube(to.slot);
    const rest = () => {
      // Down the receiver's tube to its door; the bay that receives it flashes.
      const st = { t: a.held ? 0.18 : 1 };
      this.tweens.add({ targets: st, t: 0, duration: (Math.hypot(pts[0]!.x - pts[2]!.x, pts[0]!.y - pts[2]!.y) / SPEED) * 1000 * st.t,
        onUpdate: () => { const q = along(pts, st.t); cap.setPosition(q.x, q.y); },
        onComplete: () => { this.flash(to, a.to); this.tweens.add({ targets: cap, alpha: 0, duration: 250, onComplete: done }); } });
    };
    if (a.held) {
      // Held: it waits at the receiver's red signal until released.
      follow(pts, true, 0.2);
      this.tweens.chain({ tweens: legs, onComplete: () => {
        to.held++;
        to.lamp.setTexture("lamp-red");
        this.busy--; // waiting is still: the loop may sleep
        this.heldCapsules.set(a.thread.committee + ":" + a.thread.root, () => {
          this.busy++;
          to.held = Math.max(0, to.held - 1);
          if (!to.held) to.lamp.setTexture("lamp-green");
          rest();
        });
      } } as unknown as Phaser.Types.Tweens.TweenChainBuilderConfig);
      return;
    }
    follow(pts, true);
    this.tweens.chain({ tweens: legs, onComplete: () => { this.flash(to, a.to); this.tweens.add({ targets: cap, alpha: 0, duration: 250, onComplete: done }); } } as unknown as Phaser.Types.Tweens.TweenChainBuilderConfig);
  }

  private release(thread: ThreadRef) {
    const key = thread.committee + ":" + thread.root;
    const go = this.heldCapsules.get(key);
    if (!go) return;
    this.heldCapsules.delete(key);
    this.touch();
    go();
  }

  private spin() {
    if (this.reduceMotion) return;
    this.tweens.add({ targets: this.wheel, angle: this.wheel.angle + 90, duration: 600, ease: "Cubic.Out" });
  }

  /** The archive files an entry: that committee's reel gains a mark. */
  private stamp(committee: string) {
    this.reels.set(committee, (this.reels.get(committee) ?? 0) + 1);
    this.drawReels(committee);
    this.stampFlash();
  }

  /** A reel per committee (the first seven), each as long as what was filed. */
  private drawReels(latest?: string) {
    const names = [...this.reels.keys()].sort();
    this.reelLayer.removeAll(true);
    names.slice(0, 7).forEach((n, row) => {
      const y = -46 + row * 15;
      const count = this.reels.get(n) ?? 0;
      const g = this.add.graphics();
      g.fillStyle(0x2c3657, 1).fillRoundedRect(-72, y - 5, 144, 10, 5);
      g.fillStyle(n === latest ? PALETTE.amber : 0x8fa0d6, 1).fillRoundedRect(-70, y - 3, Math.min(140, 6 + count * 6), 6, 3);
      this.reelLayer.add(g);
    });
  }

  private stampFlash() {
    if (!this.reduceMotion) {
      const s = this.add.image(this.plan.civic.archive.x + 66 * CIVIC_SCALE, this.plan.civic.archive.y - 74 * CIVIC_SCALE, "glow").setBlendMode(Phaser.BlendModes.ADD)
        .setScale(0.6).setAlpha(0).setDepth(9_100);
      this.busy++;
      this.tweens.chain({ tweens: [{ targets: s, alpha: 1, duration: 120 }, { targets: s, alpha: 0, duration: 400 }],
        onComplete: () => { s.destroy(); this.busy--; } } as unknown as Phaser.Types.Tweens.TweenChainBuilderConfig);
    }
  }

  private flash(shop: Shop, id: string | undefined) {
    const b = shop.bays.find((x) => x.id === id) ?? shop.bays[0]!;
    const s = this.add.image(shop.slot.at.x + b.window.x, shop.slot.at.y + b.window.y, "glow").setBlendMode(Phaser.BlendModes.ADD)
      .setScale(0.9).setAlpha(0).setDepth(9_100);
    this.busy++;
    this.tweens.chain({ tweens: [{ targets: s, alpha: 1, duration: 150 }, { targets: s, alpha: 0, duration: 600 }],
      onComplete: () => { s.destroy(); this.busy--; } } as unknown as Phaser.Types.Tweens.TweenChainBuilderConfig);
  }

  /** A tool call: a worker comes out of the door, works, and goes back in. */
  private worker(senator: string, kind: ToolKind, target?: string) {
    const shop = this.shopOf(senator);
    if (!shop) { this.director.workerHome(); return; }
    const door = { x: shop.slot.at.x + 20, y: shop.slot.at.y + 60 };
    const out = { x: door.x + (Math.cos(shop.slot.angle) * 50), y: door.y + 26 + Math.sin(shop.slot.angle) * 30 };
    const body = sprite(this, door.x, door.y, person(this, TOOLS[kind], { hair: 0x6b4f3a })).setDepth(door.y + 40);
    const held = sprite(this, door.x + 12, door.y - 4, toolArt(this, kind)).setDepth(door.y + 41);
    const both = [body, held];
    for (const o of both) this.add2(this.hitbox(o, () => ({ kind: "worker", senator, tool: kind, target })));
    this.busy++;
    const finish = () => { for (const o of both) o.destroy(); this.busy--; this.director.workerHome(); };
    if (this.reduceMotion) {
      for (const o of both) o.setAlpha(0);
      this.tweens.chain({ tweens: [{ targets: both, alpha: 1, duration: 200 }, { targets: both, alpha: 0, delay: 1800, duration: 200 }], onComplete: finish } as unknown as Phaser.Types.Tweens.TweenChainBuilderConfig);
      return;
    }
    const moveTo = (p: Pt, ms: number) => ({ targets: both, x: (o: Phaser.GameObjects.Image) => p.x + (o === held ? 12 : 0), y: (o: Phaser.GameObjects.Image) => p.y + (o === held ? -4 : 0), duration: ms });
    const steps: unknown[] = [moveTo(out, 350)];
    if (kind === "mcp") {
      // The courier takes a parcel to the MCP's building: the Senate's is the sorting hall.
      const rim = along(tube(shop.slot), 0.85);
      steps.push(moveTo(rim, 1400), { targets: held, alpha: 0, duration: 200 }, moveTo(out, 1400), { targets: held, alpha: 1, duration: 1 });
    } else if (kind === "web") {
      // The explorer leaves by the town gate.
      const gate = this.plan.civic.gate;
      steps.push(moveTo({ x: out.x, y: gate.y + 40 }, 900), moveTo({ x: gate.x, y: gate.y + 40 }, 1600), { targets: both, alpha: 0, duration: 300 });
    } else {
      // At work just outside: a hammer swings, a quill writes, a book opens, a lens looks round.
      const swing = kind === "bash" ? { targets: held, angle: -50, duration: 160, yoyo: true, repeat: 5 }
        : kind === "grep" ? { targets: held, x: held.x + 18, duration: 300, yoyo: true, repeat: 2 }
        : { targets: held, y: "-=4", duration: 250, yoyo: true, repeat: 3 };
      steps.push(swing);
    }
    steps.push(moveTo(door, 350), { targets: both, alpha: 0, duration: 150 });
    this.tweens.chain({ tweens: steps, onComplete: finish } as unknown as Phaser.Types.Tweens.TweenChainBuilderConfig);
  }

  /** The uplink, a child road or the rail carried something: it lights up for a moment. */
  private linkPulse(link: "parent" | "child" | "remote") {
    if (link !== "remote" || this.reduceMotion) return;
    const t = this.dynamic.find((o) => o.name === "train") as Phaser.GameObjects.Image | undefined;
    if (!t) return;
    this.busy++;
    this.tweens.chain({ tweens: [{ targets: t, y: 420, duration: 1400, ease: "Sine.InOut" }, { targets: t, y: 120, duration: 1400, delay: 600, ease: "Sine.InOut" }],
      onUpdate: () => t.setDepth(t.y), onComplete: () => { this.busy--; } } as unknown as Phaser.Types.Tweens.TweenChainBuilderConfig);
  }

  // MARK: Probing and measurement

  probe(click: boolean): boolean {
    for (const shop of this.shops.values()) {
      const b = shop.bays.find((x) => x.id && x.window.texture.key === "bay-lit");
      if (!b?.id) continue;
      const s = senatorsOf(this.state).get(b.id)!;
      const t: Target = { kind: "senator", senator: s, committee: shop.name };
      const cam = this.cameras.main;
      const wx = shop.slot.at.x + b.window.x, wy = shop.slot.at.y + b.window.y;
      if (click) this.hooks.open(t);
      else this.hooks.hover(t, (wx - cam.worldView.x) * cam.zoom, (wy - cam.worldView.y) * cam.zoom);
      this.touch();
      return true;
    }
    return false;
  }

  stats() {
    return { fps: Math.round(this.game.loop.actualFps), sleeping: !this.game.loop.running, shops: this.shops.size, busy: this.busy,
      passed: this.passed, constructing: this.constructing };
  }
}
