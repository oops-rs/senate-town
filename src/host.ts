// The scene host contract (docs/observe.md, "Scene host contract"), the
// scene's side. Town is content: it knows nothing of which shell runs it.
// It talks to its shell only through this module, over one ordered channel
// of JSON messages `{host_version: 1, type, request_id?, data}`.
//
// Three bindings of the same channel:
// - webkit: the macOS app's web view (a bound WK script bridge). This file
//   is the only place in Town that mentions `webkit`.
// - port: a MessagePort handed over by a parent page (the browser reference
//   shell, an Android WebMessagePort).
// - local: a shell running in the same page (the dev shell: scripted or
//   recorded replay), see shell.ts.
import type { Frame, ObserveState } from "./observe.ts";

export const HOST_VERSION = 1;

export interface Message { host_version: number; type: string; request_id?: string; data?: unknown }

export interface Environment {
  color_scheme: "light" | "dark";
  reduced_motion: boolean;
  locale: string;
  time_zone: string;
  visible: boolean;
  viewport: { width: number; height: number };
  safe_area: { top: number; right: number; bottom: number; left: number };
  /** Optional (an addition to the contract): the window is the one in front. */
  focused?: boolean;
  /** Optional (an addition to the contract): on battery or in Low Power Mode, draw less. */
  power?: "ac" | "battery" | "low_power";
}

export type Status = "ready" | "access_needed" | "data_unavailable" | "version_mismatch";

/** What the scene does with what the shell sends. */
export interface Scene {
  status(status: Status): void;
  snapshot(snapshot: ObserveState): void;
  event(frame: Frame): void;
  environment(env: Environment): void;
}

/** One ordered channel: send a message, receive messages. */
export interface Binding {
  name: "webkit" | "port" | "local";
  send(message: Message): void;
  listen(receive: (message: Message) => void): void;
}

export type Result = { ok: true; value?: unknown } | { ok: false; code: string };

/** What the scene can ask of its shell. */
export interface Host {
  readonly binding: Binding["name"];
  /** Open a senate://open link (on a user's click). */
  open(url: string): void;
  storageGet(key: string): Promise<unknown>;
  storageSet(key: string, value: unknown): Promise<Result>;
  storageDelete(key: string): Promise<Result>;
  cardWrite(schema: string, value: object | null): Promise<Result>;
  /** Lifecycle: something went wrong in the scene. */
  error(message: string): void;
}

const KEY = /^[A-Za-z0-9._~-]{1,64}$/;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The macOS app's web view: messages out through the `scene` handler, in through one bound function. */
export function webkitBinding(): Binding | undefined {
  const handler = (window as unknown as { webkit?: { messageHandlers?: { scene?: { postMessage(m: unknown): void } } } })
    .webkit?.messageHandlers?.scene;
  if (!handler) return undefined;
  let receiver: ((m: Message) => void) | undefined;
  // The shell calls `__senateScene(message)`; defined once, not writable.
  Object.defineProperty(window, "__senateScene", { value: (m: unknown) => { if (isObject(m)) receiver?.(m as unknown as Message); }, writable: false, configurable: false });
  return { name: "webkit", send: (m) => handler.postMessage(m), listen: (r) => { receiver = r; } };
}

/**
 * A port from the parent page: the first `message` from the parent window
 * carrying a port pins it; nothing else is accepted after the handshake.
 */
export function portBinding(): Promise<Binding> | undefined {
  if (window.parent === window) return undefined;
  return new Promise((resolve) => {
    const take = (e: MessageEvent) => {
      if (e.source !== window.parent || !e.ports[0]) return;
      window.removeEventListener("message", take);
      const port = e.ports[0];
      resolve({
        name: "port",
        send: (m) => port.postMessage(m),
        listen: (r) => { port.onmessage = (ev) => { if (isObject(ev.data)) r(ev.data as unknown as Message); }; },
      });
    };
    window.addEventListener("message", take);
  });
}

/** Connect the scene to its shell over a binding; says `ready` at once. */
export function connect(binding: Binding, scene: Scene): Host {
  const pending = new Map<string, (r: Result) => void>();
  let next = 0;
  const send = (type: string, data?: unknown, request_id?: string) =>
    binding.send({ host_version: HOST_VERSION, type, ...(request_id ? { request_id } : {}), ...(data === undefined ? {} : { data }) });
  const request = (type: string, data: unknown) => new Promise<Result>((resolve) => {
    const id = `r${++next}`;
    if (pending.size >= 32) return resolve({ ok: false, code: "quota" });
    pending.set(id, resolve);
    send(type, data, id);
  });

  binding.listen((m) => {
    if (m.host_version !== HOST_VERSION) return;
    const d = m.data as Record<string, unknown> | undefined;
    switch (m.type) {
      case "status": if (d && typeof d.state === "string") scene.status(d.state as Status); break;
      case "observe.snapshot": if (d && isObject(d.snapshot)) scene.snapshot(d.snapshot as unknown as ObserveState); break;
      case "observe.event": if (d && isObject(d.frame)) scene.event(d.frame as unknown as Frame); break;
      case "environment": if (d) scene.environment(d as unknown as Environment); break;
      case "result": {
        const done = m.request_id ? pending.get(m.request_id) : undefined;
        if (!done || !d) break;
        pending.delete(m.request_id!);
        done(d.ok === true ? { ok: true, value: d.value } : { ok: false, code: String(d.code ?? "unavailable") });
        break;
      }
      default: break; // unknown optional messages are ignored
    }
  });
  send("ready", { supported_host_versions: [HOST_VERSION] });

  return {
    binding: binding.name,
    open: (url) => { if (url.startsWith("senate://open/")) send("open", { url }); },
    storageGet: async (key) => {
      if (!KEY.test(key)) return undefined;
      const r = await request("storage.get", { key });
      return r.ok ? r.value : undefined;
    },
    storageSet: (key, value) => (KEY.test(key) ? request("storage.set", { key, value }) : Promise.resolve({ ok: false, code: "invalid_request" })),
    storageDelete: (key) => (KEY.test(key) ? request("storage.delete", { key }) : Promise.resolve({ ok: false, code: "invalid_request" })),
    cardWrite: (schema, value) => request("card.write", { schema, value }),
    error: (message) => send("error", { message: message.slice(0, 500) }),
  };
}
