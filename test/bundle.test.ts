import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { parseRecording } from "../src/shell.ts";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const ALLOWED_EXT = new Set([
  "html", "js", "mjs", "css", "json", "ndjson", "txt", "md",
  "png", "jpg", "jpeg", "gif", "webp", "woff2",
]);
const PLAIN_NAMES = new Set(["LICENSE", "NOTICE", "COPYING", "AUTHORS"]);
const SEGMENT_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
const VERSION_RE = /^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})(-[0-9A-Za-z.-]{1,32})?$/;
const CAPABILITY_RE = /^[a-z][a-z0-9_]{0,47}$/;
const SCHEMA_RE = /^[a-z][a-z0-9-]{0,31}(\.[a-z][a-z0-9-]{0,31}){0,3}\/v[1-9][0-9]{0,2}$/;

describe("recordings privacy", () => {
  const dir = join(ROOT, "recordings");
  const files = readdirSync(dir).filter((f) => f.endsWith(".ndjson")).sort();

  test("bundled recordings exist and carry no senate:// links or app_links capability", () => {
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(join(dir, file), "utf8");
      expect(text, `${file} must not contain senate:// URLs`).not.toContain("senate://");
      expect(text, `${file} must not contain "app_links"`).not.toContain('"app_links"');
      const { header } = parseRecording(text);
      expect(header.capabilities).not.toContain("app_links");
    }
  });
});

describe("scene bundle manifest (docs/scenes.md)", () => {
  test("manifest.json satisfies the strict scene host contract", () => {
    const raw = readFileSync(join(ROOT, "manifest.json"));
    expect(raw.byteLength).toBeLessThanOrEqual(16 * 1024);
    const m = JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>;
    expect(Object.keys(m).sort()).toEqual(["cards", "entry", "min_host_version", "name", "observe", "version"]);
    expect(typeof m.name).toBe("string");
    expect((m.name as string).length).toBeGreaterThanOrEqual(1);
    expect((m.name as string).length).toBeLessThanOrEqual(64);
    expect(m.version).toMatch(VERSION_RE);
    expect(typeof m.entry).toBe("string");
    expect((m.entry as string).endsWith(".html")).toBe(true);
    expect((m.entry as string).split("/").every((s) => SEGMENT_RE.test(s))).toBe(true);
    expect(m.min_host_version).toBe(1);

    const observe = m.observe as Record<string, unknown>;
    expect(Object.keys(observe).sort()).toEqual(["major", "optional", "required"]);
    expect(observe.major).toBe(1);
    const req = observe.required as string[];
    const opt = observe.optional as string[];
    for (const c of [...req, ...opt]) expect(c).toMatch(CAPABILITY_RE);
    expect(new Set(req).size).toBe(req.length);
    expect(new Set(opt).size).toBe(opt.length);
    expect(req.some((c) => opt.includes(c))).toBe(false);

    const cards = m.cards as Record<string, unknown>;
    expect(Object.keys(cards).sort()).toEqual(["reads", "writes"]);
    for (const s of [...(cards.reads as string[]), ...(cards.writes as string[])]) expect(s).toMatch(SCHEMA_RE);
  });

  test("dist/ (when built) contains only allowed regular files within bundle limits", () => {
    const dist = join(ROOT, "dist");
    let exists = false;
    try { exists = lstatSync(dist).isDirectory(); } catch { exists = false; }
    if (!exists) return;

    const files: { path: string; size: number }[] = [];
    const walk = (dir: string, prefix: string, depth: number) => {
      expect(depth).toBeLessThan(16);
      for (const name of readdirSync(dir).sort()) {
        if (name === ".DS_Store" || (depth === 0 && name === "__MACOSX")) continue;
        expect(name).toMatch(SEGMENT_RE);
        const rel = prefix ? `${prefix}/${name}` : name;
        const st = lstatSync(join(dir, name));
        expect(st.isSymbolicLink()).toBe(false);
        if (st.isDirectory()) walk(join(dir, name), rel, depth + 1);
        else {
          expect(st.isFile()).toBe(true);
          expect(st.nlink).toBe(1);
          const ext = extname(name).slice(1).toLowerCase();
          expect(PLAIN_NAMES.has(name) || ALLOWED_EXT.has(ext), `disallowed file: ${rel}`).toBe(true);
          expect(st.size).toBeLessThanOrEqual(8 * 1024 * 1024);
          files.push({ path: rel, size: st.size });
        }
      }
    };
    walk(dist, "", 0);
    expect(files.length).toBeLessThanOrEqual(2000);
    expect(files.reduce((n, f) => n + f.size, 0)).toBeLessThanOrEqual(64 * 1024 * 1024);
    expect(files.some((f) => f.path === "manifest.json")).toBe(true);
    const m = JSON.parse(new TextDecoder().decode(readFileSync(join(dist, "manifest.json")))) as { entry: string };
    expect(files.some((f) => f.path === m.entry)).toBe(true);
  });

  test("town.senatescene (when packed) uses only STORED (method 0) entries with valid CRC-32", () => {
    const archivePath = join(ROOT, "town.senatescene");
    let exists = false;
    try { exists = lstatSync(archivePath).isFile(); } catch { exists = false; }
    if (!exists) return;

    const b = readFileSync(archivePath);
    const u16 = (i: number) => b[i]! | (b[i + 1]! << 8);
    const u32 = (i: number) => (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;
    const crc32 = (data: Uint8Array) => {
      let crc = 0xffffffff;
      for (let i = 0; i < data.length; i++) {
        crc ^= data[i]!;
        for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
      }
      return (~crc) >>> 0;
    };

    let eocd = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
      if (u32(i) === 0x06054b50) { eocd = i; break; }
    }
    expect(eocd).toBeGreaterThanOrEqual(0);
    const count = u16(eocd + 10);
    const cdOffset = u32(eocd + 16);
    expect(count).toBeGreaterThan(0);

    let at = cdOffset;
    const names: string[] = [];
    for (let k = 0; k < count; k++) {
      expect(u32(at)).toBe(0x02014b50);
      const flags = u16(at + 8);
      const method = u16(at + 10);
      const crc = u32(at + 16);
      const compressed = u32(at + 20);
      const size = u32(at + 24);
      const nameLen = u16(at + 28);
      const extraLen = u16(at + 30);
      const commentLen = u16(at + 32);
      const localOffset = u32(at + 42);
      const name = new TextDecoder().decode(b.subarray(at + 46, at + 46 + nameLen));
      at += 46 + nameLen + extraLen + commentLen;
      names.push(name);
      expect(flags & 1).toBe(0);
      expect(method).toBe(0);
      expect(compressed).toBe(size);
      expect(u32(localOffset)).toBe(0x04034b50);
      expect(u16(localOffset + 8)).toBe(0);
      const lNameLen = u16(localOffset + 26);
      const lExtraLen = u16(localOffset + 28);
      const start = localOffset + 30 + lNameLen + lExtraLen;
      expect(crc32(b.subarray(start, start + size))).toBe(crc);
    }
    expect(names).toEqual([...names].sort());
    expect(names).toContain("manifest.json");
  });
});
