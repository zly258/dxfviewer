# DXF Viewer

**Language:** [English](README.md) | [中文](README_zh.md)

Live demo: [https://zly258.github.io/dxfviewer/](https://zly258.github.io/dxfviewer/)

---

DXF Viewer is a React component for viewing DXF drawings in the browser. It ships **two interactive render engines — WebGL 2D (GPU accelerated) and Canvas 2D** — switchable at runtime from the View menu, and both stay pixel-aligned on text layout, layers, highlighting and the drawing coordinate system.

It provides a core viewer (`DxfViewer`), a multi-tab workspace (`DxfWorkspace`), and an example workspace. The focus is parsing, viewing, layer visibility, text search and smooth browsing of **very large drawings**. CAD editing is not provided.

## Highlights

- **WebGL 2D GPU rendering** — geometry is batched into GPU buffers; text is baked from TrueType / OpenType glyph outlines (opentype.js + earcut) into the same fill pipeline, so it stays crisp at any zoom level with no bitmap blur.
- **Canvas 2D engine** — the same scene through the browser's native 2D pipeline, useful for comparison and as a fallback when WebGL is unavailable.
- **Built for very large drawings** — scene indexing inside a Web Worker, allocation-free line scanning in the parser, per-layout caching, LOD culling of sub-pixel entities, and snapshot pan/zoom that re-renders precisely once interaction settles.
- **Model / Layout spaces** — multiple paper spaces with content can be switched like in CAD; empty paper spaces are hidden.
- **Layer tree, properties panel, context menu** — hide selected, isolate selected, turn a layer off, show all.
- **Text search** — search and navigate text in the current space, with compact inset highlighting.
- **View history** — previous view, next view, fit view.
- **Themes** — system / light / dark UI themes, plus original and monochrome drawing color modes.
- **Desktop and mobile** — desktop header + toolbar layout, and a compact right-side toolbar on small screens.

## Supported entities

Line, ray, xline, point, circle, arc, ellipse, polyline, spline, hatch, solid, 3D face, text, mtext, attribute / attdef, block reference, dimension, leader, multileader, table, image, wipeout, viewport and more.

### AutoCAD / TSSD escape codes

- `%%130`–`%%138` rebar grade symbols (`Ø`, `Φ`)
- `%%140…%%141` superscript and `%%142…%%143` subscript pairs (`kN/m²`, `m³`, `LₐE`)
- `%%146…%%147` circled numerals (`①`, `②`, `⑩`)
- `%%148…%%151` structural axis bubbles (`(3C)`)
- Base control codes `%%c` (Ø), `%%d` (°), `%%p` (±), `%%%` (%)
- Title emphasis markers such as `%%144` are sanitized so no stray control bytes reach the canvas

### Text layout

- MTEXT automatic column wrapping that avoids forbidden line-start punctuation
- All nine attachment points with native baseline offsets and first-line descent
- MTEXT line-spacing factor (group code 44) and inline width factor `\W…;`
- Single-line text Fit (`hAlign=5`) and Aligned (`hAlign=3`)
- Vertical alignment: baseline, bottom, middle, top

## Installation

```bash
npm install @zhangly1403/dxfviewer
```

React and React DOM are peer dependencies and must be installed by the host project:

```bash
npm install react react-dom
```

## Import styles

```ts
import '@zhangly1403/dxfviewer/style.css';
```

## Use the core viewer

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

## Use the multi-tab workspace

```tsx
import { DxfWorkspace } from '@zhangly1403/dxfviewer';
import '@zhangly1403/dxfviewer/style.css';

export default function App() {
  return <DxfWorkspace />;
}
```

## Main exports

| Name | Description |
| --- | --- |
| `DxfViewer` | Core DXF viewer component. |
| `DxfWorkspace` | Full workspace with tabs, file opening and viewer toolbar. |
| `parseDxf` | DXF text parser. |
| `DxfViewerProps` | Props type for `DxfViewer`. |
| `DxfWorkspaceProps` | Props type for `DxfWorkspace`. |
| `DxfTabSource` | Initial file source type for multi-tab usage. |

For parsing without React, viewer UI or CSS, use the lightweight entry:

```ts
import { parseDxf, EntityType } from '@zhangly1403/dxfviewer/parser';
```

The existing two-argument `parseDxf` calls keep working; an optional third argument configures cancellation, progress throttling and event-loop yielding.

## Write DXF and export PNG / PDF

Three lightweight subpath entries ship without React or CSS:

```ts
// 1) Write DXF: rebuild a spec-compliant file from DxfData (AC1015 default, AC1009/R12 fallback)
import { writeDxf, writeDxfBlob } from '@zhangly1403/dxfviewer/writer';
const { content, skipped } = writeDxf(data, { version: 'AC1015' });

// 2) Headless rendering: React-free, usable inside a Web Worker
import { renderSceneToCanvas } from '@zhangly1403/dxfviewer/render';

// 3) Export: PNG / raster PDF / vector PDF / vector SVG (zero runtime dependencies)
import { exportPng, exportPdf, exportPdfVector, exportSvg } from '@zhangly1403/dxfviewer/export';
const png = await exportPng(data, { width: 1920, height: 1080, background: 'white' });
const pdf = await exportPdf(data, { paperSize: 'A3', orientation: 'landscape', marginMm: 10, dpi: 300 });
const vector = await exportPdfVector(data, { paperSize: 'A3', title: 'Drawing' }); // fully vector geometry
const svg = exportSvg(data, { width: 800, height: 600 }); // synchronous, plain text, infinitely scalable
```

`writeDxf` performs **reconstructive writing**: it regenerates the file from `DxfData`, so information the parser does not model (XDATA, unrecognized tables/objects, extension dictionaries) is not preserved. Entities that cannot be written or need degradation are reported through `skipped`. The default output is `AC1015 (AutoCAD 2000)`; pass `version: 'AC1009'` for R12, where LWPOLYLINE→POLYLINE, MTEXT→TEXT, HATCH→boundary outline (common patterns emit definition lines from a built-in `acad.pat` subset), and ELLIPSE/SPLINE→sampled polylines.

For "open → modify → save without losing information", use a faithful round-trip: enable `preserveRaw` while parsing to capture each entity's source group codes, then enable it while writing to replay them verbatim (handles are still reallocated to stay unique; untouched entities remain fully faithful):

```ts
import { parseDxf } from '@zhangly1403/dxfviewer/parser';
import { writeDxf } from '@zhangly1403/dxfviewer/writer';

const data = await parseDxf(text, undefined, { preserveRaw: true }); // ~+40% memory
// ... modify data freely; untouched entities keep their raw snapshots
const { content } = writeDxf(data, { preserveRaw: true });
```

You can also generate a drawing from scratch with the builder, without reading any file:

```ts
import { createDocument } from '@zhangly1403/dxfviewer/writer';

const doc = createDocument({ version: 'AC1015', units: 4 }); // 4 = mm
doc.addLayer({ name: 'WALL', color: 1 })
   .addLine({ layer: 'WALL', start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } })
   .addCircle({ center: { x: 500, y: 500 }, radius: 200 })
   .addText({ position: { x: 0, y: 20 }, height: 50, value: 'Title' })
   .addBlock({ name: 'BOLT', basePoint: { x: 0, y: 0 }, build: b => {
     b.addCircle({ center: { x: 0, y: 0 }, radius: 5 });
   } })
   .addInsert({ blockName: 'BOLT', position: { x: 100, y: 100 }, rotation: 45 });

const dxf = doc.toDxfString();   // { content, skipped }
const data = doc.toDxfData();    // feed directly to <DxfViewer> for preview
```

## CLI conversion (Node)

The library ships a zero-dependency CLI built on the `./parser` `./render` `./export` `./writer` subpath entries (no browser required):

```bash
npm run convert -- <input.dxf> <output.(svg|pdf|dxf)> [options]

# Examples
npm run convert -- drawing.dxf drawing.svg --width 1920 --height 1080
npm run convert -- drawing.dxf drawing.pdf --paper A3 --landscape
npm run convert -- drawing.dxf drawing.dxf --raw        # faithful save
npm run convert -- ./fixtures ./out --format .svg       # batch-convert a directory
npm run convert -- drawing.dxf x.svg --list-layouts     # list layouts
```

Note: Node-side PNG requires a native Canvas implementation (e.g. `skia-canvas`) and is not provided by default — use `exportPng` in the browser, or the CLI's SVG/PDF which cover most cases. In Node the PDF geometry is fully vector; the text layer is omitted automatically (the browser build includes it).

## Scripts

```bash
npm ci
npm run typecheck        # tsc --noEmit
npm run build            # Build the library (with .d.ts)
npm run check            # Build + fixture parsing + render/export smoke + hide/isolate regression + read/write round-trip + UI audit
npm run check:fixtures   # Parse runtime-generated fixtures (incl. paper space and LEADER/SHAPE)
npm run check:render     # Headless render + PNG/PDF structure and size checks
npm run check:visibility # Hide/isolate render equivalence + flat BVH vs reference consistency
npm run check:roundtrip  # parse → writeDxf → parse per-entity geometry comparison
npm run check:ui         # Static UI audit (tokens, raw colors, disabled opacity, contrast, z-index, font sizes, radii)
npm run check:ui-style   # Browser check of sizes, shell layout, themes and mobile (run npm run dev first)
npm run test:real        # Full-pipeline batch test of real drawings in a directory (read-only)
npm run bench-parse      # Synthetic large-drawing parse/index/render benchmark (manual)
npm run dev              # Start the example workspace
npm run build:example
npm run build:all
```

Note: `dxfviewer-example` is a real example workspace and exists in the full repository. The root `package-lock.json` keeps the workspace link entries so `npm ci` works when the example workspace is present.

## Publishing to npm (GitHub Actions)

Workflow: `.github/workflows/publish-npm.yml`. Two triggers:

- **Publishing a GitHub Release** → builds and publishes to npm automatically;
- **Actions → Publish to npm → Run workflow** → manual, `dry_run` defaults to `true` (build + `npm pack --dry-run` only).

Bump `package.json` first and keep the tag in sync (e.g. `1.6.0` ↔ `v1.6.0`); the workflow verifies the match and refuses versions that already exist on npm.

Authentication, pick one (the workflow selects automatically):

1. **npm Trusted Publishing (recommended, no secret)**: npm package → Settings → Trusted Publisher → GitHub Actions, with the repository, workflow `publish-npm.yml` and environment `npm`. The workflow already declares `id-token: write` and `--provenance`.
2. **Access token**: create a Granular Access Token on npm (Read and write, this package only) and add it as the `NPM_TOKEN` repository secret.

## Project structure

```text
src/
  ui/              UI layer: components (viewer/panels/toolbar), hooks, i18n, styles (web-ui-style design tokens)
  io/              I/O layer: parser (DXF), writer, dxf (group codes), loader (parse worker)
  render/          Render layer: engine (dual-engine contract) / webgl / canvas (switchable) / picking / text / vector
  core/            Domain algorithms: geometry, curve sampling, text layout, extents
  export/          Export: PNG (WebGL raster), SVG / PDF (vector)
  config/          Constants and viewer config
  types/           Public types
  utils/           Color, linetype, font, search, and entity helpers
samples/           Output directory for self-check artifacts (gitignored, generated at runtime)
scripts/           Automated self-check scripts (check:*), fixture generation, benchmarks, real-drawing batch tests
```

## Limitations

- Viewing and rendering focus on browsing; CAD editing is not provided. `writeDxf` is reconstructive writing and does not preserve information the parser does not model.
- Write coverage includes LINE/CIRCLE/ARC/ELLIPSE/LWPOLYLINE/POLYLINE/SPLINE/TEXT/MTEXT/ATTRIB/SOLID/3DFACE/HATCH/INSERT/DIMENSION/RAY/XLINE/LEADER/SHAPE; REGION (ACIS metadata) and some proxy objects cannot be rebuilt and are reported via `skipped` (the `preserveRaw` fidelity mode replays them verbatim).
- Paper-space switching is supported, but full `VIEWPORT` model-space projection is still a future enhancement.
- SHX is handled as font-name compatibility only. Real SHX glyph files are not loaded; centered text is centered by actual glyph width, which can differ from the original CAD fonts at character level.
- Source files use UTF-8 with BOM. npm configuration files such as `package.json` and `package-lock.json` remain standard UTF-8 to avoid npm / Vite parsing issues.

## License

MIT
