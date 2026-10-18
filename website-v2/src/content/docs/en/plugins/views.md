---
title: Views, Commands & the UI API
description: Portable plugin views rendered natively by the desktop app and the Web UI, commands, and the resident main script.
section: plugins
order: 7
---

A plugin can show UI without shipping any UI code. The resident **`main` script** returns a tree of data nodes; FluxDown's desktop app (GPUI) and Web UI render that tree with their own native controls, using the active theme. Because the tree is data, the same view works everywhere. Mobile apps keep the protocol but do not render plugin views yet.

`main` runs inside the daemon, so views, commands and background logic keep working while no window is open. It is started on demand (opening a view, running a command, an event listed in `main.events`) and shut down after five idle minutes, unless the manifest sets `main.background` (needs the `background` permission).

## Declaring views and commands

```json
{
  "permissions": [],
  "main": { "entry": "main.js", "events": ["onDone"] },
  "contributes": {
    "views": [
      { "id": "dashboard", "title": "Dashboard", "location": "activity" },
      { "id": "options", "title": "Options", "location": "settings" },
      { "id": "files", "title": "Files", "location": "taskDetail" }
    ],
    "commands": [{ "id": "refresh", "title": "Refresh", "palette": true, "taskMenu": true }]
  }
}
```

| `location` | Where it appears |
|---|---|
| `activity` | A page in the activity bar (same default position on desktop and Web). |
| `settings` | A tab in the plugin's settings dialog, next to the basic settings form. At most one per plugin. |
| `taskDetail` | A tab in the task detail panel; the view receives the selected task as `ctx.taskId`. |
| `window` | A stand-alone window (desktop implementation only; see below). |

`commands` with `palette: true` appear in the desktop command palette (and as buttons on the plugin's page on Web); `taskMenu: true` adds them to the task context menu, where the selected task ids are passed to the handler. See [Manifest reference](/docs/en/plugins/manifest/#contributes) for every validation rule.

## The `main` script

`main` is a classic script. Everything is registered through `flux.*` while it is evaluated.

```js
flux.ui.view("dashboard", {
  init: async (ctx) => ({ tasks: await flux.tasks.list() }),   // needs the `tasks` permission
  render: (state, ctx) =>
    flux.ui.h("stack", { gap: "md", padding: "md" },
      flux.ui.h("heading", { text: "Tasks" }),
      flux.ui.h("table", {
        columns: [{ key: "name", title: "Name" }, { key: "size", title: "Size", kind: "bytes" }],
        rows: state.tasks.map((t) => ({ key: t.id, name: t.fileName, size: t.totalBytes })),
      })),
  event: async (state, ev, ctx) => { if (ev.type === "press") state.tasks = await flux.tasks.list(); },
  dispose: (state) => {},
});

flux.commands.register("refresh", async ({ taskIds }) => { /* … */ });
flux.rpc.handle("ping", async (args) => ({ pong: args }));
flux.events.on("onDone", async (ev) => flux.ui.toast("success", `Done: ${ev.url}`));
const timer = flux.timers.setInterval(() => flux.logger.info("tick"), 60000);
```

| API | Notes |
|---|---|
| `flux.ui.view(id, { init, render, event, dispose })` | `id` must match a declared view. `init`, `render`, `event` and `dispose` may be sync or async. State defaults to `{}`. |
| `ctx` | `{ session, props, taskId, locale, refresh() }`. `taskId` is `null` unless the view is attached to a task. `refresh()` asks for a re-render. |
| `event(state, ev, ctx)` | `ev = { node, type, value?, key?, action? }`. Mutate `state` in place, or return a value to replace it. A render follows automatically. |
| `flux.ui.h(kind, props, ...children)` / `flux.ui.Fragment` | Builds `{k, p, c}` nodes; children are flattened and `null` / `false` are dropped. JSX (see [SDK](/docs/en/plugins/sdk/#jsx)) produces the same shape. |
| `flux.ui.toast(level, text)` | `info`, `success`, `warning` or `error`. |
| `flux.commands.register(id, handler)` | Handler receives `{ taskIds }`. |
| `flux.rpc.handle(name, handler)` | Callable from your own desktop views with `fluxdown.invoke(name, args)`. Results must be JSON-serializable. |
| `flux.events.on(name, handler)` | `name` must be in `main.events`. Open views re-render afterwards. |
| `flux.timers.setTimeout / setInterval / clear` | At most 64 timers. While a view is open an interval is clamped to ≥ 1 s, otherwise ≥ 60 s. |
| `flux.tasks.*` | `list`, `get`, `create`, `pause`, `resume`, `remove(id, deleteFiles)`. Needs the `tasks` permission. `create` is limited to 20 per minute. |
| `flux.settings.update({ key: "value" })` | Writes your plugin's settings (validated against `manifest.settings`). |

Renders are throttled to one per view session every 100 ms; requests in between are merged. A view session that stops sending keep-alives for 90 seconds is closed. The daemon sends only the **difference** between renders to the clients, so large tables stay cheap.

A call that runs for more than 30 s of wall time or two seconds of CPU, or a script that exceeds 64 MiB of memory, counts towards the same circuit breaker as other plugin scripts.

## Node reference

Every node can carry a `key` (string or number). Node ids are derived from the tree: the root is `root`, and a child is `<parent id>/<key>` — or its index when it has no key. Siblings must not share a key. Use stable keys for anything that fires events, for table rows and for list items; they are what makes updates incremental.

Unknown props are rejected. Tones are `neutral`, `accent`, `success`, `warning`, `danger`, `info`, `muted` and follow the active theme. Sizes (`gap`, `padding`) are `none`, `xs`, `sm`, `md`, `lg`, `xl`.

| Kind | Props (default) | Children | Events |
|---|---|---|---|
| `stack` | `direction` row \| column (column), `gap` (sm), `align` start \| center \| end \| stretch (stretch), `justify` start \| center \| end \| between (start), `wrap`, `padding` (none), `grow` | yes | — |
| `scroll` | `maxHeight` | yes | — |
| `card` | `title`, `padding` (md) | yes | — |
| `section` | `title` (required), `description` | yes | — |
| `divider` | — | no | — |
| `text` | `text` (required), `tone` (neutral), `size` xs–xl (sm), `weight` normal \| medium \| semibold (normal), `mono`, `truncate` | no | — |
| `heading` | `text` (required), `level` 1–3 (2) | no | — |
| `markdown` | `text` (required) — paragraphs and code blocks only | no | — |
| `code` | `text` (required) | no | — |
| `link` | `text`, `href` — `http:` / `https:` only | no | — |
| `image` | `src` — `data:image/(png\|jpeg\|webp);base64,…` up to 1 MiB, `alt`, `width`, `height` | no | — |
| `badge` | `text`, `tone` | no | — |
| `progress` | `value` 0–1 or `null` (indeterminate), `label` | no | — |
| `spinner` | `label` | no | — |
| `kv` | `items` `[{ key, value }]` | no | — |
| `callout` | `tone` (info), `title`, `text` | no | — |
| `empty` | `title`, `description` | no | — |
| `button` | `text`, `variant` primary \| outline \| ghost \| danger (outline), `disabled`, `loading` | no | `press` |
| `switch` / `checkbox` | `label`, `checked`, `disabled` | no | `change` `{ value: boolean }` |
| `select` | `options` `[{ value, label }]`, `value`, `placeholder`, `disabled` | no | `change` `{ value }` |
| `input` | `value`, `placeholder`, `kind` text \| password \| number (text), `disabled` | no | `change` `{ value }` (debounced 300 ms), `submit` `{ value }` |
| `textarea` | `value`, `placeholder`, `rows` 1–50 (4), `disabled` | no | `change` `{ value }` (debounced 300 ms) |
| `tabs` | `items` `[{ value, label }]`, `value` — you render the content for the selected value | no | `change` `{ value }` |
| `table` | `columns` `[{ key, title, kind, width }]`, `rows` `[{ key, … }]`, `rowActions` `[{ id, label, tone }]`, `emptyText` | no | `rowAction` `{ key, action }`, `select` `{ key }` |
| `list` | `items` `[{ key, title, description, badge, tone }]` | no | `select` `{ key }` |

Table column `kind`: `text`, `bytes`, `speed`, `percent` (input 0–1), `progress` (a bar), `time` (unix milliseconds) or `badge` (a string, or `{ text, tone }`).

Limits: 5,000 nodes, depth 64, 10,000 table rows, 5,000 list items. A tree that violates the schema is not shown; the view displays the error instead, and the next valid render recovers it.

### Inputs and re-renders

An `input` keeps what the user types while they are typing: a re-render never overwrites a focused input, or a value equal to the last one the user sent. Set `value` in state from the `change` event and render it back — that is the normal controlled-input pattern.

## Desktop-only implementations

A view may also declare a `desktop` entry (permission `desktop`): an ES module run by the GPUI Shell inside the desktop app for richer, fully native UI. When a view has both, the desktop app uses the desktop entry and Web uses the portable `main` view. A view with only `desktop` shows a "desktop only" card on Web. Desktop scripts run with **full trust** — read [Permissions & audit](/docs/en/plugins/permissions/) before shipping one.

Inside a desktop script, `import { identity, call, invoke, theme, locale, toast } from "fluxdown"`:

| Function | Purpose |
|---|---|
| `identity()` | This plugin's identity. |
| `call(method, params)` | A local `daemon.*` / `agent.*` RPC. |
| `invoke(name, args)` | Calls a handler registered with `flux.rpc.handle` in your `main` script. |
| `theme()` | `{ revision, tokens }` — every resolved theme token (`#rrggbbaa` for colors, numbers for sizes). Re-read it when the theme changes. |
| `locale()` | The UI language. |
| `toast(level, text)` | Shows a notification in the active window. |

FluxDown keeps its own theme applied: if a script replaces the global theme it is restored, so a plugin cannot permanently re-skin the app.
