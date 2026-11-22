# threejs-dxf-loader

[English](./README.md) | [简体中文](./README.zh-CN.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Three.js](https://img.shields.io/badge/Three.js-%3E%3D0.128.0-black.svg)](https://threejs.org/)
[![GitHub](https://img.shields.io/badge/GitHub-zly258%2Fdxfviewer-181717?logo=github)](https://github.com/zly258/dxfviewer)

A production-grade **AutoCAD DXF parser and Three.js renderer** for 2D engineering drawings and 3D solid assemblies, plus a bilingual (EN / 中文) single-file CAD viewer (`examples/index.html`).

**Live demo:** <https://zly258.github.io/dxfviewer/>

---

## Table of Contents

1. [Features](#features)
2. [Architecture](#architecture)
3. [Installation](#installation)
4. [Quick Start](#quick-start)
5. [API Reference](#api-reference)
6. [Options](#options)
7. [Supported Entities](#supported-entities)
8. [Example Viewer](#example-viewer)
9. [Scripts](#scripts)
10. [License](#license)

---

## Features

### Parsing & rendering

- **Full 2D geometry** — `LINE`, `CIRCLE`, `ARC`, `ELLIPSE`, `SPLINE` (rational NURBS), `LWPOLYLINE`, `POLYLINE`, `MLINE`, `SOLID`, `TRACE`, `XLINE`, `RAY`, `POINT`, `HELIX`, `WIPEOUT`.
- **Filled hatches** — `HATCH` / `MPOLYGON` with solid fills, standard ANSI/ISO patterns, gradient fills, and multi-island hole clipping.
- **3D solids & smooth shading** — `3DSOLID` via ACIS SAT/SAB reconstruction (planar, cone, sphere, torus, revolution-spline surfaces), `MESH` (`AcDbSubDMesh`), `3DFACE`, `POLYLINE` 3D mesh / polyface, closed-contour extrusion (`thickness`) with 44° crease-angle smooth normals.
- **Text** — `TEXT` (all six alignments including Fit/Aligned), `MTEXT` with full inline codes (`\P \H \W \Q \C \c \F \L \O \K \S \T \A \p \U`), `ATTRIB`, `ATTDEF`.
- **Annotation** — `DIMENSION` (all types), `LEADER`, `MLEADER`, `TOLERANCE`, `ACAD_TABLE`.
- **Blocks** — multi-level nested `INSERT` with rotation, scale and array; `ATTRIB` values indexed for search.
- **Encoding** — auto-detects UTF-8 vs GB18030/GBK; decodes `\M+nXXXX` escapes.

### Performance

- **Adaptive curve tessellation** — circle/arc segment counts scale with radius relative to the model size, so thousands of small holes no longer spend the full segment budget. On a synthetic 160 000-circle drawing this cuts vertices by ~75% (30.6M → 7.6M) and build time from ~11 s to ~2.3 s.
- **Spatial picking (`PickIndex`)** — a world-space grid plus a screen-space projected-AABB grid keep point picking and marquee selection at O(candidates) on 100k+ entities. The bundled viewer adds a segment-level narrow phase and block-reference resolution on top.
- **Batched geometry** — one line/mesh per layer and per theme colour buffer; the loader returns one `PickRecord` per entity with a world-space box.
- **Instant theme switch** — precomputed light/dark vertex-colour buffers swap in `< 1 ms`, no re-parse.
- **Async parsing** — time-sliced pipeline that yields to the event loop between stages.
- **Memory-conscious text atlas** — pages are allocated lazily (a line-only drawing never reserves one) and overflow is reported in `stats.droppedText` instead of being dropped silently.

---

## Architecture

```
src/dxf/
  index.js          Public ES module entry (named, tree-shakeable exports)
  00-util.js        Growable buffers, ACI palette, sRGB/linear colour, font mapping, encoding
  01-math.js        OCS→WCS, bulge arcs, NURBS evaluation, crease-angle normals
  02-acis.js        ACIS SAT/SAB decoding + B-rep surface reconstruction
  03-hatch.js       Hatch loop classification + line-type dash tessellation
  04-text.js        MTEXT inline-code parser + multi-page text atlas
  05-parser.js      Fault-tolerant DXF tokeniser and entity parser
  06-batch.js       Batched per-layer geometry collector
  07-loader.js      DXFLoader: scene building, emitters, theme switching
  08-pick.js        PickIndex: world/screen-space picking index
scripts/
  build.mjs         esbuild ESM + UMD builds, type copy, example sync
  test.mjs / test-renderer.mjs / test-pick.mjs / test-e2e.mjs / test-sample-language.mjs
  make-showcase.mjs / make-huge-sample.mjs / sync-showcase.mjs
examples/
  index.html        Self-contained bilingual CAD viewer
  samples/          Sample DXF drawings (fetched on demand)
types/
  DXFLoader.d.ts    Public TypeScript declarations
```

---

## Installation

Three.js (≥ r128) is the only peer dependency.

```bash
# From this repository (the package is not yet published to the public npm registry)
npm install git+https://github.com/zly258/dxfviewer.git three
```

Or drop the prebuilt bundle straight into a page — no build step required:

```html
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/gh/zly258/dxfviewer@v2.0.0/dist/threejs-dxf-loader.umd.min.js"></script>
```

`npm run build` produces `dist/threejs-dxf-loader.umd.js`, `.umd.min.js`, `.esm.js`, `.esm.min.js`, their sourcemaps and `dist/DXFLoader.d.ts`.

---

## Quick Start

### ES module

```javascript
import * as THREE from 'three';
import { DXFLoader } from 'threejs-dxf-loader';

const loader = new DXFLoader();

// parseAsync accepts an ArrayBuffer, a plain string, or a URL string.
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

### Parser only

```javascript
import { DXFParser } from 'threejs-dxf-loader';
const dxf = new DXFParser().parse(dxfString); // { header, tables, blocks, entities, objects }
```

`DXFParser` has no DOM or Three.js rendering dependency, so it can run in a Web Worker unchanged. Pass an `ArrayBuffer` to `parseAsync` to keep large parses off the main thread in your own worker.

### Theme switching

```javascript
// Instant (<1 ms) switch — no re-parse, no re-rasterise.
// Themes: 'light' | 'dark' | 'bw'
DXFLoader.applyBackgroundTheme(result.scene, 'dark');
```

### Disposal

```javascript
DXFLoader.dispose(result.scene); // release geometries, materials and atlas textures
```

---

## API Reference

### `new DXFLoader()`

Creates a loader instance.

### `loader.setOptions(opts)` → `this`

Sets or merges options. See [Options](#options).

### `loader.registerFont(name, threeFont)` → `this`

Registers a Three.js `Font` under a CAD font name for text rendering.

### `loader.parseAsync(input, options?, onProgress?)` → `Promise<ParseResult>`

| Parameter | Type | Description |
|---|---|---|
| `input` | `ArrayBuffer \| string` | DXF data or a URL |
| `options` | `object?` | Loader options (merged with the current options) |
| `onProgress` | `(p: Progress) => void` | `{ percent, stage, detail }` |

```typescript
{
  scene:           THREE.Group,                 // ready to add to your scene
  dxf:             object,                      // raw parsed document
  layers:          Record<string, THREE.Group>, // normalised layer name -> group
  stats:           ParseStats,
  boundingBox:     THREE.Box3,                  // outlier-filtered viewport box
  fullBoundingBox: THREE.Box3,                  // full WCS box
  pickRecords:     PickRecord[],                // one record per entity
  textRecords:     TextRecord[],                // searchable text quads
  originShift:     { x: number; y: number; z: number }
}
```

### `loader.parse(input, options?)` → `ParseResult`

Synchronous version of `parseAsync`.

### `DXFLoader.applyBackgroundTheme(rootGroup, theme, selectedIdSet?)` → `void`

Instant vertex-colour theme swap. `theme` is `'light' | 'dark' | 'bw'`; the optional `selectedIdSet` keeps selected ids highlighted.

| Theme | Background | Lines |
|---|---|---|
| `'light'` | White | ACI palette (colour on white) |
| `'dark'` | Black | ACI palette (colour on black) |
| `'bw'` | Black | White (monochrome) |

### `DXFLoader.dispose(rootGroup)` → `void`

Recursively disposes geometries, materials and atlas textures held by a parsed scene.

### `DXFLoader.decodeAcisData(ent, dxf)` → `{ source, satLines } | { source, error }`

Decodes the ACIS payload (SAT text or binary SAB) of a 3D-solid entity into raw SAT records.

### `new PickIndex(pickRecords, options?)`

Spatial index over a result's `pickRecords`:

```javascript
import { PickIndex } from 'threejs-dxf-loader';

const index = new PickIndex(result.pickRecords);
index.updateScreen(camera, canvas.clientWidth, canvas.clientHeight);

const hit = index.pickAt(px, py);                       // nearest record or null
const candidates = index.queryScreenBox(x0, y0, x1, y1); // marquee broad phase
const nearRay = index.queryRay(raycaster.ray, 0.5);      // ray query (world space)
```

### `DXFLoader.DXFParser`

The underlying parser class (also exported as `DXFParser`).

---

## Options

Pass to `setOptions()` or as the second argument of `parseAsync` / `parse`.

| Option | Type | Default | Description |
|---|---|---|---|
| `backgroundColor` | `'light' \| 'dark' \| 'bw'` | `'light'` | Initial theme |
| `centerOrigin` | `boolean` | `true` | Shift the drawing so its geometric centre is at the world origin |
| `includePaperSpace` | `boolean` | `false` | Render paper-space entities |
| `curveSegments` | `number` | `96` | Segments for a full circle / closed spline |
| `minCurveSegments` | `number` | `24` | Minimum segments for a partial arc |
| `maxCurveSegments` | `number` | `192` | Maximum segments for any curve |
| `adaptiveCurveSegments` | `boolean` | `true` | Scale circle/arc tessellation by radius relative to model size |
| `creaseAngle` | `number` | `44` | Crease angle (degrees) for 3D smooth normals |
| `extrudeThickness` | `boolean` | `true` | Render extruded (`thickness`) entities as 3D solids |
| `dimensionMode` | `'auto' \| 'computed'` | `'auto'` | `auto` uses the drawing's own dimension block when present; any other value recomputes |
| `textAtlasPx` | `number` | `96` | Nominal glyph size in the text atlas |
| `textAtlasPageSize` | `number` | `4096` | Side length (px) of each atlas page; lower to 1024–2048 on memory-constrained devices |
| `textAtlasMaxPages` | `number` | `64` | Safety cap on atlas pages; overflow is reported in `stats.droppedText` |
| `fontFamily` | `string` | system default | CSS font-family for the text atlas; falls back to SimSun / Arial |

---

## Supported Entities

### 2D geometry

`LINE` · `LWPOLYLINE` · `POLYLINE` · `CIRCLE` · `ARC` · `ELLIPSE` · `SPLINE` · `MLINE` · `SOLID` · `TRACE` · `POINT` · `XLINE` · `RAY` · `HELIX` · `WIPEOUT`

### Fills

`HATCH` · `MPOLYGON` — solid, gradient and standard pattern fills with multi-island holes

### 3D geometry

`3DSOLID` · `MESH` · `3DFACE` · `POLYLINE` (3D mesh / polyface) · extruded entities (code 39 `thickness`)

### Text & annotation

`TEXT` · `MTEXT` · `ATTRIB` · `ATTDEF` · `DIMENSION` · `LEADER` · `MLEADER` · `TOLERANCE` · `ACAD_TABLE`

### Structure

`INSERT` (nested blocks, arrays) · `VIEWPORT` (skipped)

### MTEXT inline codes

| Code | Effect |
|---|---|
| `\P` | Paragraph break |
| `\H<n>x` / `\H<n>` | Height relative to base / absolute |
| `\W<n>` | Width factor |
| `\Q<n>` | Oblique angle (degrees) |
| `\T<n>` | Character tracking |
| `\C<n>` / `\c<n>` | ACI colour / true colour |
| `\F<name>` / `\f<name>` | Font (with `\|b1\|i1` bold/italic flags) |
| `\L` / `\l` | Underline on / off |
| `\O` / `\o` | Overline on / off |
| `\K` / `\k` | Strikethrough on / off |
| `\S<n>^<d>` | Stacked fraction (also `/` and `#`) |
| `\A<n>` | Vertical alignment (0 bottom, 1 centre, 2 top) |
| `\pq<l\|c\|r>` | Paragraph alignment |
| `\U+XXXX` | Unicode code point |
| `%%c` `%%d` `%%p` | ⌀ ° ± and other `%%` special characters |
| `{...}` | Style group (inherits and restores) |

---

## Example Viewer

`examples/index.html` is a self-contained bilingual CAD viewer (no build step). Sample drawings are fetched from `examples/samples/` on demand, so the page itself stays small.

```bash
node scripts/serve.mjs        # http://localhost:3001/
```

**Built-in samples** (switch with the *Samples* dropdown):

| Key | Drawing | Type |
|---|---|---|
| `gearbox_2d` | Planetary gearbox assembly | 2D mechanical |
| `arch_2d` | Research-office floor plan | 2D architectural |
| `spindle_3d` | 5-axis CNC spindle head | 3D solid assembly |
| `robot_3d` | 6-axis industrial robot cell | 3D solid |
| `manifold_2d` | Hydraulic manifold cross-section | 2D with multi-island hatch |
| `elements_2d` | All Element Types showcase | 2D — every entity type |
| `elements_3d` | 3D Element Types showcase | 3D — solids, mesh, helix |
| `huge_2d` | Plant layout (huge drawing test) | 2D — ~11 k entities |

Samples with Chinese variants (`elements_2d`, `elements_3d`, `huge_2d`) re-render when the UI language changes.

**Viewer keyboard / mouse shortcuts:**

| Action | Gesture |
|---|---|
| Point pick | Click |
| Box select (window) | Drag left → right |
| Box select (crossing) | Drag right → left |
| Zoom to cursor | Scroll wheel |
| Pan | Middle-button drag |
| 3D orbit | Right-button drag |
| Fit view | *Fit* button |
| Export PNG | *Export* button or Ctrl/Cmd+S |

---

## Scripts

| Command | Description |
|---|---|
| `npm run build` | Build `dist/` and sync `docs/` + the inline example bundle |
| `npm run dev` | Start the local dev server on port 3001 |
| `npm test` | Parser unit tests over the bundled samples |
| `npm run test:renderer` | Renderer / precision assertions |
| `npm run test:pick` | Functional `PickIndex` test (real Three.js) |
| `npm run test:e2e` | End-to-end browser tests (requires `playwright-core` + Chrome) |
| `npm run test:lang` | Verify bilingual samples switch with the UI language |
| `npm run check` | Run all non-browser tests |
| `npm run sync:samples` | Regenerate the bilingual sample drawings |

---

## License

[MIT](./LICENSE) — © zhangly1403 (<zhangly1403@qq.com>)
