// What every house and every character looks like: generated from a seed
// (the committee's or the senator's name, so it is the same on every
// launch), or chosen by its owner through a card. A card is untrusted peer
// input: only the enumerations and bounded numbers below are read, anything
// else is ignored, and what is missing comes from the generated one. Nothing
// from a card is ever drawn as text, an image or a link. Pure: no Phaser.
import { seeded } from "./model.ts";

export const HOUSE = {
  footprint: ["narrow", "wide", "long"],
  storeys: [1, 2],
  roof: ["sawtooth", "gable", "flat", "dome", "stepped", "mansard"],
  material: ["plaster", "brick", "timber", "panel"],
  windows: ["round", "arch", "square"],
  door: ["round", "square", "double"],
  topper: ["none", "chimney", "antenna", "vent", "flag", "tank", "clock"],
  sign: ["round", "banner", "diamond", "shield"],
  garden: ["lawn", "flowers", "hedge", "rocks", "pond"],
  landmark: ["none", "clocktower", "windmill", "observatory", "watertower", "obelisk"],
} as const;
export const PLANTS = ["round", "cone", "tall", "bush", "flowers", "birch", "blossom"] as const;
/** The palette a card may pick colours from (by index). */
export const COLOURS = [0xf6a97a, 0x9fd3ea, 0xbfe39a, 0xffd57e, 0xd6bfe6, 0xf7b2cf, 0xa9c8ff, 0xffbf9b, 0xa6e3d0, 0xe8c79c, 0xc9b8a6, 0x9fb7c9] as const;

export interface HouseSpec {
  footprint: (typeof HOUSE.footprint)[number];
  storeys: (typeof HOUSE.storeys)[number];
  roof: (typeof HOUSE.roof)[number];
  material: (typeof HOUSE.material)[number];
  windows: (typeof HOUSE.windows)[number];
  door: (typeof HOUSE.door)[number];
  topper: (typeof HOUSE.topper)[number];
  sign: (typeof HOUSE.sign)[number];
  garden: (typeof HOUSE.garden)[number];
  landmark: (typeof HOUSE.landmark)[number];
  wall: number; trim: number; doorColour: number; signColour: number;
  plants: (typeof PLANTS)[number][];
}

export const LOOK = {
  body: ["slim", "round", "tall"],
  hair: ["short", "long", "bun", "bald", "curly"],
  hat: ["none", "cap", "beret", "top", "beanie", "hardhat"],
  accessory: ["none", "glasses", "scarf", "headphones", "bowtie"],
  walk: ["brisk", "amble", "hop"],
  deskItem: ["plant", "mug", "lamp", "cat", "books", "radio"],
} as const;
export const SKINS = [0xf3d2b3, 0xe8bd98, 0xd29b72, 0xa86f4c, 0x7c4f35, 0xf6dcc8] as const;
export const HAIRS = [0x5a4334, 0x2e2622, 0xb07a3f, 0xe0c27a, 0x9a3b2b, 0x7d7d85, 0x3b4a7a, 0x6b4f3a] as const;

export interface Look {
  body: (typeof LOOK.body)[number];
  hair: (typeof LOOK.hair)[number];
  hat: (typeof LOOK.hat)[number];
  accessory: (typeof LOOK.accessory)[number];
  walk: (typeof LOOK.walk)[number];
  deskItem: (typeof LOOK.deskItem)[number];
  skin: number; hairColour: number; hatColour: number;
}

const pick = <T>(rnd: () => number, list: readonly T[]): T => list[Math.floor(rnd() * list.length)]!;
const index = (rnd: () => number, n: number) => Math.floor(rnd() * n);

export function generateHouse(seed: string): HouseSpec {
  const rnd = seeded(`house:${seed}`);
  const wall = index(rnd, COLOURS.length);
  let trim = index(rnd, COLOURS.length);
  if (trim === wall) trim = (trim + 3) % COLOURS.length;
  return {
    footprint: pick(rnd, HOUSE.footprint), storeys: pick(rnd, HOUSE.storeys), roof: pick(rnd, HOUSE.roof),
    material: pick(rnd, HOUSE.material), windows: pick(rnd, HOUSE.windows), door: pick(rnd, HOUSE.door),
    topper: pick(rnd, HOUSE.topper), sign: pick(rnd, HOUSE.sign), garden: pick(rnd, HOUSE.garden), landmark: "none",
    wall, trim, doorColour: index(rnd, COLOURS.length), signColour: index(rnd, COLOURS.length),
    plants: [pick(rnd, PLANTS), pick(rnd, PLANTS), pick(rnd, PLANTS)],
  };
}

export function generateLook(seed: string): Look {
  const rnd = seeded(`look:${seed}`);
  return {
    body: pick(rnd, LOOK.body), hair: pick(rnd, LOOK.hair), hat: rnd() < 0.55 ? "none" : pick(rnd, LOOK.hat),
    accessory: rnd() < 0.5 ? "none" : pick(rnd, LOOK.accessory), walk: pick(rnd, LOOK.walk), deskItem: pick(rnd, LOOK.deskItem),
    skin: index(rnd, SKINS.length), hairColour: index(rnd, HAIRS.length), hatColour: index(rnd, COLOURS.length),
  };
}

/** What makes two houses look the same: every visible choice. */
export const houseKey = (h: HouseSpec) => JSON.stringify(h);

/**
 * Every committee's house: its card's blueprint over its generated one,
 * reseeded until no two in town look the same.
 */
export function houses(names: string[], cards: Map<string, unknown> = new Map()): Map<string, HouseSpec> {
  const out = new Map<string, HouseSpec>();
  const seen = new Set<string>();
  for (const name of [...names].sort()) {
    let salt = 0;
    let spec = readHouse(cards.get(name), generateHouse(name));
    while (seen.has(houseKey(spec)) && salt < 50) spec = readHouse(cards.get(name), generateHouse(`${name}#${++salt}`));
    seen.add(houseKey(spec));
    out.set(name, spec);
  }
  return out;
}

const MAX_CARD = 2048;

function fromCard(card: unknown): Record<string, unknown> | undefined {
  if (!card || typeof card !== "object" || Array.isArray(card)) return undefined;
  try {
    if (JSON.stringify(card).length > MAX_CARD) return undefined;
  } catch {
    return undefined;
  }
  return card as Record<string, unknown>;
}

const oneOf = <T>(value: unknown, list: readonly T[], fallback: T): T => (list as readonly unknown[]).includes(value) ? (value as T) : fallback;
const colour = (value: unknown, n: number, fallback: number) =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value < n ? value : fallback;

/** A house blueprint from a card: known values only, the rest generated. */
export function readHouse(card: unknown, base: HouseSpec): HouseSpec {
  const c = fromCard(card);
  if (!c) return base;
  const plants = Array.isArray(c.plants) ? c.plants.slice(0, 3).map((p, i) => oneOf(p, PLANTS, base.plants[i] ?? "round")) : base.plants;
  return {
    footprint: oneOf(c.footprint, HOUSE.footprint, base.footprint), storeys: oneOf(c.storeys, HOUSE.storeys, base.storeys),
    roof: oneOf(c.roof, HOUSE.roof, base.roof), material: oneOf(c.material, HOUSE.material, base.material),
    windows: oneOf(c.windows, HOUSE.windows, base.windows), door: oneOf(c.door, HOUSE.door, base.door),
    topper: oneOf(c.topper, HOUSE.topper, base.topper), sign: oneOf(c.sign, HOUSE.sign, base.sign),
    garden: oneOf(c.garden, HOUSE.garden, base.garden), landmark: oneOf(c.landmark, HOUSE.landmark, base.landmark),
    wall: colour(c.wall, COLOURS.length, base.wall), trim: colour(c.trim, COLOURS.length, base.trim),
    doorColour: colour(c.doorColour, COLOURS.length, base.doorColour), signColour: colour(c.signColour, COLOURS.length, base.signColour),
    plants: plants.length ? plants : base.plants,
  };
}

/** A character from a card: known values only, the rest generated. */
export function readLook(card: unknown, base: Look): Look {
  const c = fromCard(card);
  if (!c) return base;
  return {
    body: oneOf(c.body, LOOK.body, base.body), hair: oneOf(c.hair, LOOK.hair, base.hair), hat: oneOf(c.hat, LOOK.hat, base.hat),
    accessory: oneOf(c.accessory, LOOK.accessory, base.accessory), walk: oneOf(c.walk, LOOK.walk, base.walk),
    deskItem: oneOf(c.deskItem, LOOK.deskItem, base.deskItem),
    skin: colour(c.skin, SKINS.length, base.skin), hairColour: colour(c.hairColour, HAIRS.length, base.hairColour),
    hatColour: colour(c.hatColour, COLOURS.length, base.hatColour),
  };
}

export const lookKey = (l: Look) => JSON.stringify(l);

/** Width and height of a house in world px, from its footprint and storeys. */
export function houseSize(h: HouseSpec): { w: number; h: number } {
  const w = h.footprint === "narrow" ? 180 : h.footprint === "wide" ? 210 : 232;
  return { w, h: h.storeys === 2 ? 168 : 136 };
}
