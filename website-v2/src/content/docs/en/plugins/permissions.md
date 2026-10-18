---
title: Permissions, Consent & Audit
description: What each plugin permission grants, how risk levels and consent work, what is audited, and what full trust means.
section: plugins
order: 8
---

Plugins are not sandboxed to the point of uselessness: a plugin may ask for powerful capabilities. FluxDown's rule is that every capability is **declared** in the manifest, **shown to you and approved** before it works, and **recorded** in an audit log.

## Permissions

| Permission | Grants |
|---|---|
| *(none)* | The base sandbox: `flux.fetch`, `flux.storage`, scratch files, logging, view / command contributions. |
| `ffmpeg` | `flux.ffmpeg` / `flux.ffprobe` on finished files. |
| `ytdlp` | `flux.ytdlp`. |
| `auth` | Platform login flows and stored credentials used by `flux.fetch` / `flux.auth`. |
| `tasks` | `flux.tasks.*`: list, create, pause, resume and delete download tasks. |
| `browserRules` | Contribute rules to the browser extension (`contributes.sniffRules`). |
| `background` | Keep the `main` script running with the daemon. |
| `desktop` | Run native desktop scripts with **full trust** (see below). |

## Risk levels

The risk level is computed from the permissions — it is not self-declared.

| Level | When | Shown as |
|---|---|---|
| **Standard** | No permissions. | — |
| **Elevated** | Any of `ffmpeg`, `ytdlp`, `auth`, `tasks`, `browserRules`, `background`. | Warning badge |
| **Full** | `desktop`. | Destructive badge |

The badge appears on installed plugins and on market listings.

## Consent

A plugin runs only with the capabilities you have approved.

- **Install or update.** When a plugin is installed (market, `.fxplug` or directory) or updated, and its permissions or its `desktop.networkHosts` are not covered by what you approved before, FluxDown shows a consent dialog: the risk badge, each permission with what it allows, and the list of network hosts. Until you approve, the plugin stays disabled with the reason *consent required*, and a **Grant** button appears on its row.
- **Full trust.** For a **Full** plugin the dialog adds an explicit warning, and the confirm button is enabled only after you tick *I understand*.
- **Market installs.** The confirmation shown before a market install is the same dialog; confirming it there grants the same set, so you are not asked twice.
- **Updates ask again only for what is new.** A new version that adds a permission or a network host needs your approval; one that does not changes nothing.
- **Upgrading FluxDown.** Plugins installed before consent existed keep working: the permissions they had at that point are recorded as approved (marked as a migration in the audit log). Anything new they request later needs approval, and plugins you install afterwards are never pre-approved.
- **The index.** The plugin index lists every plugin that passes its automatic checks; it does not review them by hand. The index entry carries the permissions and network hosts, and FluxDown refuses a package whose manifest differs from its entry.

Approving is exact: the approved set must match what the plugin currently requests.

## Full trust: desktop scripts

A view's `desktop` script runs inside the desktop app process, as an ES module under the GPUI Shell. It is **not sandboxed**. It can read and write files, start processes, use the network and the clipboard, with your user's privileges. `networkHosts` records the hosts it intends to contact and is shown in the consent dialog, but it is a declaration for you to judge, not a firewall.

Install a plugin with `desktop` only if you trust its author the way you would trust any program you download and run.

**Native file, process and network operations performed by desktop scripts are not logged one by one.** The audit log records that a desktop script was loaded, unloaded, and every `fluxdown.call` / `fluxdown.invoke` it made — the coarse boundary where it touched FluxDown — but nothing about what it did on its own with the operating system.

Desktop scripts do not run in the daemon, on Web or on mobile.

## Audit log

Open **Settings → Extensions → Plugins → Audit log**, or **Audit record** in a plugin's details for that plugin only. Each row has a time, an origin (`daemon` or `desktop`), an action, a target, an outcome (`ok`, `denied`, `error`) and detail. You can filter by plugin, load older rows, copy the log as JSON, and clear it (with confirmation).

| Action | When |
|---|---|
| `install`, `update`, `uninstall`, `enable`, `disable` | Lifecycle changes. |
| `consent.granted`, `consent.migrated` | You approved capabilities; or the upgrade recorded existing ones. |
| `revoked` | The market revoked the plugin. |
| `breaker` | The plugin was disabled by the failure circuit breaker. |
| `fetch` | `flux.fetch`; the target is `METHOD scheme://host/path` — the query string and credentials are removed — and the detail is the status. |
| `auth.save`, `auth.remove` | Credential changes. |
| `fs.write`, `fs.remove` | Writes to the plugin's scratch workspace. |
| `ffmpeg.run`, `ffprobe.run`, `ytdlp.run` | Tool runs; the target is the argument list (shortened). |
| `task.retry`, `task.artifact` | Task requests from hooks. |
| `tasks.create`, `tasks.control` | `flux.tasks` calls from `main`. |
| `settings.update` | `flux.settings.update`. |
| `desktop.load`, `desktop.unload` | A desktop script started / stopped; the detail lists the grants it ran with. |
| `desktop.call`, `desktop.invoke` | RPCs made from a desktop script. |
| `audit.clear` | The log was cleared. |

Reads, `flux.storage` and logging are not recorded. Rows older than 90 days are removed, and the log keeps at most the latest 20,000 rows. Nothing is written while plugins are idle.
