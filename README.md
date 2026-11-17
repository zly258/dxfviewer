# threejs-dxf-loader

[English](./README.md) | [简体中文](./README.zh-CN.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Three.js](https://img.shields.io/badge/Three.js-%3E%3D0.128.0-black.svg)](https://threejs.org/)
[![GitHub](https://img.shields.io/badge/GitHub-zly258%2Fdxfviewer-181717?logo=github)](https://github.com/zly258/dxfviewer)

A production-grade **AutoCAD DXF parser and Three.js renderer** that handles both 2D engineering drawings and full 3D solid assemblies, paired with a **bilingual (EN / 中文) CAD viewer** (`examples/index.html`).

**Live demo:** <https://zly258.github.io/dxfviewer/>

---

## Table of Contents

1. [Features](#features)
2. [Installation](#installation)
3. [Quick Start](#quick-start)
4. [API Reference](#api-reference)
5. [Options](#options)
6. [Supported Entities](#supported-entities)
7. [Example Viewer](#example-viewer)
8. [Scripts](#scripts)
9. [Architecture](#architecture)
10. [License](#license)

---

## Features

### Parsing & Rendering
- **Full 2D geometry** — `LINE`, `CIRCLE`, `ARC`, `ELLIPSE`, `SPLINE` (rational NURBS), `LWPOLYLINE`, `POLYLINE`, `MLINE`, `SOLID`, `TRACE`, `XLINE`, `RAY`, `POINT`, `HELIX`, `WIPEOUT`.
- **Filled hatches** — `HATCH` / `MPOLYGON` with solid fills, standard ANSI/ISO patterns, gradient fills, and multi-island hole clipping.
- **3D solids & smooth shading** — `3DSOLID` via ACIS SAT/SAB reconstruction (planar, cone, sphere, torus, revolution-spline surfaces), `MESH` (`AcDbSubDMesh`), `3DFACE`, `POLYLINE` 3D mesh / polyface, closed-contour extrusion (`thickness`) with 44° crease-angle smooth normals.
- **Text** — `TEXT` (all six alignments including Fit/Aligned), `MTEXT` with full inline codes (`\P \H \W \Q \C \c \F \L \O \K \S \T \A \p \U`), `ATTRIB`, `ATTDEF`.
- **Annotation** — `DIMENSION` (all types), `LEADER`, `MLEADER`, `TOLERANCE`, `ACAD_TABLE`.
- **Blocks** — multi-level nested `INSERT` with rotation, scale, and array; `ATTRIB` values indexed for search.

### Performance
- **O(candidates) point picking** — world-space grid index for the broad phase; segment inverse index for the narrow phase. Picking stays below 100 ms on drawings with 160 000+ entities.
- **Unlimited pick records** — every entity, regardless of drawing size, gets a pick record (previous 50 k cap removed).
- **Async parsing** — yielding render loop so the browser stays responsive.
- **Instant theme switch** — `<1 ms` vertex-colour swap with no re-parse.

### Viewer (`examples/index.html`)
- Opens in English; one-click switch to Chinese (choice remembered across sessions).
- **Bilingual sample drawings** — showcase and plant-layout samples exist in both languages; switching the UI language re-renders the current sample.
- AutoCAD-style unified pick/box selection (click = point pick, drag = box, left→right = window, right→left = crossing).
- Layer panel, fuzzy entity search, property panel with block attribute display.

---

## Installation

The library has no runtime dependencies beyond Three.js (≥ r128) which is a peer dependency.

```bash
# npm
npm install threejs-dxf-loader three
```

Alternatively, copy `dist/threejs-dxf-loader.umd.js` and load it with a `<script>` tag alongside the Three.js CDN build.

---

## Quick Start

### ES Module

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

### Theme switching

```javascript
// Instant (<1 ms) switch — no re-parse, no re-render.
// Themes: 'light' | 'dark' | 'bw_light' | 'bw_dark'
DXFLoader.applyBackgroundTheme(result.scene, 'dark');
```

### Synchronous parse

```javascript
const result = loader.parse(dxfString);
scene.add(result.scene);
```

---

## API Reference

### `new DXFLoader()`

Creates a loader instance.

### `loader.setOptions(opts)` → `this`

Sets or merges options before parsing. See [Options](#options).

### `loader.parseAsync(input, options?, onProgress?)` → `Promise<ParseResult>`

Parses a DXF file asynchronously, yielding to the event loop between stages.

| Parameter | Type | Description |
|---|---|---|
| `input` | `ArrayBuffer \| string` | DXF file data or URL |
| `options` | `object?` | Loader options (merged with current options) |
| `onProgress` | `(p: Progress) => void` | Optional progress callback: `{ percent, stage, detail }` |

Returns a `ParseResult`:

```typescript
{
  scene:        THREE.Group,        // ready to add to your scene
  layers:       Record<string, LayerInfo>,
  pickRecords:  PickRecord[],       // one record per entity, used by pickers
  globalBBox:   THREE.Box3,
  stats:        ParseStats
}
```

### `loader.parse(input, options?)` → `ParseResult`

Synchronous version of `parseAsync`. Blocks the thread; suitable for Node.js workers.

### `DXFLoader.applyBackgroundTheme(rootGroup, theme, selectedIdSet?)` → `void`

Instant vertex-colour theme swap on a scene returned by `parseAsync`.

| Theme | Background | Lines |
|---|---|---|
| `'light'` | White | ACI palette (colour on white) |
| `'dark'` | Black | ACI palette (colour on black) |
| `'bw_light'` | White | Black |
| `'bw_dark'` | Black | White |

### `DXFLoader.decodeAcisData(ent, dxf)` → `{ source, satLines } | { source, error }`

Decodes the ACIS payload (SAT text or binary SAB) of a 3D solid entity into the raw SAT records. Useful for host applications that need to inspect or export B-rep data.

### `DXFLoader.DXFParser`

The underlying DXF tokeniser / parser class. Use it directly when you only need the parsed entity tree without geometry:

```javascript
const parser = new DXFLoader.DXFParser();
const dxf = parser.parse(dxfString);
console.log(dxf.entities.length);
```

---

## Options

Pass to `setOptions()` or as the second argument of `parseAsync` / `parse`.

| Option | Type | Default | Description |
|---|---|---|---|
| `backgroundColor` | `'light' \| 'dark' \| 'bw_light' \| 'bw_dark'` | `'light'` | Initial theme |
| `centerOrigin` | `boolean` | `true` | Shift the drawing so its geometric centre is at world origin |
| `includePaperSpace` | `boolean` | `false` | Render paper-space entities |
| `curveSegments` | `number` | `96` | Segments for a full circle / closed spline |
| `minCurveSegments` | `number` | `24` | Minimum segments for a partial arc |
| `maxCurveSegments` | `number` | `192` | Maximum segments for any curve |
| `creaseAngle` | `number` | `44` | Crease angle (degrees) for 3D smooth normals |
| `extrudeThickness` | `boolean` | `true` | Render extruded (`thickness`) entities as 3D solids |
| `dimensionMode` | `'auto' \| 'computed'` | `'auto'` | `auto` uses the DXF dimension block when it exists; `computed` always recalculates |
| `textAtlasPx` | `number` | `96` | Nominal glyph size in the text atlas (increase for sharper text at high DPI) |
| `fontFamily` | `string` | system default | CSS font-family for the text atlas; falls back to SimSun / Arial automatically |

---

## Supported Entities

### 2D Geometry
`LINE` · `LWPOLYLINE` · `POLYLINE` · `CIRCLE` · `ARC` · `ELLIPSE` · `SPLINE` · `MLINE` · `SOLID` · `TRACE` · `POINT` · `XLINE` · `RAY` · `HELIX` · `WIPEOUT`

### Fills
`HATCH` · `MPOLYGON` — solid, gradient, and standard pattern fills with multi-island holes

### 3D Geometry
`3DSOLID` · `MESH` · `3DFACE` · `POLYLINE` (3D mesh / polyface) · extruded entities (code 39 `thickness`)

### Text & Annotation
`TEXT` · `MTEXT` · `ATTRIB` · `ATTDEF` · `DIMENSION` · `LEADER` · `MLEADER` · `TOLERANCE` · `ACAD_TABLE`

### Structure
`INSERT` (nested blocks, arrays) · `VIEWPORT` (skipped)

### MTEXT Inline Codes
| Code | Effect |
|---|---|
| `\P` | Paragraph break |
| `\H<n>x` / `\H<n>` | Height relative to base / absolute |
| `\W<n>` | Width factor |
| `\Q<n>` | Oblique angle (degrees) |
| `\T<n>` | Character tracking (letter spacing) |
| `\C<n>` / `\c<n>` | ACI colour / true colour |
| `\F<name>` / `\f<name>` | Font (with `\|b1\|i1` bold/italic flags) |
| `\L` / `\l` | Underline on / off |
| `\O` / `\o` | Overline on / off |
| `\K` / `\k` | Strikethrough on / off |
| `\S<n>^<d>` | Stacked fraction (also `/` and `#`) |
| `\A<n>` | Vertical alignment (0 = bottom, 1 = centre, 2 = top) |
| `\pq<l\|c\|r>` | Paragraph alignment |
| `\U+XXXX` | Unicode code point |
| `%%c` `%%d` `%%p` | ⌀ ° ± and other `%%` special characters |
| `{...}` | Style group (inherits and restores) |

---

## Example Viewer

`examples/index.html` is a self-contained single-file CAD viewer. Run it locally with:

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

Each bilingual sample exists in English and Chinese; switching the UI language automatically re-renders the current sample.

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

---

## Scripts

| Command | Description |
|---|---|
| `npm run build` | Build `dist/` and sync `docs/` |
| `npm run dev` | Start local dev server on port 3001 |
| `npm test` | Run parser unit tests |
| `npm run test:renderer` | Run renderer / precision assertions |
| `npm run test:e2e` | End-to-end browser tests (requires `playwright-core`) |
| `npm run test:lang` | Verify that bilingual samples switch with the UI language |
| `npm run check` | Run all non-browser tests |
| `npm run sync:samples` | Regenerate bilingual sample drawings |

---

## Architecture

```
src/
  DXFLoader.js          Single-file library (~7 000 lines)
    ├─ DXFParser          DXF tokeniser + entity parser
    ├─ DXFLoader          Scene builder + geometry emitters
    │   ├─ emitEntity     Dispatches to per-type emitters
    │   ├─ emitACISSolid  ACIS SAT/SAB reconstruction
    │   └─ MultiPageTextAtlas  Canvas-based glyph atlas
    └─ Helpers            OCS→WCS, NURBS, crease normals

scripts/
  build.mjs             Zero-dependency build & deploy
  serve.mjs             Local HTTP server
  test.mjs              Parser unit tests
  test-renderer.mjs     Renderer assertions
  test-e2e.mjs          Browser e2e tests
  test-sample-language.mjs  Language-switch tests
  make-showcase.mjs     Generate bilingual showcase DXFs
  make-huge-sample.mjs  Generate the large plant-layout sample
  sync-showcase.mjs     Sync sample DXF payloads into the HTML

examples/
  index.html            Self-contained CAD viewer
  samples/              Bundled sample DXF drawings
```

---

## License

[MIT](./LICENSE) — © zhangly1403 (<zhangly1403@qq.com>)
