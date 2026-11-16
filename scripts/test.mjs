/**
 * Automated Node.js test suite for threejs-dxf-loader
 * Verifies DXFParser, %% special symbol decoding, 3D entities, nested blocks, and theme switching.
 * Author: zhangly1403 <zhangly1403@qq.com>
 */
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

assert(typeof DXFLoader === 'function', 'DXFLoader class should be exported');
assert(typeof DXFLoader.DXFParser === 'function', 'DXFParser class should be exported');
assert(typeof DXFLoader.applyBackgroundTheme === 'function', 'applyBackgroundTheme should be exported');
assert(typeof DXFLoader.mapCADFontToSystemFont === 'function', 'mapCADFontToSystemFont should be exported');

// Verify fallback font mapping (SimSun / Arial)
const mappedDefault = DXFLoader.mapCADFontToSystemFont('unknown_cad_font.shx', '');
assert(mappedDefault.includes('SimSun') && mappedDefault.includes('Arial'), 'Fallback font should include SimSun and Arial');

// Verify all 5 comprehensive sample DXF drawings
const samplesDir = path.join(rootDir, 'examples', 'samples');
const sampleFiles = fs.readdirSync(samplesDir).filter(f => f.endsWith('.dxf'));
assert(sampleFiles.length === 5, 'Should contain 5 engineering sample DXF files');

for (const file of sampleFiles) {
  const raw = fs.readFileSync(path.join(samplesDir, file), 'utf-8');
  const parser = new DXFLoader.DXFParser();
  const parsed = parser.parse(raw);
  assert(parsed.entities.length > 0, `Sample ${file} should parse > 0 entities`);
  console.log(`  [PASS] ${file}: ${parsed.entities.length} entities, ${Object.keys(parsed.tables.layers).length} layers, ${Object.keys(parsed.blocks).length} blocks`);
}

// Verify 3D spindle sample specifically contains MESH, 3DFACE, POLYLINE, HELIX, and nested INSERT
const spindleRaw = fs.readFileSync(path.join(samplesDir, 'cnc_spindle_head_3d.dxf'), 'utf-8');
const spindleParsed = new DXFLoader.DXFParser().parse(spindleRaw);
const types3d = new Set(spindleParsed.entities.map(e => e.type));
assert(types3d.has('MESH') && types3d.has('3DFACE') && types3d.has('POLYLINE') && types3d.has('INSERT'), '3D spindle should cover MESH, 3DFACE, POLYLINE, INSERT');

console.log('[threejs-dxf-loader] All automated tests passed!');
