// Packs dist/ into a deterministic STORED (uncompressed) `.senatescene` zip
// matching Senate's `crates/senate-scene` format (sorted entries, method 0,
// local + central header agreement, IEEE CRC-32, fixed timestamps & modes).
import { lstatSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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

export function crc32(data) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let b = 0; b < 8; b++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (~crc) >>> 0;
}

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
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}

/** Write a deterministic STORED zip archive matching crates/senate-scene/src/archive.rs. */
export function buildStoredZip(root, files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const data = readFileSync(join(root, file.path));
    const name = Buffer.from(file.path, "utf8");
    const size = data.length >>> 0;
    const crc = crc32(data);

    // Local file header (30 bytes + name + data): version 2.0, flags 0, STORED (0), 1980-01-01.
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0x0021, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(size, 18);
    lh.writeUInt32LE(size, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    localParts.push(lh, name, data);

    // Central directory header (46 bytes + name): Unix 2.0, mode 0o100644, STORED (0).
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(0x0314, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0x0021, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(size, 20);
    ch.writeUInt32LE(size, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    ch.writeUInt32LE(offset >>> 0, 42);
    centralParts.push(ch, name);

    offset += 30 + name.length + size;
  }

  const central = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(central.length >>> 0, 12);
  eocd.writeUInt32LE(offset >>> 0, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, central, eocd]);
}

/** Verify central directory, local headers, STORED method (0), and CRC-32 for every entry. */
export function verifyArchive(buf) {
  if (buf.length > MAX_TOTAL + 1024 * 1024 || buf.length < 22) throw new Error("archive size out of bounds");
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("zip EOCD missing");
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new Error("zip64 disallowed");
  if (cdOffset + cdSize > eocd) throw new Error("corrupt central directory bounds");
  let at = cdOffset;
  let total = 0;
  for (let k = 0; k < count; k++) {
    if (at + 46 > eocd || buf.readUInt32LE(at) !== 0x02014b50) throw new Error("corrupt central directory");
    const madeBy = buf.readUInt16LE(at + 4) >> 8;
    const flags = buf.readUInt16LE(at + 8);
    const method = buf.readUInt16LE(at + 10);
    const crc = buf.readUInt32LE(at + 16);
    const compressed = buf.readUInt32LE(at + 20);
    const size = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const external = buf.readUInt32LE(at + 38);
    const localOffset = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString("utf8");
    at += 46 + nameLen + extraLen + commentLen;
    if (flags & 1) throw new Error(`encrypted entry: ${name}`);
    if (compressed === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) throw new Error(`zip64 entry: ${name}`);
    if (madeBy === 3 && ((external >>> 16) & 0xf000) === 0xa000) throw new Error(`symlink entry: ${name}`);
    if (!name.endsWith("/")) {
      if (!allowedPath(name)) throw new Error(`disallowed archive entry: ${name}`);
      if (method !== 0 || compressed !== size) throw new Error(`compressed entry disallowed (must be STORED): ${name}`);
      // Verify matching local file header & CRC-32.
      if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`missing local header: ${name}`);
      const lFlags = buf.readUInt16LE(localOffset + 6);
      const lMethod = buf.readUInt16LE(localOffset + 8);
      const lNameLen = buf.readUInt16LE(localOffset + 26);
      const lExtraLen = buf.readUInt16LE(localOffset + 28);
      if ((lFlags & 1) !== 0 || lMethod !== 0) throw new Error(`bad local header flags/method: ${name}`);
      const lName = buf.subarray(localOffset + 30, localOffset + 30 + lNameLen).toString("utf8");
      if (lName !== name) throw new Error(`local header name mismatch: ${name}`);
      const start = localOffset + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(start, start + size);
      if (data.length !== size || crc32(data) !== crc) throw new Error(`CRC-32 mismatch: ${name}`);
    }
    total += size;
    if (total > MAX_TOTAL) throw new Error("archive unpacked size exceeds 64 MiB");
  }
}

export function packDir(dist, out) {
  const files = scan(dist);
  if (files.length > MAX_FILES) throw new Error("too many files in bundle");
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > MAX_TOTAL) throw new Error("bundle exceeds 64 MiB");
  if (!files.some((f) => f.path === "manifest.json")) throw new Error("manifest.json missing at bundle root");
  const manifest = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
  if (!files.some((f) => f.path === manifest.entry)) throw new Error(`manifest entry missing: ${manifest.entry}`);
  const archive = buildStoredZip(dist, files);
  verifyArchive(archive);
  writeFileSync(out, archive);
  return { files, size: statSync(out).size };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = resolve(new URL("..", import.meta.url).pathname);
  const dist = resolve(root, process.argv[2] ?? "dist");
  const out = resolve(root, process.argv[3] ?? "town.senatescene");
  const { files, size } = packDir(dist, out);
  console.log(`${out}: ${(size / 1024).toFixed(0)} KB (${files.length} STORED files)`);
}
