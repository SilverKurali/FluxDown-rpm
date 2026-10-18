---
title: Plugin SDK & CLI
description: Build plugins in TypeScript and JSX with @fluxdown/plugin-sdk — types, validator, bundler and packager.
section: plugins
order: 6
---

`@fluxdown/plugin-sdk` is the toolchain for writing FluxDown plugins in TypeScript. It gives you typed `flux.*` APIs, a JSX runtime for [portable views](/docs/en/plugins/views/), the same manifest validator the engine and the plugin index use, and a CLI that bundles, validates and packs a `.fxplug`.

You do not need it — a plain folder of `.js` files still works (see [Your first plugin](/docs/en/plugins/your-first-plugin/)). Use it when you want types, several source files, or views written in JSX.

## Quick start

```bash
npx @fluxdown/plugin-sdk create my-plugin --identity me@my-plugin --name "My Plugin"
cd my-plugin
npm install            # or: bun install
npm run pack           # → me@my-plugin-0.1.0.fxplug
```

The template contains one activity-bar view (a counter written in JSX) and one command. To try it:

1. In FluxDown open **Settings → Extensions → Plugins** and install the project folder with **From a directory** (dev mode). Point it at `dist/` after a build.
2. Approve the permissions dialog (see [Permissions & audit](/docs/en/plugins/permissions/)).
3. Run `npm run dev` — it rebuilds `dist/` on every save. Use **Reload** on the plugin row to pick up manifest changes.

## CLI

| Command | What it does |
|---|---|
| `fluxdown-plugin create <dir> [--identity a@b] [--name "Name"] [--sdk <path>]` | Scaffolds a project. `--sdk` links a local SDK checkout instead of the published version. |
| `fluxdown-plugin build [dir]` | Bundles every entry into `dist/`, copies the manifest and assets, then validates. |
| `fluxdown-plugin validate [dir]` | Validates `dist/` with the engine rules; prints the risk level and network hosts. |
| `fluxdown-plugin pack [dir]` | Runs `build`, then zips `dist/` into `<identity>-<version>.fxplug` (manifest at the archive root). |
| `fluxdown-plugin dev [dir]` | Watches sources and rebuilds `dist/`. |

`validate` is stricter than the client in two ways that the plugin index also enforces: `version` must be a plain `MAJOR.MINOR.PATCH`, and every entry and the icon must exist in the package.

## Project layout

```
my-plugin/
  manifest.json                    your manifest (the source of truth, copied to dist/)
  fluxdown-plugin.config.json      what to bundle
  src/main.tsx                     resident main script
  src/resolve.ts                   resolver entry
  tsconfig.json
```

### `fluxdown-plugin.config.json`

```json
{
  "entries": { "main.js": "src/main.tsx", "resolve.js": "src/resolve.ts" },
  "desktop": { "ui/dashboard.js": "src/desktop/dashboard.ts" },
  "assets": ["rules.json"]
}
```

| Key | Meaning |
|---|---|
| `entries` | Classic scripts, `output path in dist → source file`. Bundled as a single IIFE for ES2022: no `import` / `export` survives, because the engine evaluates them as classic scripts. Use for `main`, resolvers, hooks, `auth` and subscriptions. |
| `desktop` | Desktop UI scripts (`contributes.views[].desktop.entry`), bundled as ES modules. The host modules `gpui-kit`, `gpui`, `gpui-base`, `gpui-component`, `gpui-shell`, `gpui-fps`, `fluxdown` and the Node-style built-ins the desktop runtime provides (`buffer`, `console`, `crypto`, `fs/promises`, `net`, `os`, `path`, `process`, `url`, `websocket`, `zlib`) stay as bare imports. |
| `assets` | Extra files copied verbatim (for example a sniff rule pack). Files named by the manifest (entries, `icon`, `sniffRules`) that are not built are copied automatically. |

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
    "lib": ["ES2022"], "types": [], "strict": true, "noEmit": true,
    "jsx": "react-jsx", "jsxImportSource": "@fluxdown/plugin-sdk/ui"
  },
  "include": ["src"]
}
```

Add `src/env.d.ts` with `/// <reference types="@fluxdown/plugin-sdk" />` to bring the global `flux` into scope. Do not enable the DOM lib: the QuickJS host has no DOM.

## Entry-point helpers

The engine reads fixed globals (`resolve`, `onDone`, `authenticate`, `subscribe`, …). The helpers in `@fluxdown/plugin-sdk/runtime` install your functions there so each entry file can be an ordinary module:

```ts
import { defineResolver, defineHooks, defineAuth, defineSubscription } from "@fluxdown/plugin-sdk/runtime";

defineResolver(async (ctx) => {
  const res = await flux.fetch({ url: ctx.url });
  return { url: JSON.parse(res.body).direct };
});

defineHooks({
  onDone: (ev) => flux.logger.info("finished", ev.filePath),
});
```

`defineMain(setup)` runs `setup(flux)` immediately, for symmetry; the `main` script registers views, commands, rpc handlers, events and timers through `flux.ui`, `flux.commands`, `flux.rpc`, `flux.events` and `flux.timers`.

## JSX

With `jsxImportSource` set as above, every lowercase tag is a [view node](/docs/en/plugins/views/#node-reference), fully typed from the same schema the daemon validates against:

```tsx
flux.ui.view("dashboard", {
  render: () => (
    <stack gap="md" padding="md">
      <heading text="Hello" />
      <button key="go" text="Go" variant="primary" />
    </stack>
  ),
  event: (_state, ev) => { if (ev.node === "root/go") flux.ui.toast("info", "Clicked"); },
});
```

`key` becomes `p.key` (it is not a regular prop) and decides the node id. `null`, `false` and `undefined` children are dropped, nested arrays are flattened, and `<>…</>` splices its children into the parent. The output has exactly the `{k, p, c}` shape `flux.ui.h` returns.

## Types shipped

- `flux` and its sub-APIs, the entry contexts (`ResolveContext`, `AuthContext`, …) and view types — from `@fluxdown/plugin-sdk`.
- `ThemeTokenPath` — every theme token path that `fluxdown.theme().tokens` resolves, generated from the theme registry.
- `@fluxdown/plugin-sdk/types/desktop` — declarations for desktop UI scripts (`gpui-kit` and friends), generated from the desktop runtime.

## Validator API

The manifest validator is also exported as a zero-dependency module:

```ts
import { validateManifest, riskOf, networkHostsOf, validateSniffPack } from "@fluxdown/plugin-sdk/manifest";

const { ok, errors } = validateManifest(manifest, new Set(["main.js"]));
riskOf(manifest);          // "standard" | "elevated" | "full"
networkHostsOf(manifest);  // sorted union of every view's desktop.networkHosts
```

It follows the same rules as the engine, checked against a shared set of test cases. `validateManifest(manifest, files, { strict: true })` adds the listing-grade checks described above.
