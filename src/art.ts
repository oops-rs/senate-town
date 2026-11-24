// The Works' art, drawn in code: one warm, rounded, toy-like palette and
// every piece made once as a texture (at twice the size it is shown, so it
// stays crisp when zoomed). Nothing here is taken from a game or a pack.
import Phaser from "phaser";
import type { Runtime } from "./model.ts";
import { COLOURS, HAIRS, houseKey, houseSize, lookKey, SKINS, type HouseSpec, type Look } from "./gen.ts";


export const INK = 0x3d3a50;
export const PALETTE = {
  grass: 0xbfe0a6, grassDark: 0xa9d18e, paving: 0xf3e6cd, pavingEdge: 0xdcc7a3, road: 0xe9d7b5,
  glass: 0xe4f4ff, glassEdge: 0x7fb0d0, glassLit: 0xb9ecff,
  lit: 0xffe39a, unlit: 0x6f7fa3, skin: 0xf3d2b3, hair: 0x5a4334,
  red: 0xff5a5f, green: 0x47d16c, amber: 0xffc145, white: 0xffffff, cream: 0xfff6e2,
  copper: 0x4fa3a0, copperDark: 0x3a7f7c, navy: 0x4b5b8c, navyDark: 0x37446d,
  water: 0x8fd3f0, rail: 0x8a7967, wood: 0xc79a6b, woodDark: 0x9a7350, leaf: 0x7cc46b, leafDark: 0x5ea552,
  stone: 0xd9d3c7, stoneDark: 0xb3aa98,
};
/** The workshops' wall colours: soft and distinct, one per committee by hash. */
export const WALLS = [0xf6a97a, 0x9fd3ea, 0xbfe39a, 0xffd57e, 0xd6bfe6, 0xf7b2cf, 0xa9c8ff, 0xffbf9b, 0xa6e3d0, 0xe8c79c];
export const RUNTIME: Record<Runtime, number> = { claude: 0xf08c4a, codex: 0x6c63ff, agy: 0x18a7a7, other: 0x8a8aa3 };
export const TOOLS = { bash: 0xe07b39, edit: 0x8e6ccf, read: 0x3f9b5a, grep: 0x3b86c6, mcp: 0xffc145, web: 0xd2508f } as const;

/** The time of day: from the local clock, or night when the app is dark. */
export type Daylight = "dawn" | "day" | "dusk" | "night";
export function daylight(date: Date, dark: boolean): Daylight {
  if (dark) return "night";
  const h = date.getHours() + date.getMinutes() / 60;
  if (h >= 5.5 && h < 8) return "dawn";
  if (h >= 8 && h < 17.5) return "day";
  if (h >= 17.5 && h < 20) return "dusk";
  return "night";
}
/** The light over the town: a multiplied wash (and whether windows glow). */
export const WASH: Record<Daylight, { color: number; alpha: number; glow: boolean }> = {
  dawn: { color: 0xffc7b5, alpha: 0.28, glow: false },
  day: { color: 0xffffff, alpha: 0, glow: false },
  dusk: { color: 0xff9f62, alpha: 0.3, glow: true },
  night: { color: 0x1c2a5a, alpha: 0.62, glow: true },
};

const S = 2; // textures are drawn at twice their shown size

type G = Phaser.GameObjects.Graphics;

/** Small pieces seen up close inside a house are drawn at four times their size. */
const FINE = 4;
const fine = new Set<string>();

// MARK: The atlas
//
// Every piece of art is drawn once (antialiased, on a canvas) and then
// packed into a few shared pages, each one texture: so the whole town is
// drawn from a handful of textures and the renderer batches it into a few
// draw calls instead of switching texture for nearly every sprite. A
// piece's frame on its page is named by its key.

const PAGE = 2048, PAD = 2;
interface Page { key: string; tex: Phaser.Textures.DynamicTexture; x: number; y: number; row: number }
const pages: Page[] = [];
/** Key → the page it was packed on. */
const packed = new Map<string, string>();

/** Has this piece been made yet? */
export const made = (key: string) => packed.has(key);

function pack(scene: Phaser.Scene, key: string, tmp: string, w: number, h: number, frames?: [string, number, number, number, number][]) {
  let page = pages.find((p) => (p.x + w <= PAGE && p.y + Math.max(p.row, h) <= PAGE) || (p.y + p.row + PAD + h <= PAGE && w <= PAGE));
  if (!page || w > PAGE || h > PAGE) {
    if (w > PAGE || h > PAGE) throw new Error(`art ${key} is larger than an atlas page`);
    const pkey = `atlas-${pages.length}`;
    page = { key: pkey, tex: scene.textures.addDynamicTexture(pkey, PAGE, PAGE)!, x: 0, y: 0, row: 0 };
    pages.push(page);
  }
  if (page.x + w > PAGE) { page.x = 0; page.y += page.row + PAD; page.row = 0; }
  const { x, y } = page;
  page.tex.stamp(tmp, undefined, x, y, { originX: 0, originY: 0 });
  page.tex.render();
  page.tex.add(key, 0, x, y, w, h);
  for (const [name, fx, fy, fw, fh] of frames ?? []) page.tex.add(name, 0, x + fx, y + fy, fw, fh);
  page.x += w + PAD;
  page.row = Math.max(page.row, h);
  packed.set(key, page.key);
}

function make(scene: Phaser.Scene, key: string, w: number, h: number, draw: (g: G) => void, scale = S) {
  if (packed.has(key)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.scaleX = scale;
  g.scaleY = scale;
  draw(g);
  const W = Math.ceil(w * scale), H = Math.ceil(h * scale);
  g.generateTexture("__art", W, H);
  g.destroy();
  pack(scene, key, "__art", W, H);
  scene.textures.remove("__art");
  if (scale === FINE) fine.add(key);
}

/** An image of a piece of art, unscaled (the texture's own pixels). */
export function image(scene: Phaser.Scene, x: number, y: number, key: string): Phaser.GameObjects.Image {
  return scene.add.image(x, y, packed.get(key) ?? key, packed.has(key) ? key : undefined);
}

/** Show a texture at its intended size. */
export function sprite(scene: Phaser.Scene, x: number, y: number, key: string): Phaser.GameObjects.Image {
  return image(scene, x, y, key).setScale(1 / (fine.has(key) ? FINE : S));
}

/** Swap an image's art (same scale rules as when it was made). */
export function retexture(img: Phaser.GameObjects.Image, key: string): Phaser.GameObjects.Image {
  return img.setTexture(packed.get(key) ?? key, packed.has(key) ? key : undefined);
}

/** Which piece of art an image shows. */
export const artOf = (img: Phaser.GameObjects.Image) => (packed.has(img.frame.name) ? img.frame.name : img.texture.key);

/** The page and frame of a piece (particles, and anything else that takes both). */
export const where = (key: string): [string, string | undefined] => [packed.get(key) ?? key, packed.has(key) ? key : undefined];

/** The scale that shows a texture at its intended size (for scaling it further). */
export const unit = (key: string) => 1 / (fine.has(key) ? FINE : S);

type V = Phaser.Math.Vector2;
const pts = (list: [number, number][]) => list.map(([x, y]) => new Phaser.Math.Vector2(x, y)) as V[];

function roundRect(g: G, x: number, y: number, w: number, h: number, r: number, fill: number, stroke?: number, lw = 2) {
  g.fillStyle(fill, 1).fillRoundedRect(x, y, w, h, r);
  if (stroke !== undefined) g.lineStyle(lw, stroke, 1).strokeRoundedRect(x, y, w, h, r);
}

/** A workshop: a rounded building, a sawtooth roof, a row of terminal bays, a door. */
export function workshop(scene: Phaser.Scene, wall: number): string {
  const key = `workshop-${wall.toString(16)}`;
  make(scene, key, 200, 150, (g) => {
    g.fillStyle(0x000000, 0.12).fillRoundedRect(8, 22, 190, 126, 18);
    roundRect(g, 4, 18, 192, 124, 18, wall, INK, 3);
    // Sawtooth roof: the works' signature.
    const roof = Phaser.Display.Color.IntegerToColor(wall).darken(18).color;
    g.fillStyle(roof, 1);
    for (let i = 0; i < 6; i++) {
      const x = 14 + i * 29;
      g.fillTriangle(x, 22, x + 29, 22, x + 29, 4);
    }
    g.lineStyle(3, INK, 1);
    for (let i = 0; i < 6; i++) {
      const x = 14 + i * 29;
      g.beginPath().moveTo(x, 22).lineTo(x + 29, 4).lineTo(x + 29, 22).strokePath();
    }
    // A band where the bays sit.
    roundRect(g, 14, 36, 172, 58, 12, Phaser.Display.Color.IntegerToColor(wall).lighten(12).color, INK, 2);
    // The door, low and round-topped.
    roundRect(g, 86, 104, 28, 36, 12, PALETTE.woodDark, INK, 2);
    g.fillStyle(PALETTE.amber, 1).fillCircle(108, 124, 2.5);
    // A pipe stub on the roof and a little vent.
    roundRect(g, 160, 0, 14, 20, 5, PALETTE.stoneDark, INK, 2);
  });
  return key;
}

/** A terminal bay window, lit or dark, at its senator's place in the band. */
export function bay(scene: Phaser.Scene, lit: boolean): string {
  const key = lit ? "bay-lit" : "bay-dark";
  make(scene, key, 38, 46, (g) => {
    roundRect(g, 2, 2, 34, 42, 9, lit ? PALETTE.lit : PALETTE.unlit, INK, 2.5);
    if (lit) {
      g.fillStyle(0xffffff, 0.55).fillRoundedRect(6, 6, 10, 6, 3);
      // Lines on a screen.
      g.lineStyle(2, 0xd99e2b, 1);
      for (let i = 0; i < 3; i++) g.beginPath().moveTo(8, 30 + i * 4).lineTo(28 - i * 5, 30 + i * 4).strokePath();
    }
  });
  return key;
}

/** A little person: round head, rounded body in a colour; `pose` changes arms. */
export function person(scene: Phaser.Scene, shirt: number, opts: { hair?: number; pose?: "stand" | "wave" | "sit"; cane?: boolean; hat?: number } = {}): string {
  const hair = opts.hair ?? PALETTE.hair;
  const pose = opts.pose ?? "stand";
  const key = `person-${shirt.toString(16)}-${hair.toString(16)}-${pose}-${opts.cane ? 1 : 0}-${opts.hat ?? 0}`;
  make(scene, key, 28, 40, (g) => {
    g.fillStyle(0x000000, 0.15).fillEllipse(14, 37, 20, 5);
    // legs
    if (pose !== "sit") {
      roundRect(g, 8, 26, 5, 11, 2.5, INK);
      roundRect(g, 15, 26, 5, 11, 2.5, INK);
    }
    // body and arms
    const arm = Phaser.Display.Color.IntegerToColor(shirt).darken(12).color;
    roundRect(g, 3, pose === "wave" ? 8 : 15, 5, 12, 2.5, arm);
    roundRect(g, 20, 15, 5, 12, 2.5, arm);
    roundRect(g, 6, 14, 16, 16, 7, shirt, INK, 1.5);
    // head
    g.fillStyle(PALETTE.skin, 1).fillCircle(14, 9, 8);
    g.lineStyle(1.5, INK, 1).strokeCircle(14, 9, 8);
    g.fillStyle(hair, 1).slice(14, 9, 8, Math.PI * 1.05, Math.PI * 1.95, false).fillPath();
    g.fillStyle(INK, 1).fillCircle(11, 10, 1.1).fillCircle(17, 10, 1.1);
    g.fillStyle(0xf28b82, 0.6).fillCircle(9, 12, 1.5).fillCircle(19, 12, 1.5);
    if (opts.hat) roundRect(g, 7, -1, 14, 5, 2, opts.hat, INK, 1);
    if (opts.cane) g.lineStyle(2, PALETTE.woodDark, 1).beginPath().moveTo(25, 18).lineTo(26, 37).strokePath();
  });
  return key;
}

/** A tool worker's tool, held up: drawn small beside the worker. */
export function tool(scene: Phaser.Scene, kind: keyof typeof TOOLS): string {
  const key = `tool-${kind}`;
  make(scene, key, 18, 18, (g) => {
    switch (kind) {
      case "bash": // a hammer
        g.lineStyle(3, PALETTE.woodDark, 1).beginPath().moveTo(4, 16).lineTo(12, 6).strokePath();
        roundRect(g, 8, 1, 10, 7, 2, 0x8d93a3, INK, 1.5);
        break;
      case "edit": // a quill
        g.fillStyle(0xffffff, 1).fillEllipse(11, 7, 7, 13);
        g.lineStyle(1.5, INK, 1).strokeEllipse(11, 7, 7, 13).beginPath().moveTo(4, 17).lineTo(11, 7).strokePath();
        break;
      case "read": // a book
        roundRect(g, 2, 4, 14, 11, 2, 0xe1574e, INK, 1.5);
        g.lineStyle(1.5, 0xffffff, 1).beginPath().moveTo(9, 5).lineTo(9, 14).strokePath();
        break;
      case "grep": // a lens
        g.fillStyle(0xd8f0ff, 1).fillCircle(8, 8, 5.5);
        g.lineStyle(2, INK, 1).strokeCircle(8, 8, 5.5).beginPath().moveTo(12, 12).lineTo(16, 16).strokePath();
        break;
      case "mcp": // a parcel
        roundRect(g, 2, 3, 14, 12, 2, 0xd7a86e, INK, 1.5);
        g.lineStyle(1.5, INK, 1).beginPath().moveTo(9, 3).lineTo(9, 15).strokePath();
        break;
      case "web": // a little flag on a stick
        g.lineStyle(2, INK, 1).beginPath().moveTo(4, 17).lineTo(4, 1).strokePath();
        g.fillStyle(TOOLS.web, 1).fillTriangle(5, 1, 16, 4, 5, 8);
        break;
    }
  }, FINE);
  return key;
}

/** A capsule: a rounded pill in the sender's runtime colour with a white band. */
export function capsule(scene: Phaser.Scene, color: number): string {
  const key = `capsule-${color.toString(16)}`;
  make(scene, key, 26, 14, (g) => {
    roundRect(g, 1, 1, 24, 12, 6, color, INK, 1.5);
    g.fillStyle(0xffffff, 0.9).fillRect(11, 2, 4, 10);
    g.fillStyle(0xffffff, 0.5).fillRoundedRect(4, 3, 6, 3, 1.5);
  }, FINE);
  return key;
}

/** The sorting hall's roof: a round copper drum. Its wheel is separate (it turns). */
export function hall(scene: Phaser.Scene): string {
  make(scene, "hall", 260, 260, (g) => {
    g.fillStyle(0x000000, 0.14).fillCircle(134, 136, 120);
    g.fillStyle(PALETTE.copper, 1).fillCircle(130, 130, 118);
    g.lineStyle(4, INK, 1).strokeCircle(130, 130, 118);
    g.fillStyle(PALETTE.copperDark, 1).fillCircle(130, 130, 92);
    g.lineStyle(3, INK, 1).strokeCircle(130, 130, 92);
    // Rivets round the rim.
    g.fillStyle(PALETTE.cream, 1);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      g.fillCircle(130 + Math.cos(a) * 105, 130 + Math.sin(a) * 105, 2.5);
    }
  });
  make(scene, "wheel", 150, 150, (g) => {
    g.lineStyle(6, PALETTE.amber, 1).strokeCircle(75, 75, 62);
    g.lineStyle(3, INK, 1).strokeCircle(75, 75, 66).strokeCircle(75, 75, 58);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.lineStyle(5, PALETTE.amber, 1).beginPath().moveTo(75, 75).lineTo(75 + Math.cos(a) * 58, 75 + Math.sin(a) * 58).strokePath();
    }
    g.fillStyle(PALETTE.cream, 1).fillCircle(75, 75, 16);
    g.lineStyle(3, INK, 1).strokeCircle(75, 75, 16);
  });
  return "hall";
}

/** The archive: a cabinet of reels, one row per committee (drawn live on top). */
export function archive(scene: Phaser.Scene): string {
  make(scene, "archive", 200, 170, (g) => {
    g.fillStyle(0x000000, 0.12).fillRoundedRect(8, 12, 190, 156, 16);
    roundRect(g, 4, 8, 190, 154, 16, PALETTE.navy, INK, 3);
    roundRect(g, 16, 22, 166, 126, 10, PALETTE.navyDark, INK, 2);
    // A stamp on the roof edge.
    roundRect(g, 150, 0, 34, 16, 6, PALETTE.red, INK, 2);
  });
  return "archive";
}

/** The town hall: a cream building with an amber band, columns and a clock. */
export function townHall(scene: Phaser.Scene): string {
  make(scene, "townhall", 240, 160, (g) => {
    g.fillStyle(0x000000, 0.12).fillRoundedRect(10, 34, 228, 124, 14);
    g.fillStyle(0xe7b85e, 1).fillTriangle(6, 40, 120, 2, 234, 40);
    g.lineStyle(3, INK, 1).strokeTriangle(6, 40, 120, 2, 234, 40);
    roundRect(g, 10, 38, 220, 116, 12, PALETTE.cream, INK, 3);
    g.fillStyle(PALETTE.amber, 1).fillRect(12, 50, 216, 8);
    for (let i = 0; i < 5; i++) roundRect(g, 24 + i * 44, 64, 14, 82, 5, 0xffffff, INK, 2);
    g.fillStyle(0xffffff, 1).fillCircle(120, 24, 10);
    g.lineStyle(2, INK, 1).strokeCircle(120, 24, 10).beginPath().moveTo(120, 24).lineTo(120, 17).moveTo(120, 24).lineTo(125, 26).strokePath();
  });
  return "townhall";
}

/** A sheet of the docket. */
export function sheet(scene: Phaser.Scene): string {
  make(scene, "sheet", 30, 8, (g) => roundRect(g, 1, 1, 28, 6, 2, 0xffffff, INK, 1.5));
  return "sheet";
}

export function memoryHall(scene: Phaser.Scene): string {
  make(scene, "memory", 230, 150, (g) => {
    g.fillStyle(0x000000, 0.12).fillRoundedRect(10, 34, 216, 114, 14);
    g.fillStyle(0xbfa6dc, 1).fillRoundedRect(6, 6, 218, 44, { tl: 40, tr: 40, bl: 0, br: 0 });
    roundRect(g, 6, 30, 218, 116, 14, 0xefe6fb, INK, 3);
    for (let i = 0; i < 5; i++) {
      roundRect(g, 22 + i * 40, 56, 26, 52, 13, 0xffe9a8, INK, 2);
    }
    roundRect(g, 98, 112, 34, 34, 14, PALETTE.woodDark, INK, 2);
  });
  return "memory";
}

/** A signal post with two lamps; the live lamp is drawn on top by the scene. */
export function signal(scene: Phaser.Scene): string {
  make(scene, "signal", 16, 44, (g) => {
    g.lineStyle(3, INK, 1).beginPath().moveTo(8, 18).lineTo(8, 44).strokePath();
    roundRect(g, 1, 1, 14, 24, 6, INK);
    g.fillStyle(0x55525f, 1).fillCircle(8, 8, 4).fillCircle(8, 18, 4);
  });
  make(scene, "lamp-red", 10, 10, (g) => g.fillStyle(PALETTE.red, 1).fillCircle(5, 5, 4.5));
  make(scene, "lamp-green", 10, 10, (g) => g.fillStyle(PALETTE.green, 1).fillCircle(5, 5, 4.5));
  return "signal";
}

/** An approval gate: two posts and a striped barrier (rotated up to open). */
export function gate(scene: Phaser.Scene): string {
  make(scene, "gate-post", 10, 36, (g) => roundRect(g, 1, 1, 8, 34, 3, PALETTE.stoneDark, INK, 2));
  make(scene, "barrier", 70, 10, (g) => {
    roundRect(g, 1, 1, 68, 8, 4, 0xffffff, INK, 2);
    g.fillStyle(PALETTE.red, 1);
    for (let i = 0; i < 4; i++) g.fillRect(6 + i * 16, 2, 8, 6);
  });
  return "barrier";
}

/** A tree in its season: blossom, summer green, autumn colour, bare with snow. */
export function tree(scene: Phaser.Scene, season: "spring" | "summer" | "autumn" | "winter" = "summer"): string {
  const key = season === "summer" ? "tree" : `tree-${season}`;
  make(scene, key, 46, 56, (g) => {
    g.fillStyle(0x000000, 0.15).fillEllipse(24, 52, 34, 8);
    roundRect(g, 20, 30, 7, 22, 3, PALETTE.woodDark);
    if (season === "winter") {
      g.lineStyle(3, PALETTE.woodDark, 1);
      for (const [x, y] of [[12, 14], [34, 14], [23, 4], [16, 24], [31, 22]] as const) g.beginPath().moveTo(23.5, 34).lineTo(x, y).strokePath();
      g.fillStyle(0xffffff, 0.95).fillEllipse(13, 13, 9, 4).fillEllipse(34, 13, 9, 4).fillEllipse(23, 3.5, 9, 4);
      return;
    }
    const [dark, light] = season === "autumn" ? [0xd9822b, 0xf2a93b] : season === "spring" ? [0x8fcf78, 0xa6dc8c] : [PALETTE.leafDark, PALETTE.leaf];
    g.fillStyle(dark, 1).fillCircle(14, 26, 12).fillCircle(32, 26, 12).fillCircle(23, 15, 14);
    g.fillStyle(light, 1).fillCircle(14, 24, 10.5).fillCircle(32, 24, 10.5).fillCircle(23, 13, 12.5);
    if (season === "spring") { g.fillStyle(0xffc1d6, 1); for (const [x, y] of [[12, 20], [20, 9], [28, 14], [34, 24], [18, 28], [26, 24], [30, 7]] as const) g.fillCircle(x, y, 2.6); }
    if (season === "autumn") { g.fillStyle(0xc0392b, 0.8); for (const [x, y] of [[13, 22], [27, 10], [33, 27]] as const) g.fillCircle(x, y, 3); }
    g.fillStyle(0xffffff, 0.25).fillCircle(19, 9, 4);
  });
  return key;
}

/** A street lamp (its light is a glow switched on at dusk). */
export function lamp(scene: Phaser.Scene): string {
  make(scene, "lamp", 14, 46, (g) => {
    g.fillStyle(0x000000, 0.15).fillEllipse(7, 44, 10, 3);
    roundRect(g, 5.5, 10, 3, 34, 1.5, INK);
    roundRect(g, 1, 2, 12, 10, 4, PALETTE.lit, INK, 1.5);
  });
  return "lamp";
}

/** A windmill's sails, turned in the wind. */
export function sails(scene: Phaser.Scene): string {
  make(scene, "sails", 64, 64, (g) => {
    g.lineStyle(5, PALETTE.wood, 1);
    for (const a of [0.4, 2.0, 3.5, 5.1]) g.beginPath().moveTo(32, 32).lineTo(32 + Math.cos(a) * 30, 32 + Math.sin(a) * 30).strokePath();
    g.fillStyle(INK, 1).fillCircle(32, 32, 4);
  });
  return "sails";
}

/** A puff of chimney smoke; a raindrop; a cloud's shadow. */
export function weatherArt(scene: Phaser.Scene) {
  make(scene, "puff", 16, 16, (g) => g.fillStyle(0xffffff, 1).fillCircle(8, 8, 7));
  make(scene, "drop", 3, 12, (g) => g.fillStyle(0xbcd6f0, 0.9).fillRoundedRect(0.5, 0, 2, 12, 1));
  make(scene, "flake", 6, 6, (g) => g.fillStyle(0xffffff, 1).fillCircle(3, 3, 2.6));
  make(scene, "cloud", 200, 110, (g) => {
    // Soft-edged: rings of thin shade, thickest in the middle.
    for (let k = 0; k < 10; k++) {
      const f = 1 - k * 0.085;
      g.fillStyle(0x000000, 0.1).fillEllipse(70, 60, 120 * f, 70 * f).fillEllipse(130, 50, 120 * f, 80 * f).fillEllipse(100, 70, 160 * f, 60 * f);
    }
  });
}

export function bench(scene: Phaser.Scene): string {
  make(scene, "bench", 50, 22, (g) => {
    roundRect(g, 2, 4, 46, 7, 3, PALETTE.wood, INK, 1.5);
    roundRect(g, 6, 10, 5, 11, 2, PALETTE.woodDark);
    roundRect(g, 39, 10, 5, 11, 2, PALETTE.woodDark);
  });
  return "bench";
}

/** A small house for the districts beyond. */
export function cottage(scene: Phaser.Scene, wall: number): string {
  const key = `cottage-${wall.toString(16)}`;
  make(scene, key, 60, 54, (g) => {
    g.fillStyle(Phaser.Display.Color.IntegerToColor(wall).darken(25).color, 1).fillTriangle(2, 22, 30, 2, 58, 22);
    g.lineStyle(2, INK, 1).strokeTriangle(2, 22, 30, 2, 58, 22);
    roundRect(g, 7, 20, 46, 32, 5, wall, INK, 2);
    roundRect(g, 25, 34, 10, 18, 4, PALETTE.woodDark);
    roundRect(g, 12, 27, 9, 8, 2, PALETTE.lit, INK, 1);
    roundRect(g, 39, 27, 9, 8, 2, PALETTE.lit, INK, 1);
  });
  return key;
}

/** A little train for the rail line. */
export function train(scene: Phaser.Scene): string {
  make(scene, "train", 46, 90, (g) => {
    roundRect(g, 4, 2, 38, 40, 12, PALETTE.red, INK, 2.5);
    roundRect(g, 10, 8, 26, 12, 4, PALETTE.lit, INK, 1.5);
    roundRect(g, 4, 46, 38, 40, 8, PALETTE.navy, INK, 2.5);
    roundRect(g, 10, 52, 26, 10, 3, PALETTE.lit, INK, 1.5);
  });
  return "train";
}

/** Monuments by style: each project's quarter uses one. */
export const STYLES = ["obelisk", "clocktower", "lighthouse", "pagoda", "greenhouse", "block"] as const;
export type Style = (typeof STYLES)[number];

export function monument(scene: Phaser.Scene, style: Style, size: number): string {
  const h = Math.round(size);
  const key = `mon-${style}-${h}`;
  make(scene, key, 60, h + 16, (g) => {
    g.fillStyle(0x000000, 0.14).fillEllipse(30, h + 11, 44, 9);
    const base = h + 8;
    switch (style) {
      case "obelisk":
        g.fillStyle(PALETTE.stone, 1).fillPoints(pts([[20, base], [24, 10], [30, 2], [36, 10], [40, base]]), true);
        g.lineStyle(2, INK, 1).strokePoints(pts([[20, base], [24, 10], [30, 2], [36, 10], [40, base]]), true);
        break;
      case "clocktower":
        roundRect(g, 18, 14, 24, base - 14, 4, 0xe8c48a, INK, 2);
        g.fillStyle(0xb5503f, 1).fillTriangle(15, 16, 30, 1, 45, 16);
        g.lineStyle(2, INK, 1).strokeTriangle(15, 16, 30, 1, 45, 16);
        g.fillStyle(0xffffff, 1).fillCircle(30, 26, 6);
        g.lineStyle(1.5, INK, 1).strokeCircle(30, 26, 6);
        break;
      case "lighthouse":
        g.fillStyle(0xffffff, 1).fillPoints(pts([[21, base], [25, 14], [35, 14], [39, base]]), true);
        g.fillStyle(PALETTE.red, 1);
        for (let y = 22; y < base - 6; y += 16) g.fillRect(23, y, 14, 7);
        g.lineStyle(2, INK, 1).strokePoints(pts([[21, base], [25, 14], [35, 14], [39, base]]), true);
        roundRect(g, 24, 4, 12, 11, 3, PALETTE.lit, INK, 2);
        break;
      case "pagoda":
        for (let k = 0; k < Math.max(2, Math.round(h / 22)); k++) {
          const y = base - (k + 1) * 20, w = 40 - k * 6;
          roundRect(g, 30 - w / 2 + 4, y + 6, w - 8, 14, 3, 0xf4e3c3, INK, 1.5);
          g.fillStyle(0xc4493c, 1).fillTriangle(30 - w / 2 - 2, y + 8, 30, y - 2, 30 + w / 2 + 2, y + 8);
          g.lineStyle(1.5, INK, 1).strokeTriangle(30 - w / 2 - 2, y + 8, 30, y - 2, 30 + w / 2 + 2, y + 8);
        }
        break;
      case "greenhouse":
        roundRect(g, 10, 14, 40, base - 14, { tl: 18, tr: 18, bl: 3, br: 3 } as unknown as number, 0xd8f5e3, INK, 2);
        g.lineStyle(1.5, 0x6bbf8a, 1);
        for (let x = 18; x < 46; x += 8) g.beginPath().moveTo(x, 18).lineTo(x, base).strokePath();
        g.fillStyle(PALETTE.leaf, 1).fillCircle(24, base - 6, 5).fillCircle(36, base - 5, 6);
        break;
      case "block":
        roundRect(g, 16, 6, 28, base - 6, 1, 0xb9b6b0, INK, 2);
        g.fillStyle(0x8e8a83, 1);
        for (let y = 12; y < base - 6; y += 10) g.fillRect(20, y, 20, 4);
        break;
    }
    roundRect(g, 14, base - 2, 32, 7, 2, PALETTE.stoneDark, INK, 1.5);
  });
  return key;
}

/** The skyline of the parent Senate, beyond the river. */
export function skyline(scene: Phaser.Scene): string {
  make(scene, "skyline", 420, 120, (g) => {
    const blocks = [[0, 50, 50], [54, 20, 44], [102, 64, 56], [162, 8, 48], [214, 40, 60], [278, 26, 46], [328, 56, 50], [382, 30, 36]];
    for (const [x, y, w] of blocks) {
      roundRect(g, x!, y!, w!, 118 - y!, 6, 0xc8c3d9, INK, 2);
      for (let wy = y! + 10; wy < 108; wy += 14) for (let wx = x! + 7; wx < x! + w! - 8; wx += 12) g.fillStyle(PALETTE.lit, 0.9).fillRect(wx, wy, 5, 6);
    }
  });
  return "skyline";
}

export function townGate(scene: Phaser.Scene): string {
  make(scene, "towngate", 90, 110, (g) => {
    roundRect(g, 4, 20, 20, 88, 6, PALETTE.stone, INK, 2);
    roundRect(g, 66, 20, 20, 88, 6, PALETTE.stone, INK, 2);
    g.lineStyle(10, PALETTE.stone, 1).beginPath().arc(45, 34, 33, Math.PI, 0).strokePath();
    g.lineStyle(2, INK, 1).beginPath().arc(45, 34, 38, Math.PI, 0).strokePath().beginPath().arc(45, 34, 28, Math.PI, 0).strokePath();
    g.fillStyle(PALETTE.amber, 1).fillCircle(45, 4, 4);
  });
  return "towngate";
}

/** A soft round glow, added over lit windows and tubes at dusk and night. */
export function glow(scene: Phaser.Scene): string {
  if (!scene.textures.exists("glow")) {
    const c = scene.textures.createCanvas("glow", 64, 64)!;
    const ctx = c.getContext();
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,226,150,1)");
    grad.addColorStop(1, "rgba(255,226,150,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    c.refresh();
  }
  return "glow";
}

// MARK: Generated houses, plants and characters


/** Where a house's four terminal bays sit, from its centre, and how big. */
export function bayPlaces(spec: HouseSpec): { xs: number[]; y: number; scale: number } {
  const { w } = houseSize(spec);
  const inner = w - 56;
  const xs = [0, 1, 2, 3].map((i) => -inner / 2 + (i * inner) / 3);
  return { xs, y: spec.storeys === 2 ? 22 : -6, scale: w < 200 ? 0.88 : 1 };
}

/** A generated house: body, material, roof, topper, door, sign and window band. */
export function house(scene: Phaser.Scene, spec: HouseSpec): { key: string; w: number; h: number } {
  const { w, h } = houseSize(spec);
  const key = `house-${houseKey(spec)}`;
  const top = 54; // room above the body for roofs and toppers
  make(scene, key, w + 12, h + top + 10, (g) => {
    const wall = COLOURS[spec.wall]!, trim = COLOURS[spec.trim]!;
    const dark = Phaser.Display.Color.IntegerToColor(wall).darken(22).color;
    const x0 = 6, y0 = top, x1 = x0 + w, y1 = y0 + h;
    g.fillStyle(0x000000, 0.13).fillRoundedRect(x0 + 5, y0 + 6, w, h, 16);
    // Roof first, behind the body's top edge.
    const roof = Phaser.Display.Color.IntegerToColor(trim).darken(12).color;
    g.fillStyle(roof, 1).lineStyle(3, INK, 1);
    switch (spec.roof) {
      case "gable":
        g.fillTriangle(x0 - 4, y0 + 8, x0 + w / 2, y0 - 46, x1 + 4, y0 + 8).strokeTriangle(x0 - 4, y0 + 8, x0 + w / 2, y0 - 46, x1 + 4, y0 + 8);
        break;
      case "flat":
        g.fillRoundedRect(x0 - 4, y0 - 12, w + 8, 22, 6).strokeRoundedRect(x0 - 4, y0 - 12, w + 8, 22, 6);
        break;
      case "dome":
        g.fillEllipse(x0 + w / 2, y0 + 6, w * 0.7, 90).strokeEllipse(x0 + w / 2, y0 + 6, w * 0.7, 90);
        break;
      case "stepped":
        g.fillRoundedRect(x0 + 8, y0 - 18, w - 16, 28, 5).strokeRoundedRect(x0 + 8, y0 - 18, w - 16, 28, 5);
        g.fillRoundedRect(x0 + w * 0.3, y0 - 38, w * 0.4, 26, 5).strokeRoundedRect(x0 + w * 0.3, y0 - 38, w * 0.4, 26, 5);
        break;
      case "mansard":
        g.fillPoints(pts([[x0 - 4, y0 + 10], [x0 + 18, y0 - 26], [x1 - 18, y0 - 26], [x1 + 4, y0 + 10]]), true)
          .strokePoints(pts([[x0 - 4, y0 + 10], [x0 + 18, y0 - 26], [x1 - 18, y0 - 26], [x1 + 4, y0 + 10]]), true);
        for (const dx of [0.3, 0.7]) roundRect(g, x0 + w * dx - 9, y0 - 20, 18, 18, 5, PALETTE.lit, INK, 2);
        break;
      default: // sawtooth
        for (let i = 0; i < Math.floor((w - 20) / 29); i++) {
          const x = x0 + 10 + i * 29;
          g.fillTriangle(x, y0 + 6, x + 29, y0 + 6, x + 29, y0 - 14);
          g.beginPath().moveTo(x, y0 + 6).lineTo(x + 29, y0 - 14).lineTo(x + 29, y0 + 6).strokePath();
        }
    }
    // Topper on the roof.
    const tx = x0 + w * 0.78;
    switch (spec.topper) {
      case "chimney": roundRect(g, tx, y0 - 34, 16, 30, 3, 0xb5503f, INK, 2); break;
      case "antenna": g.lineStyle(3, INK, 1).beginPath().moveTo(tx, y0 - 6).lineTo(tx, y0 - 48).moveTo(tx - 10, y0 - 40).lineTo(tx + 10, y0 - 40).strokePath(); break;
      case "vent": roundRect(g, tx - 6, y0 - 26, 22, 22, 11, PALETTE.stoneDark, INK, 2); break;
      case "flag": g.lineStyle(3, INK, 1).beginPath().moveTo(tx, y0 - 4).lineTo(tx, y0 - 50).strokePath(); g.fillStyle(COLOURS[spec.signColour]!, 1).fillTriangle(tx + 1, y0 - 50, tx + 24, y0 - 43, tx + 1, y0 - 36); break;
      case "tank": roundRect(g, tx - 10, y0 - 40, 30, 24, 8, 0x9fb7c9, INK, 2); g.lineStyle(2, INK, 1).beginPath().moveTo(tx - 4, y0 - 16).lineTo(tx - 4, y0 - 2).moveTo(tx + 14, y0 - 16).lineTo(tx + 14, y0 - 2).strokePath(); break;
      case "clock": g.fillStyle(0xffffff, 1).fillCircle(x0 + w / 2, y0 - 6, 12); g.lineStyle(2, INK, 1).strokeCircle(x0 + w / 2, y0 - 6, 12).beginPath().moveTo(x0 + w / 2, y0 - 6).lineTo(x0 + w / 2, y0 - 14).moveTo(x0 + w / 2, y0 - 6).lineTo(x0 + w / 2 + 6, y0 - 3).strokePath(); break;
    }
    // The body and its material.
    roundRect(g, x0, y0, w, h, 16, wall, INK, 3);
    g.fillStyle(dark, 0.35);
    switch (spec.material) {
      case "brick":
        for (let y = y0 + 10; y < y1 - 14; y += 12) for (let x = x0 + 8 + ((y / 12) % 2) * 10; x < x1 - 14; x += 22) g.fillRect(x, y, 14, 4);
        break;
      case "timber":
        g.lineStyle(2, dark, 0.45);
        for (let x = x0 + 16; x < x1 - 8; x += 18) g.beginPath().moveTo(x, y0 + 6).lineTo(x, y1 - 10).strokePath();
        break;
      case "panel":
        g.lineStyle(2, dark, 0.4);
        for (let x = x0 + w / 4; x < x1 - 8; x += w / 4) g.beginPath().moveTo(x, y0 + 4).lineTo(x, y1 - 10).strokePath();
        g.beginPath().moveTo(x0 + 4, y0 + h / 2).lineTo(x1 - 4, y0 + h / 2).strokePath();
        break;
    }
    // The plinth in the trim colour.
    roundRect(g, x0 + 2, y1 - 14, w - 4, 12, 6, trim, INK, 2);
    // An upper floor: a row of small windows.
    if (spec.storeys === 2) {
      for (let i = 0; i < 4; i++) {
        const wx = x0 + 22 + (i * (w - 64)) / 3;
        const shape = spec.windows;
        if (shape === "round") { g.fillStyle(PALETTE.unlit, 1).fillCircle(wx + 10, y0 + 24, 10); g.lineStyle(2, INK, 1).strokeCircle(wx + 10, y0 + 24, 10); }
        else roundRect(g, wx, y0 + 12, 20, 24, shape === "arch" ? 10 : 3, PALETTE.unlit, INK, 2);
      }
    }
    // The band where the bays sit (they are drawn live on top).
    const by = y0 + (spec.storeys === 2 ? 50 : 22);
    roundRect(g, x0 + 10, by, w - 20, 58, 12, Phaser.Display.Color.IntegerToColor(wall).lighten(12).color, INK, 2);
    // The door and its sign above.
    const dc = COLOURS[spec.doorColour]!;
    const dw = spec.door === "double" ? 40 : 28, dx = x0 + w / 2 - dw / 2, dy = y1 - 50;
    roundRect(g, dx, dy, dw, 40, spec.door === "round" ? 13 : 4, Phaser.Display.Color.IntegerToColor(dc).darken(28).color, INK, 2);
    if (spec.door === "double") g.lineStyle(2, INK, 1).beginPath().moveTo(dx + dw / 2, dy + 2).lineTo(dx + dw / 2, dy + 40).strokePath();
    g.fillStyle(PALETTE.amber, 1).fillCircle(dx + dw - 7, dy + 22, 2.5);
    const sc = COLOURS[spec.signColour]!, sx = x0 + w / 2, sy = by - 2;
    g.fillStyle(sc, 1).lineStyle(2, INK, 1);
    switch (spec.sign) {
      case "round": g.fillCircle(sx, sy, 9).strokeCircle(sx, sy, 9); break;
      case "diamond": g.fillPoints(pts([[sx, sy - 11], [sx + 11, sy], [sx, sy + 11], [sx - 11, sy]]), true).strokePoints(pts([[sx, sy - 11], [sx + 11, sy], [sx, sy + 11], [sx - 11, sy]]), true); break;
      case "shield": g.fillPoints(pts([[sx - 9, sy - 9], [sx + 9, sy - 9], [sx + 9, sy + 2], [sx, sy + 11], [sx - 9, sy + 2]]), true).strokePoints(pts([[sx - 9, sy - 9], [sx + 9, sy - 9], [sx + 9, sy + 2], [sx, sy + 11], [sx - 9, sy + 2]]), true); break;
      default: g.fillRoundedRect(sx - 22, sy - 7, 44, 14, 4).strokeRoundedRect(sx - 22, sy - 7, 44, 14, 4);
    }
  });
  return { key, w, h };
}

/** Where a house's body centre sits in its texture (for placing the image). */
export const HOUSE_TOP = 54;

/** A landmark beside a house (a chair's choice): a small tower of its own. */
export function landmark(scene: Phaser.Scene, kind: string, colour: number): string {
  const key = `landmark-${kind}-${colour.toString(16)}`;
  make(scene, key, 60, 130, (g) => {
    g.fillStyle(0x000000, 0.14).fillEllipse(30, 124, 44, 9);
    switch (kind) {
      case "clocktower":
        roundRect(g, 16, 30, 28, 94, 4, colour, INK, 2);
        g.fillStyle(0xb5503f, 1).fillTriangle(12, 32, 30, 6, 48, 32); g.lineStyle(2, INK, 1).strokeTriangle(12, 32, 30, 6, 48, 32);
        g.fillStyle(0xffffff, 1).fillCircle(30, 48, 9); g.lineStyle(2, INK, 1).strokeCircle(30, 48, 9);
        break;
      case "windmill":
        g.fillStyle(colour, 1).fillPoints(pts([[18, 124], [24, 50], [36, 50], [42, 124]]), true); g.lineStyle(2, INK, 1).strokePoints(pts([[18, 124], [24, 50], [36, 50], [42, 124]]), true);
        break;
      case "observatory":
        roundRect(g, 12, 62, 36, 62, 4, colour, INK, 2);
        g.fillStyle(0xdfe6f2, 1).fillEllipse(30, 64, 40, 44); g.lineStyle(2, INK, 1).strokeEllipse(30, 64, 40, 44);
        g.lineStyle(4, INK, 1).beginPath().moveTo(30, 58).lineTo(44, 40).strokePath();
        break;
      case "watertower":
        g.lineStyle(3, INK, 1).beginPath().moveTo(18, 124).lineTo(22, 60).moveTo(42, 124).lineTo(38, 60).moveTo(20, 96).lineTo(40, 96).strokePath();
        roundRect(g, 10, 28, 40, 34, 12, colour, INK, 2.5);
        break;
      default: // obelisk
        g.fillStyle(colour, 1).fillPoints(pts([[20, 124], [24, 26], [30, 14], [36, 26], [40, 124]]), true);
        g.lineStyle(2, INK, 1).strokePoints(pts([[20, 124], [24, 26], [30, 14], [36, 26], [40, 124]]), true);
    }
  });
  return key;
}

/** A plant by species, its leaves a shade picked by the garden. */
export function plant(scene: Phaser.Scene, species: string, shade: number): string {
  const key = `plant-${species}-${shade}`;
  const leaf = [0x7cc46b, 0x8fd17a, 0x6fb85e, 0x9ccf6a][shade % 4]!, leafDark = Phaser.Display.Color.IntegerToColor(leaf).darken(14).color;
  make(scene, key, 46, 58, (g) => {
    g.fillStyle(0x000000, 0.14).fillEllipse(23, 54, 30, 7);
    switch (species) {
      case "cone":
        roundRect(g, 20, 40, 6, 14, 2, PALETTE.woodDark);
        g.fillStyle(leafDark, 1).fillTriangle(8, 44, 23, 4, 38, 44); g.fillStyle(leaf, 1).fillTriangle(11, 42, 23, 8, 35, 42);
        break;
      case "tall":
        roundRect(g, 20, 34, 6, 20, 2, PALETTE.woodDark);
        g.fillStyle(leafDark, 1).fillEllipse(23, 24, 22, 44); g.fillStyle(leaf, 1).fillEllipse(22, 22, 18, 40);
        break;
      case "bush":
        g.fillStyle(leafDark, 1).fillCircle(14, 44, 10).fillCircle(30, 44, 10).fillCircle(22, 38, 11);
        g.fillStyle(leaf, 1).fillCircle(14, 42, 8.5).fillCircle(30, 42, 8.5).fillCircle(22, 36, 9.5);
        break;
      case "flowers":
        g.fillStyle(leafDark, 1).fillEllipse(23, 48, 34, 14);
        for (const [x, y, c] of [[12, 46, 0xffb7c5], [20, 42, 0xfff2a8], [28, 46, 0xffffff], [34, 43, 0xd6bfe6], [17, 50, 0xffd57e]] as const) g.fillStyle(c, 1).fillCircle(x, y, 3.2);
        break;
      case "birch":
        roundRect(g, 20, 22, 6, 32, 2, 0xf0ece4, INK, 1);
        g.fillStyle(INK, 1).fillRect(21, 30, 3, 1.5).fillRect(22, 40, 3, 1.5);
        g.fillStyle(0xbfe39a, 1).fillCircle(16, 18, 10).fillCircle(30, 20, 9).fillCircle(23, 10, 9);
        break;
      case "blossom":
        roundRect(g, 20, 30, 6, 24, 2, PALETTE.woodDark);
        g.fillStyle(0xf7b2cf, 1).fillCircle(14, 24, 11).fillCircle(32, 24, 11).fillCircle(23, 13, 12);
        g.fillStyle(0xffffff, 0.6).fillCircle(18, 12, 3).fillCircle(30, 22, 2.5);
        break;
      default: // round
        roundRect(g, 20, 30, 7, 24, 3, PALETTE.woodDark);
        g.fillStyle(leafDark, 1).fillCircle(14, 26, 12).fillCircle(32, 26, 12).fillCircle(23, 15, 14);
        g.fillStyle(leaf, 1).fillCircle(14, 24, 10.5).fillCircle(32, 24, 10.5).fillCircle(23, 13, 12.5);
    }
  });
  return key;
}

/** A character: body shape, skin, hair, hat and accessory from its look; the shirt in its runtime's colour. */
export interface FigureOpts { pose?: "stand" | "wave" | "sit" | "work"; cane?: boolean; chair?: boolean; glyph?: string; hardhat?: boolean }

/** One frame of a figure: which way it faces and where its limbs are. */
export interface Frame {
  dir: "down" | "up" | "side";
  /** Legs: lift (down/up views) or stride (side view), -1..1, opposite for the two legs. */
  step: number;
  /** Body bob, px up. */
  bob: number;
  /** Eyes: -1 left, 0 ahead, 1 right. */
  eyes: number;
  /** Arms up (a stretch). */
  stretch: boolean;
  /** Seated (a bench). */
  sit: boolean;
}
const STILL: Frame = { dir: "down", step: 0, bob: 0, eyes: 0, stretch: false, sit: false };

/** A figure drawn from the generator's parts, at (cx, base): every look, every frame. */
function figure(g: G, look: Look, shirt: number, o: FigureOpts, f: Frame, cx: number, base: number) {
  const pose = o.pose ?? (f.sit ? "sit" : "stand");
  const skin = SKINS[look.skin]!, hair = HAIRS[look.hairColour]!;
  const side = f.dir === "side", back = f.dir === "up";
  const bw0 = look.body === "round" ? 20 : look.body === "slim" ? 13 : 15;
  const bw = side ? Math.round(bw0 * 0.72) : bw0;
  const tall = look.body === "tall" ? 4 : 0;
  g.fillStyle(0x000000, 0.15).fillEllipse(cx, base - 2, side ? 16 : 20, 5);
  const by = base - 30 - tall - f.bob + (pose === "sit" ? 5 : 0);
  const arm = Phaser.Display.Color.IntegerToColor(shirt).darken(12).color;
  const legH = 14 + tall;
  // Legs: lifted in turn seen from front or back; striding seen from the side.
  if (pose === "sit") {
    roundRect(g, cx - 6, by + 14, 5, 6, 2.5, INK); roundRect(g, cx + 1, by + 14, 5, 6, 2.5, INK);
  } else if (side) {
    const d = f.step * 5;
    roundRect(g, cx - 2.5 - d, base - 16 - tall - f.bob * 0.3, 5, legH, 2.5, INK);
    roundRect(g, cx - 2.5 + d, base - 16 - tall - f.bob * 0.3, 5, legH, 2.5, Phaser.Display.Color.IntegerToColor(INK).lighten(12).color);
  } else {
    const l = Math.max(0, f.step) * 3.5, r = Math.max(0, -f.step) * 3.5;
    roundRect(g, cx - 6, base - 16 - tall - l, 5, legH, 2.5, INK);
    roundRect(g, cx + 1, base - 16 - tall - r, 5, legH, 2.5, INK);
  }
  // Arms swing opposite the legs (or go up for a stretch, or wave, or work).
  const swing = f.step * 3;
  if (side) {
    if (!back) roundRect(g, cx - 2.5 + (f.stretch ? 0 : -swing), f.stretch ? by - 10 : by + 1, 5, 12, 2.5, arm);
  } else {
    const lUp = pose === "wave" || f.stretch, rUp = f.stretch;
    roundRect(g, cx - bw / 2 - 4, lUp ? by - 9 : by + 1 + swing * 0.9, 5, 12, 2.5, arm);
    roundRect(g, cx + bw / 2 - 1, rUp ? by - 9 : pose === "work" ? by - 4 : by + 1 - swing * 0.9, 5, 12, 2.5, arm);
  }
  roundRect(g, cx - bw / 2, by, bw, 17, side ? 6 : 7, shirt, INK, 1.5);
  if (!back && look.accessory === "scarf") roundRect(g, cx - bw / 2 + 1, by, bw - 2, 5, 2, 0xd2508f);
  if (!back && !side && look.accessory === "bowtie") g.fillStyle(0xd2508f, 1).fillTriangle(cx - 5, by + 1, cx, by + 4, cx - 5, by + 7).fillTriangle(cx + 5, by + 1, cx, by + 4, cx + 5, by + 7);
  // The runtime, readable whatever the costume: a small white mark on the shirt.
  if (o.glyph && !back) {
    g.lineStyle(1.5, 0xffffff, 1);
    const gx = cx + (side ? 1 : 0), gy = by + 10;
    if (o.glyph === "claude") for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 4; g.beginPath().moveTo(gx - Math.cos(a) * 3, gy - Math.sin(a) * 3).lineTo(gx + Math.cos(a) * 3, gy + Math.sin(a) * 3).strokePath(); }
    else if (o.glyph === "codex") g.strokeCircle(gx, gy, 3);
    else if (o.glyph === "agy") g.strokeTriangle(gx, gy - 3.5, gx + 3.5, gy + 2.5, gx - 3.5, gy + 2.5);
  }
  if (o.chair && !back) g.fillStyle(PALETTE.amber, 1).fillCircle(cx + bw / 2 - 4, by + 4, 3).lineStyle(1, INK, 1).strokeCircle(cx + bw / 2 - 4, by + 4, 3);
  const hy = by - 8;
  if (look.hair === "long" && !side) g.fillStyle(hair, 1).fillRoundedRect(cx - 9, hy - 6, 18, back ? 20 : 18, 7);
  if (look.hair === "long" && side) g.fillStyle(hair, 1).fillRoundedRect(cx - 9, hy - 6, 12, 18, 6);
  g.fillStyle(back && look.hair !== "bald" ? hair : skin, 1).fillCircle(cx, hy, 8);
  g.lineStyle(1.5, INK, 1).strokeCircle(cx, hy, 8);
  if (!back) {
    if (look.hair !== "bald") {
      if (side) g.fillStyle(hair, 1).slice(cx, hy, 8, Math.PI * 0.55, Math.PI * 1.9, false).fillPath();
      else g.fillStyle(hair, 1).slice(cx, hy, 8, Math.PI * 1.05, Math.PI * 1.95, false).fillPath();
    }
    if (look.hair === "curly") { g.fillStyle(hair, 1); for (const dx of side ? [-6, -2, 2] : [-6, -2, 2, 6]) g.fillCircle(cx + dx, hy - 6, 3.4); }
    const ex = f.eyes * 1.2;
    if (side) {
      g.fillStyle(INK, 1).fillCircle(cx + 4, hy + 1, 1.1);
      g.fillStyle(0xf28b82, 0.55).fillCircle(cx + 5, hy + 3, 1.5);
      if (look.accessory === "glasses") g.lineStyle(1.2, INK, 1).strokeCircle(cx + 4, hy + 1, 2.4);
    } else {
      g.fillStyle(INK, 1).fillCircle(cx - 3 + ex, hy + 1, 1.1).fillCircle(cx + 3 + ex, hy + 1, 1.1);
      g.fillStyle(0xf28b82, 0.55).fillCircle(cx - 5, hy + 3, 1.5).fillCircle(cx + 5, hy + 3, 1.5);
      if (look.accessory === "glasses") g.lineStyle(1.2, INK, 1).strokeCircle(cx - 3, hy + 1, 2.4).strokeCircle(cx + 3, hy + 1, 2.4);
    }
  } else if (look.hair === "curly") { g.fillStyle(hair, 1); for (const dx of [-6, -2, 2, 6]) g.fillCircle(cx + dx, hy - 6, 3.4); }
  if (look.hair === "bun") g.fillStyle(hair, 1).fillCircle(cx + (side ? -6 : 0), hy - 9 + (side ? 4 : 0), 4);
  if (look.accessory === "headphones" && !side) g.lineStyle(2, INK, 1).beginPath().arc(cx, hy, 9, Math.PI, 0).strokePath().fillStyle(0xd2508f, 1).fillCircle(cx - 9, hy + 1, 2.5).fillCircle(cx + 9, hy + 1, 2.5);
  if (look.accessory === "headphones" && side) g.lineStyle(2, INK, 1).beginPath().arc(cx, hy, 9, Math.PI, 0).strokePath().fillStyle(0xd2508f, 1).fillCircle(cx, hy + 1, 3);
  const hatColour = o.hardhat ? PALETTE.amber : COLOURS[look.hatColour]!;
  const hat = o.hardhat ? "hardhat" : look.hat;
  switch (hat) {
    case "cap": roundRect(g, cx - 8, hy - 9, 16, 6, 3, hatColour, INK, 1); if (!back) g.fillStyle(hatColour, 1).fillRect(cx, hy - 5, side ? 12 : 10, 2.5); break;
    case "beret": g.fillStyle(hatColour, 1).fillEllipse(cx - 1, hy - 7, 18, 7); break;
    case "top": roundRect(g, cx - 6, hy - 19, 12, 12, 2, INK); roundRect(g, cx - 9, hy - 8, 18, 3, 1.5, INK); break;
    case "beanie": g.fillStyle(hatColour, 1).slice(cx, hy - 2, 8.5, Math.PI, 0, false).fillPath(); g.fillCircle(cx, hy - 11, 2.5); break;
    case "hardhat": g.fillStyle(hatColour, 1).slice(cx, hy - 2, 9, Math.PI, 0, false).fillPath(); g.fillRect(cx - 11, hy - 3, 22, 2.5); break;
  }
  if (o.cane) {
    const kx = side ? cx + 7 : cx + bw / 2 + 4;
    g.lineStyle(2, PALETTE.woodDark, 1).beginPath().moveTo(kx, by + 4).lineTo(kx + 1 + f.step, base - 2).strokePath();
  }
}

export function character(scene: Phaser.Scene, look: Look, shirt: number, o: FigureOpts = {}): string {
  const pose = o.pose ?? "stand";
  const key = `char-${lookKey(look)}-${shirt.toString(16)}-${pose}-${o.cane ? 1 : 0}-${o.chair ? 1 : 0}-${o.glyph ?? ""}-${o.hardhat ? 1 : 0}`;
  make(scene, key, 30, 46, (g) => figure(g, look, shirt, o, { ...STILL, sit: pose === "sit" }, 15, 44), FINE);
  return key;
}

/** The frames of a walking, idling figure, in one sheet. */
export const WALK_FRAMES = 6;
export const IDLE = ["still", "breathe", "left", "right", "stretch"] as const;
export type SheetFrame = `walk-${"down" | "up" | "side"}-${number}` | `idle-${(typeof IDLE)[number]}` | "sit" | "side" | "up";
const SHEET_SCALE = 2;

/**
 * A figure's sheet: a walk cycle facing down, up and to the side (mirrored
 * for the other side), idle frames (breathing, looking round, a stretch),
 * seated, and standing side-on and from behind. Drawn from the same parts as
 * the character generator, so every look and card walks.
 */
export function walkSheet(scene: Phaser.Scene, look: Look, shirt: number, o: FigureOpts = {}): string {
  const key = `walk-${lookKey(look)}-${shirt.toString(16)}-${o.cane ? 1 : 0}-${o.glyph ?? ""}-${o.hardhat ? 1 : 0}`;
  if (packed.has(key)) return key;
  const frames: [SheetFrame, Frame][] = [];
  for (const dir of ["down", "up", "side"] as const) {
    for (let i = 0; i < WALK_FRAMES; i++) {
      const p = (i / WALK_FRAMES) * Math.PI * 2;
      frames.push([`walk-${dir}-${i}`, { ...STILL, dir, step: Math.sin(p), bob: Math.abs(Math.sin(p)) * 1.4 }]);
    }
  }
  frames.push(["idle-still", STILL], ["idle-breathe", { ...STILL, bob: 0.7 }], ["idle-left", { ...STILL, eyes: -1 }],
    ["idle-right", { ...STILL, eyes: 1 }], ["idle-stretch", { ...STILL, stretch: true, bob: 1 }],
    ["sit", { ...STILL, sit: true }], ["side", { ...STILL, dir: "side" }], ["up", { ...STILL, dir: "up" }]);
  const W = 30, H = 58, cols = 8, rows = Math.ceil(frames.length / cols);
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.scaleX = SHEET_SCALE;
  g.scaleY = SHEET_SCALE;
  frames.forEach(([, f], i) => {
    figure(g, look, shirt, { ...o, pose: undefined }, f, (i % cols) * W + 15, Math.floor(i / cols) * H + 56);
  });
  g.generateTexture("__art", W * cols * SHEET_SCALE, H * rows * SHEET_SCALE);
  g.destroy();
  // Packed whole into the atlas; each frame named `<sheet>|<frame>`.
  pack(scene, key, "__art", W * cols * SHEET_SCALE, H * rows * SHEET_SCALE,
    frames.map(([name], i) => [`${key}|${name}`, (i % cols) * W * SHEET_SCALE, Math.floor(i / cols) * H * SHEET_SCALE, W * SHEET_SCALE, H * SHEET_SCALE]));
  scene.textures.remove("__art");
  return key;
}
export const SHEET_UNIT = 1 / SHEET_SCALE;

/** The Speaker's house: the desk's home, near the centre — porch, columns, a flag. */
export function speakerHouse(scene: Phaser.Scene): string {
  make(scene, "speaker", 270, 210, (g) => {
    g.fillStyle(0x000000, 0.13).fillRoundedRect(14, 66, 250, 140, 14);
    g.fillStyle(0xe7b85e, 1).fillTriangle(4, 72, 135, 14, 266, 72);
    g.lineStyle(3, INK, 1).strokeTriangle(4, 72, 135, 14, 266, 72);
    g.lineStyle(3, INK, 1).beginPath().moveTo(135, 14).lineTo(135, -0.5).strokePath();
    roundRect(g, 10, 68, 250, 136, 14, 0xfff3dc, INK, 3);
    g.fillStyle(PALETTE.amber, 1).fillRect(12, 78, 246, 7);
    roundRect(g, 28, 96, 214, 58, 12, 0xfffaf0, INK, 2); // the desk's window band (secretaries drawn live)
    // The porch: steps and columns.
    roundRect(g, 60, 182, 150, 14, 4, PALETTE.stone, INK, 2);
    for (const x of [70, 108, 150, 188]) roundRect(g, x, 158, 12, 28, 4, 0xffffff, INK, 2);
    roundRect(g, 120, 160, 30, 26, 10, PALETTE.woodDark, INK, 2);
    g.fillStyle(PALETTE.amber, 1).fillCircle(135, 44, 9);
    g.lineStyle(2, INK, 1).strokeCircle(135, 44, 9);
  });
  make(scene, "speaker-flag", 30, 22, (g) => g.fillStyle(PALETTE.amber, 1).fillTriangle(1, 1, 29, 8, 1, 16).lineStyle(2, INK, 1).strokeTriangle(1, 1, 29, 8, 1, 16));
  return "speaker";
}

/** Planks for boarding up an archived house. */
export function boards(scene: Phaser.Scene): string {
  make(scene, "boards", 60, 40, (g) => {
    g.fillStyle(PALETTE.wood, 1).lineStyle(2, INK, 1);
    g.fillRoundedRect(2, 6, 56, 9, 2).strokeRoundedRect(2, 6, 56, 9, 2);
    g.fillRoundedRect(2, 24, 56, 9, 2).strokeRoundedRect(2, 24, 56, 9, 2);
  });
  return "boards";
}

// MARK: The interior

export function desk(scene: Phaser.Scene, wide: boolean): string {
  const key = wide ? "desk-wide" : "desk";
  const w = wide ? 150 : 110;
  make(scene, key, w, 60, (g) => {
    g.fillStyle(0x000000, 0.14).fillRoundedRect(6, 40, w - 6, 18, 8);
    roundRect(g, 2, 18, w - 4, 34, 8, PALETTE.wood, INK, 2.5);
    roundRect(g, 2, 14, w - 4, 14, 6, Phaser.Display.Color.IntegerToColor(PALETTE.wood).lighten(10).color, INK, 2);
    roundRect(g, 8, 44, 10, 14, 3, PALETTE.woodDark);
    roundRect(g, w - 18, 44, 10, 14, 3, PALETTE.woodDark);
  }, FINE);
  return key;
}

export function terminal(scene: Phaser.Scene, lit: boolean): string {
  const key = lit ? "term-lit" : "term-dark";
  make(scene, key, 54, 44, (g) => {
    roundRect(g, 2, 2, 50, 34, 6, INK);
    roundRect(g, 6, 6, 42, 26, 4, lit ? 0x2f3b5a : 0x23262f);
    if (lit) {
      g.lineStyle(2.5, 0x7ee0a0, 1);
      for (let i = 0; i < 4; i++) g.beginPath().moveTo(10, 11 + i * 5).lineTo(10 + [26, 18, 30, 12][i]!, 11 + i * 5).strokePath();
    }
    roundRect(g, 22, 36, 10, 6, 2, INK);
  }, FINE);
  return key;
}

export function deskItem(scene: Phaser.Scene, kind: string): string {
  const key = `item-${kind}`;
  make(scene, key, 26, 26, (g) => {
    switch (kind) {
      case "plant": roundRect(g, 7, 15, 12, 10, 3, 0xb5503f, INK, 1.5); g.fillStyle(PALETTE.leaf, 1).fillCircle(9, 11, 5).fillCircle(17, 11, 5).fillCircle(13, 6, 5); break;
      case "mug": roundRect(g, 6, 9, 13, 15, 3, 0xffffff, INK, 1.5); g.lineStyle(2, INK, 1).strokeCircle(21, 16, 3.5); break;
      case "lamp": g.lineStyle(2.5, INK, 1).beginPath().moveTo(8, 24).lineTo(12, 10).lineTo(20, 6).strokePath(); g.fillStyle(PALETTE.amber, 1).fillTriangle(15, 4, 24, 4, 20, 12); break;
      case "cat": g.fillStyle(0x8d7b6e, 1).fillEllipse(13, 19, 20, 11).fillCircle(20, 12, 5).fillTriangle(17, 9, 18, 4, 21, 8).fillTriangle(21, 8, 23, 4, 24, 9); break;
      case "books": for (const [x, c] of [[4, 0xe1574e], [10, 0x3b86c6], [16, 0xffc145]] as const) roundRect(g, x, 6, 6, 18, 1.5, c, INK, 1.2); break;
      case "radio": roundRect(g, 3, 10, 20, 14, 3, 0x9fd3ea, INK, 1.5); g.fillStyle(INK, 1).fillCircle(9, 17, 3); g.lineStyle(1.5, INK, 1).beginPath().moveTo(18, 10).lineTo(22, 3).strokePath(); break;
    }
  }, FINE);
  return key;
}

export function mailSlot(scene: Phaser.Scene): string {
  make(scene, "mailslot", 50, 16, (g) => roundRect(g, 2, 2, 46, 12, 5, 0xc9a24e, INK, 2), FINE);
  return "mailslot";
}

/** A palette colour by index (for the interior's walls). */
export const COLOURS_OF = (i: number) => COLOURS[i] ?? COLOURS[0];
