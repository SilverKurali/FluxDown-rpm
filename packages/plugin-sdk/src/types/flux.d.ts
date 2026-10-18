// Hand-written typings for the FluxDown plugin runtime: the `flux` global injected by
// FLUX_PRELUDE (every entry script) and HOST_PRELUDE (the resident `main` script), plus the
// entry-point shapes the engine calls (resolve / hooks / authenticate / subscribe / main).
// Mirrors native/engine/src/plugin/{quickjs.rs,quickjs_host.rs,runtime.rs}.
//
// Importing anything from "@fluxdown/plugin-sdk" pulls these globals in.

import type { ViewChild, ViewNode } from "./view";

// ---------------------------------------------------------------------------
// flux.fetch / auth / storage / fs / task
// ---------------------------------------------------------------------------

export interface FluxFetchOptions {
  /** Default `GET`. */
  method?: string;
  url: string;
  headers?: Record<string, string>;
  /** Text body. */
  body?: string;
  /** Explicit credential reference; by default the host derives one from plugin id + site. */
  authRef?: string;
}

export interface FluxFetchResponse {
  status: number;
  headers: Record<string, string>;
  /** Text body (binary is unsupported). */
  body: string;
  /** The body was cut at the host's size limit. */
  truncated: boolean;
}

/** `flux.auth` — only present when `permissions` contains `auth`. */
export interface FluxAuth {
  get(authRef: string): Promise<unknown>;
  save(profile: Record<string, unknown>): Promise<unknown>;
  remove(authRef: string): Promise<unknown>;
}

export interface FluxStorage {
  /** `null` when the key is unset. */
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

/** Per-plugin scratch workspace (same root as the ffmpeg/yt-dlp cwd). Always available. */
export interface FluxFs {
  writeFile(name: string, content: string): Promise<void>;
  readFile(name: string): Promise<string | null>;
  remove(name: string): Promise<void>;
  list(): Promise<string[]>;
}

export interface FluxLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface FluxTask {
  requestRetry(opts?: { delayMs?: number }): Promise<unknown>;
  recordArtifact(name: string): Promise<void>;
}

export interface FluxInfo {
  identity: string;
  version: string;
  appVersion: string;
}

export interface ToolSpec {
  /** Arguments passed straight to the binary (no program name). */
  args: string[];
  /** Sub-directory of the workspace used as cwd (safe relative path). */
  subdir?: string;
  /** Per-call timeout; clamped by the host. */
  timeoutMs?: number;
}

export interface ToolOutcome {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncatedStdout: boolean;
  truncatedStderr: boolean;
}

export interface ToolAvailability {
  available: boolean;
  version: string;
  /** `manual` | `managed` | `system` | `none`. */
  source: string;
}

/** `flux.ffmpeg` — only present when `permissions` contains `ffmpeg`. */
export interface FluxFfmpeg {
  available(): Promise<ToolAvailability>;
  run(spec: ToolSpec): Promise<ToolOutcome>;
}
/** `flux.ffprobe` — present together with `flux.ffmpeg`. */
export interface FluxFfprobe {
  run(spec: ToolSpec): Promise<ToolOutcome>;
}
/** `flux.ytdlp` — only present when `permissions` contains `ytdlp`. */
export interface FluxYtdlp {
  available(): Promise<ToolAvailability>;
  run(spec: ToolSpec): Promise<ToolOutcome>;
}

// ---------------------------------------------------------------------------
// HOST_PRELUDE (resident `main` script)
// ---------------------------------------------------------------------------

export type ToastLevel = "info" | "success" | "warning" | "error";

/** Delivered to a view's `event` handler. */
export interface ViewEvent {
  /** Id of the node that fired, e.g. `"root/save"` (derived from `key`s / indices). */
  node: string;
  type: "press" | "change" | "submit" | "rowAction" | "select";
  /** `change` / `submit` payload. */
  value?: unknown;
  /** Row / item key for `rowAction` and `select`. */
  key?: string;
  /** Row action id for `rowAction`. */
  action?: string;
}

export interface ViewContext {
  /** Unique id of this open view session. */
  session: string;
  /** Props given when the view was opened (`{}` by default). */
  props: Record<string, unknown>;
  /** Task the view is attached to (taskDetail views); `null` otherwise. */
  taskId: string | null;
  locale: string;
  /** Requests a re-render (throttled to one render per 100 ms per session). */
  refresh(): void;
}

type Awaitable<T> = T | Promise<T>;

export interface ViewDefinition<S = Record<string, never>> {
  /** Builds the initial state (default `{}`). */
  init?(ctx: ViewContext): Awaitable<S>;
  /** Must be pure with respect to `state`; returns the node tree. */
  render(state: S, ctx: ViewContext): Awaitable<ViewNode>;
  /**
   * Handles a UI event. Mutate `state` in place (return nothing), or return a value
   * to replace the state. A render follows automatically.
   */
  event?(state: S, ev: ViewEvent, ctx: ViewContext): Awaitable<S | void>;
  /** Called when the session closes. */
  dispose?(state: S): Awaitable<void>;
}

/** Event passed to `flux.events.on` handlers (`PluginEvent`, camelCase). */
export type FluxEvent =
  | { event: "start"; taskId: string; url: string }
  | { event: "error"; taskId: string; url: string; message: string }
  | {
      event: "done";
      taskId: string;
      url: string;
      filePath: string;
      audioPath: string | null;
      muxed: boolean;
    }
  | { event: "metaProbed"; taskId: string; url: string; fileName: string; totalBytes: number }
  | {
      event: "cancel";
      taskId: string;
      url: string;
      reason?: "user_cancelled" | "variant_selection_cancelled" | "host_cancelled" | "unknown";
    };

export type FluxEventName = "onStart" | "onError" | "onDone" | "onMetaProbed" | "onCancel";

export interface FluxUi {
  /** Registers a portable view; `id` must match a `contributes.views[].id`. */
  view<S = Record<string, never>>(id: string, def: ViewDefinition<S>): void;
  /** Builds a node. Same shape as the JSX runtime output. */
  h(kind: string, props?: Record<string, unknown> | null, ...children: ViewChild[]): ViewNode;
  /** Fragment marker for `h`; children are spliced into the parent. */
  Fragment: symbol | string;
  toast(level: ToastLevel, text: string): void;
}

export interface FluxCommands {
  /** Registers the handler for a `contributes.commands[].id`. */
  register(id: string, handler: (ctx: { taskIds: string[] }) => Awaitable<void>): void;
}

export interface FluxRpc {
  /** Exposes `name` to the plugin's own desktop views via `fluxdown.invoke(name, args)`. */
  handle(name: string, handler: (args: unknown) => Awaitable<unknown>): void;
}

export interface FluxEvents {
  /** `name` must be listed in `main.events`. Resolved handlers trigger a re-render of open views. */
  on(name: FluxEventName, handler: (event: FluxEvent) => Awaitable<void>): void;
}

export interface FluxTimers {
  /** At most 64 live timers per plugin. */
  setTimeout(fn: () => void, ms: number): number;
  /**
   * Intervals are clamped to ≥1000 ms while a view session is open and ≥60000 ms otherwise.
   */
  setInterval(fn: () => void, ms: number): number;
  clear(id: number): void;
}

/** Daemon task wire shape (`daemon.task.*`), camelCase; see the protocol docs for fields. */
export type TaskDto = Record<string, unknown>;

/** `flux.tasks` — only present when `permissions` contains `tasks` (`main` script only). */
export interface FluxTasks {
  list(): Promise<TaskDto[]>;
  get(id: string): Promise<TaskDto>;
  /** Parameters are the `daemon.task.create` wire format. Rate-limited to 20 per minute. */
  create(params: Record<string, unknown>): Promise<TaskDto>;
  pause(id: string): Promise<unknown>;
  resume(id: string): Promise<unknown>;
  remove(id: string, deleteFiles?: boolean): Promise<unknown>;
}

export interface FluxSettingsHost {
  /** Writes plugin settings (values are strings, validated against `manifest.settings`). */
  update(entries: Record<string, string>): Promise<void>;
}

export interface Flux {
  fetch(opts: FluxFetchOptions): Promise<FluxFetchResponse>;
  auth?: FluxAuth;
  storage: FluxStorage;
  fs: FluxFs;
  /** Typed settings values, keyed by `manifest.settings[].key`. */
  settings: Record<string, string | number | boolean>;
  info: FluxInfo;
  logger: FluxLogger;
  task: FluxTask;
  ffmpeg?: FluxFfmpeg;
  ffprobe?: FluxFfprobe;
  ytdlp?: FluxYtdlp;

  // Only in the resident `main` script:
  ui: FluxUi;
  commands: FluxCommands;
  rpc: FluxRpc;
  events: FluxEvents;
  timers: FluxTimers;
  tasks?: FluxTasks;
}

// ---------------------------------------------------------------------------
// Entry-point contexts (what the engine passes to your globals)
// ---------------------------------------------------------------------------

/** `resolve(ctx)` argument. */
export interface ResolveContext {
  taskId: string;
  /** The original task URL. */
  url: string;
  /** Default credential reference for this site (empty unless the `auth` permission is granted). */
  authRef: string;
  cookies: string;
  referrer: string;
  userAgent: string;
  extraHeaders: Record<string, string>;
  /** Non-empty on the second stage of a manifest resolve (`<itemId>` or `<itemId>@<variantId>`). */
  resolverItem: string;
}

export interface ResolveVariant {
  label: string;
  url: string;
  audioUrl?: string;
  fileName?: string;
  totalBytes?: number;
  bandwidth?: number;
  width?: number;
  height?: number;
  container?: string;
}

export interface ManifestVariant {
  id: string;
  label: string;
  size?: number;
}

export interface ManifestItem {
  id: string;
  name: string;
  path?: string;
  size?: number;
  kind?: "" | "file";
  variants?: ManifestVariant[];
}

export interface ResolveResult {
  url?: string;
  audioUrl?: string;
  fileName?: string;
  totalBytes?: number;
  extraHeaders?: Record<string, string>;
  ephemeral?: boolean;
  rangeSupported?: boolean;
  variants?: ResolveVariant[];
  defaultVariantIndex?: number;
  /** Multi-file listing; mutually exclusive with `url` / `variants` / `audioUrl`. */
  manifest?: { name?: string; items: ManifestItem[] };
}

/** `authenticate(ctx)` argument. */
export interface AuthContext {
  action: "begin" | "poll" | "cancel" | "logout" | "status";
  site: string;
  authRef: string;
  sessionId: string;
  input: string;
}

export interface AuthResult {
  status: "pending" | "success" | "error";
  sessionId?: string;
  /** QR content, data URL, or any challenge to show the user. */
  challenge?: string;
  challengeType?: string;
  message?: string;
  authRef?: string;
}

/** `subscribe(ctx)` argument. */
export interface SubscribeContext {
  providerId: string;
  sourceId: string;
  url: string;
  /** Opaque provider config JSON string. */
  providerConfig: string;
  cookies: string;
  userAgent: string;
}

export type ResolveFn = (ctx: ResolveContext) => Awaitable<ResolveResult | null | undefined>;
export type AuthFn = (ctx: AuthContext) => Awaitable<AuthResult>;
/** Returns the normalized subscription payload (JSON-serializable). */
export type SubscribeFn = (ctx: SubscribeContext) => Awaitable<unknown>;

export interface HookHandlers {
  onStart?(ev: Extract<FluxEvent, { event: "start" }>): Awaitable<void>;
  onError?(ev: Extract<FluxEvent, { event: "error" }>): Awaitable<void>;
  onDone?(ev: Extract<FluxEvent, { event: "done" }>): Awaitable<void>;
  onMetaProbed?(ev: Extract<FluxEvent, { event: "metaProbed" }>): Awaitable<void>;
  onCancel?(ev: Extract<FluxEvent, { event: "cancel" }>): Awaitable<void>;
}

declare global {
  /** The plugin runtime facade. */
  const flux: Flux;
  /**
   * Console routed to the plugin log. Declared as a plain variable: do not enable the DOM
   * lib in plugin projects (the QuickJS host has no DOM).
   */
  var console: {
    log(...args: unknown[]): void;
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
    debug(...args: unknown[]): void;
  };
}
