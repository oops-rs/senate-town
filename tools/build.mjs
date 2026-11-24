// Builds the page into dist/: town.js (Phaser and the town, one minified
// file), index.html, town.css, the assets and recordings, and the NOTICE.
// Everything the page needs is local; nothing comes from a CDN. A host
// (the Senate app: apps/macos/scripts/sync-town.sh) copies dist/ as is.
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync, statSync } from "node:fs";

const out = new URL(process.argv[2] ? `file://${process.argv[2].replace(/\/?$/, "/")}` : "../dist/", import.meta.url);
rmSync(out, { recursive: true, force: true });
mkdirSync(new URL("assets/", out), { recursive: true });
await build({
  entryPoints: [new URL("../src/main.ts", import.meta.url).pathname],
  bundle: true, minify: true, format: "iife", target: ["safari16"],
  outfile: new URL("town.js", out).pathname, legalComments: "eof",
  define: { CANVAS_RENDERER: "true", WEBGL_RENDERER: "true", WEBGL_DEBUG: "false", EXPERIMENTAL: "false",
            PLUGIN_3D: "false", PLUGIN_CAMERA3D: "false", PLUGIN_FBINSTANT: "false", FEATURE_SOUND: "false" },
});
for (const f of ["index.html", "town.css"]) cpSync(new URL(`../page/${f}`, import.meta.url), new URL(f, out));
for (const f of ["works.tmj", "ground.png"])
  cpSync(new URL(`../assets/${f}`, import.meta.url), new URL(`assets/${f}`, out));
cpSync(new URL("../NOTICE.md", import.meta.url), new URL("NOTICE.md", out));
cpSync(new URL("../LICENSE", import.meta.url), new URL("LICENSE", out));
cpSync(new URL("../manifest.json", import.meta.url), new URL("manifest.json", out));
cpSync(new URL("../recordings/", import.meta.url), new URL("recordings/", out), { recursive: true });
const kb = (f) => (statSync(new URL(f, out)).size / 1024).toFixed(0);
console.log(`${out.pathname}: town.js ${kb("town.js")} KB, map ${kb("assets/works.tmj")} KB`);
