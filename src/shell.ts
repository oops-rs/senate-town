// The dev shell: a shell in the same page as the scene, for development and
// demos with no Senate at all. It plays the shell's side of the scene host
// contract over a MessageChannel: answers `ready`, sends status and the
// browser's environment, keeps a small in-memory store, and replays observe
// data from a recording in the observe recording format (NDJSON: a header,
// then rows `{offset_ms, type: "snapshot" | "frame" | "discontinuity" |
// "end", data?}`). Links are only announced (an `senate-open` DOM event),
// never followed.
import type { Binding, Environment } from "./host.ts";
import { HOST_VERSION } from "./host.ts";
import type { Frame, ObserveState } from "./observe.ts";

export interface RecordingHeader { format: "senate-observe-recording"; version: 1; capabilities: string[] }
export type Row =
  | { offset_ms: number; type: "snapshot"; data: ObserveState }
  | { offset_ms: number; type: "frame"; data: Frame }
  | { offset_ms: number; type: "discontinuity" }
  | { offset_ms: number; type: "end" };

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
  if (!header || rows[0]?.type !== "snapshot") throw new Error("recording: no snapshot");
  return { header, rows };
}

export interface DevShellOptions {
  /** Where to fetch the recording (same origin). */
  recording: () => Promise<string>;
  loop?: boolean;
  /** Pause between the end and the next play when the recording has no end mark. */
  pause?: number;
  overrides?: Partial<Pick<Environment, "color_scheme" | "reduced_motion">>;
}

/** A local binding: the scene gets one end of a channel, this shell holds the other. */
export function devShell(opts: DevShellOptions): Binding {
  const channel = new MessageChannel();
  const port = channel.port2;
  const timers: number[] = [];
  const store = new Map<string, string>();
  const say = (type: string, data?: unknown, request_id?: string) =>
    port.postMessage({ host_version: HOST_VERSION, type, ...(request_id ? { request_id } : {}), ...(data === undefined ? {} : { data }) });
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
    const { rows } = parseRecording(await opts.recording());
    const round = () => {
      let last = 0;
      for (const row of rows) {
        last = Math.max(last, row.offset_ms);
        timers.push(window.setTimeout(() => {
          if (row.type === "snapshot") say("observe.snapshot", { snapshot: row.data });
          else if (row.type === "frame") say("observe.event", { frame: row.data });
        }, row.offset_ms));
      }
      const end = rows.find((r) => r.type === "end");
      if (opts.loop !== false) timers.push(window.setTimeout(round, end ? end.offset_ms : last + (opts.pause ?? 16_000)));
    };
    say("status", { state: "ready" });
    round();
  };

  port.onmessage = (e) => {
    const m = e.data as { host_version?: number; type?: string; request_id?: string; data?: Record<string, unknown> };
    if (m?.host_version !== HOST_VERSION) return;
    const d = m.data ?? {};
    switch (m.type) {
      case "ready":
        result(m.request_id, { ok: true, value: { version: 1, capabilities: [] } });
        sendEnvironment();
        for (const q of ["(prefers-color-scheme: dark)", "(prefers-reduced-motion: reduce)"]) window.matchMedia(q).addEventListener("change", sendEnvironment);
        window.addEventListener("resize", sendEnvironment);
        document.addEventListener("visibilitychange", sendEnvironment);
        void play().catch(() => say("status", { state: "data_unavailable" }));
        break;
      case "open":
        window.dispatchEvent(new CustomEvent("senate-open", { detail: String(d.url ?? "") }));
        result(m.request_id, { ok: true });
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
      default:
        if (m.request_id) result(m.request_id, { ok: false, code: "unsupported" });
    }
  };
  port.start();
  return { name: "local", port: channel.port1 as unknown as Binding["port"] };
}
