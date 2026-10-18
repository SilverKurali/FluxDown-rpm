---
title: Manifest Reference
description: Every manifest.json field, the settings widget matrix, and URL pattern rules.
section: plugins
order: 3
---

`manifest.json` sits at the root of the plugin folder. All keys are camelCase. **Unknown keys are rejected** — a typo fails the whole manifest rather than being silently ignored.

## Top-level fields

| Field | Required | Type | Rules |
|---|---|---|---|
| `identity` | yes | string | `^[a-z0-9_-]+@[a-z0-9_-]+$` — lowercase name, `@`, author. Dots are forbidden. Permanent ID: settings, storage and the install folder are all keyed by it. |
| `name` | yes | string | Display name, must be non-empty. |
| `version` | yes | string | `MAJOR.MINOR.PATCH`, three integers. |
| `description` | no | string | Shown in the plugin list. |
| `homepage` | no | string | Project/author URL. |
| `icon` | no | string | Path relative to the plugin folder. No `..`, no absolute paths, no drive letters, no leading `/` or `\`. |
| `minAppVersion` | no | string | Three-part version. If the running FluxDown is older, the plugin is skipped at load (logged, not an error). |
| `resolvers` | no | array | **At most one entry** in v1. See below. |
| `hooks` | no | object | See below. |
| `auth` | no | object | Platform login entry. See below. |
| `main` | no | object | Always-on script for portable views, commands and background logic. See below. |
| `contributes` | no | object | Views, commands and browser sniff rules. See below. |
| `permissions` | no | array | Capability grants. Accepts `"ffmpeg"`, `"ytdlp"`, `"auth"`, `"tasks"`, `"browserRules"`, `"desktop"` and `"background"`. Unknown values are rejected. |
| `settings` | no | array | Declarative settings fields. See below. |

A plugin may declare a resolver, hooks, or both. A manifest with neither is valid but does nothing.

## `resolvers[0]`

```json
{
  "resolvers": [
    {
      "match": { "urls": ["*://host.com/share/*", "*://cdn.host.com/*"] },
      "entry": "resolver.js",
      "timeoutMs": 15000
    }
  ]
}
```

| Field | Required | Rules |
|---|---|---|
| `match.urls` | yes | Non-empty list of URL patterns (see pattern rules below). |
| `entry` | yes | Script file, safe relative path. Must define `globalThis.resolve`. |
| `timeoutMs` | no | Per-call timeout in milliseconds. Must not be `0`. Replaces the 10 s default but is capped at the 30 s hard ceiling regardless of what you write. |

## `hooks`

```json
{
  "hooks": {
    "entry": "hooks.js",
    "events": ["onStart", "onDone", "onError"],
    "match": { "urls": ["*://host.com/*"] }
  }
}
```

| Field | Required | Rules |
|---|---|---|
| `entry` | yes | Script file, safe relative path. Must define a global function per subscribed event. |
| `events` | yes | Non-empty subset of `onStart`, `onError`, `onDone`, `onMetaProbed`. Anything else is rejected. |
| `match` | no | Optional URL filter, same pattern rules. If present, `urls` must be non-empty. Omitted = the hooks fire for every task. |

Caveat: if the same plugin also declares a resolver, `onMetaProbed` never fires for its tasks — resolver tasks skip the metadata probe entirely. FluxDown logs a warning if you subscribe to it anyway.


## `auth`

```json
{
  "auth": { "entry": "auth.js", "timeoutMs": 20000 }
}
```

| Field | Required | Rules |
|---|---|---|
| `entry` | yes | Script file, safe relative path. Must define `globalThis.authenticate`. |
| `timeoutMs` | no | Per-call timeout in milliseconds for `authenticate`. Must not be `0`. Replaces the 30 s default but is capped at the 30 s hard ceiling regardless of what you write; this budget is entirely independent from `resolvers[0].timeoutMs`. |

`permissions` must include `"auth"` when `auth.entry` is declared, otherwise manifest validation fails. See the [API reference](/docs/en/plugins/api-reference/#authenticatectx) for how login is driven and the full `flux.auth` surface.

## `main`

```json
{ "main": { "entry": "main.js", "events": ["onDone"], "background": false } }
```

| Field | Required | Rules |
|---|---|---|
| `entry` | yes | Classic script, safe relative path inside the package, extension `.js`, file must exist. |
| `events` | no | Events delivered to the script; each must be one of `onStart`, `onError`, `onDone`, `onMetaProbed`, `onCancel`. |
| `background` | no | `true` keeps the script running with the daemon. Requires the `background` permission. |

`main` is the always-on part of a plugin: portable views, commands and background logic run here, inside the daemon.

## `contributes`

```json
{
  "contributes": {
    "views": [{ "id": "dashboard", "title": "Dashboard", "location": "activity",
                "desktop": { "entry": "ui/dashboard.js", "networkHosts": ["api.example.com"] } }],
    "commands": [{ "id": "refresh", "title": "Refresh", "palette": true, "taskMenu": false }],
    "sniffRules": "rules.json"
  }
}
```

Empty `views` / `commands` arrays are the same as leaving them out.

**`views[]`** — at most 16.

| Field | Required | Rules |
|---|---|---|
| `id` | yes | Matches `^[a-z][a-z0-9-]{0,31}$`; unique among views. |
| `title` | yes | 1–40 characters. |
| `location` | yes | `activity`, `settings`, `taskDetail` or `window`. At most one view may use `settings`. |
| `desktop` | no | Desktop-only implementation, see below. A view without `desktop` is portable and requires `main`. |
| `portable` | no | Only allowed together with `desktop`. `true` means `main` also implements this view via `flux.ui.view`, so Web and mobile can show it (requires `main`); default `false` = desktop-only, other clients show a "desktop only" notice. |

`desktop`:

| Field | Required | Rules |
|---|---|---|
| `entry` | yes | UI script, safe relative path inside the package. Extension must be `.js` or `.mjs`, and the file must exist in the package. |
| `width` / `height` | no | Initial window size in logical pixels. Only for `location: "window"`. Finite number within `[240, 4096]`. |
| `networkHosts` | no | Hosts the UI script may connect to. At most 64 entries; each must be a lowercase DNS hostname or an IP literal — no scheme, port, path or wildcard — and unique. |

Any view with `desktop` requires the `desktop` permission. `desktop.entry` is an ES module executed by the GPUI Shell built into the GPUI desktop client (it may `import` from `"gpui-kit"`, `"gpui-base"` and `"gpui-component"`). The engine and daemon **never** compile or execute it; they only validate the path and check that the file exists. Web and mobile clients do not run it. It is not sandboxed: the UI script runs with **full trust** inside the desktop process, so install only plugins you trust.

The UI script may also `import { identity, call } from "fluxdown"`: `identity()` returns this plugin's identity; `call(method, params)` calls FluxDown's local service RPC (only `daemon.*` / `agent.*` methods are allowed — anything else throws synchronously at the call site; a failed RPC rejects the promise with the error details as JSON). The default export must be a class extending `View` (from `"gpui-kit"`). When the UI is unavailable (Web, mobile, or a remote host) the plugin's download features keep working, so do not put anything other clients need only in `desktop`.

**`commands[]`** — at most 32; requires `main`.

| Field | Required | Rules |
|---|---|---|
| `id` | yes | Same pattern as view ids; unique among commands. |
| `title` | yes | 1–40 characters. |
| `palette` | no | Show in the command palette. |
| `taskMenu` | no | Show in the task context menu. |

**`sniffRules`** — safe relative path to a `.json` rule pack for the browser extension. Requires the `browserRules` permission. The file must exist, be at most 256 KiB, parse as JSON with `"format": "fluxdown-sniff-pack"` and a `rules` array of at most 500 entries.

## `permissions`

Extra host capabilities a plugin opts into. Empty or omitted = the base sandbox (network via `flux.fetch`, `flux.storage`, logging). Recognised values:

| Value | Grants |
|---|---|
| `ffmpeg` | The `flux.ffmpeg` API — run the resolved ffmpeg on a finished file (see the [API reference](/docs/en/plugins/api-reference/)). |
| `ytdlp` | The `flux.ytdlp` API — run the resolved yt-dlp from `resolve` or any hook (see the [API reference](/docs/en/plugins/api-reference/)). |
| `auth` | Declare `auth.entry` for a platform login flow, and allow `flux.fetch`/`flux.auth` to use stored credentials (see the [API reference](/docs/en/plugins/api-reference/)). |
| `tasks` | Operate on download tasks from `main`. |
| `browserRules` | Contribute browser-extension sniff rules via `contributes.sniffRules`. |
| `desktop` | Run desktop scripts (`contributes.views[].desktop`) with full trust in the desktop process. |
| `background` | Keep `main` running with the daemon (`main.background`). |

Risk level shown to users: `desktop` → **full**; any of `ffmpeg`, `ytdlp`, `auth`, `tasks`, `browserRules`, `background` → **elevated**; otherwise **standard**.

```json
{ "permissions": ["ffmpeg", "ytdlp", "auth"] }
```

Unknown values fail the whole manifest, so an older FluxDown that doesn't know a permission rejects the plugin rather than silently ignoring it — pair a new permission with a `minAppVersion` bump.

## `settings[]`

Each entry describes one field; the app generates the form. Keys must be unique and non-empty.

```json
{
  "settings": [
    { "key": "apiToken", "title": "API token", "type": "string", "widget": "password", "required": true },
    { "key": "quality",  "title": "Preferred quality", "type": "string", "widget": "select",
      "options": [ { "value": "hd", "label": "HD" }, { "value": "sd", "label": "SD" } ],
      "default": "hd" },
    { "key": "maxRetries", "title": "Max retries", "type": "number", "min": 0, "max": 10, "default": "3" },
    { "key": "verbose", "title": "Verbose logging", "type": "boolean", "default": "false" }
  ]
}
```

| Field | Required | Notes |
|---|---|---|
| `key` | yes | Unique within the plugin. Read back as `flux.settings.<key>`. |
| `title` | yes | Form label. |
| `description` | no | Help text below the field. |
| `type` | yes | `string`, `number`, or `boolean`. |
| `widget` | no | Defaults by type: string→`text`, number→`number`, boolean→`toggle`. |
| `options` | select only | Non-empty `{value, label}` list. |
| `default` | no | **Always a string**, even for numbers (`"3"`) and booleans (`"true"`/`"false"`). For select, must be one of the option values; for number, must parse and fall inside `min`/`max`. |
| `required` | no | The form refuses to save an empty value. |
| `min` / `max` | number only | Finite, inclusive bounds, `min ≤ max`. |
| `pattern` | string only | A **JavaScript RegExp** (not Rust regex) validated against the value on save. |
| `helperScript` | string only | A snippet the host shows a **Copy** button for, next to the field. The host only copies the text to the clipboard — it never runs it. The user pastes it into the target site's browser DevTools console (typical use: read `document.cookie` and copy a login cookie back into the field). Non-empty, ≤ 4 KB. |
| `helperLabel` | with `helperScript` | Button label (≤ 60 chars). Only valid together with `helperScript`; defaults to a generic "Copy helper script" when omitted. |

### Widget × type matrix

Only these combinations are valid — anything else fails validation:

| Widget | Allowed type |
|---|---|
| `text`, `password`, `textarea`, `folder`, `select` | `string` |
| `toggle` | `boolean` |
| `number` | `number` |

## URL pattern rules

Patterns are not regular expressions and not browser match patterns. The rules, in full:

- `*` is the **only** wildcard and matches any run of characters (including `/` and `:`).
- Text between `*`s must appear in order as substrings.
- If the pattern doesn't start with `*`, the first segment must be a **prefix** of the URL.
- If it doesn't end with `*`, the last segment must be a **suffix**.
- Matching is case-insensitive (both sides are lowercased whole, path included).
- A bare `*` matches everything.

Examples:

| Pattern | `https://www.youtube.com/watch?v=abc` |
|---|---|
| `*://www.youtube.com/watch*` | matches |
| `https://x.com/a` (no wildcard) | exact match only |
| `*://x.com/*` vs `https://y.com/a` | no match — `://x.com/` not found |
| `youtube.com/*` | no match — pattern is prefix-anchored, URL starts with `https://` |

## Validation summary

The manifest is validated when the plugin is installed and every time it's loaded. On failure the plugin is skipped and the reason lands in the log. The checks, in order: identity format → name non-empty → version format → `minAppVersion` format → icon path safety → at most one resolver → resolver entry path / non-empty `match.urls` / `timeoutMs ≠ 0` → hooks entry path / non-empty valid `events` / non-empty `match.urls` if present → auth entry path / `permissions` includes `auth` when `auth.entry` is declared / `timeoutMs ≠ 0` → `main` entry / events / `background` permission → `contributes` views, commands and `sniffRules` rules above (including the `desktop` / `browserRules` permission requirements) → settings key uniqueness and the per-field rules above → `permissions` are all recognised values. At load time the files named by `main.entry`, every `desktop.entry` and `sniffRules` must also exist in the package, and the sniff rule pack must pass its content checks.

Entry scripts are also compile-checked at install time — a syntax error is rejected up front rather than discovered on the first download (three scripts when `auth.entry` is declared).
