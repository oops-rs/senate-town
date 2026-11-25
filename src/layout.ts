// Village street-grid layout (Smallville / AI-Town style): a central
// cobblestone Town Square with a fountain, bordered directly by the civic
// buildings (Town Hall, Post Office, Archive Library, Memory Hall, Elders'
// Garden, Monument Park), and residential/workshop blocks of committee houses
// along real streets. Compact and balanced for 1–5 committees; expands
// block-by-block along the street grid up to 30+ committees without moving
// existing houses. Pure: no Phaser, no DOM.
import { hash } from "./model.ts";

export interface Pt { x: number; y: number }
export interface TileRect { tx: number; ty: number; tw: number; th: number }

/** World pixels per map tile (each tile is drawn from crisp 16×16 pixel art at 2×). */
export const TILE = 32;

/** Standard committee lot size in tiles (house + front yard + garden border). */
export const LOT_TILES = { tw: 7, th: 6 };
export const WORKSHOP = { w: 192, h: 128 };

/** A committee's lot on the village street grid. */
export interface Slot {
  /** Building center in world px. */
  at: Pt;
  /** Top-left tile of the 7×6 lot. */
  tx: number;
  ty: number;
  /** Front door entry point on the sidewalk/path in world px. */
  door: Pt;
  /** Sidewalk mailbox/signal post in world px. */
  signal: Pt;
  /** Approval gate barrier center on the front garden path in world px. */
  gate: Pt;
  /** Expansion tier (0 = inner village around Town Square). */
  tier: number;
  /** Deterministic index within the tier. */
  index: number;
}

export interface BuildingSlot {
  at: Pt;
  tx: number;
  ty: number;
  tw: number;
  th: number;
  door: Pt;
}

export interface Plan {
  slots: Map<string, Slot>;
  /** Unused lots in the active tiers (kept minimal; used for new builds). */
  empty: Slot[];
  /** Tile bounds of the whole village (inclusive min, exclusive max). */
  tiles: { x0: number; y0: number; x1: number; y1: number };
  /** Walkable paved streets (cobblestone). */
  streets: TileRect[];
  /** Paved plazas (Town Square, Monument Park paths). */
  plazas: TileRect[];
  /** Gravel / dirt footpaths (Elders' promenade, south country lanes, garden walks). */
  paths: TileRect[];
  /** The north river and the arched stone bridge over it. */
  river: TileRect;
  bridge: TileRect;
  /** Civic & landmark placements. */
  civic: {
    square: Pt;
    fountain: Pt;
    townHall: BuildingSlot;
    postOffice: BuildingSlot;
    archive: BuildingSlot;
    memory: BuildingSlot;
    promenade: Pt[];
    monuments: TileRect;
    gate: Pt;
    parent: Pt;
    children: Pt[];
    rail: number;
    station: Pt;
  };
}

/** Deterministic sort order by committee name hash. */
export function ordered(names: string[]): string[] {
  return [...new Set(names)].sort((a, b) => {
    const ha = hash(a), hb = hash(b);
    return ha < hb ? -1 : ha > hb ? 1 : a < b ? -1 : a > b ? 1 : 0;
  });
}

function makeSlot(tx: number, ty: number, tier: number, index: number): Slot {
  // House body sits in the upper 4.5 tiles of the 7×6 lot; bottom 1.5 tiles is front yard & garden walk to the street.
  const cx = (tx + LOT_TILES.tw / 2) * TILE;
  const cy = (ty + 2.6) * TILE;
  const doorY = (ty + LOT_TILES.th + 0.35) * TILE;
  return {
    at: { x: cx, y: cy },
    tx,
    ty,
    door: { x: cx, y: doorY },
    signal: { x: cx + 2.35 * TILE, y: (ty + LOT_TILES.th - 0.3) * TILE },
    gate: { x: cx, y: (ty + LOT_TILES.th - 0.55) * TILE },
    tier,
    index,
  };
}

function building(tx: number, ty: number, tw: number, th: number, doorOffsetX = 0): BuildingSlot {
  const cx = (tx + tw / 2) * TILE;
  const cy = (ty + th / 2 - 0.3) * TILE;
  return {
    at: { x: cx, y: cy },
    tx,
    ty,
    tw,
    th,
    door: { x: cx + doorOffsetX * TILE, y: (ty + th + 0.45) * TILE },
  };
}

/**
 * Candidate residential/workshop lots grouped into concentric neighborhood
 * tiers around Town Square. Every lot is 7×6 tiles and faces south onto a
 * 2-tile cobblestone street.
 */
function tierLots(tier: number): [number, number][] {
  if (tier === 0) {
    // Inner Village (6 prime lots hugging Town Square, Main Street, and Oak Lane):
    // looks complete and balanced with 1 to 6 committees.
    return [
      [7, -2],   // East Square (right across from the fountain!)
      [-4, 6],   // South Square West (directly south of the fountain)
      [7, 6],    // South Square East
      [10, -11], // North-East Main (right beside the Post Office)
      [15, -2],  // East Main Street
      [15, 6],   // East Oak Lane
    ];
  }
  if (tier === 1) {
    // Second ring of village blocks (10 lots → 16 total):
    // extends Willow Lane (south) and East Cross Street (east).
    return [
      [18, -11], // North-East Avenue
      [25, -2],  // East Cross Mid
      [25, 6],   // East Cross South
      [26, -11], // Far North-East
      [-4, 14],  // Willow Lane Center
      [7, 14],   // Willow Lane East 1
      [15, 14],  // Willow Lane East 2
      [-12, 14], // Willow Lane West (south of Monument Park)
      [25, 14],  // Willow Lane East 3
      [-20, 14], // Willow Lane Far West
    ];
  }
  // Tier 2+ (expands cleanly south by rows and east by blocks for 30+ committees).
  const out: [number, number][] = [];
  const rowY = 14 + (tier - 1) * 8; // ty = 22, 30, 38...
  for (const colX of [-20, -12, -4, 7, 15, 25, 33]) out.push([colX, rowY]);
  // Plus an extra eastern column on existing rows for tier 2+.
  const eastX = 25 + (tier - 1) * 8; // tx = 33, 41...
  out.push([eastX, -11], [eastX, -2], [eastX, 6], [eastX, 14]);
  // Deduplicate in case eastX coincides with rowY's last column.
  const seen = new Set<string>();
  return out.filter(([x, y]) => {
    const k = `${x},${y}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function capacity(tier: number): number {
  return tierLots(tier).length;
}

export function slotAt(tier: number, index: number): Slot {
  const list = tierLots(tier);
  const [tx, ty] = list[index % list.length]!;
  return makeSlot(tx, ty, tier, index);
}

/**
 * Compute the village layout for the given committee names.
 * Existing committees in `keep` keep their exact lot so nobody moves live.
 */
export function plan(names: string[], keep?: Map<string, Slot>): Plan {
  const all = ordered(names);
  const slots = new Map<string, Slot>();
  const taken: Set<number>[] = [];
  const usedCoords = new Set<string>();
  let maxTier = 0;

  // Keep existing lots first so live arrivals never shift neighbours.
  for (const name of all) {
    const k = keep?.get(name);
    if (!k) continue;
    const list = tierLots(k.tier);
    if (k.index >= list.length || taken[k.tier]?.has(k.index)) continue;
    const s = slotAt(k.tier, k.index);
    const ck = `${s.tx},${s.ty}`;
    if (usedCoords.has(ck)) continue;
    (taken[k.tier] ??= new Set()).add(k.index);
    usedCoords.add(ck);
    slots.set(name, s);
    maxTier = Math.max(maxTier, k.tier);
  }

  for (const name of all) {
    if (slots.has(name)) continue;
    let t = 0;
    while (true) {
      const list = tierLots(t);
      const used = (taken[t] ??= new Set());
      const freeCount = list.filter(([x, y], idx) => !used.has(idx) && !usedCoords.has(`${x},${y}`)).length;
      if (freeCount > 0) break;
      t++;
    }
    const list = tierLots(t);
    const used = (taken[t] ??= new Set());
    let i = Number(hash(name) % BigInt(list.length));
    while (used.has(i) || usedCoords.has(`${list[i]![0]},${list[i]![1]}`)) i = (i + 1) % list.length;
    used.add(i);
    const s = slotAt(t, i);
    usedCoords.add(`${s.tx},${s.ty}`);
    slots.set(name, s);
    maxTier = Math.max(maxTier, t);
  }

  const empty: Slot[] = [];
  for (let t = 0; t <= maxTier; t++) {
    const list = tierLots(t);
    for (let i = 0; i < list.length; i++) {
      const [x, y] = list[i]!;
      if (!taken[t]?.has(i) && !usedCoords.has(`${x},${y}`)) empty.push(makeSlot(x, y, t, i));
    }
  }

  // Fixed civic buildings framing Town Square (all face south onto cobblestone streets).
  const townHall = building(-8, -11, 7, 6);
  const postOffice = building(2, -11, 7, 6);
  const memory = building(-16, -11, 7, 6);
  const archive = building(-13, -2, 7, 6);
  const monuments: TileRect = { tx: -16, ty: 6, tw: 10, th: 6 };

  // Compute dynamic village extents from active committee lots + civic core.
  let maxLotX = 16; // minimum east reach covers Post Office & East Square nicely
  let minLotX = -20; // covers Memory Hall, Elders' Garden, West Gate
  let maxLotY = 12; // covers Monument Park & South Square Row
  for (const s of slots.values()) {
    maxLotX = Math.max(maxLotX, s.tx + LOT_TILES.tw + 1);
    minLotX = Math.min(minLotX, s.tx - 2);
    maxLotY = Math.max(maxLotY, s.ty + LOT_TILES.th + 1);
  }

  // East railway runs cleanly just past the easternmost active block.
  const eastStreetX = maxLotX;
  const railTileX = eastStreetX + 4;
  const gateTileX = Math.min(-21, minLotX - 2);
  const riverTileY = -16;
  const northTileY = riverTileY - 4;
  const southLaneEndY = maxLotY + 5;
  const tiles = {
    x0: gateTileX - 4,
    y0: northTileY - 1,
    x1: railTileX + 5,
    y1: southLaneEndY + 3,
  };

  // Build the cobblestone street network serving ONLY the active rows & columns.
  const streets: TileRect[] = [
    // North Main Street (runs from West Gate across Memory, Town Hall, Post Office, and NE blocks).
    { tx: gateTileX + 1, ty: -5, tw: eastStreetX - gateTileX, th: 2 },
    // South Main Street (runs from Elders' Garden past Archive, Square, and East blocks).
    { tx: -19, ty: 4, tw: eastStreetX + 19 + 1, th: 2 },
    // Oak Lane (serves Monument Park and South Square Row).
    { tx: Math.min(-16, minLotX), ty: 12, tw: eastStreetX - Math.min(-16, minLotX) + 1, th: 2 },
    // West Square Avenue (connects North Main, South Main, Oak Lane).
    { tx: -6, ty: -5, tw: 2, th: maxLotY + 7 },
    // East Square Avenue (connects North Main, South Main, Oak Lane & south rows).
    { tx: 5, ty: -5, tw: 2, th: maxLotY + 7 },
    // Bridge Avenue (ceremonial stone avenue straight north from Square to the River Bridge).
    { tx: -1, ty: -13, tw: 2, th: 10 },
  ];

  // Add Willow Lane / Meadow Lane / further southern streets when lower rows are occupied.
  const activeRows = new Set([...slots.values()].map((s) => s.ty));
  for (const ry of [...activeRows].sort((a, b) => a - b)) {
    if (ry >= 14) {
      const streetY = ry + LOT_TILES.th; // 20, 28, ...
      const rowMinX = Math.min(-12, ...[...slots.values()].filter((s) => s.ty === ry).map((s) => s.tx));
      streets.push({ tx: rowMinX, ty: streetY, tw: eastStreetX - rowMinX + 1, th: 2 });
    }
  }

  // Add East Cross Avenue when tier 1+ eastern blocks are occupied.
  if (maxLotX > 24) {
    streets.push({ tx: 23, ty: -5, tw: 2, th: maxLotY + 7 });
  }
  // Add an East Perimeter Lane connecting the eastern ends cleanly.
  streets.push({ tx: eastStreetX - 1, ty: -5, tw: 2, th: maxLotY + 7 });

  // Paved plazas: Town Square (between West Square St & East Square St, North Main & South Main).
  const plazas: TileRect[] = [
    { tx: -4, ty: -3, tw: 9, th: 7 },
  ];

  // Gravel/dirt footpaths: Elders' Garden promenade, Monument Park walks, south lanes to child hamlets.
  const promX0 = -19, promX1 = -14, promY0 = -3, promY1 = 3;
  const paths: TileRect[] = [
    // Elders' Garden rectangular gravel promenade loop (west of Archive Library, linking North & South Main).
    { tx: promX0, ty: promY0, tw: promX1 - promX0 + 1, th: 1 },
    { tx: promX0, ty: promY1, tw: promX1 - promX0 + 1, th: 1 },
    { tx: promX0, ty: promY0, tw: 1, th: promY1 - promY0 + 1 },
    { tx: promX1, ty: promY0, tw: 1, th: promY1 - promY0 + 1 },
    // Connection from Elders' Garden up to North Main St and down to South Main St.
    { tx: -17, ty: -4, tw: 2, th: 2 },
    { tx: -17, ty: 3, tw: 2, th: 2 },
    // Monument Park walkthrough stone paths.
    { tx: monuments.tx + 1, ty: monuments.ty, tw: monuments.tw - 2, th: 1 },
    { tx: monuments.tx + 4, ty: monuments.ty, tw: 2, th: monuments.th },
    // South country lanes to the two Child Senate hamlets.
    { tx: -6, ty: maxLotY + 1, tw: 2, th: 4 },
    { tx: 5, ty: maxLotY + 1, tw: 2, th: 4 },
    // Short lane from East Perimeter Lane to the Railway Station platform.
    { tx: eastStreetX + 1, ty: 1, tw: 3, th: 2 },
  ];

  const river: TileRect = { tx: tiles.x0, ty: riverTileY, tw: tiles.x1 - tiles.x0, th: 3 };
  const bridge: TileRect = { tx: -1, ty: riverTileY - 1, tw: 2, th: 5 };

  const promenade: Pt[] = [
    { x: (promX0 + 0.5) * TILE, y: (promY0 + 0.5) * TILE },
    { x: (promX1 + 0.5) * TILE, y: (promY0 + 0.5) * TILE },
    { x: (promX1 + 0.5) * TILE, y: (promY1 + 0.5) * TILE },
    { x: (promX0 + 0.5) * TILE, y: (promY1 + 0.5) * TILE },
  ];

  return {
    slots,
    empty,
    tiles,
    streets,
    plazas,
    paths,
    river,
    bridge,
    civic: {
      square: { x: 0.5 * TILE, y: 0.5 * TILE },
      fountain: { x: 0.5 * TILE, y: 0.5 * TILE },
      townHall,
      postOffice,
      archive,
      memory,
      promenade,
      monuments,
      gate: { x: gateTileX * TILE, y: -4 * TILE },
      parent: { x: 0, y: (riverTileY - 2.3) * TILE },
      children: [
        { x: -5 * TILE, y: (southLaneEndY + 0.5) * TILE },
        { x: 6 * TILE, y: (southLaneEndY + 0.5) * TILE },
      ],
      rail: (railTileX + 0.5) * TILE,
      station: { x: (railTileX - 1) * TILE, y: 2 * TILE },
    },
  };
}

/** World bounding box that `fit()` frames. */
export function bounds(p: Plan): { x: number; y: number; w: number; h: number } {
  const x = (p.tiles.x0 + 1) * TILE;
  const y = (p.tiles.y0 + 0.5) * TILE;
  const w = (p.tiles.x1 - p.tiles.x0 - 2) * TILE;
  const h = (p.tiles.y1 - p.tiles.y0 - 1) * TILE;
  return { x, y, w, h };
}
