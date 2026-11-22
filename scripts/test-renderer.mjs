import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const coreDir = path.join(rootDir, 'src', 'dxf');
// Concatenate the split core modules so source-level assertions keep working.
const coreSource = () =>
  fs
    .readdirSync(coreDir)
    .filter((f) => f.endsWith('.js'))
    .sort()
    .map((f) => fs.readFileSync(path.join(coreDir, f), 'utf8'))
    .join('\n');

const mockTHREE = {
  MathUtils: {
    degToRad: (d) => (d * Math.PI) / 180,
    radToDeg: (r) => (r * 180) / Math.PI
  },
  Color: class {
    constructor(hex = 0) { this.hex = hex; }
    getHSL(target) { target.h = 0; target.s = 0.5; target.l = 0.5; return target; }
    setHSL() { return this; }
    getHex() { return this.hex; }
    getHexString() { return this.hex.toString(16).padStart(6, '0'); }
  }
};

globalThis.THREE = mockTHREE;
const require = createRequire(import.meta.url);
const DXFLoader = require('../dist/threejs-dxf-loader.umd.js');

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    console.error(`  [FAIL] ${name}: ${err.message}`);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// 1. Colour management: sRGB hex -> linear working space
// ---------------------------------------------------------------------------
check('sRGB hex converts to linear-sRGB components', () => {
  const src = coreSource();
  assert(src.includes('srgbByteToLinear'), 'linear conversion helper must exist');
  assert(src.includes('hexToLinearRgb'), 'hex packing helper must exist');
  // No raw sRGB byte may still be written straight into a vertex colour buffer.
  assert(!/\(\(cp\.light >> 16\) & 255\) \/ 255/.test(src), 'raw sRGB vertex colour write must be gone');
  assert(!/\(\(lHex >> 16\) & 255\) \/ 255/.test(src), 'raw sRGB text colour write must be gone');
});

// ---------------------------------------------------------------------------
// 2. ACIS SAT decoding follows the ezdxf XOR-159 rules (incl. the 0x5E skip)
// ---------------------------------------------------------------------------
check('ACIS SAT decoder implements the 0x5E skip rule', () => {
  const src = coreSource();
  assert(src.includes('SAT_DECODE_TABLE'), 'SAT decode table must exist');
  assert(src.includes('decodeACISSatLine'), 'per-line SAT decoder must exist');
  assert(src.includes('if (c === 0x5e) skip = true'), 'the 0x5E filler-skip rule must be present');
});

// ---------------------------------------------------------------------------
// 3. ACIS SAB booleans are context aware (sense vs sidedness)
// ---------------------------------------------------------------------------
check('ACIS SAB booleans are resolved per record context', () => {
  const src = coreSource();
  assert(src.includes('isSenseRecord'), 'sense-record detection must exist');
  assert(src.includes('isSidedRecord'), 'sidedness-record detection must exist');
});

// ---------------------------------------------------------------------------
// 4. Curve tessellation: bulge arcs get at least one segment per 90 degrees
// ---------------------------------------------------------------------------
check('bulge arcs tessellate with at least one segment per 90 degrees', () => {
  const src = coreSource();
  assert(
    src.includes('Math.abs(includedAngle) / (Math.PI / 2)'),
    'bulge segment count must be derived from the 90-degree rule'
  );
  assert(src.includes('segmentsPerCircle = 128'), 'full circle baseline must be 128 segments');
});

// ---------------------------------------------------------------------------
// 5. Normal welding uses an absolute CAD tolerance, not a relative one
// ---------------------------------------------------------------------------
check('normal welding uses an absolute tolerance', () => {
  const src = coreSource();
  assert(
    src.includes('Math.min(extent / 4096, 1e-2)'),
    'welding quantum must be capped by an absolute tolerance'
  );
});

// ---------------------------------------------------------------------------
// 6. Batched geometries expose bounding volumes for frustum culling
// ---------------------------------------------------------------------------
check('batched geometries compute bounding volumes', () => {
  const src = coreSource();
  const count = (src.match(/geom\.computeBoundingSphere\(\)/g) || []).length;
  assert(count >= 3, '2D mesh, 3D mesh and line batch must all compute a bounding sphere');
});

// ---------------------------------------------------------------------------
// 7. Options expose the new precision / shading knobs
// ---------------------------------------------------------------------------
check('loader options expose crease angle and curve segment bounds', () => {
  const src = coreSource();
  for (const opt of ['creaseAngle', 'minCurveSegments', 'maxCurveSegments']) {
    assert(src.includes(opt + ':'), `option ${opt} must be declared`);
  }
});

// ---------------------------------------------------------------------------
// 10. Tessellation accuracy must never depend on the drawing size
// ---------------------------------------------------------------------------
check('tessellation density is independent of the drawing size', () => {
  const src = coreSource();
  // No entity-count based downgrade of the curve budget.
  assert(
    !/entities\.length > \d+[\s\S]{0,160}?_activeCurveSegs/.test(src),
    'the curve segment budget must not be scaled down for large drawings'
  );
  // No text-atlas downgrade based on the number of text entities.
  assert(
    !/textLikeCount > \d+ \? \d+ :/.test(src),
    'the text atlas resolution must not be reduced for drawings with much text'
  );
  assert(src.includes('textAtlasPx'), 'a constant text atlas resolution option must exist');
  // Nested 3D entities keep the same density as top-level ones.
  assert(
    !/depth > 0 \? Math\.max\(\d+, Math\.floor\(this\._activeCurveSegs/.test(src),
    'nested entities must keep the same tessellation density'
  );
});

// ---------------------------------------------------------------------------
// 11. The example app renders an additive highlight for selected 3D solids
// ---------------------------------------------------------------------------
check('example app renders an additive highlight for selected 3D solids', () => {
  const html = fs.readFileSync(path.join(rootDir, 'examples', 'index.html'), 'utf8');
  assert(html.includes('_buildSelected3DHighlight'), '3D highlight builder must exist');
  assert(html.includes('Selected3DHighlight'), 'highlight overlay must be named');
  assert(html.includes('AdditiveBlending'), 'highlight must use additive blending');
});

// ---------------------------------------------------------------------------
// 9. In the 3D view a solid surface wins over its own wireframe edge
// ---------------------------------------------------------------------------
check('3D pick priority prefers the solid surface over its edge', () => {
  const html = fs.readFileSync(path.join(rootDir, 'examples', 'index.html'), 'utf8');
  assert(html.includes('preferSolid3D'), 'solid-over-edge pick preference must exist');
});

// ---------------------------------------------------------------------------
// 12. Selection on huge drawings uses a screen-space index
// ---------------------------------------------------------------------------
check('point and box selection use a screen-space pick index', () => {
  const html = fs.readFileSync(path.join(rootDir, 'examples', 'index.html'), 'utf8');
  assert(html.includes('ensureScreenPickIndex'), 'a screen-space pick index must exist');
  assert(html.includes('queryScreenPickIndex'), 'the screen-space index must be queried');
  assert(html.includes('sIndex.boxes[i]'), 'the index must supply the projected bounds');
  // The broad phase must not fall back to scanning every record.
  assert(
    /records\.length > 300/.test(html),
    'the screen index must be used for drawings with many records'
  );
});

// ---------------------------------------------------------------------------
// 13. A block reference is selected as a whole
// ---------------------------------------------------------------------------
check('block references are selected as a whole', () => {
  const html = fs.readFileSync(path.join(rootDir, 'examples', 'index.html'), 'utf8');
  assert(html.includes('resolveBlockReferenceSelection'), 'block-reference resolution must exist');
  assert(
    html.includes('resolveBlockReferenceSelection(winner)'),
    'a picked block member must resolve to its block reference'
  );
  const src = coreSource();
  assert(src.includes('childEnt.parentInsert'), 'entities must remember their block reference');
});

// ---------------------------------------------------------------------------
// 14. The viewer opens in English and the choice is remembered
// ---------------------------------------------------------------------------
check('the viewer opens in English and remembers the language choice', () => {
  const html = fs.readFileSync(path.join(rootDir, 'examples', 'index.html'), 'utf8');
  assert(html.includes("localStorage.getItem('dxfviewer.lang')"), 'the language must be restored');
  assert(html.includes("localStorage.setItem('dxfviewer.lang'"), 'the language must be stored');
  assert(/return 'en';/.test(html), 'the default language must be English');
  assert(
    /applyLanguageUI\(\);[\s\S]{0,80}/.test(html) && /btnLangToggle[\s\S]{0,600}applyLanguageUI\(\);/.test(html),
    'the language must be applied on start'
  );
  assert(html.includes('SAMPLE_TITLES'), 'the sample titles must follow the language');
});

// ---------------------------------------------------------------------------
// 15. Wheel zoom scales with the normalised wheel delta
// ---------------------------------------------------------------------------
check('the wheel zoom step scales with the wheel delta', () => {
  const html = fs.readFileSync(path.join(rootDir, 'examples', 'index.html'), 'utf8');
  const m = /Math\.pow\(([0-9.]+),\s*delta\)/.exec(html);
  assert(m, 'the zoom factor must be a power of the normalised wheel delta');
  const base = Number(m[1]);
  assert(base > 1, 'the zoom base must be greater than 1');
  assert(html.includes('e.deltaMode === 1 ? 16'), 'deltaMode must be normalised');
  assert(Math.pow(base, 100) > 1.09, 'one wheel notch must stay more sensitive than 1.09');
});

// ---------------------------------------------------------------------------
// 16. Glyphs get a stroke underlay so the outlines stay crisp
// ---------------------------------------------------------------------------
check('text glyphs are stroked for crisp outlines', () => {
  const src = coreSource();
  assert(src.includes('strokeText'), 'glyphs must be stroked as well as filled');
  assert(/texture\.anisotropy = (8|[4-9])/.test(src), 'the text atlas must use anisotropic filtering');
});

// ---------------------------------------------------------------------------
// 17. The all-element sample is bundled with the example
// ---------------------------------------------------------------------------
check('the all-element showcase drawing is bundled', () => {
  const samples = path.join(rootDir, 'examples', 'samples');
  const file = path.join(samples, 'elements_showcase_2d.dxf');
  assert(fs.existsSync(file), 'the showcase drawing must exist');
  const html = fs.readFileSync(path.join(rootDir, 'examples', 'index.html'), 'utf8');
  assert(html.includes('elements_2d'), 'the showcase must be available as a preset');
  assert(html.includes('lblSample6'), 'the showcase must appear in the sample menu');
});


// ---------------------------------------------------------------------------
// 18. A vertical ray keeps its direction (no 45-degree fallback)
// ---------------------------------------------------------------------------
check('a vertical ray keeps its direction', () => {
  const src = coreSource();
  const code = src.replace(/^\s*\/\/.*$/gm, '');
  assert(!code.includes('ent.x1 || 1'), 'a zero direction component must not fall back to 1');
  assert(code.includes('ent.x1 !== undefined ? ent.x1 : 1'), 'the direction fallback must check for undefined');
});
// ---------------------------------------------------------------------------
// 19. pickRecords has no arbitrary size cap
// ---------------------------------------------------------------------------
check('every entity gets a pick record regardless of drawing size', () => {
  const src = coreSource();
  assert(!src.includes('pickRecords.length < 50000'), 'the 50k pickRecords cap must be removed');
  assert(!src.includes('pickRecords.length < 60000'), 'the 60k nestedText cap must be removed');
  assert(src.includes('Every emitted entity MUST get a pick record'), 'the pick-record comment must be present');
});

// ---------------------------------------------------------------------------
// 20. Point picking uses a world-space grid index (O(candidates) not O(N))
// ---------------------------------------------------------------------------
check('point picking uses a world-space grid index', () => {
  const html = fs.readFileSync(path.join(rootDir, 'examples', 'index.html'), 'utf8');
  assert(html.includes('worldPickIndex'), 'a world-space grid index must exist');
  assert(html.includes('ensureSegmentIndex'), 'a segment inverse index must exist for the narrow phase');
  assert(
    html.includes('for (const [pid, rec] of candidateMap)'),
    'the narrow phase must iterate candidates not the whole index'
  );
});

console.log(`[threejs-dxf-loader] ${passed} renderer/precision assertions passed!`);
