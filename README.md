# DXF Viewer

语言 / Language: [中文](#中文) | [English](#english)

预览 / Preview: [https://zly258.github.io/dxfviewer/](https://zly258.github.io/dxfviewer/)

---

## 中文

DXF Viewer 是一个基于 React 和 HTML5 Canvas 的 DXF 查看组件，提供核心查看器、多 Tab 工作区和示例工程。项目专注 DXF 解析、浏览、图层显示、文字搜索和移动端查看，不提供 CAD 编辑能力。

### 主要功能

- 支持 `Model` 模型空间和多个 `Layout` 图纸空间，空图纸空间不显示且不可切换。
- 支持多 Tab 工作区 `DxfWorkspace`，也支持单独嵌入核心查看器 `DxfViewer`。
- 支持桌面端顶部工具栏和移动端右侧工具栏，移动端不使用底部抽屉。
- 支持系统主题、浅色主题、深色主题，以及图纸原色 / 黑白模式。
- 支持图层面板、属性面板、右键菜单、隐藏选中、隔离选中、关闭图层、全部显示。
- 支持视图历史，上一个视图 / 下一个视图 / 充满视图。
- 支持当前空间文字搜索和定位，搜索结果使用内缩式轻量高亮。
- 支持常用 DXF 实体渲染：线、射线、构造线、点、圆、圆弧、椭圆、多段线、样条、填充、文字、多行文字、属性、块参照、标注、引线、多重引线、表格、图片、遮罩、视口等。
- 兼容 SHX 字体名，但不加载真实 `.shx` 字形文件，统一映射到系统字体渲染。
- 保留早期稳定的文字对齐链路：非 MTEXT 文字按 72 / 73 组码解析水平和垂直对齐，FIT / ALIGNED 使用第二对齐点。

### 安装

```bash
npm install @zhangly1403/dxfviewer
```

React 和 React DOM 是 peer dependencies，需要宿主项目自行安装：

```bash
npm install react react-dom
```

### 引入样式

```ts
import '@zhangly1403/dxfviewer/style.css';
```

### 使用核心查看器

```tsx
import { DxfViewer } from '@zhangly1403/dxfviewer';
import '@zhangly1403/dxfviewer/style.css';

export default function Page() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <DxfViewer initFile="/demo.dxf" fileName="demo.dxf" />
    </div>
  );
}
```

### 使用多 Tab 工作区

```tsx
import { DxfWorkspace } from '@zhangly1403/dxfviewer';
import '@zhangly1403/dxfviewer/style.css';

export default function App() {
  return <DxfWorkspace />;
}
```

### 主要导出

| 名称 | 说明 |
| --- | --- |
| `DxfViewer` | 核心 DXF 查看组件。 |
| `DxfWorkspace` | 带多 Tab、打开文件入口和查看器工具栏的完整工作区。 |
| `parseDxf` | DXF 文本解析函数。 |
| `DxfViewerProps` | `DxfViewer` 属性类型。 |
| `DxfWorkspaceProps` | `DxfWorkspace` 属性类型。 |
| `DxfTabSource` | 多 Tab 初始文件来源类型。 |

### 常用脚本

```bash
npm ci
npm run typecheck
npm run build
npm run dev
npm run build:example
npm run build:all
```

说明：`dxfviewer-example` 是真实示例工作区，完整仓库中会存在该目录。根目录的 `package-lock.json` 已保留 workspace 链接，支持包含示例工程时执行 `npm ci`。

### 项目结构

```text
src/
  components/
    viewer/        查看器、工具栏、图层面板、属性面板和移动端控制
    workspace/     多 Tab 工作区与 Tab 状态逻辑
  config/          常量、主题和文案配置
  core/            DXF 解析、几何、文本布局
  renderer/        Canvas 实体绘制和渲染服务
  styles/          统一样式
  types/           公共类型定义
  utils/           颜色、线型、字体、搜索和实体辅助函数
```

### 限制说明

- 当前项目只做 DXF 查看、解析和渲染，不做 DXF 写出和 CAD 编辑。
- 图纸空间已支持实体切换，但复杂 `VIEWPORT` 的模型空间投影视口仍属于后续增强方向。
- SHX 只做字体名兼容和系统字体映射，不加载真实 SHX 字形文件。
- 源码和 README 使用 UTF-8 with BOM；`package.json`、`package-lock.json` 等 npm 配置文件保持标准 UTF-8，避免 npm / Vite 解析问题。

---

## English

DXF Viewer is a React and HTML5 Canvas based DXF viewing component. It provides a core viewer, a multi-tab workspace, and an example workspace. The project focuses on DXF parsing, viewing, layer visibility, text search, and mobile viewing. It does not provide CAD editing features.

### Features

- Supports `Model` space and multiple `Layout` paper spaces. Empty paper spaces are hidden and cannot be switched to.
- Provides `DxfWorkspace` for multi-tab viewing and `DxfViewer` for direct embedding.
- Provides a desktop top toolbar and a mobile right-side toolbar. Mobile mode does not use bottom drawers.
- Supports system, light, and dark UI themes, plus original / monochrome drawing color modes.
- Supports layer panel, property panel, context menu, hide selected, isolate selected, turn off layer, and show all.
- Supports view history, previous view, next view, and fit view.
- Supports text search and navigation in the current space, with compact inset highlight.
- Renders common DXF entities: line, ray, xline, point, circle, arc, ellipse, polyline, spline, hatch, text, mtext, attribute, block reference, dimension, leader, multileader, table, image, wipeout, viewport, and more.
- Recognizes SHX font names but does not load real `.shx` glyph files. Fonts are mapped to system font stacks.
- Keeps the earlier stable text-alignment path: non-MTEXT text uses group codes 72 / 73 for horizontal and vertical alignment, and FIT / ALIGNED text uses the second alignment point.

### Installation

```bash
npm install @zhangly1403/dxfviewer
```

React and React DOM are peer dependencies and must be installed by the host project:

```bash
npm install react react-dom
```

### Import styles

```ts
import '@zhangly1403/dxfviewer/style.css';
```

### Use the core viewer

```tsx
import { DxfViewer } from '@zhangly1403/dxfviewer';
import '@zhangly1403/dxfviewer/style.css';

export default function Page() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <DxfViewer initFile="/demo.dxf" fileName="demo.dxf" />
    </div>
  );
}
```

### Use the multi-tab workspace

```tsx
import { DxfWorkspace } from '@zhangly1403/dxfviewer';
import '@zhangly1403/dxfviewer/style.css';

export default function App() {
  return <DxfWorkspace />;
}
```

### Main exports

| Name | Description |
| --- | --- |
| `DxfViewer` | Core DXF viewer component. |
| `DxfWorkspace` | Full workspace with tabs, file opening, and viewer toolbar. |
| `parseDxf` | DXF text parser. |
| `DxfViewerProps` | Props type for `DxfViewer`. |
| `DxfWorkspaceProps` | Props type for `DxfWorkspace`. |
| `DxfTabSource` | Initial file source type for multi-tab usage. |

### Scripts

```bash
npm ci
npm run typecheck
npm run build
npm run dev
npm run build:example
npm run build:all
```

Note: `dxfviewer-example` is a real example workspace and exists in the full repository. The root `package-lock.json` keeps the workspace link entries so `npm ci` works when the example workspace is present.

### Project structure

```text
src/
  components/
    viewer/        Viewer, toolbar, layer panel, property panel, and mobile controls
    workspace/     Multi-tab workspace and tab state logic
  config/          Constants, theme, and UI text
  core/            DXF parsing, geometry, and text layout
  renderer/        Canvas entity renderers and rendering services
  styles/          Shared styles
  types/           Public types
  utils/           Color, linetype, font, search, and entity helpers
```

### Limitations

- The project provides DXF viewing, parsing, and rendering only. It does not provide DXF writing or CAD editing.
- Paper-space switching is supported, but full `VIEWPORT` model-space projection is still a future enhancement.
- SHX is handled as font-name compatibility only. Real SHX glyph files are not loaded.
- Source files and README use UTF-8 with BOM. npm configuration files such as `package.json` and `package-lock.json` remain standard UTF-8 to avoid npm / Vite parsing issues.
