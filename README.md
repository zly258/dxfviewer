# DXF Viewer

一个基于 React + Canvas 2D 的 DXF 查看器组件，支持作为 npm 库接入，也提供独立示例项目用于发布 Live Demo。

在线预览地址：

```text
https://zly258.github.io/dxfviewer/
```

## 作为库使用

### 安装

```bash
npm install @zhangly1403/dxfviewer
```

### 引入样式

从 `1.5.3` 开始，库样式统一合并为一个入口文件，并在构建时抽取为独立 CSS。使用方需要在应用入口手动引入一次：

```ts
import '@zhangly1403/dxfviewer/style.css';
```

这样可以避免把所有样式注入到单个 JS 大文件里，也方便业务项目按自己的构建规则处理 CSS。项目内部只保留 `src/styles/index.css` 一个样式入口，使用方只需要记住 `@zhangly1403/dxfviewer/style.css`。

### 使用完整查看器

适合直接嵌入一个完整 DXF 查看界面：包含菜单栏、文件标签、图层面板、画布、属性面板等。

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

### 使用核心查看器组件

适合业务系统自己管理文件、标签页和外层布局，只把 DXF 查看区域嵌入到页面中。

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

### 直接打开 File 对象

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

说明：

| 导出项 | 说明 |
| --- | --- |
| `DxfViewer` | 核心查看器组件，适合嵌入业务系统 |
| `DxfViewerMain` | `DxfViewer` 的兼容别名 |
| `AppShell` | 完整应用壳，包含标签页和全局打开文件能力 |
| `DxfViewerApp` | `AppShell` 的别名 |

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
```

查看器会优先按 DXF 样式中的 `fontFileName`、`bigFontFileName` 加载 SHX。字体不存在或字形缺失时，会自动回退到系统字体。

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

库构建策略：

```text
React / ReactDOM 作为 peerDependencies 外部化，不打入库产物
@mlightcad/shx-parser 单独拆分为 vendor-shx chunk
DXF 加载解析拆分为 viewer-loader chunk
Canvas / TEXT / MTEXT / SHX 渲染拆分为 viewer-render chunk
React 面板和应用壳拆分为 viewer-ui chunk
CSS 统一输出为 dist/style.css
```

这样避免把查看器、解析器、SHX 解析和样式全部塞进一个大 JS 文件。

### 构建示例项目

```bash
npm run build:example
```

执行顺序：

```text
先构建根项目 dist
再构建 dxfviewer-example
```

示例项目不是引用 `src` 源码，而是通过 `file:..` 安装根包，并通过 Vite alias 指向根项目已经打包出来的产物：

```text
dxfviewer-example
  ├─ package.json 使用 "@zhangly1403/dxfviewer": "file:.."
  ├─ import { AppShell } from '@zhangly1403/dxfviewer'
  ├─ import '@zhangly1403/dxfviewer/style.css'
  └─ 构建时实际解析到 ../dist/dxfviewer.js 和 ../dist/style.css
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

工作流会执行：

```bash
npm ci
npm run build:all
```

然后把下面目录发布到 GitHub Pages：

```text
dxfviewer-example/dist
```

`pull_request` 只做构建校验，不发布 Pages；`main`、`master` 或手动触发会构建并发布 Live Demo。

## 样式和包体积约定

```text
src/styles/index.css      库唯一样式入口
dist/style.css            库发布样式文件
dxfviewer-example         真实消费端示例，不直接引用 src 源码
.github/workflows/pages.yml  唯一 GitHub Actions 工作流
```

库产物保持 ES Module 输出，并通过 Rollup `manualChunks` 拆分模块。示例项目也按真实使用方式消费 `dist` 产物，用于验证 npm 包导出、样式导出和 GitHub Pages Live Demo 发布。
