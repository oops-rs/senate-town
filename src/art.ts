// Original 16-bit top-down RPG pixel art, drawn entirely in code on integer
// pixel canvases (1 art pixel = 2×2 world pixels, NEAREST filtering). No
// third-party tilesets, sprites or packs are used.
import Phaser from "phaser";
import type { Runtime } from "./model.ts";
import { COLOURS, HAIRS, houseKey, houseSize, lookKey, SKINS, type HouseSpec, type Look } from "./gen.ts";
import { LOT_TILES, TILE, type Plan, type TileRect } from "./layout.ts";
import type { Season } from "./world.ts";

/** World pixels per 1 art pixel. */
export const PX = 2;

export const INK = 0x262130;
export const PALETTE = {
  grass: 0x6ca652, grassLight: 0x7cb55f, grassDark: 0x588f44, grassDeep: 0x457536,
  paving: 0xe3d8c2, pavingEdge: 0xb6a78d, road: 0xcabca1, roadDark: 0xa6977d, path: 0xd5b98b, pathDark: 0xb89868,
  glass: 0xdaf0ff, glassEdge: 0x6c9cbd, glassLit: 0xb4ecff,
  lit: 0xffe28a, litBright: 0xfff5c7, unlit: 0x4a5875,
  skin: 0xf3d2b3, hair: 0x5a4334,
  red: 0xd94e4e, green: 0x46b865, amber: 0xf0b43c, white: 0xffffff, cream: 0xf6ebd6,
  copper: 0x47948f, copperDark: 0x326e6b, navy: 0x465882, navyDark: 0x2f3d5e,
  water: 0x4b94bd, waterDeep: 0x37769e, waterLight: 0x73b9db, waterFoam: 0xd8f3fa,
  rail: 0x767c8a, wood: 0xb88454, woodLight: 0xd19f6e, woodDark: 0x7a5233,
  leaf: 0x5ca34b, leafLight: 0x7cc263, leafDark: 0x3e7835,
  stone: 0xcbc6ba, stoneLight: 0xe2ddd2, stoneDark: 0x8f8a7f,
  terracotta: 0xc45d41, terracottaDark: 0x99422c,
};

export const RUNTIME: Record<Runtime, number> = {
  claude: 0xe67e40,
  codex: 0x5e5ce6,
  agy: 0x1e9e9e,
  other: 0x7c7f99,
};
export const TOOLS = {
  bash: 0xd97336,
  edit: 0x8661c9,
  read: 0x3b9658,
  grep: 0x3882c2,
  mcp: 0xeeb238,
  web: 0xcf4a86,
} as const;

export type Daylight = "dawn" | "day" | "dusk" | "night";
export function daylight(date: Date, dark: boolean): Daylight {
  if (dark) return "night";
  const h = date.getHours() + date.getMinutes() / 60;
  if (h >= 5.5 && h < 8) return "dawn";
  if (h >= 8 && h < 17.5) return "day";
  if (h >= 17.5 && h < 20) return "dusk";
  return "night";
}
export const WASH: Record<Daylight, { color: number; alpha: number; glow: boolean }> = {
  dawn: { color: 0xffc8b0, alpha: 0.24, glow: false },
  day: { color: 0xffffff, alpha: 0, glow: false },
  dusk: { color: 0xff9b5c, alpha: 0.30, glow: true },
  night: { color: 0x1a2654, alpha: 0.58, glow: true },
};

// MARK: Integer pixel canvas helpers

function hexStr(c: number, a = 1): string {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  return a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
}

export function shade(c: number, delta: number): number {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((c >> 16) & 255) + delta);
  const g = clamp(((c >> 8) & 255) + delta);
  const b = clamp((c & 255) + delta);
  return (r << 16) | (g << 8) | b;
}

function mixHex(a: number, b: number, t: number): number {
  const ch = (c: number, s: number) => (c >> s) & 255;
  const lerp = (x: number, y: number) => Math.round(x + (y - x) * t);
  return (lerp(ch(a, 16), ch(b, 16)) << 16) | (lerp(ch(a, 8), ch(b, 8)) << 8) | lerp(ch(a, 0), ch(b, 0));
}

function hash2(x: number, y: number): number {
  let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

class Pix {
  readonly ctx: CanvasRenderingContext2D;
  readonly w: number;
  readonly h: number;

  constructor(canvas: HTMLCanvasElement) {
    this.w = canvas.width;
    this.h = canvas.height;
    this.ctx = canvas.getContext("2d")!;
    this.ctx.imageSmoothingEnabled = false;
  }

  p(x: number, y: number, c: number, a = 1) {
    this.ctx.fillStyle = hexStr(c, a);
    this.ctx.fillRect(Math.floor(x), Math.floor(y), 1, 1);
  }

  rect(x: number, y: number, w: number, h: number, c: number, a = 1) {
    if (w <= 0 || h <= 0) return;
    this.ctx.fillStyle = hexStr(c, a);
    this.ctx.fillRect(Math.floor(x), Math.floor(y), Math.floor(w), Math.floor(h));
  }

  hline(x: number, y: number, len: number, c: number, a = 1) { this.rect(x, y, len, 1, c, a); }
  vline(x: number, y: number, len: number, c: number, a = 1) { this.rect(x, y, 1, len, c, a); }

  box(x: number, y: number, w: number, h: number, fill: number, edge = INK) {
    this.rect(x, y, w, h, edge);
    if (w > 2 && h > 2) this.rect(x + 1, y + 1, w - 2, h - 2, fill);
  }

  /** Classic 16-bit RPG cut-corner box. */
  rbox(x: number, y: number, w: number, h: number, fill: number, edge = INK) {
    this.rect(x + 1, y, w - 2, h, edge);
    this.rect(x, y + 1, w, h - 2, edge);
    if (w > 2 && h > 2) this.rect(x + 1, y + 1, w - 2, h - 2, fill);
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, c: number, a = 1) {
    this.ctx.fillStyle = hexStr(c, a);
    const x0 = Math.floor(cx - rx), x1 = Math.ceil(cx + rx);
    const y0 = Math.floor(cy - ry), y1 = Math.ceil(cy + ry);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  circle(cx: number, cy: number, r: number, c: number, a = 1) { this.ellipse(cx, cy, r, r, c, a); }

  line(x0: number, y0: number, x1: number, y1: number, c: number, a = 1) {
    let ix0 = Math.round(x0), iy0 = Math.round(y0), ix1 = Math.round(x1), iy1 = Math.round(y1);
    const dx = Math.abs(ix1 - ix0), sx = ix0 < ix1 ? 1 : -1;
    const dy = -Math.abs(iy1 - iy0), sy = iy0 < iy1 ? 1 : -1;
    let err = dx + dy;
    this.ctx.fillStyle = hexStr(c, a);
    for (;;) {
      this.ctx.fillRect(ix0, iy0, 1, 1);
      if (ix0 === ix1 && iy0 === iy1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; ix0 += sx; }
      if (e2 <= dx) { err += dx; iy0 += sy; }
    }
  }
}

/** Create or return a crisp NEAREST-filtered 1× pixel-art texture. */
function makePx(scene: Phaser.Scene, key: string, w: number, h: number, draw: (g: Pix) => void): string {
  if (scene.textures.exists(key)) return key;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(new Pix(c));
  const tex = scene.textures.addCanvas(key, c);
  tex?.setFilter(Phaser.Textures.FilterMode.NEAREST);
  return key;
}

export function image(scene: Phaser.Scene, x: number, y: number, key: string): Phaser.GameObjects.Image {
  return scene.add.image(x, y, key);
}

/** Show a pixel-art texture at world scale (1 art px = PX world px). */
export function sprite(scene: Phaser.Scene, x: number, y: number, key: string): Phaser.GameObjects.Image {
  return scene.add.image(x, y, key).setScale(PX);
}

export function retexture(img: Phaser.GameObjects.Image, key: string): Phaser.GameObjects.Image {
  return img.setTexture(key);
}

export const artOf = (img: Phaser.GameObjects.Image) => img.texture.key;
export const where = (key: string): [string, string | undefined] => [key, undefined];
export const unit = () => PX;

// Harmonious cozy 16-bit village architectural palettes mapped from card colour indices.
const ROOF_PALETTE = [
  0xc45d41, // terracotta
  0x4f6d8a, // slate blue
  0x4f7d54, // moss green
  0xc9923e, // warm ochre
  0x7a5470, // plum slate
  0xb85866, // rose tile
  0x4a7885, // coastal teal
  0x9e6742, // cedar shingle
  0x577c72, // verdigris
  0xa8764b, // honey thatch
  0x6b645c, // charcoal stone
  0x5a6d91, // indigo slate
];

const WALL_PALETTE = [
  0xf2e4cc, // warm cream plaster
  0xe8eff2, // pale sky clapboard
  0xe9f0db, // sage plaster
  0xf7ebcb, // buttercream
  0xeee5f2, // soft lavender plaster
  0xf5e2e5, // blush stucco
  0xe4ecf7, // powder blue
  0xf2dfd0, // peach stucco
  0xe0f0ea, // mint plaster
  0xebd8be, // warm sandstone
  0xe2dad0, // limestone
  0xdde4ec, // mist grey
];

const roofColour = (i: number) => ROOF_PALETTE[i % ROOF_PALETTE.length]!;
const wallColour = (i: number) => WALL_PALETTE[i % WALL_PALETTE.length]!;

// MARK: Ground tilemap (16×16 art pixels per 32×32 world tile)

/**
 * Paint the entire village ground onto one crisp NEAREST pixel-art canvas:
 * seasonal meadow grass, wildflowers, cobblestone streets with curbs, Town
 * Square flagstones, gravel footpaths, river + grassy banks + stone arch
 * bridge, railway sleepers & rails, and house garden walks.
 */
export function paintGroundMap(scene: Phaser.Scene, p: Plan, season: Season): { key: string; x: number; y: number } {
  const key = "village-ground";
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const T = TILE / PX; // 16 art px per tile
  const cols = p.tiles.x1 - p.tiles.x0;
  const rows = p.tiles.y1 - p.tiles.y0;
  const W = cols * T, H = rows * T;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = new Pix(c);

  const toPx = (tx: number) => (tx - p.tiles.x0) * T;
  const toPy = (ty: number) => (ty - p.tiles.y0) * T;

  const inRects = (rects: TileRect[], tx: number, ty: number) =>
    rects.some((r) => tx >= r.tx && tx < r.tx + r.tw && ty >= r.ty && ty < r.ty + r.th);

  // Seasonal meadow palette.
  const meadow = season === "winter"
    ? { base: 0xe3ecf2, light: 0xf1f6fa, dark: 0xcbd8e3, tuft: 0xb7c7d6, flowers: [0xcfe0ed, 0xffffff] }
    : season === "autumn"
      ? { base: 0x8d9f4d, light: 0x9eb058, dark: 0x76883f, tuft: 0x627332, flowers: [0xd9843b, 0xe8b948, 0xc2553a] }
      : season === "spring"
        ? { base: 0x73b058, light: 0x85c267, dark: 0x5f9948, tuft: 0x4b8038, flowers: [0xffc6d9, 0xfff5c2, 0xffffff, 0xb8d9ff] }
        : { base: 0x6ba652, light: 0x7cb860, dark: 0x599143, tuft: 0x477a35, flowers: [0xfff2b2, 0xf28c8c, 0xa8d4f5, 0xffffff] };

  // 1. Lush organic meadow grass (no rigid tile-square grid: soft pixel tufts, clover & wildflowers).
  g.rect(0, 0, W, H, meadow.base);
  for (let ty = p.tiles.y0; ty < p.tiles.y1; ty++) {
    for (let tx = p.tiles.x0; tx < p.tiles.x1; tx++) {
      const px = toPx(tx), py = toPy(ty);
      const r = hash2(tx, ty);
      // Soft organic dapple patches crossing tile boundaries subtly.
      if (r < 0.32) {
        g.ellipse(px + 8, py + 8, 6 + Math.floor(r * 8), 5 + Math.floor(r * 6), meadow.light);
      } else if (r > 0.72) {
        g.ellipse(px + 8, py + 8, 6 + Math.floor((1 - r) * 8), 5, meadow.dark);
      }
      // Classic 16-bit pixel grass blade tufts.
      for (let k = 0; k < 4; k++) {
        const rx = Math.floor(hash2(tx * 7 + k, ty * 13) * 14) + 1;
        const ry = Math.floor(hash2(tx * 11, ty * 5 + k) * 14) + 1;
        g.p(px + rx, py + ry, meadow.tuft);
        g.p(px + rx + 1, py + ry - 1, meadow.light);
      }
      // Occasional tiny wildflowers & clover on meadow tiles.
      if (r > 0.84) {
        const fc = meadow.flowers[Math.floor(hash2(tx + 9, ty - 4) * meadow.flowers.length)]!;
        const fx = px + 3 + Math.floor(hash2(tx * 3, ty) * 10);
        const fy = py + 3 + Math.floor(hash2(tx, ty * 3) * 10);
        g.p(fx, fy + 1, meadow.tuft);
        g.p(fx, fy, fc);
        if (r > 0.91) g.p(fx + 3, fy + 2, meadow.flowers[(tx + ty) & 1]!);
      }
    }
  }

  // 2. Gravel / dirt footpaths (Elders' Garden promenade, Monument Park walks, country lanes).
  const drawPathTile = (tx: number, ty: number) => {
    const px = toPx(tx), py = toPy(ty);
    const cBase = season === "winter" ? 0xd0d4da : PALETTE.path;
    const cDark = season === "winter" ? 0xb5bcc6 : PALETTE.pathDark;
    const cLight = shade(cBase, 14);
    g.rect(px, py, T, T, cBase);
    // Rounded grass-edge corners where grass borders the footpath.
    if (!inRects(p.paths, tx, ty - 1) && !inRects(p.streets, tx, ty - 1)) {
      g.hline(px, py, T, meadow.dark);
      for (let x = 1; x < T; x += 3) g.p(px + x, py + 1, meadow.tuft);
    }
    if (!inRects(p.paths, tx, ty + 1) && !inRects(p.streets, tx, ty + 1)) g.hline(px, py + T - 1, T, cDark);
    if (!inRects(p.paths, tx - 1, ty) && !inRects(p.streets, tx - 1, ty)) g.vline(px, py, T, cDark);
    if (!inRects(p.paths, tx + 1, ty) && !inRects(p.streets, tx + 1, ty)) g.vline(px + T - 1, py, T, cDark);
    // Subtle pebbles.
    for (let k = 0; k < 5; k++) {
      const rx = 2 + Math.floor(hash2(tx * 17 + k, ty * 23) * (T - 4));
      const ry = 2 + Math.floor(hash2(tx * 29, ty * 19 + k) * (T - 4));
      g.p(px + rx, py + ry, k % 2 ? cDark : cLight);
    }
  };
  for (let ty = p.tiles.y0; ty < p.tiles.y1; ty++) {
    for (let tx = p.tiles.x0; tx < p.tiles.x1; tx++) {
      if (inRects(p.paths, tx, ty)) drawPathTile(tx, ty);
    }
  }

  // 3. Cobblestone streets with warm dressed curbs.
  const isPaved = (tx: number, ty: number) => inRects(p.streets, tx, ty) || inRects(p.plazas, tx, ty);
  for (let ty = p.tiles.y0; ty < p.tiles.y1; ty++) {
    for (let tx = p.tiles.x0; tx < p.tiles.x1; tx++) {
      if (!inRects(p.streets, tx, ty)) continue;
      const px = toPx(tx), py = toPy(ty);
      const stoneBase = season === "winter" ? 0xc8ccd4 : PALETTE.road;
      const mortar = season === "winter" ? 0x9aa0ad : PALETTE.roadDark;
      g.rect(px, py, T, T, mortar);
      // Staggered 16-bit cobblestones (4×4 and 5×4 blocks).
      for (let row = 0; row < 4; row++) {
        const off = (row % 2) * 2;
        for (let col = 0; col < 4; col++) {
          const sx = px + ((col * 4 + off) % T);
          const sy = py + row * 4;
          const sw = Math.min(3, px + T - sx);
          const delta = Math.floor((hash2(tx * 4 + col, ty * 4 + row) - 0.5) * 22);
          g.rect(sx, sy, sw, 3, shade(stoneBase, delta));
          if (delta > 3) g.p(sx, sy, shade(stoneBase, delta + 12));
        }
      }
      // Crisp stone curbs along grass borders.
      const curbLight = shade(stoneBase, 20), curbDark = shade(mortar, -22);
      if (!isPaved(tx, ty - 1)) { g.hline(px, py, T, curbDark); g.hline(px, py + 1, T, curbLight); }
      if (!isPaved(tx, ty + 1)) { g.hline(px, py + T - 1, T, curbDark); g.hline(px, py + T - 2, T, curbLight); }
      if (!isPaved(tx - 1, ty)) { g.vline(px, py, T, curbDark); g.vline(px + 1, py, T, curbLight); }
      if (!isPaved(tx + 1, ty)) { g.vline(px + T - 1, py, T, curbDark); g.vline(px + T - 2, py, T, curbLight); }
    }
  }

  // 4. Town Square flagstone plaza with inlaid ornamental stone border.
  for (const pl of p.plazas) {
    const px0 = toPx(pl.tx), py0 = toPy(pl.ty), pw = pl.tw * T, ph = pl.th * T;
    const base = season === "winter" ? 0xd9dde6 : PALETTE.paving;
    const edge = season === "winter" ? 0xaeb5c2 : PALETTE.pavingEdge;
    g.box(px0, py0, pw, ph, base, shade(edge, -24));
    // Large 8×8 dressed flagstones.
    for (let y = 2; y < ph - 2; y += 8) {
      for (let x = 2; x < pw - 2; x += 8) {
        const d = Math.floor((hash2(x, y) - 0.5) * 14);
        g.rect(px0 + x, py0 + y, 7, 7, shade(base, d));
        g.hline(px0 + x, py0 + y, 7, shade(base, d + 10));
      }
    }
    // Ornamental inner border ring around the square.
    g.box(px0 + 8, py0 + 8, pw - 16, ph - 16, base, edge);
    for (let y = 10; y < ph - 10; y += 8) {
      for (let x = 10; x < pw - 10; x += 8) {
        const d = Math.floor((hash2(x + 3, y + 7) - 0.5) * 12);
        g.rect(px0 + x, py0 + y, 7, 7, shade(base, d));
      }
    }
    // Four lush corner flowerbeds right inside the plaza corners.
    const beds = [
      [px0 + 12, py0 + 12], [px0 + pw - 28, py0 + 12],
      [px0 + 12, py0 + ph - 24], [px0 + pw - 28, py0 + ph - 24],
    ] as const;
    for (const [bx, by] of beds) {
      g.rbox(bx, by, 16, 12, meadow.dark, shade(edge, -20));
      g.rect(bx + 2, by + 2, 12, 8, meadow.base);
      const cols2 = [0xe86a78, 0xffd966, 0x8cc4f0, 0xffffff];
      for (let i = 0; i < 6; i++) g.p(bx + 3 + (i % 3) * 4, by + 3 + Math.floor(i / 3) * 4, cols2[i % cols2.length]!);
    }
  }

  // 5. Monument Park landscaped plaza & stone border.
  {
    const m = p.civic.monuments;
    const mx = toPx(m.tx), my = toPy(m.ty), mw = m.tw * T, mh = m.th * T;
    // Neat trimmed low hedge border around the park with openings on north, south & east.
    const hedge = season === "winter" ? 0xb5c9bc : PALETTE.leafDark;
    const hedgeHi = season === "winter" ? 0xdce8e0 : PALETTE.leaf;
    const drawHedge = (x: number, y: number, w: number, h: number) => {
      g.box(x, y, w, h, hedge, INK);
      g.hline(x + 1, y + 1, Math.max(0, w - 2), hedgeHi);
    };
    drawHedge(mx + 2, my + 2, mw * 0.36, 6);
    drawHedge(mx + mw * 0.62, my + 2, mw * 0.36, 6);
    drawHedge(mx + 2, my + mh - 8, mw * 0.36, 6);
    drawHedge(mx + mw * 0.62, my + mh - 8, mw * 0.36, 6);
    drawHedge(mx + 2, my + 8, 6, mh - 16);
  }

  // 6. Front garden walks & neat yard borders for each committee lot and civic building.
  const drawWalk = (cxWorld: number, yTopWorld: number, yBotWorld: number) => {
    const cx = Math.round((cxWorld / TILE - p.tiles.x0) * T);
    const y0 = Math.round((yTopWorld / TILE - p.tiles.y0) * T);
    const y1 = Math.round((yBotWorld / TILE - p.tiles.y0) * T);
    for (let y = y0; y <= y1; y += 3) {
      g.rbox(cx - 5, y, 10, 3, PALETTE.paving, PALETTE.roadDark);
    }
  };
  for (const s of p.slots.values()) {
    drawWalk(s.at.x, s.at.y + 42, s.door.y - 4);
    // Subtle wooden picket fence along the front curb of the yard (leaving the walk open).
    const fx0 = toPx(s.tx) + 4, fx1 = toPx(s.tx + LOT_TILES.tw) - 4;
    const fy = toPy(s.ty + LOT_TILES.th) - 4;
    const cx = Math.round((s.at.x / TILE - p.tiles.x0) * T);
    for (let x = fx0; x <= fx1; x += 4) {
      if (Math.abs(x - cx) < 10) continue;
      g.vline(x, fy, 4, PALETTE.cream);
      g.p(x, fy + 4, INK);
    }
    g.hline(fx0, fy + 2, Math.max(0, cx - 10 - fx0), PALETTE.pavingEdge);
    g.hline(cx + 10, fy + 2, Math.max(0, fx1 - (cx + 10)), PALETTE.pavingEdge);
  }
  for (const b of [p.civic.townHall, p.civic.postOffice, p.civic.archive, p.civic.memory]) {
    drawWalk(b.door.x, b.at.y + 46, b.door.y - 4);
  }

  // 7. North River with earthy banks, overhanging grass, water ripples, reeds & Stone Arch Bridge.
  {
    const r = p.river;
    const rx = toPx(r.tx), ry = toPy(r.ty), rw = r.tw * T, rh = r.th * T;
    // Upper bank earth + overhanging grass shadow.
    g.rect(rx, ry, rw, 5, PALETTE.woodDark);
    g.hline(rx, ry, rw, meadow.tuft);
    g.hline(rx, ry + 5, rw, PALETTE.waterDeep);
    // Water body.
    g.rect(rx, ry + 6, rw, rh - 10, PALETTE.water);
    g.rect(rx, ry + 6, rw, 5, PALETTE.waterDeep);
    // Lower bank lip.
    g.hline(rx, ry + rh - 4, rw, PALETTE.waterLight);
    g.rect(rx, ry + rh - 3, rw, 3, PALETTE.woodDark);
    g.hline(rx, ry + rh - 1, rw, meadow.tuft);
    // Shimmering pixel ripples & lily pads.
    for (let x = rx + 6; x < rx + rw - 8; x += 14) {
      const n = hash2(x, ry);
      const wy = ry + 11 + Math.floor(n * (rh - 20));
      g.hline(x, wy, 5 + Math.floor(n * 4), n > 0.65 ? PALETTE.waterFoam : PALETTE.waterLight);
      if (n < 0.14) {
        g.circle(x + 3, ry + rh - 8, 2.5, PALETTE.leafDark);
        g.p(x + 2, ry + rh - 9, PALETTE.leafLight);
      }
    }
    // Arched Stone Bridge across the river along Bridge Avenue!
    const br = p.bridge;
    const bx = toPx(br.tx), by = toPy(br.ty), bw = br.tw * T, bh = br.th * T;
    // Bridge shadow on water.
    g.rect(bx + bw, ry + 6, 4, rh - 10, PALETTE.waterDeep);
    // Stone deck.
    g.box(bx, by, bw, bh, PALETTE.paving, INK);
    for (let y = by + 3; y < by + bh - 3; y += 5) {
      g.hline(bx + 4, y, bw - 8, PALETTE.pavingEdge);
    }
    // Stone parapet walls on left & right of bridge + corner bollards.
    g.box(bx, by, 4, bh, PALETTE.stoneLight, INK);
    g.box(bx + bw - 4, by, 4, bh, PALETTE.stoneLight, INK);
    for (const py2 of [by, by + bh - 5, Math.floor(by + bh / 2) - 2]) {
      g.box(bx - 1, py2, 6, 5, PALETTE.stone, INK);
      g.box(bx + bw - 5, py2, 6, 5, PALETTE.stone, INK);
    }
  }

  // 8. East Railway (ballast, timber sleepers, dual steel rails, wooden station platform).
  {
    const rx = Math.round((p.civic.rail / TILE - p.tiles.x0) * T);
    g.rect(rx - 9, 0, 18, H, season === "winter" ? 0xc2c8d2 : 0x9e9586);
    for (let y = 2; y < H; y += 6) {
      g.rect(rx - 7, y, 14, 2, PALETTE.woodDark);
      g.hline(rx - 7, y, 14, PALETTE.wood);
    }
    g.vline(rx - 4, 0, H, PALETTE.rail);
    g.vline(rx - 3, 0, H, PALETTE.stoneLight);
    g.vline(rx + 3, 0, H, PALETTE.rail);
    g.vline(rx + 4, 0, H, PALETTE.stoneLight);
    // Wooden station platform beside the track.
    const sx = Math.round((p.civic.station.x / TILE - p.tiles.x0) * T) - 10;
    const sy = Math.round((p.civic.station.y / TILE - p.tiles.y0) * T) - 22;
    g.box(sx, sy, 16, 44, PALETTE.woodLight, INK);
    for (let y = sy + 4; y < sy + 42; y += 4) g.hline(sx + 1, y, 14, PALETTE.wood);
    g.vline(sx + 14, sy + 1, 42, PALETTE.amber); // yellow safety edge
  }

  const tex = scene.textures.addCanvas(key, c);
  tex?.setFilter(Phaser.Textures.FilterMode.NEAREST);
  return { key, x: p.tiles.x0 * TILE, y: p.tiles.y0 * TILE };
}

// MARK: Committee Houses — Cutaway Interior + Fade-Open Pitched Roof

/** Pixel-art dimensions (in art px, multiplied by PX=2 in world) for a house spec. */
export function housePx(spec: HouseSpec): { w: number; h: number; roofH: number } {
  const { w, h } = houseSize(spec);
  // Keep snug inside the 7×6 tile lot (224×192 world px → 112×96 art px).
  const aw = Math.min(102, Math.round(w / PX));
  const ah = Math.min(72, Math.round((h - 16) / PX));
  return { w: aw, h: ah, roofH: 22 };
}

/** Where the 4 senator desks sit inside a house (in world px relative to house center). */
export function deskPlaces(spec: HouseSpec): { x: number; y: number }[] {
  const { w, h } = housePx(spec);
  const hw = (w * PX) / 2, hh = (h * PX) / 2;
  const dx = Math.round(hw * 0.48);
  const yTop = Math.round(-hh * 0.34);
  const yBot = Math.round(hh * 0.24);
  return [
    { x: -dx, y: yTop },
    { x: dx, y: yTop },
    { x: -dx, y: yBot },
    { x: dx, y: yBot },
  ];
}

/** Front facade windows (in world px relative to house center) visible even when roof is closed. */
export function frontWindowPlaces(spec: HouseSpec): { x: number; y: number }[] {
  const { w, h } = housePx(spec);
  const hw = (w * PX) / 2, hh = (h * PX) / 2;
  const y = hh - 16;
  return [{ x: -hw * 0.56, y }, { x: hw * 0.56, y }];
}

/**
 * Layer 1 (always beneath roof): Smallville-style open-roof cutaway interior
 * of a committee house — crisp outer walls, floorboards, woven rug, north
 * bookshelves, mail slot, front wall facade & door!
 */
export function houseInterior(scene: Phaser.Scene, spec: HouseSpec): { key: string; w: number; h: number; roofH: number } {
  const { w, h, roofH } = housePx(spec);
  const key = `house-in-${houseKey(spec)}`;
  const pad = 4;
  makePx(scene, key, w + pad * 2, h + roofH + pad * 2, (g) => {
    const x0 = pad, y0 = pad + roofH;
    const wall = wallColour(spec.wall);
    const trim = roofColour(spec.trim);
    const wallDark = shade(wall, -26);
    const doorCol = shade(roofColour(spec.doorColour), -16);

    // Soft pixel drop shadow on the grass.
    g.rect(x0 + 3, y0 + 4, w, h, 0x000000, 0.22);

    // Outer cutaway wall shell.
    g.box(x0, y0, w, h, wallDark, INK);
    // Warm oak floorboards inside.
    const ix = x0 + 4, iy = y0 + 6, iw = w - 8, ih = h - 22;
    g.rect(ix, iy, iw, ih, PALETTE.woodLight);
    for (let y = iy + 3; y < iy + ih; y += 4) g.hline(ix, y, iw, PALETTE.wood);
    for (let y = iy; y < iy + ih; y += 4) {
      for (let x = ix + ((y % 8) ? 7 : 13); x < ix + iw - 2; x += 16) g.vline(x, y, 3, shade(PALETTE.wood, -14));
    }
    // Wall-top bevel (shows thick cutaway walls cleanly!).
    g.hline(x0 + 1, y0 + 1, w - 2, shade(wall, 12));
    g.rect(x0 + 4, y0 + 4, w - 8, 2, shade(wallDark, -18)); // inner north wall shadow

    // Woven center rug tinted to trim colour.
    const rw = Math.round(iw * 0.44), rh = Math.round(ih * 0.48);
    const rx = Math.round(ix + (iw - rw) / 2), ry = Math.round(iy + (ih - rh) / 2 + 2);
    g.box(rx, ry, rw, rh, shade(trim, 24), shade(trim, -22));
    g.rect(rx + 2, ry + 2, rw - 4, rh - 4, shade(trim, 42));

    // North-wall bookshelves / filing cabinets (classic Smallville furniture).
    for (const bx of [ix + 3, ix + iw - 17]) {
      g.box(bx, iy - 1, 14, 7, PALETTE.woodDark, INK);
      g.hline(bx + 2, iy + 1, 3, PALETTE.red);
      g.hline(bx + 6, iy + 1, 3, PALETTE.amber);
      g.hline(bx + 10, iy + 1, 2, PALETTE.copper);
      g.hline(bx + 2, iy + 3, 10, PALETTE.wood);
    }

    // Front exterior facade wall (bottom 16 art px — visible even when roof is closed!).
    const fy = y0 + h - 16;
    g.box(x0, fy, w, 16, wall, INK);
    // Wall material texture on front facade.
    if (spec.material === "brick") {
      const br = shade(wall, -28);
      for (let y = fy + 2; y < fy + 14; y += 3) {
        for (let x = x0 + 2 + ((y % 6) ? 3 : 0); x < x0 + w - 4; x += 6) g.hline(x, y, 4, br);
      }
    } else if (spec.material === "timber") {
      g.vline(x0 + 4, fy + 1, 14, PALETTE.woodDark);
      g.vline(x0 + w - 5, fy + 1, 14, PALETTE.woodDark);
      g.hline(x0 + 1, fy + 4, w - 2, PALETTE.woodDark);
    } else if (spec.material === "panel") {
      for (let y = fy + 3; y < fy + 14; y += 3) g.hline(x0 + 1, y, w - 2, wallDark);
    }
    // Stone plinth at base of wall.
    g.rect(x0 + 1, y0 + h - 3, w - 2, 2, PALETTE.stoneDark);

    // Front door & welcome mat + brass mail slot.
    const dw = spec.door === "double" ? 14 : 10;
    const dx = Math.round(x0 + (w - dw) / 2);
    g.box(dx, fy + 3, dw, 12, doorCol, INK);
    g.hline(dx + 1, fy + 4, dw - 2, shade(doorCol, 24));
    if (spec.door === "double") g.vline(dx + Math.floor(dw / 2), fy + 4, 10, INK);
    g.p(dx + dw - 3, fy + 9, PALETTE.amber); // brass doorknob
    // Mail slot beside door.
    g.box(dx + dw + 2, fy + 8, 5, 3, PALETTE.amber, INK);
    // Welcome mat inside door.
    g.rect(dx, fy - 3, dw, 3, PALETTE.woodDark);
  });
  return { key, w, h, roofH };
}

/**
 * Layer 2 (overlays interior, fades open on zoom/hover/click): authentic
 * 16-bit pitched/gabled/tiled RPG roof with shingles, eaves shadow, topper,
 * chimney, and non-text emblem badge!
 */
export function houseRoof(scene: Phaser.Scene, spec: HouseSpec, season: Season): { key: string; w: number; h: number; roofH: number } {
  const { w, h, roofH } = housePx(spec);
  const key = `house-roof-${houseKey(spec)}-${season === "winter" ? "w" : "n"}`;
  const pad = 4;
  makePx(scene, key, w + pad * 2, h + roofH + pad * 2, (g) => {
    const x0 = pad, y0 = pad + roofH;
    const roof = roofColour(spec.trim);
    const roofHi = shade(roof, 24);
    const roofMid = roof;
    const roofDk = shade(roof, -24);
    const roofH_cover = h - 14; // leaves the front exterior facade wall (bottom 15px) visible!
    const topY = y0 - 12;
    const botY = y0 + roofH_cover;

    // Eaves shadow cast onto front wall.
    g.rect(x0, botY, w, 2, 0x000000, 0.28);

    const drawShingles = (rx: number, ry: number, rw: number, rh: number) => {
      for (let y = ry + 2; y < ry + rh - 1; y += 3) {
        const off = ((y - ry) % 6 === 0) ? 0 : 2;
        g.hline(rx + 1, y, rw - 2, roofDk);
        for (let x = rx + 2 + off; x < rx + rw - 2; x += 4) {
          g.p(x, y - 1, roofHi);
        }
      }
    };

    switch (spec.roof) {
      case "gable": {
        // Classic pitched RPG shingle roof with central bright ridge beam & wood gable eaves.
        g.box(x0 - 2, topY + 6, w + 4, botY - (topY + 6), roofMid, INK);
        const ridgeY = topY + Math.round((botY - topY) * 0.36);
        g.rect(x0 - 1, topY + 7, w + 2, ridgeY - (topY + 7), shade(roofMid, -8));
        drawShingles(x0 - 2, topY + 6, w + 4, botY - (topY + 6));
        // Ridge beam cap.
        g.hline(x0 - 1, ridgeY, w + 2, INK);
        g.hline(x0 - 1, ridgeY + 1, w + 2, roofHi);
        g.hline(x0 - 1, ridgeY + 2, w + 2, roofDk);
        // Cute front gable dormer over the door!
        const cx = Math.round(x0 + w / 2);
        for (let dy = 0; dy < 10; dy++) {
          g.hline(cx - dy - 1, botY - 12 + dy, (dy + 1) * 2 + 1, INK);
          if (dy > 1) g.hline(cx - dy + 1, botY - 12 + dy, (dy - 1) * 2 + 1, wallColour(spec.wall));
        }
        g.box(cx - 3, botY - 6, 7, 5, PALETTE.unlit, INK);
        break;
      }
      case "dome": {
        g.rbox(x0 - 2, topY + 10, w + 4, botY - (topY + 10), roofDk, INK);
        drawShingles(x0 - 2, topY + 10, w + 4, botY - (topY + 10));
        const cx = Math.round(x0 + w / 2), cy = Math.round((topY + botY) / 2);
        g.ellipse(cx, cy + 2, w * 0.35, (botY - topY) * 0.36, 0x000000, 0.25);
        g.ellipse(cx, cy, w * 0.34, (botY - topY) * 0.35, INK);
        g.ellipse(cx, cy, w * 0.34 - 1, (botY - topY) * 0.35 - 1, roofMid);
        g.ellipse(cx - 3, cy - 3, w * 0.2, (botY - topY) * 0.2, roofHi);
        // Brass dome cupola finial.
        g.box(cx - 3, cy - 4, 6, 5, PALETTE.amber, INK);
        g.p(cx, cy - 5, PALETTE.litBright);
        break;
      }
      case "mansard": {
        g.box(x0 - 2, topY + 6, w + 4, botY - (topY + 6), roofMid, INK);
        drawShingles(x0 - 2, topY + 6, w + 4, botY - (topY + 6));
        // Flat crowned upper deck + two dormer windows.
        g.box(x0 + 8, topY + 11, w - 16, botY - topY - 22, shade(roofMid, 16), INK);
        for (const dx of [0.28, 0.72]) {
          const wx = Math.round(x0 + w * dx) - 4;
          g.box(wx, botY - 9, 8, 7, PALETTE.lit, INK);
          g.vline(wx + 4, botY - 8, 5, INK);
        }
        break;
      }
      case "stepped": {
        g.box(x0 - 2, topY + 8, w + 4, botY - (topY + 8), roofMid, INK);
        drawShingles(x0 - 2, topY + 8, w + 4, botY - (topY + 8));
        g.box(x0 + 8, topY + 2, w - 16, 10, roofHi, INK);
        g.box(x0 + 18, topY - 2, w - 36, 6, shade(roofHi, 14), INK);
        break;
      }
      case "flat": {
        g.box(x0 - 1, topY + 10, w + 2, botY - (topY + 10), shade(roofMid, 14), INK);
        g.box(x0 + 3, topY + 14, w - 6, botY - topY - 18, shade(roofMid, -8), roofDk);
        // Skylights on flat workshop roof.
        for (let i = 0; i < 3; i++) {
          const sx = x0 + 8 + i * Math.floor((w - 24) / 2);
          g.box(sx, topY + 19, 12, 8, PALETTE.glass, INK);
          g.hline(sx + 2, topY + 21, 5, PALETTE.white);
        }
        break;
      }
      default: { // sawtooth workshop roof (classic cozy pixel workshops)
        g.box(x0 - 2, topY + 7, w + 4, botY - (topY + 7), roofMid, INK);
        const cols = Math.max(3, Math.floor(w / 18));
        const cw = Math.floor(w / cols);
        for (let i = 0; i < cols; i++) {
          const sx = x0 + i * cw;
          g.rect(sx, topY + 8, cw - 1, botY - (topY + 9), i % 2 ? roofMid : shade(roofMid, 10));
          g.vline(sx + cw - 1, topY + 8, botY - (topY + 9), INK);
          g.vline(sx + cw - 2, topY + 9, botY - (topY + 11), PALETTE.glass); // north-light glass strip
        }
        drawShingles(x0 - 2, topY + 8, w + 4, botY - (topY + 8));
      }
    }

    // Brick chimney on left-upper roof (matches smoke origin!).
    const chx = x0 + Math.round(w * 0.22);
    g.box(chx, topY + 1, 7, 11, PALETTE.terracotta, INK);
    g.hline(chx + 1, topY + 2, 5, PALETTE.stoneDark);
    g.hline(chx - 1, topY, 9, INK);

    // Optional roof topper from card/spec on right side.
    const tx = x0 + Math.round(w * 0.76);
    switch (spec.topper) {
      case "chimney": g.box(tx, topY + 2, 7, 10, PALETTE.terracottaDark, INK); break;
      case "antenna":
        g.vline(tx + 2, topY - 7, 13, INK);
        g.hline(tx - 2, topY - 4, 9, INK);
        g.p(tx + 2, topY - 8, PALETTE.red);
        break;
      case "vent": g.rbox(tx - 2, topY + 4, 9, 8, PALETTE.stone, INK); g.hline(tx, topY + 7, 5, INK); break;
      case "flag":
        g.vline(tx + 1, topY - 8, 15, INK);
        g.rect(tx + 2, topY - 7, 8, 5, roofColour(spec.signColour));
        break;
      case "tank":
        g.rbox(tx - 3, topY - 2, 11, 8, PALETTE.stoneLight, INK);
        g.vline(tx - 1, topY + 6, 4, INK); g.vline(tx + 5, topY + 6, 4, INK);
        break;
      case "clock": {
        const cx = Math.round(x0 + w / 2);
        g.circle(cx, topY + 12, 5, INK);
        g.circle(cx, topY + 12, 4, PALETTE.white);
        g.vline(cx, topY + 9, 3, INK); g.hline(cx, topY + 12, 3, INK);
        break;
      }
    }

    // Non-text emblem plaque above eaves (color & shape only, zero text).
    const ex = Math.round(x0 + w / 2), ey = botY - 2;
    const sc = COLOURS[spec.signColour] ?? PALETTE.amber;
    if (spec.sign === "round") { g.circle(ex, ey, 4, INK); g.circle(ex, ey, 3, sc); }
    else if (spec.sign === "diamond") { g.box(ex - 3, ey - 3, 7, 7, sc, INK); }
    else if (spec.sign === "shield") { g.rbox(ex - 4, ey - 3, 9, 7, sc, INK); }
    else { g.box(ex - 7, ey - 3, 15, 6, sc, INK); }

    // Winter snow drift along roof top & eaves.
    if (season === "winter") {
      g.rect(x0 - 1, topY + 7, w + 2, 4, 0xf2f7fb);
      g.hline(x0 - 1, botY - 2, w + 2, 0xe8f1f8);
    }
  });
  return { key, w, h, roofH };
}

/** Cozy lit or dark exterior front window (placed on the lower front facade). */
export function frontWindow(scene: Phaser.Scene, lit: boolean): string {
  const key = lit ? "win-lit" : "win-dark";
  makePx(scene, key, 10, 9, (g) => {
    g.box(0, 0, 10, 9, lit ? PALETTE.lit : PALETTE.unlit, INK);
    if (lit) {
      g.rect(2, 2, 3, 2, PALETTE.litBright);
      g.hline(2, 6, 6, PALETTE.amber);
    } else {
      g.hline(2, 2, 2, 0x6b7ea0);
    }
    g.vline(5, 1, 7, INK);
    g.hline(1, 5, 8, INK);
    g.hline(0, 8, 10, PALETTE.stoneLight); // window sill
  });
  return key;
}

// MARK: Civic Buildings (Cutaway Interior + Fade-Open Pitched Roof)

/** Town Hall (Speaker's House) — interior + grand gabled roof with clock & flag. */
export function townHallArt(scene: Phaser.Scene, season: Season): { interior: string; roof: string; flag: string } {
  const W = 104, H = 82;
  const interior = makePx(scene, "civic-townhall-in", W, H, (g) => {
    g.rect(5, 22, W - 8, H - 24, 0x000000, 0.22);
    // Cutaway stone walls & red-carpeted Speaker's chamber.
    g.box(2, 18, W - 4, H - 20, PALETTE.stoneDark, INK);
    g.rect(6, 23, W - 12, H - 41, PALETTE.woodLight);
    for (let y = 26; y < H - 18; y += 4) g.hline(6, y, W - 12, PALETTE.wood);
    // Royal amber-red runner carpet down the center.
    g.box(36, 25, 32, 35, 0xa83e42, 0x7a2a2e);
    g.rect(39, 28, 26, 29, 0xc24e52);
    // Grand wooden Speaker desk inside.
    g.box(34, 30, 36, 10, PALETTE.woodDark, INK);
    g.rect(36, 31, 32, 4, PALETTE.wood);
    // Front cream stone colonnade facade.
    const fy = H - 18;
    g.box(2, fy, W - 4, 16, PALETTE.cream, INK);
    g.hline(3, fy + 1, W - 6, PALETTE.amber);
    for (const cx of [12, 26, 74, 88]) g.box(cx, fy + 2, 6, 13, PALETTE.white, INK);
    // Grand double oak door + stone steps.
    g.box(44, fy + 3, 16, 13, PALETTE.woodDark, INK);
    g.vline(52, fy + 4, 11, INK);
    g.box(38, H - 4, 28, 4, PALETTE.stoneLight, INK);
  });
  const roof = makePx(scene, `civic-townhall-roof-${season === "winter" ? "w" : "n"}`, W, H, (g) => {
    const col = 0xc98c36, hi = shade(col, 24), dk = shade(col, -24);
    g.rect(2, H - 19, W - 4, 2, 0x000000, 0.28);
    g.box(0, 14, W, H - 32, col, INK);
    for (let y = 17; y < H - 19; y += 3) {
      g.hline(1, y, W - 2, dk);
      for (let x = 2 + (y % 4); x < W - 2; x += 5) g.p(x, y - 1, hi);
    }
    // Central triangular pediment & town clock!
    const cx = Math.floor(W / 2);
    for (let i = 0; i < 16; i++) {
      g.hline(cx - i * 2, 4 + i, i * 4 + 1, INK);
      if (i > 1) g.hline(cx - i * 2 + 2, 4 + i, i * 4 - 3, PALETTE.cream);
    }
    g.hline(cx - 32, 20, 65, INK);
    g.circle(cx, 14, 5, INK);
    g.circle(cx, 14, 4, PALETTE.white);
    g.vline(cx, 11, 3, INK); g.hline(cx, 14, 3, INK);
    // Flagpole on peak.
    g.vline(cx, 0, 5, INK);
    if (season === "winter") g.rect(1, 15, W - 2, 3, 0xf2f7fb);
  });
  const flag = makePx(scene, "civic-flag", 12, 8, (g) => {
    g.box(0, 0, 11, 7, PALETTE.amber, INK);
    g.hline(1, 1, 9, PALETTE.litBright);
  });
  return { interior, roof, flag };
}

/** Post Office (Sorting Hall) — warm brick & copper cupola, brass wheel inside! */
export function postOfficeArt(scene: Phaser.Scene, season: Season): { interior: string; roof: string; wheel: string } {
  const W = 104, H = 82;
  const interior = makePx(scene, "civic-post-in", W, H, (g) => {
    g.rect(5, 22, W - 8, H - 24, 0x000000, 0.22);
    g.box(2, 18, W - 4, H - 20, PALETTE.terracottaDark, INK);
    // Checkered post-office tile floor.
    for (let y = 23; y < H - 18; y += 6) {
      for (let x = 6; x < W - 6; x += 6) {
        g.rect(x, y, 6, 6, ((x + y) / 6) % 2 === 0 ? PALETTE.cream : PALETTE.pavingEdge);
      }
    }
    // Mail pigeonhole cubbies along north wall.
    g.box(10, 22, 84, 8, PALETTE.woodDark, INK);
    for (let x = 13; x < 90; x += 8) g.rect(x, 24, 5, 4, x % 16 === 5 ? PALETTE.white : PALETTE.wood);
    // Front brick facade with arched windows & double post doors.
    const fy = H - 18;
    g.box(2, fy, W - 4, 16, 0xbe6349, INK);
    for (let y = fy + 2; y < fy + 14; y += 3) {
      for (let x = 4 + (y % 6); x < W - 6; x += 7) g.hline(x, y, 4, 0x994a34);
    }
    g.box(14, fy + 4, 14, 8, PALETTE.lit, INK); g.vline(21, fy + 5, 6, INK);
    g.box(W - 28, fy + 4, 14, 8, PALETTE.lit, INK); g.vline(W - 21, fy + 5, 6, INK);
    g.box(44, fy + 3, 16, 13, PALETTE.copperDark, INK);
    g.vline(52, fy + 4, 11, INK);
    // Brass envelope emblem over door.
    g.box(47, fy - 1, 10, 6, PALETTE.amber, INK);
    g.line(48, fy, 52, fy + 3, INK); g.line(56, fy, 52, fy + 3, INK);
  });
  const roof = makePx(scene, `civic-post-roof-${season === "winter" ? "w" : "n"}`, W, H, (g) => {
    const col = PALETTE.copper, hi = shade(col, 24), dk = PALETTE.copperDark;
    g.rect(2, H - 19, W - 4, 2, 0x000000, 0.28);
    g.box(0, 14, W, H - 32, col, INK);
    for (let y = 17; y < H - 19; y += 3) {
      g.hline(1, y, W - 2, dk);
      for (let x = 3; x < W - 3; x += 6) g.p(x, y - 1, hi);
    }
    // Copper bell cupola centered on roof.
    const cx = Math.floor(W / 2);
    g.box(cx - 10, 6, 20, 18, PALETTE.cream, INK);
    g.box(cx - 12, 2, 24, 6, dk, INK);
    g.circle(cx, 15, 4, PALETTE.amber);
    if (season === "winter") g.rect(1, 15, W - 2, 3, 0xf2f7fb);
  });
  const wheel = makePx(scene, "civic-wheel", 26, 26, (g) => {
    const c = 13;
    g.circle(c, c, 11, INK);
    g.circle(c, c, 10, PALETTE.amber);
    g.circle(c, c, 7, PALETTE.copperDark);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.line(c, c, c + Math.cos(a) * 9, c + Math.sin(a) * 9, PALETTE.amber);
    }
    g.circle(c, c, 3, PALETTE.cream);
    g.p(c, c, INK);
  });
  return { interior, roof, wheel };
}

/** Archive Library — sandstone & navy slate roof, interior ledger shelf space. */
export function archiveArt(scene: Phaser.Scene, season: Season): { interior: string; roof: string } {
  const W = 104, H = 82;
  const interior = makePx(scene, "civic-archive-in", W, H, (g) => {
    g.rect(5, 22, W - 8, H - 24, 0x000000, 0.22);
    g.box(2, 18, W - 4, H - 20, PALETTE.navyDark, INK);
    g.rect(6, 23, W - 12, H - 41, 0x2a3552); // dark blue ledger archive floor/cabinet bay
    g.box(10, 24, W - 20, H - 45, 0x202940, PALETTE.navy);
    // Front sandstone library facade with arched windows.
    const fy = H - 18;
    g.box(2, fy, W - 4, 16, PALETTE.stoneLight, INK);
    for (const wx of [12, 28, 66, 82]) {
      g.rbox(wx, fy + 3, 10, 10, PALETTE.lit, INK);
      g.vline(wx + 5, fy + 4, 8, INK);
    }
    g.box(45, fy + 3, 14, 13, PALETTE.navyDark, INK);
    g.vline(52, fy + 4, 11, INK);
  });
  const roof = makePx(scene, `civic-archive-roof-${season === "winter" ? "w" : "n"}`, W, H, (g) => {
    const col = PALETTE.navy, hi = shade(col, 24), dk = PALETTE.navyDark;
    g.rect(2, H - 19, W - 4, 2, 0x000000, 0.28);
    g.box(0, 14, W, H - 32, col, INK);
    for (let y = 17; y < H - 19; y += 3) {
      g.hline(1, y, W - 2, dk);
      for (let x = 2 + (y % 5); x < W - 2; x += 5) g.p(x, y - 1, hi);
    }
    // Red wax stamp finial on ridge.
    g.box(W - 22, 10, 14, 7, PALETTE.red, INK);
    if (season === "winter") g.rect(1, 15, W - 2, 3, 0xf2f7fb);
  });
  return { interior, roof };
}

/** Memory Hall (History) — serene lavender-stone pavilion & archive alcoves. */
export function memoryHallArt(scene: Phaser.Scene, season: Season): { interior: string; roof: string } {
  const W = 104, H = 82;
  const interior = makePx(scene, "civic-memory-in", W, H, (g) => {
    g.rect(5, 22, W - 8, H - 24, 0x000000, 0.22);
    g.box(2, 18, W - 4, H - 20, 0x6a5a7d, INK);
    g.rect(6, 23, W - 12, H - 41, 0xebe2f5);
    for (let x = 12; x < W - 14; x += 16) {
      g.box(x, 26, 12, 26, PALETTE.wood, INK);
      g.hline(x + 2, 30, 8, PALETTE.amber);
      g.hline(x + 2, 36, 8, PALETTE.copper);
      g.hline(x + 2, 42, 8, PALETTE.red);
    }
    const fy = H - 18;
    g.box(2, fy, W - 4, 16, 0xefe7f7, INK);
    for (const wx of [12, 26, 68, 82]) g.rbox(wx, fy + 3, 9, 10, PALETTE.lit, INK);
    g.rbox(45, fy + 3, 14, 13, PALETTE.woodDark, INK);
  });
  const roof = makePx(scene, `civic-memory-roof-${season === "winter" ? "w" : "n"}`, W, H, (g) => {
    const col = 0x7b6396, hi = shade(col, 24), dk = shade(col, -24);
    g.rect(2, H - 19, W - 4, 2, 0x000000, 0.28);
    g.rbox(0, 12, W, H - 30, col, INK);
    for (let y = 16; y < H - 19; y += 3) {
      g.hline(2, y, W - 4, dk);
      for (let x = 4; x < W - 4; x += 6) g.p(x, y - 1, hi);
    }
    if (season === "winter") g.rect(2, 13, W - 4, 3, 0xf2f7fb);
  });
  return { interior, roof };
}

// MARK: Interior Furniture (Smallville-style desks, CRT terminals, desk items)

export function desk(scene: Phaser.Scene, wide: boolean): string {
  const key = wide ? "desk-wide" : "desk";
  const w = wide ? 24 : 20;
  return makePx(scene, key, w, 12, (g) => {
    g.rect(1, 9, w - 2, 3, 0x000000, 0.2);
    g.box(0, 2, w, 7, PALETTE.wood, INK);
    g.hline(1, 3, w - 2, PALETTE.woodLight);
    g.rect(2, 9, 3, 3, PALETTE.woodDark);
    g.rect(w - 5, 9, 3, 3, PALETTE.woodDark);
  });
}

export function terminal(scene: Phaser.Scene, lit: boolean): string {
  const key = lit ? "term-lit" : "term-dark";
  return makePx(scene, key, 10, 9, (g) => {
    g.box(0, 0, 10, 7, lit ? 0x263854 : 0x22252e, INK);
    if (lit) {
      g.hline(2, 2, 5, 0x7be89c);
      g.hline(2, 4, 4, 0xffe28a);
    } else {
      g.p(2, 2, 0x454d63);
    }
    g.rect(4, 7, 2, 2, INK);
  });
}

export function deskItem(scene: Phaser.Scene, kind: string): string {
  return makePx(scene, `item-${kind}`, 7, 7, (g) => {
    switch (kind) {
      case "plant":
        g.box(2, 4, 3, 3, PALETTE.terracotta, INK);
        g.rect(1, 1, 5, 3, PALETTE.leaf);
        g.p(3, 0, PALETTE.leafLight);
        break;
      case "mug":
        g.box(1, 2, 4, 5, PALETTE.white, INK);
        g.p(5, 4, INK);
        break;
      case "lamp":
        g.vline(2, 2, 5, INK);
        g.rect(2, 1, 4, 2, PALETTE.amber);
        break;
      case "cat":
        g.rect(1, 3, 5, 3, 0x8f7b6b);
        g.p(4, 2, 0x8f7b6b); g.p(5, 2, 0x8f7b6b);
        break;
      case "books":
        g.vline(1, 1, 5, PALETTE.red);
        g.vline(2, 1, 5, PALETTE.copper);
        g.vline(3, 1, 5, PALETTE.amber);
        break;
      default: // radio
        g.box(0, 2, 7, 5, 0x8bc2de, INK);
        g.vline(5, 0, 2, INK);
    }
  });
}

// MARK: Props, Fountain, Trees, Plants, Monuments, Beyond-Town

/** Animated 3-frame stone fountain for the center of Town Square. */
export function fountainArt(scene: Phaser.Scene): string[] {
  return [0, 1, 2].map((f) => makePx(scene, `fountain-${f}`, 36, 36, (g) => {
    const cx = 18, cy = 20;
    g.ellipse(cx, cy + 4, 16, 10, 0x000000, 0.18);
    g.ellipse(cx, cy, 16, 11, INK);
    g.ellipse(cx, cy, 15, 10, PALETTE.stoneLight);
    g.ellipse(cx, cy, 12, 7.5, PALETTE.water);
    g.ellipse(cx, cy + 1, 10, 5.5, PALETTE.waterLight);
    // Central stone pedestal & upper bowl.
    g.box(cx - 3, cy - 8, 6, 9, PALETTE.stone, INK);
    g.ellipse(cx, cy - 8, 6, 3, INK);
    g.ellipse(cx, cy - 8, 5, 2, PALETTE.stoneLight);
    // Animated sparkling water jets!
    const h = 4 + (f % 2);
    g.vline(cx, cy - 9 - h, h, PALETTE.waterFoam);
    g.p(cx - 2 - f, cy - 10, PALETTE.waterFoam);
    g.p(cx + 2 + f, cy - 10, PALETTE.waterFoam);
    g.p(cx - 5, cy - 3 + f, PALETTE.waterFoam);
    g.p(cx + 5, cy - 2 - (f % 2), PALETTE.waterFoam);
    g.hline(cx - 8 + f * 2, cy + 2, 4, PALETTE.waterFoam);
  }));
}

export function tree(scene: Phaser.Scene, season: Season = "summer"): string {
  const key = `tree-${season}`;
  return makePx(scene, key, 26, 34, (g) => {
    g.ellipse(13, 30, 10, 3.5, 0x000000, 0.22);
    // Textured trunk.
    g.box(10, 19, 6, 12, PALETTE.woodDark, INK);
    g.vline(11, 20, 10, PALETTE.wood);
    if (season === "winter") {
      // Snow-laden bare winter branches.
      g.line(13, 20, 6, 10, PALETTE.woodDark);
      g.line(13, 20, 20, 10, PALETTE.woodDark);
      g.line(13, 18, 13, 5, PALETTE.woodDark);
      g.ellipse(6, 9, 4, 2, 0xf2f7fb);
      g.ellipse(20, 9, 4, 2, 0xf2f7fb);
      g.ellipse(13, 5, 5, 2.5, 0xffffff);
      return;
    }
    const pal = season === "autumn"
      ? { dk: 0xa64d24, mid: 0xd67c2c, hi: 0xf2b144, acc: 0xc43c2b }
      : season === "spring"
        ? { dk: 0x4b8744, mid: 0x6cb05b, hi: 0x93d17b, acc: 0xffbfd6 }
        : { dk: PALETTE.leafDark, mid: PALETTE.leaf, hi: PALETTE.leafLight, acc: 0x99d977 };
    // Layered pixel foliage clusters with crisp silhouette.
    g.circle(8, 15, 7, INK); g.circle(18, 15, 7, INK); g.circle(13, 9, 8, INK);
    g.circle(8, 15, 6, pal.dk); g.circle(18, 15, 6, pal.dk); g.circle(13, 10, 7, pal.dk);
    g.circle(8, 13, 5, pal.mid); g.circle(18, 13, 5, pal.mid); g.circle(13, 8, 6, pal.mid);
    g.circle(11, 6, 3.5, pal.hi); g.circle(16, 10, 2.5, pal.hi);
    for (const [x, y] of [[7, 11], [14, 5], [19, 12], [11, 14]] as const) g.p(x, y, pal.acc);
  });
}

export function plant(scene: Phaser.Scene, species: string, shadeIdx: number): string {
  const key = `plant-${species}-${shadeIdx}`;
  const greens = [0x5ea64c, 0x6cb558, 0x4f9444, 0x78bd5c];
  const leaf = greens[shadeIdx % greens.length]!, leafDk = shade(leaf, -26), leafHi = shade(leaf, 24);
  return makePx(scene, key, 20, 24, (g) => {
    g.ellipse(10, 21, 7, 2.5, 0x000000, 0.18);
    switch (species) {
      case "cone":
        g.box(8, 16, 4, 6, PALETTE.woodDark, INK);
        for (let y = 2; y < 18; y++) {
          const hw = Math.round(((y - 2) / 16) * 7);
          g.hline(10 - hw, y, hw * 2 + 1, y % 3 === 0 ? leafDk : leaf);
          g.p(10 - hw, y, INK); g.p(10 + hw, y, INK);
        }
        break;
      case "tall":
        g.box(8, 15, 4, 7, PALETTE.woodDark, INK);
        g.ellipse(10, 10, 5, 8, INK); g.ellipse(10, 10, 4, 7, leafDk); g.ellipse(9, 8, 3, 5, leaf);
        break;
      case "bush":
        g.circle(6, 17, 4.5, INK); g.circle(14, 17, 4.5, INK); g.circle(10, 14, 5, INK);
        g.circle(6, 17, 3.5, leafDk); g.circle(14, 17, 3.5, leafDk); g.circle(10, 14, 4, leaf);
        g.p(9, 12, leafHi);
        break;
      case "flowers":
        g.ellipse(10, 18, 7, 3.5, leafDk);
        for (const [x, y, c] of [[6, 17, 0xffaec4], [10, 16, 0xfff099], [14, 17, 0xffffff], [8, 19, 0x99d0ff], [12, 19, 0xd8b4f0]] as const) g.p(x, y, c);
        break;
      case "birch":
        g.box(8, 11, 4, 11, 0xf2eee6, INK);
        g.p(9, 14, INK); g.p(10, 17, INK);
        g.circle(10, 8, 6, INK); g.circle(10, 8, 5, 0x9ad470); g.circle(9, 6, 3, 0xbef08f);
        break;
      case "blossom":
        g.box(8, 14, 4, 8, PALETTE.woodDark, INK);
        g.circle(7, 11, 5, INK); g.circle(13, 11, 5, INK); g.circle(10, 7, 5.5, INK);
        g.circle(7, 11, 4, 0xf29ebb); g.circle(13, 11, 4, 0xf29ebb); g.circle(10, 7, 4.5, 0xffbdd4);
        g.p(9, 5, 0xffffff); g.p(12, 9, 0xffffff);
        break;
      default:
        g.box(8, 14, 4, 8, PALETTE.woodDark, INK);
        g.circle(7, 11, 5, INK); g.circle(13, 11, 5, INK); g.circle(10, 7, 5.5, INK);
        g.circle(7, 11, 4, leafDk); g.circle(13, 11, 4, leafDk); g.circle(10, 7, 4.5, leaf);
        g.p(9, 5, leafHi);
    }
  });
}

export function gardenArt(scene: Phaser.Scene, kind: string, wWorld: number): string {
  const aw = Math.min(96, Math.round(wWorld / PX));
  return makePx(scene, `garden-${kind}-${aw}`, aw + 20, 14, (g) => {
    const cx = Math.floor((aw + 20) / 2);
    if (kind === "flowers") {
      for (let i = 0; i < 8; i++) {
        const x = 10 + i * Math.floor((aw - 12) / 7);
        if (Math.abs(x - cx) < 10) continue;
        g.rect(x, 6, 3, 3, PALETTE.leafDark);
        g.p(x + 1, 6, [0xffaec4, 0xfff099, 0xffffff, 0xb8d8ff][i % 4]!);
      }
    } else if (kind === "hedge") {
      g.rbox(8, 3, Math.floor(aw * 0.34), 7, PALETTE.leafDark, INK);
      g.hline(10, 4, Math.floor(aw * 0.34) - 4, PALETTE.leaf);
      g.rbox(aw + 12 - Math.floor(aw * 0.34), 3, Math.floor(aw * 0.34), 7, PALETTE.leafDark, INK);
      g.hline(aw + 14 - Math.floor(aw * 0.34), 4, Math.floor(aw * 0.34) - 4, PALETTE.leaf);
    } else if (kind === "rocks") {
      for (let i = 0; i < 4; i++) {
        const rx = aw - 6 - i * 8;
        g.rbox(rx, 5 + (i % 2) * 2, 6, 5, PALETTE.stone, INK);
        g.hline(rx + 1, 6 + (i % 2) * 2, 3, PALETTE.stoneLight);
      }
    } else if (kind === "pond") {
      g.ellipse(aw + 2, 7, 13, 5.5, INK);
      g.ellipse(aw + 2, 7, 12, 4.5, PALETTE.water);
      g.hline(aw - 4, 6, 5, PALETTE.waterFoam);
    }
  });
}

export function landmark(scene: Phaser.Scene, kind: string, colour: number): string {
  const c = roofColour(COLOURS.indexOf(colour as (typeof COLOURS)[number]) >= 0 ? COLOURS.indexOf(colour as (typeof COLOURS)[number]) : 0);
  return makePx(scene, `landmark-${kind}-${c.toString(16)}`, 24, 48, (g) => {
    g.ellipse(12, 45, 9, 3, 0x000000, 0.2);
    switch (kind) {
      case "clocktower":
        g.box(7, 14, 10, 31, PALETTE.cream, INK);
        for (let i = 0; i < 8; i++) g.hline(12 - i, 6 + i, i * 2 + 1, c);
        g.circle(12, 20, 3.5, INK); g.circle(12, 20, 2.5, PALETTE.white);
        break;
      case "windmill":
        g.box(7, 18, 10, 27, PALETTE.cream, INK);
        g.box(6, 14, 12, 5, c, INK);
        g.box(10, 37, 4, 8, PALETTE.woodDark, INK);
        break;
      case "observatory":
        g.box(5, 22, 14, 23, PALETTE.stoneLight, INK);
        g.circle(12, 22, 7, INK); g.circle(12, 22, 6, 0xdce4f0);
        g.line(12, 20, 18, 13, INK);
        break;
      case "watertower":
        g.line(7, 44, 9, 22, INK); g.line(17, 44, 15, 22, INK); g.hline(8, 34, 8, INK);
        g.rbox(5, 10, 14, 13, PALETTE.wood, INK);
        break;
      default:
        g.box(9, 10, 6, 35, PALETTE.stone, INK);
        g.hline(10, 8, 4, PALETTE.stoneLight);
    }
  });
}

export function sails(scene: Phaser.Scene): string {
  return makePx(scene, "sails", 26, 26, (g) => {
    g.line(13, 13, 2, 6, PALETTE.wood); g.line(13, 13, 24, 20, PALETTE.wood);
    g.line(13, 13, 20, 2, PALETTE.wood); g.line(13, 13, 6, 24, PALETTE.wood);
    g.circle(13, 13, 2, INK);
  });
}

export function lamp(scene: Phaser.Scene): string {
  return makePx(scene, "lamp", 9, 22, (g) => {
    g.ellipse(4.5, 20, 3.5, 1.5, 0x000000, 0.2);
    g.vline(4, 6, 14, INK);
    g.box(2, 1, 5, 6, PALETTE.lit, INK);
    g.hline(1, 1, 7, INK);
  });
}

export function bench(scene: Phaser.Scene): string {
  return makePx(scene, "bench", 22, 11, (g) => {
    g.rect(1, 8, 20, 3, 0x000000, 0.18);
    g.box(1, 1, 20, 4, PALETTE.wood, INK);
    g.box(1, 4, 20, 4, PALETTE.woodLight, INK);
    g.rect(3, 8, 2, 3, INK);
    g.rect(17, 8, 2, 3, INK);
  });
}

/** Sidewalk mailbox/signal post outside each committee house (green = open, red = held). */
export function signal(scene: Phaser.Scene): string {
  makePx(scene, "signal", 10, 18, (g) => {
    g.ellipse(5, 16, 4, 1.5, 0x000000, 0.2);
    g.box(4, 8, 2, 9, PALETTE.woodDark, INK);
    g.rbox(1, 2, 8, 7, PALETTE.navy, INK);
    g.hline(2, 3, 6, shade(PALETTE.navy, 24));
  });
  makePx(scene, "lamp-red", 6, 6, (g) => { g.circle(3, 3, 2.5, INK); g.circle(3, 3, 1.8, PALETTE.red); });
  makePx(scene, "lamp-green", 6, 6, (g) => { g.circle(3, 3, 2.5, INK); g.circle(3, 3, 1.8, PALETTE.green); });
  return "signal";
}

/** Striped approval toll gate across a house's front garden path. */
export function gate(scene: Phaser.Scene): string {
  makePx(scene, "gate-post", 5, 14, (g) => g.box(0, 0, 5, 14, PALETTE.stoneDark, INK));
  makePx(scene, "barrier", 28, 5, (g) => {
    g.box(0, 0, 28, 5, PALETTE.white, INK);
    for (let x = 3; x < 24; x += 6) g.rect(x, 1, 3, 3, PALETTE.red);
  });
  return "barrier";
}

export function sheet(scene: Phaser.Scene): string {
  return makePx(scene, "sheet", 12, 4, (g) => g.box(0, 0, 12, 4, PALETTE.white, INK));
}

export function envelope(scene: Phaser.Scene, color: number): string {
  return makePx(scene, `env-${color.toString(16)}`, 9, 7, (g) => {
    g.box(0, 0, 9, 7, PALETTE.white, INK);
    g.line(1, 1, 4, 4, color);
    g.line(7, 1, 4, 4, color);
    g.p(4, 3, color);
  });
}

export function boards(scene: Phaser.Scene): string {
  return makePx(scene, "boards", 24, 14, (g) => {
    g.box(0, 1, 24, 4, PALETTE.wood, INK);
    g.box(0, 8, 24, 4, PALETTE.wood, INK);
  });
}

export function cottage(scene: Phaser.Scene, wall: number): string {
  return makePx(scene, `cottage-${wall.toString(16)}`, 26, 26, (g) => {
    const r = shade(wall, -40);
    g.rect(3, 12, 22, 13, 0x000000, 0.2);
    g.box(3, 11, 20, 13, wall, INK);
    g.box(1, 4, 24, 9, r, INK);
    g.hline(2, 8, 22, shade(r, 20));
    g.box(11, 16, 4, 8, PALETTE.woodDark, INK);
    g.box(5, 15, 4, 4, PALETTE.lit, INK);
    g.box(17, 15, 4, 4, PALETTE.lit, INK);
  });
}

export function train(scene: Phaser.Scene): string {
  return makePx(scene, "train", 20, 44, (g) => {
    g.rect(2, 2, 18, 42, 0x000000, 0.22);
    g.rbox(1, 1, 18, 20, PALETTE.red, INK);
    g.box(4, 4, 12, 6, PALETTE.lit, INK);
    g.box(7, 13, 6, 4, PALETTE.amber, INK);
    g.rbox(1, 23, 18, 20, PALETTE.navy, INK);
    g.box(4, 27, 12, 5, PALETTE.lit, INK);
    g.box(4, 34, 12, 5, PALETTE.lit, INK);
  });
}

export function townGate(scene: Phaser.Scene): string {
  return makePx(scene, "towngate", 34, 44, (g) => {
    g.rect(4, 36, 28, 7, 0x000000, 0.18);
    g.box(2, 10, 8, 32, PALETTE.stone, INK);
    g.box(24, 10, 8, 32, PALETTE.stone, INK);
    g.box(0, 4, 34, 10, PALETTE.stoneLight, INK);
    g.hline(2, 7, 30, PALETTE.stoneDark);
    g.box(13, 1, 8, 5, PALETTE.amber, INK);
  });
}

export function skyline(scene: Phaser.Scene): string {
  return makePx(scene, "skyline", 180, 48, (g) => {
    const blocks = [[2, 22, 22], [26, 10, 20], [48, 26, 24], [74, 4, 22], [98, 16, 26], [126, 10, 22], [150, 22, 26]] as const;
    for (const [x, y, w] of blocks) {
      g.box(x, y, w, 47 - y, 0x9fa3ba, INK);
      g.hline(x + 1, y + 1, w - 2, 0xbcc0d6);
      for (let wy = y + 5; wy < 43; wy += 6) {
        for (let wx = x + 3; wx < x + w - 4; wx += 5) g.rect(wx, wy, 2, 3, PALETTE.lit);
      }
    }
  });
}

export const STYLES = ["obelisk", "clocktower", "lighthouse", "pagoda", "greenhouse", "block"] as const;
export type Style = (typeof STYLES)[number];

export function monument(scene: Phaser.Scene, style: Style, size: number): string {
  const h = Math.max(14, Math.min(36, Math.round(size / 2)));
  return makePx(scene, `mon-${style}-${h}`, 24, h + 8, (g) => {
    const base = h + 4;
    g.ellipse(12, base + 1, 9, 2.5, 0x000000, 0.2);
    switch (style) {
      case "obelisk":
        g.box(9, 4, 6, base - 4, PALETTE.stoneLight, INK);
        g.hline(10, 2, 4, PALETTE.stone);
        break;
      case "clocktower":
        g.box(7, 7, 10, base - 7, 0xe8c48a, INK);
        g.box(6, 4, 12, 4, PALETTE.terracotta, INK);
        g.circle(12, 12, 3, PALETTE.white);
        break;
      case "lighthouse":
        g.box(8, 6, 8, base - 6, PALETTE.white, INK);
        for (let y = 9; y < base - 3; y += 6) g.rect(9, y, 6, 3, PALETTE.red);
        g.box(9, 2, 6, 5, PALETTE.lit, INK);
        break;
      case "pagoda":
        for (let k = 0; k < Math.max(2, Math.floor(h / 9)); k++) {
          const y = base - (k + 1) * 8, w = 16 - k * 2;
          g.box(12 - Math.floor(w / 2), y + 2, w, 6, PALETTE.cream, INK);
          g.hline(12 - Math.floor(w / 2) - 1, y + 1, w + 2, PALETTE.terracotta);
        }
        break;
      case "greenhouse":
        g.rbox(5, 6, 14, base - 6, 0xcff2de, INK);
        g.vline(10, 7, base - 8, 0x6bbf8a); g.vline(14, 7, base - 8, 0x6bbf8a);
        break;
      default:
        g.box(7, 4, 10, base - 4, PALETTE.stone, INK);
        for (let y = 7; y < base - 3; y += 4) g.hline(9, y, 6, PALETTE.stoneDark);
    }
    g.box(5, base - 2, 14, 4, PALETTE.stoneDark, INK);
  });
}

export function tool(scene: Phaser.Scene, kind: keyof typeof TOOLS): string {
  return makePx(scene, `tool-${kind}`, 9, 9, (g) => {
    switch (kind) {
      case "bash": g.line(1, 7, 5, 3, PALETTE.woodDark); g.box(4, 0, 5, 4, 0x8d93a3, INK); break;
      case "edit": g.line(1, 7, 6, 2, INK); g.rect(4, 1, 4, 4, PALETTE.white); break;
      case "read": g.box(1, 2, 7, 6, PALETTE.red, INK); g.vline(4, 3, 4, PALETTE.white); break;
      case "grep": g.circle(3.5, 3.5, 2.5, PALETTE.glass); g.line(5, 5, 8, 8, INK); break;
      case "mcp": g.box(1, 2, 7, 6, PALETTE.woodLight, INK); g.vline(4, 2, 6, INK); break;
      case "web": g.vline(2, 1, 7, INK); g.rect(3, 1, 5, 4, TOOLS.web); break;
    }
  });
}

export function bar(scene: Phaser.Scene, wWorld: number, hWorld: number, fill: number, stroke?: number): string {
  const aw = Math.max(2, Math.round(wWorld / PX)), ah = Math.max(2, Math.round(hWorld / PX));
  return makePx(scene, `bar-${aw}-${ah}-${fill.toString(16)}-${stroke?.toString(16) ?? ""}`, aw, ah, (g) => {
    if (stroke !== undefined) g.box(0, 0, aw, ah, fill, stroke);
    else g.rect(0, 0, aw, ah, fill);
  });
}

export function glow(scene: Phaser.Scene): string {
  if (!scene.textures.exists("glow")) {
    const c = scene.textures.createCanvas("glow", 64, 64)!;
    const ctx = c.getContext();
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,226,140,0.95)");
    grad.addColorStop(1, "rgba(255,226,140,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    c.refresh();
  }
  return "glow";
}

export function weatherArt(scene: Phaser.Scene) {
  makePx(scene, "puff", 7, 7, (g) => g.circle(3.5, 3.5, 3, PALETTE.white));
  makePx(scene, "drop", 2, 6, (g) => g.rect(0, 0, 1, 5, 0xbcd6f0));
  makePx(scene, "flake", 3, 3, (g) => { g.p(1, 0, PALETTE.white); g.hline(0, 1, 3, PALETTE.white); g.p(1, 2, PALETTE.white); });
  if (!scene.textures.exists("cloud")) {
    const c = scene.textures.createCanvas("cloud", 160, 88)!;
    const ctx = c.getContext();
    for (let k = 0; k < 8; k++) {
      const f = 1 - k * 0.1;
      ctx.fillStyle = "rgba(0,0,0,0.08)";
      ctx.beginPath();
      ctx.ellipse(60, 48, 48 * f, 26 * f, 0, 0, Math.PI * 2);
      ctx.ellipse(105, 42, 46 * f, 28 * f, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    c.refresh();
  }
}

// MARK: 16-bit 4-Directional RPG Characters (16×22 art px → 32×44 world px)

export interface FigureOpts {
  pose?: "stand" | "wave" | "sit" | "work" | "sleep";
  cane?: boolean;
  chair?: boolean;
  glyph?: string;
  hardhat?: boolean;
}

interface CharFrame {
  dir: "down" | "up" | "side";
  step: number;
  bob: number;
  eyes: number;
  stretch: boolean;
  sit: boolean;
  pose?: FigureOpts["pose"];
}

const STILL: CharFrame = { dir: "down", step: 0, bob: 0, eyes: 0, stretch: false, sit: false };

function drawPixelChar(g: Pix, look: Look, shirt: number, o: FigureOpts, f: CharFrame, ox: number, oy: number) {
  const pose = f.pose ?? o.pose ?? (f.sit ? "sit" : "stand");
  const skin = SKINS[look.skin] ?? PALETTE.skin;
  const hair = HAIRS[look.hairColour] ?? PALETTE.hair;
  const shirtDk = shade(shirt, -26);
  const shirtHi = shade(shirt, 22);
  const pants = 0x3b4259;
  const side = f.dir === "side", back = f.dir === "up";
  const cx = ox + 8;
  const base = oy + 20;
  const bob = Math.round(f.bob);
  const tall = look.body === "tall" ? 1 : 0;
  const bw = side ? 5 : look.body === "round" ? 8 : look.body === "slim" ? 6 : 7;

  // Ground shadow.
  g.ellipse(cx, base, side ? 3.5 : 4.5, 1.5, 0x000000, 0.24);

  // Legs / stride.
  const bodyTop = base - 10 - tall - bob + (pose === "sit" ? 2 : 0);
  if (pose === "sit") {
    g.rect(cx - 3, bodyTop + 6, 2, 3, pants);
    g.rect(cx + 1, bodyTop + 6, 2, 3, pants);
  } else if (side) {
    const stride = Math.round(f.step * 2);
    g.rect(cx - 1 - stride, base - 4 - tall, 2, 4 + tall, pants);
    g.rect(cx - 1 + stride, base - 4 - tall, 2, 4 + tall, shade(pants, 18));
    g.p(cx - 1 - stride, base - 1, INK);
    g.p(cx - 1 + stride, base - 1, INK);
  } else {
    const lLift = f.step > 0.35 ? 1 : 0, rLift = f.step < -0.35 ? 1 : 0;
    g.rect(cx - 3, base - 4 - tall - lLift, 2, 4 + tall, pants);
    g.rect(cx + 1, base - 4 - tall - rLift, 2, 4 + tall, pants);
    g.hline(cx - 3, base - 1 - lLift, 2, INK);
    g.hline(cx + 1, base - 1 - rLift, 2, INK);
  }

  // Torso (shirt) with crisp dark outline & highlight.
  const bx = Math.round(cx - bw / 2);
  g.box(bx - 1, bodyTop, bw + 2, 7, shirt, INK);
  g.hline(bx, bodyTop + 1, bw, shirtHi);
  g.hline(bx, bodyTop + 5, bw, shirtDk);

  // Arms.
  const swing = Math.round(f.step * 1.4);
  if (side) {
    g.rect(cx - 1 - swing, bodyTop + 1, 2, 4, shirtDk);
    g.p(cx - 1 - swing, bodyTop + 5, skin);
  } else {
    const lUp = pose === "wave" || f.stretch;
    const rUp = f.stretch;
    g.rect(bx - 2, lUp ? bodyTop - 3 : bodyTop + 1 + swing, 2, 4, shirtDk);
    g.p(bx - 2, lUp ? bodyTop - 4 : bodyTop + 5 + swing, skin);
    g.rect(bx + bw + 1, rUp ? bodyTop - 3 : pose === "work" ? bodyTop : bodyTop + 1 - swing, 2, 4, shirtDk);
    g.p(bx + bw + 1, rUp ? bodyTop - 4 : pose === "work" ? bodyTop + 4 : bodyTop + 5 - swing, skin);
  }

  // Scarf / bowtie / runtime chest emblem / chair gold pin.
  if (!back && look.accessory === "scarf") g.hline(bx, bodyTop + 1, bw, 0xd44b82);
  if (!back && !side && look.accessory === "bowtie") g.hline(cx - 1, bodyTop + 1, 3, 0xd44b82);
  if (o.glyph && !back) {
    const gx = side ? cx : cx - 1, gy = bodyTop + 3;
    if (o.glyph === "claude") { g.p(gx + 1, gy, PALETTE.white); g.p(gx, gy + 1, PALETTE.white); g.p(gx + 2, gy + 1, PALETTE.white); }
    else if (o.glyph === "codex") { g.rect(gx, gy, 2, 2, PALETTE.white); }
    else if (o.glyph === "agy") { g.p(gx + 1, gy, PALETTE.white); g.hline(gx, gy + 1, 3, PALETTE.white); }
  }
  if (o.chair && !back) g.rect(bx + bw - 2, bodyTop + 1, 2, 2, PALETTE.amber);

  // Head (classic chunky readable 16-bit RPG head: 8×7 art px!).
  const headY = bodyTop - 7 + (pose === "sleep" ? 2 : 0);
  if (look.hair === "long") g.box(cx - 5, headY + 1, 10, 7, hair, INK);
  g.rbox(cx - 4, headY, 8, 7, back && look.hair !== "bald" ? hair : skin, INK);

  if (!back) {
    if (look.hair !== "bald") {
      g.rect(cx - 3, headY + 1, 6, 2, hair);
      if (side) g.rect(cx - 3, headY + 1, 3, 4, hair);
      if (look.hair === "curly") { g.p(cx - 4, headY + 1, hair); g.p(cx + 3, headY + 1, hair); g.p(cx - 1, headY, hair); g.p(cx + 1, headY, hair); }
    }
    const ex = f.eyes;
    if (pose === "sleep") {
      g.hline(cx - 2, headY + 4, 2, INK); g.hline(cx + 1, headY + 4, 2, INK);
    } else if (side) {
      g.p(cx + 2, headY + 4, INK);
      if (look.accessory === "glasses") g.hline(cx + 1, headY + 4, 3, 0x262130);
    } else {
      g.p(cx - 2 + ex, headY + 4, INK);
      g.p(cx + 1 + ex, headY + 4, INK);
      g.p(cx - 3, headY + 5, 0xe88b82, 0.55);
      g.p(cx + 2, headY + 5, 0xe88b82, 0.55);
      if (look.accessory === "glasses") {
        g.hline(cx - 3, headY + 4, 3, INK); g.hline(cx + 1, headY + 4, 3, INK);
      }
    }
  }
  if (look.hair === "bun") g.rect(cx - 1 + (side ? -3 : 0), headY - 2, 3, 2, hair);
  if (look.accessory === "headphones") {
    g.hline(cx - 3, headY, 6, INK);
    g.rect(cx - 5, headY + 3, 2, 2, 0xd44b82);
    g.rect(cx + 3, headY + 3, 2, 2, 0xd44b82);
  }

  // Hat.
  const hatCol = o.hardhat ? PALETTE.amber : roofColour(look.hatColour);
  const hat = o.hardhat ? "hardhat" : look.hat;
  switch (hat) {
    case "cap":
      g.rect(cx - 4, headY - 1, 8, 2, hatCol);
      if (!back) g.hline(cx, headY + 1, side ? 5 : 4, shade(hatCol, -24));
      break;
    case "beret": g.rect(cx - 4, headY - 1, 8, 2, hatCol); g.hline(cx - 3, headY - 2, 6, shade(hatCol, 16)); break;
    case "top": g.box(cx - 3, headY - 5, 6, 5, INK, INK); g.hline(cx - 5, headY, 10, INK); g.hline(cx - 2, headY - 2, 4, PALETTE.amber); break;
    case "beanie": g.rect(cx - 4, headY - 1, 8, 3, hatCol); g.p(cx, headY - 2, PALETTE.white); break;
    case "hardhat": g.rect(cx - 4, headY - 1, 8, 3, PALETTE.amber); g.hline(cx - 5, headY + 1, 10, shade(PALETTE.amber, -26)); break;
  }

  // Cane (for elders).
  if (o.cane) {
    const kx = side ? cx + 3 : bx + bw + 2;
    g.vline(kx, bodyTop + 3, 8, PALETTE.woodDark);
    g.p(kx - 1, bodyTop + 3, PALETTE.woodDark);
  }
}

export function character(scene: Phaser.Scene, look: Look, shirt: number, o: FigureOpts = {}): string {
  const pose = o.pose ?? "stand";
  const key = `char-${lookKey(look)}-${shirt.toString(16)}-${pose}-${o.cane ? 1 : 0}-${o.chair ? 1 : 0}-${o.glyph ?? ""}-${o.hardhat ? 1 : 0}`;
  return makePx(scene, key, 16, 22, (g) => {
    drawPixelChar(g, look, shirt, o, { ...STILL, sit: pose === "sit", pose }, 0, 0);
  });
}

export function person(scene: Phaser.Scene, shirt: number, opts: { hair?: number; pose?: "stand" | "wave" | "sit"; cane?: boolean; hat?: number } = {}): string {
  const look: Look = { body: "slim", hair: "short", hat: opts.hat ? "cap" : "none", accessory: "none", walk: "brisk", deskItem: "mug", skin: 0, hairColour: 0, hatColour: 0 };
  return character(scene, look, shirt, { pose: opts.pose, cane: opts.cane });
}

export const WALK_FRAMES = 6;
export const IDLE = ["still", "breathe", "left", "right", "stretch"] as const;
export type SheetFrame = `walk-${"down" | "up" | "side"}-${number}` | `idle-${(typeof IDLE)[number]}` | "sit" | "side" | "up" | "work" | "wave";

export function walkSheet(scene: Phaser.Scene, look: Look, shirt: number, o: FigureOpts = {}): string {
  const key = `walk-${lookKey(look)}-${shirt.toString(16)}-${o.cane ? 1 : 0}-${o.chair ? 1 : 0}-${o.glyph ?? ""}-${o.hardhat ? 1 : 0}`;
  if (scene.textures.exists(key)) return key;
  const frames: [SheetFrame, CharFrame][] = [];
  for (const dir of ["down", "up", "side"] as const) {
    for (let i = 0; i < WALK_FRAMES; i++) {
      const p = (i / WALK_FRAMES) * Math.PI * 2;
      frames.push([`walk-${dir}-${i}`, { ...STILL, dir, step: Math.sin(p), bob: Math.abs(Math.sin(p)) > 0.5 ? 1 : 0 }]);
    }
  }
  frames.push(
    ["idle-still", STILL],
    ["idle-breathe", { ...STILL, bob: 1 }],
    ["idle-left", { ...STILL, eyes: -1 }],
    ["idle-right", { ...STILL, eyes: 1 }],
    ["idle-stretch", { ...STILL, stretch: true, bob: 1 }],
    ["sit", { ...STILL, sit: true }],
    ["side", { ...STILL, dir: "side" }],
    ["up", { ...STILL, dir: "up" }],
    ["work", { ...STILL, pose: "work" }],
    ["wave", { ...STILL, pose: "wave" }],
  );
  const fw = 16, fh = 22, cols = 8, rows = Math.ceil(frames.length / cols);
  const c = document.createElement("canvas");
  c.width = fw * cols;
  c.height = fh * rows;
  const g = new Pix(c);
  frames.forEach(([, f], i) => {
    drawPixelChar(g, look, shirt, { ...o, pose: undefined }, f, (i % cols) * fw, Math.floor(i / cols) * fh);
  });
  const tex = scene.textures.addCanvas(key, c)!;
  tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
  frames.forEach(([name], i) => {
    tex.add(`${key}|${name}`, 0, (i % cols) * fw, Math.floor(i / cols) * fh, fw, fh);
  });
  return key;
}

export const SHEET_UNIT = PX;
export const COLOURS_OF = (i: number) => COLOURS[i] ?? COLOURS[0];
export const mix = mixHex;
