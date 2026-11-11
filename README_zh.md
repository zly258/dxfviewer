# DXF Viewer

**语言：** [English](README.md) | [中文](README_zh.md)

在线演示：[https://zly258.github.io/dxfviewer/](https://zly258.github.io/dxfviewer/)

---

DXF Viewer 是一个在浏览器中查看 DXF 图纸的 React 组件。内置 **WebGL 2D（GPU 加速）与 Canvas 2D 两套交互渲染引擎**，可在视图菜单中随时切换，两者在文字排版、图层、高亮与图纸坐标系上完全对齐。

提供核心查看器（`DxfViewer`）、多 Tab 工作区（`DxfWorkspace`）与示例工程。专注 DXF 解析、浏览、图层显示、文字搜索，以及**超大图纸的流畅浏览**；不提供 CAD 编辑能力。

## 特性

- **WebGL 2D GPU 渲染** —— 几何批量进 GPU 缓冲；文字由 TrueType / OpenType 字形轮廓（opentype.js + earcut）三角化后并入同一套填充管线，任意缩放都不模糊、无像素马赛克。
- **Canvas 2D 引擎** —— 同一份场景走浏览器原生 2D 管线，便于对比，也是 WebGL 不可用时的兜底。
- **为超大图纸设计** —— 场景索引在 Web Worker 中构建、解析逐行零分配扫描、按布局缓存、亚像素实体 LOD 剔除，平移缩放用快照模式，交互停止后一次性精确重绘。
- **模型空间 / 图纸空间** —— 有内容的多个图纸空间可像 CAD 一样直接切换，空图纸空间自动隐藏。
- **图层树、属性面板、右键菜单** —— 隐藏选中、隔离选中、关闭图层、全部显示。
- **文字搜索** —— 在当前空间内搜索并定位，结果使用内缩式轻量高亮。
- **视图历史** —— 上一个视图、下一个视图、充满视图。
- **主题** —— 跟随系统 / 浅色 / 深色三档界面主题，以及原始色与黑白两种图纸色彩模式。
- **桌面与移动端** —— 桌面为顶栏 + 工具条布局，小屏为右侧紧凑工具条。

## 支持的实体

线、射线、构造线、点、圆、圆弧、椭圆、多段线、样条、填充、二维填充、三维面、文字、多行文字、属性与属性定义、块参照、标注、引线、多重引线、表格、图片、遮罩、视口等。

### AutoCAD / TSSD 转义符号

- `%%130`–`%%138` 钢筋等级符号（`Ø`、`Φ`）
- `%%140…%%141` 上标与 `%%142…%%143` 下标（`kN/m²`、`m³`、`LₐE`）
- `%%146…%%147` 带圈数字（`①`、`②`、`⑩`）
- `%%148…%%151` 结构轴号圆圈（`(3C)`）
- 基础控制符 `%%c`（Ø）、`%%d`（°）、`%%p`（±）、`%%%`（%）
- `%%144` 一类标题强调符会被安全过滤，画布上不会出现乱码控制字节

### 文字排版

- MTEXT 自动列宽折行，避让标点禁则
- 全部 9 种附着点，含原生基准偏移与首行基线沉降
- MTEXT 组码 44 行间距倍数与内联字宽因子 `\W…;`
- 单行文字 Fit（`hAlign=5`）与 Aligned（`hAlign=3`）
- 垂直对齐：基线、底对齐、居中、顶对齐

## 安装

```bash
npm install @zhangly1403/dxfviewer
```

React 与 React DOM 是 peer dependencies，需要宿主项目自行安装：

```bash
npm install react react-dom
```

## 引入样式

```ts
import '@zhangly1403/dxfviewer/style.css';
```

## 使用核心查看器

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

## 使用多 Tab 工作区

```tsx
import { DxfWorkspace } from '@zhangly1403/dxfviewer';
import '@zhangly1403/dxfviewer/style.css';

export default function App() {
  return <DxfWorkspace />;
}
```

## 主要导出

| 名称 | 说明 |
| --- | --- |
| `DxfViewer` | 核心 DXF 查看器组件。 |
| `DxfWorkspace` | 含标签页、文件打开与查看器工具条的完整工作区。 |
| `parseDxf` | DXF 文本解析器。 |
| `DxfViewerProps` | `DxfViewer` 的属性类型。 |
| `DxfWorkspaceProps` | `DxfWorkspace` 的属性类型。 |
| `DxfTabSource` | 多 Tab 场景的初始文件来源类型。 |

只需要解析能力、不加载 React、查看器 UI 与样式时，用轻量入口：

```ts
import { parseDxf, EntityType } from '@zhangly1403/dxfviewer/parser';
```

原有两个参数的 `parseDxf` 继续兼容，可选第三个参数用于配置取消信号、进度节流与事件循环让步。

## 写出 DXF 与导出 PNG / PDF

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

## 命令行转换（Node CLI）

库附带零依赖 CLI（走 `./parser` `./render` `./export` `./writer` 子入口，无需浏览器）：

```bash
npm run convert -- <input.dxf> <output.(svg|pdf|dxf)> [选项]

# 示例
npm run convert -- drawing.dxf drawing.svg --width 1920 --height 1080
npm run convert -- drawing.dxf drawing.pdf --paper A3 --landscape
npm run convert -- drawing.dxf drawing.dxf --raw        # 保真另存
npm run convert -- ./fixtures ./out --format .svg       # 目录批量转换
npm run convert -- drawing.dxf x.svg --list-layouts     # 查看布局列表
```

说明：Node 端 PNG 需要 Canvas 原生实现（`skia-canvas` 等），默认不提供——浏览器端 `exportPng` 或 CLI 的 SVG/PDF 已覆盖绝大多数场景；PDF 在 Node 端几何为矢量、文字图层自动省略（浏览器端完整）。

## 常用脚本

```bash
npm ci
npm run typecheck        # tsc --noEmit
npm run build            # 构建库（含 .d.ts）
npm run check            # 构建 + 夹具解析 + 渲染/导出冒烟 + 隐藏/隔离渲染回归 + 读写往返校验 + UI 审计
npm run check:fixtures   # 解析运行时生成的夹具（含图纸空间与 LEADER/SHAPE）
npm run check:render     # 无头渲染 + PNG/PDF 结构与尺寸校验
npm run check:visibility # 隐藏/隔离渲染等价性 + 扁平 BVH 与参考实现一致性
npm run check:roundtrip  # parse → writeDxf → parse 逐实体几何比对
npm run check:ui         # 静态 UI 审计（令牌、裸色值、禁用态 opacity、明暗对比度、z-index、字号、圆角）
npm run check:ui-style   # 浏览器实测尺寸、骨架、主题与移动端（需先 npm run dev）
npm run test:real        # 对指定目录的真实施工图做全链路批量测试（只读源目录）
npm run bench-parse      # 合成大图解析/建索引/渲染基准（手动运行）
npm run dev              # 启动示例工程
npm run build:example
npm run build:all
```

说明：`dxfviewer-example` 是真实示例工作区，完整仓库中会存在该目录。根目录的 `package-lock.json` 已保留 workspace 链接，支持包含示例工程时执行 `npm ci`。

## 发布到 npm（GitHub Actions）

发布工作流：`.github/workflows/publish-npm.yml`，触发方式两种：

- **创建 GitHub Release（发布）** → 自动构建并发布到 npm；
- **Actions → Publish to npm → Run workflow** → 手动触发，`dry_run` 默认 `true`（只构建 + `npm pack --dry-run`，不发布）。

发布前请在 `package.json` 改好版本号并让 tag 与之一致（例如 `1.6.0` ↔ `v1.6.0`）；工作流会校验版本一致性，并拒绝发布 npm 上已存在的版本。

鉴权二选一（工作流会按是否配置了 Secret 自动选择）：

1. **npm 可信发布（推荐，无需密钥）**：npm 包页面 → Settings → Trusted Publisher → 选 GitHub Actions，填本仓库、工作流文件名 `publish-npm.yml`、环境名 `npm`。工作流已声明 `id-token: write` 与 `--provenance`。
2. **访问令牌**：npm → Access Tokens 生成 Granular Access Token（勾选 Read and write，包选择本包），在仓库 Settings → Secrets and variables → Actions 新建 `NPM_TOKEN`。

## 项目结构

```text
src/
  ui/              界面层：components（查看器/面板/工具栏）、hooks、i18n、styles（web-ui-style 设计令牌）
  io/              输入输出层：parser（DXF 解析）、writer（写出）、dxf（组码）、loader（解析 Worker）
  render/          渲染层：engine（双引擎契约）/ webgl / canvas（可切换对比）/ picking / text / vector
  core/            领域算法：几何、曲线采样、文字布局、范围计算
  export/          导出：PNG（WebGL 栅格）、SVG / PDF（矢量）
  config/          常量与查看器配置
  types/           公共类型定义
  utils/           颜色、线型、字体、搜索和实体辅助函数
samples/           读写往返等自检的输出目录（gitignore，运行时生成）
scripts/           自动化自检脚本（check:*）、夹具生成、基准与真实图纸批量测试
```

## 限制说明

- 查看与渲染专注浏览，不提供 CAD 编辑能力；`writeDxf` 为重建式写出，不保留源文件未建模的信息。
- 写出覆盖 LINE/CIRCLE/ARC/ELLIPSE/LWPOLYLINE/POLYLINE/SPLINE/TEXT/MTEXT/ATTRIB/SOLID/3DFACE/HATCH/INSERT/DIMENSION/RAY/XLINE/LEADER/SHAPE；REGION 等 ACIS 元数据与部分代理对象无法重建，经 `skipped` 显式报告（`preserveRaw` 保真模式可原样回放）。
- 图纸空间已支持实体切换，但复杂 `VIEWPORT` 的模型空间投影视口仍属于后续增强方向。
- SHX 文字：ASCII 走内置描边字形（基线/字高按 CAD 语义），中文按系统字体图集渲染；居中按实际整形宽度计算。注册真实 .shx 后与 AutoCAD 原字体一致。
- 源码使用 UTF-8 with BOM；`package.json`、`package-lock.json` 等 npm 配置文件保持标准 UTF-8，避免 npm / Vite 解析问题。

## 许可

MIT
