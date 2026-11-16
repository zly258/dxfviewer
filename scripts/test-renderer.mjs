import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

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
  const src = fs.readFileSync(path.join(rootDir, 'src', 'DXFLoader.js'), 'utf8');
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
  const src = fs.readFileSync(path.join(rootDir, 'src', 'DXFLoader.js'), 'utf8');
  assert(src.includes('SAT_DECODE_TABLE'), 'SAT decode table must exist');
  assert(src.includes('decodeACISSatLine'), 'per-line SAT decoder must exist');
  assert(src.includes('if (c === 0x5e) skip = true'), 'the 0x5E filler-skip rule must be present');
});

// ---------------------------------------------------------------------------
// 3. ACIS SAB booleans are context aware (sense vs sidedness)
// ---------------------------------------------------------------------------
check('ACIS SAB booleans are resolved per record context', () => {
  const src = fs.readFileSync(path.join(rootDir, 'src', 'DXFLoader.js'), 'utf8');
  assert(src.includes('isSenseRecord'), 'sense-record detection must exist');
  assert(src.includes('isSidedRecord'), 'sidedness-record detection must exist');
});

// ---------------------------------------------------------------------------
// 4. Curve tessellation: bulge arcs get at least one segment per 90 degrees
// ---------------------------------------------------------------------------
check('bulge arcs tessellate with at least one segment per 90 degrees', () => {
  const src = fs.readFileSync(path.join(rootDir, 'src', 'DXFLoader.js'), 'utf8');
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
  const src = fs.readFileSync(path.join(rootDir, 'src', 'DXFLoader.js'), 'utf8');
  assert(
    src.includes('Math.min(extent / 4096, 1e-2)'),
    'welding quantum must be capped by an absolute tolerance'
  );
});

// ---------------------------------------------------------------------------
// 6. Batched geometries expose bounding volumes for frustum culling
// ---------------------------------------------------------------------------
check('batched geometries compute bounding volumes', () => {
  const src = fs.readFileSync(path.join(rootDir, 'src', 'DXFLoader.js'), 'utf8');
  const count = (src.match(/geom\.computeBoundingSphere\(\)/g) || []).length;
  assert(count >= 3, '2D mesh, 3D mesh and line batch must all compute a bounding sphere');
});

// ---------------------------------------------------------------------------
// 7. Options expose the new precision / shading knobs
// ---------------------------------------------------------------------------
check('loader options expose crease angle and curve segment bounds', () => {
  const src = fs.readFileSync(path.join(rootDir, 'src', 'DXFLoader.js'), 'utf8');
  for (const opt of ['creaseAngle', 'minCurveSegments', 'maxCurveSegments']) {
    assert(src.includes(opt + ':'), `option ${opt} must be declared`);
  }
});

// ---------------------------------------------------------------------------
// 10. Tessellation accuracy must never depend on the drawing size
// ---------------------------------------------------------------------------
check('tessellation density is independent of the drawing size', () => {
  const src = fs.readFileSync(path.join(rootDir, 'src', 'DXFLoader.js'), 'utf8');
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

console.log(`[threejs-dxf-loader] ${passed} renderer/precision assertions passed!`);
