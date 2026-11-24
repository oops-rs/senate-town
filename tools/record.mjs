// Writes recordings/demo.ndjson and recordings/demo-large.ndjson: the
// scripted day as an observe recording (header, snapshot, timed frames, end
// mark), which the dev shell replays through the same path a live Senate
// takes. Links are kept (they are the demo's own, not a live Senate's).
import { writeFileSync, rmSync } from "node:fs";
import { ndjson, recording } from "../src/encode.ts";
import * as script from "../src/script.ts";

for (const f of ["demo.json", "demo-large.json"]) rmSync(new URL(`../recordings/${f}`, import.meta.url), { force: true });
for (const [file, snap, steps] of [["demo.ndjson", script.quiet, script.busy], ["demo-large.ndjson", script.large(), script.largeBusy()]]) {
  writeFileSync(new URL(`../recordings/${file}`, import.meta.url), ndjson(recording(snap, steps)));
  console.log(`recordings/${file}`);
}
