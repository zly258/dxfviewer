## Highlights

### Rendering accuracy

- **Colours now match AutoCAD exactly.** Vertex colours are written in the linear-sRGB working space (three.js interprets `BufferAttribute` colours as Linear-sRGB, while CAD/ACI colours are authored in sRGB). Previously every mid-tone rendered one step too bright.
- The example app enables sRGB output and disables ACES tone mapping, which would otherwise desaturate the vivid ACI colours.
- **Normal welding uses an absolute CAD tolerance** (0.01 mm) instead of a purely relative quantum, so neighbouring facets of a solid always weld and large models no longer show seams between facets.
- Batched 2D / 3D / line geometries now compute their bounding box and sphere, so frustum culling works and the first frame does not stall.

### 3D entity parsing

- **ACIS SAT decoding now follows the ezdxf XOR-159 rules**, including the `0x5E` filler-skip that is required for the `body/lump/shell/...` keywords to match.
- **ACIS SAB booleans are resolved per record context** (sense vs. sidedness) instead of always mapping `TRUE` to `reversed` — the old mapping flipped the loop orientation and therefore the shading normals of solids.
- ACIS surfaces are tessellated with a higher, span-aware grid resolution; bulge arcs use at least one segment per 90° (floor of 6) with a 128-segment full-circle baseline, so visible faceting is gone.
- Curve segment budget is configurable (`curveSegments`, `minCurveSegments`, `maxCurveSegments`).

### Accuracy is independent of the drawing size

- **The curve segment budget no longer shrinks for large drawings.** Previously a drawing with 15000+ entities was tessellated with only 75 % of the segments, which made big drawings visibly faceted exactly where the user zooms in. Every drawing now uses the same budget.
- Nested 3D entities keep the same density as top-level ones.
- **The text atlas resolution is constant** (96 px, new `textAtlasPx` option). Drawings with a lot of text use additional atlas pages instead of lowering the glyph resolution.
- NURBS sampling scales with the control polygon (up to 1024 samples); ACIS surface grids were raised (cone / torus / sphere / spline), so curved solids stay smooth.

### Selection highlight

- **Selected 3D solids get an additive highlight overlay** rebuilt from the selected pick ids, so the solid itself is clearly marked instead of only being framed by a bounding box.
- In the 3D view a solid surface now wins over its own wireframe edge, so clicking a body selects the body.

### Tests

- Added `scripts/test-renderer.mjs` with assertions covering colour space, ACIS decoding, tessellation, welding and highlight behaviour, including a regression guard that the tessellation density never depends on the drawing size.
- Added `scripts/bench-real.mjs` to parse real engineering drawings from the command line.

---

## Upgrade notes

The library now expects the host application to render with sRGB output:

```js
renderer.outputColorSpace = THREE.SRGBColorSpace; // or renderer.outputEncoding = THREE.sRGBEncoding
renderer.toneMapping = THREE.NoToneMapping;         // keep ACES off for CAD colours
```

If your host already renders in sRGB you only need to pull the new version — the library writes linear colours itself.

Full changelog: see the commit list for `v1.1.0`.

---

The Chinese version of these notes is available at [RELEASE-v1.1.0.zh-CN.md](https://github.com/zly258/dxfviewer/blob/main/RELEASE-v1.1.0.zh-CN.md).

### Block attributes in the property panel

Selecting a block reference now lists its attributes in a dedicated **Block Attributes** section, so they are easy to find instead of being mixed among the geometric values. Every ATTRIB is shown as a tag/value pair, and attributes without a value are marked as "(empty)".

### Revolution-spline caps and cylinder tessellation / see Chinese doc for details

- **Dished heads stored as `rot_spl_sur` revolution spline surfaces now tessellate correctly.** They previously fell through to the sparse Delaunay trim path and rendered as a warped, partially covered cap (a flat dark ellipse floating inside the shell silhouette). The structured UV-grid path now also accepts faces whose UV contour spans the whole surface domain, and a degenerate meridian range is extended across the meridian domain like the sphere/cone caps. A 2:1 elliptical head now renders as a smooth cap (rim-to-apex span correct, section symmetric, 2268 structured triangles).
- **Cylinders are emitted with a single quad row** (a cone surface with sine = 0 is linear along its axis), cutting the triangle count of piping-heavy assemblies by roughly half with no visual change.
- Added `DXFLoader.decodeAcisData(entity, dxf)`: decodes an entity ACIS payload (native SAT or binary SAB) into the plain SAT records for inspection.

### Selection on huge drawings, block references, and the all-element showcase

- **Point and box selection now stay responsive on very large drawings.** Both used to test every pick record against the pick ray and project every bounding box, which froze the main thread for seconds on big assemblies and made selection feel dead. A screen-space index now holds the projected bounds of every record, so a click or marquee only visits what is actually under the cursor. On a 768-entity plant assembly the pick latency is ~12 ms (p95 ~30 ms) and a window selection of 511 entities takes ~185 ms.
- **A block reference is now selected as a whole.** Clicking any entity that belongs to an INSERT selects the INSERT itself, exactly like AutoCAD, and the block attributes are listed in the property panel.
- **The viewer now opens in English.** The EN/中文 button switches the whole interface, including the sample titles, and the choice is remembered for the next visit.
- **The wheel zoom is slightly more sensitive** (1.14 per notch instead of 1.09).
- **Glyphs are stroked as well as filled**, so text keeps a crisp outline over dense hatching and at any zoom level; the text atlas also uses stronger anisotropic filtering.
- **Construction lines (XLINE / RAY) are clipped to the drawing extent** instead of a fixed 250-unit reach, so they no longer sprawl across large drawings.
- **New sample: "All Element Types"** covers lines, linetypes, XLINE/RAY, POINT, CIRCLE, ARC, ELLIPSE, SPLINE, LWPOLYLINE, POLYLINE, SOLID, HATCH (solid and ANSI31), the four TEXT alignments, MTEXT with inline codes, aligned and radial DIMENSIONs, LEADER, and a block reference with attributes.

### Rebuilt sample drawings, a huge-drawing test and a construction-line fix

- **The showcase drawings are now generated, not hand-assembled.** `scripts/make-showcase.mjs` produces a clean 2D grid ("All Element Types", 125 entities in labelled cells) and a separate 3D showcase (solids, mesh, helix, spline and text in space). Layouts no longer overlap, and every sample is a valid DXF entity with the right group codes.
- **A new huge-drawing sample** exercises the viewer at realistic scale: `plant_layout_huge_2d.dxf` has ~11,100 entities on 16 layers (column grid, equipment foundations, room partitions, pipe racks, valves, dimension chains and underground utilities). It is fetched at runtime by the example rather than embedded, and the build copies the sample files to the deployed site.
- **Fixed a real geometry bug:** XLINE / RAY direction components of zero were being replaced with 1 by `ent.x1 || 1`, turning every vertical construction line into a 45-degree diagonal. The same issue existed in ELLIPSE major-axis and WIPEOUT/IMAGE vectors; all three now fall back only when the group code is actually missing.
- `npm run sync:samples` regenerates all three sample drawings and syncs the copies embedded in the example.
