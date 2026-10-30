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

只需要解析能力、且不希望加载 React、查看器 UI 或样式时，可使用轻量入口：

```ts
import { parseDxf, EntityType } from '@zhangly1403/dxfviewer/parser';
```

`parseDxf` 继续兼容原有两个参数，并支持可选的第三个参数配置取消信号、进度节流和事件循环让步。

### 写出 DXF 与导出 PNG / PDF

除查看外，库还提供三个独立轻量入口，均不依赖 React 与样式：

```ts
// 1) 写出 DXF：以 DxfData 为数据源重建一份规范文件（默认 AC1015，可降级 AC1009/R12）
import { writeDxf, writeDxfBlob } from '@zhangly1403/dxfviewer/writer';
const { content, skipped } = writeDxf(data, { version: 'AC1015' });

// 2) 无头渲染：不依赖 React，可在 Web Worker 中使用
import { renderSceneToCanvas } from '@zhangly1403/dxfviewer/render';

// 3) 导出：PNG / 栅格 PDF / 矢量 PDF / 矢量 SVG（零运行时依赖）
import { exportPng, exportPdf, exportPdfVector, exportSvg } from '@zhangly1403/dxfviewer/export';
const png = await exportPng(data, { width: 1920, height: 1080, background: 'white' });
const pdf = await exportPdf(data, { paperSize: 'A3', orientation: 'landscape', marginMm: 10, dpi: 300 });
const vector = await exportPdfVector(data, { paperSize: 'A3', title: '出图' }); // 几何全矢量
const svg = exportSvg(data, { width: 800, height: 600 }); // 同步、纯文本、无限放大
```

`writeDxf` 是**重建式写出**：以 `DxfData` 为准重新生成文件，源文件中未建模的信息（XDATA、未识别的表/对象、扩展词典）不会保留；无法写出或需要降级的实体通过返回值 `skipped` 显式报告。默认输出 `AC1015 (AutoCAD 2000)`；传 `version: 'AC1009'` 输出 R12，此时 LWPOLYLINE→POLYLINE、MTEXT→TEXT、HATCH→边界轮廓线（常用图案按内置 `acad.pat` 子集输出定义线）、ELLIPSE/SPLINE→离散多段线。

需要「打开 → 修改 → 另存不丢信息」时，使用保真往返：解析时开启 `preserveRaw` 采集每个实体的源组码快照，写出时开启 `preserveRaw` 原样回放（句柄仍会统一重编以保证唯一性，几何未改动的实体完全保真）：

```ts
import { parseDxf } from '@zhangly1403/dxfviewer/parser';
import { writeDxf } from '@zhangly1403/dxfviewer/writer';

const data = await parseDxf(text, undefined, { preserveRaw: true }); // 内存约 +40%
// ... 任意修改 data（改图层/删实体/改几何），未改动的实体保留 raw 快照
const { content } = writeDxf(data, { preserveRaw: true });
```

也可以不读任何文件，直接用构建器从零生成图纸：

```ts
import { createDocument } from '@zhangly1403/dxfviewer/writer';

const doc = createDocument({ version: 'AC1015', units: 4 }); // 4 = mm
doc.addLayer({ name: 'WALL', color: 1 })
   .addLine({ layer: 'WALL', start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } })
   .addCircle({ center: { x: 500, y: 500 }, radius: 200 })
   .addText({ position: { x: 0, y: 20 }, height: 50, value: '标题' })
   .addBlock({ name: 'BOLT', basePoint: { x: 0, y: 0 }, build: b => {
     b.addCircle({ center: { x: 0, y: 0 }, radius: 5 });
   } })
   .addInsert({ blockName: 'BOLT', position: { x: 100, y: 100 }, rotation: 45 });

const dxf = doc.toDxfString();   // { content, skipped }
const data = doc.toDxfData();    // 可直接喂给 <DxfViewer> 预览
```

### 常用脚本

```bash
npm ci
npm run typecheck        # tsc --noEmit
npm run build            # 构建库（含 .d.ts）
npm run check            # 构建 + 夹具解析 + 渲染/导出冒烟 + 读写往返校验
npm run check:fixtures   # 解析 samples/dxf/*.dxf
npm run check:render     # 无头渲染 + PNG/PDF 结构与尺寸校验
npm run check:roundtrip  # parse → writeDxf → parse 逐实体几何比对
npm run dev              # 启动示例工程
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
  core/            DXF 解析（parser）、写出（writer）、组码注册表与几何、文本布局
  renderer/        Canvas 实体绘制、渲染服务与无头渲染入口
  export/          PNG / PDF 导出
  styles/          统一样式
  types/           公共类型定义
  utils/           颜色、线型、字体、搜索和实体辅助函数
samples/dxf/       解析与读写往返测试夹具
scripts/           自动化自检脚本（check:*）
```

### 限制说明

- 查看与渲染专注浏览，不提供 CAD 编辑能力；`writeDxf` 为重建式写出，不保留源文件未建模的信息。
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

For parsing without React, viewer UI, or CSS, use the lightweight entry:

```ts
import { parseDxf, EntityType } from '@zhangly1403/dxfviewer/parser';
```

The existing two-argument `parseDxf` calls remain supported. An optional third argument can configure cancellation, progress throttling, and event-loop yielding.

### Write DXF and export PNG / PDF

Besides viewing, the library ships three lightweight subpath entries without React or CSS:

```ts
// 1) Write DXF: rebuild a spec-compliant file from DxfData (AC1015 default, AC1009/R12 fallback)
import { writeDxf, writeDxfBlob } from '@zhangly1403/dxfviewer/writer';
const { content, skipped } = writeDxf(data, { version: 'AC1015' });

// 2) Headless rendering: React-free, usable inside a Web Worker
import { renderSceneToCanvas } from '@zhangly1403/dxfviewer/render';

// 3) Export: PNG / raster PDF / vector PDF / vector SVG (zero runtime dependencies)
import { exportPng, exportPdf, exportPdfVector, exportSvg } from '@zhangly1403/dxfviewer/export';
const png = await exportPng(data, { width: 1920, height: 1080, background: 'white' });
const pdf = await exportPdf(data, { paperSize: 'A3', orientation: 'landscape', marginMm: 10, dpi: 300 });
const vector = await exportPdfVector(data, { paperSize: 'A3', title: 'Drawing' }); // fully vector geometry
const svg = exportSvg(data, { width: 800, height: 600 }); // synchronous, plain text, infinitely scalable
```

`writeDxf` performs **reconstructive writing**: it regenerates the file from `DxfData`; information not modeled by the parser (XDATA, unrecognized tables/objects, extension dictionaries) is not preserved. Entities that cannot be written or require degradation are reported through the returned `skipped` list. The default output is `AC1015 (AutoCAD 2000)`; pass `version: 'AC1009'` for R12, where LWPOLYLINE→POLYLINE, MTEXT→TEXT, HATCH→boundary outline (common patterns emit definition lines from a built-in `acad.pat` subset), and ELLIPSE/SPLINE→sampled polylines.

For "open → modify → save without losing information", use faithful round-trip: enable `preserveRaw` while parsing to capture a snapshot of each entity's source group codes, then enable it while writing to replay them verbatim (handles are still reallocated to keep them unique; untouched entities stay fully faithful):

```ts
import { parseDxf } from '@zhangly1403/dxfviewer/parser';
import { writeDxf } from '@zhangly1403/dxfviewer/writer';

const data = await parseDxf(text, undefined, { preserveRaw: true }); // ~+40% memory
// ... modify data freely; untouched entities keep their raw snapshots
const { content } = writeDxf(data, { preserveRaw: true });
```

You can also generate a drawing from scratch with the builder, without reading any file:

```ts
import { createDocument } from '@zhangly1403/dxfviewer/writer';

const doc = createDocument({ version: 'AC1015', units: 4 }); // 4 = mm
doc.addLayer({ name: 'WALL', color: 1 })
   .addLine({ layer: 'WALL', start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } })
   .addCircle({ center: { x: 500, y: 500 }, radius: 200 })
   .addText({ position: { x: 0, y: 20 }, height: 50, value: 'Title' })
   .addBlock({ name: 'BOLT', basePoint: { x: 0, y: 0 }, build: b => {
     b.addCircle({ center: { x: 0, y: 0 }, radius: 5 });
   } })
   .addInsert({ blockName: 'BOLT', position: { x: 100, y: 100 }, rotation: 45 });

const dxf = doc.toDxfString();   // { content, skipped }
const data = doc.toDxfData();    // feed directly to <DxfViewer> for preview
```

### Scripts

```bash
npm ci
npm run typecheck        # tsc --noEmit
npm run build            # Build the library (with .d.ts)
npm run check            # Build + fixture parsing + render/export smoke + read/write round-trip
npm run check:fixtures   # Parse samples/dxf/*.dxf
npm run check:render     # Headless render + PNG/PDF structure and size checks
npm run check:roundtrip  # parse → writeDxf → parse per-entity geometry comparison
npm run dev              # Start the example workspace
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
  core/            DXF parsing (parser), writing (writer), group-code registry, geometry, text layout
  renderer/        Canvas entity renderers, rendering services, and headless rendering entry
  export/          PNG / PDF export
  styles/          Shared styles
  types/           Public types
  utils/           Color, linetype, font, search, and entity helpers
samples/dxf/       Fixtures for parsing and read/write round-trip tests
scripts/           Automated self-check scripts (check:*)
```

### Limitations

- Viewing and rendering focus on browsing; CAD editing is not provided. `writeDxf` is reconstructive writing and does not preserve information that the parser does not model.
- Paper-space switching is supported, but full `VIEWPORT` model-space projection is still a future enhancement.
- SHX is handled as font-name compatibility only. Real SHX glyph files are not loaded.
- Source files and README use UTF-8 with BOM. npm configuration files such as `package.json` and `package-lock.json` remain standard UTF-8 to avoid npm / Vite parsing issues.
