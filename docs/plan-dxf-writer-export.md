# 演进计划：DXF 读写 + 渲染 + 导出（PNG / PDF）

> 状态：**已完成**（2026-10-30）—— M0–M9 全部交付并通过自动化校验
> （`npm run check`：夹具解析 7/7、渲染+PNG/PDF/SVG/矢量PDF 冒烟 7/7、读写往返 7/7 + 构建器 + 保真往返、句柄与引用完整性、矢量内容流断言、Flate 解压验证通过）。
> 交付摘要：渲染解耦（RenderContext/viewportFitting/headless）、exportPng/exportPdf/exportPdfVector/exportSvg、
> DXF 写出器（AC1015 骨架+15 类实体+R12 降级+HATCH 图案库+DIMENSION 降级）、createDocument 构建器、
> 保真往返（preserveRaw 采集/回放）、dxfviewer convert CLI（svg/pdf/dxf、批量、--raw）。
> 可选后续：DisplayList 交互缓存、Node 端 PNG（需 Canvas 原生实现）、工具栏导出菜单（D6）。
> 基准版本：`@zhangly1403/dxfviewer` 1.5.4（5 个新子入口待随版本发布）
> 制定日期：2026-10-30

---

## 1. 目标与边界

### 1.1 v1.x 交付目标

| 能力 | 对外 API | 验收标准 |
|---|---|---|
| 写 DXF | `writeDxf()` / `writeDxfBlob()` | 输出文件能被 LibreCAD、AutoCAD（TrueView/Web）打开且无报错；解析回来几何误差 < 1e-6 |
| 编程生成 | `createDocument()` 构建器 | 不读任何文件即可生成合法 DXF（10 行代码内画出线/圆/文字） |
| 导出 PNG | `exportPng()` | 白底/透明、指定像素尺寸、指定布局，输出与屏幕一致（同一视口适配算法） |
| 导出 PDF | `exportPdf()` | 支持 A4/A3/A2/A1/A0/自定义、横竖、边距、按布局纸张、1:1 出图 |
| 无头渲染 | `renderScene()` | 不依赖 React，可在 Web Worker 中运行 |

### 1.2 明确不做（本期）

- 图形编辑器（拾取编辑、夹点、命令交互）——写出功能只提供「数据层可改 + 重建式导出」
- 3D 实体写出（3DSOLID/BODY/SURFACE）、IMAGE/WIPEOUT 二进制嵌入、ACAD_TABLE
- DWG 任何形式的读写
- Node 端 CLI（放到最后，可选）

### 1.3 关键定位声明（必须写进 README）

> `writeDxf` 是**重建式写出**：以 `DxfData` 为准重新生成一份规范文件，不保留源文件中未建模的信息（XDATA、未识别的表/对象、扩展词典）。因此它**不是**「打开 CAD 文件后原样另存」。

---

## 2. 里程碑总览

**执行方式：双轨并行**（已确认）。M0、M1 是两条轨道的公共前置；之后轨道 A 负责渲染/导出，轨道 B 负责 DXF 写出，二者改动的目录互不重叠（A：`src/renderer`、`src/export`；B：`src/core/writer`、`src/core/dxf`），可安全并行推进。

| 里程碑 | 内容 | 人日 | 版本 | 轨道 |
|---|---|---|---|---|
| **M0** | 夹具收集 + 组码注册表（读写共用） | 1 | — | 共享 |
| **M1** | 渲染解耦（参数对象化、视口适配抽出、无头入口） | 4–5 | 1.6.0-alpha | 共享 → A |
| **M2** | `exportPng` | 3 | 1.6.0 | A |
| **M3** | `exportPdf`（栅格嵌入，零依赖自写） | 2 | 1.6.1 | A |
| **M6** | 显示列表抽象 + `exportSvg` | 5–7 | 1.8.0 | A |
| **M7** | 矢量 PDF 后端（文字轮廓化） | 10–15 | 2.0.0 | A |
| **M4** | DXF 写出器 v1（AC1015 骨架 + 核心实体 + AC1009 降级模式） | 8–10 | 1.7.0 | B |
| **M5** | 写出器 v1.1（INSERT/ATTRIB、HATCH、DIMENSION、builder） | 5–6 | 1.7.1 | B |
| **M8** | 保真往返（raw 组码保留，可选） | 5–8 | 2.1.0 | B |
| **M9** | Node CLI（可选） | 4–5 | — | 后置 |

**阶段一（M1–M3 + M4 骨架，约 11 人日）**：导出 PNG/PDF 可用 + 写出器骨架可跑；
**阶段二（M2/M3 收尾 + M4/M5，约 16 人日）**：完整「能读能写能导出」；
**阶段三（M6–M7，约 18 人日）**：矢量出图。

> 并行带来的额外收益：M6 的 `RenderContext` 改造与 M4 的组码写出器共用同一套「渲染/数据分层」认知，接口设计可以互相印证；风险是周内上下文切换成本，建议以「周」为粒度切换轨道，而非日内切换。

---

## 3. 详细任务分解

### M0 — 准备（1 人日）

- [x] **M0-1 决策确认**：D1/D2/D3 已定（见 §8），开工前无需再等；D4/D5/D6 见 §8「待定」
- [ ] **M0-2 夹具收集**：`samples/dxf/` 放置 6–8 个代表性文件
  - `line-circle.dxf`（最小冒烟）
  - `polyline-bulge.dxf`（含凸度圆弧段）
  - `spline.dxf`（控制点 + 节点 + 权重）
  - `text-mtext.dxf`（含中文、多行、宽度限制）
  - `block-insert.dxf`（嵌套块 + 阵列 + ATTRIB）
  - `hatch-solid.dxf` / `hatch-pattern.dxf`
  - `dimension.dxf`（含匿名 `*D` 块）
  - `layout-paper.dxf`（模型 + 两个布局 + 视口）
- [ ] **M0-3 组码注册表**：`src/core/dxf/groupCodes.ts`
  - `GROUP_CODE_TYPES: Map<number, 'string' | 'int32' | 'int16' | 'double' | 'handle'>`
  - `formatGroupCode(code, value): string` —— 读写共用，消除「读的知识散落在 parser、写的知识另起一套」的漂移
  - 从现有 [parserState.ts](src/core/parser/parserState.ts)、[groupValue.ts](src/core/parser/groupValue.ts) 的隐式规则反推整理，并补全 DXF 规范中的区间定义

**验收**：`formatGroupCode` 单测式自检脚本（`scripts/check-group-codes.mjs`）对样例文件 parse→format 逐组码往返一致。

---

### M1 — 渲染解耦（4–5 人日）

这是后续所有导出能力的地基。

- [ ] **M1-1 `renderEntitiesToCanvas` 参数对象化**
  现状：14 个位置参数（[canvasRenderService.ts#L125](src/renderer/services/canvasRenderService.ts#L125)），已到可维护极限。
  改为：
  ```ts
  interface RenderSceneOptions {
    entities: AnyEntity[];
    layers: Record<string, DxfLayer>;
    blocks: Record<string, DxfBlock>;
    styles: Record<string, DxfStyle>;
    lineTypes: Record<string, DxfLineType>;
    ltScale: number;
    viewPort: ViewPort;
    width: number;
    height: number;
    background?: string;              // 默认取 theme
    theme?: CanvasTheme;
    drawingColorMode?: DrawingColorMode;
    hiddenLayers?: Set<string>;
    selectedIds?: Set<string>;        // 导出时为空
    sceneIndex?: SceneIndex;
    lodCulling?: boolean;             // 导出默认 false
    dataOffsetApplied?: boolean;
  }
  ```
  保持旧签名薄包装（`@deprecated`），不破坏使用方。

- [ ] **M1-2 视口适配抽出**：`src/renderer/services/viewportFitting.ts`
  ```ts
  fitExtentsToBox(extents, width, height, { padding, rotation }): ViewPort
  fitPaperLayoutToBox(layout, width, height, { padding }): ViewPort
  ```
  从 [CanvasViewer.tsx](src/components/viewer/CanvasViewer.tsx) 内联的 fit 数学搬出，交互与导出共用同一份算法（否则「屏幕看到的」和「导出的」会不一致，这是最容易被用户发现的 bug）。

- [ ] **M1-3 无头入口**：`src/renderer/headless.ts`
  ```ts
  renderScene(data: DxfData, canvas: HTMLCanvasElement | OffscreenCanvas, opts): void
  renderSceneToCanvas(data, { width, height, layout, background, padding, devicePixelRatio }): HTMLCanvasElement | OffscreenCanvas
  ```
  内部负责：挑布局 → 取 extents → fit → 调 `renderEntitiesToCanvas`。
  `devicePixelRatio` 显式参数化（当前在 CanvasViewer 内读 `window.devicePixelRatio`，导出场景要可控）。

- [ ] **M1-4 新入口 `src/render.ts`**（不引 React、不引 CSS），并加 `vite.config.ts` 第三入口 + [package.json](package.json) `exports["./render"]`。

**验收**：
- 交互查看器行为零变化（对比改造前后同一视口截图逐像素一致）
- `renderSceneToCanvas` 在无 DOM 的 `OffscreenCanvas` 环境可用（Worker 中自测）
- `npm run typecheck` + `npm run build:lib` 通过

---

### M2 — `exportPng`（3 人日）

- [ ] **M2-1** `src/export/pngExporter.ts`
  ```ts
  interface PngExportOptions {
    width: number; height: number;      // 像素
    layout?: string;                    // 默认 'Model'
    background?: 'white' | 'black' | string; // 默认 white（打印习惯）
    padding?: number;                   // 像素，默认 24
    scale?: number;                     // 相对图纸单位的倍数，与 width/height 二选一
    hiddenLayers?: Iterable<string>;
    drawingColorMode?: 'original' | 'monochrome';
  }
  exportPng(data: DxfData, opts: PngExportOptions): Promise<Blob>
  exportPngDataUrl(data, opts): Promise<string>
  ```
- [ ] **M2-2 大画布保护**：单边/面积上限检测（不同浏览器上限不同，取保守值 16384px / 268M px），超限抛带建议的错误；文档写明 A0@300dpi 需要分块
- [ ] **M2-3 Worker 版本**（可选，本里程碑内不做也能发布）：`OffscreenCanvas` + `convertToBlob`

**验收**：
- 三种尺寸（800×600 / 1920×1080 / A3@150dpi）导出正确、白底、无选中高亮、无 LOD 缺失
- 中文 MTEXT 正常（依赖字体映射，见风险 R3）

---

### M3 — `exportPdf` 栅格版（2 人日）

- [ ] **M3-1** 零依赖自写（已确认 D2）：`src/export/pdf/minimalPdf.ts` —— 单页/多页 + 内嵌 JPEG 图像的 PDF 1.4 写出（约 200–250 行），不引入任何运行时依赖
- [ ] **M3-2** 纸张规格表 `src/export/paperSizes.ts`：A0–A5、Letter、Legal 的 mm 尺寸 + 方向 + 边距
- [ ] **M3-3** `exportPdf(data, opts)`：布局纸张优先取 `layout.paperMin/paperMax`，否则 `paperSize` 参数；内部先把布局渲染成 JPEG（质量 0.92）再贴到页面
  ```ts
  interface PdfExportOptions {
    paperSize?: 'A4' | 'A3' | 'A2' | 'A1' | 'A0' | [number, number]; // mm
    orientation?: 'portrait' | 'landscape';
    margin?: number;      // mm
    dpi?: number;         // 栅格分辨率，默认 300
    layout?: string;
    background?: string;
  }
  ```

**验收**：输出 PDF 在 Acrobat/Chrome/Preview 打开正常，页面尺寸与选择一致，比例正确（100mm 线段在 1:1 设置下量出 100mm）。

---

### M4 — DXF 写出器 v1（8–10 人日）

#### 4.1 模块结构

```
src/core/writer/
  dxfWriter.ts          # 主流程编排 + 分段写出
  writerState.ts        # 句柄分配、表汇总、缩进写缓冲
  groupWriter.ts        # 组码输出（复用 M0-3 注册表）
  headerWriter.ts       # HEADER
  tablesWriter.ts       # TABLES：LTYPE / LAYER / STYLE / VIEW / UCS / APPID / DIMSTYLE / BLOCK_RECORD
  blocksWriter.ts       # BLOCKS：*Model_Space / *Paper_Space / 用户块
  entitiesWriter.ts     # ENTITIES 调度
  objectsWriter.ts      # OBJECTS：根词典 / ACAD_GROUP / ACAD_LAYOUT / PLOTSETTINGS
  entity/
    basicWriter.ts      # LINE POINT CIRCLE ARC ELLIPSE LWPOLYLINE POLYLINE SPLINE
    textWriter.ts       # TEXT MTEXT
    fillWriter.ts       # SOLID 3DFACE HATCH(solid)
    blockWriter.ts      # INSERT ATTRIB SEQEND
    dimensionWriter.ts  # DIMENSION + LEADER
  offsets.ts            # 逆平移（写回原始坐标）
```

#### 4.2 R2000 最小合法骨架（一次做对，长期复用）

必须存在的表与记录：

| 段 | 必需内容 |
|---|---|
| HEADER | `$ACADVER=AC1015`、`$HANDSEED`、`$INSBASE`、`$EXTMIN/$EXTMAX`（重算）、`$LIMMIN/$LIMMAX`、`$INSUNITS`、`$LTSCALE`、`$CELTSCALE`、`$MEASUREMENT`、`$CLAYER`、`$TEXTSTYLE`、`$DIMSTYLE` |
| CLASSES | 空段亦可（`0 SECTION / 2 CLASSES / 0 ENDSEC`） |
| TABLES | `VPORT`（*Active）、`LTYPE`（ByBlock/ByLayer/Continuous + 用户）、`LAYER`（0 + 用户）、`STYLE`（Standard + 用户）、`VIEW`（空）、`UCS`（空）、`APPID`（ACAD）、`DIMSTYLE`（Standard）、`BLOCK_RECORD`（*Model_Space、*Paper_Space、各块） |
| BLOCKS | `*Model_Space`、`*Paper_Space`、用户块（`BLOCK`/`ENDBLK` 成对，带 330 owner 与 `AcDbBlockBegin/AcDbBlockEnd` 子类标记） |
| ENTITIES | 各实体（`100 AcDbEntity` + `8` 图层 + `100 AcDbXxx` 子类标记 + 几何组码） |
| OBJECTS | 根词典（`ACAD_GROUP`、`ACAD_LAYOUT`、`ACAD_PLOTSETTINGS`）、布局对象、根词典句柄 `$ACAD` 关联 |

**关键实现点**：
1. **句柄分配器**：从 `0x30` 起递增十六进制；`$HANDSEED` 取分配器当前值；所有 `330` owner 指向 BLOCK_RECORD（实体）或根词典（表）。
2. **子类标记（100）必须齐全**：AutoCAD 对缺失 `AcDbEntity` 的文件零容忍。每个实体写出模板固定为
   `0 <TYPE> / 5 <handle> / 330 <owner> / 100 AcDbEntity / 8 <layer> / [6 62 370 420 440 60] / 210,220,230 / 100 AcDbXxx / <几何组码>`
3. **逆平移**：写出前对全部坐标加回 `data.offset`（[dxfParser.ts#L341](src/core/parser/dxfParser.ts#L341) 施加的平移），块基点同样处理；提供 `preserveOffset?: boolean` 显式关闭。
4. **不写计算字段**：`id` / `extents` / `calculatedPoints` / `hash` 等渲染产物一律忽略；样条用原始 `controlPoints + knots + weights + degree`。
5. **图层隐藏**：`isVisible=false` → 组码 `62` 写负值（DXF 惯例）。
6. **性能**：分块拼字符串（数组 join），10 万实体目标 < 2s；不做逐字符拼接。

#### 4.3 实体组码清单（v1）

| 实体 | 主要组码 |
|---|---|
| LINE | 10,20,30 / 11,21,31 |
| POINT | 10,20,30 |
| CIRCLE | 10,20,30 / 40 |
| ARC | 10,20,30 / 40 / 50 / 51 |
| ELLIPSE | 10,20,30 / 11,21,31 / 40 / 41 / 42 |
| LWPOLYLINE | 90 / 70 / 43 / 38 / (10,20[,40,41,42])* |
| POLYLINE | 66 / 70 / 10,20,30 + VERTEX 子实体 + SEQEND |
| SPLINE | 70 / 71 / 72 / 73 / 74 / 40(knots) / 41(weights) / 10,20,30(control) / 11,21,31(fit) / 12..13(tangents) |
| TEXT | 10,20,30 / 40 / 1 / 50 / 41 / 51 / 7 / 72 / 11,21,31 / 73 |
| MTEXT | 10,20,30 / 40 / 41 / 71 / 72 / 1(+3 续行) / 7 / 50 |
| SOLID | 10..13,20..23,30..33 |
| 3DFACE | 同上 + 70 |
| RAY / XLINE | 10,20,30 / 11,21,31 |
| INSERT | 2 / 10,20,30 / 41,42,43 / 50 / 70 / 71 / 44 / 45 + ATTRIB + SEQEND |
| HATCH（v1 仅 solid） | 2 / 70 / 71 / 91 / 92 / 93 / (边界边组码) / 75 / 76 / 98 / 450.. |

#### 4.4 公共属性组码（所有实体）

`5` handle、`330` owner、`100` 子类、`8` 图层、`6` 线型、`48` 线型比例、`62` 颜色、`420` 真彩色、`370` 线宽、`440` 透明度、`60` 不可见、`67` 图纸空间、`210/220/230` 拉伸方向（OCS）。

#### 4.5 任务清单

- [ ] **M4-1 骨架**：`writerState.ts`（句柄分配器 + 写缓冲）、`headerWriter.ts`、`tablesWriter.ts`、`objectsWriter.ts`、`blocksWriter.ts`
- [ ] **M4-2 组码输出**：`groupWriter.ts`（复用 M0-3 注册表；数值格式化统一保留位数策略，避免浮点噪声）
- [ ] **M4-3 核心实体**：`entity/basicWriter.ts` + `textWriter.ts` + `fillWriter.ts`（LINE/POINT/CIRCLE/ARC/ELLIPSE/LWPOLYLINE/POLYLINE/SPLINE/RAY/XLINE/TEXT/MTEXT/SOLID/3DFACE）
- [ ] **M4-4 逆平移 + 主流程**：`offsets.ts` + `dxfWriter.ts`（`writeDxf(data, opts)` / `writeDxfBlob`）
- [ ] **M4-5 AC1009 降级模式**（已确认 D1）：`version: 'AC1009'` 时切换写骨架并做实体降级
  - LWPOLYLINE → `POLYLINE` + `VERTEX` + `SEQEND`（保留凸度与闭合）
  - MTEXT → `TEXT`（保留首行/换行符替换为 `\P` 转空格，丢失宽度限制并在 `skipped` 记录）
  - HATCH → 边界轮廓线（`POLYLINE`）
  - ELLIPSE/SPLINE → 采样为 `POLYLINE`（fx 曲线离散化，容差可配）
  - 去掉 handle/330/100 子类标记（R12 无句柄体系）
- [ ] **M4-6 实体覆盖报告**：未写出实体进入 `skipped`，并输出到 `console.warn`（可关）

**验收**：
- 6 个夹具逐个 `parseDxf` → `writeDxf` → `parseDxf`，实体数一致、逐实体几何比对 < 1e-6（矩形/圆弧/样条按采样点比对）
- LibreCAD 打开无警告；AutoCAD TrueView 打开无「文件无效」提示
- 输出文件用 `data.offset` 逆平移后，与原文件 `$EXTMIN/$EXTMAX` 一致
- `version: 'AC1009'` 输出可在 LibreCAD 打开，且 LWPOLYLINE 降级后几何形状不变（采样点比对）

---

### M5 — 写出器 v1.1 + 构建器（5–6 人日）

- [ ] **M5-1 INSERT/ATTRIB**：属性表按 `attributes` 顺序输出 `ATTRIB` + `SEQEND`，`66=1` 标记
- [ ] **M5-2 HATCH**：
  - solid 填充（`70=1`）完整支持
  - 图案填充：解析器当前**未保留图案定义线**（`78` 组码）→ 方案：内置 `acad.pat` 常用图案子集（`src/core/writer/patterns.ts`），按 `patternName` 匹配输出 `78` 定义行；未匹配则降级为 solid 并在 `skipped` 中报告
- [ ] **M5-3 DIMENSION**：写 `DIMENSION` 实体 + 引用已解析的匿名 `*D` 块（blocks 里已有），`2` 组码指向块名；无块时降级为几何线输出（`skipped` 标注）
- [ ] **M5-4 `createDocument()` 构建器**：`src/core/writer/documentBuilder.ts`
  ```ts
  const doc = createDocument({ version: 'AC1015', units: 'mm' });
  doc.addLayer({ name: 'WALL', color: 1 });
  doc.addLine({ layer: 'WALL', start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } });
  doc.addCircle({ center: { x: 500, y: 500 }, radius: 200 });
  const dxf: string = doc.toDxfString();
  const data: DxfData = doc.toDxfData();   // 可直接喂给 <DxfViewer>
  ```
- [ ] **M5-5 `skipped` 报告**：`writeDxf()` 返回 `{ content, skipped: Array<{ type, id, reason }> }`——诚实告知不支持项，避免用户莫名丢实体
- [ ] **M5-6 入口**：`src/writer.ts`（纯逻辑，无 React/DOM）+ `exports["./writer"]`

**验收**：README 的 10 行示例可直接跑通；构建器生成的图纸能在查看器里正常渲染。

---

### M6 — 显示列表 + SVG（5–7 人日）

- [ ] **M6-1 `RenderContext` 接口**：`src/renderer/context.ts`
  ```ts
  interface RenderContext {
    // 状态
    lineWidth: number; strokeStyle: string; fillStyle: string;
    font: string; globalAlpha: number; lineCap: string; lineJoin: string;
    // 路径
    beginPath(): void; moveTo(x, y): void; lineTo(x, y): void;
    bezierCurveTo(...): void; quadraticCurveTo(...): void; arc(...): void;
    closePath(): void; rect(x, y, w, h): void;
    // 绘制
    stroke(): void; fill(): void; fillRect(...): void;
    setLineDash(p: number[]): void; save(): void; restore(): void;
    translate/rotate/scale(...): void;
    // 文字
    measureText(t: string): { width: number; actualBoundingBoxLeft?: number; actualBoundingBoxRight?: number };
    fillText(t: string, x, y): void; strokeText(t: string, x, y): void;
  }
  ```
  `CanvasRenderingContext2D` 结构上已满足（只需类型断言），`renderer/entities/*` 的 `ctx` 参数类型从 `CanvasRenderingContext2D` 改为 `RenderContext`——**改动极小，收益是把后端彻底解耦**。
- [ ] **M6-2 `DisplayList` 收集器**：`DisplayListContext` 记录指令数组；`replayToCanvas(ctx, list)` 供交互层做缓存复用（顺带给 M2 的平移动画加速）
- [ ] **M6-3 `SvgContext`**：输出 `<path d="...">`、`<text>`、`<g>`；HATCH 图案 → `<pattern>` 或直接展开为线
- [ ] **M6-4 `exportSvg(data, opts): string`**：矢量、可嵌入网页、可浏览器 `window.print()` 转 PDF（零依赖 PDF 兜底路径）

**验收**：同一图纸 SVG 与 Canvas 视觉一致（人工比对 + 关键坐标断言）；SVG 在浏览器/Illustrator 中打开正常。

---

### M7 — 矢量 PDF（10–15 人日）

- [ ] **M7-1 PDF 后端**：`src/export/pdf/pdfContext.ts` 实现 `RenderContext` → PDF 内容流（`m/l/c/h/S/f/w/d/RG/rg/cm/q/Q`）
- [ ] **M7-2 文字策略**：**轮廓化**（用 `opentype.js`/`fontkit` 把 glyph 转路径）——绕开中文 CID 字体子集化这个深坑；文件略大，但零字体依赖、跨端渲染绝对保真
  - 备选：PDF 原生 `Tj` + 嵌入 TTF 子集（质量最佳，工程量 3–4 倍，中文尤甚）
- [ ] **M7-3 度量替换**：`measureText` 从 Canvas 切换到字体引擎（`textLayoutEngine` 需接受可注入的 measurer）
- [ ] **M7-4 页面模型**：多布局 = 多页；`1:1` 出图（mm 精确映射到 PDF pt：`1mm = 2.834645pt`）
- [ ] **M7-5 依赖治理**：字体引擎做成 optional peer / 动态 import，主包体积不变

**验收**：PDF 放大 3200% 线条仍是矢量；文字与屏幕逐字位置一致；A3 图框量取尺寸正确。

---

### M8 — 保真往返（可选，5–8 人日）

- [ ] **M8-1** parser 增加 `preserveRaw?: boolean`：每个实体挂 `raw?: Array<[number, string]>`（含未消费组码 + XDATA）
- [ ] **M8-2** 写出器：有 `raw` 且实体未被修改 → 原样回放；被修改 → 走 `entity/*Writer.ts` 重建
- [ ] **M8-3** 未建模段（DIMSTYLE/VPORT/UCS/CLASSES/未知 OBJECTS）原文保留 + 回写
- [ ] **M8-4** 内存开关与文档说明（raw 模式内存约 +40%）

**验收**：真实项目图纸 parse→write→逐字节差异仅限格式（换行/数值格式），AutoCAD 打开与原图无视觉差异。

---

## 4. API 总览（目标形态）

```ts
// 只读
import { parseDxf } from '@zhangly1403/dxfviewer/parser';

// 写出
import { writeDxf, writeDxfBlob, createDocument } from '@zhangly1403/dxfviewer/writer';
const { content, skipped } = writeDxf(data, { version: 'AC1015' });

// 无头渲染
import { renderSceneToCanvas } from '@zhangly1403/dxfviewer/render';

// 导出
import { exportPng, exportPdf, exportSvg } from '@zhangly1403/dxfviewer/export';
await exportPng(data, { width: 1920, height: 1080, background: 'white' });
await exportPdf(data, { paperSize: 'A3', orientation: 'landscape', margin: 10, dpi: 300 });

// 交互组件（现状不变）
import { DxfViewer, DxfWorkspace } from '@zhangly1403/dxfviewer';
```

`exports` 字段最终形态：

```jsonc
"exports": {
  ".":        { "types": "./dist/dxfviewer.d.ts", "import": "./dist/dxfviewer.js" },
  "./parser": { "types": "./dist/parser.d.ts",    "import": "./dist/parser.js" },
  "./writer": { "types": "./dist/writer.d.ts",    "import": "./dist/writer.js" },
  "./render": { "types": "./dist/render.d.ts",    "import": "./dist/render.js" },
  "./export": { "types": "./dist/export.d.ts",    "import": "./dist/export.js" },
  "./style.css": "./dist/style.css"
}
```

---

## 5. 质量保障

### 5.1 回归脚本（dev 脚本，不进测试框架）

| 脚本 | 用途 |
|---|---|
| `scripts/roundtrip.mjs` | `samples/dxf/*` 逐个 parse→write→parse，输出几何比对报告 |
| `scripts/check-group-codes.mjs` | 组码注册表自洽性 |
| `scripts/export-smoke.mjs` | PNG/PDF 导出后校验文件头、页数、尺寸（不渲染校验） |

> 说明：项目此前按你的要求移除了 vitest/playwright 测试模块，本计划不恢复测试框架；上述脚本是 `node scripts/*.mjs` 形式的开发者自检工具。若你希望改为正式单测，也可在 M4 时重新引入（成本 +1 人日）。

### 5.2 人工验收清单（每次发版）

- [ ] LibreCAD 打开各夹具导出的 DXF：无警告、图形位置正确
- [ ] AutoCAD TrueView / Web 打开：无「文件无效」
- [ ] PNG：白底、无选中框、无缺线（LOD 关闭）
- [ ] PDF：页面尺寸/比例正确，斜线无锯齿（矢量模式）
- [ ] 交互查看器：万级实体夹具平移缩放流畅度无退化

### 5.3 构建验证命令

```bash
npm run typecheck
npm run build:lib          # 含 dts 生成
npm --workspace dxfviewer-example run build
```

---

## 6. 风险登记

| ID | 风险 | 影响 | 应对 |
|---|---|---|---|
| R1 | DXF 规范面积大，边界情况多（MTEXT 转义、SPLINE 节点规范化、ATTRIB 顺序） | 写出文件在 CAD 中报错 | 骨架一次做对 + 夹具驱动 + 每次改动跑 roundtrip |
| R2 | 逆平移遗漏（`data.offset`） | 导出图整体位移 | 写出前统一入口处理 + 断言 `offset` 为 0 或显式传入 |
| R3 | 文字字体：SHX 在浏览器不存在，中文依赖系统字体 | 导出缺字/换字体 | 已在 `fontResolver`/`fontService` 有映射；导出前提供字体就绪等待 + 缺字告警 |
| R4 | 大画布内存（A0@300dpi） | 导出失败 | M2-2 上限检测 + 分块渲染（后续） |
| R5 | 矢量 PDF 中文 | 工期超预期 | M7 用文字轮廓化绕开 CID 子集化 |
| R6 | 重建式写出的预期管理 | 用户误以为可无损另存 | README 明确定位 + `skipped` 报告 + M8 提供保真模式 |
| R7 | `renderEntitiesToCanvas` 改造触碰交互层 | 查看器回归 | M1 保持旧签名包装 + 截图比对 |

---

## 7. 排期建议（双轨并行）

按「单人、每周可投入 4 个工作日、以周为粒度切换轨道」估算；若两人分轨协作可压缩至 4–5 周。

| 周 | 日期 | 轨道 A（渲染/导出） | 轨道 B（DXF 写出） | 版本节点 |
|---|---|---|---|---|
| W1 | 11/02–11/06 | M1 渲染解耦（4d） | M0 夹具 + 组码注册表（1d） | — |
| W2 | 11/09–11/13 | M2 `exportPng`（3d） | M4 骨架：HEADER/TABLES/OBJECTS/句柄（3d） | 1.6.0-alpha |
| W3 | 11/16–11/20 | M3 `exportPdf` 栅格（2d） | M4 核心实体写出（3d） | **v1.6.0 发布** |
| W4 | 11/23–11/27 | M6 `RenderContext` 改造（3d） | M4 样条/多段线/文字 + roundtrip 脚本（3d） | — |
| W5 | 11/30–12/04 | M6 SVG 后端（3d） | M4 AC1009 降级模式 + 收尾（3d） | **v1.7.0 发布** |
| W6 | 12/07–12/11 | M6 `exportSvg` 收尾 + 文档（2d） | M5 INSERT/ATTRIB + builder（3d） | — |
| W7–W8 | 12/14–12/25 | M7 矢量 PDF 骨架（6d） | M5 HATCH/DIMENSION + `skipped`（4d） | v1.7.1 |
| W9–W11 | 12/28–01/15 | M7 文字轮廓化 + 多页/1:1（9d） | M8 保真往返（可选，5d） | v1.8.0 / v2.0.0 |
| 之后 | — | — | M9 Node CLI（可选） | 按需 |

**并行的硬约束**：

1. M1 未完成前，轨道 A 不能开始 M2/M6（视口适配与参数对象化是其依赖）。
2. 轨道 B 的 M4 在 M0-3（组码注册表）之后才能动笔，但**不依赖 M1**——两条线可以在 W1 内真正同时启动。
3. 两条线都要改 `src/index.ts` / `package.json` 的 exports：约定「谁先落地谁改，另一方 rebase」，避免冲突堆积。
4. 每周五固定跑一次全量验证（`typecheck` + `build:lib` + 两个自检脚本），并行期间不做长周期无验证分支。

---

## 8. 决策记录

### 已确认（2026-10-30）

| ID | 决策 | 结论 |
|---|---|---|
| D1 | 默认输出 DXF 版本 | **AC1015 (R2000) 默认 + AC1009 (R12) 降级模式**。R2000 完整承载 LWPOLYLINE/MTEXT/HATCH；R12 模式自动降级（LWPOLYLINE→POLYLINE+VERTEX、MTEXT→TEXT、HATCH→边界轮廓线），用于极端兼容场景 |
| D2 | PDF 依赖策略 | **保持零运行时依赖**：栅格 PDF 自写（`src/export/pdf/minimalPdf.ts`，约 200–250 行）；矢量 PDF 的文字轮廓化用 `opentype.js` 作为 **optional** 依赖动态引入 |
| D3 | 里程碑顺序 | **双轨并行**（见 §2 / §7） |

### 待定（不阻塞开工，可边做边定）

| ID | 问题 | 建议 | 最晚决定点 |
|---|---|---|---|
| D4 | 是否恢复测试框架（vitest） | 先用 `scripts/*.mjs` 自检，M4 稳定后再评估 | M4 结束 |
| D5 | 是否需要 Node CLI（`dxf2png`/`dxf2pdf`/`dxf2dxf`） | 阶段三之后再做；若做，优先纯 TS 路线（依赖 M7 矢量后端）而非 node-canvas | M7 结束 |
| D6 | 组件层是否暴露「导出」菜单按钮 | 需要。否则能力不可见；建议 M2 完成后在 `ViewerToolbar` 加「导出」下拉（PNG/PDF） | M2 结束 |

---

## 9. 下一步

双轨同时启动：

1. **轨道 A 起点**：M1-1 `renderEntitiesToCanvas` 参数对象化（保持旧签名包装，零行为变化）
2. **轨道 B 起点**：M0-3 组码注册表 `src/core/dxf/groupCodes.ts`（读写共用，先只被 parser 之外的新代码使用）

两步都不改变任何对外行为，风险最低，且立刻为后续所有任务建立结构。
