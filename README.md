# DXF Viewer

中文 | [English](#english)

一个基于 React + Canvas 2D 的 DXF 查看器组件，支持作为 npm 库接入，也提供独立示例项目用于发布 Live Demo。

在线预览地址：

```text
https://zly258.github.io/dxfviewer/
```

## 功能特点

- 基于 React + Canvas 2D 渲染 DXF 图纸
- 支持作为 npm 库嵌入业务系统
- 支持完整应用壳 `AppShell`
- 支持核心查看器组件 `DxfViewer`
- 支持图层面板、属性面板、菜单栏、文件标签页
- 支持 TEXT / MTEXT 文本渲染
- 支持 SHX 字体解析和 Canvas path 渲染
- 支持 BigFont，例如 `Wcad.shx + HZtxt.shx`
- 支持独立 CSS 样式文件
- 支持库构建和 example 构建分离
- 支持 GitHub Actions 发布 Live Demo

## 安装

```bash
npm install @zhangly1403/dxfviewer
```

## 引入样式

库样式统一输出为一个独立 CSS 文件，使用方需要在应用入口引入一次：

```ts
import '@zhangly1403/dxfviewer/style.css';
```

这样可以避免把所有样式注入到单个 JS 大文件中，也方便业务系统自行处理 CSS。

## 使用完整查看器

适合直接嵌入一个完整 DXF 查看界面，包含菜单栏、文件标签、图层面板、画布、属性面板等。

```tsx
import { AppShell } from '@zhangly1403/dxfviewer';
import '@zhangly1403/dxfviewer/style.css';

export default function App() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <AppShell />
    </div>
  );
}
```

## 使用核心查看器组件

适合业务系统自己管理文件、标签页和外层布局，只把 DXF 查看区域嵌入页面中。

```tsx
import { DxfViewer } from '@zhangly1403/dxfviewer';
import '@zhangly1403/dxfviewer/style.css';

export default function App() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <DxfViewer
        initFile="/demo/test.dxf"
        fileName="test.dxf"
        lang="zh"
        showOpenMenu={false}
        onLoad={(data) => console.log('DXF 加载成功', data)}
        onError={(error) => console.error('DXF 加载失败', error)}
      />
    </div>
  );
}
```

## 直接打开 File 对象

```tsx
import { useState } from 'react';
import { DxfViewer } from '@zhangly1403/dxfviewer';
import '@zhangly1403/dxfviewer/style.css';

export default function App() {
  const [file, setFile] = useState<File | undefined>();

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <input
        type="file"
        accept=".dxf"
        onChange={(event) => setFile(event.target.files?.[0])}
      />
      <DxfViewer initFile={file} fileName={file?.name} />
    </div>
  );
}
```

## 导出内容

```ts
import {
  AppShell,
  DxfViewer,
  DxfViewerApp,
  DxfViewerMain,
  type AppShellProps,
  type DxfViewerProps,
} from '@zhangly1403/dxfviewer';
```

| 导出项 | 说明 |
| --- | --- |
| `DxfViewer` | 核心查看器组件，适合嵌入业务系统 |
| `DxfViewerMain` | `DxfViewer` 的兼容别名 |
| `AppShell` | 完整应用壳，包含标签页和全局打开文件能力 |
| `DxfViewerApp` | `AppShell` 的兼容别名 |

## DxfViewer Props

| 属性名 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `initFile` | `string \| File` | `undefined` | 初始加载的 DXF 文件 URL 或 File 对象 |
| `fileName` | `string` | `undefined` | 当前文件名，用于 loading、提示等显示 |
| `defaultLanguage` | `'en' \| 'zh'` | `'zh'` | 默认界面语言，非受控 |
| `lang` | `'en' \| 'zh'` | `undefined` | 当前界面语言，受控 |
| `onLanguageChange` | `(lang: Language) => void` | `undefined` | 语言切换回调 |
| `showOpenMenu` | `boolean` | `true` | 是否显示打开文件入口 |
| `tabStrip` | `React.ReactNode` | `undefined` | 外部传入的标签栏区域 |
| `onLoad` | `(data: any) => void` | `undefined` | DXF 加载成功回调 |
| `onError` | `(err: Error) => void` | `undefined` | DXF 加载或解析失败回调 |
| `onOpenFiles` | `(files: File[]) => void` | `undefined` | 外部接管打开文件时使用 |
| `onOpenFailed` | `(message: string) => void` | `undefined` | 打开失败回调，适合外层关闭失败标签页 |

## SHX 字体目录

项目不会内置商业字体文件。使用方需要把合法来源的 `.shx` 字体放到站点静态目录：

```text
public/fonts/shx/
```

示例：

```text
public/fonts/shx/Wcad.shx
public/fonts/shx/HZtxt.SHX
public/fonts/shx/TSSDENG.SHX
public/fonts/shx/TSSDCHN.SHX
public/fonts/shx/romans.shx
public/fonts/shx/romans2.shx
public/fonts/shx/SIMPLEX1.SHX
```

查看器会优先按 DXF 样式中的 `fontFileName`、`bigFontFileName` 加载 SHX。字体不存在或字形缺失时，会自动回退到系统字体。

典型字体组合：

```text
Wcad.shx + HZtxt.SHX
TSSDENG.SHX + TSSDCHN.SHX
romans.shx
simplex.shx
```

说明：

- 英文字体通常来自 `fontFileName`
- 中文大字体通常来自 `bigFontFileName`
- 例如 `Wcad.shx + HZtxt.SHX` 表示英文字体使用 `Wcad.shx`，中文使用 `HZtxt.SHX`
- 项目不需要 `manifest.json`
- 字体文件名大小写建议与 DXF 中保持一致

## 本仓库构建

### 构建库

```bash
npm run build
```

输出：

```text
dist/dxfviewer.js
dist/style.css
dist/index.d.ts
dist/chunks/vendor-shx-*.js
dist/chunks/viewer-loader-*.js
dist/chunks/viewer-render-*.js
dist/chunks/viewer-ui-*.js
```

构建策略：

```text
React / ReactDOM 作为 peerDependencies 外部化，不打入库产物
@mlightcad/shx-parser 单独拆分为 vendor-shx chunk
DXF 加载解析拆分为 viewer-loader chunk
Canvas / TEXT / MTEXT / SHX 渲染拆分为 viewer-render chunk
React 面板和应用壳拆分为 viewer-ui chunk
CSS 统一输出为 dist/style.css
```

这样可以避免把查看器、解析器、SHX 解析和样式全部塞进一个大 JS 文件。

### 构建示例项目

```bash
npm run build:example
```

执行顺序：

```text
先构建根项目 dist
再构建 dxfviewer-example
```

示例项目不是直接引用 `src` 源码，而是通过真实库入口消费根项目打包后的产物。

```text
dxfviewer-example
  ├─ package.json 使用 "@zhangly1403/dxfviewer": "file:.."
  ├─ import { AppShell } from '@zhangly1403/dxfviewer'
  ├─ import '@zhangly1403/dxfviewer/style.css'
  └─ 构建时实际使用 ../dist/dxfviewer.js 和 ../dist/style.css
```

这样可以验证 npm 用户真实使用到的库产物，而不是开发源码。

### 同时构建库和示例

```bash
npm run build:all
```

### 本地运行示例

```bash
npm run dev:example
```

### 预览示例构建产物

```bash
npm run preview:example
```

## GitHub Actions / Live Demo

仓库只保留一个工作流：

```text
.github/workflows/pages.yml
```

工作流执行：

```bash
npm ci
npm run build:all
```

然后发布下面目录到 GitHub Pages：

```text
dxfviewer-example/dist
```

发布规则：

```text
pull_request：只做构建校验，不发布 Pages
main / master：构建并发布 Live Demo
workflow_dispatch：支持手动触发发布
```

## GitHub Actions 网络源说明

如果 Actions 中出现类似错误：

```text
npm error network request to https://packages.applied-caas-gateway1.internal.api.openai.org/...
npm error code ETIMEDOUT
```

说明 CI 环境继承了错误的 npm registry 或代理配置。仓库根目录应提供 `.npmrc`，并在 `.github/workflows/pages.yml` 中显式固定 npm 官方源：

```ini
registry=https://registry.npmjs.org/
fund=false
audit=false
progress=false
fetch-retries=5
fetch-retry-factor=2
fetch-retry-mintimeout=20000
fetch-retry-maxtimeout=120000
```

Actions 中建议使用：

```bash
npm ci --registry=https://registry.npmjs.org/ --prefer-offline=false --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000
```

这样可以避免 CI 请求到不可访问的私有地址。

## 样式和包体积约定

```text
src/styles/index.css      库唯一样式入口
dist/style.css            库发布样式文件
dxfviewer-example         真实消费端示例，不直接引用 src 源码
.github/workflows/pages.yml  唯一 GitHub Actions 工作流
```

库产物保持 ES Module 输出，并通过 Rollup `manualChunks` 拆分模块。示例项目按真实使用方式消费 `dist` 产物，用于验证 npm 包导出、样式导出和 GitHub Pages Live Demo 发布。

## 目录结构

```text
dxfviewer/
  src/
    index.ts
    styles/
      index.css
    viewer/
    components/

  public/
    fonts/
      shx/

  dist/
    dxfviewer.js
    style.css
    index.d.ts
    chunks/

  dxfviewer-example/
    src/
    package.json
    vite.config.ts

  .github/
    workflows/
      pages.yml
```

---

# English

A DXF viewer component based on React and Canvas 2D. It can be used as an npm library and also includes a standalone example project for publishing a Live Demo.

Live demo:

```text
https://zly258.github.io/dxfviewer/
```

## Features

- React + Canvas 2D based DXF rendering
- Can be embedded as an npm library
- Provides a full application shell: `AppShell`
- Provides a core viewer component: `DxfViewer`
- Supports layer panel, property panel, menu bar, file tabs and canvas viewport
- Supports TEXT and MTEXT rendering
- Supports SHX font parsing and Canvas path rendering
- Supports BigFont, for example `Wcad.shx + HZtxt.shx`
- Outputs CSS as a standalone file
- Separates library build and example build
- Supports GitHub Actions deployment to GitHub Pages

## Installation

```bash
npm install @zhangly1403/dxfviewer
```

## Import Styles

The library style is emitted as a standalone CSS file. Import it once in your application entry:

```ts
import '@zhangly1403/dxfviewer/style.css';
```

This avoids injecting all styles into a single large JavaScript file and allows your application bundler to handle CSS normally.

## Use the Full Viewer

Use `AppShell` if you want a complete DXF viewer UI, including menu bar, file tabs, layer panel, canvas and property panel.

```tsx
import { AppShell } from '@zhangly1403/dxfviewer';
import '@zhangly1403/dxfviewer/style.css';

export default function App() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <AppShell />
    </div>
  );
}
```

## Use the Core Viewer Component

Use `DxfViewer` if your business application manages files, tabs and outer layout by itself.

```tsx
import { DxfViewer } from '@zhangly1403/dxfviewer';
import '@zhangly1403/dxfviewer/style.css';

export default function App() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <DxfViewer
        initFile="/demo/test.dxf"
        fileName="test.dxf"
        lang="en"
        showOpenMenu={false}
        onLoad={(data) => console.log('DXF loaded', data)}
        onError={(error) => console.error('Failed to load DXF', error)}
      />
    </div>
  );
}
```

## Open a File Object

```tsx
import { useState } from 'react';
import { DxfViewer } from '@zhangly1403/dxfviewer';
import '@zhangly1403/dxfviewer/style.css';

export default function App() {
  const [file, setFile] = useState<File | undefined>();

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <input
        type="file"
        accept=".dxf"
        onChange={(event) => setFile(event.target.files?.[0])}
      />
      <DxfViewer initFile={file} fileName={file?.name} />
    </div>
  );
}
```

## Exports

```ts
import {
  AppShell,
  DxfViewer,
  DxfViewerApp,
  DxfViewerMain,
  type AppShellProps,
  type DxfViewerProps,
} from '@zhangly1403/dxfviewer';
```

| Export | Description |
| --- | --- |
| `DxfViewer` | Core viewer component, suitable for embedding into business systems |
| `DxfViewerMain` | Compatibility alias of `DxfViewer` |
| `AppShell` | Full application shell with tabs and global file opening |
| `DxfViewerApp` | Compatibility alias of `AppShell` |

## DxfViewer Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `initFile` | `string \| File` | `undefined` | Initial DXF file URL or File object |
| `fileName` | `string` | `undefined` | Current file name, used in loading and messages |
| `defaultLanguage` | `'en' \| 'zh'` | `'zh'` | Default UI language, uncontrolled |
| `lang` | `'en' \| 'zh'` | `undefined` | Current UI language, controlled |
| `onLanguageChange` | `(lang: Language) => void` | `undefined` | Language change callback |
| `showOpenMenu` | `boolean` | `true` | Whether to show the open file entry |
| `tabStrip` | `React.ReactNode` | `undefined` | External tab strip area |
| `onLoad` | `(data: any) => void` | `undefined` | Called when DXF is loaded successfully |
| `onError` | `(err: Error) => void` | `undefined` | Called when DXF loading or parsing fails |
| `onOpenFiles` | `(files: File[]) => void` | `undefined` | Used when file opening is handled by the outer application |
| `onOpenFailed` | `(message: string) => void` | `undefined` | Called when opening fails, useful for closing failed tabs |

## SHX Font Directory

Commercial font files are not bundled. Put legally obtained `.shx` files in your site static directory:

```text
public/fonts/shx/
```

Example:

```text
public/fonts/shx/Wcad.shx
public/fonts/shx/HZtxt.SHX
public/fonts/shx/TSSDENG.SHX
public/fonts/shx/TSSDCHN.SHX
public/fonts/shx/romans.shx
public/fonts/shx/romans2.shx
public/fonts/shx/SIMPLEX1.SHX
```

The viewer loads SHX files by `fontFileName` and `bigFontFileName` from the DXF text style. If the font file does not exist or a glyph is missing, it falls back to system fonts.

Common font combinations:

```text
Wcad.shx + HZtxt.SHX
TSSDENG.SHX + TSSDCHN.SHX
romans.shx
simplex.shx
```

Notes:

- English letters usually come from `fontFileName`
- Chinese characters usually come from `bigFontFileName`
- `Wcad.shx + HZtxt.SHX` means English uses `Wcad.shx` and Chinese uses `HZtxt.SHX`
- `manifest.json` is not required
- It is recommended to keep file name casing consistent with the DXF file

## Build

### Build the Library

```bash
npm run build
```

Output:

```text
dist/dxfviewer.js
dist/style.css
dist/index.d.ts
dist/chunks/vendor-shx-*.js
dist/chunks/viewer-loader-*.js
dist/chunks/viewer-render-*.js
dist/chunks/viewer-ui-*.js
```

Build strategy:

```text
React / ReactDOM are externalized as peerDependencies
@mlightcad/shx-parser is split into the vendor-shx chunk
DXF loading and parsing are split into the viewer-loader chunk
Canvas / TEXT / MTEXT / SHX rendering is split into the viewer-render chunk
React panels and app shell are split into the viewer-ui chunk
CSS is emitted as dist/style.css
```

This avoids putting the viewer, parser, SHX parser and styles into a single large JavaScript file.

### Build the Example Project

```bash
npm run build:example
```

Execution order:

```text
Build root project dist first
Then build dxfviewer-example
```

The example project does not import source files from `src`. It consumes the built library output as a real package user would do.

```text
dxfviewer-example
  ├─ package.json uses "@zhangly1403/dxfviewer": "file:.."
  ├─ import { AppShell } from '@zhangly1403/dxfviewer'
  ├─ import '@zhangly1403/dxfviewer/style.css'
  └─ resolves to ../dist/dxfviewer.js and ../dist/style.css during build
```

### Build Library and Example

```bash
npm run build:all
```

### Run Example Locally

```bash
npm run dev:example
```

### Preview Example Build

```bash
npm run preview:example
```

## GitHub Actions / Live Demo

Only one workflow is kept:

```text
.github/workflows/pages.yml
```

The workflow runs:

```bash
npm ci
npm run build:all
```

Then publishes the following directory to GitHub Pages:

```text
dxfviewer-example/dist
```

Publishing rules:

```text
pull_request: build check only, no Pages deployment
main / master: build and publish Live Demo
workflow_dispatch: manual deployment
```

## GitHub Actions Registry Notes

If GitHub Actions reports an error like this:

```text
npm error network request to https://packages.applied-caas-gateway1.internal.api.openai.org/...
npm error code ETIMEDOUT
```

It means the CI environment inherited an incorrect npm registry or proxy configuration. Add `.npmrc` in the repository root and explicitly use the official npm registry in `.github/workflows/pages.yml`.

Recommended `.npmrc`:

```ini
registry=https://registry.npmjs.org/
fund=false
audit=false
progress=false
fetch-retries=5
fetch-retry-factor=2
fetch-retry-mintimeout=20000
fetch-retry-maxtimeout=120000
```

Recommended install command in Actions:

```bash
npm ci --registry=https://registry.npmjs.org/ --prefer-offline=false --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000
```

This prevents CI from requesting unavailable private registry addresses.

## Style and Bundle Size Conventions

```text
src/styles/index.css      The only library style entry
dist/style.css            Published style file
dxfviewer-example         Real consumer example, does not import src directly
.github/workflows/pages.yml  The only GitHub Actions workflow
```

The library keeps ES Module output and uses Rollup `manualChunks` to split modules. The example project consumes the built `dist` output to verify package exports, style exports and GitHub Pages Live Demo deployment.

## Project Structure

```text
dxfviewer/
  src/
    index.ts
    styles/
      index.css
    viewer/
    components/

  public/
    fonts/
      shx/

  dist/
    dxfviewer.js
    style.css
    index.d.ts
    chunks/

  dxfviewer-example/
    src/
    package.json
    vite.config.ts

  .github/
    workflows/
      pages.yml
```
