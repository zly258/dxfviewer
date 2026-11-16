# threejs-dxf-loader

[English](./README.md) | [简体中文](./README.zh-CN.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Three.js](https://img.shields.io/badge/Three.js-%3E%3D0.128.0-black.svg)](https://threejs.org/)
[![Author](https://img.shields.io/badge/Author-zhangly1403-emerald.svg)](https://github.com/zhangly1403)

基于 **Three.js** 的高性能 **AutoCAD DXF 二维/三维完整解析与 WebGL 渲染库**，内置一套 **中英双语 CAD 查看器案例 (`examples/index.html`)**。

- **开发者**: `zhangly1403` (<zhangly1403@qq.com>)
- **在线演示 (GitHub Pages)**: `https://zly258.github.io/dxfviewer/`

---

## 核心特性

1. **完整的二维、三维与多层嵌套解析**:
   - **二维几何**: `LINE`、`LWPOLYLINE`（凸度圆弧/常宽/变宽）、`POLYLINE`、`CIRCLE`、`ARC`、`ELLIPSE`、`SPLINE`（NURBS）、`MLINE`、`SOLID`、`HATCH`（多岛孔洞裁剪）等。
   - **三维实体与曲面平滑**: 完整支持 `3DSOLID`（ACIS SAT/SAB 解密、平面三角化与同轴圆柱扫掠）、`MESH`（`AcDbSubDMesh`）、`3DFACE`、`POLYLINE` 三维网格/多面体，以及闭合厚度拉伸顶底封盖与 **44° 折痕角法线平滑**。
   - **实心填充文字、全对齐与 `%%` 特殊符号**: 精确支持 `TEXT`（左/中/右/居中/对齐/Fit 两端自适应）、`MTEXT`、`ATTRIB`、`DIMENSION`、`ACAD_TABLE`，完整解码 `%%c` (`⌀`)、`%%d` (`°`)、`%%p` (`±`)、`%%130`–`%%135`、`%%176`–`%%248`、`%%%`；未匹配字体默认回退 **宋体 (`SimSun`) / Arial**。
2. **白底 / 黑底与黑白单色模式 (`<1ms` 零延迟切换)**:
   - 支持 **白底 (`light`)**、**黑底 (`dark`)**、**白底黑白 (`bw_light`)**、**黑底黑白 (`bw_dark`)** 四种模式，底层双缓冲顶点色瞬间切换。
3. **中英双语 CAD 查看器 (`examples/index.html`)**:
   - **2D 视图锁定左键旋转**: 2D 模式自动禁用左键旋转，专心缩放与平移；3D 模式支持全向旋转观察。
   - **颜色高亮**: 点选与框选直接以鲜明高亮色着重显示选中图元自身，无多余包围盒遮挡。
   - **AutoCAD 窗口 / 交叉框选**: 左→右（蓝框实线）全包含，右→左（绿框虚线）相交即选。
   - **独立可关闭模糊检索面板**: 支持按文本、属性/块/图层、标注及 `#句柄` 模糊匹配并一键缩放定位。
   - **精简属性面板 & 图层检索**: 右侧属性面板仅展示当前选中对象的属性，左侧支持实时过滤图层。

---

## 本地运行

```bash
git clone https://github.com/zly258/dxfviewer.git
cd dxfviewer
node scripts/build.mjs     # 构建 dist/ 与 docs/
node scripts/test.mjs      # 运行自动化解析测试
node scripts/serve.mjs     # 本地预览 http://localhost:8080/
```

---

## 快速上手

```javascript
import * as THREE from 'three';
import { DXFLoader } from 'threejs-dxf-loader';

const loader = new DXFLoader();
const result = await loader.parseAsync(dxfArrayBuffer, { backgroundColor: 'light' }, (p) => {
  console.log(`${p.percent}% - ${p.stage}`);
});
scene.add(result.scene);

// <1ms 零延迟切换 白底 / 黑底 / 白底黑白 / 黑底黑白
DXFLoader.applyBackgroundTheme(result.scene, 'bw_light');
```

---

## 发布到 GitHub Pages

推送到 `main` 分支后，`.github/workflows/ci-and-pages.yml` 会自动构建并把 `docs/` 发布到 GitHub Pages。

## 开发者与协议

- **开发者**: **zhangly1403** (<zhangly1403@qq.com>)
- **开源协议**: [MIT License](./LICENSE)
