// The Village (Smallville × AI Town): a 16-bit top-down RPG town where
// committees are distinct pixel-art houses along real cobblestone streets
// around a central Town Square fountain, civic buildings (Town Hall, Post
// Office, Archive Library, Memory Hall, Monument Park) frame the square,
// pitched roofs smoothly fade open on zoom/hover/focus to reveal full
// Smallville cutaway interiors (desks, glowing terminals, desk items, and
// working senators), and messages happen by senators walking out along the
// village streets via the Post Office to visit the target house.
// Zero text is drawn on the town: everything is communicated visually and via
// hover cards and click links.
import Phaser from "phaser";
import {
  archiveArt, bar, bench, boards, character, cottage, daylight, desk, deskItem, deskPlaces, envelope,
  fountainArt, frontWindow, frontWindowPlaces, gardenArt, gate, glow, houseInterior, housePx, houseRoof,
  image, INK, lamp, landmark, memoryHallArt, monument, paintGroundMap, PALETTE, person, plant,
  postOfficeArt, PX, retexture, RUNTIME, sails, sheet, signal, skyline, sprite, STYLES, terminal,
  tool as toolArt, TOOLS, townGate, townHallArt, train, tree, WASH, weatherArt,
  type Daylight, type Style,
} from "./art.ts";
import { COLOURS, generateHouse, generateLook, houses, readHouse, readLook, type HouseSpec, type Look } from "./gen.ts";
import { bounds, LOT_TILES, plan, TILE, type BuildingSlot, type Plan, type Pt, type Slot } from "./layout.ts";
import { Life, type Places } from "./life.ts";
import { Director, type Action } from "./director.ts";
import {
  diff, hash, homeOf, seeded, senatorsOf, type Approval, type Archived, type Elder, type Project,
  type Release, type Senator, type ThreadRef, type ToolKind, type TownEvent, type TownState,
} from "./model.ts";
import { Grid } from "./nav.ts";
import { Person } from "./people.ts";
import { lightAt, seasonOf, streetLife, weatherOf, windOf, type Season, type Weather } from "./world.ts";

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
  room?(committee: string | undefined): void;
}

interface Roofed {
  id: string;
  roof: Phaser.GameObjects.Image;
  extras: Phaser.GameObjects.Image[]; // flag etc. fading with the roof
  at: Pt;
}

interface Shop {
  name: string;
  slot: Slot;
  root: Phaser.GameObjects.Container;
  inside: Phaser.GameObjects.Container;
  roof: Phaser.GameObjects.Image;
  windows: Phaser.GameObjects.Image[];
  lamp: Phaser.GameObjects.Image;
  held: number;
  extras: Phaser.GameObjects.GameObject[];
  spec: HouseSpec;
  size: { w: number; h: number };
  desks: { at: Pt; id?: string; lit: boolean }[];
}

interface Messenger {
  p: Person;
  mail: Phaser.GameObjects.Image;
  from: string;
  to?: string;
  thread: ThreadRef;
  line: string;
  held?: string;
}

export class Works extends Phaser.Scene {
  hooks!: Hooks;
  reduceMotion = false;
  dark = false;
  fixedTime?: Daylight;
  fixedWeather?: Weather;
  fixedSeason?: Season;
  clock: () => Date = () => new Date();

  state: TownState = { committees: [] };
  private plan: Plan = plan([]);
  private director = new Director();
  private dynamic: Phaser.GameObjects.GameObject[] = [];
  private wash!: Phaser.GameObjects.Rectangle;
  private glows: Phaser.GameObjects.Image[] = [];
  private shops = new Map<string, Shop>();
  private roofed: Roofed[] = [];
  private groundImg?: Phaser.GameObjects.Image;
  private fountain?: Phaser.GameObjects.Image;
  private fountainFrames: string[] = [];
  private wheel?: Phaser.GameObjects.Image;
  private reels = new Map<string, number>();
  private reelLayer!: Phaser.GameObjects.Container;
  private docket!: Phaser.GameObjects.Container;
  private passed = 0;
  private busy = 0;
  private awakeUntil = 0;
  private dragging = false;
  private moved = false;
  private lastSize = "";
  private pending?: { state: TownState; events: TownEvent[] };
  private specs = new Map<string, HouseSpec>();
  private life?: Life;
  private grid?: Grid;
  private elderPeople = new Map<string, { p: Person; age: number; leg: number; next: number }>();
  /** Idle senators stepping out for a stroll around their block. */
  private outside = new Map<string, { p: Person; shop: string }>();
  /** Senators currently away from their desk walking a Senate message across town! */
  private onErrand = new Set<string>();
  private messengers = new Set<Messenger>();
  private heldMessages = new Map<string, () => void>();
  private strollNext = new Map<string, number>();
  private followers: { p: Person; held: Phaser.GameObjects.Image; dx: number; dy: number }[] = [];
  private jobs: Person[] = [];
  private trees: Phaser.GameObjects.Image[] = [];
  private swayers: Phaser.GameObjects.Image[] = [];
  private spinners: { img: Phaser.GameObjects.Image; speed: number }[] = [];
  private smoke: { at: Pt; shop: string; next: number }[] = [];
  private puffs: Phaser.GameObjects.Image[] = [];
  private lamps: Phaser.GameObjects.Image[] = [];
  private rain?: Phaser.GameObjects.Particles.ParticleEmitter;
  private rainZone?: Phaser.Geom.Rectangle;
  private fog?: Phaser.GameObjects.Rectangle;
  private clouds: Phaser.GameObjects.Image[] = [];
  private weather: Weather = "clear";
  private season: Season = "summer";
  private wind = 0.2;
  private traffic = 0;
  private lastTick = 0;
  private trainNext = 0;
  private constructing = 0;
  private hoveredId?: string;
  private focusedShop?: string;
  private prevCamera?: { x: number; y: number; zoom: number };
  private ready = false;

  constructor() {
    super("works");
  }

  create() {
    for (const make of [signal, gate, bench, sheet, skyline, townGate, train, glow, lamp, weatherArt]) make(this);
    this.fountainFrames = fountainArt(this);

    this.wash = this.add.rectangle(0, 0, 10, 10, 0x000000, 0).setOrigin(0).setScrollFactor(0).setDepth(19_000)
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
      this.cullAt = 0;
      this.moved = true;
      this.hooks.hover(undefined, 0, 0);
    });
    this.input.on("wheel", (p: Phaser.Input.Pointer, _o: unknown, dx: number, dy: number) => {
      this.touch();
      const e = p.event as WheelEvent;
      if (e.ctrlKey || e.metaKey) this.zoomAt(Math.exp(-dy * 0.01), p.x, p.y);
      else { cam.scrollX += dx / cam.zoom; cam.scrollY += dy / cam.zoom; this.cullAt = 0; }
      this.moved = true;
      this.hooks.hover(undefined, 0, 0);
    });
    this.time.addEvent({ delay: 60_000, loop: true, callback: () => this.applyDaylight() });
    if (this.reduceMotion) window.setInterval(() => this.touch(400), 9_000);
    this.input.keyboard?.on("keydown-ENTER", () => {
      if (this.hoveredId && this.shops.has(this.hoveredId)) this.enter(this.hoveredId);
    });
    this.input.keyboard?.on("keydown-ESC", () => this.leave());
    this.ready = true;
    if (this.pending) {
      const { state, events } = this.pending;
      this.pending = undefined;
      this.setState(state, events);
    }
  }

  private ticks: number[] = [];
  override update(_time: number, delta: number) {
    this.ticks.push(performance.now());
    if (this.ticks.length > 120) this.ticks.shift();
    const now = performance.now();
    const dt = Math.min(0.1, delta / 1000);
    this.updateRoofs(dt);

    if (this.reduceMotion) {
      if (this.life) this.life.update(dt, now, { x: 0, y: 0, w: 0, h: 0 });
      if (this.busy === 0 && !this.dragging && now > this.awakeUntil && this.tweens.getTweens().length === 0) this.game.loop.sleep();
      return;
    }

    const view = this.cameras.main.worldView;
    const on = (x: number, y: number, m = 80) => x > view.x - m && x < view.right + m && y > view.y - m && y < view.bottom + m;
    if (this.life) {
      const working = this.state.committees.reduce((n, c) => n + c.senators.filter((x) => x.mood === "working").length, 0);
      const hour = this.fixedTime ? { dawn: 7, day: 13, dusk: 19, night: 2 }[this.fixedTime] : undefined;
      const when = hour === undefined ? this.clock() : new Date(2026, 0, 1, hour);
      this.life.life = Math.min(1, streetLife(when, this.dark && hour === undefined) * (0.7 + Math.min(0.3, working * 0.03)));
      this.life.cap = Math.max(6, Math.min(24, Math.round((view.width * view.height) / 55_000)));
      this.life.update(dt, now, { x: view.x, y: view.y, w: view.width, h: view.height });
    }
    this.strollElders(now);
    for (const e of this.elderPeople.values()) e.p.update(dt, now, on(e.p.x, e.p.y));
    for (const j of this.jobs) j.update(dt, now, on(j.x, j.y));
    for (const m of this.messengers) {
      m.p.update(dt, now, on(m.p.x, m.p.y));
      m.mail.setPosition(m.p.x + (m.p.sprite.flipX ? -12 : 12), m.p.y - 20).setDepth(m.p.y + 4);
    }
    for (const f of this.followers) {
      f.p.update(dt, now, on(f.p.x, f.p.y));
      f.held.setPosition(f.p.x + (f.p.sprite.flipX ? -f.dx : f.dx), f.p.y + f.dy).setDepth(f.p.y + 3);
    }
    for (const o of this.outside.values()) o.p.update(dt, now, on(o.p.x, o.p.y));
    if (now - this.lastTick > 1000) { this.lastTick = now; this.ambleSenators(now); }
    this.ambient(dt, now, on);
    this.cull(now);
  }

  /**
   * AI-Town roofs smoothly fade open to reveal Smallville cutaway interiors
   * whenever the camera zooms in close, when hovered, or when a house is
   * focused (`enter(name)`).
   */
  private updateRoofs(dt: number) {
    const cam = this.cameras.main;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const effectiveZoom = cam.zoom / dpr;
    const zoomOpen = effectiveZoom >= 1.7;
    const speed = this.reduceMotion ? 1 : Math.min(1, dt * 14);
    for (const r of this.roofed) {
      const open = zoomOpen || this.hoveredId === r.id || this.focusedShop === r.id;
      const target = open ? 0 : 1;
      if (Math.abs(r.roof.alpha - target) > 0.005) {
        const a = r.roof.alpha + (target - r.roof.alpha) * speed;
        r.roof.setAlpha(Math.abs(a - target) < 0.03 ? target : a);
        for (const ex of r.extras) ex.setAlpha(r.roof.alpha);
      }
    }
  }

  paused = false;
  calm = false;

  setCalm(calm: boolean) {
    if (calm === this.calm) return;
    this.calm = calm;
    if (this.shops.size) this.build([]);
  }

  private cullAt = 0;

  private cull(now: number) {
    if (now < this.cullAt) return;
    this.cullAt = now + 400;
    const cam = this.cameras.main, v = cam.worldView, m = 240;
    const bit = cam.id;
    for (const o of this.children.list) {
      const g = o as Phaser.GameObjects.GameObject & { scrollFactorX?: number; getBounds?: () => Phaser.Geom.Rectangle };
      if (g.scrollFactorX === 0 || o === this.groundImg) continue;
      let inside = true;
      if (o instanceof Phaser.GameObjects.Image || o instanceof Phaser.GameObjects.Container) {
        const b = o.getBounds();
        inside = b.right > v.x - m && b.x < v.right + m && b.bottom > v.y - m && b.y < v.bottom + m;
      }
      o.cameraFilter = inside ? o.cameraFilter & ~bit : o.cameraFilter | bit;
    }
  }

  /** Idle senators occasionally step outside for a brief stroll around their front yard & sidewalk. */
  private ambleSenators(now: number) {
    if (this.outside.size >= 4) return;
    for (const shop of this.shops.values()) {
      if ([...this.outside.values()].some((o) => o.shop === shop.name)) continue;
      const c = this.state.committees.find((k) => k.name === shop.name);
      for (const s of c?.senators ?? []) {
        if (s.mood !== "idle" || this.onErrand.has(s.id)) continue;
        const due = this.strollNext.get(s.id) ?? now + 18_000 + Number(hash(s.id) % 50_000n);
        this.strollNext.set(s.id, due);
        if (now < due) continue;
        this.strollNext.set(s.id, now + 80_000 + Number(hash(`${s.id}${Math.round(now)}`) % 80_000n));
        const door = shop.slot.door;
        const p = new Person(this, door, readLook(s.card, generateLook(s.id)), RUNTIME[s.runtime], { glyph: s.runtime, chair: s.chair, gait: "stroll" });
        this.hitbox(p.sprite, () => ({ kind: "senator", senator: senatorsOf(this.state).get(s.id) ?? s, committee: shop.name }));
        this.outside.set(s.id, { p, shop: shop.name });
        this.refresh();
        const loop = [
          { x: door.x - 90, y: door.y + 8 },
          { x: door.x + 90, y: door.y + 8 },
        ].map((q) => this.grid?.nearestWalkable(q) ?? q);
        const path = [door, ...loop, door].flatMap((q, i, all) => (i ? this.grid?.path(all[i - 1]!, q)?.slice(1) ?? [q] : [q]));
        p.walk(path, () => this.cameIn(s.id));
        return;
      }
    }
  }

  private callBack(id: string) {
    const o = this.outside.get(id);
    const shop = o && this.shops.get(o.shop);
    if (!o || !shop || o.p.gait === "hurry") return;
    const door = shop.slot.door;
    o.p.walk(this.grid?.path({ x: o.p.x, y: o.p.y }, door) ?? [door], () => this.cameIn(id), "hurry");
  }

  private cameIn(id: string) {
    const o = this.outside.get(id);
    if (!o) return;
    this.outside.delete(id);
    o.p.destroy();
    this.refresh();
  }

  private ambient(dt: number, now: number, on: (x: number, y: number, m?: number) => boolean) {
    const t = now / 1000;
    if (this.fountain && this.fountainFrames.length) {
      const f = this.fountainFrames[Math.floor(t * 4) % this.fountainFrames.length]!;
      if (this.fountain.texture.key !== f) this.fountain.setTexture(f);
    }
    for (const tr of this.trees) if (on(tr.x, tr.y)) tr.setAngle(Math.sin(t * (0.9 + this.wind) + tr.x * 0.013) * (0.5 + this.wind * 2.5));
    for (const f of this.swayers) f.setScale(PX * (0.86 + 0.14 * Math.sin(t * (2.2 + this.wind * 4))), PX);
    for (const sp of this.spinners) sp.img.rotation += sp.speed * (0.3 + this.wind) * dt;
    this.traffic = Math.max(0, this.traffic - dt * 0.25);
    if (this.wheel) this.wheel.rotation += (0.18 + this.traffic * 0.6) * dt;
    for (const sm of this.smoke) {
      if (now < sm.next || !on(sm.at.x, sm.at.y, 120) || this.puffs.length > 60) continue;
      const working = this.state.committees.find((c) => c.name === sm.shop)?.senators.filter((s) => s.mood === "working").length ?? 0;
      if (!working) { sm.next = now + 2000; continue; }
      sm.next = now + 1300 / Math.min(3, working);
      const puff = sprite(this, sm.at.x, sm.at.y, "puff").setScale(1).setAlpha(0.55).setDepth(18_000);
      puff.setData("v", 15 + Math.random() * 6).setData("age", 0);
      this.puffs.push(puff);
    }
    for (const puff of this.puffs) {
      const age = (puff.getData("age") as number) + dt;
      puff.setData("age", age);
      puff.y -= (puff.getData("v") as number) * dt;
      puff.x += this.wind * 10 * dt;
      puff.setScale(1 + age * 0.55).setAlpha(Math.max(0, 0.55 - age * 0.16));
    }
    const old = this.puffs.filter((p) => (p.getData("age") as number) > 3.2);
    for (const p of old) p.destroy();
    if (old.length) this.puffs = this.puffs.filter((p) => !old.includes(p));
    if (this.rainZone) { const v = this.cameras.main.worldView; this.rainZone.setTo(v.x - 100, v.y - 300, v.width + 200, v.height * 0.6 + 300); }
    const b = bounds(this.plan);
    for (const k of this.clouds) {
      k.x += (8 + this.wind * 22) * dt;
      if (k.x > b.x + b.w + 400) k.x = b.x - 400;
    }
    const trainImg = this.dynamic.find((o) => o.name === "train") as Phaser.GameObjects.Image | undefined;
    if (trainImg && now > this.trainNext) {
      this.trainNext = now + 65_000;
      const stY = this.plan.civic.station.y;
      this.tweens.chain({
        tweens: [
          { targets: trainImg, y: stY + 260, duration: 5500, ease: "Sine.InOut" },
          { targets: trainImg, y: stY, duration: 5500, delay: 5000, ease: "Sine.InOut" },
        ],
        onUpdate: () => trainImg.setDepth(trainImg.y + 40),
      } as unknown as Phaser.Types.Tweens.TweenChainBuilderConfig);
    }
    for (const shop of this.shops.values()) {
      if (shop.held) shop.lamp.setAlpha(0.6 + 0.4 * Math.sin(t * 5.5));
      else if (shop.lamp.alpha !== 1) shop.lamp.setAlpha(1);
    }
  }

  touch(hold = 500) {
    if (this.paused) return;
    this.awakeUntil = Math.max(this.awakeUntil, performance.now() + hold);
    if (!this.game.loop.running) this.game.loop.wake();
  }

  // MARK: Page API

  setState(state: TownState, extra: TownEvent[] = []) {
    if (!this.ready) { this.pending = { state, events: extra }; return; }
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
    this.perform(this.director.accept(events, new Set(senatorsOf(state).keys()), this.reduceMotion));
    if (!this.moved) this.fit();
  }

  act(events: TownEvent[]) {
    if (!this.ready) return;
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
    cam.setZoom(Phaser.Math.Clamp(zoom, 0.25, 3.5));
    cam.centerOn(b.x + b.w / 2, b.y + b.h / 2);
    this.placeWash();
    this.touch();
  }

  look(where: string, zoom: number) {
    const c = this.plan.civic;
    const at = where === "speaker" ? c.townHall.at
      : where === "post" ? c.postOffice.at
      : where === "archive" ? c.archive.at
      : where === "quarters" ? { x: (c.monuments.tx + c.monuments.tw / 2) * TILE, y: (c.monuments.ty + c.monuments.th / 2) * TILE }
      : where === "memory" ? c.memory.at
      : this.shops.get(where)?.slot.at ?? c.square;
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
    cam.setZoom(Phaser.Math.Clamp(cam.zoom * factor, 0.25, 5));
    const after = cam.getWorldPoint(sx, sy);
    cam.scrollX += before.x - after.x;
    cam.scrollY += before.y - after.y;
    this.placeWash();
    this.touch();
  }

  /** Zoom straight onto a house and lock its roof open to inspect inside (Smallville cutaway!). */
  enter(name: string) {
    const shop = this.shops.get(name);
    if (!shop) return;
    const cam = this.cameras.main;
    if (!this.focusedShop) this.prevCamera = { x: cam.midPoint.x, y: cam.midPoint.y, zoom: cam.zoom };
    this.focusedShop = name;
    this.moved = true;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const targetZoom = Math.max(2.3 * dpr, Math.min(cam.width / 380, cam.height / 300));
    if (this.reduceMotion) {
      cam.setZoom(targetZoom).centerOn(shop.slot.at.x, shop.slot.at.y);
      this.placeWash();
    } else {
      cam.pan(shop.slot.at.x, shop.slot.at.y, 420, "Sine.easeInOut");
      cam.zoomTo(targetZoom, 420, "Sine.easeInOut", false, () => this.placeWash());
    }
    this.hooks.room?.(name);
    this.touch(800);
  }

  leave() {
    if (!this.focusedShop) return;
    this.focusedShop = undefined;
    const cam = this.cameras.main;
    const prev = this.prevCamera;
    this.prevCamera = undefined;
    if (prev && !this.reduceMotion) {
      cam.pan(prev.x, prev.y, 380, "Sine.easeInOut");
      cam.zoomTo(prev.zoom, 380, "Sine.easeInOut", false, () => this.placeWash());
    } else {
      this.fit();
    }
    this.hooks.room?.(undefined);
    this.touch(600);
  }

  private placeWash() {
    this.cullAt = 0;
    const cam = this.cameras.main;
    const w = cam.width / cam.zoom, h = cam.height / cam.zoom;
    this.wash?.setSize(w + 4, h + 4).setPosition((cam.width - w) / 2 - 2, (cam.height - h) / 2 - 2);
    this.fog?.setSize(w + 4, h + 4).setPosition((cam.width - w) / 2 - 2, (cam.height - h) / 2 - 2);
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

  private applyDaylight() {
    const fixed = this.fixedTime;
    const w = fixed ? { ...WASH[fixed], lamps: WASH[fixed].glow } : (() => { const l = lightAt(this.clock(), this.dark); return { ...l, glow: l.lamps }; })();
    const grey = this.weather === "rain" ? 0.12 : this.weather === "fog" || this.weather === "cloudy" ? 0.06 : 0;
    const alpha = Math.min(0.72, w.alpha + grey);
    this.wash.setFillStyle(w.alpha > 0 ? w.color : 0x8a96a8, 1).setAlpha(alpha).setVisible(alpha > 0);
    for (const g of this.glows) g.setVisible(w.glow);
    for (const l of this.lamps) if (l.texture.key === "glow") l.setVisible(w.glow);
    this.touch(50);
  }

  // MARK: Building the Village

  private hitbox(obj: Phaser.GameObjects.GameObject & { setInteractive: Function }, target: () => Target | undefined, roofId?: string) {
    obj.setInteractive({ useHandCursor: true });
    obj.on("pointerover", (p: Phaser.Input.Pointer) => {
      if (roofId) this.hoveredId = roofId;
      const t = target();
      if (t) this.hooks.hover(t, p.x, p.y);
    });
    obj.on("pointerout", () => {
      if (roofId && this.hoveredId === roofId) this.hoveredId = undefined;
      this.hooks.hover(undefined, 0, 0);
    });
    obj.on("pointerup", () => {
      const t = target();
      if (t && !this.dragging) this.hooks.open(t);
    });
    return obj;
  }

  private add2<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.dynamic.push(obj);
    return obj;
  }

  private glowAt(x: number, y: number, scale: number) {
    const g = this.add.image(x, y, "glow").setBlendMode(Phaser.BlendModes.ADD).setScale(scale).setAlpha(0.42).setDepth(19_001);
    this.glows.push(g);
    return g;
  }

  private build(added: string[] = []) {
    const kept = this.plan.slots;
    this.tweens.killAll();
    this.busy = 0;
    this.constructing = 0;
    for (const o of this.dynamic) o.destroy();
    this.dynamic = [];
    for (const g of this.glows) g.destroy();
    this.glows = [];
    this.shops.clear();
    this.roofed = [];
    this.gates.clear();
    this.heldMessages.clear();
    this.onErrand.clear();
    for (const m of this.messengers) { m.p.destroy(); m.mail.destroy(); }
    this.messengers.clear();
    this.director.reset();
    this.life?.destroy();
    this.life = undefined;
    for (const e of this.elderPeople.values()) e.p.destroy();
    this.elderPeople.clear();
    for (const o of this.outside.values()) o.p.destroy();
    this.outside.clear();
    for (const f of this.followers) { f.p.destroy(); f.held.destroy(); }
    this.followers = [];
    for (const j of this.jobs) j.destroy();
    this.jobs = [];
    this.trees = [];
    this.swayers = [];
    this.spinners = [];
    this.smoke = [];
    for (const l of this.lamps) l.destroy();
    this.lamps = [];

    this.plan = plan(this.state.committees.map((c) => c.name), kept);
    this.specs = houses(this.state.committees.map((c) => c.name), new Map(this.state.committees.map((k) => [k.name, k.card])));
    this.season = this.fixedSeason ?? seasonOf(this.clock());
    this.weather = this.calm ? "clear" : this.fixedWeather ?? weatherOf(this.clock());
    this.wind = windOf(this.weather);

    const p = this.plan, c = p.civic;

    // 1. Crisp 16-bit village ground tilemap.
    const gmap = paintGroundMap(this, p, this.season);
    this.groundImg = this.add2(sprite(this, gmap.x, gmap.y, gmap.key).setOrigin(0, 0).setDepth(-30_000));
    this.cameras.main.setBackgroundColor(this.season === "winter" ? 0xe3ecf2 : this.season === "autumn" ? 0x8d9f4d : PALETTE.grass);

    // 2. Town Square centerpiece: animated pixel stone fountain, corner benches & lamps.
    this.fountain = this.add2(sprite(this, c.fountain.x, c.fountain.y, this.fountainFrames[0]!).setDepth(c.fountain.y));
    const sqBenches: Pt[] = [
      { x: -2.5 * TILE, y: -1.8 * TILE }, { x: 3.5 * TILE, y: -1.8 * TILE },
      { x: -2.5 * TILE, y: 2.6 * TILE }, { x: 3.5 * TILE, y: 2.6 * TILE },
    ];
    for (const b of sqBenches) this.add2(sprite(this, b.x, b.y, "bench").setDepth(b.y));

    // 3. Civic Buildings (all two-layer cutaway interior + fade-open roof!).
    this.buildCivic(c.townHall, "civic:townhall", townHallArt(this, this.season), () => ({
      kind: "townhall", docket: this.state.hall?.docket ?? 0, secretary: this.state.hall?.secretary,
    }));
    const postArt = postOfficeArt(this, this.season);
    this.buildCivic(c.postOffice, "civic:post", postArt, () => ({ kind: "hall", passed: this.passed }));
    const archArt = archiveArt(this, this.season);
    this.buildCivic(c.archive, "civic:archive", archArt, () => ({ kind: "archive", filed: [...this.reels.entries()] }));
    this.buildCivic(c.memory, "civic:memory", memoryHallArt(this, this.season), () => ({
      kind: "memory", sessions: this.state.history ?? 0,
    }));

    // Elders' Garden benches.
    for (const [i, q] of c.promenade.entries()) {
      if (i === 0 || i === 3) this.add2(sprite(this, q.x + 76, q.y + 4, "bench").setDepth(q.y + 4));
    }

    // West Stone Gatehouse on North Main Street.
    this.add2(this.hitbox(sprite(this, c.gate.x, c.gate.y - 10, "towngate").setDepth(c.gate.y + 20), () => ({ kind: "gatehouse" })));

    // 4. Committee Houses along the village streets.
    for (const committee of this.state.committees) {
      const slot = p.slots.get(committee.name);
      if (slot) this.buildShop(committee.name, slot);
    }

    // 5. Beyond Town: Parent Senate across North Bridge, Child Cottages south, Railway & Train east, Monument Park.
    this.drawBeyond();
    this.plantTrees();
    this.drawReels();
    this.refresh();
    this.populate();
    this.applyDaylight();
    for (const name of added.slice(0, 2)) this.construct(name);
    this.touch();
  }

  private buildCivic(
    b: BuildingSlot,
    id: string,
    art: { interior: string; roof: string; flag?: string; wheel?: string },
    target: () => Target,
  ) {
    const baseDepth = b.at.y + (b.th * TILE) / 2 - 20;
    const inside = this.add2(this.hitbox(sprite(this, b.at.x, b.at.y, art.interior).setDepth(baseDepth - 10), target, id));
    void inside;

    if (id === "civic:post" && art.wheel) {
      this.wheel = this.add2(sprite(this, b.at.x, b.at.y + 2, art.wheel).setDepth(baseDepth - 5));
    }
    if (id === "civic:archive") {
      this.reelLayer = this.add2(this.add.container(b.at.x, b.at.y + 4).setDepth(baseDepth - 5));
    }
    if (id === "civic:townhall") {
      this.docket = this.add2(this.add.container(b.at.x, b.at.y + 6).setDepth(baseDepth - 4));
    }

    const roof = this.add2(sprite(this, b.at.x, b.at.y, art.roof).setDepth(baseDepth + 35));
    const extras: Phaser.GameObjects.Image[] = [];
    if (art.flag) {
      const f = this.add2(sprite(this, b.at.x + 2, b.at.y - 78, art.flag).setOrigin(0, 0.5).setDepth(baseDepth + 36));
      this.swayers.push(f);
      extras.push(f);
    }
    this.roofed.push({ id, roof, extras, at: b.at });
    this.glowAt(b.at.x - 42, b.at.y + 56, 0.9);
    this.glowAt(b.at.x + 42, b.at.y + 56, 0.9);
  }

  private buildShop(name: string, slot: Slot) {
    const spec = this.specs.get(name) ?? generateHouse(name);
    const dim = housePx(spec);
    const w = dim.w * PX, h = dim.h * PX;
    const baseDepth = slot.at.y + h / 2;

    const root = this.add2(this.add.container(slot.at.x, slot.at.y).setDepth(baseDepth));
    const rnd = seeded(`garden:${name}`);
    const plantSpots = [
      { x: -w / 2 - 14, y: h / 2 - 6 },
      { x: w / 2 + 14, y: h / 2 - 6 },
      { x: -w / 2 - 12, y: -h / 2 + 18 },
    ];
    spec.plants.forEach((species, i) => {
      const sp = plantSpots[i]!;
      root.add(sprite(this, sp.x, sp.y - 12, plant(this, species, Math.floor(rnd() * 4))));
    });
    if (spec.garden !== "lawn") root.add(sprite(this, 0, h / 2 + 10, gardenArt(this, spec.garden, w)));
    if (spec.landmark !== "none") {
      const lx = w / 2 + 20, ly = -h / 2 + 24;
      root.add(sprite(this, lx, ly, landmark(this, spec.landmark, COLOURS[spec.trim]!)).setOrigin(0.5, 0.85));
      if (spec.landmark === "windmill") {
        const sail = sprite(this, lx, ly - 54, sails(this));
        root.add(sail);
        this.spinners.push({ img: sail, speed: 0.65 });
      }
    }

    // Chimney smoke origin on upper-left roof.
    this.smoke.push({ at: { x: slot.at.x - w * 0.25, y: slot.at.y - h / 2 - 22 }, shop: name, next: 0 });

    const inArt = houseInterior(this, spec);
    const roofArt = houseRoof(this, spec, this.season);
    const originY = (dim.roofH + 4 + dim.h / 2) / (dim.h + dim.roofH + 8);

    // Layer 1: Cutaway interior shell + front facade wall.
    const body = sprite(this, 0, 0, inArt.key).setOrigin(0.5, originY);
    root.add(body);

    // Cozy exterior front windows (visible on front facade even when roof is closed!).
    const windows = frontWindowPlaces(spec).map((wp) => {
      const win = sprite(this, wp.x, wp.y, frontWindow(this, false));
      root.add(win);
      return win;
    });

    // Layer 2: Interior desks, terminals, desk items & live senators (revealed as roof fades!).
    const inside = this.add.container(0, 0);
    root.add(inside);

    // Layer 3: Pitched 16-bit pixel roof (fades open smoothly on zoom/hover/focus!).
    const roof = sprite(this, 0, 0, roofArt.key).setOrigin(0.5, originY);
    root.add(roof);
    this.roofed.push({ id: name, roof, extras: [], at: slot.at });

    // Hover opens the roof & shows the house card; double-click focuses inside; single click opens link.
    let clickTimer: Phaser.Time.TimerEvent | undefined;
    const target = (): Target => {
      const c = this.state.committees.find((k) => k.name === name);
      return { kind: "workshop", name, senators: c?.senators.length ?? 0, waiting: c?.waiting?.length ?? 0 };
    };
    body.setInteractive({ useHandCursor: true });
    body.on("pointerover", (p: Phaser.Input.Pointer) => { this.hoveredId = name; this.hooks.hover(target(), p.x, p.y); });
    body.on("pointerout", () => { if (this.hoveredId === name) this.hoveredId = undefined; this.hooks.hover(undefined, 0, 0); });
    body.on("pointerup", () => {
      if (this.dragging) return;
      if (clickTimer) { clickTimer.remove(); clickTimer = undefined; this.enter(name); return; }
      clickTimer = this.time.delayedCall(300, () => { clickTimer = undefined; this.hooks.open(target()); });
      this.touch(360);
    });

    // Sidewalk mailbox / signal post at the curb.
    const post = this.add2(sprite(this, slot.signal.x, slot.signal.y - 10, "signal").setDepth(slot.signal.y));
    const lampImg = this.add2(sprite(this, slot.signal.x + 6, slot.signal.y - 20, "lamp-green").setDepth(slot.signal.y + 1));
    this.hitbox(post, () => ({ kind: "signal", committee: name, held: this.shops.get(name)?.held ? "a delivery is held" : undefined }));

    const desks = deskPlaces(spec).map((at) => ({ at, lit: false }));
    this.shops.set(name, { name, slot, root, inside, roof, windows, lamp: lampImg, held: 0, extras: [], spec, size: { w, h }, desks });
    this.reels.set(name, this.reels.get(name) ?? 0);
  }

  /** Plant lush pixel-art trees in woodland margins, parks & open meadow spaces (never on roads or lots). */
  private plantTrees() {
    const p = this.plan, c = p.civic;
    const treeKey = tree(this, this.season);
    const rnd = seeded("village-trees");
    const blockedTile = (tx: number, ty: number) => {
      if (ty >= p.river.ty - 1 && ty <= p.river.ty + p.river.th) return true;
      if (Math.abs(tx * TILE - c.rail) < 76) return true;
      if (Math.hypot(tx * TILE - c.parent.x, ty * TILE - c.parent.y) < 180) return true;
      if (Math.hypot(tx * TILE - c.gate.x, ty * TILE - c.gate.y) < 88) return true;
      if (c.children.some((k) => Math.hypot(tx * TILE - k.x, ty * TILE - k.y) < 110)) return true;
      const inR = (r: { tx: number; ty: number; tw: number; th: number }, pad = 0) =>
        tx >= r.tx - pad && tx < r.tx + r.tw + pad && ty >= r.ty - pad && ty < r.ty + r.th + pad;
      if (p.streets.some((r) => inR(r, 1)) || p.plazas.some((r) => inR(r, 0)) || p.paths.some((r) => inR(r, 0))) return true;
      if (inR(c.monuments, 0)) return true;
      for (const b of [c.townHall, c.postOffice, c.archive, c.memory]) if (inR(b, 0)) return true;
      for (const s of p.slots.values()) if (inR({ tx: s.tx, ty: s.ty, tw: LOT_TILES.tw, th: LOT_TILES.th }, 0)) return true;
      return false;
    };

    const placed: Pt[] = [];
    for (let ty = p.tiles.y0 + 1; ty < p.tiles.y1 - 1; ty += 2) {
      for (let tx = p.tiles.x0 + 1; tx < p.tiles.x1 - 1; tx += 2) {
        if (blockedTile(tx, ty)) continue;
        // Denser forest along outer margins & riverbanks; gentle scattering in parks.
        const nearEdge = tx <= p.tiles.x0 + 3 || tx >= p.tiles.x1 - 4 || ty <= p.tiles.y0 + 3 || ty >= p.tiles.y1 - 4;
        if (rnd() > (nearEdge ? 0.58 : 0.24)) continue;
        const wx = (tx + 0.3 + rnd() * 0.6) * TILE;
        const wy = (ty + 0.3 + rnd() * 0.6) * TILE;
        if (placed.some((q) => Math.hypot(q.x - wx, q.y - wy) < 46)) continue;
        placed.push({ x: wx, y: wy });
        const img = this.add2(sprite(this, wx, wy, treeKey).setOrigin(0.5, 30 / 34).setDepth(wy));
        this.trees.push(img);
      }
    }
  }

  private drawBeyond() {
    const c = this.plan.civic, links = this.state.links;
    // Parent Senate skyline across the North Stone Bridge.
    const sky = sprite(this, c.parent.x, c.parent.y, "skyline").setDepth(c.parent.y);
    this.add2(this.hitbox(sky, () => ({ kind: "link", link: "parent", name: links?.parent?.name ?? "/acme", up: links?.parent?.up ?? true })));
    this.glowAt(c.parent.x, c.parent.y + 12, 2.2);

    // South Child Senate cottage hamlets.
    const walls = [0xf2e4cc, 0xe8eff2, 0xf7ebcb, 0xf2dfd0, 0xeee5f2];
    (links?.children ?? [{ name: "ci-runner", up: true }, { name: "bob-desk", up: true }]).slice(0, c.children.length).forEach((child, i) => {
      const at = c.children[i]!;
      for (let k = 0; k < 3; k++) {
        const h = sprite(this, at.x - 54 + k * 54, at.y + (k % 2) * 18, cottage(this, walls[(i * 3 + k) % walls.length]!)).setDepth(at.y + k * 10);
        this.add2(this.hitbox(h, () => ({ kind: "link", link: "child", name: child.name, up: child.up })));
      }
    });

    // East Railway pixel train at the Station.
    const remote = links?.remotes?.[0] ?? { name: "studio-mini", up: true };
    const t = sprite(this, c.rail, c.station.y, "train").setDepth(c.station.y + 40);
    this.add2(this.hitbox(t, () => ({ kind: "link", link: "remote", name: remote.name, up: remote.up })));
    t.setName("train");

    // Monument Park (integrated cleanly into South-West Village Park!).
    this.drawMonuments();
  }

  private drawMonuments() {
    const m = this.plan.civic.monuments;
    const projects = this.state.projects ?? [];
    const quarters = new Map<string, Pt>();
    const ox0 = (m.tx + 1.1) * TILE, oy0 = (m.ty + 2.5) * TILE;
    projects.slice(0, 4).forEach((proj, pi) => {
      const style = (STYLES as readonly string[]).includes(proj.style ?? "") ? (proj.style as Style)
        : STYLES[Number(hash(proj.name) % BigInt(STYLES.length))]!;
      const col = pi % 2, row = Math.floor(pi / 2);
      const qx = ox0 + col * 140, qy = oy0 + row * 78;
      quarters.set(proj.id, { x: qx, y: qy });
      const rel = proj.releases.slice(-4);
      rel.forEach((r, i) => {
        const img = sprite(this, qx + i * 26, qy, monument(this, style, 26 + Math.min(r.merges, 20) * 2.2))
          .setOrigin(0.5, 1).setDepth(qy);
        this.add2(this.hitbox(img, () => ({ kind: "monument", project: proj, release: r })));
      });
      if (proj.unreleased) {
        const x = qx + rel.length * 26;
        const img = sprite(this, x, qy, monument(this, style, 22)).setOrigin(0.5, 1).setAlpha(0.55).setDepth(qy);
        this.add2(this.hitbox(img, () => ({ kind: "monument", project: proj, next: true })));
      }
    });
    // Boarded-up archived committee cottages kept respectfully in Monument Park.
    (this.state.archived ?? []).slice(0, 4).forEach((a, i) => {
      const q = quarters.get(a.project ?? "") ?? { x: ox0, y: oy0 + 70 };
      const spec = readHouse(a.card, generateHouse(a.name));
      const at = { x: q.x + 114 - i * 8, y: q.y - 6 + i * 10 };
      const img = sprite(this, at.x, at.y, houseRoof(this, spec, this.season).key).setScale(0.75).setTint(0xb5afa8).setDepth(at.y + 8);
      this.add2(this.hitbox(img, () => ({ kind: "archived", archived: a })));
      this.add2(sprite(this, at.x, at.y + 8, boards(this)).setScale(1.1).setDepth(at.y + 9));
    });
  }

  // MARK: Live Refresh (Interiors, Windows, Approvals, Docket, Elders)

  private refresh() {
    const lampsOn = WASH[this.fixedTime ?? daylight(this.clock(), this.dark)].glow;
    for (const shop of this.shops.values()) {
      for (const o of shop.extras) {
        const i = this.glows.indexOf(o as Phaser.GameObjects.Image);
        if (i >= 0) this.glows.splice(i, 1);
        o.destroy();
      }
      shop.extras = [];
      shop.inside.removeAll(true);

      const committee = this.state.committees.find((c) => c.name === shop.name);
      const senators = committee?.senators ?? [];
      let anyWorking = false;

      shop.desks.forEach((d, i) => {
        const s = senators[i];
        const working = s?.mood === "working" || s?.mood === "waiting";
        if (working) anyWorking = true;
        d.id = s?.id;
        d.lit = working;

        // Draw Smallville interior desk + CRT terminal + desk item!
        const deskImg = sprite(this, d.at.x, d.at.y + 10, desk(this, !!s?.chair));
        shop.inside.add(deskImg);
        if (!s || s.mood === "stopped") {
          deskImg.setAlpha(0.55);
          return;
        }
        const look = readLook(s.card, generateLook(s.id));
        const screen = sprite(this, d.at.x - 8, d.at.y - 2, terminal(this, working));
        shop.inside.add(screen);
        shop.inside.add(sprite(this, d.at.x + 12, d.at.y + 1, deskItem(this, look.deskItem)));
        const target = (): Target => ({ kind: "senator", senator: senatorsOf(this.state).get(s.id) ?? s, committee: shop.name });
        this.hitbox(screen, target, shop.name);

        // If this senator is currently walking outside (errand or idle stroll), leave their chair empty!
        const out = this.outside.get(s.id);
        if (out) {
          if (s.mood !== "idle") this.callBack(s.id);
          return;
        }
        if (this.onErrand.has(s.id)) return;

        const pose = s.mood === "paused" ? "sleep" : s.mood === "waiting" ? "wave" : s.mood === "working" ? "work" : "sit";
        const who = sprite(this, d.at.x, d.at.y - 8, character(this, look, RUNTIME[s.runtime], {
          pose, chair: s.chair, glyph: s.runtime,
        })).setScale(PX * 0.85);
        if (s.mood === "paused") who.setAlpha(0.75);
        shop.inside.add(who);
        this.hitbox(who, target, shop.name);
        if (s.watched) {
          const viewer = sprite(this, d.at.x + 18, d.at.y + 4, character(this, generateLook("viewer"), 0x8a8fa8)).setScale(PX * 0.78);
          shop.inside.add(viewer);
        }
      });

      // Exterior facade front windows glow warm amber when anyone inside is working!
      shop.windows.forEach((win) => {
        retexture(win, frontWindow(this, anyWorking));
        if (anyWorking) {
          shop.extras.push(this.glowAt(shop.slot.at.x + win.x, shop.slot.at.y + win.y, 0.95).setVisible(lampsOn));
        }
      });

      // Thread waiting on the person: waving visitor standing on the front porch.
      const first = committee?.waiting?.[0];
      if (first) {
        const v = sprite(this, 26, shop.size.h / 2 + 12, character(this, generateLook("visitor"), PALETTE.amber, { pose: "wave" }));
        shop.root.add(v);
        shop.extras.push(v);
        this.hitbox(v, () => ({ kind: "waiting", thread: first, person: this.state.person }));
      }
    }

    for (const a of this.state.approvals ?? []) this.raiseGate(a);
    this.drawDocket();
    this.drawElders();
  }

  private gates = new Map<string, Phaser.GameObjects.Container>();

  private raiseGate(a: Approval) {
    if (this.gates.has(a.senator)) return;
    const home = homeOf(this.state, a.senator);
    const shop = home ? this.shops.get(home) : undefined;
    if (!shop) return;
    const p = shop.slot.gate;
    const c = this.add2(this.add.container(p.x, p.y).setDepth(p.y + 12));
    c.add([sprite(this, -28, -4, "gate-post"), sprite(this, 28, -4, "gate-post")]);
    const barImg = sprite(this, 0, -10, "barrier");
    c.add(barImg);
    const signer = sprite(this, 36, 0, person(this, 0xd6a63b, { pose: "wave" }));
    c.add(signer);
    for (const o of [barImg, signer]) this.hitbox(o, () => ({ kind: "gate", approval: a }));
    c.setData("bar", barImg).setData("signer", signer);
    this.gates.set(a.senator, c);
  }

  private openGate(senator: string) {
    const c = this.gates.get(senator);
    if (!c) return;
    this.gates.delete(senator);
    const barImg = c.getData("bar") as Phaser.GameObjects.Image, signer = c.getData("signer") as Phaser.GameObjects.Image;
    this.busy++;
    this.tweens.add({
      targets: barImg, angle: -80, x: -24, y: -32, duration: this.reduceMotion ? 1 : 480,
      onComplete: () => this.tweens.add({ targets: [c], alpha: 0, delay: 900, duration: 400, onComplete: () => { c.destroy(); this.busy--; } }),
    });
    this.tweens.add({ targets: signer, x: 90, alpha: 0, duration: this.reduceMotion ? 1 : 800 });
  }

  /** Inside Town Hall: Secretary at desk, docket stack, and the local person. */
  private drawDocket() {
    this.docket.removeAll(true);
    const n = Math.min(this.state.hall?.docket ?? 0, 10);
    for (let i = 0; i < n; i++) this.docket.add(sprite(this, 56 + (i % 2) * 2, 16 - i * 4, "sheet"));
    const sec = this.state.hall?.secretary;
    if (sec) {
      const look = readLook(sec.card, generateLook(sec.id));
      const s = sprite(this, -34, -4, character(this, look, RUNTIME[sec.runtime], { pose: sec.mood === "working" ? "work" : "sit", glyph: sec.runtime }));
      this.docket.add(s);
      this.hitbox(s, () => ({ kind: "senator", senator: sec }), "civic:townhall");
    }
    if (this.state.person) {
      const me = sprite(this, 0, -14, character(this, generateLook(`person:${this.state.person}`), 0xd6a63b, { pose: "wave" }));
      this.docket.add(me);
    }
  }

  private drawElders() {
    const prom = this.plan.civic.promenade;
    const want = (this.state.elders ?? []).slice(0, 10);
    for (const [id, e] of this.elderPeople) if (!want.some((x) => x.id === id)) { e.p.destroy(); this.elderPeople.delete(id); }
    want.forEach((e, i) => {
      if (this.elderPeople.has(e.id)) return;
      const age = e.idle > 14 * 86_400 ? 3 : e.idle > 86_400 ? 2 : 1;
      const shirt = Phaser.Display.Color.IntegerToColor(RUNTIME[e.runtime]).lighten(18 + age * 6).color;
      const leg = i % prom.length, t = (i * 0.37) % 1;
      const a = prom[leg]!, b = prom[(leg + 1) % prom.length]!;
      const at = age >= 3
        ? { x: prom[i % 2 === 0 ? 0 : 3]!.x + 76 + (i % 3) * 10 - 10, y: prom[i % 2 === 0 ? 0 : 3]!.y + 8 }
        : { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const base = generateLook(e.id);
      const look: Look = { ...base, hairColour: 5, hair: age >= 3 && base.hair === "long" ? "bun" : base.hair, hat: age >= 2 ? base.hat : "none" };
      const p = new Person(this, at, look, shirt, { cane: age >= 2, gait: "elder", reduceMotion: this.reduceMotion });
      if (age >= 3) p.sit();
      this.hitbox(p.sprite, () => ({ kind: "elder", elder: e }));
      this.elderPeople.set(e.id, { p, age, leg, next: performance.now() + 8000 + i * 5000 });
    });
  }

  private strollElders(now: number) {
    const prom = this.plan.civic.promenade;
    for (const e of this.elderPeople.values()) {
      if (e.age >= 3 || e.p.moving || now < e.next) continue;
      e.leg = (e.leg + 1) % prom.length;
      const to = prom[e.leg]!;
      e.p.walk(this.grid?.path({ x: e.p.x, y: e.p.y }, to) ?? [to], () => { e.next = performance.now() + 14_000 + Math.random() * 20_000; });
      e.next = Infinity;
    }
  }

  // MARK: Navigation Grid, Villagers, Lamps & Weather

  private populate() {
    const p = this.plan, c = p.civic;
    const b = bounds(p);
    const grid = new Grid({ x: b.x - 160, y: b.y - 120, w: b.w + 320, h: b.h + 240 }, 16);

    // Block building footprints (leaving front doors & sidewalks cleanly walkable!).
    for (const shop of this.shops.values()) {
      grid.block({ x: shop.slot.at.x - shop.size.w / 2 - 4, y: shop.slot.at.y - shop.size.h / 2 - 8, w: shop.size.w + 8, h: shop.size.h + 10 });
    }
    for (const cb of [c.townHall, c.postOffice, c.archive, c.memory]) {
      grid.block({ x: cb.tx * TILE + 8, y: cb.ty * TILE + 8, w: cb.tw * TILE - 16, h: cb.th * TILE - 18 });
    }
    // Block fountain basin in center of Town Square.
    grid.blockCircle(c.fountain, 34);
    // Block River on both sides of the Stone Arch Bridge!
    const brLeft = p.bridge.tx * TILE, brRight = (p.bridge.tx + p.bridge.tw) * TILE;
    const rivY = p.river.ty * TILE, rivH = p.river.th * TILE;
    grid.block({ x: b.x - 200, y: rivY, w: brLeft - (b.x - 200), h: rivH });
    grid.block({ x: brRight, y: rivY, w: (b.x + b.w + 200) - brRight, h: rivH });
    // Block railway track bed.
    grid.block({ x: c.rail - 20, y: b.y - 160, w: 40, h: b.h + 320 });
    this.grid = grid;

    const benches: Pt[] = [
      { x: -2.5 * TILE, y: -1.6 * TILE }, { x: 3.5 * TILE, y: -1.6 * TILE },
      { x: -2.5 * TILE, y: 2.8 * TILE }, { x: 3.5 * TILE, y: 2.8 * TILE },
      ...c.promenade.filter((_, i) => i === 0 || i === 3).map((q) => ({ x: q.x + 76, y: q.y + 8 })),
    ];
    const streetSpots: Pt[] = [
      { x: 0, y: -4.2 * TILE }, { x: 0, y: 4.8 * TILE },
      { x: -5 * TILE, y: 0 }, { x: 6 * TILE, y: 0 },
      { x: c.townHall.door.x, y: c.townHall.door.y + 8 },
      { x: c.postOffice.door.x, y: c.postOffice.door.y + 8 },
      { x: c.archive.door.x, y: c.archive.door.y + 8 },
      ...c.promenade,
      ...[...this.shops.values()].map((s) => ({ x: s.slot.door.x, y: s.slot.door.y + 10 })),
      { x: (c.monuments.tx + c.monuments.tw / 2) * TILE, y: (c.monuments.ty + 1) * TILE },
      { x: c.gate.x + 56, y: c.gate.y + 8 },
    ];
    const gardens = [...this.shops.values()].map((s) => ({ x: s.slot.at.x - s.size.w / 2 - 12, y: s.slot.at.y + s.size.h / 2 + 12 }));
    const places: Places = {
      benches,
      spots: streetSpots,
      homes: c.children.map((k) => ({ x: k.x, y: k.y - 36 })),
      shelters: [...this.shops.values()].map((s) => ({ x: s.slot.door.x, y: s.slot.door.y - 6 })),
      gardens,
    };

    this.life = new Life(this, grid, places, () => [...this.messengers].map((m) => ({ x: m.p.x, y: m.p.y })), this.reduceMotion);
    this.life.weather = this.weather;
    const full = Math.max(8, Math.min(22, 8 + Math.round(this.state.committees.length * 0.55)));
    const n = this.calm ? Math.ceil(full / 2) : full;
    this.life.populate(n, (img) => this.hitbox(img, () => ({ kind: "civilian" })));

    // Wrought-iron village street lamps framing Town Square & Main Streets.
    const lampSpots: Pt[] = [
      { x: -4.2 * TILE, y: -3.2 * TILE }, { x: 5.2 * TILE, y: -3.2 * TILE },
      { x: -4.2 * TILE, y: 3.8 * TILE }, { x: 5.2 * TILE, y: 3.8 * TILE },
      { x: -1.5 * TILE, y: -12 * TILE }, { x: 1.5 * TILE, y: -12 * TILE },
      { x: -13 * TILE, y: -4.8 * TILE }, { x: 13 * TILE, y: -4.8 * TILE },
      { x: -13 * TILE, y: 5.6 * TILE }, { x: 13 * TILE, y: 5.6 * TILE },
    ];
    for (const q of lampSpots) {
      this.lamps.push(sprite(this, q.x, q.y, "lamp").setOrigin(0.5, 0.95).setDepth(q.y));
      this.lamps.push(this.add.image(q.x, q.y - 34, "glow").setBlendMode(Phaser.BlendModes.ADD).setScale(0.7).setAlpha(0.85).setDepth(19_002));
    }
    this.setupWeather();
  }

  private setupWeather() {
    this.rain?.destroy(); this.rain = undefined;
    this.fog?.destroy(); this.fog = undefined;
    for (const k of this.clouds) k.destroy();
    this.clouds = [];
    this.rainZone = undefined;
    if (this.reduceMotion || this.calm) return;
    const cam = this.cameras.main;
    if (this.weather === "rain") {
      const snow = this.season === "winter";
      this.rainZone = new Phaser.Geom.Rectangle(0, 0, 10, 10);
      this.rain = this.add.particles(0, 0, snow ? "flake" : "drop", {
        emitZone: { type: "random", source: this.rainZone } as unknown as Phaser.Types.GameObjects.Particles.EmitZoneData,
        lifespan: snow ? 9000 : 2400,
        speedY: snow ? { min: 40, max: 70 } : { min: 850, max: 1050 },
        speedX: snow ? { min: -18, max: 18 } : -110 * this.wind,
        scale: snow ? { min: 1.2, max: 2 } : 1.5,
        alpha: snow ? 0.9 : 0.55, frequency: snow ? 40 : 14, quantity: 1,
      }).setDepth(19_500);
    }
    if (this.weather === "fog") {
      this.fog = this.add.rectangle(0, 0, cam.width, cam.height, 0xffffff, 0.25).setOrigin(0).setScrollFactor(0).setDepth(19_400);
      this.placeWash();
    }
    const n = this.weather === "cloudy" || this.weather === "rain" ? 5 : this.weather === "clear" ? 2 : 3;
    const b = bounds(this.plan), rnd = seeded("clouds");
    for (let i = 0; i < n; i++) {
      this.clouds.push(image(this, b.x + rnd() * b.w, b.y + rnd() * b.h, "cloud").setScale(2.2 + rnd() * 2).setAlpha(this.weather === "clear" ? 0.06 : 0.11).setDepth(18_900));
    }
  }

  // MARK: Live House Construction

  private construct(name: string) {
    const shop = this.shops.get(name);
    if (!shop) return;
    this.constructing++;
    this.busy++;
    shop.root.setAlpha(0);
    const finish = () => {
      this.tweens.add({ targets: shop.root, alpha: 1, duration: this.reduceMotion ? 350 : 600,
        onComplete: () => { this.constructing--; this.busy--; } });
    };
    if (this.reduceMotion) { finish(); return; }
    const at = shop.slot.at, { w, h } = shop.size;
    const scaffold = this.add2(this.add.graphics().setDepth(at.y + h));
    const spots = [{ x: at.x - w / 2 - 14, y: shop.slot.door.y }, { x: at.x + w / 2 + 14, y: shop.slot.door.y }];
    const builders = [this.life?.recruit(at), this.life?.recruit(at)].filter((b): b is Person => !!b).map((civ, i) => {
      civ.sprite.setVisible(false);
      const b = new Person(this, { x: civ.x, y: civ.y }, civ.look, civ.shirt, { hardhat: true, gait: "hurry" });
      this.jobs.push(b);
      const spot = this.grid?.nearestWalkable(spots[i]!) ?? spots[i]!;
      b.walk(this.grid?.path({ x: b.x, y: b.y }, spot) ?? [spot], () => {
        b.face({ x: at.x, y: at.y });
        this.tweens.add({ targets: b.sprite, y: b.y - 3, duration: 180, yoyo: true, repeat: 10 });
      });
      return { civ, b };
    });
    this.time.delayedCall(1200, () => {
      scaffold.lineStyle(4, PALETTE.woodDark, 1);
      for (let k = 0; k <= 4; k++) scaffold.beginPath().moveTo(at.x - w / 2 + (k * w) / 4, at.y + h / 2).lineTo(at.x - w / 2 + (k * w) / 4, at.y - h / 2 - 20).strokePath();
      for (let k = 0; k < 4; k++) scaffold.beginPath().moveTo(at.x - w / 2 - 6, at.y + h / 2 - 8 - k * (h / 3)).lineTo(at.x + w / 2 + 6, at.y + h / 2 - 8 - k * (h / 3)).strokePath();
      this.tweens.add({
        targets: shop.root, alpha: 1, duration: 2600, ease: "Sine.InOut",
        onComplete: () => {
          scaffold.destroy();
          let left = builders.length;
          if (!left) finish();
          for (const { civ, b } of builders) {
            const back = () => {
              civ.sprite.setPosition(b.x, b.y).setVisible(true);
              this.life?.dismiss(civ);
              this.jobs = this.jobs.filter((j) => j !== b);
              b.destroy();
              if (--left === 0) finish();
            };
            const away = this.grid?.nearestWalkable({ x: b.x + (b.x < at.x ? -48 : 48), y: b.y + 24 });
            if (away) b.walk(this.grid?.path({ x: b.x, y: b.y }, away) ?? [away], back, "walk"); else back();
          }
        },
      });
    });
  }

  // MARK: Smallville-Style Street Visits (Senate Messages, Tools, Signatures)

  private perform(actions: Action[]) {
    for (const a of actions) {
      switch (a.kind) {
        case "visit": this.send(a); break;
        case "mood": this.refresh(); break;
        case "arrive": case "depart": this.refresh(); if (a.walk) this.perform(this.director.cameHome(a.senator)); break;
        case "settled": this.stamp(a.thread.committee); break;
        case "release": this.release(a.thread); break;
        case "tool": this.worker(a.senator, a.tool, a.target); break;
        case "signed": this.openGate(a.senator); break;
        case "link": this.linkPulse(a.link); break;
      }
    }
  }

  private shopOf(id: string | undefined): Shop | undefined {
    const home = id ? homeOf(this.state, id) : undefined;
    return home ? this.shops.get(home) : undefined;
  }

  /**
   * Smallville-style message delivery: the sending senator steps out of their
   * desk, walks out the front door carrying an envelope along the village
   * cobblestone streets to the Post Office (Archive stamps the ledger), then
   * walks to the receiver's house (pausing at their red mailbox if held!),
   * delivers the message, and walks back home to their desk!
   */
  private send(a: Extract<Action, { kind: "visit" }>) {
    const fromShop = this.shopOf(a.from);
    const toShop = (a.to ? this.shopOf(a.to) : undefined) ?? this.shops.get(a.thread.committee);
    const sender = senatorsOf(this.state).get(a.from);
    const color = RUNTIME[sender?.runtime ?? "other"];
    const look = sender ? readLook(sender.card, generateLook(sender.id)) : generateLook(`guest:${a.from}`);
    const startPt = fromShop ? fromShop.slot.door : { x: 0, y: (this.plan.river.ty - 1) * TILE };
    const postDoor = this.plan.civic.postOffice.door;
    const destPt = toShop ? toShop.slot.door : this.plan.civic.townHall.door;

    this.traffic = Math.min(6, this.traffic + 1);
    this.passed++;
    this.busy++;

    const p = new Person(this, startPt, look, color, {
      chair: sender?.chair, glyph: sender?.runtime, gait: "hurry", reduceMotion: this.reduceMotion,
    });
    const mail = sprite(this, startPt.x + 12, startPt.y - 20, envelope(this, color)).setDepth(startPt.y + 4);
    const msg: Messenger = { p, mail, from: a.from, to: a.to, thread: a.thread, line: a.line, held: a.held };
    this.messengers.add(msg);
    const cardTarget = (): Target => ({ kind: "capsule", from: a.from, to: a.to, thread: a.thread, line: a.line, held: a.held });
    this.hitbox(p.sprite, cardTarget);
    this.hitbox(mail, cardTarget);

    if (fromShop && sender) {
      this.onErrand.add(a.from);
      this.refresh();
    }

    const done = () => {
      this.messengers.delete(msg);
      p.destroy();
      mail.destroy();
      if (this.onErrand.delete(a.from)) this.refresh();
      this.busy--;
      this.perform(this.director.cameHome(a.from));
    };

    const route = (from: Pt, to: Pt) => this.grid?.path(from, to) ?? [to];

    if (!a.walk) {
      // Reduce Motion: brief appearance at sender → Post Office → receiver.
      this.stamp(a.thread.committee);
      p.sprite.setAlpha(0); mail.setAlpha(0);
      this.tweens.chain({
        tweens: [
          { targets: [p.sprite, mail], alpha: 1, duration: 240 },
          { targets: [p.sprite, mail], alpha: 0, delay: 700, duration: 240 },
          { targets: [p.sprite, mail], x: destPt.x, y: destPt.y, duration: 1 },
          { targets: [p.sprite, mail], alpha: 1, duration: 240 },
          { targets: [p.sprite, mail], alpha: 0, delay: 800, duration: 240 },
        ],
        onComplete: done,
      } as unknown as Phaser.Types.Tweens.TweenChainBuilderConfig);
      return;
    }

    const walkHome = () => {
      mail.setVisible(false);
      if (!fromShop) {
        // Guest returns back across the north bridge and fades out.
        p.walk(route({ x: p.x, y: p.y }, startPt), () => {
          this.tweens.add({ targets: p.sprite, alpha: 0, duration: 240, onComplete: done });
        }, "walk");
        return;
      }
      p.walk(route({ x: p.x, y: p.y }, fromShop.slot.door), () => {
        this.tweens.add({ targets: p.sprite, alpha: 0, duration: 180, onComplete: done });
      }, "walk");
    };

    const deliver = () => {
      if (toShop) this.flash(toShop);
      this.time.delayedCall(280, walkHome);
    };

    const toDestination = () => {
      this.spin();
      this.stamp(a.thread.committee);
      if (a.held && toShop) {
        // Held delivery: senator walks to the receiver's mailbox and waits while signal blinks red!
        const waitPt = this.grid?.nearestWalkable({ x: toShop.slot.signal.x, y: toShop.slot.door.y }) ?? toShop.slot.door;
        p.walk(route({ x: p.x, y: p.y }, waitPt), () => {
          p.face(toShop.slot.at);
          toShop.held++;
          retexture(toShop.lamp, "lamp-red");
          this.busy--;
          this.heldMessages.set(`${a.thread.committee}:${a.thread.root}`, () => {
            this.busy++;
            toShop.held = Math.max(0, toShop.held - 1);
            if (!toShop.held) retexture(toShop.lamp, "lamp-green");
            p.walk(route({ x: p.x, y: p.y }, toShop.slot.door), deliver, "hurry");
          });
        }, "hurry");
        return;
      }
      p.walk(route({ x: p.x, y: p.y }, destPt), deliver, "hurry");
    };

    // Leg 1: Walk along village streets from sender's house (or North Bridge) to the Post Office.
    p.walk(route(startPt, postDoor), () => this.time.delayedCall(220, toDestination), "hurry");
  }

  private release(thread: ThreadRef) {
    const key = `${thread.committee}:${thread.root}`;
    const go = this.heldMessages.get(key);
    if (!go) return;
    this.heldMessages.delete(key);
    this.touch();
    go();
  }

  private spin() {
    if (this.reduceMotion || !this.wheel) return;
    this.tweens.add({ targets: this.wheel, angle: this.wheel.angle + 90, duration: 600, ease: "Cubic.Out" });
  }

  private stamp(committee: string) {
    this.reels.set(committee, (this.reels.get(committee) ?? 0) + 1);
    this.drawReels(committee);
    this.stampFlash();
  }

  private drawReels(latest?: string) {
    const names = [...this.reels.keys()].sort();
    this.reelLayer.removeAll(true);
    names.slice(0, 6).forEach((n, row) => {
      const y = -28 + row * 10;
      const count = this.reels.get(n) ?? 0;
      const len = Math.min(130, 8 + count * 8);
      this.reelLayer.add(sprite(this, 0, y, bar(this, 136, 6, 0x2c3657)));
      this.reelLayer.add(sprite(this, -66 + len / 2, y, bar(this, len, 4, n === latest ? PALETTE.amber : 0x8fa0d6)));
    });
  }

  private stampFlash() {
    if (this.reduceMotion) return;
    const arch = this.plan.civic.archive.at;
    const s = this.add.image(arch.x + 68, arch.y - 54, "glow").setBlendMode(Phaser.BlendModes.ADD).setScale(0.7).setAlpha(0).setDepth(19_100);
    this.busy++;
    this.tweens.chain({
      tweens: [{ targets: s, alpha: 1, duration: 120 }, { targets: s, alpha: 0, duration: 380 }],
      onComplete: () => { s.destroy(); this.busy--; },
    } as unknown as Phaser.Types.Tweens.TweenChainBuilderConfig);
  }

  private flash(shop: Shop) {
    const s = this.add.image(shop.slot.at.x, shop.slot.at.y + 16, "glow").setBlendMode(Phaser.BlendModes.ADD).setScale(1.4).setAlpha(0).setDepth(19_100);
    this.busy++;
    this.tweens.chain({
      tweens: [{ targets: s, alpha: 0.95, duration: 150 }, { targets: s, alpha: 0, duration: 550 }],
      onComplete: () => { s.destroy(); this.busy--; },
    } as unknown as Phaser.Types.Tweens.TweenChainBuilderConfig);
  }

  private worker(senator: string, kind: ToolKind, target?: string) {
    const shop = this.shopOf(senator);
    if (!shop) { this.director.workerHome(); return; }
    const door = shop.slot.door;
    const yard = { x: door.x - 36, y: door.y - 6 };
    const p = new Person(this, door, generateLook(`worker-${kind}-${senator}`), TOOLS[kind], { gait: "walk", hardhat: kind === "bash", reduceMotion: this.reduceMotion });
    const held = sprite(this, door.x + 12, door.y - 18, toolArt(this, kind)).setDepth(door.y + 3);
    const f = { p, held, dx: 12, dy: -18 };
    this.followers.push(f);
    for (const o of [p.sprite, held]) this.hitbox(o, () => ({ kind: "worker", senator, tool: kind, target }));
    this.busy++;
    const finish = () => {
      this.followers = this.followers.filter((x) => x !== f);
      p.destroy();
      held.destroy();
      this.busy--;
      this.director.workerHome();
    };
    const route = (to: Pt) => this.grid?.path({ x: p.x, y: p.y }, to) ?? [to];
    const home = () => p.walk(route(door), () => this.tweens.add({ targets: [p.sprite, held], alpha: 0, duration: 200, onComplete: finish }));
    const job = (): Pt => {
      if (kind === "mcp") return this.plan.civic.postOffice.door;
      if (kind === "web") return { x: this.plan.civic.gate.x + 20, y: this.plan.civic.gate.y + 8 };
      return yard;
    };
    p.walk(route(job()), () => {
      p.face({ x: p.x, y: p.y + 10 });
      if (kind === "web") {
        this.tweens.chain({
          tweens: [{ targets: [p.sprite, held], alpha: 0, duration: 280 }, { targets: [p.sprite, held], alpha: 1, duration: 280, delay: 1600 }],
          onComplete: home,
        } as unknown as Phaser.Types.Tweens.TweenChainBuilderConfig);
        return;
      }
      if (kind === "mcp") {
        this.tweens.chain({
          tweens: [{ targets: held, alpha: 0, duration: 240 }, { targets: held, alpha: 1, duration: 240, delay: 450 }],
          onComplete: home,
        } as unknown as Phaser.Types.Tweens.TweenChainBuilderConfig);
        return;
      }
      const swing = kind === "bash" ? { angle: -50, duration: 160, yoyo: true, repeat: 5 }
        : kind === "grep" ? { dx: 16, duration: 280, yoyo: true, repeat: 2 }
        : { dy: -22, duration: 240, yoyo: true, repeat: 3 };
      const st = { dx: f.dx, dy: f.dy };
      if ("angle" in swing) this.tweens.add({ targets: held, ...swing, onComplete: home });
      else this.tweens.add({
        targets: st, ...("dx" in swing ? { dx: f.dx + (swing.dx ?? 0) } : { dy: swing.dy }),
        duration: swing.duration, yoyo: swing.repeat ? swing.yoyo : false, repeat: swing.repeat,
        onUpdate: () => { f.dx = st.dx; f.dy = st.dy; },
        onComplete: () => { f.dx = 12; f.dy = -18; home(); },
      });
    });
  }

  private linkPulse(link: "parent" | "child" | "remote") {
    if (link === "remote" && !this.reduceMotion) this.trainNext = 0;
  }

  // MARK: Probing & Measurement

  probe(click: boolean): boolean {
    for (const shop of this.shops.values()) {
      const d = shop.desks.find((x) => x.id && x.lit);
      if (!d?.id) continue;
      const s = senatorsOf(this.state).get(d.id)!;
      const t: Target = { kind: "senator", senator: s, committee: shop.name };
      const cam = this.cameras.main;
      const wx = shop.slot.at.x + d.at.x, wy = shop.slot.at.y + d.at.y;
      if (click) this.hooks.open(t);
      else this.hooks.hover(t, (wx - cam.worldView.x) * cam.zoom, (wy - cam.worldView.y) * cam.zoom);
      this.touch();
      return true;
    }
    return false;
  }

  ablate(kind: string) {
    const hide = (o: { setVisible(v: boolean): unknown } | undefined) => o?.setVisible(false);
    const people = () => {
      for (const c of this.life?.civilians ?? []) hide(c.p.sprite);
      for (const e of this.elderPeople.values()) hide(e.p.sprite);
      for (const o of this.outside.values()) hide(o.p.sprite);
      for (const m of this.messengers) { hide(m.p.sprite); hide(m.mail); }
    };
    switch (kind) {
      case "people": people(); break;
      case "houses": for (const s of this.shops.values()) hide(s.root); break;
      case "ground": hide(this.groundImg); break;
      case "glow": for (const g of this.glows) hide(g); for (const l of this.lamps) hide(l); break;
      case "wash": hide(this.wash); break;
      case "all": for (const o of this.children.list) hide(o as Phaser.GameObjects.Image); break;
    }
  }

  stats() {
    const recent = this.ticks.filter((t) => t > performance.now() - 2000).length / 2;
    return {
      fps: Math.round(recent),
      zoom: Math.round(this.cameras.main.zoom * 100) / 100,
      sleeping: !this.game.loop.running,
      shops: this.shops.size,
      busy: this.busy,
      passed: this.passed,
      constructing: this.constructing,
    };
  }
}
