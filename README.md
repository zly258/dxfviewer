# DXF Viewer

**Language:** [English](README.md) | [中文](README_zh.md)

A browser DXF drawing viewer with **two interactive render engines — WebGL 2D (GPU accelerated) and
Canvas 2D** — switchable at runtime. Both stay aligned on text layout, layers, highlighting and the
drawing coordinate system. It focuses on parsing and browsing; CAD editing is not provided.

Three levels of packaging:

| Component | Scope | Use when |
| --- | --- | --- |
| `DxfPreview` | One component, one canvas, no chrome | Embedding into another library; preview only |
| `DxfViewer` | Full viewer (header + toolbar + panels + status bar) | Standalone page; needs layers/properties/search |
| `DxfWorkspace` | Multi-tab workspace (file tabs, drag to open) | Browsing several drawings at once |

---

## 1. Features

### Rendering

- **WebGL 2D GPU rendering** — geometry is baked into spatial chunks uploaded to GPU buffers;
  pan/zoom only updates the transform matrix, never rebuilds geometry.
- **Canvas 2D engine** — the same scene through the browser's native 2D pipeline, for comparison and
  as a fallback when WebGL is unavailable.
- **Pure geometry text** — TrueType / OpenType glyph outlines (opentype.js) are triangulated into the
  fill pipeline, so text stays crisp at any zoom with no bitmap blur; an SDF glyph atlas path is also
  available and configurable.
- **Pixel-aligned engines** — same scene input, same picking (CPU BVH), same layer/visibility model.

### Drawing capabilities

- **Model space / paper space** — paper spaces with content are switchable, empty ones are hidden;
  paper-space viewport projection is clipped to the viewport frame.
- **Layer tree / properties panel / context menu** — hide selected, isolate selected, turn a layer off,
  show all.
- **Text search** — search and navigate text in the current space with compact inset highlighting.
- **View history** — previous view, next view, fit view.
- **Themes and colour modes** — system / light / dark UI themes, original and monochrome drawing colours.
- **Desktop and mobile** — header + toolbar on desktop, compact right-side toolbar on small screens.

### Text and special symbols

- AutoCAD standard escape codes: `%%c` (Ø), `%%d` (°), `%%p` (±), `%%%` (%), `%%u` underline, `\U+XXXX`.
- TSSD extended codes: `%%130`–`%%138` rebar grades, `%%140/%%141` superscript, `%%142/%%143` subscript,
  `%%146/%%147` circled numerals, `%%148`–`%%151` axis bubbles, `%%144/%%145` title emphasis.
- MTEXT: automatic column wrapping (avoiding forbidden line-start punctuation), all nine attachment
  points, line-spacing factor (group code 44), inline width factor `\W…;`, stacked fractions `\S3/4;`.
- Single-line text: Fit (`hAlign=5`) stretching and Aligned (`hAlign=3`) uniform scaling;
  baseline / bottom / middle / top vertical alignment.
- **Missing-glyph synthesis** — when the font lacks a glyph, superscripts/subscripts and circled
  numerals (⑪–⑳ etc.) are assembled from existing glyphs, and diameter symbols fall back to `Ø`.
  A `.notdef` box is never drawn.

### Large drawing performance

Measured on a synthetic 100 000-entity drawing (same machine, consistent between `npm run bench` and
browser measurements):

| Metric | Value |
| --- | --- |
| Parse (Worker, 8.6 MB) | ≈ 0.9 s |
| Scene baking (WebGL chunks) | ≈ 0.55 s |
| First frame visible (incl. cross-thread + index) | ≈ 2.3 s |
| Pan interaction | ≈ 16.7 ms/frame |

Key mechanisms: allocation-free line scanning in the parser, BVH scene index built in a Worker,
chunk-level viewport culling, sub-pixel entity LOD culling, per-instruction text height culling, and
snapshot-style interaction (one precise redraw once interaction settles).

---

## 2. Supported entities

Line, ray, xline, point, circle, arc, ellipse, polyline, mline, spline, hatch, solid, 3D face, text,
mtext, attribute / attdef, block reference, dimension, leader, multileader, table, image, wipeout,
viewport.

Write coverage (`writeDxf`): LINE / CIRCLE / ARC / ELLIPSE / LWPOLYLINE / POLYLINE / SPLINE / TEXT /
MTEXT / ATTRIB / SOLID / 3DFACE / HATCH / INSERT / DIMENSION / RAY / XLINE / LEADER / SHAPE.

---

## 3. Project structure

```text
src/
├── ui/             UI layer (React)
│   ├── components/
│   │   ├── preview/    Minimal preview component DxfPreview (single canvas, no chrome)
│   │   ├── viewer/     Full viewer (header / toolbar / layers / properties / search)
│   │   ├── workspace/  Multi-tab workspace
│   │   └── common/     Icons, overlays, status bars, about dialog
│   ├── hooks/      View history / layer visibility / responsive
│   ├── i18n.ts     English and Chinese
│   └── styles/     Design tokens and component styles (single source of truth)
├── io/             I/O layer
│   ├── parser/     DXF parsing (ASCII / binary, sections, entities)
│   ├── writer/     DXF writing (reconstructive + preserveRaw fidelity mode)
│   ├── dxf/        Group code tables
│   └── loader/     Parse worker + useDxfLoader + worker factory
├── render/         Render layer
│   ├── engine.ts   InteractiveRenderEngine interface (dual-engine contract)
│   ├── webgl/      WebGL2 engine (chunked GPU scene + shaders)
│   ├── canvas/     Canvas 2D engine (batching + Path2D cache + LOD)
│   ├── scene/      Entity → chunked GPU mesh baking
│   ├── picking/    CPU picking (flat BVH, hit testing, worker)
│   ├── text/       Outline triangulation / SDF atlas / SHX stroke fonts / layout cache
│   ├── vector/     Vector scene writer (SVG / PDF export backend)
│   └── viewportFitting.ts  Fit-to-box math shared by interaction and export
├── core/           Domain algorithms: geometry, curve sampling, text layout, extents
├── export/         Export: PNG (WebGL raster), SVG / PDF (vector)
├── config/         Constants and viewer config (render / text / interaction / zoom / LOD)
├── types/          Public data model
└── utils/          Colour, line style, font, search and text helpers

src/index.ts        Main entry (React components + public types)
src/preview.ts      Minimal preview entry (no full viewer, smallest footprint)
src/parser.ts       Parser entry (no React, no CSS)
src/writer.ts       Writer entry (no React, no CSS)
src/render.ts       Render entry (no React, no CSS)
src/export.ts       Export entry (no React, no CSS)

scripts/            Self-check scripts (fixtures, parse/render/visibility/round-trip/symbol checks,
                    benchmark, browser measurements)
samples/            Self-check output directory (generated at runtime, not committed)
docs/               Architecture and design documents
dxfviewer-example/  Example workspace (full viewer page + minimal preview page)
```

---

## 4. Running the project

### Requirements

- Node.js ≥ 20 (developed on 22.9)
- npm ≥ 10 (uses npm workspaces)
- A WebGL2-capable browser (recent Chrome / Edge / Firefox / Safari)

### Install dependencies

```bash
npm ci
```

### Development

```bash
npm run dev          # Example dev server (default http://localhost:3001)
npm run build:lib    # Build the library (with .d.ts and style.css)
npm run build:all    # Build library + example
npm run typecheck    # tsc --noEmit
```

The example project serves two pages:

- `/index.html` — full workspace (`DxfWorkspace`)
- `/preview.html` — minimal single-file preview (`DxfPreview`, one component and one canvas)

### Self-checks

```bash
npm run check              # everything below, including the build
npm run check:fixtures     # Parse generated fixtures (paper space, LEADER/SHAPE, …)
npm run check:render       # Headless render + PNG/PDF structure checks
npm run check:accuracy     # Render accuracy (coordinates, alignment, grid)
npm run check:symbols      # Special-symbol decoding + missing-glyph synthesis
npm run check:visibility   # Hide/isolate render equivalence + BVH consistency
npm run check:roundtrip    # parse → writeDxf → parse geometry comparison
npm run check:ui           # Static UI audit (tokens, contrast, undefined variables)
```

Browser measurements (start `npm run dev` first):

```bash
npm run check:ui-style     # Size ladder / three-column shell / themes / mobile
npm run check:preview      # Minimal preview contract (single canvas, zoom, theme)
npm run check:large        # 100k-entity first frame, far-view visibility, interaction frames
```

Benchmarks and batch runs:

```bash
BENCH_ITER=5 node scripts/bench-parse.mjs 100000   # parse/clone/index/bake/render breakdown
npm run test:real -- <drawing directory>           # Full pipeline over every drawing (read-only)
npm run compare:engines -- <drawing directory>     # Pixel-level dual-engine diff
```

---

## 5. Usage

### 1. Minimal preview: `DxfPreview`

Use it when you only need a canvas and a preview. It fills its parent container and renders no
toolbar, panel or status bar.

```tsx
import { DxfPreview } from '@zhangly1403/dxfviewer';
import '@zhangly1403/dxfviewer/style.css';

export default function Page() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <DxfPreview src="/files/drawing" />
    </div>
  );
}
```

`src` accepts four source kinds and reloads automatically when it changes:

```tsx
<DxfPreview src="https://example.com/a" />          {/* URL: fetched, then parsed in a Worker */}
<DxfPreview src={file} />                            {/* File / Blob from a picker or drag & drop */}
<DxfPreview src={arrayBuffer} />                     {/* Already-downloaded raw bytes */}
<DxfPreview src={parsedDxfData} />                   {/* Parsed DxfData: no parsing overhead */}
```

Props:

| Prop | Type | Description |
| --- | --- | --- |
| `src` | `string \| File \| Blob \| ArrayBuffer \| DxfData` | Drawing source |
| `theme` | `'light' \| 'dark'` | Canvas background (white / black), default `light` |
| `colorMode` | `'original' \| 'monochrome'` | Drawing colour mode, default original |
| `engine` | `'webgl' \| 'canvas'` | Render engine; falls back automatically without WebGL2 |
| `layout` | `string` | Layout to display (defaults to model space) |
| `fontUrl` / `fallbackFontUrl` | `string` | Outline font and fallback font URLs (optional) |
| `interactive` | `boolean` | Allow wheel zoom / drag pan, default `true` |
| `loadingFallback` | `ReactNode` | Loading placeholder (pass `null` to disable) |
| `renderError` | `(e: Error) => ReactNode` | Custom error rendering |
| `onLoad` / `onError` | callbacks | Load completion / failure |

Imperative handle (beyond wheel zoom, drag pan and double-click fit):

```tsx
const ref = useRef<DxfPreviewHandle>(null);
<DxfPreview ref={ref} src={file} />;
ref.current?.fit();                  // fit view
ref.current?.getViewPort();          // { targetX, targetY, zoom }
ref.current?.setViewPort(vp);        // set the viewport directly
```

### 2. Full viewer: `DxfViewer`

```tsx
import { DxfViewer } from '@zhangly1403/dxfviewer';
import '@zhangly1403/dxfviewer/style.css';

export default function Page() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <DxfViewer initFile="/files/drawing" fileName="drawing" />
    </div>
  );
}
```

Common props: `initFile`, `fileName`, `active`, `showOpenMenu`, `uiTheme`, `drawingColorMode`,
`language`, `onLoad`, `onError`, `onOpenFiles`, `onOpenFailed`, `tabStrip`.

### 3. Multi-tab workspace: `DxfWorkspace`

```tsx
import { DxfWorkspace } from '@zhangly1403/dxfviewer';
import '@zhangly1403/dxfviewer/style.css';

export default function App() {
  return <DxfWorkspace />;
}
```

### 4. React-free subpath entries

| Entry | Contents |
| --- | --- |
| `@zhangly1403/dxfviewer/preview` | Minimal preview component + parsing + font registration |
| `@zhangly1403/dxfviewer/parser` | DXF parsing, entity enums, group-code helpers, escape decoding |
| `@zhangly1403/dxfviewer/writer` | DXF writing, document builder |
| `@zhangly1403/dxfviewer/render` | WebGL engine, scene baking, vector writer, picking, fonts |
| `@zhangly1403/dxfviewer/export` | PNG / SVG / raster PDF / vector PDF |

```ts
// Parse only, no UI: usable on the server or inside a Worker
import { parseDxf, EntityType } from '@zhangly1403/dxfviewer/parser';
const data = await parseDxf(text, undefined, { yieldIntervalMs: 0 });
```

```ts
// Headless rendering: React-free, works inside a Worker
import { renderSceneToCanvas } from '@zhangly1403/dxfviewer/render';

// Export: PNG / raster PDF / vector PDF / vector SVG (zero runtime dependencies)
import { exportPng, exportPdf, exportPdfVector, exportSvg } from '@zhangly1403/dxfviewer/export';
const png = await exportPng(data, { width: 1920, height: 1080, background: 'white' });
const svg = exportSvg(data, { width: 800, height: 600 });
```

### 5. Writing DXF

```ts
import { writeDxf, createDocument } from '@zhangly1403/dxfviewer/writer';

// Reconstructive writing: regenerates a spec-compliant file (AC1015 default, AC1009/R12 fallback)
const { content, skipped } = writeDxf(data, { version: 'AC1015' });

// Faithful round-trip: capture raw group codes while parsing, replay them verbatim while writing
const data2 = await parseDxf(text, undefined, { preserveRaw: true });
const out = writeDxf(data2, { preserveRaw: true });

// Build a drawing from scratch
const doc = createDocument({ version: 'AC1015', units: 4 });
doc.addLayer({ name: 'WALL', color: 1 })
   .addLine({ layer: 'WALL', start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } })
   .addCircle({ center: { x: 500, y: 500 }, radius: 200 })
   .addText({ position: { x: 0, y: 20 }, height: 50, value: 'Title' });
const dxf = doc.toDxfString();
```

`writeDxf` is **reconstructive**: information the parser does not model (XDATA, unrecognised
tables/objects, extension dictionaries) is not preserved, and entities that cannot be written or need
degradation are reported through `skipped`. Use `preserveRaw` for "open → modify → save without
losing information".

### 6. CLI conversion

```bash
npm run convert -- <input> <output.(svg|pdf|dxf)> [options]

# Examples
npm run convert -- <input> out.svg --width 1920 --height 1080
npm run convert -- <input> out.pdf --paper A3 --landscape
npm run convert -- <input> out.dxf --raw          # faithful save
npm run convert -- <dir> <outdir> --format .svg   # batch-convert a directory
npm run convert -- <input> out.svg --list-layouts # list layouts
```

Node-side PNG needs a native Canvas implementation and is not provided by default — use `exportPng`
in the browser, or the CLI's SVG / PDF (in Node the PDF geometry is fully vector and the text layer is
omitted automatically).

### 7. Fonts

- **Outline fonts**: register TTF/OTF via `setOutlineFont(arrayBuffer)` or `loadOutlineFont(url)`;
  text is then triangulated as pure geometry. `setFallbackOutlineFont` registers a fallback font
  (e.g. Arial) to cover special symbols.
- **SHX shape fonts**: `parseShxFont` + `registerParsedShxFont` register real shape files; text is
  rendered as stroke polylines, matching the single-line look of CAD fonts.
- Without registered fonts the viewer falls back to the system font atlas, mapping style font names
  to the closest available local font.

---

## 6. Development and maintenance

- Repository: <https://github.com/zly258/dxfviewer>
- Maintained by: DXF Viewer contributors (see the `author` field in `package.json` and the commit log)
- Issues and suggestions: use the repository issue tracker; please include a minimal reproducible
  drawing and your browser version
- Architecture notes: `docs/webgl-architecture.md` (render pipeline and performance mechanisms),
  `docs/plan-dxf-writer-export.md` (writer and export design)

Contribution conventions:

- Source files are UTF-8 with BOM; `package.json` / `package-lock.json` stay standard UTF-8 to avoid
  tool-chain parsing issues.
- Styles use design tokens from `src/ui/styles/variables.css` only — no raw colour literals.
  `npm run check:ui` enforces this.
- Drawing files are not committed (`*.dxf` is globally ignored); self-check fixtures are generated at
  runtime.

---

## 7. Known limitations

- Browsing only; no CAD editing.
- `writeDxf` is reconstructive and does not preserve information the parser does not model
  (`preserveRaw` replays it faithfully).
- Paper-space switching and viewport projection are supported, but full `VIEWPORT` model-space
  clipping remains a future enhancement.
- SHX is handled as font-name compatibility only; without a registered real shape file, centred text
  is centred by actual glyph width and may differ from the original CAD font at character level.
- Text whose projected height is below 1.5 CSS pixels is skipped (it is unreadable at that size).

---

## 8. License

MIT License. See [LICENSE](LICENSE) or the `license` field in `package.json`.