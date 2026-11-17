# threejs-dxf-loader

[English](./README.md) | [简体中文](./README.zh-CN.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Three.js](https://img.shields.io/badge/Three.js-%3E%3D0.128.0-black.svg)](https://threejs.org/)
[![GitHub](https://img.shields.io/badge/GitHub-zly258%2Fdxfviewer-181717?logo=github)](https://github.com/zly258/dxfviewer)

基于 **Three.js** 的高性能 **AutoCAD DXF 解析与 WebGL 渲染库**，同时支持 2D 工程图纸和完整的 3D 实体装配，内置一套**中英双语 CAD 查看器** (`examples/index.html`)。

**在线演示：** <https://zly258.github.io/dxfviewer/>

---

## 目录

1. [功能特性](#功能特性)
2. [安装](#安装)
3. [快速上手](#快速上手)
4. [API 参考](#api-参考)
5. [选项](#选项)
6. [支持的实体类型](#支持的实体类型)
7. [示例查看器](#示例查看器)
8. [脚本命令](#脚本命令)
9. [架构说明](#架构说明)
10. [许可证](#许可证)

---

## 功能特性

### 解析与渲染
- **完整 2D 几何** — `LINE`、`CIRCLE`、`ARC`、`ELLIPSE`、`SPLINE`（有理 NURBS）、`LWPOLYLINE`、`POLYLINE`、`MLINE`、`SOLID`、`TRACE`、`XLINE`、`RAY`、`POINT`、`HELIX`、`WIPEOUT`。
- **实心填充** — `HATCH` / `MPOLYGON`，支持实体填充、ANSI/ISO 标准线型填充、渐变色，以及多岛孔洞裁剪。
- **3D 实体与曲面平滑** — `3DSOLID`（ACIS SAT/SAB 解密重建：平面/锥面/球面/圆环面/旋转样条曲面）、`MESH`（`AcDbSubDMesh`）、`3DFACE`、`POLYLINE` 三维网格/多面体，拉伸实体（`thickness`）封盖，**44° 折痕角法线平滑**。
- **文字** — `TEXT`（全部 6 种对齐，含 Fit/Aligned 自适应）、`MTEXT`（全行内控制码）、`ATTRIB`、`ATTDEF`。
- **标注** — `DIMENSION`（全类型）、`LEADER`、`MLEADER`、`TOLERANCE`、`ACAD_TABLE`。
- **块引用** — 多层嵌套 `INSERT`（旋转/缩放/阵列），`ATTRIB` 属性值索引可搜索。

### 性能
- **O(候选) 点选** — 世界坐标网格索引做宽相位，线段逆向索引做窄相位。160 000 实体图纸上点选延迟 < 100 ms（p50 约 66 ms）。
- **无实体上限** — 每个实体无条件获得 pickRecord（原 50 k 上限已移除）。
- **异步解析** — 分阶段让出事件循环，浏览器不卡顿。
- **主题瞬间切换** — 顶点色 `< 1 ms` 切换，无需重新解析。

### 查看器 (`examples/index.html`)
- 默认英文界面，一键切换中文（选择跨会话记忆）。
- **双语示例图纸** — 示例图纸有中英两版，切换界面语言时自动重渲染当前示例。
- AutoCAD 式统一点选/框选（单击=点选，拖动=框选，左→右=窗口，右→左=交叉）。
- 图层面板、模糊实体搜索、属性面板（含块属性显示）。

---

## 安装

Three.js（≥ r128）是唯一同伴依赖，无其他运行时依赖。

```bash
npm install threejs-dxf-loader three
```

也可以直接使用 `dist/threejs-dxf-loader.umd.js`，配合 Three.js CDN 版本以 `<script>` 标签引入。

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

### 主题切换

```javascript
// 瞬间切换主题（< 1 ms），无需重新解析
// 可选值：'light' | 'dark' | 'bw_light' | 'bw_dark'
DXFLoader.applyBackgroundTheme(result.scene, 'dark');
```

### 同步解析

```javascript
const result = loader.parse(dxfString);
scene.add(result.scene);
```

---

## API 参考

### `new DXFLoader()`

创建一个加载器实例。

### `loader.setOptions(opts)` → `this`

设置或合并选项，详见 [选项](#选项)。

### `loader.parseAsync(input, options?, onProgress?)` → `Promise<ParseResult>`

异步解析 DXF，在各阶段间让出事件循环。

| 参数 | 类型 | 说明 |
|---|---|---|
| `input` | `ArrayBuffer \| string` | DXF 文件数据或 URL |
| `options` | `object?` | 加载选项（与当前选项合并） |
| `onProgress` | `(p: Progress) => void` | 进度回调：`{ percent, stage, detail }` |

返回 `ParseResult`：

```typescript
{
  scene:        THREE.Group,        // 可直接 add 到场景
  layers:       Record<string, LayerInfo>,
  pickRecords:  PickRecord[],       // 每实体一条，供点选逻辑使用
  globalBBox:   THREE.Box3,
  stats:        ParseStats
}
```

### `loader.parse(input, options?)` → `ParseResult`

`parseAsync` 的同步版本，适用于 Node.js Worker 或简单脚本场景。

### `DXFLoader.applyBackgroundTheme(rootGroup, theme, selectedIdSet?)` → `void`

对 `parseAsync` 返回的场景进行瞬时主题切换。

| 主题 | 背景 | 线条 |
|---|---|---|
| `'light'` | 白色 | ACI 色板（彩色线条） |
| `'dark'` | 黑色 | ACI 色板（彩色线条） |
| `'bw_light'` | 白色 | 纯黑 |
| `'bw_dark'` | 黑色 | 纯白 |

### `DXFLoader.decodeAcisData(ent, dxf)` → `{ source, satLines } | { source, error }`

将 3D 实体的 ACIS 负载（SAT 文本或二进制 SAB）解码为原始 SAT 记录。适用于需要检查或导出 B-rep 数据的宿主应用。

### `DXFLoader.DXFParser`

底层 DXF 词法分析 / 解析类。仅需实体树而无需几何时可单独使用：

```javascript
const parser = new DXFLoader.DXFParser();
const dxf = parser.parse(dxfString);
console.log(dxf.entities.length);
```

---

## 选项

传递给 `setOptions()` 或 `parseAsync` / `parse` 的第二个参数。

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `backgroundColor` | `'light' \| 'dark' \| 'bw_light' \| 'bw_dark'` | `'light'` | 初始主题 |
| `centerOrigin` | `boolean` | `true` | 将图纸几何中心移到世界原点 |
| `includePaperSpace` | `boolean` | `false` | 是否渲染图纸空间实体 |
| `curveSegments` | `number` | `96` | 完整圆/闭合样条的分段数 |
| `minCurveSegments` | `number` | `24` | 弧线的最小分段数 |
| `maxCurveSegments` | `number` | `192` | 任何曲线的最大分段数 |
| `creaseAngle` | `number` | `44` | 3D 曲面法线平滑的折痕角（度） |
| `extrudeThickness` | `boolean` | `true` | 将有厚度（`thickness`）的实体渲染为三维实体 |
| `dimensionMode` | `'auto' \| 'computed'` | `'auto'` | `auto` 优先使用 DXF 自带的标注块，`computed` 总是重新计算 |
| `textAtlasPx` | `number` | `96` | 文字图集的标称字形像素大小（提高此值可在高 DPI 下获得更清晰文字） |
| `fontFamily` | `string` | 系统默认 | 文字图集的 CSS 字体族，自动回退到宋体 / Arial |

---

## 支持的实体类型

### 二维几何
`LINE` · `LWPOLYLINE` · `POLYLINE` · `CIRCLE` · `ARC` · `ELLIPSE` · `SPLINE` · `MLINE` · `SOLID` · `TRACE` · `POINT` · `XLINE` · `RAY` · `HELIX` · `WIPEOUT`

### 填充
`HATCH` · `MPOLYGON` — 实体填充、渐变色、标准图案，支持多岛孔洞

### 三维几何
`3DSOLID` · `MESH` · `3DFACE` · `POLYLINE`（三维网格/多面体） · 拉伸实体（组码 39 `thickness`）

### 文字与标注
`TEXT` · `MTEXT` · `ATTRIB` · `ATTDEF` · `DIMENSION` · `LEADER` · `MLEADER` · `TOLERANCE` · `ACAD_TABLE`

### 结构
`INSERT`（嵌套块/阵列） · `VIEWPORT`（跳过）

### MTEXT 行内控制码

| 控制码 | 效果 |
|---|---|
| `\P` | 段落换行 |
| `\H<n>x` / `\H<n>` | 相对基准高度的倍数 / 绝对高度 |
| `\W<n>` | 宽度因子 |
| `\Q<n>` | 斜体角（度） |
| `\T<n>` | 字符间距（追踪）因子 |
| `\C<n>` / `\c<n>` | ACI 颜色 / 真彩色 |
| `\F<name>` / `\f<name>` | 字体（`\|b1\|i1` 粗体/斜体标志） |
| `\L` / `\l` | 下划线开/关 |
| `\O` / `\o` | 上划线开/关 |
| `\K` / `\k` | 删除线开/关 |
| `\S<n>^<d>` | 堆叠分数（也支持 `/` 和 `#`） |
| `\A<n>` | 垂直对齐（0=底，1=中，2=顶） |
| `\pq<l\|c\|r>` | 段落对齐 |
| `\U+XXXX` | Unicode 码点 |
| `%%c` `%%d` `%%p` | ⌀ ° ± 及其他 `%%` 特殊符号 |
| `{...}` | 样式组（继承并自动恢复） |

---

## 示例查看器

`examples/index.html` 是一个自包含的单文件 CAD 查看器，本地运行：

```bash
node scripts/serve.mjs        # http://localhost:3001/
```

**内置示例**（通过 *Samples* 下拉菜单切换）：

| 键名 | 图纸 | 类型 |
|---|---|---|
| `gearbox_2d` | 行星齿轮减速器总成图 | 2D 机械 |
| `arch_2d` | 科研办公楼标准层平面图 | 2D 建筑 |
| `spindle_3d` | 五轴加工中心电主轴头 | 3D 实体装配 |
| `robot_3d` | 六轴工业机器人工作站 | 3D 实体 |
| `manifold_2d` | 高压液压集成阀块剖面 | 2D 多岛填充 |
| `elements_2d` | 全元素案例（所有图元类型） | 2D 展示 |
| `elements_3d` | 3D 元素案例（实体/网格/螺旋线） | 3D 展示 |
| `huge_2d` | 工厂管廊总平面（超大图纸测试） | 2D 约 11 k 实体 |

每个双语示例都有中英两版图纸；切换界面语言时自动重渲染当前示例。

**查看器鼠标/键盘操作：**

| 操作 | 手势 |
|---|---|
| 点选 | 单击 |
| 窗口框选 | 鼠标向右拖动 |
| 交叉框选 | 鼠标向左拖动 |
| 缩放到光标 | 滚轮 |
| 平移 | 中键拖动 |
| 三维旋转 | 右键拖动 |
| 适应视图 | *Fit* 按钮 |

---

## 脚本命令

| 命令 | 说明 |
|---|---|
| `npm run build` | 构建 `dist/` 并同步 `docs/` |
| `npm run dev` | 在 3001 端口启动本地开发服务器 |
| `npm test` | 运行解析器单元测试 |
| `npm run test:renderer` | 运行渲染器/精度断言 |
| `npm run test:e2e` | 端到端浏览器测试（需要 `playwright-core`） |
| `npm run test:lang` | 验证双语示例随界面语言切换 |
| `npm run check` | 运行全部非浏览器测试 |
| `npm run sync:samples` | 重新生成双语示例图纸 |

---

## 架构说明

```
src/
  DXFLoader.js          单文件库（约 7 000 行）
    ├─ DXFParser          DXF 词法分析与实体解析
    ├─ DXFLoader          场景构建与几何生成
    │   ├─ emitEntity     按类型分发到各专用生成器
    │   ├─ emitACISSolid  ACIS SAT/SAB 重建
    │   └─ MultiPageTextAtlas  基于 Canvas 的字形图集
    └─ 辅助函数           OCS→WCS、NURBS、折痕法线

scripts/
  build.mjs             零依赖构建与部署脚本
  serve.mjs             本地 HTTP 服务器
  test.mjs              解析器单元测试
  test-renderer.mjs     渲染器断言
  test-e2e.mjs          浏览器端到端测试
  test-sample-language.mjs  语言切换测试
  make-showcase.mjs     生成双语展示图纸
  make-huge-sample.mjs  生成大型工厂平面布置图
  sync-showcase.mjs     将示例图纸载荷同步到 HTML

examples/
  index.html            自包含的 CAD 查看器
  samples/              内置示例 DXF 图纸
```

---

## 许可证

[MIT](./LICENSE) — © zhangly1403 (<zhangly1403@qq.com>)
