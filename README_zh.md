# DXF Viewer

**语言：** [English](README.md) | [中文](README_zh.md)

浏览器内的 DXF 图纸查看器，提供 **WebGL 2D（GPU 加速）与 Canvas 2D 双渲染引擎**，可在运行时切换，
两者在文字排版、图层、高亮与坐标系上保持一致。专注「解析—浏览」，不提供 CAD 编辑能力。

对外有两层封装：

| 组件 | 定位 | 适用场景 |
| --- | --- | --- |
| `DxfPreview` | 一个组件、一块画布，无任何工具栏 | 第三方库嵌入、只要预览 |
| `DxfViewer` | 完整查看器（顶栏 + 工具条 + 面板 + 状态栏） | 独立页面、需要图层/属性/搜索 |
| `DxfWorkspace` | 多标签工作区（文件标签 + 拖拽打开） | 需要同时浏览多张图纸 |

---

## 一、功能特性

### 渲染

- **WebGL 2D GPU 渲染**：几何按空间分块烘焙进 GPU 缓冲，平移缩放只更新变换矩阵，不重建几何。
- **Canvas 2D 引擎**：同一份场景走浏览器原生 2D 管线，用于对比，也是 WebGL 不可用时的兜底。
- **纯几何文字**：TrueType / OpenType 字形轮廓（opentype.js）三角化后并入填充管线，
  任意放大都无位图模糊；另有 SDF 字形图集路径，二者可配置。
- **双引擎像素对齐**：同一份场景输入、同一套拾取（CPU BVH）、同一份图层/可见性模型。

### 图纸能力

- **模型空间 / 图纸空间**：有内容的多个图纸空间可直接切换，空图纸空间自动隐藏；纸张空间视口投影带裁剪。
- **图层树 / 属性面板 / 右键菜单**：隐藏选中、隔离选中、关闭图层、全部显示。
- **文字搜索**：在当前空间内检索文字并定位，结果内缩高亮。
- **视图历史**：上一个视图、下一个视图、充满视图。
- **主题与色彩**：跟随系统 / 浅色 / 深色三档界面主题，原始色与黑白两种图纸色彩。
- **桌面与移动端**：桌面顶栏 + 工具条，小屏为右侧紧凑工具条。

### 文字与特殊符号

- AutoCAD 标准转义码：`%%c`（Ø）、`%%d`（°）、`%%p`（±）、`%%%`（%）、`%%u` 下划线、`\U+XXXX`。
- TSSD 扩展码：`%%130`~`%%138` 钢筋级别、`%%140/%%141` 上标、`%%142/%%143` 下标、
  `%%146/%%147` 圈号、`%%148`~`%%151` 轴号、`%%144/%%145` 标题强调码。
- MTEXT：自动列宽折行（避开行首禁则标点）、9 种附着点、行间距倍数（组码 44）、
  内联宽度因子 `\W…;`、堆叠分数 `\S3/4;`。
- 单行文字：Fit（`hAlign=5`）拉伸与 Aligned（`hAlign=3`）等比缩放、基线/底/中/顶对齐。
- **缺字合成**：字体缺字时用已有字形拼装上下标与带圈数字（⑪~⑳ 等），
  直径符号回退到 `Ø`，绝不绘制 `.notdef` 方框。

### 大图纸性能

在 10 万实体合成图纸上实测（同一台机器，`npm run bench` 与浏览器实测一致）：

| 指标 | 数值 |
| --- | --- |
| 解析（Worker，8.6 MB） | ≈ 0.9 s |
| 场景烘焙（WebGL 分块） | ≈ 0.55 s |
| 首帧可见（含跨线程与索引） | ≈ 2.3 s |
| 平移交互 | ≈ 16.7 ms/帧 |

关键机制：解析逐行零分配扫描、场景索引在 Worker 中建 BVH、分块视口剔除、
亚像素实体 LOD 剔除、文字按字高逐指令剔除、快照式交互（停止后一次性精确重绘）。

---

## 二、支持的实体

线、射线、构造线、点、圆、圆弧、椭圆、多段线、多线、样条、填充、二维填充、三维面、
文字、多行文字、属性与属性定义、块参照、标注、引线、多重引线、表格、图片、遮罩、视口。

导出方向（`writeDxf`）覆盖：LINE / CIRCLE / ARC / ELLIPSE / LWPOLYLINE / POLYLINE / SPLINE /
TEXT / MTEXT / ATTRIB / SOLID / 3DFACE / HATCH / INSERT / DIMENSION / RAY / XLINE / LEADER / SHAPE。

---

## 三、目录结构

```text
src/
├── ui/             界面层（React）
│   ├── components/
│   │   ├── preview/    极简预览组件 DxfPreview（单画布，无工具栏）
│   │   ├── viewer/     完整查看器（顶栏/工具条/图层/属性/搜索）
│   │   ├── workspace/  多标签工作区
│   │   └── common/     通用图标、浮层、状态条、关于弹窗
│   ├── hooks/      视口历史 / 图层可见性 / 响应式
│   ├── i18n.ts     中英双语
│   └── styles/     设计令牌与组件样式（tokens 唯一来源）
├── io/             输入输出层
│   ├── parser/     DXF 解析（ASCII / 二进制、段解析、实体解析）
│   ├── writer/     DXF 写出（重建式 + preserveRaw 保真模式）
│   ├── dxf/        组码表
│   └── loader/     解析 Worker + useDxfLoader + Worker 工厂
├── render/         渲染层
│   ├── engine.ts   InteractiveRenderEngine 接口（双引擎切换契约）
│   ├── webgl/      WebGL2 引擎（分块 GPU 场景 + 着色器）
│   ├── canvas/     Canvas 2D 引擎（批渲染 + Path2D 缓存 + LOD）
│   ├── scene/      实体 → 分块 GPU 网格烘焙
│   ├── picking/    CPU 拾取（扁平 BVH、命中测试、Worker）
│   ├── text/       轮廓三角化 / SDF 图集 / SHX 描边字体 / 布局缓存
│   ├── vector/     矢量场景写入器（SVG / PDF 导出后端）
│   └── viewportFitting.ts  适配取景（交互与导出共用同一套数学）
├── core/           领域算法：几何、曲线采样、文字布局、范围计算
├── export/         导出：PNG（WebGL 栅格）、SVG / PDF（矢量）
├── config/         常量与查看器配置（渲染/文字/交互/缩放/LOD）
├── types/          公共数据模型
└── utils/          颜色、线型、字体、搜索、文字工具

src/index.ts        主入口（React 组件 + 公开类型）
src/preview.ts      极简预览入口（不含完整查看器，体积最小）
src/parser.ts       解析入口（无 React / 无 CSS）
src/writer.ts       写出入口（无 React / 无 CSS）
src/render.ts       渲染入口（无 React / 无 CSS）
src/export.ts       导出入门（无 React / 无 CSS）

scripts/            自检脚本（夹具生成、解析/渲染/可见性/往返/符号校验、基准、浏览器实测）
samples/            自检产物输出目录（运行时生成，不入库）
docs/               架构与设计文档
dxfviewer-example/  示例工程（完整工作区 + 极简预览两个页面）
```

---

## 四、运行方法

### 环境要求

- Node.js ≥ 20（本项目在 22.9 上开发）
- npm ≥ 10（使用 npm workspaces）
- 浏览器需支持 WebGL2（Chrome / Edge / Firefox / Safari 新版本）

### 安装依赖

```bash
npm ci
```

### 开发

```bash
npm run dev          # 示例工程开发服务器（默认 http://localhost:3001）
npm run build:lib    # 构建库（含 .d.ts 与 style.css）
npm run build:all    # 构建库 + 示例工程
npm run typecheck    # tsc --noEmit
```

示例工程有两个页面：

- `/index.html`：完整工作区（`DxfWorkspace`）
- `/preview.html`：极简单文件预览（`DxfPreview`，一个组件一块画布）

### 自检

```bash
npm run check              # 一次跑完下列全部（含构建）
npm run check:fixtures     # 解析夹具（含图纸空间、LEADER/SHAPE 等）
npm run check:render       # 无头渲染 + PNG/PDF 结构校验
npm run check:accuracy     # 渲染准确性（坐标、对齐、网格）
npm run check:symbols      # 特殊符号解码 + 缺字合成
npm run check:visibility   # 隐藏/隔离渲染等价性 + BVH 一致性
npm run check:roundtrip    # parse → writeDxf → parse 几何比对
npm run check:ui           # 静态 UI 审计（令牌、对比度、未定义变量）
```

需要浏览器的实测（先启动 `npm run dev`）：

```bash
npm run check:ui-style     # 尺寸阶梯 / 三栏骨架 / 主题 / 移动端
npm run check:preview      # 极简预览组件契约（单画布、缩放、主题）
npm run check:large        # 10 万实体首帧耗时、远景可见性、交互帧耗时
```

基准与批量测试：

```bash
BENCH_ITER=5 node scripts/bench-parse.mjs 100000   # 解析/克隆/建索引/烘焙/渲染分解
npm run test:real -- <图纸目录>                     # 对目录内全部图纸跑完整链路（只读）
npm run compare:engines -- <图纸目录>               # 双引擎像素级差异对比
```

---

## 五、使用方法

### 1. 极简预览：`DxfPreview`

只要一块画布、只做预览时用它。组件填满父容器，不渲染工具栏、面板或状态栏。

```tsx
import { DxfPreview } from '@zhangly1403/dxfviewer';
import '@zhangly1403/dxfviewer/style.css';

export default function Page() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <DxfPreview src="/files/drawing" />
    </div>
  );
}
```

`src` 支持四种来源，变化时自动重新加载：

```tsx
<DxfPreview src="https://example.com/a" />          {/* 地址：内部 fetch + Worker 解析 */}
<DxfPreview src={file} />                            {/* File / Blob：拖拽或选择得到的文件 */}
<DxfPreview src={arrayBuffer} />                     {/* 已下载的原始字节 */}
<DxfPreview src={parsedDxfData} />                   {/* 已解析的 DxfData：零解析开销 */}
```

主要属性：

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `src` | `string \| File \| Blob \| ArrayBuffer \| DxfData` | 图纸来源 |
| `theme` | `'light' \| 'dark'` | 画布底色（白底 / 黑底），默认 `light` |
| `colorMode` | `'original' \| 'monochrome'` | 图纸颜色，默认原色 |
| `engine` | `'webgl' \| 'canvas'` | 渲染引擎，WebGL2 不可用时自动回退 |
| `layout` | `string` | 指定布局（默认模型空间） |
| `fontUrl` / `fallbackFontUrl` | `string` | 轮廓字体与后备字体地址（可选） |
| `interactive` | `boolean` | 是否允许滚轮缩放 / 拖拽平移，默认 `true` |
| `loadingFallback` | `ReactNode` | 加载占位（传 `null` 关闭） |
| `renderError` | `(e: Error) => ReactNode` | 自定义错误渲染 |
| `onLoad` / `onError` | 回调 | 加载完成 / 失败 |

命令式句柄（滚轮缩放、拖拽平移、双击适应视图之外的控制）：

```tsx
const ref = useRef<DxfPreviewHandle>(null);
<DxfPreview ref={ref} src={file} />;
ref.current?.fit();                  // 适应视图
ref.current?.getViewPort();          // { targetX, targetY, zoom }
ref.current?.setViewPort(vp);        // 直接设定视口
```

### 2. 完整查看器：`DxfViewer`

```tsx
import { DxfViewer } from '@zhangly1403/dxfviewer';
import '@zhangly1403/dxfviewer/style.css';

export default function Page() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <DxfViewer initFile="/files/drawing" fileName="drawing" />
    </div>
  );
}
```

常用属性：`initFile`、`fileName`、`active`、`showOpenMenu`、`uiTheme`、`drawingColorMode`、
`language`、`onLoad`、`onError`、`onOpenFiles`、`onOpenFailed`、`tabStrip`。

### 3. 多标签工作区：`DxfWorkspace`

```tsx
import { DxfWorkspace } from '@zhangly1403/dxfviewer';
import '@zhangly1403/dxfviewer/style.css';

export default function App() {
  return <DxfWorkspace />;
}
```

### 4. 无 React 的子入口

| 入口 | 内容 |
| --- | --- |
| `@zhangly1403/dxfviewer/preview` | 极简预览组件 + 解析 + 字体注册 |
| `@zhangly1403/dxfviewer/parser` | DXF 解析、实体枚举、组码工具、转义解码 |
| `@zhangly1403/dxfviewer/writer` | DXF 写出、文档构建器 |
| `@zhangly1403/dxfviewer/render` | WebGL 引擎、场景烘焙、矢量写入、拾取、字体 |
| `@zhangly1403/dxfviewer/export` | PNG / SVG / 栅格 PDF / 矢量 PDF |

```ts
// 只解析，不要 UI：适合服务端或 Worker 内使用
import { parseDxf, EntityType } from '@zhangly1403/dxfviewer/parser';
const data = await parseDxf(text, undefined, { yieldIntervalMs: 0 });
```

```ts
// 无头渲染：不依赖 React，可在 Worker 内运行
import { renderSceneToCanvas } from '@zhangly1403/dxfviewer/render';

// 导出：PNG / 栅格 PDF / 矢量 PDF / 矢量 SVG（运行时零依赖）
import { exportPng, exportPdf, exportPdfVector, exportSvg } from '@zhangly1403/dxfviewer/export';
const png = await exportPng(data, { width: 1920, height: 1080, background: 'white' });
const svg = exportSvg(data, { width: 800, height: 600 });
```

### 5. 写出 DXF

```ts
import { writeDxf, createDocument } from '@zhangly1403/dxfviewer/writer';

// 重建式写出：从 DxfData 重新生成规范文件（默认 AC1015，可降级 AC1009/R12）
const { content, skipped } = writeDxf(data, { version: 'AC1015' });

// 保真往返：解析时 captureRaw，写出时逐字重放原组码
const data2 = await parseDxf(text, undefined, { preserveRaw: true });
const out = writeDxf(data2, { preserveRaw: true });

// 从零生成图纸
const doc = createDocument({ version: 'AC1015', units: 4 });
doc.addLayer({ name: 'WALL', color: 1 })
   .addLine({ layer: 'WALL', start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } })
   .addCircle({ center: { x: 500, y: 500 }, radius: 200 })
   .addText({ position: { x: 0, y: 20 }, height: 50, value: 'Title' });
const dxf = doc.toDxfString();
```

`writeDxf` 为**重建式**写出：解析器未建模的内容（XDATA、未识别的表/对象、扩展字典）不会保留，
无法写出或需降级的实体会通过 `skipped` 报告。需要「打开 → 改动 → 保存不丢信息」时用 `preserveRaw`。

### 6. 命令行转换

```bash
npm run convert -- <input> <output.(svg|pdf|dxf)> [选项]

# 示例
npm run convert -- <input> out.svg --width 1920 --height 1080
npm run convert -- <input> out.pdf --paper A3 --landscape
npm run convert -- <input> out.dxf --raw          # 保真另存
npm run convert -- <dir> <outdir> --format .svg   # 批量转换目录
npm run convert -- <input> out.svg --list-layouts # 列出布局
```

Node 侧 PNG 需要原生 Canvas 实现，默认不提供；请用浏览器端 `exportPng`，
或使用 CLI 的 SVG / PDF（Node 下 PDF 几何为纯矢量，文字层自动省略）。

### 7. 字体

- **轮廓字体**：`setOutlineFont(arrayBuffer)` 或 `loadOutlineFont(url)` 注册 TTF/OTF，
  文字走纯几何三角化；`setFallbackOutlineFont` 注册后备字体（如 Arial）覆盖特殊符号。
- **SHX 形字体**：`parseShxFont` + `registerParsedShxFont` 注册真实形文件，
  文字按描边折线渲染，视觉与 CAD 单线字形一致。
- 不注册时回落系统字体图集，样式表里的字体名会映射到最接近的本地字体。

---

## 六、开发与维护

- 仓库：<https://github.com/zly258/dxfviewer>
- 维护：DXF Viewer contributors（见 `package.json` 的 `author` 字段与提交记录）
- 问题与建议：通过仓库 Issues 反馈，请附上可复现的最小图纸与浏览器版本
- 架构说明：`docs/webgl-architecture.md`（渲染管线与性能机制）、
  `docs/plan-dxf-writer-export.md`（写出与导出设计）

贡献约定：

- 源码 UTF-8（带 BOM）；`package.json` / `package-lock.json` 用标准 UTF-8，避免工具链解析问题。
- 样式只使用 `src/ui/styles/variables.css` 的设计令牌，不写裸色值；`npm run check:ui` 会校验。
- 图纸文件不入库（`*.dxf` 已全局忽略），自检夹具一律在运行时生成。

---

## 七、已知限制

- 只做浏览，不提供 CAD 编辑。
- `writeDxf` 为重建式写出，不保留解析器未建模的信息（`preserveRaw` 可保真重放）。
- 纸张空间支持切换与视口投影，但完整的 `VIEWPORT` 模型空间裁剪仍是后续增强项。
- SHX 仅按字体名兼容映射；未注册真实形文件时，居中文字按实际字形宽度居中，
  与原始 CAD 字体可能在单字级别存在差异。
- 文字投影高度低于 1.5 CSS 像素时跳过绘制（低于该值已无法辨识）。

---

## 八、许可证

MIT License，详见 [LICENSE](LICENSE) 或 `package.json` 的 `license` 字段。