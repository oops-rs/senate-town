// Writes recordings/demo.ndjson and recordings/demo-large.ndjson: the
// scripted day as an observe recording (header, snapshot, timed frames, end
// mark), which the dev shell replays through the same path a live Senate
// takes. Like native recordings, demo files have no app links.
import { writeFileSync, rmSync } from "node:fs";
import { recording } from "../src/encode.ts";
import * as script from "../src/script.ts";

for (const f of ["demo.json", "demo-large.json"]) rmSync(new URL(`../recordings/${f}`, import.meta.url), { force: true });
for (const [file, snap, steps] of [["demo.ndjson", script.quiet, script.busy], ["demo-large.ndjson", script.large(), script.largeBusy()]]) {
  const { header, rows } = recording(snap, steps);
  const withoutLinks = (key, value) => {
    if (key === "link" && typeof value === "string" && value.startsWith("senate://")) return null;
    if (key === "navigation") return undefined;
    if (key === "capabilities" && Array.isArray(value)) return value.filter((capability) => capability !== "app_links");
    return value;
  };
  const text = [header, ...rows].map((row) => JSON.stringify(row, withoutLinks)).join("\n") + "\n";
  writeFileSync(new URL(`../recordings/${file}`, import.meta.url), text);
  console.log(`recordings/${file}`);
}
