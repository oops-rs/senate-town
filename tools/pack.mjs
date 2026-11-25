// Packs dist/ into a validated `.senatescene` archive matching the Senate
// macOS app's bundle & archive rules (docs/scenes.md, SceneBundle.swift).
import { execFileSync } from "node:child_process";
import { lstatSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const ALLOWED_EXT = new Set([
  "html", "js", "mjs", "css", "json", "ndjson", "txt", "md",
  "png", "jpg", "jpeg", "gif", "webp", "woff2",
]);
const PLAIN_NAMES = new Set(["LICENSE", "NOTICE", "COPYING", "AUTHORS"]);
const SEGMENT_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
const MAX_FILE = 8 * 1024 * 1024;
const MAX_TOTAL = 64 * 1024 * 1024;
const MAX_FILES = 2000;

function allowedPath(rel) {
  const parts = rel.split("/");
  if (parts.length < 1 || parts.length > 16) return false;
  if (!parts.every((s) => s.length >= 1 && s.length <= 128 && SEGMENT_RE.test(s))) return false;
  const base = parts[parts.length - 1];
  if (PLAIN_NAMES.has(base)) return true;
  const ext = extname(base).slice(1).toLowerCase();
  return ext.length > 0 && ALLOWED_EXT.has(ext);
}

function scan(dir, prefix = "", depth = 0, out = []) {
  if (depth >= 16) throw new Error(`path too deep: ${prefix}`);
  for (const name of readdirSync(dir).sort()) {
    if (name === ".DS_Store" || (depth === 0 && name === "__MACOSX")) continue;
    const rel = prefix ? `${prefix}/${name}` : name;
    const full = join(dir, name);
    const st = lstatSync(full);
    if (st.isSymbolicLink()) throw new Error(`symlink disallowed: ${rel}`);
    if (st.isDirectory()) {
      if (!SEGMENT_RE.test(name)) throw new Error(`bad directory name: ${rel}`);
      scan(full, rel, depth + 1, out);
    } else if (st.isFile()) {
      if (st.nlink !== 1) throw new Error(`hard link disallowed: ${rel}`);
      if (!allowedPath(rel)) throw new Error(`disallowed file name or type: ${rel}`);
      if (st.size > MAX_FILE) throw new Error(`file exceeds 8 MiB: ${rel}`);
      out.push({ path: rel, size: st.size });
    } else {
      throw new Error(`special file disallowed: ${rel}`);
    }
  }
  return out;
}

/** Verify the zip's central directory matches SceneArchive.entries (no zip64, no encryption, no symlinks). */
function verifyArchive(buf) {
  if (buf.length > MAX_TOTAL || buf.length < 22) throw new Error("archive size out of bounds");
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("zip EOCD missing");
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new Error("zip64 disallowed");
  let at = cdOffset;
  let total = 0;
  for (let k = 0; k < count; k++) {
    if (at + 46 > eocd || buf.readUInt32LE(at) !== 0x02014b50) throw new Error("corrupt central directory");
    const madeBy = buf.readUInt16LE(at + 4) >> 8;
    const flags = buf.readUInt16LE(at + 8);
    const compressed = buf.readUInt32LE(at + 20);
    const size = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const external = buf.readUInt32LE(at + 38);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString("utf8");
    at += 46 + nameLen + extraLen + commentLen;
    if (flags & 1) throw new Error(`encrypted entry: ${name}`);
    if (compressed === 0xffffffff || size === 0xffffffff) throw new Error(`zip64 entry: ${name}`);
    if (madeBy === 3 && ((external >>> 16) & 0xf000) === 0xa000) throw new Error(`symlink entry: ${name}`);
    if (!name.endsWith("/") && !allowedPath(name)) throw new Error(`disallowed archive entry: ${name}`);
    total += size;
    if (total > MAX_TOTAL) throw new Error("archive unpacked size exceeds 64 MiB");
  }
}

const root = resolve(new URL("..", import.meta.url).pathname);
const dist = resolve(root, process.argv[2] ?? "dist");
const out = resolve(root, process.argv[3] ?? "town.senatescene");

const files = scan(dist);
if (files.length > MAX_FILES) throw new Error("too many files in bundle");
const total = files.reduce((n, f) => n + f.size, 0);
if (total > MAX_TOTAL) throw new Error("bundle exceeds 64 MiB");
if (!files.some((f) => f.path === "manifest.json")) throw new Error("manifest.json missing at bundle root");
const manifest = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
if (!files.some((f) => f.path === manifest.entry)) throw new Error(`manifest entry missing: ${manifest.entry}`);

rmSync(out, { force: true });
execFileSync("/usr/bin/zip", ["-r", "-X", "-q", out, ...files.map((f) => f.path)], { cwd: dist });
verifyArchive(readFileSync(out));
console.log(`${out}: ${(statSync(out).size / 1024).toFixed(0)} KB (${files.length} files)`);
