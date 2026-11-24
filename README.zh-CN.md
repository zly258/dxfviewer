<h1 align="center">threejs-dxf-loader</h1>

<p align="center">面向 2D 工程图与 3D 实体装配的 AutoCAD DXF 解析器与 Three.js 渲染器，内置中英双语单文件 CAD 查看器。</p>

<p align="center">
  <a href="./README.md">English</a> | <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://threejs.org/"><img src="https://img.shields.io/badge/Three.js-%3E%3D0.128.0-3776AB?style=flat-square" alt="Three.js >=0.128.0"></a> <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-%3E%3D16.0.0-3776AB?style=flat-square" alt="Node.js >=16.0.0"></a> <a href="./CHANGELOG.md"><img src="https://img.shields.io/badge/Release-v2.0.1-F59E0B?style=flat-square" alt="Release v2.0.1"></a> <a href="https://github.com/zly258/dxfviewer/actions/workflows/ci-and-pages.yml"><img src="https://img.shields.io/github/actions/workflow/status/zly258/dxfviewer/ci-and-pages.yml?branch=main&style=flat-square&label=CI" alt="CI 状态"></a> <a href="https://zly258.github.io/dxfviewer/"><img src="https://img.shields.io/badge/Demo-GitHub%20Pages-0891B2?style=flat-square" alt="GitHub Pages 在线示例"></a> <a href="./LICENSE"><img src="https://img.shields.io/badge/License-GPL--3.0-22C55E?style=flat-square" alt="许可证: GPL-3.0"></a>
</p>

`threejs-dxf-loader` 用于解析 AutoCAD DXF 图纸（自动识别 UTF-8 与 GB18030/GBK 编码）并构建按图层合批的 Three.js 场景，涵盖 2D 工程几何、多岛孔洞填充、ACIS 3D 实体重建、完整 `MTEXT` 富文本渲染、空间拾取索引（`PickIndex`）以及明/暗/单色主题瞬时切换。

在线示例：<https://zly258.github.io/dxfviewer/>

## 核心特性

| 特性 | 解决的问题与技术基础 |
|---|---|
| 覆盖 2D 与 3D DXF 图元 | 支持常见 2D 几何、带多岛孔洞裁剪的 `HATCH`/`MPOLYGON` 填充、基于 ACIS SAT/SAB 重建的 `3DSOLID`、`MESH`、`3DFACE` 及带折痕角平滑法线的 `thickness` 挤出实体。 |
| 完整文字与工程标注链路 | 支持 `TEXT` 全部对齐方式、`MTEXT` 内联格式码、`DIMENSION`、`LEADER`、`MLEADER`、`TOLERANCE`、`ACAD_TABLE` 以及支持 `ATTRIB` 检索的多级嵌套 `INSERT` 块。 |
| 按图层合批与自适应细分 | 每图层合批输出线段与网格缓冲，并按圆弧半径相对模型尺寸自适应缩放分段数，降低密集图纸的顶点开销。 |
| `PickIndex` 空间拾取 | 结合世界坐标网格与屏幕投影包围盒网格，在大体量图纸上高效完成点选、框选宽相位过滤与世界空间射线查询。 |
| 主题瞬时切换 | 预计算明/暗两套顶点色缓冲，调用 `DXFLoader.applyBackgroundTheme()` 即可在 `'light'`、`'dark'` 与 `'bw'` 间切换，无需重新解析。 |
| 零构建双语查看器与模块化导出 | 提供 ESM/UMD 产物与 TypeScript 声明（`types/DXFLoader.d.ts`）、可运行于 Web Worker 的独立 `DXFParser` 以及单文件中英双语查看器（`examples/index.html`）。 |

## 架构

`src/dxf/` 下的核心代码按职责拆分为多个 ES 模块，由 `src/dxf/index.js` 提供可 tree-shaking 的命名导出：

```text
┌─────────────────────────────┐     ┌─────────────────────────────┐
│   DXF Input                 │     │ 00-util.js                  │
│   string / ArrayBuffer / URL│────▶│ Encoding (UTF-8/GBK) & ACI  │
└─────────────────────────────┘     └──────────────┬──────────────┘
                                                   │
                                                   ▼
                                    ┌─────────────────────────────┐
                                    │ 05-parser.js (DXFParser)    │
                                    │ Tokeniser & Entity Parser   │
                                    └──────────────┬──────────────┘
                                                   │
                                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                    07-loader.js (DXFLoader)                     │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────┐ │
│  │ 01-math.js   │ │ 02-acis.js   │ │ 03-hatch.js  │ │04-text │ │
│  │ OCS/NURBS    │ │ ACIS SAT/SAB │ │ Hatch/Dash   │ │MTEXT & │ │
│  │ Bulge/Normals│ │ B-rep Solids │ │ Tessellation │ │Atlas   │ │
│  └──────────────┘ └──────────────┘ └──────────────┘ └────────┘ │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────┐     ┌─────────────────────────────┐
│ 06-batch.js                 │     │ Output & Consumers          │
│ LayerBatchCollector         │────▶│ THREE.Group, PickRecord[],  │
│ Per-Layer Buffers & Themes  │     │ 08-pick.js (PickIndex),     │
└─────────────────────────────┘     │ examples/index.html Viewer  │
                                    └─────────────────────────────┘
```

| 路径 | 职责说明 |
|---|---|
| `src/dxf/index.js` | 公开 ESM 入口，命名导出 `DXFLoader`、`DXFParser`、`PickIndex`、`MultiPageTextAtlas`、`LayerBatchCollector` 与工具函数 |
| `src/dxf/00-util.js` | 可变长缓冲、ACI 色板、sRGB/线性色彩转换、CAD 字体映射与 UTF-8/GB18030 解码 |
| `src/dxf/01-math.js` | OCS 到 WCS 坐标变换、凸度弧插值、有理 NURBS 求值与折痕角法线计算 |
| `src/dxf/02-acis.js` | ACIS SAT/SAB 解码与 B-rep 曲面重建 |
| `src/dxf/03-hatch.js` | 填充环分类、多岛孔洞裁剪与线型虚线细分 |
| `src/dxf/04-text.js` | `MTEXT` 内联码解析与惰性分配的多页文本图集 |
| `src/dxf/05-parser.js` | 容错 DXF 词法与图元解析器（无 DOM 或 Three.js 依赖） |
| `src/dxf/06-batch.js` | 按图层合批的几何收集器 |
| `src/dxf/07-loader.js` | `DXFLoader` 场景构建、图元发射器、主题切换与资源释放 |
| `src/dxf/08-pick.js` | `PickIndex` 世界空间与屏幕空间拾取索引 |
| `types/DXFLoader.d.ts` | 公开 TypeScript 类型声明 |
| `examples/index.html` | 自包含中英双语 CAD 查看器，按需加载 `examples/samples/` 下的示例图纸 |
| `scripts/` | esbuild 构建脚本（`build.mjs`）、本地开发服务器（`serve.mjs`）、示例生成与测试脚本 |

## 快速安装

环境要求：
- 同伴依赖：`three`（`>=0.128.0`）
- 本地构建、运行脚本与测试：Node.js `>=16.0.0`

直接从 GitHub 仓库安装（尚未发布至公共 npm registry）：

```bash
npm install git+https://github.com/zly258/dxfviewer.git three
```

或直接在页面中引入预构建 UMD 文件，无需构建步骤：

```html
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/gh/zly258/dxfviewer@v2.0.1/dist/threejs-dxf-loader.umd.min.js"></script>
```

在本地构建 `dist/`（生成 `esm.js`、`esm.min.js`、`esm.mjs`、`umd.js`、`umd.min.js`、sourcemap 与 `DXFLoader.d.ts`）：

```bash
npm install
npm run build
```

## 快速上手

### 通过 ES Module 加载 DXF

```javascript
import * as THREE from 'three';
import { DXFLoader } from 'threejs-dxf-loader';

const loader = new DXFLoader();

// parseAsync 接受 DXF 字符串、ArrayBuffer 或 Uint8Array
const result = await loader.parseAsync(
  dxfArrayBuffer,
  { backgroundColor: 'light' },
  (p) => {
    console.log(`${p.percent}% ${p.stage}`);
  }
);

scene.add(result.scene);
```

### 通过 UMD / `<script>` 标签加载

```html
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js"></script>
<script src="dist/threejs-dxf-loader.umd.js"></script>
<script>
  const loader = new DXFLoader();
  loader.parseAsync(dxfArrayBuffer).then((result) => {
    scene.add(result.scene);
  });
</script>
```

### 仅解析 DXF（支持 Web Worker）

```javascript
import { DXFParser } from 'threejs-dxf-loader';

const dxf = new DXFParser().parse(dxfString);
// 返回 { header, tables, blocks, entities, objects }
```

`DXFParser` 不依赖 DOM 或 Three.js 渲染环境，可直接放入 Web Worker 运行。

### 主题切换与资源释放

```javascript
// 瞬时切换顶点色主题，无需重新解析（'light' | 'dark' | 'bw'）
DXFLoader.applyBackgroundTheme(result.scene, 'dark');

// 卸载图纸时释放几何、材质与文本图集纹理
DXFLoader.dispose(result.scene);
```

### 本地启动内置 CAD 查看器

```bash
npm run dev
# 默认监听 http://localhost:8080/（可通过 PORT 环境变量修改端口）
```

## API 参考

### `DXFLoader`

| 方法 | 签名 | 说明 |
|---|---|---|
| 构造函数 | `new DXFLoader(manager?)` | 创建加载器实例，可选传入 `THREE.LoadingManager`。 |
| `setOptions` | `loader.setOptions(opts)` -> `this` | 将选项合并到当前实例。 |
| `registerFont` | `loader.registerFont(name, threeFont)` -> `this` | 为指定 CAD 字体名注册 Three.js `Font`。 |
| `load` | `loader.load(url, onLoad?, onProgress?, onError?)` | 通过 URL 拉取 DXF 文件并解析。 |
| `parseAsync` | `loader.parseAsync(input, options?, onProgress?)` -> `Promise<DXFParseResult>` | 分阶段异步解析，返回场景与元数据。 |
| `parse` | `loader.parse(input, options?)` -> `DXFParseResult` | `parseAsync` 的同步版本。 |
| `applyBackgroundTheme` | `DXFLoader.applyBackgroundTheme(rootGroup, theme?, selectedIdSet?)` | 瞬时切换预计算的顶点色主题（`'light'`、`'dark'`、`'bw'`），可选保留选中高亮。 |
| `dispose` | `DXFLoader.dispose(rootGroup)` | 递归释放场景中的几何、材质与图集纹理。 |
| `decodeAcisData` | `DXFLoader.decodeAcisData(ent, dxf)` -> `DXFAcisDecodeResult` | 将 3D 实体的 ACIS 载荷（SAT 文本或 SAB 二进制）解码为原始 SAT 记录。 |
| `decodeDXFArrayBuffer` | `DXFLoader.decodeDXFArrayBuffer(input)` | 自动识别 UTF-8 与 GB18030/GBK 并解码为文本。 |

`DXFParseResult` 结构：

```typescript
interface DXFParseResult {
  scene: THREE.Group;                  // 可直接添加到 Three.js 场景的根节点
  dxf: Record<string, any>;            // 原始解析文档
  layers: Record<string, THREE.Group>; // 归一化图层名 -> THREE.Group
  stats: DXFStats;                     // 图元统计、draw call、解析耗时与图集信息
  boundingBox: THREE.Box3;             // 去除离群点后的视口包围盒
  fullBoundingBox: THREE.Box3;         // 完整 WCS 包围盒
  pickRecords: DXFPickRecord[];        // 每个图元对应一条拾取记录
  textRecords: DXFTextRecord[];        // 可检索的文字记录及四边形包围盒
  originShift: { x: number; y: number; z: number };
}
```

`DXFLoader.applyBackgroundTheme()` 主题映射：

| 主题 | 适用背景 | 线条表现 |
|---|---|---|
| `'light'` | 白色 | 适配浅色背景的 ACI 色板 |
| `'dark'` | 黑色 | 适配深色背景的 ACI 色板 |
| `'bw'` | 黑色 | 纯白单色线条 |

### `PickIndex`

基于 `result.pickRecords` 构建的空间拾取索引：

```javascript
import { PickIndex } from 'threejs-dxf-loader';

const index = new PickIndex(result.pickRecords);
index.updateScreen(camera, canvas.clientWidth, canvas.clientHeight);

const hit = index.pickAt(px, py);                         // 最近的 DXFPickRecord 或 null
const candidates = index.queryScreenBox(x0, y0, x1, y1);  // 框选宽相位候选索引
const nearRay = index.queryRay(raycaster.ray, 0.5);       // 世界空间射线查询索引
```

## 配置项与支持的图元

### 加载器选项

可传入 `loader.setOptions()` 或作为 `parseAsync()` / `parse()` 的第二个参数：

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `backgroundColor` | `'light' \| 'dark' \| 'bw'` | `'light'` | 初始主题。 |
| `defaultColor` | `number` | `0x0F172A` | 图层或图元未指定颜色时的默认十六进制色值。 |
| `centerOrigin` | `boolean` | `true` | 将图纸几何中心平移至世界原点。 |
| `includePaperSpace` | `boolean` | `false` | 是否渲染图纸空间图元（组码 `67 = 1`）。 |
| `curveSegments` | `number` | `96` | 整圆或闭合曲线的细分段数。 |
| `minCurveSegments` | `number` | `24` | 局部圆弧或小半径曲线的最小分段数。 |
| `maxCurveSegments` | `number` | `192` | 曲线最大分段数上限。 |
| `adaptiveCurveSegments` | `boolean` | `true` | 按半径相对模型尺寸缩放圆弧细分段数。 |
| `creaseAngle` | `number` | `44` | 3D 平滑法线的折痕角阈值（度）。 |
| `extrudeThickness` | `boolean` | `true` | 将携带组码 `39`（`thickness`）的图元按 3D 实体挤出渲染。 |
| `dimensionMode` | `'auto' \| 'computed'` | `'auto'` | `'auto'` 优先使用图纸自带 `*D<n>` 标注块；`'computed'` 重新计算标注几何。 |
| `textAtlasPx` | `number` | `96` | 文本图集的名义字高（像素）。 |
| `textAtlasPageSize` | `number` | `4096` | 每页文本图集边长（像素）；内存受限设备可降至 `1024`-`2048`。 |
| `textAtlasMaxPages` | `number` | `64` | 图集页数上限；超出部分记入 `stats.droppedText`。 |
| `fontFamily` | `string` | 系统默认 | 文本图集使用的 CSS 字体栈（默认回退至 SimSun / Arial）。 |

### 支持的图元

- **2D 几何：** `LINE`、`LWPOLYLINE`、`POLYLINE`、`CIRCLE`、`ARC`、`ELLIPSE`、`SPLINE`（有理 NURBS）、`MLINE`、`SOLID`、`TRACE`、`POINT`、`XLINE`、`RAY`、`HELIX`、`WIPEOUT`
- **填充：** `HATCH`、`MPOLYGON`（实体、渐变及 ANSI/ISO 标准图案填充，支持多岛孔洞）
- **3D 几何：** `3DSOLID`（ACIS SAT/SAB 重建）、`MESH`（`AcDbSubDMesh`）、`3DFACE`、`POLYLINE`（3D 网格 / 多面网格）、带 `thickness` 的挤出图元
- **文字与标注：** `TEXT`（六种对齐方式，含 Fit/Aligned）、`MTEXT`、`ATTRIB`、`ATTDEF`、`DIMENSION`、`LEADER`、`MLEADER`、`TOLERANCE`、`ACAD_TABLE`
- **结构：** `INSERT`（多级嵌套块与阵列）、`VIEWPORT`（跳过）

### 支持的 `MTEXT` 内联码

| 代码 | 效果 |
|---|---|
| `\P` | 段落换行 |
| `\H<n>x` / `\H<n>` | 相对 / 绝对字高 |
| `\W<n>` | 宽度因子 |
| `\Q<n>` | 倾斜角（度） |
| `\T<n>` | 字间距 |
| `\C<n>` / `\c<n>` | ACI 颜色 / 真彩色 |
| `\F<name>` / `\f<name>` | 字体切换（支持 `\|b1\|i1` 粗体与斜体标志） |
| `\L` / `\l`、`\O` / `\o`、`\K` / `\k` | 下划线、上划线与删除线开关 |
| `\S<n>^<d>` | 堆叠分数（同时支持 `/` 与 `#`） |
| `\A<n>` | 垂直对齐（`0` 底、`1` 中、`2` 顶） |
| `\pq<l\|c\|r>` | 段落对齐 |
| `\U+XXXX` / `\M+nXXXX` | Unicode 与多字节编码转义 |
| `%%c`、`%%d`、`%%p` | 特殊符号（⌀、°、±） |
| `{...}` | 样式作用域分组（继承并恢复状态） |

## 示例查看器与脚本

`examples/index.html` 是自包含的中英双语 CAD 查看器，按需从 `examples/samples/` 加载示例图纸。运行 `npm run dev` 即可在本地启动（默认地址 `http://localhost:8080/`，可通过 `PORT` 环境变量覆盖端口）。

### 内置示例图纸

| Key | 图纸 | 类型 |
|---|---|---|
| `gearbox_2d` | 行星齿轮减速器总成 | 2D 机械 |
| `arch_2d` | 科研办公楼标准层平面图 | 2D 建筑 |
| `spindle_3d` | 五轴加工中心电主轴头 | 3D 实体总成 |
| `robot_3d` | 六轴工业机器人工作站 | 3D 实体 |
| `manifold_2d` | 高压液压集成阀块剖面 | 2D 多岛填充 |
| `elements_2d` | 全元素案例 | 2D 全图元覆盖 |
| `elements_3d` | 3D 元素案例 | 3D 实体、网格与螺旋线 |
| `huge_2d` | 工厂管廊总平面（大图纸测试） | 2D（约 1.1 万图元） |
| `million_2d` | 百万图元压力测试 | 2D（1,000,000 图元） |

带中文版本的示例（`elements_2d`、`elements_3d`、`huge_2d`）在切换界面语言时会自动重新渲染。

### 查看器交互操作

| 操作 | 手势 |
|---|---|
| 点选 | 单击 |
| 窗口框选 | 从左向右拖动 |
| 交叉框选 | 从右向左拖动 |
| 指向缩放 | 滚轮 |
| 平移 | 中键拖动 |
| 3D 环绕旋转 | 右键拖动 |
| 适应视图 | 适应按钮 |
| 导出 PNG | 导出按钮或 Ctrl/Cmd+S |

### 仓库脚本

| 命令 | 说明 |
|---|---|
| `npm run build` | 构建 `dist/`（ESM + UMD + 类型声明）并同步 `examples/index.html` 与 `docs/` |
| `npm run dev` | 启动本地 HTTP 开发服务器（默认端口 `8080`，支持 `PORT` 环境变量） |
| `npm test` | 针对内置示例图纸运行解析单元测试 |
| `npm run test:renderer` | 运行渲染器与几何精度断言 |
| `npm run test:pick` | 使用真实 Three.js 运行 `PickIndex` 功能测试 |
| `npm run test:e2e` | 运行浏览器端到端测试（需要 `playwright-core` 与 Chrome） |
| `npm run test:lang` | 验证双语示例随界面语言切换 |
| `npm run check` | 运行全部非浏览器检查（`test`、`test:renderer`、`test:pick` 与 ACIS SAB 校验） |
| `npm run sync:samples` | 重新生成双语及压力测试示例 DXF 图纸 |

## 文档导航

| 主题 | 内容说明 | 链接 |
|---|---|---|
| TypeScript API 类型 | 完整的公开接口、配置选项与返回值定义 | [types/DXFLoader.d.ts](./types/DXFLoader.d.ts) |
| 交互式 CAD 查看器 | 自包含中英双语查看器实现 | [examples/index.html](./examples/index.html) |
| 版本变更记录 | 各版本新增功能、修复与结构调整说明 | [CHANGELOG.md](./CHANGELOG.md) |
| 许可证全文 | GNU 通用公共许可证第 3 版（GPL-3.0）完整条款 | [LICENSE](./LICENSE) |

## 社区与支持

- **问题反馈与建议：** [GitHub Issues](https://github.com/zly258/dxfviewer/issues)
- **赞助维护（爱发电）：** [直接打赏（爱发电）](https://ifdian.net/order/create?user_id=3db8e630e6dc11f1b37452540025c377) | [创作者主页（zhangly1403）](https://ifdian.net/a/zhangly1403)

## 许可证

本项目基于 [GNU 通用公共许可证第 3 版（GPL-3.0）](./LICENSE) 开源发布。

Copyright (C) 2026 zhangly1403 (<zhangly1403@qq.com>)
