---
title: 权限、授权与审计
description: 每项插件权限授予什么、风险等级与授权如何运作、哪些操作会被审计，以及完全信任的含义。
section: plugins
order: 8
sourceHash: "c2669ca00e41"
---

插件的沙箱并没有严到无用：插件可以申请很强的能力。FluxDown 的规则是：每项能力都要在 manifest 里**声明**，在生效前**展示给你并由你授权**，并**记入审计日志**。

## 权限

| 权限 | 授予 |
|---|---|
| *（无）* | 基础沙箱：`flux.fetch`、`flux.storage`、临时文件、日志、视图 / 命令贡献。 |
| `ffmpeg` | 对已完成文件使用 `flux.ffmpeg` / `flux.ffprobe`。 |
| `ytdlp` | `flux.ytdlp`。 |
| `auth` | 平台登录流程，以及 `flux.fetch` / `flux.auth` 使用已保存的凭据。 |
| `tasks` | `flux.tasks.*`：列出、创建、暂停、恢复、删除下载任务。 |
| `browserRules` | 向浏览器扩展贡献规则（`contributes.sniffRules`）。 |
| `background` | 让 `main` 脚本随 daemon 常驻。 |
| `desktop` | 以**完全信任**运行桌面原生脚本（见下文）。 |

## 风险等级

风险等级由权限推导，不是自己声明的。

| 等级 | 条件 | 显示 |
|---|---|---|
| **标准** | 没有任何权限。 | — |
| **较高** | 含 `ffmpeg`、`ytdlp`、`auth`、`tasks`、`browserRules`、`background` 任一项。 | 警告色徽标 |
| **完全** | 含 `desktop`。 | 危险色徽标 |

徽标显示在已安装插件和市场列表上。

## 授权

插件只会以你已授权的能力运行。

- **安装或更新。**安装（市场、`.fxplug`、目录）或更新插件时，若其权限或 `desktop.networkHosts` 不在你此前授权的范围内，FluxDown 会弹出授权对话框：风险徽标、逐项权限及其含义、网络主机列表。在你确认之前，插件保持禁用，原因为「需要授权」，插件行上会出现 **授权** 按钮。
- **完全信任。**对「完全」级插件，对话框会额外给出明确警告，勾选「我已了解」后才能确认。
- **市场安装。**市场安装前的确认就是同一个对话框；在那里确认即授予同一组权限，不会再问第二次。
- **更新只询问新增部分。**新版本增加了权限或网络主机时需要你确认；没有增加则不变。
- **升级 FluxDown。**授权功能出现之前安装的插件继续可用：它们当时拥有的权限会被记为已授权（在审计日志里标注为迁移）。之后新增的能力需要授权，而升级后才安装的插件绝不会被预先授权。
- **索引。**插件索引收录所有通过自动检查的插件，不做人工审核。索引条目带有权限与网络主机，若包内 manifest 与条目不一致，FluxDown 会拒绝该包。

授权是精确匹配的：你授权的集合必须与插件当前申请的一致。

## 完全信任：桌面脚本

视图的 `desktop` 脚本运行在桌面应用进程内，是 GPUI Shell 下的 ES module，**没有沙箱**。它能以你的用户权限读写文件、启动进程、访问网络和剪贴板。`networkHosts` 记录它打算联系的主机，并显示在授权对话框里，但那只是一份供你判断的声明，不是防火墙。

只有当你像信任任何下载后运行的程序那样信任作者时，才安装带 `desktop` 的插件。

**桌面脚本进行的原生文件、进程、网络操作不会逐次记录。**审计日志只记录桌面脚本被加载、被卸载，以及它发出的每一次 `fluxdown.call` / `fluxdown.invoke`——也就是它接触 FluxDown 的粗粒度边界——而它自己对操作系统做了什么则不在记录之内。

桌面脚本不会在 daemon、Web 端或移动端运行。

## 审计日志

打开 **设置 → 扩展 → 插件 → 审计日志**，或在插件详情里点 **审计记录** 只看该插件。每一行包含时间、来源（`daemon` 或 `desktop`）、动作、目标、结果（`ok`、`denied`、`error`）和详情。可以按插件筛选、加载更早的记录、复制为 JSON，以及清空（需确认）。

| 动作 | 时机 |
|---|---|
| `install`、`update`、`uninstall`、`enable`、`disable` | 生命周期变化。 |
| `consent.granted`、`consent.migrated` | 你授权了能力；或升级时记录了既有能力。 |
| `revoked` | 市场撤销了该插件。 |
| `breaker` | 插件被失败熔断器禁用。 |
| `fetch` | `flux.fetch`；目标为 `METHOD scheme://host/path`——去掉了查询串和凭据——详情为状态码。 |
| `auth.save`、`auth.remove` | 凭据变更。 |
| `fs.write`、`fs.remove` | 对插件临时工作区的写入。 |
| `ffmpeg.run`、`ffprobe.run`、`ytdlp.run` | 工具运行；目标为参数列表（已截短）。 |
| `task.retry`、`task.artifact` | 钩子发出的任务请求。 |
| `tasks.create`、`tasks.control` | `main` 里对 `flux.tasks` 的调用。 |
| `settings.update` | `flux.settings.update`。 |
| `desktop.load`、`desktop.unload` | 桌面脚本启动 / 停止；详情列出它运行时获得的授权。 |
| `desktop.call`、`desktop.invoke` | 桌面脚本发出的 RPC。 |
| `audit.clear` | 日志被清空。 |

读操作、`flux.storage` 和日志不会记录。超过 90 天的记录会被删除，日志最多保留最新 20,000 行。插件空闲时不会写入任何内容。
