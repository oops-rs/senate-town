// Writes recordings/demo.json and recordings/demo-large.json: the scripted
// day in the recording format the recorded source replays (and the format a
// real day would be captured in).
import { writeFileSync } from "node:fs";
import { scriptedRecording } from "../src/source.ts";

for (const [kind, file] of [["small", "demo.json"], ["large", "demo-large.json"]]) {
  writeFileSync(new URL(`../recordings/${file}`, import.meta.url), JSON.stringify(scriptedRecording(kind), null, 1));
  console.log(`recordings/${file}`);
}
