---
title: Plugin System Overview
description: What FluxDown plugins are, what they can do, how they run, and how to install them.
section: plugins
order: 1
---

FluxDown plugins are small JavaScript programs that hook into the download pipeline. A plugin is a folder containing a `manifest.json` plus one or two `.js` files — no build step, no npm, no framework.

At its core a plugin does two things:

1. **Resolve URLs** — rewrite a task's URL before the download starts. This is how you turn a share-page link (a video page, a file-hosting page) into the actual direct download link. Declared under `resolvers` in the manifest; the script exports a global `resolve(ctx)` function.
2. **React to task events** — get notified when a task starts, finishes, fails, or has its metadata probed. Declared under `hooks`; the script exports global `onStart` / `onDone` / `onError` / `onMetaProbed` functions.

Plugins can also contribute **UI and commands**: pages in the activity bar, a settings tab, task-detail tabs, command-palette and task-menu commands, and browser-extension sniff rules. A resident `main` script in the daemon returns data trees that the desktop app and the Web UI render with native controls — see [Views](/docs/en/plugins/views/).

The base sandbox **cannot** create tasks or read arbitrary files. It talks to the outside world through the `flux.*` API (HTTP fetch, key-value storage, scratch files, logging, retry requests) — see the [API reference](/docs/en/plugins/api-reference/). Anything beyond that — running ffmpeg or yt-dlp, creating tasks, running in the background, native desktop scripts — is a permission the plugin declares, you approve, and FluxDown records in an audit log; see [Permissions](/docs/en/plugins/permissions/).

## How resolvers run

The resolver design has three properties worth understanding before you write one:

- **Lazy.** FluxDown stores only your plugin's ID with the task, never the resolved URL. `resolve(ctx)` runs again on *every* start and resume. This is deliberate: direct links from file hosts usually expire, so re-resolving on resume keeps old tasks downloadable.
- **Off the main loop.** Resolution runs on a dedicated thread pool. A slow or hung script cannot freeze the app.
- **Fail-closed.** If your script throws, times out, or returns garbage, the task goes to the *error* state with a `[插件]`-prefixed message. FluxDown never falls back to downloading the original page URL — that would save an HTML page as a video file. The user can explicitly bypass a broken plugin via the "ignore plugin retry" action on the failed task.

When several enabled plugins match the same URL, FluxDown asks the user which plugin to use the first time such a task starts (the dialog lists every matching plugin, sorted by `identity`) and can remember the choice as the site's default plugin; users manage these under Plugins → Site default plugins. Unattended downloads (RSS, remote dispatch, silent mode with follow-up choices skipped) never ask: they use the site's default plugin, otherwise the plugin with the lexicographically smallest `identity`.

One consequence of lazy resolution: tasks handled by a resolver skip the normal metadata probe, so if the same plugin also subscribes to `onMetaProbed`, that hook never fires for its own tasks (FluxDown logs a warning about this at load time).

## How hooks run

Hooks are strictly fire-and-forget notifications:

- A hook that throws or times out is logged and ignored. It can never affect the task.
- If the plugin runtime is busy, the notification is dropped rather than queued.
- The only way a hook can influence a task is `flux.task.requestRetry({ delayMs })`, and only from inside `onError`.

## Execution model and limits

Every invocation runs in a **fresh JavaScript context** (QuickJS). No variables survive between calls — if you need persistence, use `flux.storage`. Scripts are loaded as classic scripts (not ES modules), and entry functions must be assigned to `globalThis` (a top-level `function resolve(ctx) {...}` declaration does this).

| Limit | Value |
|---|---|
| Resolve timeout | 10 s default; manifest `timeoutMs` can change it, hard ceiling 30 s |
| Resolve memory | 64 MB |
| Hook timeout / memory | 5 s / 32 MB |
| Circuit breaker | 3 consecutive timeouts or out-of-memory errors → plugin auto-disabled |

An auto-disabled plugin shows a notice in the app and can be re-enabled from the Plugins tab under Settings → Extensions.

## Installing plugins

Open **Settings → Extensions → Plugins** in the desktop app. Three ways in:

- **Zip upload** — a `.fxplug` file (which is just a zip of the plugin folder, see [Packaging](/docs/en/plugins/packaging/)).
- **From a directory** — point at a local folder containing `manifest.json`. With **dev mode** on (the default for directory installs), FluxDown records the folder path instead of copying it, and re-reads your `.js` files on every invocation — edit, save, re-run, no reinstall. Manifest changes still require a reload (toggle the plugin off and on).
- **Plugin market** — browse and install published plugins straight from the in-app market.

Installed plugins live under `<data dir>/plugins/<identity>/`. New installs are enabled by default.

## Where to go next

- [Your first plugin](/docs/en/plugins/your-first-plugin/) — a complete working resolver in ~40 lines.
- [Manifest reference](/docs/en/plugins/manifest/) — every `manifest.json` field and validation rule.
- [API reference](/docs/en/plugins/api-reference/) — hook signatures and the full `flux.*` API.
- [Packaging & market](/docs/en/plugins/packaging/) — shipping a `.fxplug` and publishing to the index.
- [Views, commands & the UI API](/docs/en/plugins/views/) — pages, settings tabs, task-detail tabs and commands rendered natively on desktop and Web.
- [Plugin SDK & CLI](/docs/en/plugins/sdk/) — TypeScript types, JSX and a bundler/packager.
- [Permissions, consent & audit](/docs/en/plugins/permissions/) — what plugins may do and how it is approved and recorded.
