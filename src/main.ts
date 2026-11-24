// The Town page: the Works in a page of its own. Town is content: it gets
// the Senate's public observe data and its environment from whatever shell
// hosts it, through the scene host contract (host.ts), and asks the shell to
// open links. The shell is the Senate app's web view, a parent page (the
// browser reference shell) or, standalone, the in-page dev shell replaying
// a recording.
import Phaser from "phaser";
import type { Daylight } from "./art.ts";
import { Feed } from "./feed.ts";
import { connect, portBinding, webkitBinding, type Binding, type Environment, type Host, type Status } from "./host.ts";
import { firstWords } from "./model.ts";
import { devShell } from "./shell.ts";
import { Works, type Target } from "./works.ts";

let host: Host | undefined;
window.addEventListener("error", (e) => host?.error(`${e.message} @${e.filename?.split("/").pop()}:${e.lineno}`));
window.addEventListener("unhandledrejection", (e) => host?.error(String(e.reason)));

const scene = new Works();
const card = document.getElementById("card")!;
const back = document.getElementById("back") as HTMLButtonElement;
back.addEventListener("click", () => scene.leave());
const params = new URLSearchParams(location.search);
const dpr = Math.min(window.devicePixelRatio || 1, 3);
const time = params.get("time");
if (time === "dawn" || time === "day" || time === "dusk" || time === "night") scene.fixedTime = time as Daylight;
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
  loader: { imageLoadType: "HTMLImageElement" },
  scale: { mode: Phaser.Scale.NONE, width: innerWidth * dpr, height: innerHeight * dpr, zoom: 1 / dpr },
  scene,
});
window.addEventListener("resize", () => {
  game.scale.resize(innerWidth * dpr, innerHeight * dpr);
  game.scale.setZoom(1 / dpr);
});

// The loop sleeps when the town is still; any input wakes it.
for (const type of ["pointermove", "pointerdown", "wheel", "keydown"]) {
  window.addEventListener(type, () => scene.touch(), { passive: true });
}

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
  if (!game.isBooted) return;
  if (!env.visible) { game.loop.sleep(); game.pause(); } else { game.resume(); scene.touch(); }
}
const feed = new Feed({ snapshot: (s, e) => scene.setState(s, e), events: (e) => scene.act(e) });

async function shell(): Promise<Binding> {
  const demo = params.get("demo");
  if (!demo) {
    const native = webkitBinding();
    if (native) return native;
    const port = portBinding();
    if (port) return port;
  }
  const file = params.get("recording") ?? (demo === "large" || params.has("large") ? "recordings/demo-large.ndjson" : "recordings/demo.ndjson");
  return devShell({
    recording: () => fetch(file).then((r) => r.text()),
    loop: !params.has("once"),
    overrides: params.has("reduce-motion") ? { reduced_motion: true } : undefined,
  });
}
void shell().then((binding) => {
  host = connect(binding, { status, environment, snapshot: (s) => feed.snapshot(s), event: (f) => feed.frame(f) });
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
};
(window as unknown as { town: typeof api }).town = api;

if (params.has("stats")) setInterval(() => console.log("town-stats " + JSON.stringify(scene.stats())), 1000);
const into = params.get("enter");
if (into) {
  let tries = 0;
  const tryEnter = () => { if (scene.stats().shops > 0 || ++tries > 40) scene.enter(into); else setTimeout(tryEnter, 150); };
  setTimeout(tryEnter, 300);
}
