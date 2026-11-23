/**
 * @license GPL-3.0
 * threejs-dxf-loader - Spatial pick index for DXF pick records.
 *
 * The loader returns one {@link DXFPickRecord} per entity with a world-space
 * bounding box. Naively testing every record on every click or marquee drag is
 * O(n) and freezes on drawings with 100k+ entities. PickIndex builds two
 * grid indexes so picking stays O(candidates):
 *
 *   - a world-space grid (built once per parse, camera independent) for
 *     ray / box queries in model space;
 *   - a screen-space grid of projected bounding boxes (rebuilt when the camera
 *     moves) for marquee selection and nearest-point picking.
 *
 * Usage:
 *   const index = new PickIndex(result.pickRecords);
 *   index.updateScreen(camera, canvasWidth, canvasHeight);
 *   const hit = index.pickAt(px, py);          // nearest record or null
 *   const ids = index.queryScreenBox(x0, y0, x1, y1); // broad-phase candidates
 */
import * as THREE from 'three';

const EMPTY = Object.freeze({ x0: 0, y0: 0, x1: 0, y1: 0 });

export class PickIndex {
  /**
   * @param {Array<{id:number, box:THREE.Box3}>} pickRecords
   * @param {{cellPx?:number, worldDivisions?:number}} [options]
   */
  constructor(pickRecords, options = {}) {
    this.records = pickRecords || [];
    this.cellPx = options.cellPx || 24;
    this.worldDivisions = options.worldDivisions || 256;
    this._screen = null;
    this._world = null;
    this._corners = new Array(8).fill(0).map(() => new THREE.Vector3());
    this._v = new THREE.Vector3();
    this._box = new THREE.Box3();
  }

  /** Rebuild the camera-independent world-space grid. */
  buildWorldIndex() {
    const records = this.records;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const rec of records) {
      const b = rec && rec.box;
      if (!b || b.isEmpty()) continue;
      if (b.min.x < minX) minX = b.min.x;
      if (b.min.y < minY) minY = b.min.y;
      if (b.max.x > maxX) maxX = b.max.x;
      if (b.max.y > maxY) maxY = b.max.y;
    }
    const span = Math.max(maxX - minX, maxY - minY, 1);
    const cell = Math.max(span / this.worldDivisions, 1e-6);
    const cells = new Map();
    const oversized = [];
    for (let i = 0; i < records.length; i++) {
      const b = records[i] && records[i].box;
      if (!b || b.isEmpty()) continue;
      const x0 = Math.floor(b.min.x / cell), x1 = Math.floor(b.max.x / cell);
      const y0 = Math.floor(b.min.y / cell), y1 = Math.floor(b.max.y / cell);
      if (Math.max(x1 - x0, y1 - y0) > 96) { oversized.push(i); continue; }
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const k = cx + '_' + cy;
          let arr = cells.get(k);
          if (!arr) { arr = []; cells.set(k, arr); }
          arr.push(i);
        }
      }
    }
    this._world = { cell, cells, oversized };
    return this;
  }

  _ensureWorld() {
    if (!this._world) this.buildWorldIndex();
    return this._world;
  }

  /** Record indices whose world AABB may intersect `box`. */
  queryWorldBox(box) {
    const idx = this._ensureWorld();
    const out = new Set(idx.oversized);
    if (!box || box.isEmpty()) return [];
    const x0 = Math.floor(box.min.x / idx.cell), x1 = Math.floor(box.max.x / idx.cell);
    const y0 = Math.floor(box.min.y / idx.cell), y1 = Math.floor(box.max.y / idx.cell);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const arr = idx.cells.get(cx + '_' + cy);
        if (arr) for (const i of arr) out.add(i);
      }
    }
    return [...out];
  }

  /**
   * Record indices whose world AABB is within `tolerance` of the ray.
   * @param {THREE.Ray} ray
   */
  queryRay(ray, tolerance = 0) {
    const idx = this._ensureWorld();
    const candidates = new Set(idx.oversized);
    // Walk the ray through the world grid using its XY direction; fall back to a
    // full pass for rays that are (nearly) perpendicular to the XY plane.
    const dir = ray.direction;
    const planarity = Math.hypot(dir.x, dir.y);
    if (planarity > 1e-4) {
      const step = idx.cell * 0.5;
      const len = Math.max(1e-3, Math.hypot(dir.x, dir.y));
      const maxT = 1e6;
      for (let t = 0; t < maxT; t += step) {
        const x = ray.origin.x + (dir.x / len) * t;
        const y = ray.origin.y + (dir.y / len) * t;
        const cx = Math.floor(x / idx.cell), cy = Math.floor(y / idx.cell);
        let any = false;
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const arr = idx.cells.get((cx + dx) + '_' + (cy + dy));
            if (arr) { any = true; for (const i of arr) candidates.add(i); }
          }
        }
        // Stop once the ray leaves the drawing extent on its XY projection.
        if (!any && t > idx.cell * this.worldDivisions) break;
      }
    } else {
      for (let i = 0; i < this.records.length; i++) candidates.add(i);
    }
    const result = [];
    const pad = tolerance > 0 ? tolerance : 0;
    for (const i of candidates) {
      const b = this.records[i] && this.records[i].box;
      if (!b || b.isEmpty()) continue;
      this._box.copy(b);
      if (pad) this._box.expandByScalar(pad);
      if (ray.intersectsBox(this._box)) result.push(i);
    }
    return result;
  }

  /**
   * Project every record's world AABB into screen space for the given camera.
   * Results are cached and reused until the camera or canvas size changes.
   * @param {THREE.Camera} camera
   * @param {number} width
   * @param {number} height
   */
  updateScreen(camera, width, height) {
    const w = width || 800;
    const h = height || 600;
    const r4 = (v) => Math.round(v * 1e4) / 1e4;
    let key;
    if (camera && camera.isOrthographicCamera) {
      key = `o:${r4(camera.left)},${r4(camera.right)},${r4(camera.top)},${r4(camera.bottom)},${r4(camera.zoom)},${r4(camera.position.x)},${r4(camera.position.y)}|${w}x${h}`;
    } else if (camera) {
      key = camera.matrixWorldInverse.elements.map(r4).join(',') + '|' + camera.projectionMatrix.elements.map(r4).join(',') + '|' + w + 'x' + h;
    } else {
      key = 'none';
    }
    if (this._screen && this._screen.key === key) return this;

    const records = this.records;
    const n = records.length;
    const boxes = new Array(n).fill(null);
    const cells = new Map();
    const isOrtho = !!(camera && camera.isOrthographicCamera);
    const vMin = new THREE.Vector3(), vMax = new THREE.Vector3();
    const corners = this._corners;

    for (let i = 0; i < n; i++) {
      const b = records[i] && records[i].box;
      if (!b || b.isEmpty()) continue;
      let sxMin, syMin, sxMax, syMax;
      if (isOrtho) {
        vMin.copy(b.min).project(camera);
        vMax.copy(b.max).project(camera);
        const ax = (vMin.x * 0.5 + 0.5) * w, ay = (-vMin.y * 0.5 + 0.5) * h;
        const bx = (vMax.x * 0.5 + 0.5) * w, by = (-vMax.y * 0.5 + 0.5) * h;
        sxMin = Math.min(ax, bx); sxMax = Math.max(ax, bx);
        syMin = Math.min(ay, by); syMax = Math.max(ay, by);
      } else {
        corners[0].set(b.min.x, b.min.y, b.min.z); corners[1].set(b.max.x, b.min.y, b.min.z);
        corners[2].set(b.max.x, b.max.y, b.min.z); corners[3].set(b.min.x, b.max.y, b.min.z);
        corners[4].set(b.min.x, b.min.y, b.max.z); corners[5].set(b.max.x, b.min.y, b.max.z);
        corners[6].set(b.max.x, b.max.y, b.max.z); corners[7].set(b.min.x, b.max.y, b.max.z);
        sxMin = Infinity; syMin = Infinity; sxMax = -Infinity; syMax = -Infinity;
        for (let c = 0; c < 8; c++) {
          this._v.copy(corners[c]).project(camera);
          const sx = (this._v.x * 0.5 + 0.5) * w, sy = (-this._v.y * 0.5 + 0.5) * h;
          if (sx < sxMin) sxMin = sx; if (sy < syMin) syMin = sy;
          if (sx > sxMax) sxMax = sx; if (sy > syMax) syMax = sy;
        }
      }
      const box = { x0: sxMin, y0: syMin, x1: sxMax, y1: syMax };
      boxes[i] = box;
      const cellPx = this.cellPx;
      const cx0 = Math.floor(sxMin / cellPx), cx1 = Math.floor(sxMax / cellPx);
      const cy0 = Math.floor(syMin / cellPx), cy1 = Math.floor(syMax / cellPx);
      if (Math.max(cx1 - cx0, cy1 - cy0) > 200) continue;
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          const k = cx + '_' + cy;
          let arr = cells.get(k);
          if (!arr) { arr = []; cells.set(k, arr); }
          arr.push(i);
        }
      }
    }
    this._screen = { key, cellPx: this.cellPx, cells, boxes };
    return this;
  }

  /** Screen-space AABB of record `i` (or null). Requires updateScreen(). */
  getScreenBox(i) {
    return (this._screen && this._screen.boxes[i]) || null;
  }

  /** Broad-phase: record indices whose projected AABB touches the marquee. */
  queryScreenBox(x0, y0, x1, y1) {
    const s = this._screen;
    const ids = new Set();
    if (!s) return ids;
    const minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
    const cx0 = Math.floor(minX / s.cellPx), cx1 = Math.floor(maxX / s.cellPx);
    const cy0 = Math.floor(minY / s.cellPx), cy1 = Math.floor(maxY / s.cellPx);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const arr = s.cells.get(cx + '_' + cy);
        if (arr) for (const i of arr) ids.add(i);
      }
    }
    return ids;
  }

  /**
   * Nearest pick record under a screen point.
   * Chooses the smallest projected AABB containing the point (the most
   * specific entity), which naturally prefers text/dimensions over large
   * hatches that may also cover the point.
   * @returns {object|null} the pick record, or null
   */
  pickAt(x, y, options = {}) {
    const tolerance = options.tolerance != null ? options.tolerance : 6;
    const s = this._screen;
    if (!s) return null;
    const candidates = this.queryScreenBox(x - tolerance, y - tolerance, x + tolerance, y + tolerance);
    let best = null;
    let bestArea = Infinity;
    for (const i of candidates) {
      const b = s.boxes[i];
      if (!b) continue;
      if (x < b.x0 - tolerance || x > b.x1 + tolerance || y < b.y0 - tolerance || y > b.y1 + tolerance) continue;
      const area = Math.max(1, (b.x1 - b.x0)) * Math.max(1, (b.y1 - b.y0));
      if (area < bestArea) { bestArea = area; best = this.records[i]; }
    }
    return best || null;
  }

  /** Force both indexes to be rebuilt on next use. */
  invalidate() {
    this._screen = null;
    this._world = null;
    return this;
  }
}
