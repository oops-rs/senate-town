// The dev shell: a shell that runs in the same page as the scene, for
// development and demos with no Senate at all. It plays the shell's side of
// the scene host contract: environment from the browser, a small in-memory
// store, and observe data replayed from a recording in the observe
// recording format (NDJSON: a header, a snapshot, then timed frames or
// replacement snapshots, then an end mark). Links are only announced (an
// `open` DOM event), never followed.
import type { Binding, Environment, Message } from "./host.ts";
import { HOST_VERSION } from "./host.ts";
import type { Frame, ObserveState } from "./observe.ts";

export interface RecordingHeader { format: "senate-observe-recording"; version: 1; capabilities: string[] }
export type Row =
  | { snapshot: ObserveState; offset_ms?: number }
  | { offset_ms: number; frame: Frame }
  | { offset_ms: number; end: true };

/** Parse an observe recording; a truncated last line (no end mark) is dropped. */
export function parseRecording(text: string): { header: RecordingHeader; rows: Row[] } {
  const lines = text.split("\n").filter((l) => l.trim());
  const rows: Row[] = [];
  let header: RecordingHeader | undefined;
  for (const [i, line] of lines.entries()) {
    let v: unknown;
    try { v = JSON.parse(line); } catch { if (i === lines.length - 1) break; throw new Error(`recording: bad line ${i + 1}`); }
    if (i === 0) {
      header = v as RecordingHeader;
      if (header.format !== "senate-observe-recording" || header.version !== 1) throw new Error("recording: not an observe recording v1");
    } else rows.push(v as Row);
  }
  const head = rows[0];
  if (!header || !head || !("snapshot" in head)) throw new Error("recording: no snapshot");
  return { header, rows };
}

export interface DevShellOptions {
  /** The recording's text, or where to fetch it (same origin). */
  recording: string | (() => Promise<string>);
  loop?: boolean;
  /** Pause between the end and the next play. */
  pause?: number;
  overrides?: Partial<Pick<Environment, "color_scheme" | "reduced_motion">>;
}

/** A local binding wired to an in-page shell. */
export function devShell(opts: DevShellOptions): Binding {
  let toScene: ((m: Message) => void) | undefined;
  const timers: number[] = [];
  const store = new Map<string, string>();
  const say = (type: string, data?: unknown, request_id?: string) =>
    queueMicrotask(() => toScene?.({ host_version: HOST_VERSION, type, ...(request_id ? { request_id } : {}), data }));
  const result = (id: string | undefined, r: { ok: boolean; value?: unknown; code?: string }) => say("result", r, id);

  const media = (q: string) => window.matchMedia(q).matches;
  const environment = (): Environment => ({
    color_scheme: opts.overrides?.color_scheme ?? (media("(prefers-color-scheme: dark)") ? "dark" : "light"),
    reduced_motion: opts.overrides?.reduced_motion ?? media("(prefers-reduced-motion: reduce)"),
    locale: navigator.language,
    time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    visible: document.visibilityState === "visible",
    viewport: { width: window.innerWidth, height: window.innerHeight },
    safe_area: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  const sendEnvironment = () => say("environment", environment());

  const play = async () => {
    const text = typeof opts.recording === "string" ? opts.recording : await opts.recording();
    const { rows } = parseRecording(text);
    const round = () => {
      let last = 0;
      for (const row of rows) {
        const at = row.offset_ms ?? 0;
        last = Math.max(last, at);
        timers.push(window.setTimeout(() => {
          if ("snapshot" in row) say("observe.snapshot", { snapshot: row.snapshot });
          else if ("frame" in row) say("observe.event", { frame: row.frame });
        }, at));
      }
      const end = rows.find((r) => "end" in r);
      if (opts.loop !== false) timers.push(window.setTimeout(round, end ? end.offset_ms! : last + (opts.pause ?? 16_000)));
    };
    say("status", { state: "ready" });
    round();
  };

  const receive = (m: Message) => {
    if (m.host_version !== HOST_VERSION) return;
    const d = (m.data ?? {}) as Record<string, unknown>;
    switch (m.type) {
      case "ready":
        sendEnvironment();
        for (const q of ["(prefers-color-scheme: dark)", "(prefers-reduced-motion: reduce)"]) window.matchMedia(q).addEventListener("change", sendEnvironment);
        window.addEventListener("resize", sendEnvironment);
        document.addEventListener("visibilitychange", sendEnvironment);
        void play().catch(() => say("status", { state: "data_unavailable" }));
        break;
      case "open":
        window.dispatchEvent(new CustomEvent("senate-open", { detail: String(d.url ?? "") }));
        break;
      case "storage.get": {
        const v = store.get(String(d.key));
        result(m.request_id, { ok: true, value: v === undefined ? null : JSON.parse(v) });
        break;
      }
      case "storage.set": {
        const v = JSON.stringify(d.value ?? null);
        const total = [...store].reduce((n, [k, x]) => n + (k === d.key ? 0 : x.length), 0) + v.length;
        if (v.length > 16 * 1024 || total > 64 * 1024) result(m.request_id, { ok: false, code: "quota" });
        else { store.set(String(d.key), v); result(m.request_id, { ok: true }); }
        break;
      }
      case "storage.delete":
        store.delete(String(d.key));
        result(m.request_id, { ok: true });
        break;
      case "card.write":
        result(m.request_id, { ok: false, code: "unsupported" });
        break;
      default:
        if (m.request_id) result(m.request_id, { ok: false, code: "unsupported" });
    }
  };

  return {
    name: "local",
    send: (m) => queueMicrotask(() => receive(m)),
    listen: (r) => { toScene = r; },
  };
}
