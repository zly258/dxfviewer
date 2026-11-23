# threejs-dxf-loader

[English](./README.md) | [简体中文](./README.zh-CN.md)

[![License: GPL v3](https://img.shields.io/badge/License-GPL_v3-blue.svg)](./LICENSE)
[![Three.js](https://img.shields.io/badge/Three.js-%3E%3D0.128.0-black.svg)](https://threejs.org/)
[![GitHub](https://img.shields.io/badge/GitHub-zly258%2Fdxfviewer-181717?logo=github)](https://github.com/zly258/dxfviewer)
[![爱发电](https://img.shields.io/badge/爱发电-支持作者-946CE6)](https://ifdian.net/order/create?user_id=3db8e630e6dc11f1b37452540025c377)

面向 2D 工程图与 3D 实体装配的 **AutoCAD DXF 解析器 + Three.js 渲染器**，并附带一个中英双语单文件 CAD 查看器（`examples/index.html`）。

**在线示例：** <https://zly258.github.io/dxfviewer/>

---

## 目录

1. [特性](#特性)
2. [架构](#架构)
3. [安装](#安装)
4. [快速上手](#快速上手)
5. [API 参考](#api-参考)
6. [选项](#选项)
7. [支持的图元](#支持的图元)
8. [示例查看器](#示例查看器)
9. [脚本](#脚本)
10. [支持与打赏](#支持与打赏)
11. [许可证](#许可证)

---

## 特性

### 解析与渲染

- **完整 2D 几何** — `LINE`、`CIRCLE`、`ARC`、`ELLIPSE`、`SPLINE`（有理 NURBS）、`LWPOLYLINE`、`POLYLINE`、`MLINE`、`SOLID`、`TRACE`、`XLINE`、`RAY`、`POINT`、`HELIX`、`WIPEOUT`。
- **填充图案** — `HATCH` / `MPOLYGON`，支持实体填充、ANSI/ISO 标准图案、渐变填充与多岛孔洞裁剪。
- **3D 实体与平滑着色** — 通过 ACIS SAT/SAB 重建 `3DSOLID`（平面、圆锥、球、圆环、旋转样条曲面），支持 `MESH`（`AcDbSubDMesh`）、`3DFACE`、`POLYLINE` 3D 网格/多面网格，以及闭合轮廓按 `thickness` 挤出为实体（44° 折痕角平滑法线）。
- **文字** — `TEXT`（六种对齐，含 Fit/Aligned）、`MTEXT` 全量内联码（`\P \H \W \Q \C \c \F \L \O \K \S \T \A \p \U`）、`ATTRIB`、`ATTDEF`。
- **标注** — `DIMENSION`（全部类型）、`LEADER`、`MLEADER`、`TOLERANCE`、`ACAD_TABLE`。
- **块** — 多级嵌套 `INSERT`（旋转/缩放/阵列）；`ATTRIB` 值可检索。
- **编码** — 自动识别 UTF-8 与 GB18030/GBK，解码 `\M+nXXXX` 转义。

### 性能

- **自适应曲线细分** — 圆弧段数按半径相对模型尺寸缩放，成千上万个小孔不再占用满段数预算。在 16 万个圆的合成图纸上，顶点数减少约 75%（3057 万 → 764 万），构建耗时约 11 s → 2.3 s。
- **空间拾取（`PickIndex`）** — 世界坐标网格 + 屏幕投影包围盒网格，10 万级图元的点选与框选保持 O(候选)。内置查看器另加线段级窄相位与块引用解析。
- **合批几何** — 每图层每主题色缓冲一个 line/mesh；加载器为每个图元返回一条带世界包围盒的 `PickRecord`。
- **主题瞬时切换** — 预计算明/暗两套顶点色缓冲，`< 1 ms` 切换，无需重新解析。
- **异步解析** — 分阶段让出事件循环。
- **省内存的文本图集** — 图集页惰性分配（纯线稿图纸不占页），超出上限的文字计入 `stats.droppedText` 而非静默丢失。

---

## 架构

```
src/dxf/
  index.js          公开 ESM 入口（命名导出，可 tree-shaking）
  00-util.js        可变长缓冲、ACI 色板、sRGB/线性色彩、字体映射、编码
  01-math.js        OCS→WCS、凸度弧、NURBS 求值、折痕角法线
  02-acis.js        ACIS SAT/SAB 解码 + B-rep 曲面重建
  03-hatch.js       填充环分类 + 线型虚线细分
  04-text.js        MTEXT 内联码解析 + 多页文本图集
  05-parser.js      容错 DXF 词法/语法解析
  06-batch.js       按图层合批的几何收集器
  07-loader.js      DXFLoader：场景构建、几何发射器、主题切换
  08-pick.js        PickIndex：世界/屏幕空间拾取索引
scripts/            build / test / 示例生成
examples/index.html 自包含双语 CAD 查看器
types/DXFLoader.d.ts 公开 TypeScript 声明
```

---

## 安装

Three.js（≥ r128）是唯一同伴依赖。

```bash
# 从本仓库安装（该包尚未发布到公共 npm registry）
npm install git+https://github.com/zly258/dxfviewer.git three
```

或直接把预构建文件引入页面，无需构建：

```html
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/gh/zly258/dxfviewer@v2.0.1/dist/threejs-dxf-loader.umd.min.js"></script>
```

`npm run build` 生成 `dist/threejs-dxf-loader.umd.js`、`.umd.min.js`、`.esm.js`、`.esm.min.js` 及其 sourcemap 和 `dist/DXFLoader.d.ts`。

---

## 快速上手

### ES Module

```javascript
import * as THREE from 'three';
import { DXFLoader } from 'threejs-dxf-loader';

const loader = new DXFLoader();

// parseAsync 接受 ArrayBuffer、字符串或 URL 字符串
const result = await loader.parseAsync(dxfArrayBuffer, { backgroundColor: 'light' }, (p) => {
  console.log(`${p.percent}%  ${p.stage}`);
});

scene.add(result.scene);
```

### UMD / CDN

```html
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js"></script>
<script src="dist/threejs-dxf-loader.umd.js"></script>
<script>
  const loader = new DXFLoader();
  loader.parseAsync(dxfArrayBuffer).then(result => scene.add(result.scene));
</script>
```

### 仅解析

```javascript
import { DXFParser } from 'threejs-dxf-loader';
const dxf = new DXFParser().parse(dxfString); // { header, tables, blocks, entities, objects }
```

`DXFParser` 不依赖 DOM 或 Three.js 渲染，可直接跑在 Web Worker 中；把 `ArrayBuffer` 交给 `parseAsync` 即可在自己的 Worker 里把大文件解析移出主线程。

### 主题切换

```javascript
// 瞬间切换（< 1 ms），无需重新解析
// 可选值：'light' | 'dark' | 'bw'
DXFLoader.applyBackgroundTheme(result.scene, 'dark');
```

### 资源释放

```javascript
DXFLoader.dispose(result.scene); // 释放几何、材质与图集纹理
```

---

## API 参考

### `new DXFLoader()`

创建加载器实例。

### `loader.setOptions(opts)` → `this`

设置或合并选项，详见 [选项](#选项)。

### `loader.registerFont(name, threeFont)` → `this`

把 Three.js `Font` 注册到某个 CAD 字体名下用于文字渲染。

### `loader.parseAsync(input, options?, onProgress?)` → `Promise<ParseResult>`

| 参数 | 类型 | 说明 |
|---|---|---|
| `input` | `ArrayBuffer \| string` | DXF 数据或 URL |
| `options` | `object?` | 加载选项（与当前选项合并） |
| `onProgress` | `(p: Progress) => void` | `{ percent, stage, detail }` |

```typescript
{
  scene:           THREE.Group,                 // 可直接 add 到场景
  dxf:             object,                      // 原始解析文档
  layers:          Record<string, THREE.Group>, // 归一化图层名 -> 分组
  stats:           ParseStats,
  boundingBox:     THREE.Box3,                  // 去离群后的视口包围盒
  fullBoundingBox: THREE.Box3,                  // 完整 WCS 包围盒
  pickRecords:     PickRecord[],                // 每实体一条
  textRecords:     TextRecord[],                // 可检索的文字四边形
  originShift:     { x: number; y: number; z: number }
}
```

### `loader.parse(input, options?)` → `ParseResult`

`parseAsync` 的同步版本。

### `DXFLoader.applyBackgroundTheme(rootGroup, theme, selectedIdSet?)` → `void`

瞬时顶点色主题切换。`theme` 为 `'light' | 'dark' | 'bw'`；可选 `selectedIdSet` 保留选中高亮。

| 主题 | 背景 | 线条 |
|---|---|---|
| `'light'` | 白色 | ACI 色板（彩色线条） |
| `'dark'` | 黑色 | ACI 色板（彩色线条） |
| `'bw'` | 黑色 | 纯白（单色） |

### `DXFLoader.dispose(rootGroup)` → `void`

递归释放已解析场景的几何、材质与图集纹理。

### `DXFLoader.decodeAcisData(ent, dxf)` → `{ source, satLines } | { source, error }`

把 3D 实体的 ACIS 载荷（SAT 文本或 SAB 二进制）解码为原始 SAT 记录。

### `new PickIndex(pickRecords, options?)`

对解析结果的 `pickRecords` 建立空间索引：

```javascript
import { PickIndex } from 'threejs-dxf-loader';

const index = new PickIndex(result.pickRecords);
index.updateScreen(camera, canvas.clientWidth, canvas.clientHeight);

const hit = index.pickAt(px, py);                        // 最近记录或 null
const candidates = index.queryScreenBox(x0, y0, x1, y1); // 框选宽相位
const nearRay = index.queryRay(raycaster.ray, 0.5);      // 世界空间射线查询
```

### `DXFLoader.DXFParser`

底层解析器类（同样以 `DXFParser` 命名导出）。

---

## 选项

传给 `setOptions()` 或 `parseAsync` / `parse` 的第二个参数。

| 选项 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `backgroundColor` | `'light' \| 'dark' \| 'bw'` | `'light'` | 初始主题 |
| `centerOrigin` | `boolean` | `true` | 将图纸几何中心移到世界原点 |
| `includePaperSpace` | `boolean` | `false` | 是否渲染图纸空间实体 |
| `curveSegments` | `number` | `96` | 整圆/闭合曲线分段数 |
| `minCurveSegments` | `number` | `24` | 圆弧最小分段数 |
| `maxCurveSegments` | `number` | `192` | 曲线最大分段数 |
| `adaptiveCurveSegments` | `boolean` | `true` | 按半径相对模型尺寸缩放圆弧细分 |
| `creaseAngle` | `number` | `44` | 3D 平滑法线折痕角（度） |
| `extrudeThickness` | `boolean` | `true` | 将带 `thickness` 的图元按 3D 实体渲染 |
| `dimensionMode` | `'auto' \| 'computed'` | `'auto'` | `auto` 优先用图纸自带标注块；其他值一律重算 |
| `textAtlasPx` | `number` | `96` | 文本图集名义字高（像素） |
| `textAtlasPageSize` | `number` | `4096` | 每页图集边长（像素）；移动端可降到 1024–2048 |
| `textAtlasMaxPages` | `number` | `64` | 图集页数上限；溢出计入 `stats.droppedText` |
| `fontFamily` | `string` | 系统默认 | 图集 CSS 字体栈，缺省回退到 SimSun / Arial |

---

## 支持的图元

### 2D 几何

`LINE` · `LWPOLYLINE` · `POLYLINE` · `CIRCLE` · `ARC` · `ELLIPSE` · `SPLINE` · `MLINE` · `SOLID` · `TRACE` · `POINT` · `XLINE` · `RAY` · `HELIX` · `WIPEOUT`

### 填充

`HATCH` · `MPOLYGON` — 实体、渐变与标准图案填充，支持多岛孔洞

### 3D 几何

`3DSOLID` · `MESH` · `3DFACE` · `POLYLINE`（3D 网格/多面网格）· 带 `thickness` 的挤出图元

### 文字与标注

`TEXT` · `MTEXT` · `ATTRIB` · `ATTDEF` · `DIMENSION` · `LEADER` · `MLEADER` · `TOLERANCE` · `ACAD_TABLE`

### 结构

`INSERT`（嵌套块、阵列）· `VIEWPORT`（跳过）

### MTEXT 内联码

| 代码 | 效果 |
|---|---|
| `\P` | 段落换行 |
| `\H<n>x` / `\H<n>` | 相对/绝对字高 |
| `\W<n>` | 宽度因子 |
| `\Q<n>` | 倾斜角（度） |
| `\T<n>` | 字间距 |
| `\C<n>` / `\c<n>` | ACI 颜色 / 真彩色 |
| `\F<name>` / `\f<name>` | 字体（可带 `\|b1\|i1` 粗/斜体） |
| `\L` / `\l` | 下划线开 / 关 |
| `\O` / `\o` | 上划线开 / 关 |
| `\K` / `\k` | 删除线开 / 关 |
| `\S<n>^<d>` | 堆叠分数（也支持 `/` 与 `#`） |
| `\A<n>` | 垂直对齐（0 底 / 1 中 / 2 顶） |
| `\pq<l\|c\|r>` | 段落对齐 |
| `\U+XXXX` | Unicode 码点 |
| `%%c` `%%d` `%%p` | ⌀ ° ± 等 `%%` 特殊字符 |
| `{...}` | 样式组（继承并恢复） |

---

## 示例查看器

`examples/index.html` 是自包含的中英双语 CAD 查看器（无需构建）。示例图纸从 `examples/samples/` 按需加载，因此页面本身很小。

```bash
node scripts/serve.mjs        # http://localhost:3001/
```

**内置示例**（用 *加载示例* 下拉切换）：

| Key | 图纸 | 类型 |
|---|---|---|
| `gearbox_2d` | 行星齿轮减速器总成 | 2D 机械 |
| `arch_2d` | 科研办公楼标准层平面图 | 2D 建筑 |
| `spindle_3d` | 五轴加工中心电主轴头 | 3D 实体总成 |
| `robot_3d` | 六轴工业机器人工作站 | 3D 实体 |
| `manifold_2d` | 高压液压集成阀块剖面 | 2D 多岛填充 |
| `elements_2d` | 全元素案例 | 2D 覆盖全部图元 |
| `elements_3d` | 3D 元素案例 | 3D 实体/网格/螺旋线 |
| `huge_2d` | 工厂管廊总平面（超大图纸测试） | 2D 约 1.1 万图元 |
| `million_2d` | 百万图元压力测试（极限吞吐测试） | 2D 100 万图元随机生成 |

带中文版的示例（`elements_2d`、`elements_3d`、`huge_2d`）会随界面语言重新渲染。

**查看器快捷键 / 鼠标：**

| 操作 | 手势 |
|---|---|
| 点选 | 单击 |
| 窗口框选 | 左 → 右拖动 |
| 交叉框选 | 右 → 左拖动 |
| 指向缩放 | 滚轮 |
| 平移 | 中键拖动 |
| 3D 环绕 | 右键拖动 |
| 适应视图 | *适应* 按钮 |
| 导出 PNG | *导出* 按钮或 Ctrl/Cmd+S |

---

## 脚本

| 命令 | 说明 |
|---|---|
| `npm run build` | 构建 `dist/` 并同步 `docs/` 与内联示例包 |
| `npm run dev` | 本地开发服务器（端口 3001） |
| `npm test` | 针对内置样本的解析单元测试 |
| `npm run test:renderer` | 渲染器/精度断言 |
| `npm run test:pick` | `PickIndex` 功能测试（真实 Three.js） |
| `npm run test:e2e` | 浏览器端到端测试（需要 `playwright-core` + Chrome） |
| `npm run test:lang` | 验证双语示例随界面语言切换 |
| `npm run check` | 运行全部非浏览器测试 |
| `npm run sync:samples` | 重新生成双语示例图纸 |

---

## 支持与打赏

如果本项目对你的日常工作与学习有所帮助，欢迎通过爱发电请作者喝一杯咖啡，你的支持将持续推动项目特性的迭代与优化：

* **直达打赏页**：[点击直接打赏（爱发电）](https://ifdian.net/order/create?user_id=3db8e630e6dc11f1b37452540025c377)
* **创作者主页**：[爱发电主页 · zhangly1403](https://ifdian.net/a/zhangly1403)

---

## 许可证

本项目基于 [GNU 通用公共许可证第 3 版 (GPL-3.0)](./LICENSE) 开源发布。

Copyright (C) 2026 zhangly1403 (<zhangly1403@qq.com>)
