/**
 * Validate the ACIS / SAB (binary ACIS) handling across the bundled sample drawings
 * Author: zhangly1403
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const samplesDir = path.join(rootDir, 'examples', 'samples');

if (!fs.existsSync(samplePath)) {
  console.error('[validate-acis-sab] Missing sample:', samplePath);
  process.exit(1);
}

globalThis.THREE = THREE;
const require = createRequire(import.meta.url);
const DXFLoader = require('../dist/three-dxf-loader.umd.js');

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

class CountingBatch {
  constructor() {
    this.segments = 0;
    this.tris = 0;
    this.min = { x: Infinity, y: Infinity, z: Infinity };
    this.max = { x: -Infinity, y: -Infinity, z: -Infinity };
  }
  _bb(x, y, z) {
    if (x < this.min.x) this.min.x = x; if (y < this.min.y) this.min.y = y; if (z < this.min.z) this.min.z = z;
    if (x > this.max.x) this.max.x = x; if (y > this.max.y) this.max.y = y; if (z > this.max.z) this.max.z = z;
  }
  addSegment(x1, y1, z1, x2, y2, z2) {
    this.segments++;
    this._bb(x1, y1, z1); this._bb(x2, y2, z2);
  }
  addTriangle3D(x1, y1, z1, x2, y2, z2, x3, y3, z3) {
    this.tris++;
    this._bb(x1, y1, z1); this._bb(x2, y2, z2); this._bb(x3, y3, z3);
  }
}

console.log('[validate-acis-sab] Reading', samplePath);
const raw = fs.readFileSync(samplePath, 'utf8');
const t0 = Date.now();
const dxf = new DXFLoader.DXFParser().parse(raw);
const tParse = Date.now() - t0;

const sabSize = dxf.acisSabByHandle ? dxf.acisSabByHandle.size : 0;
const acisEnts = collectAcisEntities(dxf);
const byType = {};
for (const e of acisEnts) byType[e.type] = (byType[e.type] || 0) + 1;

let matched = 0;
let satNative = 0;
for (const e of acisEnts) {
  const h = e.handle ? String(e.handle).toLowerCase() : '';
  if (h && dxf.acisSabByHandle.has(h)) matched++;
  if (e.satLines && e.satLines.length) satNative++;
}
const matchRate = acisEnts.length ? matched / acisEnts.length : 0;

console.log(JSON.stringify({
  parseMs: tParse,
  acadVer: dxf.header['$ACADVER'],
  entityTopLevel: dxf.entities.length,
  blocks: Object.keys(dxf.blocks).length,
  acisEntities: acisEnts.length,
  byType,
  sabMapSize: sabSize,
  sabMatched: matched,
  sabMatchRate: Number(matchRate.toFixed(4)),
  nativeSatLines: satNative
}, null, 2));

if (matchRate < 0.95) {
  console.error('[validate-acis-sab] FAIL: SAB match rate', matchRate, '< 0.95');
  process.exit(2);
}

const batch = new CountingBatch();
const identity = new THREE.Matrix4();
const loader = new DXFLoader();
let sabOk = 0, sabFail = 0, withGeom = 0, emittedEdges = 0;
let facesTotal = 0, facesMeshed = 0, facesEdgeOnly = 0, faceTris = 0;
const faceByType = {};
const t1 = Date.now();
for (const ent of acisEnts) {
  const stats = {
    acisEntities: 0, acisSabMatched: 0, acisSabOk: 0, acisSabFail: 0,
    acisSatOk: 0, acisEmpty: 0, acisEmittedEdges: 0, warnings: []
  };
  const beforeS = batch.segments, beforeT = batch.tris;
  try {
    loader.emitACISSolid(ent, dxf, batch, identity, null, stats);
    if (stats.acisSabFail || stats.acisEmpty) sabFail++;
    else sabOk++;
    emittedEdges += stats.acisEmittedEdges || 0;
    facesTotal += stats.acisFacesTotal || 0;
    facesMeshed += stats.acisFacesMeshed || 0;
    facesEdgeOnly += stats.acisFacesEdgeOnly || 0;
    faceTris += stats.acisFaceTris || 0;
    if (stats.acisFaceByType) {
      for (const k of Object.keys(stats.acisFaceByType)) {
        const src = stats.acisFaceByType[k];
        const dst = faceByType[k] || (faceByType[k] = { total: 0, meshed: 0, tris: 0 });
        dst.total += src.total || 0;
        dst.meshed += src.meshed || 0;
        dst.tris += src.tris || 0;
      }
    }
    if (batch.segments > beforeS || batch.tris > beforeT) withGeom++;
  } catch (err) {
    sabFail++;
    console.warn('emit fail', ent.handle, err.message);
  }
}
const tEmit = Date.now() - t1;
const bboxEmpty = !isFinite(batch.min.x) || batch.min.x > batch.max.x;
const vertsApprox = batch.segments * 2 + batch.tris * 3;
const byTypeRates = {};
for (const k of Object.keys(faceByType)) {
  const s = faceByType[k];
  byTypeRates[k] = {
    total: s.total,
    meshed: s.meshed,
    edgeOnly: Math.max(0, s.total - s.meshed),
    triangles: s.tris,
    meshRate: s.total ? Number((s.meshed / s.total).toFixed(4)) : 0
  };
}

console.log(JSON.stringify({
  emitCount: sabOk + sabFail,
  sabOk,
  sabFail,
  withGeometry: withGeom,
  segments: batch.segments,
  triangles: batch.tris,
  approxVertices: vertsApprox,
  emittedEdges,
  facesTotal,
  facesMeshed,
  facesEdgeOnly,
  faceTriangles: faceTris,
  faceByType: byTypeRates,
  emitMs: tEmit,
  globalBBox: bboxEmpty ? null : { min: batch.min, max: batch.max }
}, null, 2));

if (bboxEmpty || vertsApprox < 1000 || withGeom < acisEnts.length * 0.9) {
  console.error('[validate-acis-sab] FAIL: geometry contribution too small', { vertsApprox, withGeom });
  process.exit(3);
}

console.log('[validate-acis-sab] PASS: SAB match >= 95% and geometry emitted');
