# Town

A Senate's live activity as a little town of workshops, tubes and
townspeople: a [Phaser 4](https://phaser.io) (MIT) page, TypeScript bundled
with esbuild, a [Tiled](https://www.mapeditor.org) ground map, and our own
generated art (see `NOTICE.md`). It runs in a plain browser and inside the
Senate app's web view.

Town is its own package. It imports nothing from the app or the Rust
crates, builds and tests on its own, and can be split out with
`git subtree split --prefix town`. The app consumes only the built page.

```sh
npm ci
npm test             # vitest: model, director, hub layout, generation, sources
npm run check        # tsc --noEmit
npm run build        # dist/: index.html, town.js, town.css, assets/, recordings/, NOTICE.md, LICENSE
npm run serve        # http://127.0.0.1:8765/
npm run record       # rewrite recordings/demo.json and demo-large.json from the scripted town
npm run map          # assets/works.tmj (open it in Tiled)
npm run tiles        # assets/ground.png
```

## Data sources

The page draws whatever a source feeds it (`src/source.ts`): a full
`TownState` (snapshot) and `TownEvent`s as they happen.

| Source | Where | |
| --- | --- | --- |
| `ScriptedSource` | browser default, app demo | the scripted town in `src/script.ts`: 5 or 30 committees, messages, a held delivery, tools, a signed approval, a release, a new committee being built |
| `RecordedSource` | `?source=recorded&file=recordings/demo.json` | replays a recording (`{version: 1, snapshot, steps: [{at, state?, events?, entries?}], loop?}`) |
| `BridgeSource` | the app, for now | Swift pushes state and activity through `window.town` |
| observe client | next | the Senate's observe API (snapshot + events + cards + deep links), replacing the bridge |

Browser flags: `large` (30 committees), `once`, `now`, `time=day|dusk|night|HH`,
`dark=1|0`, `reduce-motion`, `enter=<committee>` (start inside a house),
`stats`.

## In the app

`apps/macos/scripts/sync-town.sh` builds this package and copies `dist/`
into `apps/macos/Senate/Web/town/`, which is committed so Xcode never needs
Node. `SENATE_APP_TOWN_WEB=1` shows the page in the Town tab;
`SENATE_APP_TOWN_DEMO=1` (or `large`) plays the scripted town there instead
of live data. The page sends back `ready`, `open`, `room` and `error`;
every click goes through one function, `openAction` in `src/main.ts`.

## Where things live

| | |
| --- | --- |
| `src/model.ts` | `TownState`, `TownEvent`, the state diff, activity entries → events, the FNV hash and seeded random |
| `src/director.ts` | events → actions: at most 6 walkers, a queue of 12, up to 8 tool workers, guests |
| `src/hub.ts` | the hub-and-ring layout: fixed ring slots, the civic wedge, tubes, signals, stable slots as committees come and go |
| `src/gen.ts` | seeded houses and characters (no two alike), strict reading of house and character cards |
| `src/art.ts` | every texture, drawn in code |
| `src/works.ts` | the `Works` scene: houses, tubes, capsules, sorting hall, archive, signals, gates, workers, civilians, construction, elders, monuments, time of day |
| `src/room.ts` | the `Room` scene: inside a house, the senators at their desks |
| `src/source.ts` | the data sources above |
| `src/script.ts` | the scripted town |
| `src/main.ts` | the page: `window.town`, the hover card, `openAction`, flags |
| `CARDS.md` | the card spec (houses and characters as opaque cards) |
| `PROJECT_HISTORY.md` | the ProjectHistory spec (elders, monuments) |
| `NOTICE.md` | every asset, its source and licence |

## Why Phaser (and not PixiJS or Godot)

| | Phaser | PixiJS 8 (+ @pixi/tilemap, pixi-viewport) | Godot 4 (web export / libgodot) |
| --- | --- | --- | --- |
| What it is | a 2D game framework (Phaser 4: WebGL first, Canvas fallback): scenes, cameras, tweens, input, tilemaps, particles, loader | a 2D renderer; the rest from plugins or by hand | a full engine and editor |
| Community | 40.8k GitHub stars, ~770k npm downloads a week; large example and plugin set | 48.9k stars, ~2.0M downloads a week (much of it non-game) | 120.7k stars; web is a secondary target |
| Tiled / isometric | Tiled JSON loaded natively: orthogonal, isometric, staggered, hexagonal layers and object layers | no Tiled loader in core; @pixi/tilemap (~12k downloads a week) renders tiles, parsing and iso are yours | its own TileMap editor (iso included); Tiled via an import plugin |
| Bundle | town.js here: 1,385 KB minified, 378 KB gzip with Phaser 4.2.1 (1,209 / 338 with 3.90) | ~600–700 KB minified for pixi.js alone, plus the plugins and the game code we would write | ~35–40 MB wasm + pack uncompressed; threads need cross-origin isolation (SharedArrayBuffer), a single-threaded export since 4.3 |
| In WKWebView | one script and a canvas (WebGL, canvas fallback), served from our own scheme under a strict CSP; works unchanged in a browser and on iOS | the same | a large wasm module and worker setup to serve from a custom scheme; libgodot embedding is a native engine in the app, not a web page |
| Accessibility | canvas: none built in; we keep the native List view and DOM hover cards | the same; Pixi has an accessibility plugin (DOM shadows for interactive objects) | AccessKit screen-reader support on desktop; the web export has none |
| Licence | MIT | MIT (plugins MIT) | MIT |

Phaser is the pick: it has the most of what the Town needs out of the box
(Tiled maps with isometric support for draft B, cameras, tweens, input,
particles), the largest game-specific community and examples, one
dependency instead of a renderer plus plugins, and it embeds like any web
page. Pixi is a fine renderer but we would rebuild the game layer that
Phaser already has. Godot is the strongest engine but its web build is two
orders of magnitude bigger, needs threads/isolation or a degraded build,
and moves the town into an editor and language the rest of the app does
not use.

The page is on Phaser 4.2.1 (moved from 3.90): the town's code needed no
change (types, scenes, tilemaps, tweens, input, blend modes, generated
textures all carried over); the bundle grew by 176 KB minified (40 KB gzip);
the esbuild defines for the Canvas renderer and plugins are gone (4 reads
only `WEBGL_RENDERER`/`WEBGL_DEBUG`).
