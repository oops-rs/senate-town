// Writes assets/works.tmj, the Works' ground as a Tiled map (open it in
// Tiled to look or edit): grass, a paved plaza round the hub, and trees as
// an object layer. Buildings are placed by src/hub.ts at run time (their
// number changes); the scene leaves out any tree a building would cover.
// The map's `hubX`/`hubY` properties say where the hub (0, 0) is, in px.
import { writeFileSync } from "node:fs";
import { bounds, plan } from "../src/hub.ts";
import { seeded } from "../src/model.ts";

const T = 32;
const big = plan(Array.from({ length: 30 }, (_, i) => `committee-${i}`));
const b = bounds(big);
const margin = 6 * T;
const W = Math.ceil((b.w + 2 * margin) / T), H = Math.ceil((b.h + 2 * margin) / T);
const hubX = Math.round(-b.x + margin), hubY = Math.round(-b.y + margin);
const rnd = seeded("works-map");
const gid = (i) => i + 1;
const ground = [];
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const px = x * T + T / 2 - hubX, py = y * T + T / 2 - hubY;
    const d = Math.hypot(px, py);
    const r = rnd();
    ground.push(gid(r < 0.02 ? 2 : r < 0.35 ? 1 : 0));
    void d;
  }
}
const trees = [];
let id = 1;
for (let i = 0; i < 900 && trees.length < 160; i++) {
  const x = rnd() * W * T, y = rnd() * H * T;
  const px = x - hubX, py = y - hubY;
  if (Math.hypot(px, py) < 470) continue;
  if ([...big.slots.values()].some((s) => Math.hypot(s.at.x - px, s.at.y - py) < 150)) continue;
  trees.push({ id: id++, name: "tree", type: "tree", x: Math.round(x), y: Math.round(y), width: 0, height: 0, point: true, rotation: 0, visible: true });
}
const map = {
  type: "map", version: "1.10", tiledversion: "1.10.2", orientation: "orthogonal", renderorder: "right-down",
  width: W, height: H, tilewidth: T, tileheight: T, infinite: false, nextlayerid: 3, nextobjectid: id,
  properties: [{ name: "hubX", type: "int", value: hubX }, { name: "hubY", type: "int", value: hubY }],
  tilesets: [{ firstgid: 1, name: "ground", image: "ground.png", imagewidth: 8 * T, imageheight: T, tilewidth: T, tileheight: T, columns: 8, tilecount: 8, margin: 0, spacing: 0 }],
  layers: [
    { id: 1, name: "ground", type: "tilelayer", width: W, height: H, x: 0, y: 0, opacity: 1, visible: true, data: ground },
    { id: 2, name: "trees", type: "objectgroup", draworder: "topdown", x: 0, y: 0, opacity: 1, visible: true, objects: trees },
  ],
};
writeFileSync(new URL("../assets/works.tmj", import.meta.url), JSON.stringify(map));
console.log(`assets/works.tmj: ${W}×${H} tiles of ${T}, hub at ${hubX},${hubY}, ${trees.length} trees`);
