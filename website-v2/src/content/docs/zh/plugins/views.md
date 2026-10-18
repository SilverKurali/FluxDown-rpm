---
title: 视图、命令与 UI API
description: 由桌面端与 Web 端原生渲染的可移植插件视图、命令，以及常驻 main 脚本。
section: plugins
order: 7
sourceHash: "4aa2c96785c9"
---

插件不需要自带任何 UI 代码也能展示界面。常驻的 **`main` 脚本**返回一棵数据节点树，FluxDown 桌面端（GPUI）和 Web 端用各自的原生控件、按当前主题渲染它。树就是数据，所以同一个视图在各端都能用。移动端保留了协议，但暂不渲染插件视图。

`main` 运行在 daemon 里，因此即使没有打开任何窗口，视图、命令和后台逻辑也能工作。它按需启动（打开视图、执行命令、`main.events` 中列出的事件），空闲五分钟后关闭；manifest 设置 `main.background` 时常驻（需要 `background` 权限）。

## 声明视图与命令

```json
{
  "permissions": [],
  "main": { "entry": "main.js", "events": ["onDone"] },
  "contributes": {
    "views": [
      { "id": "dashboard", "title": "看板", "location": "activity" },
      { "id": "options", "title": "选项", "location": "settings" },
      { "id": "files", "title": "文件", "location": "taskDetail" }
    ],
    "commands": [{ "id": "refresh", "title": "刷新", "palette": true, "taskMenu": true }]
  }
}
```

| `location` | 出现位置 |
|---|---|
| `activity` | 活动栏中的一个页面（桌面端与 Web 端默认位置相同）。 |
| `settings` | 插件设置对话框里、基础设置表单旁的一个页签。每个插件至多一个。 |
| `taskDetail` | 任务详情面板的一个页签；视图通过 `ctx.taskId` 拿到所选任务。 |
| `window` | 独立窗口（仅桌面实现；见下文）。 |

`palette: true` 的命令出现在桌面命令面板里（Web 端则是插件页面上的按钮）；`taskMenu: true` 会加入任务右键菜单，处理函数能拿到所选任务 id。全部校验规则见 [Manifest 参考](/docs/zh/plugins/manifest/#contributes)。

## `main` 脚本

`main` 是 classic 脚本，求值期间通过 `flux.*` 完成全部注册。

```js
flux.ui.view("dashboard", {
  init: async (ctx) => ({ tasks: await flux.tasks.list() }),   // 需要 `tasks` 权限
  render: (state, ctx) =>
    flux.ui.h("stack", { gap: "md", padding: "md" },
      flux.ui.h("heading", { text: "任务" }),
      flux.ui.h("table", {
        columns: [{ key: "name", title: "名称" }, { key: "size", title: "大小", kind: "bytes" }],
        rows: state.tasks.map((t) => ({ key: t.id, name: t.fileName, size: t.totalBytes })),
      })),
  event: async (state, ev, ctx) => { if (ev.type === "press") state.tasks = await flux.tasks.list(); },
  dispose: (state) => {},
});

flux.commands.register("refresh", async ({ taskIds }) => { /* … */ });
flux.rpc.handle("ping", async (args) => ({ pong: args }));
flux.events.on("onDone", async (ev) => flux.ui.toast("success", `完成：${ev.url}`));
const timer = flux.timers.setInterval(() => flux.logger.info("tick"), 60000);
```

| API | 说明 |
|---|---|
| `flux.ui.view(id, { init, render, event, dispose })` | `id` 必须与已声明的视图一致。`init`、`render`、`event`、`dispose` 可同步也可异步。state 默认为 `{}`。 |
| `ctx` | `{ session, props, taskId, locale, refresh() }`。视图未关联任务时 `taskId` 为 `null`。`refresh()` 请求重新渲染。 |
| `event(state, ev, ctx)` | `ev = { node, type, value?, key?, action? }`。原地修改 `state`，或返回一个值来替换它。之后会自动重新渲染。 |
| `flux.ui.h(kind, props, ...children)` / `flux.ui.Fragment` | 构造 `{k, p, c}` 节点；子节点会被展平，`null` / `false` 被丢弃。JSX（见 [SDK](/docs/zh/plugins/sdk/#jsx)）产出相同形状。 |
| `flux.ui.toast(level, text)` | `info`、`success`、`warning` 或 `error`。 |
| `flux.commands.register(id, handler)` | 处理函数收到 `{ taskIds }`。 |
| `flux.rpc.handle(name, handler)` | 可由你自己的桌面视图用 `fluxdown.invoke(name, args)` 调用。结果必须可 JSON 序列化。 |
| `flux.events.on(name, handler)` | `name` 必须在 `main.events` 中。处理完成后已打开的视图会重新渲染。 |
| `flux.timers.setTimeout / setInterval / clear` | 至多 64 个定时器。有视图打开时 interval 被钳制到 ≥ 1 秒，否则 ≥ 60 秒。 |
| `flux.tasks.*` | `list`、`get`、`create`、`pause`、`resume`、`remove(id, deleteFiles)`。需要 `tasks` 权限。`create` 限每分钟 20 次。 |
| `flux.settings.update({ key: "value" })` | 写入你插件的设置（按 `manifest.settings` 校验）。 |

每个视图会话最多每 100 毫秒渲染一次，期间的请求会合并。会话 90 秒收不到保活就会被关闭。daemon 只向客户端发送两次渲染之间的**差异**，所以大表格也很轻。

单次调用墙钟超过 30 秒、CPU 超过两秒，或脚本内存超过 64 MiB，都会和其他插件脚本一样计入同一个熔断器。

## 节点参考

每个节点都可以带 `key`（字符串或数字）。节点 id 由树结构推导：根为 `root`，子节点为 `<父 id>/<key>`——没有 key 时用下标。兄弟节点的 key 不能重复。凡是会触发事件的节点、表格行和列表项都应使用稳定的 key，这是增量更新的基础。

未知 prop 会被拒绝。色调为 `neutral`、`accent`、`success`、`warning`、`danger`、`info`、`muted`，随当前主题变化。尺寸（`gap`、`padding`）为 `none`、`xs`、`sm`、`md`、`lg`、`xl`。

| 类型 | Props（默认值） | 子节点 | 事件 |
|---|---|---|---|
| `stack` | `direction` row \| column（column）、`gap`（sm）、`align` start \| center \| end \| stretch（stretch）、`justify` start \| center \| end \| between（start）、`wrap`、`padding`（none）、`grow` | 是 | — |
| `scroll` | `maxHeight` | 是 | — |
| `card` | `title`、`padding`（md） | 是 | — |
| `section` | `title`（必填）、`description` | 是 | — |
| `divider` | — | 否 | — |
| `text` | `text`（必填）、`tone`（neutral）、`size` xs–xl（sm）、`weight` normal \| medium \| semibold（normal）、`mono`、`truncate` | 否 | — |
| `heading` | `text`（必填）、`level` 1–3（2） | 否 | — |
| `markdown` | `text`（必填）——只支持段落和代码块 | 否 | — |
| `code` | `text`（必填） | 否 | — |
| `link` | `text`、`href`——仅 `http:` / `https:` | 否 | — |
| `image` | `src`——`data:image/(png\|jpeg\|webp);base64,…`，至多 1 MiB；`alt`、`width`、`height` | 否 | — |
| `badge` | `text`、`tone` | 否 | — |
| `progress` | `value` 0–1 或 `null`（不确定进度）、`label` | 否 | — |
| `spinner` | `label` | 否 | — |
| `kv` | `items` `[{ key, value }]` | 否 | — |
| `callout` | `tone`（info）、`title`、`text` | 否 | — |
| `empty` | `title`、`description` | 否 | — |
| `button` | `text`、`variant` primary \| outline \| ghost \| danger（outline）、`disabled`、`loading` | 否 | `press` |
| `switch` / `checkbox` | `label`、`checked`、`disabled` | 否 | `change` `{ value: boolean }` |
| `select` | `options` `[{ value, label }]`、`value`、`placeholder`、`disabled` | 否 | `change` `{ value }` |
| `input` | `value`、`placeholder`、`kind` text \| password \| number（text）、`disabled` | 否 | `change` `{ value }`（去抖 300 毫秒）、`submit` `{ value }` |
| `textarea` | `value`、`placeholder`、`rows` 1–50（4）、`disabled` | 否 | `change` `{ value }`（去抖 300 毫秒） |
| `tabs` | `items` `[{ value, label }]`、`value`——所选 value 对应的内容由你渲染 | 否 | `change` `{ value }` |
| `table` | `columns` `[{ key, title, kind, width }]`、`rows` `[{ key, … }]`、`rowActions` `[{ id, label, tone }]`、`emptyText` | 否 | `rowAction` `{ key, action }`、`select` `{ key }` |
| `list` | `items` `[{ key, title, description, badge, tone }]` | 否 | `select` `{ key }` |

表格列 `kind`：`text`、`bytes`、`speed`、`percent`（输入 0–1）、`progress`（进度条）、`time`（unix 毫秒）或 `badge`（字符串，或 `{ text, tone }`）。

上限：5,000 个节点、深度 64、表格 10,000 行、列表 5,000 项。违反 schema 的树不会显示，视图会显示错误，下一次合法的渲染会让它恢复。

### 输入框与重新渲染

`input` 会保留用户正在输入的内容：重新渲染不会覆盖正在聚焦的输入框，也不会覆盖与用户最近一次发送值相同的内容。在 `change` 事件里把 `value` 存入 state 再渲染回去——这就是常规的受控输入写法。

## 仅桌面的实现

视图还可以声明 `desktop` 入口（需要 `desktop` 权限）：由桌面端内的 GPUI Shell 运行的 ES module，用于更丰富的完全原生界面。视图同时有两种实现时，桌面端使用 desktop 入口，Web 端使用可移植的 `main` 视图。只有 `desktop` 的视图在 Web 端显示「仅桌面」卡片。桌面脚本以**完全信任**运行——发布前请阅读[权限、授权与审计](/docs/zh/plugins/permissions/)。

在桌面脚本里可以 `import { identity, call, invoke, theme, locale, toast } from "fluxdown"`：

| 函数 | 用途 |
|---|---|
| `identity()` | 本插件的 identity。 |
| `call(method, params)` | 调用本地 `daemon.*` / `agent.*` RPC。 |
| `invoke(name, args)` | 调用你在 `main` 脚本里用 `flux.rpc.handle` 注册的处理器。 |
| `theme()` | `{ revision, tokens }`——所有已解析的主题 token（颜色为 `#rrggbbaa`，尺寸为数字）。主题变化时重新读取。 |
| `locale()` | 界面语言。 |
| `toast(level, text)` | 在当前窗口显示通知。 |

FluxDown 会保持自己的主题生效：脚本若替换了全局主题，会被恢复，插件无法永久改变应用外观。
