// The Town page: the Works in a page of its own. Town is content: it gets
// the Senate's public observe data and its environment from whatever shell
// hosts it, through the scene host contract (host.ts), and asks the shell to
// open links. The shell is the Senate app's web view, a parent page (the
// browser reference shell) or, standalone, the in-page dev shell replaying
// a recording.
import Phaser from "phaser";
import type { Daylight } from "./art.ts";
import { Feed } from "./feed.ts";
import { connect, inFrame, webkitBinding, type Binding, type Environment, type Host, type Status } from "./host.ts";
import { firstWords } from "./model.ts";
import { devShell } from "./shell.ts";
import { Works, type Target } from "./works.ts";

let host: Host | undefined;

const scene = new Works();
const card = document.getElementById("card")!;
const back = document.getElementById("back") as HTMLButtonElement;
back.addEventListener("click", () => scene.leave());
const params = new URLSearchParams(location.search);
const dpr = Math.min(window.devicePixelRatio || 1, 3);
const time = params.get("time");
if (time === "dawn" || time === "day" || time === "dusk" || time === "night") scene.fixedTime = time as Daylight;
const weather = params.get("weather"), season = params.get("season");
if (weather && ["clear", "cloudy", "rain", "windy", "fog"].includes(weather)) scene.fixedWeather = weather as Works["fixedWeather"];
if (season && ["spring", "summer", "autumn", "winter"].includes(season)) scene.fixedSeason = season as Works["fixedSeason"];
const ago = (s: number) => s < 3600 ? `${Math.round(s / 60)} min` : s < 86_400 ? `${Math.round(s / 3600)} h` : s < 14 * 86_400 ? `${Math.round(s / 86_400)} days` : `${Math.round(s / (7 * 86_400))} weeks`;

/** What a hover card says: the who and what, never drawn on the town. */
function describe(t: Target): string[] {
  switch (t.kind) {
    case "senator": {
      const s = t.senator;
      return [`${s.name}${s.chair ? " · chair" : ""}`, `${s.runtime} · ${s.mood}${t.committee ? ` · ${t.committee}` : " · town hall"}${s.watched ? " · someone is watching" : ""}`, ...(s.doing ? [s.doing] : [])];
    }
    case "elder": return [t.elder.name, `${t.elder.runtime} · last worked ${ago(t.elder.idle)} ago${t.elder.committee ? ` · ${t.elder.committee}` : ""}`, "opens its conversation in History"];
    case "workshop": return [`${t.name} workshop`, `${t.senators} senator${t.senators === 1 ? "" : "s"}${t.waiting ? ` · ${t.waiting} waiting on you` : ""}`];
    case "hall": return ["Sorting hall · senated --machine", "every message passes through bridge.sock", `${t.passed} sorted since you opened the town`];
    case "archive": return ["Archive · the Senate server's logs", "each message stamped and filed by seq", ...t.filed.filter(([, n]) => n > 0).slice(0, 5).map(([c, n]) => `${c}: ${n} filed here`)];
    case "townhall": return ["The Speaker's house · the desk", `docket ${t.docket}${t.secretary ? ` · ${t.secretary.name} ${t.secretary.mood}` : ""}`, "the secretaries work here; approvals' paperwork comes here"];
    case "memory": return ["Memory hall · History", `${t.sessions} ended sessions, each readable`];
    case "capsule": return [`${t.from} → ${t.to ?? t.thread.committee}`, `“${firstWords(t.line, 12, 80)}”`,
      `via the sorting hall, filed at ${t.thread.committee} #${t.thread.root}`, ...(t.held ? [`held: ${t.held}`] : [])];
    case "signal": return [`${t.committee}'s signal`, t.held ? `red: ${t.held}` : "green: deliveries go straight in"];
    case "gate": return [`Approval gate · ${t.approval.person ?? "a person"} must sign`, t.approval.ask, `for ${t.approval.senator}`];
    case "worker": return [`${({ bash: "builder", edit: "scribe", read: "librarian", grep: "searcher", mcp: "courier", web: "explorer" } as const)[t.tool]} · ${t.tool}`, `for ${t.senator}`, ...(t.target ? [t.target] : [])];
    case "monument": return t.next
      ? [`${t.project.name} · next release`, `${t.project.unreleased?.merges ?? 0} merged so far`, ...(t.project.unreleased?.plaques ?? [])]
      : [`${t.project.name} ${t.release!.name}${t.release!.date ? ` · ${t.release!.date}` : ""}`, `${t.release!.merges} merged`, ...t.release!.plaques];
    case "link": return [t.link === "parent" ? `${t.name} · the parent Senate` : t.link === "child" ? `${t.name} · a child Senate` : `${t.name} · a paired machine`,
      `${t.link === "parent" ? "the uplink" : t.link === "child" ? "the road" : "the rail"} is ${t.up ? "up" : "down"}`];
    case "waiting": return [`Waiting on ${t.person ?? "you"}`, t.thread.title, ...(t.thread.asker ? [`asked by ${t.thread.asker}`] : [])];
    case "gatehouse": return ["The town gate", "explorers leave here for the web"];
    case "civilian": return ["A townsperson"];
    case "archived": return [`${t.archived.name} · archived${t.archived.closed ? ` ${t.archived.closed}` : ""}`, "its house kept as a monument",
      ...(t.archived.shipped ?? []).slice(0, 4)];
  }
}

/** Where a click goes: the link the observed row carries, opened unchanged. One function for every target. */
function linkOf(t: Target): string | undefined {
  const st = scene.state, nav = st.navigation ?? {};
  switch (t.kind) {
    case "senator": return t.senator.link ?? st.committees.find((c) => c.name === t.committee)?.link;
    case "elder": return t.elder.link ?? nav.history;
    case "workshop": return st.committees.find((c) => c.name === t.name)?.link;
    case "townhall": return nav.desk;
    case "memory": return nav.history;
    case "gate": return t.approval.link ?? nav.approvals;
    case "capsule": case "waiting": return t.thread.link ?? st.committees.find((c) => c.name === t.thread.committee)?.link;
    case "archived": return t.archived.link;
    case "monument": return t.project.link;
    default: return undefined;
  }
}

scene.hooks = {
  hover(target, x, y) {
    if (!target) { card.hidden = true; return; }
    card.replaceChildren(...describe(target).map((line, i) => {
      const el = document.createElement(i === 0 ? "strong" : "span");
      el.textContent = line;
      return el;
    }));
    card.hidden = false;
    const r = card.getBoundingClientRect();
    card.style.left = `${Math.min(x / dpr + 14, innerWidth - r.width - 8)}px`;
    card.style.top = `${Math.min(y / dpr + 18, innerHeight - r.height - 8)}px`;
  },
  room(committee) { back.hidden = committee === undefined; },
  open(target) {
    const url = linkOf(target);
    if (url) host?.open(url);
  },
};

// The dev shell only announces the links a click would open.
window.addEventListener("senate-open", (e) => toast((e as CustomEvent<string>).detail));
function toast(text: string) {
  const el = document.getElementById("toast")!;
  el.textContent = text;
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 1600);
}

// A canvas backed at the screen's pixel density, shown at the page's size.
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "town",
  backgroundColor: "#bfe0a6",
  banner: false,
  audio: { noAudio: true },
  disableContextMenu: true,
  antialias: true,
  // Art is drawn at 2–4× its shown size; seen from afar it is sampled from
  // smaller copies (mipmaps), which is sharper and far cheaper for the GPU
  // than reading the whole large texture for every few pixels.
  render: { mipmapFilter: "LINEAR_MIPMAP_LINEAR", mipmapRegeneration: true } as Phaser.Types.Core.RenderConfig,
  loader: { imageLoadType: "HTMLImageElement" },
  scale: { mode: Phaser.Scale.NONE, width: innerWidth * dpr, height: innerHeight * dpr, zoom: 1 / dpr },
  fps: { limit: 30 },
  scene,
});
window.addEventListener("resize", () => {
  game.scale.resize(innerWidth * dpr, innerHeight * dpr);
  game.scale.setZoom(1 / dpr);
});

/**
 * How often the town draws, by what the person can see:
 * - in front (the window is key): 30 frames a second, 60 while panning or zooming;
 * - visible but not in front: 10;
 * - not visible at all (another page, the window hidden, occluded or
 *   minimised, the display asleep): paused, nothing runs;
 * - on battery or in Low Power Mode: at most 15.
 * Movement is by elapsed time, so any rate looks right. The shell says what
 * it knows (`visible`, and optionally `focused` and `power`); the page adds
 * what the browser knows (document visibility, window focus).
 */
const pace = {
  shellVisible: true,
  /** The shell says whether its window is in front (it knows better than DOM focus, which follows clicks); else the browser does. */
  shellFocused: undefined as boolean | undefined,
  lowPower: false,
  // Without a shell signal: assume in front until the page is told otherwise (an iframe has no focus until clicked).
  docFocused: true,
  interactUntil: 0,
  limit: 30,
  timer: 0,
  apply() {
    const visible = this.shellVisible && document.visibilityState === "visible";
    if (!visible) {
      scene.paused = true;
      if (game.isBooted) { game.loop.sleep(); game.pause(); }
      return;
    }
    const wasPaused = scene.paused;
    scene.paused = false;
    const now = performance.now();
    let fps = !(this.shellFocused ?? this.docFocused) ? 10 : now < this.interactUntil ? 60 : 30;
    if (this.lowPower) fps = Math.min(fps, 15);
    if (game.isBooted) {
      if (fps !== this.limit) { this.limit = fps; game.loop.setFPSLimit(fps); }
      if (wasPaused) { game.resume(); scene.touch(); }
    }
  },
  interact() {
    if (scene.paused) return;
    const was = performance.now() < this.interactUntil;
    this.interactUntil = performance.now() + 800;
    if (!was) this.apply();
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.apply(), 850);
  },
};
document.addEventListener("visibilitychange", () => pace.apply());
window.addEventListener("blur", () => { pace.docFocused = false; pace.apply(); });
window.addEventListener("focus", () => { pace.docFocused = true; pace.apply(); });
game.events.once("ready", () => pace.apply());

// Under Reduce Motion the loop sleeps when the town is still; any input wakes it. Panning and zooming draw at 60.
for (const type of ["pointermove", "pointerdown", "wheel", "keydown"]) {
  window.addEventListener(type, (e) => {
    scene.touch();
    if (type === "wheel" || (type === "pointermove" && (e as PointerEvent).buttons)) pace.interact();
  }, { passive: true });
}

// Calm: half the townspeople and no weather, kept in the shell's storage for this scene.
const calmButton = document.getElementById("calm") as HTMLButtonElement;
function showCalm(on: boolean) {
  calmButton.setAttribute("aria-pressed", String(on));
  calmButton.title = on ? "Calm is on: fewer people, no weather" : "Calm: fewer people, no weather";
}
calmButton.addEventListener("click", () => {
  const on = !scene.calm;
  scene.setCalm(on);
  showCalm(on);
  void host?.storageSet("calm", on);
});

// The shell: the app's web view, a parent page's port, or the dev shell
// (?demo=large for 30 committees, ?recording=<file> for another recording).
const statusEl = document.getElementById("status")!;
function status(state: Status) {
  statusEl.hidden = state === "ready";
  statusEl.textContent = state === "access_needed" ? "Town needs access to this Senate."
    : state === "version_mismatch" ? "This Town doesn't match this Senate's version." : "Waiting for the Senate…";
}
function environment(env: Environment) {
  scene.reduceMotion = env.reduced_motion;
  const dark = params.get("dark") === "1" || (params.get("dark") !== "0" && env.color_scheme === "dark");
  scene.setDark(dark);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.lang = env.locale;
  const zone = env.time_zone;
  scene.clock = () => { try { return new Date(new Date().toLocaleString("en-US", { timeZone: zone })); } catch { return new Date(); } };
  pace.shellVisible = env.visible;
  pace.shellFocused = env.focused;
  pace.lowPower = env.power === "battery" || env.power === "low_power";
  pace.apply();
}
const feed = new Feed({ snapshot: (s, e) => scene.setState(s, e), events: (e) => scene.act(e) });

function shell(): Binding | "parent" {
  const demo = params.get("demo");
  if (!demo) {
    const native = webkitBinding();
    if (native) return native;
    if (inFrame()) return "parent";
  }
  const file = params.get("recording") ?? (demo === "large" || params.has("large") ? "recordings/demo-large.ndjson" : "recordings/demo.ndjson");
  return devShell({
    recording: () => fetch(file).then((r) => r.text()),
    loop: !params.has("once"),
    overrides: params.has("reduce-motion") ? { reduced_motion: true } : undefined,
  });
}
void connect(shell(), { status, environment, snapshot: (s) => feed.snapshot(s), event: (f) => feed.frame(f) }).then((h) => {
  host = h;
  // The person's own setting, kept by the shell.
  void host.storageGet("calm").then((v) => { if (v === true) { scene.setCalm(true); showCalm(true); } });
});

/** Controls for tests and the app's snapshot hook (no data goes in here). */
const api = {
  setOptions(o: { time?: Daylight }) { if (o.time) scene.fixedTime = o.time; scene.touch(); },
  fit() { scene.fit(); },
  look(where: string, zoom: number) { scene.look(where, zoom); },
  enter(name: string) { scene.enter(name); },
  leave() { scene.leave(); },
  zoom(f: number) { scene.zoomAt(f, (innerWidth / 2) * dpr, (innerHeight / 2) * dpr); },
  stats() { return scene.stats(); },
  probe(click = false) { return scene.probe(click); },
  /** A texture as a data URL (to look at a walk sheet). */
  texture(key: string) { return scene.textures.exists(key) ? scene.textures.getBase64(key, "__BASE") : ""; },
  /** What the town draws, by kind (measurement). */
  counts() {
    const out: Record<string, number> = {};
    const walk = (list: Phaser.GameObjects.GameObject[]) => {
      for (const o of list) {
        out[o.type] = (out[o.type] ?? 0) + 1;
        if (o instanceof Phaser.GameObjects.Container) walk(o.list);
      }
    };
    walk(scene.children.list);
    return out;
  },
  /** Hide every object of a kind (measurement: what it costs to draw). */
  hide(type: string) { for (const o of scene.children.list) if (o.type === type) (o as unknown as { setVisible(v: boolean): void }).setVisible(false); },
  /** Stop drawing one kind of thing (measurement). */
  ablate(kind: string) { scene.ablate(kind); },
  /** Draw at another backing resolution (measurement: what full resolution costs). */
  resolution(d: number) { const cam = scene.cameras.main, c = cam.midPoint.clone(), z = cam.zoom * d / (game.scale.width / innerWidth); game.scale.resize(innerWidth * d, innerHeight * d); game.scale.setZoom(1 / d); cam.setZoom(z); cam.centerOn(c.x, c.y); },
  textures() { return scene.textures.getTextureKeys().filter((k) => k.startsWith("walk-")); },
};
(window as unknown as { town: typeof api }).town = api;

if (params.has("stats")) setInterval(() => console.log("town-stats " + JSON.stringify(scene.stats())), 1000);
const into = params.get("enter");
if (into) {
  let tries = 0;
  const tryEnter = () => { if (scene.stats().shops > 0 || ++tries > 40) scene.enter(into); else setTimeout(tryEnter, 150); };
  setTimeout(tryEnter, 300);
}
