import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const mockTHREE = {
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
  },
  Vector3: class {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    clone() { return new mockTHREE.Vector3(this.x, this.y, this.z); }
    add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
    sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
    multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
    length() { return Math.hypot(this.x, this.y, this.z); }
    lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
    normalize() { const l = this.length() || 1; return this.multiplyScalar(1 / l); }
    crossVectors(a, b) {
      const x = a.y * b.z - a.z * b.y, y = a.z * b.x - a.x * b.z, z = a.x * b.y - a.y * b.x;
      return this.set(x, y, z);
    }
    applyMatrix4() { return this; }
    fromBufferAttribute() { return this; }
    project() { return this; }
    setFromMatrixPosition() { return this; }
  },
  Matrix4: class {
    constructor() { this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
    identity() { return this; }
    copy() { return this; }
    clone() { return new mockTHREE.Matrix4(); }
    multiplyMatrices() { return this; }
    makeTranslation() { return this; }
    setPosition() { return this; }
    invert() { return this; }
  },
  Box3: class {
    constructor() { this.min = new mockTHREE.Vector3(Infinity, Infinity, Infinity); this.max = new mockTHREE.Vector3(-Infinity, -Infinity, -Infinity); }
    set() { return this; }
    clone() { return new mockTHREE.Box3(); }
    getCenter() { return new mockTHREE.Vector3(); }
    getSize() { return new mockTHREE.Vector3(); }
    expandByPoint() { return this; }
    expandByScalar() { return this; }
    union() { return this; }
    isEmpty() { return false; }
    distanceTo() { return 1; }
  },
  BufferGeometry: class { constructor() { this.attributes = {}; } setAttribute(k, v) { this.attributes[k] = v; } getAttribute(k) { return this.attributes[k]; } computeBoundingBox() {} computeBoundingSphere() {} setFromPoints() {} },
  BufferAttribute: class { constructor(a, n) { this.array = a; this.itemSize = n; this.count = a.length / n; this.needsUpdate = false; } },
  Float32BufferAttribute: class { constructor(a, n) { this.array = a; this.itemSize = n; this.count = a.length / n; this.needsUpdate = false; } },
  Int32Array: globalThis.Int32Array,
  Mesh: class { constructor(g, m) { this.geometry = g; this.material = m; this.userData = {}; } },
  LineSegments: class { constructor(g, m) { this.geometry = g; this.material = m; this.userData = {}; } },
  MeshBasicMaterial: class { constructor(p) { Object.assign(this, p); } },
  MeshStandardMaterial: class { constructor(p) { Object.assign(this, p); } },
  LineBasicMaterial: class { constructor(p) { Object.assign(this, p); } },
  Group: class { constructor() { this.children = []; this.userData = {}; } add(c) { this.children.push(c); } traverse(fn) { fn(this); } },
  Object3D: class { constructor() { this.children = []; this.userData = {}; } add(c) { this.children.push(c); } traverse(fn) { fn(this); } },
  Vector2: class { constructor(x = 0, y = 0) { this.x = x; this.y = y; } set(x, y) { this.x = x; this.y = y; return this; } },
  Color: class {
    constructor(hex = 0) { this.hex = hex; }
    getHSL(t) { t.h = 0; t.s = 0.5; t.l = 0.5; return t; }
    setHSL() { return this; }
    getHex() { return this.hex; }
    getHexString() { return this.hex.toString(16).padStart(6, '0'); }
  },
  DoubleSide: 2,
  AdditiveBlending: 2,
  SRGBColorSpace: 'srgb',
  NoToneMapping: 0,
  FileLoader: class { constructor() { this.manager = null; } setResponseType() {} load() {} },
  DefaultLoadingManager: {},
  sRGBEncoding: 3001,
};

globalThis.THREE = mockTHREE;
const DXFLoader = require('../dist/threejs-dxf-loader.umd.js');

// Directory to benchmark. Defaults to the samples that ship with the repository
// so the script runs in any environment; pass a path to benchmark your own
// drawings.
const dir = process.argv[2] || path.join(rootDir, 'examples', 'samples');
const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.dxf')).slice(0, 12);

let total = 0;
let failures = 0;
console.log('file'.padEnd(46), 'MB'.padStart(7), 'parse(ms)'.padStart(11), 'entities'.padStart(9));
for (const f of files) {
  const p = path.join(dir, f);
  const mb = fs.statSync(p).size / 1e6;
  if (mb > 40) { console.log(f.slice(0, 45).padEnd(46), mb.toFixed(1).padStart(7), 'skipped (too large)'); continue; }
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const t0 = process.hrtime.bigint();
    const parsed = new DXFLoader.DXFParser().parse(raw);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    total += ms;
    console.log(f.slice(0, 45).padEnd(46), mb.toFixed(1).padStart(7), ms.toFixed(0).padStart(11), String(parsed.entities.length).padStart(9));
  } catch (e) {
    failures++;
    console.log(f.slice(0, 45).padEnd(46), mb.toFixed(1).padStart(7), 'FAILED', e.message);
  }
}
console.log(`\nTotal parse time: ${total.toFixed(0)} ms, failures: ${failures}`);
