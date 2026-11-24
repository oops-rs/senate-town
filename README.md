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
npm test             # vitest: model, director, hub layout, generation, observe, feed, host, recordings
npm run check        # tsc --noEmit
npm run build        # dist/: manifest.json, index.html, town.js, town.css, assets/, recordings/, NOTICE.md, LICENSE
npm run serve        # http://127.0.0.1:8765/
npm run record       # rewrite recordings/demo.ndjson and demo-large.ndjson (observe recordings) from the scripted day
npm run map          # assets/works.tmj (open it in Tiled)
npm run tiles        # assets/ground.png
```

## Content and shell

Town is content: a self-contained bundle (`manifest.json`, `index.html`,
`town.js`, assets) with no network and no knowledge of which shell runs it.
It talks to its shell only through `src/host.ts`, the scene host contract
of docs/observe.md: one ordered channel of JSON messages
`{host_version: 1, type, request_id?, data}`.

- in: `status`, `environment` (colour scheme, reduced motion, locale, time
  zone, visibility, viewport), `observe.snapshot`, `observe.event` (the
  public observe state and frames), `result`
- out: `ready`, `open {url}` (the row's `senate://open/v1/…` link,
  unchanged), `storage.get/set/delete`, `card.write`, `error`

Three bindings of that channel, chosen in `src/main.ts`:

| Binding | Shell |
| --- | --- |
| `webkit` | the Senate app's web view (`scene` handler in, `__senateScene(message)` out); the only place `webkit` appears |
| `port` | a parent page handing over a MessagePort (the browser reference shell, an Android WebMessagePort) |
| `local` | the dev shell (`src/shell.ts`) in the same page: replays an observe recording, `recordings/demo.ndjson` (`?demo=large` for 30 committees, `?recording=<file>` for another) |

`src/observe.ts` maps the public state to what the scene draws; `src/feed.ts`
applies patches and joins a filed message with its hold. `src/encode.ts`
writes the scripted day (`src/script.ts`) as an observe recording
(`npm run record`); it is for development and never bundled.

Browser flags: `demo=large`, `recording=<file>`, `once`, `time=day|dusk|night`,
`dark=1|0`, `reduce-motion`, `enter=<committee>` (start inside a house),
`stats`.

## In the app

`apps/macos/scripts/sync-town.sh` builds this package and copies `dist/`
into `apps/macos/Senate/Web/town/`, which is committed so Xcode never needs
Node. `SENATE_APP_TOWN_WEB=1` shows the page in the Town tab, the app being
its shell; `SENATE_APP_TOWN_DEMO=1` (or `large`) loads it with `?demo=…`
so its own dev shell plays the demo instead.

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
| `src/host.ts`, `src/shell.ts` | the scene host contract and the dev shell |
| `src/observe.ts`, `src/feed.ts` | the observe data, as the town reads it |
| `src/encode.ts` | the scripted day as observe data (development only) |
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
