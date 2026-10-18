---
title: 插件 SDK 与 CLI
description: 用 @fluxdown/plugin-sdk 以 TypeScript 和 JSX 开发插件——类型、校验器、打包与封装。
section: plugins
order: 6
sourceHash: "3d30ffef1b48"
---

`@fluxdown/plugin-sdk` 是用 TypeScript 编写 FluxDown 插件的工具链：带类型的 `flux.*`、用于[可移植视图](/docs/zh/plugins/views/)的 JSX 运行时、与引擎和插件索引同一套的 manifest 校验器，以及负责打包、校验、封装 `.fxplug` 的 CLI。

不用它也行——一个只含 `.js` 文件的文件夹照样能用（见[写第一个插件](/docs/zh/plugins/your-first-plugin/)）。需要类型、多个源文件或用 JSX 写视图时再用它。

## 快速开始

```bash
npx @fluxdown/plugin-sdk create my-plugin --identity me@my-plugin --name "My Plugin"
cd my-plugin
npm install            # 或：bun install
npm run pack           # → me@my-plugin-0.1.0.fxplug
```

模板包含一个活动栏视图（用 JSX 写的计数器）和一个命令。试用方法：

1. 在 FluxDown 打开 **设置 → 扩展 → 插件**，用 **从目录安装**（开发模式）安装；构建后选择 `dist/` 目录。
2. 在权限对话框中授权（见[权限、授权与审计](/docs/zh/plugins/permissions/)）。
3. 运行 `npm run dev`，每次保存都会重建 `dist/`；manifest 有改动时，在插件行上点 **重新加载**。

## CLI

| 命令 | 作用 |
|---|---|
| `fluxdown-plugin create <dir> [--identity a@b] [--name "Name"] [--sdk <path>]` | 创建项目骨架。`--sdk` 链接本地 SDK 仓库，而不是已发布版本。 |
| `fluxdown-plugin build [dir]` | 把所有入口打包到 `dist/`，复制 manifest 与资源，然后校验。 |
| `fluxdown-plugin validate [dir]` | 按引擎规则校验 `dist/`，并输出风险等级与网络主机。 |
| `fluxdown-plugin pack [dir]` | 先 `build`，再把 `dist/` 打成 `<identity>-<version>.fxplug`（manifest 位于压缩包根）。 |
| `fluxdown-plugin dev [dir]` | 监听源码并重建 `dist/`。 |

`validate` 比客户端更严格，这两点插件索引同样要求：`version` 必须是纯 `MAJOR.MINOR.PATCH`；所有入口与图标都必须存在于包内。

## 项目结构

```
my-plugin/
  manifest.json                    你的 manifest（唯一来源，会复制到 dist/）
  fluxdown-plugin.config.json      打包哪些文件
  src/main.tsx                     常驻 main 脚本
  src/resolve.ts                   resolver 入口
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

| 键 | 含义 |
|---|---|
| `entries` | classic 脚本，`dist 内输出路径 → 源文件`。以 ES2022 打成单个 IIFE：不会留下任何 `import` / `export`，因为引擎把它们当作 classic 脚本执行。用于 `main`、resolver、hooks、`auth` 与订阅。 |
| `desktop` | 桌面 UI 脚本（`contributes.views[].desktop.entry`），打成 ES module。桌面运行时提供的宿主模块 `gpui-kit`、`gpui`、`gpui-base`、`gpui-component`、`gpui-shell`、`gpui-fps`、`fluxdown`，以及 Node 风格内建模块（`buffer`、`console`、`crypto`、`fs/promises`、`net`、`os`、`path`、`process`、`url`、`websocket`、`zlib`）保持为裸 import。 |
| `assets` | 原样复制的额外文件（例如嗅探规则包）。manifest 中提到但没有被构建的文件（入口、`icon`、`sniffRules`）会自动复制。 |

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

新增 `src/env.d.ts`，内容为 `/// <reference types="@fluxdown/plugin-sdk" />`，即可引入全局 `flux`。不要启用 DOM lib：QuickJS 宿主没有 DOM。

## 入口辅助函数

引擎读取固定的全局名（`resolve`、`onDone`、`authenticate`、`subscribe` 等）。`@fluxdown/plugin-sdk/runtime` 里的辅助函数会把你的函数安装到这些全局名上，这样每个入口文件都可以写成普通模块：

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

`defineMain(setup)` 会立即执行 `setup(flux)`，仅为写法对称；`main` 脚本通过 `flux.ui`、`flux.commands`、`flux.rpc`、`flux.events`、`flux.timers` 注册视图、命令、rpc 处理器、事件与定时器。

## JSX

按上面设置 `jsxImportSource` 后，每个小写标签都是一个[视图节点](/docs/zh/plugins/views/#节点参考)，类型直接来自 daemon 校验所用的同一份 schema：

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

`key` 会成为 `p.key`（不是普通 prop），并决定节点 id。`null`、`false`、`undefined` 子节点会被丢弃，嵌套数组会被展平，`<>…</>` 把子节点并入父节点。产出的形状与 `flux.ui.h` 完全一致：`{k, p, c}`。

## 随包提供的类型

- `flux` 及其子 API、入口上下文（`ResolveContext`、`AuthContext` 等）和视图类型——来自 `@fluxdown/plugin-sdk`。
- `ThemeTokenPath`——`fluxdown.theme().tokens` 解析出的全部主题 token 路径，由主题注册表生成。
- `@fluxdown/plugin-sdk/types/desktop`——桌面 UI 脚本（`gpui-kit` 等）的声明，由桌面运行时生成。

## 校验器 API

manifest 校验器也作为零依赖模块导出：

```ts
import { validateManifest, riskOf, networkHostsOf, validateSniffPack } from "@fluxdown/plugin-sdk/manifest";

const { ok, errors } = validateManifest(manifest, new Set(["main.js"]));
riskOf(manifest);          // "standard" | "elevated" | "full"
networkHostsOf(manifest);  // 所有视图 desktop.networkHosts 的排序并集
```

规则与引擎一致，并由同一组测试用例校对。`validateManifest(manifest, files, { strict: true })` 会加上上文所述的上架级检查。
