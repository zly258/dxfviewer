# Changelog

All notable changes to this project are documented here.
Format based on Keep a Changelog; versions follow Semantic Versioning.

## [2.0.1] - 2026-11-22

First tagged release of the 2.x line.

- Version bumped to 2.0.1 and the bundles rebuilt so every file under `dist/`
  reports the tagged version.
- Repository history rewritten to English-only commit messages; no code change
  (every tree is identical to the 2.0.0 state).
- README CDN snippets now pin `v2.0.1`.

## [2.0.0] - 2026-11-22

A structural release: the single-file core is now split into ES modules, the
build is bundler-based with minified outputs, and the viewer no longer embeds
sample drawings.

### Added
- **`PickIndex`** — world-space + screen-space picking index exported from the
  library, so host applications no longer have to reimplement O(candidates)
  picking. Covered by a real Three.js unit test (`npm run test:pick`).
- **`DXFLoader.dispose()`** — releases geometries, materials and atlas textures.
- **Text-atlas paging controls** — `textAtlasPageSize`, `textAtlasMaxPages`;
  overflow is reported as `stats.droppedText` (never silently dropped).
- **`adaptiveCurveSegments`** option — radius-relative circle/arc tessellation.
  On a 160k-circle synthetic drawing this cuts vertices by ~75%.
- **`v2.0.0` build outputs** — `dist/*.umd.min.js`, `*.esm.js`, `*.esm.min.js`
  with sourcemaps, plus `dist/DXFLoader.d.ts`.
- Full TypeScript declarations under `types/DXFLoader.d.ts`.

### Changed
- Core split from one 7,000-line file into `src/dxf/00-util.js` … `07-loader.js`
  with a real ES-module entry (`src/dxf/index.js`), tree-shakeable named exports.
- Build moved to esbuild (ESM + UMD, minified + sourcemaps), version injected
  from `package.json`.
- `package.json` now declares `files`, `sideEffects: false`, complete `exports`,
  and dev dependencies (`esbuild`, `three`, `playwright-core`).
- Colour conversion (`hexToLinearRgb`, light/dark adapters) and `normKey` are
  memoised; the tokeniser uses a char-code digit test instead of a per-line regex.
- The example viewer fetches sample drawings from `examples/samples/` on demand
  (page size ~4.1 MB → ~340 KB).
- README (EN / 中文) rewritten to match the implementation.

### Fixed
- Documentation/implementation mismatches: theme values (`'bw'`, not
  `'bw_light'/'bw_dark'`), `ParseResult` fields (`boundingBox` /
  `fullBoundingBox`), and picking described as a library capability.
- Removed stale duplicate files at the repository root (`DXFLoader.js` v7.0 and
  `DXFLoader.d.ts` v1.0.0) and the unused `src/index.esm.js`.

## [1.1.0] - 2026-11-17

- Full MTEXT inline-code support, block attribute panel, bilingual samples,
  fast selection on 100k+ entity drawings, English-first UI.
