<h1 align="center">threejs-dxf-loader</h1>

<p align="center">AutoCAD DXF parser and Three.js renderer for 2D engineering drawings and 3D solid assemblies, with a bundled bilingual CAD viewer.</p>

<p align="center">
  <a href="./README.md">English</a> | <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://threejs.org/"><img src="https://img.shields.io/badge/Three.js-%3E%3D0.128.0-3776AB?style=flat-square" alt="Three.js >=0.128.0"></a> <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-%3E%3D16.0.0-3776AB?style=flat-square" alt="Node.js >=16.0.0"></a> <a href="./CHANGELOG.md"><img src="https://img.shields.io/badge/Release-v2.0.1-F59E0B?style=flat-square" alt="Release v2.0.1"></a> <a href="https://github.com/zly258/dxfviewer/actions/workflows/ci-and-pages.yml"><img src="https://img.shields.io/github/actions/workflow/status/zly258/dxfviewer/ci-and-pages.yml?branch=main&style=flat-square&label=CI" alt="CI status"></a> <a href="https://zly258.github.io/dxfviewer/"><img src="https://img.shields.io/badge/Demo-GitHub%20Pages-0891B2?style=flat-square" alt="Live Demo on GitHub Pages"></a> <a href="./LICENSE"><img src="https://img.shields.io/badge/License-GPL--3.0-22C55E?style=flat-square" alt="License: GPL-3.0"></a>
</p>

`threejs-dxf-loader` parses AutoCAD DXF files (UTF-8 and GB18030/GBK) and builds batched Three.js scenes with 2D drafting geometry, multi-island hatches, ACIS 3D solid reconstruction, rich `MTEXT` rendering, spatial picking (`PickIndex`), and instant light/dark/monochrome theme switching.

Live demo: <https://zly258.github.io/dxfviewer/>

## Highlights

| Highlight | Why it matters |
|---|---|
| Broad 2D and 3D DXF coverage | Renders standard 2D entities, `HATCH`/`MPOLYGON` fills with multi-island holes, `3DSOLID` via ACIS SAT/SAB reconstruction, `MESH`, `3DFACE`, and `thickness` extrusions with crease-angle smooth normals. |
| Full text and annotation pipeline | Supports `TEXT` alignments, `MTEXT` inline formatting codes, `DIMENSION`, `LEADER`, `MLEADER`, `TOLERANCE`, `ACAD_TABLE`, and nested `INSERT` blocks with searchable `ATTRIB` values. |
| Batched geometry and adaptive tessellation | Combines geometry per layer into batched line/mesh buffers and scales circle/arc segments by radius relative to model size to reduce vertex count on dense drawings. |
| Spatial picking via `PickIndex` | Combines a world-space grid and a screen-space projected-AABB grid for point picking, marquee broad-phase queries, and ray queries on large drawings. |
| Instant theme switching | Precomputes light and dark vertex-colour buffers so `DXFLoader.applyBackgroundTheme()` switches between `'light'`, `'dark'`, and `'bw'` without re-parsing. |
| Zero-build bilingual viewer and tree-shakeable ESM | Ships ESM/UMD bundles with TypeScript declarations (`types/DXFLoader.d.ts`), a standalone `DXFParser` usable in Web Workers, and a single-file EN/ZH viewer (`examples/index.html`). |

## Architecture

The core library under `src/dxf/` is split into focused ES modules with named, tree-shakeable exports from `src/dxf/index.js`:

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

| Path | Role |
|---|---|
| `src/dxf/index.js` | Public ES module entry with named exports (`DXFLoader`, `DXFParser`, `PickIndex`, `MultiPageTextAtlas`, `LayerBatchCollector`, helpers) |
| `src/dxf/00-util.js` | Growable buffers, ACI palette, sRGB/linear colour conversion, CAD font mapping, UTF-8/GB18030 decoding |
| `src/dxf/01-math.js` | OCS-to-WCS transforms, bulge arc interpolation, rational NURBS evaluation, crease-angle normals |
| `src/dxf/02-acis.js` | ACIS SAT/SAB decoding and B-rep surface reconstruction |
| `src/dxf/03-hatch.js` | Hatch loop classification, multi-island clipping, and linetype dash tessellation |
| `src/dxf/04-text.js` | `MTEXT` inline-code parser and lazy multi-page text atlas |
| `src/dxf/05-parser.js` | Fault-tolerant DXF tokeniser and entity parser (no DOM or Three.js dependency) |
| `src/dxf/06-batch.js` | Per-layer batched geometry collector |
| `src/dxf/07-loader.js` | `DXFLoader` scene builder, entity emitters, theme switching, and resource disposal |
| `src/dxf/08-pick.js` | `PickIndex` world-space and screen-space picking index |
| `types/DXFLoader.d.ts` | Public TypeScript declarations |
| `examples/index.html` | Self-contained bilingual (EN / ZH) CAD viewer with on-demand samples in `examples/samples/` |
| `scripts/` | esbuild bundling (`build.mjs`), local dev server (`serve.mjs`), sample generators, and test suites |

## Quick Install

Prerequisites:
- Peer dependency: `three` (`>=0.128.0`)
- For local builds, scripts, and tests: Node.js `>=16.0.0`

Install directly from GitHub (the package is not yet published to the public npm registry):

```bash
npm install git+https://github.com/zly258/dxfviewer.git three
```

Or load the prebuilt UMD bundle directly in HTML without a build step:

```html
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/gh/zly258/dxfviewer@v2.0.1/dist/threejs-dxf-loader.umd.min.js"></script>
```

To build `dist/` locally (`esm.js`, `esm.min.js`, `esm.mjs`, `umd.js`, `umd.min.js`, sourcemaps, and `DXFLoader.d.ts`):

```bash
npm install
npm run build
```

## Quick Start

### Load a DXF with ES modules

```javascript
import * as THREE from 'three';
import { DXFLoader } from 'threejs-dxf-loader';

const loader = new DXFLoader();

// parseAsync accepts a DXF string, ArrayBuffer, or Uint8Array.
const result = await loader.parseAsync(
  dxfArrayBuffer,
  { backgroundColor: 'light' },
  (p) => {
    console.log(`${p.percent}% ${p.stage}`);
  }
);

scene.add(result.scene);
```

### Load via UMD / `<script>` tag

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

### Parse only (Web Worker compatible)

```javascript
import { DXFParser } from 'threejs-dxf-loader';

const dxf = new DXFParser().parse(dxfString);
// Returns { header, tables, blocks, entities, objects }
```

`DXFParser` has no DOM or Three.js rendering dependency and can run directly inside a Web Worker.

### Switch themes and dispose resources

```javascript
// Instant vertex-colour swap without re-parsing ('light' | 'dark' | 'bw')
DXFLoader.applyBackgroundTheme(result.scene, 'dark');

// Release geometries, materials, and text-atlas textures when unloading
DXFLoader.dispose(result.scene);
```

### Run the bundled CAD viewer locally

```bash
npm run dev
# Opens local server at http://localhost:8080/ (override port via PORT env var)
```

## API Reference

### `DXFLoader`

| Method | Signature | Description |
|---|---|---|
| Constructor | `new DXFLoader(manager?)` | Creates a loader instance with an optional `THREE.LoadingManager`. |
| `setOptions` | `loader.setOptions(opts)` -> `this` | Merges loader options onto the instance. |
| `registerFont` | `loader.registerFont(name, threeFont)` -> `this` | Registers a Three.js `Font` under a CAD font name. |
| `load` | `loader.load(url, onLoad?, onProgress?, onError?)` | Fetches a DXF file by URL and parses it. |
| `parseAsync` | `loader.parseAsync(input, options?, onProgress?)` -> `Promise<DXFParseResult>` | Time-sliced asynchronous parse returning a scene and metadata. |
| `parse` | `loader.parse(input, options?)` -> `DXFParseResult` | Synchronous version of `parseAsync`. |
| `applyBackgroundTheme` | `DXFLoader.applyBackgroundTheme(rootGroup, theme?, selectedIdSet?)` | Swaps precomputed vertex-colour buffers (`'light'`, `'dark'`, `'bw'`), optionally preserving selection highlights. |
| `dispose` | `DXFLoader.dispose(rootGroup)` | Recursively disposes geometries, materials, and atlas textures. |
| `decodeAcisData` | `DXFLoader.decodeAcisData(ent, dxf)` -> `DXFAcisDecodeResult` | Decodes ACIS SAT text or binary SAB payload of a 3D solid entity. |
| `decodeDXFArrayBuffer` | `DXFLoader.decodeDXFArrayBuffer(input)` | Auto-detects UTF-8 vs GB18030/GBK and decodes to text. |

`DXFParseResult` shape:

```typescript
interface DXFParseResult {
  scene: THREE.Group;                  // Root group ready to add to a Three.js scene
  dxf: Record<string, any>;            // Raw parsed document
  layers: Record<string, THREE.Group>; // Normalised layer name -> THREE.Group
  stats: DXFStats;                     // Entity counts, draw calls, parse time, atlas stats
  boundingBox: THREE.Box3;             // Outlier-filtered viewport bounding box
  fullBoundingBox: THREE.Box3;         // Full WCS bounding box
  pickRecords: DXFPickRecord[];        // One pick record per entity
  textRecords: DXFTextRecord[];        // Searchable text records with quad bounding boxes
  originShift: { x: number; y: number; z: number };
}
```

Theme mapping for `DXFLoader.applyBackgroundTheme()`:

| Theme | Intended background | Line appearance |
|---|---|---|
| `'light'` | White | ACI palette adapted for light backgrounds |
| `'dark'` | Black | ACI palette adapted for dark backgrounds |
| `'bw'` | Black | Monochrome white |

### `PickIndex`

Spatial picking index built over `result.pickRecords`:

```javascript
import { PickIndex } from 'threejs-dxf-loader';

const index = new PickIndex(result.pickRecords);
index.updateScreen(camera, canvas.clientWidth, canvas.clientHeight);

const hit = index.pickAt(px, py);                         // Nearest DXFPickRecord or null
const candidates = index.queryScreenBox(x0, y0, x1, y1);  // Marquee broad-phase indices
const nearRay = index.queryRay(raycaster.ray, 0.5);       // World-space ray query indices
```

## Configuration and Supported Entities

### Loader options

Pass options to `loader.setOptions()` or as the second argument to `parseAsync()` / `parse()`:

| Option | Type | Default | Description |
|---|---|---|---|
| `backgroundColor` | `'light' \| 'dark' \| 'bw'` | `'light'` | Initial theme. |
| `defaultColor` | `number` | `0x0F172A` | Fallback hex colour when layer/entity colour is unspecified. |
| `centerOrigin` | `boolean` | `true` | Shift drawing so its geometric centre sits at the world origin. |
| `includePaperSpace` | `boolean` | `false` | Render paper-space entities (group code `67 = 1`). |
| `curveSegments` | `number` | `96` | Segment count for a full circle or closed curve. |
| `minCurveSegments` | `number` | `24` | Minimum segments for a partial arc or small curve. |
| `maxCurveSegments` | `number` | `192` | Maximum segments for any curve. |
| `adaptiveCurveSegments` | `boolean` | `true` | Scale circle/arc tessellation by radius relative to model size. |
| `creaseAngle` | `number` | `44` | Crease angle in degrees for splitting smooth 3D normals. |
| `extrudeThickness` | `boolean` | `true` | Render entities with group-code `39` `thickness` as 3D volumes. |
| `dimensionMode` | `'auto' \| 'computed'` | `'auto'` | `'auto'` prefers the drawing's `*D<n>` dimension block; `'computed'` recomputes geometry. |
| `textAtlasPx` | `number` | `96` | Nominal glyph size (px) in the text atlas. |
| `textAtlasPageSize` | `number` | `4096` | Side length (px) of each atlas page; lower to `1024`-`2048` on memory-constrained devices. |
| `textAtlasMaxPages` | `number` | `64` | Maximum atlas pages; overflow is reported in `stats.droppedText`. |
| `fontFamily` | `string` | system default | CSS font stack for the text atlas (falls back to SimSun / Arial). |

### Supported entities

- **2D geometry:** `LINE`, `LWPOLYLINE`, `POLYLINE`, `CIRCLE`, `ARC`, `ELLIPSE`, `SPLINE` (rational NURBS), `MLINE`, `SOLID`, `TRACE`, `POINT`, `XLINE`, `RAY`, `HELIX`, `WIPEOUT`
- **Fills:** `HATCH`, `MPOLYGON` (solid, gradient, and ANSI/ISO pattern fills with multi-island holes)
- **3D geometry:** `3DSOLID` (ACIS SAT/SAB reconstruction), `MESH` (`AcDbSubDMesh`), `3DFACE`, `POLYLINE` (3D mesh / polyface), extruded entities (`thickness`)
- **Text and annotation:** `TEXT` (all six alignments including Fit/Aligned), `MTEXT`, `ATTRIB`, `ATTDEF`, `DIMENSION`, `LEADER`, `MLEADER`, `TOLERANCE`, `ACAD_TABLE`
- **Structure:** `INSERT` (nested blocks and arrays), `VIEWPORT` (skipped)

### Supported `MTEXT` inline codes

| Code | Effect |
|---|---|
| `\P` | Paragraph break |
| `\H<n>x` / `\H<n>` | Relative / absolute text height |
| `\W<n>` | Width factor |
| `\Q<n>` | Oblique angle (degrees) |
| `\T<n>` | Character tracking |
| `\C<n>` / `\c<n>` | ACI colour / true colour |
| `\F<name>` / `\f<name>` | Font selection (with `\|b1\|i1` bold/italic flags) |
| `\L` / `\l`, `\O` / `\o`, `\K` / `\k` | Underline, overline, and strikethrough toggles |
| `\S<n>^<d>` | Stacked fraction (also supports `/` and `#`) |
| `\A<n>` | Vertical alignment (`0` bottom, `1` centre, `2` top) |
| `\pq<l\|c\|r>` | Paragraph alignment |
| `\U+XXXX` / `\M+nXXXX` | Unicode and multibyte escapes |
| `%%c`, `%%d`, `%%p` | Special symbols (⌀, °, ±) |
| `{...}` | Style group (inherits and restores state) |

## Example Viewer and Scripts

`examples/index.html` is a self-contained bilingual CAD viewer that loads sample DXF files on demand from `examples/samples/`. Start it with `npm run dev` (serves on `http://localhost:8080/` by default; set `PORT` to override).

### Built-in sample drawings

| Key | Drawing | Type |
|---|---|---|
| `gearbox_2d` | Planetary gearbox assembly | 2D mechanical |
| `arch_2d` | Research-office floor plan | 2D architectural |
| `spindle_3d` | 5-axis CNC spindle head | 3D solid assembly |
| `robot_3d` | 6-axis industrial robot cell | 3D solid |
| `manifold_2d` | Hydraulic manifold cross-section | 2D with multi-island hatch |
| `elements_2d` | All Element Types showcase | 2D entity coverage |
| `elements_3d` | 3D Element Types showcase | 3D solids, mesh, helix |
| `huge_2d` | Plant layout (large drawing test) | 2D (~11k entities) |
| `million_2d` | 1M elements stress test | 2D (1,000,000 entities) |

Samples with Chinese variants (`elements_2d`, `elements_3d`, `huge_2d`) re-render automatically when switching the viewer UI language.

### Viewer controls

| Action | Gesture |
|---|---|
| Point pick | Click |
| Window box select | Drag left to right |
| Crossing box select | Drag right to left |
| Zoom to cursor | Scroll wheel |
| Pan | Middle-button drag |
| 3D orbit | Right-button drag |
| Fit view | Fit button |
| Export PNG | Export button or Ctrl/Cmd+S |

### Repository scripts

| Command | Description |
|---|---|
| `npm run build` | Bundle `dist/` (ESM + UMD + types) and sync `examples/index.html` and `docs/` |
| `npm run dev` | Start the local HTTP dev server on port `8080` (`PORT` configurable) |
| `npm test` | Run parser unit tests over bundled samples |
| `npm run test:renderer` | Run renderer and geometry precision assertions |
| `npm run test:pick` | Run `PickIndex` functional tests with Three.js |
| `npm run test:e2e` | Run browser end-to-end tests (requires `playwright-core` and Chrome) |
| `npm run test:lang` | Verify bilingual samples switch with the UI language |
| `npm run check` | Run all non-browser checks (`test`, `test:renderer`, `test:pick`, ACIS SAB validation) |
| `npm run sync:samples` | Regenerate bilingual and stress-test sample DXF drawings |

## Documentation

| Topic | What it covers | Link |
|---|---|---|
| TypeScript API types | Full public interfaces, options, and return shapes | [types/DXFLoader.d.ts](./types/DXFLoader.d.ts) |
| Interactive CAD viewer | Self-contained bilingual viewer implementation | [examples/index.html](./examples/index.html) |
| Release history | Versioned changes and migration notes | [CHANGELOG.md](./CHANGELOG.md) |
| License terms | Full GNU General Public License v3.0 text | [LICENSE](./LICENSE) |

## Community & Support

- **Bug reports and feature requests:** [GitHub Issues](https://github.com/zly258/dxfviewer/issues)
- **Sponsor development (Afdian):** [Sponsor on Afdian](https://ifdian.net/order/create?user_id=3db8e630e6dc11f1b37452540025c377) | [Creator Profile (zhangly1403)](https://ifdian.net/a/zhangly1403)

## License

Licensed under the [GNU General Public License v3.0 (GPL-3.0)](./LICENSE).

Copyright (C) 2026 zhangly1403 (<zhangly1403@qq.com>)
