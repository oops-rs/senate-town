// The scene host contract (docs/observe.md, "Scene host contract"), the
// scene's side, through the published client `@senate/scene-host`. Town is
// content: it knows nothing of which shell runs it. Every shell is one
// ordered channel of JSON messages `{host_version: 1, type, request_id?,
// data}`, given to `createSceneHost` as a MessagePort or something that
// behaves like one:
//
// - webkit: the macOS app's web view (a bound WK script bridge: out through
//   the `scene` handler, in through `__senateScene(message)`). This file is
//   the only place in Town that mentions `webkit`.
// - port: a parent page that hands over a MessagePort with `scene.connect`
//   (the reference browser shell, an Android WebMessagePort).
// - local: a shell in the same page (the dev shell, shell.ts), over a
//   MessageChannel.
import { createSceneHost, fromParent, type Environment as HostEnvironment, type HostEvent, type SceneHost, type Status } from "@senate/scene-host";
import type { Frame, ObserveState } from "./observe.ts";

export const HOST_VERSION = 1;
export type { Status };

/**
 * The environment, as published, plus two optional fields the macOS shell
 * sends (agreed with observe for Scene Host v1; left out when a shell has
 * no reliable signal): the window is in front; on battery or Low Power Mode.
 */
export interface Environment extends HostEnvironment {
  focused?: boolean;
  power?: "ac" | "battery" | "low_power";
}

/** What the scene does with what the shell sends. */
export interface Scene {
  status(status: Status): void;
  snapshot(snapshot: ObserveState): void;
  event(frame: Frame): void;
  environment(env: Environment): void;
}

/** A MessagePort, or anything that behaves like one for `createSceneHost`. */
export interface PortLike {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  start?(): void;
  close?(): void;
}

export interface Binding { name: "webkit" | "port" | "local"; port: PortLike }

/** What the scene can ask of its shell. */
export interface Host {
  readonly binding: Binding["name"];
  /** Open a senate://open link (on a user's click). */
  open(url: string): void;
  storageGet(key: string): Promise<unknown>;
  storageSet(key: string, value: unknown): Promise<boolean>;
  cardWrite(schema: string, value: Record<string, unknown> | null): Promise<boolean>;
}

/** The macOS app's web view: a port-like adapter over the WK script bridge. */
export function webkitBinding(): Binding | undefined {
  const handler = (window as unknown as { webkit?: { messageHandlers?: { scene?: { postMessage(m: unknown): void } } } })
    .webkit?.messageHandlers?.scene;
  if (!handler) return undefined;
  const listeners = new Set<(event: { data: unknown }) => void>();
  // The shell calls `__senateScene(message)`; defined once, not writable.
  Object.defineProperty(window, "__senateScene", {
    value: (data: unknown) => { for (const l of listeners) l({ data }); },
    writable: false, configurable: false,
  });
  return {
    name: "webkit",
    port: {
      postMessage: (m) => handler.postMessage(m),
      addEventListener: (_t, l) => { listeners.add(l); },
      removeEventListener: (_t, l) => { listeners.delete(l); },
    },
  };
}

/** Inside a parent page: wait for its `scene.connect` and the port it hands over. */
export function inFrame(): boolean {
  return window.parent !== window;
}

/** Connect the scene to its shell: say `ready`, then take what it sends. */
export async function connect(binding: Binding | "parent", scene: Scene): Promise<Host> {
  const host: SceneHost = binding === "parent" ? await fromParent() : createSceneHost(binding.port as unknown as MessagePort);
  host.subscribe((m: HostEvent) => {
    switch (m.type) {
      case "status": scene.status(m.data.state); break;
      case "observe.snapshot": scene.snapshot(m.data.snapshot as ObserveState); break;
      case "observe.event": scene.event(m.data.frame as Frame); break;
      case "environment": scene.environment(m.data as Environment); break;
    }
  });
  await host.ready().catch(() => undefined);
  const ok = (p: Promise<unknown>) => p.then(() => true, () => false);
  return {
    binding: binding === "parent" ? "port" : binding.name,
    open: (url) => { if (url.startsWith("senate://open/")) void host.open(url).catch(() => undefined); },
    storageGet: (key) => host.storage.get(key).catch(() => undefined),
    storageSet: (key, value) => ok(host.storage.set(key, value)),
    cardWrite: (schema, value) => ok(host.writeCard(schema, value)),
  };
}
