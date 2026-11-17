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
