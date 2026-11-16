# three-dxf-loader

[English](./README.md) | [简体中文](./README.zh-CN.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Three.js](https://img.shields.io/badge/Three.js-%3E%3D0.128.0-black.svg)](https://threejs.org/)
[![Author](https://img.shields.io/badge/Author-zhangly1403-emerald.svg)](https://github.com/zhangly1403)

A complete, production-grade **2D & 3D AutoCAD DXF parser and WebGL renderer** built on Three.js, paired with a **Minimalist Material Design (MD) bilingual (`中文 / EN`) CAD viewer** (`examples/index.html`).

- **Developer / Author**: `zhangly1403` (<zhangly1403@qq.com>)
- **Live Demo (GitHub Pages)**: `https://zly258.github.io/dxfviewer/`

---

## Key Features

1. **Complete 2D & 3D Entity Reproduction**:
   - **2D Entities**: `LINE`, `LWPOLYLINE` (bulge arcs, constant & tapered widths), `POLYLINE`, `CIRCLE`, `ARC`, `ELLIPSE`, `SPLINE` (Cox–de Boor rational NURBS), `MLINE`, `SOLID`, `TRACE`, `POINT`, `XLINE`, `RAY`, `HELIX`, `WIPEOUT`.
   - **3D Solids & Smooth Shading**: Reconstructs `3DSOLID` (ACIS SAT + XOR-159 `.sab` decryption with planar face triangulation & coaxial cylinder lofting), `MESH` (`AcDbSubDMesh`), `3DFACE`, `POLYLINE` 3D M×N & polyface meshes, and caps closed extruded contours (`thickness` code `39`) with **44° Crease-Angle Smooth Vertex Normals**.
   - **Multi-Level Nested Blocks & Attributes**: Recursive `INSERT` + `ATTRIB` rendering and search indexing.
   - **Solid Filled Text, Alignments & `%%` Symbols**: Supports `TEXT` (Left, Center, Right, Middle, Aligned, Fit), `MTEXT` (`\P`, `\S`, `\H`, `\W`, `\Q`, `\C`, ``), `DIMENSION`, `LEADER`, `MLEADER`, `ACAD_TABLE`, and full `%%` codes (`%%c` `⌀`, `%%d` `°`, `%%p` `±`, `%%130`–`%%135`, `%%176`–`%%248`, `%%%`). Unmatched CAD fonts automatically fall back to **SimSun (`宋体`) / Arial**.
2. **4 Instant Themes (`<1ms` Zero Re-Parse)**:
   - Supports **White (`light`)**, **Black (`dark`)**, **B&W Light (`bw_light`)**, and **B&W Dark (`bw_dark`)** monochrome CAD modes via `DXFLoader.applyBackgroundTheme(rootGroup, bgTheme, selectedIdSet)`.
3. **Minimalist Material Design Bilingual Viewer (`examples/index.html`)**:
   - **2D Rotation Lock**: 2D Top view locks left-click rotation (`enableRotate = false`) for clean pan/zoom; 3D Iso view enables full 3D orbit.
   - **Color Highlighting**: Selected entities highlight directly by vertex color rather than cluttering bounding boxes.
   - **AutoCAD Window & Crossing Box Selection**: Left→Right (solid blue) Window inclusion / Right→Left (dashed green) Crossing intersection.
   - **Closable Fuzzy Search Panel**: Search text, attributes, blocks, layers, and `#handles` with instant camera locate.
   - **Selected-Only Property Panel** & **Left Layer Search Filter**.

---

## Installation & Local Run

```bash
npm install three @zhangly1403/dxfviewer
```

Run the repository locally:

```bash
git clone https://github.com/zly258/dxfviewer.git
cd three-dxf-loader
npm run build
npm test
npm run dev
# Opens http://localhost:8080/
```

---

## Quick Start

```javascript
import * as THREE from 'three';
import { DXFLoader } from '@zhangly1403/dxfviewer';

const loader = new DXFLoader();
const result = await loader.parseAsync(dxfArrayBuffer, { backgroundColor: 'light' }, (p) => {
  console.log(`${p.percent}% - ${p.stage}`);
});
scene.add(result.scene);

// Instant (<1ms) switch to White, Black, or B&W Monochrome mode
DXFLoader.applyBackgroundTheme(result.scene, 'bw_light');
```

---

## Publishing to GitHub Pages & NPM

- **GitHub Pages**: Push to `main` and set **Settings → Pages → Source** to **GitHub Actions** (`.github/workflows/ci-and-pages.yml`).
- **NPM**: Add `NPM_TOKEN` in repository secrets and publish a GitHub Release (`.github/workflows/npm-publish.yml`), or run `npm publish --access public`.

## Author & License

- **Author**: **zhangly1403** (<zhangly1403@qq.com>)
- **License**: [MIT License](./LICENSE)
