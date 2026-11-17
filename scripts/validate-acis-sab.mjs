/**
 * Validate the ACIS / SAB (binary ACIS) handling of the parser.
 *
 * The script walks every sample drawing that ships with the repository,
 * reports how many ACIS entities were found, how many of them could be
 * matched against their SAB attachment and how much geometry the ACIS
 * rebuild contributes.
 *
 * Drawings without ACIS entities are reported as "skipped" instead of
 * failing, so the script can run in CI without any private drawings.
 *
 * Usage: node scripts/validate-acis-sab.mjs
 * Author: zhangly1403 <zhangly1403@qq.com>
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const samplesDir = path.join(rootDir, 'examples', 'samples');

// Minimal THREE stub: the parser only needs the math helpers while parsing.
globalThis.THREE = {
  MathUtils: {
    degToRad: (d) => (d * Math.PI) / 180,
    radToDeg: (r) => (r * 180) / Math.PI
  },
  Color: class {
    constructor(hex = 0) { this.hex = hex; }
    getHSL(t) { t.h = 0; t.s = 0.5; t.l = 0.5; return t; }
    setHSL() { return this; }
    getHex() { return this.hex; }
    getHexString() { return this.hex.toString(16).padStart(6, '0'); }
  }
};

const require = createRequire(import.meta.url);
const DXFLoader = require('../dist/threejs-dxf-loader.umd.js');

const ACIS_TYPES = new Set([
  '3DSOLID', 'REGION', 'BODY', 'SURFACE', 'PLANESURFACE',
  'EXTRUDEDSURFACE', 'REVOLVEDSURFACE', 'SWEPTSURFACE', 'LOFTEDSURFACE'
]);

function collectAcisEntities(dxf) {
  const list = [];
  const visit = (ents) => {
    for (const e of ents || []) {
      if (ACIS_TYPES.has(e.type)) list.push(e);
    }
  };
  visit(dxf.entities);
  for (const key of Object.keys(dxf.blocks || {})) visit(dxf.blocks[key].entities);
  return list;
}

if (!fs.existsSync(samplesDir)) {
  console.error('[validate-acis-sab] Missing samples directory:', samplesDir);
  process.exit(1);
}

const files = fs.readdirSync(samplesDir).filter(f => f.toLowerCase().endsWith('.dxf')).sort();
if (files.length === 0) {
  console.error('[validate-acis-sab] No sample drawings found in', samplesDir);
  process.exit(1);
}

let drawingsWithAcis = 0;
let totalAcis = 0;
let totalMatched = 0;
let totalSabMap = 0;
let failures = 0;

for (const file of files) {
  const raw = fs.readFileSync(path.join(samplesDir, file), 'utf8');
  const t0 = Date.now();
  const dxf = new DXFLoader.DXFParser().parse(raw);
  const parseMs = Date.now() - t0;

  const acisEnts = collectAcisEntities(dxf);
  const sabMapSize = dxf.acisSabByHandle ? dxf.acisSabByHandle.size : 0;
  totalSabMap += sabMapSize;

  if (acisEnts.length === 0) {
    console.log(`[SKIP] ${file}: no ACIS entities (${parseMs} ms)`);
    continue;
  }

  drawingsWithAcis++;
  totalAcis += acisEnts.length;

  const byType = {};
  for (const e of acisEnts) byType[e.type] = (byType[e.type] || 0) + 1;

  let matched = 0;
  let satNative = 0;
  for (const e of acisEnts) {
    const h = e.handle ? String(e.handle).toLowerCase() : '';
    if (h && dxf.acisSabByHandle && dxf.acisSabByHandle.has(h)) matched++;
    if (e.satLines && e.satLines.length) satNative++;
  }
  totalMatched += matched;
  const matchRate = matched / acisEnts.length;

  console.log(`[ACIS] ${file}: ${acisEnts.length} entities ${JSON.stringify(byType)}`);
  console.log(`       SAB map=${sabMapSize} matched=${matched} (${(matchRate * 100).toFixed(1)}%), native SAT=${satNative}, parse=${parseMs} ms`);

  if (matchRate < 0.95) {
    console.error(`[validate-acis-sab] FAIL: SAB match rate in ${file} is ${matchRate.toFixed(4)} < 0.95`);
    failures++;
  }
}

console.log('');
console.log(JSON.stringify({
  drawings: files.length,
  drawingsWithAcis,
  acisEntities: totalAcis,
  sabMapTotal: totalSabMap,
  sabMatched: totalMatched,
  matchRate: totalAcis ? Number((totalMatched / totalAcis).toFixed(4)) : null
}, null, 2));

if (failures > 0) {
  console.error(`[validate-acis-sab] FAIL: ${failures} drawing(s) below the SAB match threshold`);
  process.exit(2);
}

if (drawingsWithAcis === 0) {
  console.log('[validate-acis-sab] PASS: no ACIS entities in the bundled samples (nothing to validate)');
} else {
  console.log('[validate-acis-sab] PASS: SAB match rate >= 95%');
}
