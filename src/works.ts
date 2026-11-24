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
  tool as toolArt, TOOLS, townGate, townHall, train, tree, WASH, lamp, sails, weatherArt, gardenArt, bar, image, retexture, artOf, where, type Daylight, type Style,
} from "./art.ts";
import { COLOURS, generateHouse, generateLook, houses, houseSize, readHouse, readLook, type HouseSpec, type Look } from "./gen.ts";
import { Room } from "./room.ts";
import groundTiles from "../assets/ground.png";
import worksMap from "../assets/works.tmj";
import { Life, type Places } from "./life.ts";
import { Grid } from "./nav.ts";
import { Person } from "./people.ts";
import { lightAt, seasonOf, streetLife, weatherOf, windOf, type Season, type Weather } from "./world.ts";
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


const CIVILIAN_SHIRTS = [0x9aa7b8, 0xc4b59a, 0x8fb3a6, 0xb79fae, 0xa9b78f, 0xc9a98f];

const BAYS = 4;
const SPEED = 520; // capsule px a second along tubes

export class Works extends Phaser.Scene {
  hooks!: Hooks;
  reduceMotion = false;
  dark = false;
  /** Fixed time of day (snapshots); else the clock. */
  fixedTime?: Daylight;
  /** Fixed weather and season (snapshots, demos); else the date's. */
  fixedWeather?: Weather;
  fixedSeason?: Season;
  /** The clock the time of day follows (the shell's time zone). */
  clock: () => Date = () => new Date();

  state: TownState = { committees: [] };
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
  /** The townspeople, the cat, the birds. */
  private life?: Life;
  /** Where people can walk. */
  private grid?: Grid;
  private solids: { x: number; y: number; w: number; h: number }[] = [];
  private capsules = new Set<Phaser.GameObjects.Image>();
  private elderPeople = new Map<string, { p: Person; age: number; leg: number; next: number }>();
  /** Idle senators out for a walk, by id (their bay is empty meanwhile). */
  private outside = new Map<string, { p: Person; shop: string }>();
  private strollNext = new Map<string, number>();
  /** People with something to follow them (a worker's tool). */
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
  private room?: Room;
  private roomName?: string;
  private hovered?: string;

  constructor() {
    super("works");
  }

  preload() {
    // Both are in the bundle itself (the map as JSON, the tiles as a data
    // URL): a scene loads nothing, so it runs in any shell, however strict.
    this.load.tilemapTiledJSON("works", worksMap as object);
    this.load.image("ground", groundTiles);
  }

  create() {
    const map = this.make.tilemap({ key: "works" });
    const props = (map.properties as { name: string; value: number }[]) ?? [];
    this.hubOffset = { x: props.find((p) => p.name === "hubX")?.value ?? 0, y: props.find((p) => p.name === "hubY")?.value ?? 0 };
    // The grass: a patch of the map's tiles drawn once and repeated as one
    // tiled sprite (a tile layer would be thousands of quads every frame).
    const layer = map.getLayer("ground");
    if (layer) {
      const T = map.tileWidth, N = Math.min(32, layer.width, layer.height);
      const src = this.textures.get("ground").getSourceImage() as HTMLImageElement;
      const patch = this.textures.exists("grass") ? (this.textures.get("grass") as Phaser.Textures.CanvasTexture) : this.textures.createCanvas("grass", N * T, N * T)!;
      const ctx = patch.getContext();
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const index = Math.max(0, (layer.data[y]?.[x]?.index ?? 1) - 1);
        ctx.drawImage(src, index * T, 0, T, T, x * T, y * T, T, T);
      }
      patch.refresh();
      this.add.tileSprite(-this.hubOffset.x, -this.hubOffset.y, map.widthInPixels, map.heightInPixels, "grass").setOrigin(0).setDepth(-30_000);
    }
    this.treesFromMap = (map.getObjectLayer("trees")?.objects ?? []).map((o) => ({ x: (o.x ?? 0) - this.hubOffset.x, y: (o.y ?? 0) - this.hubOffset.y }));
    for (const make of [hall, archive, townHall, memoryHall, signal, gate, bench, sheet, skyline, townGate, train, glow, lamp, weatherArt]) make(this);

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
    // Under Reduce Motion the loop sleeps when still; wake it now and then so the townspeople can move on (by fading).
    if (this.reduceMotion) window.setInterval(() => this.touch(400), 9_000);
    this.input.keyboard?.on("keydown-ENTER", () => { if (this.hovered) this.enter(this.hovered); });
    if (!this.scene.get("room")) this.scene.add("room", Room, false);
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
    if (this.reduceMotion) {
      // No walking: people fade from place to place (the routines still choose where).
      if (this.life && !this.roomName) this.life.update(Math.min(0.1, delta / 1000), now, { x: 0, y: 0, w: 0, h: 0 });
      const roomBusy = this.room?.sys.isActive() && this.room.tweens.getTweens().length > 0;
      if (this.busy === 0 && !roomBusy && !this.dragging && now > this.awakeUntil && this.tweens.getTweens().length === 0) this.game.loop.sleep();
      return;
    }
    if (this.roomName) return; // inside a house: the town waits
    const dt = Math.min(0.1, delta / 1000);
    const view = this.cameras.main.worldView;
    const on = (x: number, y: number, m = 60) => x > view.x - m && x < view.right + m && y > view.y - m && y < view.bottom + m;
    if (this.life) {
      // Fewer people out at night; more when the town is busy; never more than the view can hold.
      const working = this.state.committees.reduce((n, c) => n + c.senators.filter((x) => x.mood === "working").length, 0);
      const hour = this.fixedTime ? { dawn: 7, day: 13, dusk: 19, night: 2 }[this.fixedTime] : undefined;
      const when = hour === undefined ? this.clock() : new Date(2026, 0, 1, hour);
      this.life.life = Math.min(1, streetLife(when, this.dark && hour === undefined) * (0.7 + Math.min(0.3, working * 0.03)));
      this.life.cap = Math.max(4, Math.min(26, Math.round((view.width * view.height) / 60_000)));
      this.life.update(dt, now, { x: view.x, y: view.y, w: view.width, h: view.height });
    }
    this.strollElders(now);
    for (const e of this.elderPeople.values()) e.p.update(dt, now, on(e.p.x, e.p.y));
    for (const j of this.jobs) j.update(dt, now, on(j.x, j.y));
    for (const f of this.followers) {
      f.p.update(dt, now, on(f.p.x, f.p.y));
      f.held.setPosition(f.p.x + (f.p.sprite.flipX ? -f.dx : f.dx), f.p.y + f.dy).setDepth(f.p.y + 1);
    }
    for (const o of this.outside.values()) o.p.update(dt, now, on(o.p.x, o.p.y));
    if (now - this.lastTick > 1000) { this.lastTick = now; this.ambleSenators(now); }
    this.ambient(dt, now, on);
    this.cull(now);
  }

  /** Not on screen (hidden, occluded, minimised, display asleep): nothing runs and nothing wakes it. */
  paused = false;
  /** Calm: half the townspeople, no weather (a setting the person keeps). */
  calm = false;

  setCalm(calm: boolean) {
    if (calm === this.calm) return;
    this.calm = calm;
    if (this.shops.size) this.build([]);
  }

  private cullAt = 0;

  /** Up close, what is out of view isn't drawn at all (without touching anyone's visibility). */
  private cull(now: number) {
    if (now < this.cullAt) return;
    this.cullAt = now + 400;
    const cam = this.cameras.main, v = cam.worldView, m = 220;
    const bit = cam.id;
    for (const o of this.children.list) {
      const g = o as Phaser.GameObjects.GameObject & { scrollFactorX?: number; getBounds?: () => Phaser.Geom.Rectangle; x?: number; y?: number };
      if (g.scrollFactorX === 0 || o === this.baked) continue;
      let inside = true;
      if (o instanceof Phaser.GameObjects.Image || o instanceof Phaser.GameObjects.Container) {
        const b = o.getBounds();
        inside = b.right > v.x - m && b.x < v.right + m && b.bottom > v.y - m && b.y < v.bottom + m;
      }
      o.cameraFilter = inside ? o.cameraFilter & ~bit : o.cameraFilter | bit;
    }
  }

  /** Idle senators now and then step out for a short walk round their house, one per house. */
  private ambleSenators(now: number) {
    if (this.outside.size >= 4) return;
    for (const shop of this.shops.values()) {
      if ([...this.outside.values()].some((o) => o.shop === shop.name)) continue;
      const c = this.state.committees.find((k) => k.name === shop.name);
      for (const s of c?.senators ?? []) {
        if (s.mood !== "idle") continue;
        const due = this.strollNext.get(s.id) ?? now + 20_000 + Number(hash(s.id) % 60_000n);
        this.strollNext.set(s.id, due);
        if (now < due) continue;
        this.strollNext.set(s.id, now + 90_000 + Number(hash(`${s.id}${Math.round(now)}`) % 90_000n));
        const at = shop.slot.at, { w, h } = shop.size;
        const door = { x: at.x + 20, y: at.y + h / 2 + 8 };
        const p = new Person(this, door, readLook(s.card, generateLook(s.id)), RUNTIME[s.runtime], { glyph: s.runtime, chair: s.chair, gait: "stroll" });
        this.hitbox(p.sprite, () => ({ kind: "senator", senator: senatorsOf(this.state).get(s.id) ?? s, committee: shop.name }));
        this.outside.set(s.id, { p, shop: shop.name });
        this.refresh();
        // Round the block: the garden, the side of the house, a stretch, and back in.
        const loop = [{ x: at.x - w / 2 - 30, y: at.y + h / 2 + 26 }, { x: at.x + w / 2 + 30, y: at.y + h / 2 + 30 }]
          .map((q) => this.grid?.nearestWalkable(q) ?? q);
        const path = [door, ...loop, door].flatMap((q, i, all) => (i ? this.grid?.path(all[i - 1]!, q)?.slice(1) ?? [q] : [q]));
        p.walk(path, () => this.cameIn(s.id));
        return;
      }
    }
  }

  /** Work arrived: hurry back in. */
  private callBack(id: string) {
    const o = this.outside.get(id);
    const shop = o && this.shops.get(o.shop);
    if (!o || !shop || o.p.gait === "hurry") return;
    const door = { x: shop.slot.at.x + 20, y: shop.slot.at.y + shop.size.h / 2 + 8 };
    o.p.walk(this.grid?.path({ x: o.p.x, y: o.p.y }, door) ?? [door], () => this.cameIn(id), "hurry");
  }

  private cameIn(id: string) {
    const o = this.outside.get(id);
    if (!o) return;
    this.outside.delete(id);
    o.p.destroy();
    this.refresh();
  }

  /** The small life of the place: trees in the wind, the windmill, the wheel, smoke, clouds, the train, blinking signals. */
  private ambient(dt: number, now: number, on: (x: number, y: number, m?: number) => boolean) {
    const t = now / 1000;
    for (const tr of this.trees) if (on(tr.x, tr.y)) tr.setAngle(Math.sin(t * (0.9 + this.wind) + tr.x * 0.013) * (0.6 + this.wind * 3.2));
    for (const f of this.swayers) f.setScale(0.5 * CIVIC_SCALE * (0.86 + 0.14 * Math.sin(t * (2 + this.wind * 4))), 0.5 * CIVIC_SCALE);
    for (const sp of this.spinners) sp.img.rotation += sp.speed * (0.3 + this.wind) * dt;
    this.traffic = Math.max(0, this.traffic - dt * 0.25);
    if (this.wheel) this.wheel.rotation += (0.12 + this.traffic * 0.45) * dt;
    // Smoke from the chimneys of houses where work is happening (more work, more smoke).
    for (const sm of this.smoke) {
      if (now < sm.next || !on(sm.at.x, sm.at.y, 120) || this.puffs.length > 60) continue;
      const working = this.state.committees.find((c) => c.name === sm.shop)?.senators.filter((s) => s.mood === "working").length ?? 0;
      if (!working) { sm.next = now + 2000; continue; }
      sm.next = now + 1400 / Math.min(3, working);
      const puff = image(this, sm.at.x, sm.at.y, "puff").setScale(0.35).setAlpha(0.55).setDepth(8_000);
      puff.setData("v", 14 + Math.random() * 6).setData("age", 0);
      this.puffs.push(puff);
    }
    for (const puff of this.puffs) {
      const age = (puff.getData("age") as number) + dt;
      puff.setData("age", age);
      puff.y -= (puff.getData("v") as number) * dt;
      puff.x += this.wind * 10 * dt;
      puff.setScale(0.35 + age * 0.22).setAlpha(Math.max(0, 0.55 - age * 0.16));
    }
    const old = this.puffs.filter((p) => (p.getData("age") as number) > 3.4);
    for (const p of old) p.destroy();
    if (old.length) this.puffs = this.puffs.filter((p) => !old.includes(p));
    // Rain falls over what is in view (a thin band above it).
    if (this.rainZone) { const v = this.cameras.main.worldView; this.rainZone.setTo(v.x - 100, v.y - 300, v.width + 200, v.height * 0.6 + 300); }
    // Cloud shadows drift with the wind.
    const b = bounds(this.plan);
    for (const k of this.clouds) {
      k.x += (8 + this.wind * 22) * dt;
      if (k.x > b.x + b.w + 400) k.x = b.x - 400;
    }
    // The train keeps a timetable: in, a pause at the station, out again.
    const train = this.dynamic.find((o) => o.name === "train") as Phaser.GameObjects.Image | undefined;
    if (train && now > this.trainNext) {
      this.trainNext = now + 70_000;
      this.tweens.chain({ tweens: [{ targets: train, y: 420, duration: 6000, ease: "Sine.InOut" }, { targets: train, y: 120, duration: 6000, delay: 5000, ease: "Sine.InOut" }],
        onUpdate: () => train.setDepth(train.y) } as unknown as Phaser.Types.Tweens.TweenChainBuilderConfig);
    }
    // A held delivery's red signal blinks.
    for (const shop of this.shops.values()) if (shop.held) shop.lamp.setAlpha(0.65 + 0.35 * Math.sin(t * 5)); else if (shop.lamp.alpha !== 1) shop.lamp.setAlpha(1);
  }

  touch(hold = 500) {
    if (this.paused) return;
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
    this.cullAt = 0; // the view moved: cull again now
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

  /** The light over the town now: the clock's, or night when dark. */
  private applyDaylight() {
    const fixed = this.fixedTime;
    const w = fixed ? { ...WASH[fixed], lamps: WASH[fixed].glow } : (() => { const l = lightAt(this.clock(), this.dark); return { ...l, glow: l.lamps }; })();
    // Rain and fog grey the light a little.
    const grey = this.weather === "rain" ? 0.12 : this.weather === "fog" || this.weather === "cloudy" ? 0.06 : 0;
    const alpha = Math.min(0.75, w.alpha + grey);
    this.wash.setFillStyle(w.alpha > 0 ? w.color : 0x8a96a8, 1).setAlpha(alpha).setVisible(alpha > 0);
    for (const g of this.glows) g.setVisible(w.glow);
    for (const l of this.lamps) if (l.texture.key === "glow") l.setVisible(w.glow);
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
    this.solids = [];
    this.capsules.clear();
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
    this.season = this.fixedSeason ?? seasonOf(this.clock());
    this.weather = this.calm ? "clear" : this.fixedWeather ?? weatherOf(this.clock());
    this.wind = windOf(this.weather);
    const treeKey = tree(this, this.season);
    for (const t of this.treesFromMap.filter(keep)) {
      const img = this.add2(sprite(this, t.x, t.y + 24, treeKey).setOrigin(0.5, 52 / 56).setDepth(t.y));
      this.trees.push(img);
    }

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
    const flag = this.add2(sprite(this, c.townHall.x + 1, c.townHall.y - 105 * CIVIC_SCALE, "speaker-flag").setOrigin(0, 1).setScale(0.5 * CIVIC_SCALE).setDepth(c.townHall.y));
    this.swayers.push(flag);
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
    this.padsG = pads;
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

  /** The townspeople, the cat and the birds, on a walkable grid with the buildings blocked out. */
  private populate() {
    const p = this.plan, c = p.civic;
    const b = bounds(p);
    const grid = new Grid({ x: b.x - 200, y: b.y - 100, w: b.w + 400, h: b.h + 300 }, 20);
    for (const r of this.solids) grid.block(r);
    grid.blockCircle({ x: 0, y: 0 }, HALL_R + 6);
    const civicBox = (at: Pt, w: number, h: number) => grid.block({ x: at.x - w / 2, y: at.y - h / 2, w, h });
    civicBox(c.archive, 150, 130);
    civicBox(c.townHall, 210, 150);
    civicBox(c.memory, 150, 100);
    // The river, and the rail's bed.
    grid.block({ x: b.x - 400, y: c.parent.y + 40, w: b.w + 800, h: 40 });
    grid.block({ x: c.rail - 24, y: b.y - 200, w: 48, h: b.h + 600 });
    this.grid = grid;
    const r0 = this.roadRadius();
    const ring = Array.from({ length: 16 }, (_, i) => -Math.PI / 2 + WEDGE + 0.15 + (i / 15) * (2 * Math.PI - 2 * WEDGE - 0.3))
      .map((a) => ({ x: Math.cos(a) * r0, y: Math.sin(a) * r0 }));
    const benches = c.promenade.filter((_, i) => i % 2 === 0).map((q) => ({ x: q.x + 60, y: q.y + 14 }));
    const gardens = [...this.shops.values()].flatMap((s) => [{ x: s.slot.at.x - s.size.w / 2 - 22, y: s.slot.at.y + s.size.h / 2 + 18 }, { x: s.slot.at.x + s.size.w / 2 + 22, y: s.slot.at.y + s.size.h / 2 + 18 }]);
    const places: Places = {
      benches,
      spots: [...ring, ...c.promenade, { x: c.monuments.x, y: c.monuments.y - 150 }, { x: c.gate.x + 60, y: c.gate.y + 50 }],
      homes: c.children.map((k) => ({ x: k.x, y: k.y - 50 })),
      shelters: [...this.shops.values()].map((s) => ({ x: s.slot.at.x, y: s.slot.at.y + s.size.h / 2 + 16 })),
      gardens,
    };
    this.life = new Life(this, grid, places, () => [...this.capsules].map((k) => ({ x: k.x, y: k.y })), this.reduceMotion);
    this.life.weather = this.weather;
    const full = Math.max(8, Math.min(26, 8 + Math.round(this.state.committees.length * 0.6)));
    const n = this.calm ? Math.ceil(full / 2) : full;
    this.life.populate(n, (img) => this.hitbox(img, () => ({ kind: "civilian" })));
    // Street lamps round the ring road, lit from dusk.
    for (const [i, q] of ring.entries()) {
      if (i % 2) continue;
      const l = sprite(this, q.x * 1.06, q.y * 1.06 - 10, "lamp").setDepth(q.y * 1.06);
      this.lamps.push(l);
      this.lamps.push(this.add.image(q.x * 1.06, q.y * 1.06 - 28, "glow").setBlendMode(Phaser.BlendModes.ADD).setScale(0.55).setAlpha(0.8).setDepth(9_002));
    }
    this.setupWeather();
  }

  private roadRadius() {
    const rings = [...this.plan.slots.values()].map((s) => Math.hypot(s.at.x, s.at.y));
    return Math.min(...rings, 560) - WORKSHOP.h / 2 - 34;
  }

  /** The day's weather: rain or snow, fog in the morning, cloud shadows drifting over. */
  private setupWeather() {
    this.rain?.destroy();
    this.rain = undefined;
    this.fog?.destroy();
    this.fog = undefined;
    for (const k of this.clouds) k.destroy();
    this.clouds = [];
    this.rainZone = undefined;
    if (this.reduceMotion || this.calm) return;
    const cam = this.cameras.main;
    if (this.weather === "rain") {
      const snow = this.season === "winter";
      this.rainZone = new Phaser.Geom.Rectangle(0, 0, 10, 10);
      const [page, frame] = where(snow ? "flake" : "drop");
      this.rain = this.add.particles(0, 0, page, {
        frame,
        emitZone: { type: "random", source: this.rainZone } as unknown as Phaser.Types.GameObjects.Particles.EmitZoneData, lifespan: snow ? 9000 : 2600,
        speedY: snow ? { min: 40, max: 70 } : { min: 900, max: 1100 }, speedX: snow ? { min: -20, max: 20 } : -120 * this.wind,
        scale: snow ? { min: 0.4, max: 0.8 } : 0.5, alpha: snow ? 0.9 : 0.55, frequency: snow ? 40 : 14, quantity: 1,
      }).setDepth(9_500);
    }
    if (this.weather === "fog") { this.fog = this.add.rectangle(0, 0, cam.width, cam.height, 0xffffff, 0.28).setOrigin(0).setScrollFactor(0).setDepth(9_400); this.placeWash(); }
    const n = this.weather === "cloudy" || this.weather === "rain" ? 6 : this.weather === "clear" ? 2 : 4;
    const b = bounds(this.plan), rnd = seeded("clouds");
    for (let i = 0; i < n; i++) {
      this.clouds.push(image(this, b.x + rnd() * b.w, b.y + rnd() * b.h, "cloud").setScale(2 + rnd() * 2).setAlpha(this.weather === "clear" ? 0.07 : 0.12).setDepth(8_900));
    }
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
    // Two townspeople put on hard hats and walk over.
    const spots = [{ x: at.x - w / 2 - 22, y: at.y + h / 2 + 14 }, { x: at.x + w / 2 + 22, y: at.y + h / 2 + 14 }];
    const builders = [this.life?.recruit(at), this.life?.recruit(at)].filter((b): b is Person => !!b).map((civ, i) => {
      civ.sprite.setVisible(false);
      const b = new Person(this, { x: civ.x, y: civ.y }, civ.look, civ.shirt, { hardhat: true, gait: "hurry" });
      this.jobs.push(b);
      const spot = this.grid?.nearestWalkable(spots[i]!) ?? spots[i]!;
      b.walk(this.grid?.path({ x: b.x, y: b.y }, spot) ?? [spot], () => {
        b.face({ x: at.x, y: b.y });
        // Hammering: a little bob in place while the house goes up.
        this.tweens.add({ targets: b.sprite, y: b.y - 2, duration: 180, yoyo: true, repeat: 12 });
      });
      return { civ, b };
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
          for (const { civ, b } of builders) {
            const back = () => {
              civ.sprite.setPosition(b.x, b.y).setVisible(true);
              this.life?.dismiss(civ);
              this.jobs = this.jobs.filter((j) => j !== b);
              b.destroy();
              if (--left === 0) finish();
            };
            const away = this.grid?.nearestWalkable({ x: b.x + (b.x < at.x ? -60 : 60), y: b.y + 40 });
            if (away) b.walk(this.grid?.path({ x: b.x, y: b.y }, away) ?? [away], back, "walk"); else back();
          }
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
    this.plazaG = g;
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
    // Beyond the plaza (not baked: it reaches far out): the promenade, the river, the rail, the gate road.
    const o = this.add.graphics().setDepth(-19_999);
    this.add2(o);
    this.outerGround(o);
  }

  private outerGround(g: Phaser.GameObjects.Graphics) {
    const p = this.plan, c = p.civic;
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
    this.bakeGround();
  }

  private plazaG?: Phaser.GameObjects.Graphics;
  private padsG?: Phaser.GameObjects.Graphics;
  private baked?: Phaser.GameObjects.Image;

  /**
   * The plaza, its ring roads, the tubes and the empty lots change only when
   * the state does, but drawn as shapes they would be rebuilt every frame:
   * so they are drawn once into one texture (again on each refresh) and the
   * shapes are hidden.
   */
  private bakeGround() {
    const parts = [this.plazaG, this.tubes, this.padsG].filter((g): g is Phaser.GameObjects.Graphics => !!g && g.active);
    if (!parts.length) return;
    const R = this.plan.outer + 40;
    const res = Math.min(1.5, 4096 / (2 * R));
    const size = Math.ceil(2 * R * res);
    let tex = this.textures.exists("ground-bake") ? (this.textures.get("ground-bake") as Phaser.Textures.DynamicTexture) : undefined;
    if (tex && (tex.width !== size || tex.height !== size)) tex.setSize(size, size);
    tex ??= this.textures.addDynamicTexture("ground-bake", size, size)!;
    tex.clear();
    for (const g of parts) {
      const was = { x: g.x, y: g.y, s: g.scale };
      g.setVisible(true).setScale(res).setPosition(R * res, R * res);
      tex.draw([g]);
      tex.render(); // drawing is deferred until render: render before the shape is put back
      g.setScale(was.s).setPosition(was.x, was.y).setVisible(false);
    }
    if (!this.baked?.active) this.baked = this.add2(this.add.image(0, 0, "ground-bake").setDepth(-20_000));
    this.baked.setScale(1 / res);
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
    if (spec.garden !== "lawn") root.add(sprite(this, 5, h / 2 + 15, gardenArt(this, spec.garden, w)));
    if (spec.landmark !== "none") root.add(sprite(this, w / 2 + 34, -h / 2 + 10, landmark(this, spec.landmark, COLOURS[spec.trim]!)).setOrigin(0.5, 0.75));
    if (spec.landmark === "windmill") {
      const sail = sprite(this, w / 2 + 34, -h / 2 + 10 - 49.5, sails(this));
      root.add(sail);
      this.spinners.push({ img: sail, speed: 0.6 });
    }
    // Where people can't walk: the house and its garden's front.
    this.solids.push({ x: slot.at.x - w / 2 - 10, y: slot.at.y - h / 2 - 10, w: w + 20, h: h + 22 });
    // A chimney: smoke while someone inside works.
    this.smoke.push({ at: { x: slot.at.x - w / 4, y: slot.at.y - h / 2 - HOUSE_TOP + 14 }, shop: name, next: 0 });
    const body = sprite(this, 0, 0, art.key).setOrigin(0.5, (HOUSE_TOP + h / 2) / (h + HOUSE_TOP + 10));
    root.add(body);
    // Winter: snow along the roof.
    if (this.season === "winter") root.add(sprite(this, 0, -h / 2 - HOUSE_TOP + 40, bar(this, w - 24, 8, 0xffffff, 0xd8e2ee, 1.5)));
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
        retexture(b.window, bay(this, on));
        b.window.removeAllListeners();
        if (!s || s.mood === "stopped") return;
        // Out for a walk: the bay stays empty until it comes back (at once when work arrives).
        const out = this.outside.get(s.id);
        if (out) {
          if (s.mood !== "idle") this.callBack(s.id);
          return;
        }
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
      const sill = sprite(this, 0, shop.bayY + 26, bar(this, shop.size.w - 36, 10, wall, INK));
      shop.root.add(sill);
      shop.extras.push(sill);
      const litBays = shop.bays.filter((b) => artOf(b.window) === "bay-lit");
      for (const b of litBays) {
        shop.extras.push(this.glowAt(shop.slot.at.x + b.window.x, shop.slot.at.y + b.window.y, 0.9)
          .setVisible(WASH[this.fixedTime ?? daylight(this.clock(), this.dark)].glow));
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

  /** Elders on the promenade, aged by idle time: the youngest still walk (slowly, some with a cane), the oldest sit on a bench. */
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
      const at = age >= 3 ? { x: prom[(i % 2) * 2]!.x + 60 + (i % 3) * 14, y: prom[(i % 2) * 2]!.y + 14 } : { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const base = generateLook(e.id);
      const look: Look = { ...base, hairColour: 5, hair: age >= 3 && base.hair === "long" ? "bun" : base.hair, hat: age >= 2 ? base.hat : "none" };
      const p = new Person(this, at, look, shirt, { cane: age >= 2, gait: "elder", reduceMotion: this.reduceMotion });
      if (age >= 3) p.sit();
      this.hitbox(p.sprite, () => ({ kind: "elder", elder: e }));
      this.elderPeople.set(e.id, { p, age, leg, next: performance.now() + 8000 + i * 6000 });
    });
  }

  /** Now and then an elder walks on to the next corner of the promenade. */
  private strollElders(now: number) {
    const prom = this.plan.civic.promenade;
    for (const e of this.elderPeople.values()) {
      if (e.age >= 3 || e.p.moving || now < e.next) continue;
      e.leg = (e.leg + 1) % prom.length;
      const to = prom[e.leg]!;
      e.p.walk(this.grid?.path({ x: e.p.x, y: e.p.y }, to) ?? [to], () => { e.next = performance.now() + 15_000 + Math.random() * 25_000; });
      e.next = Infinity;
    }
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
    this.capsules.add(cap);
    this.traffic = Math.min(6, this.traffic + 1);
    const done = () => { this.capsules.delete(cap); cap.destroy(); this.busy--; this.perform(this.director.cameHome(a.from)); };
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
        retexture(to.lamp, "lamp-red");
        this.busy--; // waiting is still: the loop may sleep
        this.heldCapsules.set(a.thread.committee + ":" + a.thread.root, () => {
          this.busy++;
          to.held = Math.max(0, to.held - 1);
          if (!to.held) retexture(to.lamp, "lamp-green");
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
      const len = Math.min(140, 6 + count * 6);
      this.reelLayer.add(sprite(this, 0, y, bar(this, 144, 10, 0x2c3657, undefined, 0)));
      this.reelLayer.add(sprite(this, -70 + len / 2, y, bar(this, 140, 6, n === latest ? PALETTE.amber : 0x8fa0d6, undefined, 0)).setScale(0.5 * (len / 140), 0.5));
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

  /** A tool call: a worker comes out of the door, walks to the job, does it where you can see, and walks back in. */
  private worker(senator: string, kind: ToolKind, target?: string) {
    const shop = this.shopOf(senator);
    if (!shop) { this.director.workerHome(); return; }
    const door = { x: shop.slot.at.x + 20, y: shop.slot.at.y + shop.size.h / 2 + 8 };
    const out = { x: door.x + Math.cos(shop.slot.angle) * 56, y: door.y + 26 + Math.max(0, Math.sin(shop.slot.angle)) * 20 };
    const p = new Person(this, door, generateLook(`worker-${kind}-${senator}`), TOOLS[kind], { gait: "walk", reduceMotion: this.reduceMotion });
    const held = sprite(this, door.x + 12, door.y - 18, toolArt(this, kind)).setDepth(door.y + 1);
    const f = { p, held, dx: 10, dy: -18 };
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
      if (kind === "mcp") return along(tube(shop.slot), 0.82); // a parcel to the sorting hall
      if (kind === "web") return { x: this.plan.civic.gate.x + 30, y: this.plan.civic.gate.y + 40 }; // off by the town gate
      return out;
    };
    p.walk(route(job()), () => {
      p.face({ x: p.x, y: p.y + 10 });
      if (kind === "web") {
        // The explorer goes out through the gate, and comes back.
        this.tweens.chain({ tweens: [{ targets: [p.sprite, held], alpha: 0, duration: 300 }, { targets: [p.sprite, held], alpha: 1, duration: 300, delay: 1800 }],
          onComplete: home } as unknown as Phaser.Types.Tweens.TweenChainBuilderConfig);
        return;
      }
      if (kind === "mcp") {
        this.tweens.chain({ tweens: [{ targets: held, alpha: 0, duration: 250 }, { targets: held, alpha: 1, duration: 250, delay: 500 }],
          onComplete: home } as unknown as Phaser.Types.Tweens.TweenChainBuilderConfig);
        return;
      }
      // At work just outside: a hammer swings, a quill writes, a book opens, a lens looks round.
      const swing = kind === "bash" ? { angle: -50, duration: 160, yoyo: true, repeat: 5 }
        : kind === "grep" ? { dx: 16, duration: 300, yoyo: true, repeat: 2 }
        : { dy: -22, duration: 250, yoyo: true, repeat: 3 };
      const st = { dx: f.dx, dy: f.dy };
      if ("angle" in swing) this.tweens.add({ targets: held, ...swing, onComplete: home });
      else this.tweens.add({ targets: st, ...("dx" in swing ? { dx: f.dx + (swing.dx ?? 0) } : { dy: swing.dy }), duration: swing.duration, yoyo: true, repeat: swing.repeat,
        onUpdate: () => { f.dx = st.dx; f.dy = st.dy; }, onComplete: () => { f.dx = 10; f.dy = -18; home(); } });
    });
  }

  /** The uplink, a child road or the rail carried something: it lights up for a moment. */
  private linkPulse(link: "parent" | "child" | "remote") {
    // The paired machine carried something: the next train comes now.
    if (link === "remote" && !this.reduceMotion) this.trainNext = 0;
  }


  // MARK: Probing and measurement

  probe(click: boolean): boolean {
    for (const shop of this.shops.values()) {
      const b = shop.bays.find((x) => x.id && artOf(x.window) === "bay-lit");
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

  /**
   * Measurement only: stop drawing one kind of thing, to see what it costs
   * (people, houses, the ground, the glows, the light overlay, everything).
   */
  ablate(kind: string) {
    const hide = (o: { setVisible(v: boolean): unknown } | undefined) => o?.setVisible(false);
    const people = () => {
      for (const c of this.life?.civilians ?? []) hide(c.p.sprite);
      for (const e of this.elderPeople.values()) hide(e.p.sprite);
      for (const o of this.outside.values()) hide(o.p.sprite);
    };
    switch (kind) {
      case "people": people(); break;
      case "houses": for (const s of this.shops.values()) hide(s.root); break;
      case "ground": hide(this.baked); for (const o of this.children.list) if (o.type === "TilemapLayer" || o.type === "Graphics") hide(o as Phaser.GameObjects.Graphics); break;
      case "glow": for (const g of this.glows) hide(g); for (const l of this.lamps) hide(l); this.lit.setVisible(false); break;
      case "wash": hide(this.wash); break;
      case "all": for (const o of this.children.list) hide(o as Phaser.GameObjects.Image); break;
    }
  }

  stats() {
    const recent = this.ticks.filter((t) => t > performance.now() - 2000).length / 2;
    return { fps: Math.round(recent), zoom: Math.round(this.cameras.main.zoom * 100) / 100, sleeping: !this.game.loop.running, shops: this.shops.size, busy: this.busy,
      passed: this.passed, constructing: this.constructing };
  }
}
