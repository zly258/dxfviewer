/**
 * @license MIT
 * threejs-dxf-loader - Mathematical helpers: OCS to WCS transform, bulge arcs, Cox-de Boor NURBS evaluation, crease-angle smooth normals.
 */
import * as THREE from 'three';

function getOCS2WCSMatrix(extrusion) {
  const mat = new THREE.Matrix4();
  if (!extrusion) return mat;
  const nx = extrusion.x || 0, ny = extrusion.y || 0, nz = extrusion.z !== undefined ? extrusion.z : 1;
  if (Math.abs(nx) < 1e-7 && Math.abs(ny) < 1e-7 && Math.abs(nz - 1) < 1e-7) return mat;
  const N = new THREE.Vector3(nx, ny, nz);
  if (N.lengthSq() < 1e-12) return mat;
  N.normalize();
  const threshold = 1.0 / 64.0;
  const Ax = (Math.abs(N.x) < threshold && Math.abs(N.y) < threshold)
    ? new THREE.Vector3(0, 1, 0).cross(N).normalize()
    : new THREE.Vector3(0, 0, 1).cross(N).normalize();
  const Ay = new THREE.Vector3().crossVectors(N, Ax).normalize();
  mat.makeBasis(Ax, Ay, N);
  return mat;
}

/**
 * Computes smooth vertex normals across curved 3D surfaces while preserving sharp edges (>= creaseDeg).
 */
/**
 * Compute smooth vertex normals with a crease-angle threshold.
 *
 * `creaseDeg` controls where the surface is allowed to break: faces whose
 * normals differ by more than this angle keep their own flat normal, which
 * preserves sharp mechanical edges on solids.
 *
 * The spatial welding grid is now adaptive to the model size. A fixed
 * quantisation merges unrelated vertices on large drawings (causing stray
 * shading artefacts) and fails to weld on small ones (causing visible
 * seams between neighbouring facets).
 */
function computeCreaseAngleNormals(posArray, creaseDeg = 44) {
  const vCount = posArray.length / 3;
  const normals = new Float32Array(posArray.length);
  if (vCount < 3) return normals;

  const faceCount = Math.floor(vCount / 3);
  const faceNormals = new Float32Array(faceCount * 3);

  // 1. Compute flat face normals
  for (let f = 0; f < faceCount; f++) {
    const i = f * 9;
    const ax = posArray[i], ay = posArray[i + 1], az = posArray[i + 2];
    const bx = posArray[i + 3], by = posArray[i + 4], bz = posArray[i + 5];
    const cx = posArray[i + 6], cy = posArray[i + 7], cz = posArray[i + 8];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    faceNormals[f * 3] = nx;
    faceNormals[f * 3 + 1] = ny;
    faceNormals[f * 3 + 2] = nz;
    normals[i] = nx; normals[i + 1] = ny; normals[i + 2] = nz;
    normals[i + 3] = nx; normals[i + 4] = ny; normals[i + 5] = nz;
    normals[i + 6] = nx; normals[i + 7] = ny; normals[i + 8] = nz;
  }

  // Skip spatial welding if mesh is enormous (>150,000 vertices) to keep frame rate fast
  if (vCount > 150000) return normals;

  // 2. Bucket vertices by quantized spatial position.
  //    The quantum follows the model extent so welding is scale independent.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let v = 0; v < vCount; v++) {
    const idx = v * 3;
    const x = posArray[idx], y = posArray[idx + 1], z = posArray[idx + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-6);
  // Welding quantum: use an absolute CAD-scale tolerance (0.01 mm) so that
  // neighbouring facets of the same solid always weld, regardless of how
  // large the model is. A purely relative quantum (extent/4096) would be
  // 24 mm on a 100 m model and would leave visible seams between facets.
  // The upper bound keeps small models from merging distinct vertices.
  const quantum = Math.max(Math.min(extent / 4096, 1e-2), 1e-9);

  const buckets = new Map();
  for (let v = 0; v < vCount; v++) {
    const idx = v * 3;
    const key = `${Math.round(posArray[idx] / quantum)},${Math.round(posArray[idx + 1] / quantum)},${Math.round(posArray[idx + 2] / quantum)}`;
    let list = buckets.get(key);
    if (!list) {
      list = [];
      buckets.set(key, list);
    }
    list.push(v);
  }

  const cosThresh = Math.cos((creaseDeg * Math.PI) / 180.0);

  // 3. Average normals for shared vertices whose face normals are within creaseDeg
  for (const list of buckets.values()) {
    if (list.length <= 1 || list.length > 64) continue;
    for (let i = 0; i < list.length; i++) {
      const vA = list[i];
      const fA = Math.floor(vA / 3) * 3;
      const nAx = faceNormals[fA], nAy = faceNormals[fA + 1], nAz = faceNormals[fA + 2];
      let sx = nAx, sy = nAy, sz = nAz;
      for (let j = 0; j < list.length; j++) {
        if (i === j) continue;
        const vB = list[j];
        const fB = Math.floor(vB / 3) * 3;
        const nBx = faceNormals[fB], nBy = faceNormals[fB + 1], nBz = faceNormals[fB + 2];
        if (nAx * nBx + nAy * nBy + nAz * nBz >= cosThresh) {
          sx += nBx; sy += nBy; sz += nBz;
        }
      }
      const sl = Math.hypot(sx, sy, sz) || 1;
      const outIdx = vA * 3;
      normals[outIdx] = sx / sl;
      normals[outIdx + 1] = sy / sl;
      normals[outIdx + 2] = sz / sl;
    }
  }

  return normals;
}

function interpolateBulgePoints(p1, p2, bulge, segmentsPerCircle = 128) {
  if (!bulge || Math.abs(bulge) < 1e-6 || !isFinite(bulge)) {
    return [new THREE.Vector3(p1.x, p1.y, p1.z || 0), new THREE.Vector3(p2.x, p2.y, p2.z || 0)];
  }
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-9) return [new THREE.Vector3(p1.x, p1.y, p1.z || 0)];
  const includedAngle = 4.0 * Math.atan(bulge);
  const sinHalf = Math.sin(Math.abs(includedAngle) / 2.0);
  if (sinHalf < 1e-9) return [new THREE.Vector3(p1.x, p1.y, p1.z || 0), new THREE.Vector3(p2.x, p2.y, p2.z || 0)];
  const radius = chord / (2.0 * sinHalf);
  const midX = (p1.x + p2.x) * 0.5;
  const midY = (p1.y + p2.y) * 0.5;
  const cotHalf = (1.0 - bulge * bulge) / (2.0 * bulge);
  const cx = midX - (dy * 0.5) * cotHalf;
  const cy = midY + (dx * 0.5) * cotHalf;
  const startAngle = Math.atan2(p1.y - cy, p1.x - cx);
  // Segment budget for the arc.
  //   - at least one segment per 90 degrees of sweep (ezdxf `ConstructionEllipse`)
  //   - at least 6 segments (three-dxf uses the same floor)
  //   - `segmentsPerCircle` controls the density of a full circle
  // The previous floor of 4 segments turned a 90 degree arc into a visible
  // quadrilateral, which is exactly the kind of faceting users notice.
  const numSegs = Math.max(
    6,
    Math.min(
      256,
      Math.max(
        Math.ceil(Math.abs(includedAngle) / (Math.PI / 2)),
        Math.ceil((Math.abs(includedAngle) / (Math.PI * 2)) * segmentsPerCircle)
      )
    )
  );
  const pts = [];
  const z1 = p1.z || 0;
  const z2 = p2.z !== undefined ? p2.z : z1;
  for (let i = 0; i <= numSegs; i++) {
    const t = i / numSegs;
    const ang = startAngle + includedAngle * t;
    pts.push(new THREE.Vector3(cx + radius * Math.cos(ang), cy + radius * Math.sin(ang), z1 + (z2 - z1) * t));
  }
  return pts;
}

function evaluateNurbsSpline(degree, controlPoints, knots, weights, baseSamples = 48) {
  if (!controlPoints || controlPoints.length < 2) return [];
  const validCP = controlPoints.filter(p => isFinite(p.x) && isFinite(p.y));
  const n = validCP.length - 1;
  if (n < 1) return [];
  const p = Math.max(1, Math.min(degree || 3, n));
  const expectedKnots = n + p + 2;

  let U = null;
  if (knots && knots.length === expectedKnots) {
    const span = knots[n + 1] - knots[p];
    if (isFinite(span) && span > 1e-9) U = knots;
  } else if (knots && knots.length === n + p && n >= p) {
    const span = knots[n] - knots[p - 1];
    if (isFinite(span) && span > 1e-9) {
      U = [knots[0], ...knots, knots[knots.length - 1]];
    }
  }
  if (!U) {
    U = [];
    const m = n + p + 1;
    for (let i = 0; i <= m; i++) {
      if (i <= p) U.push(0);
      else if (i >= m - p) U.push(1);
      else U.push((i - p) / (m - 2 * p));
    }
  }

  const uStart = U[p];
  const uEnd = U[n + 1];
  if (uEnd <= uStart) return validCP.map(pt => new THREE.Vector3(pt.x, pt.y, pt.z || 0));

  // Sample density follows the control polygon: a spline with many control
  // points gets a proportionally denser sampling. The cap only exists to
  // bound the worst case (a huge spline), it is not a quality setting.
  const numSamples = Math.max(baseSamples, Math.min(1024, validCP.length * 8));

  function findSpan(u) {
    if (u >= U[n + 1]) return n;
    if (u <= U[p]) return p;
    let low = p, high = n + 1, mid = (low + high) >> 1;
    while (u < U[mid] || u >= U[mid + 1]) {
      if (u < U[mid]) high = mid;
      else low = mid;
      mid = (low + high) >> 1;
    }
    return mid;
  }

  const N = new Float64Array(p + 1);
  const left = new Float64Array(p + 1);
  const right = new Float64Array(p + 1);
  const pts = [];

  for (let s = 0; s <= numSamples; s++) {
    const u = s === numSamples ? uEnd : (s === 0 ? uStart : uStart + (uEnd - uStart) * (s / numSamples));
    const span = findSpan(u);
    N[0] = 1.0;
    for (let j = 1; j <= p; j++) {
      left[j] = u - U[span + 1 - j];
      right[j] = U[span + j] - u;
      let saved = 0.0;
      for (let r = 0; r < j; r++) {
        const denom = right[r + 1] + left[j - r];
        const temp = denom > 1e-12 ? N[r] / denom : 0.0;
        N[r] = saved + right[r + 1] * temp;
        saved = left[j - r] * temp;
      }
      N[j] = saved;
    }

    let wx = 0, wy = 0, wz = 0, wSum = 0;
    for (let j = 0; j <= p; j++) {
      const cpIdx = span - p + j;
      if (cpIdx >= 0 && cpIdx <= n) {
        const w = (weights && weights[cpIdx] !== undefined && weights[cpIdx] > 0) ? weights[cpIdx] : 1.0;
        const bw = N[j] * w;
        wx += validCP[cpIdx].x * bw;
        wy += validCP[cpIdx].y * bw;
        wz += (validCP[cpIdx].z || 0) * bw;
        wSum += bw;
      }
    }
    if (wSum > 1e-12) {
      pts.push(new THREE.Vector3(wx / wSum, wy / wSum, wz / wSum));
    }
  }
  return pts;
}

/**
 * Decode an ACIS SAT text stream.
 *
 * SAT bodies are obfuscated with a reversible XOR-159 scheme (implemented
 * in ezdxf as `tools/crypt.py`). Two details matter and are easy to miss:
 *
 *  1. The printable-character mapping is `159 - c`, which is equivalent to
 *     `c ^ 0x5F` for the whole printable ASCII range.
 *  2. The character `0x5E` (`^`) encodes the letter `A` and is followed by
 *     one filler character that must be skipped. Without that skip rule an
 *     extra blank survives in the token stream and breaks the
 *     `body/lump/shell/...` keyword matching.
 *
 * The special cases `0x20` (space), `0x40` (`_`) and `0x5F` (`@`) are
 * passed through as themselves.
 */

export { getOCS2WCSMatrix, computeCreaseAngleNormals, interpolateBulgePoints, evaluateNurbsSpline };
