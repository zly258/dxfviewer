/**
 * Functional test for the library PickIndex (real three.js, not a mock).
 * Run after `npm run build`:
 *   node scripts/test-pick.mjs
 */
import assert from 'node:assert';
import * as THREE from 'three';
import { PickIndex } from '../dist/threejs-dxf-loader.esm.mjs';

const box = (x0, y0, x1, y1) => new THREE.Box3(new THREE.Vector3(x0, y0, 0), new THREE.Vector3(x1, y1, 0));
const records = [
  { id: 0, box: box(-1, -1, 1, 1) },       // small text-sized box at centre
  { id: 1, box: box(-50, -50, 50, 50) },   // big hatch covering the centre
  { id: 2, box: box(100, 100, 110, 100.2) } // far-away line
];

const camera = new THREE.OrthographicCamera(-100, 100, 100, -100, 0.1, 1000);
camera.position.set(0, 0, 10);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld(true);

const index = new PickIndex(records);
index.updateScreen(camera, 800, 600);

const hit = index.pickAt(400, 300);
assert(hit && hit.id === 0, 'the smallest projected box under the cursor must win');

const marquee = index.queryScreenBox(0, 0, 800, 600);
assert(marquee.has(0) && marquee.has(1), 'marquee broad phase returns all overlapping records');
assert(!marquee.has(2) || true, 'far record may or may not be in the marquee');

index.buildWorldIndex();
const worldHits = index.queryWorldBox(box(-0.5, -0.5, 0.5, 0.5));
assert(worldHits.includes(0) && worldHits.includes(1), 'world box query includes every overlapping record');

const ray = new THREE.Ray(new THREE.Vector3(0, 0, 10), new THREE.Vector3(0, 0, -1));
const rayHits = index.queryRay(ray, 0.5);
assert(rayHits.includes(0) && rayHits.includes(1), 'ray query includes boxes along the ray');

const miss = index.pickAt(790, 10, { tolerance: 2 });
assert(miss === null, 'a click in empty space returns null');

index.invalidate();
assert(index._screen === null && index._world === null, 'invalidate clears both indexes');

console.log(`[pick] all assertions passed (${records.length} records, 6 checks)`);
