// Entry-point helpers. The engine looks up fixed globals after evaluating each script
// (`resolve`, `onStart`/`onError`/`onDone`/`onMetaProbed`/`onCancel`, `authenticate`, `subscribe`);
// these helpers install your functions there so entry files can be ES modules that the CLI bundles
// into classic scripts. The resident `main` script registers through `flux.*` instead.
import type {
  AuthFn,
  Flux,
  HookHandlers,
  ResolveFn,
  SubscribeFn,
} from "./types/flux";


function install(name: string, fn: unknown): void {
  // The engine reads entry points off the global object by fixed name.
  Reflect.set(globalThis, name, fn);
}

/** Installs `globalThis.resolve` (manifest `resolvers[].entry`). */
export function defineResolver(fn: ResolveFn): ResolveFn {
  install("resolve", fn);
  return fn;
}

/** Installs the `onStart`/`onError`/`onDone`/`onMetaProbed`/`onCancel` globals (manifest `hooks.entry`). */
export function defineHooks(handlers: HookHandlers): HookHandlers {
  for (const [name, fn] of Object.entries(handlers)) {
    if (typeof fn === "function") install(name, fn);
  }
  return handlers;
}

/** Installs `globalThis.authenticate` (manifest `auth.entry`). */
export function defineAuth(fn: AuthFn): AuthFn {
  install("authenticate", fn);
  return fn;
}

/** Installs `globalThis.subscribe` (manifest `subscriptions[].entry`). */
export function defineSubscription(fn: SubscribeFn): SubscribeFn {
  install("subscribe", fn);
  return fn;
}

/**
 * Wraps the registration code of the resident `main` script. It runs once, immediately, with the
 * `flux` facade, so views, commands, rpc handlers, events and timers are registered while the
 * script is evaluated.
 */
export function defineMain(setup: (flux: Flux) => void): void {
  setup(flux);
}
