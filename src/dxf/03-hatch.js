/**
 * @license MIT
 * threejs-dxf-loader - Hatch loop classification (outer/hole) and polyline line-type dash tessellation.
 */
function polygonSignedArea2D(ring) {
  let area = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p1 = ring[i], p2 = ring[(i + 1) % n];
    area += (p1.x * p2.y - p2.x * p1.y);
  }
  return area * 0.5;
}

function isPointInPolygon2D(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x, yi = ring[i].y;
    const xj = ring[j].x, yj = ring[j].y;
    const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
      (pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-15) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function classifyHatchLoops(rings) {
  if (rings.length === 0) return [];
  if (rings.length === 1) return [{ outer: rings[0], holes: [] }];
  if (rings.length > 80) {
    return rings.map(r => ({ outer: r, holes: [] }));
  }

  const metas = rings.map((r, idx) => ({
    idx,
    ring: r,
    absArea: Math.abs(polygonSignedArea2D(r)),
    samplePt: r[0],
    parents: []
  }));

  for (let i = 0; i < metas.length; i++) {
    for (let j = 0; j < metas.length; j++) {
      if (i === j) continue;
      if (metas[j].absArea > metas[i].absArea && isPointInPolygon2D(metas[i].samplePt, metas[j].ring)) {
        metas[i].parents.push(j);
      }
    }
  }

  const groups = new Map();
  for (const m of metas) {
    if (m.parents.length % 2 === 0) {
      groups.set(m.idx, { outer: m.ring, holes: [] });
    }
  }
  for (const m of metas) {
    if (m.parents.length % 2 === 1) {
      let bestParentIdx = -1;
      let smallestArea = Infinity;
      for (const pIdx of m.parents) {
        if (groups.has(pIdx) && metas[pIdx].absArea < smallestArea) {
          smallestArea = metas[pIdx].absArea;
          bestParentIdx = pIdx;
        }
      }
      if (bestParentIdx !== -1) {
        groups.get(bestParentIdx).holes.push(m.ring);
      } else {
        groups.set(m.idx, { outer: m.ring, holes: [] });
      }
    }
  }
  return Array.from(groups.values());
}

function tessellatePolylineSegmentsToBatch(pts, pattern, batch, colorPair) {
  if (!pts || pts.length < 2) return;
  if (!pattern || pattern.length === 0) {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      batch.addSegment(a.x, a.y, a.z, b.x, b.y, b.z, colorPair);
    }
    return;
  }

  let totalPolyLen = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    totalPolyLen += pts[i].distanceTo(pts[i + 1]);
  }
  if (totalPolyLen < 1e-6) return;

  let patSum = 0;
  for (let i = 0; i < pattern.length; i++) patSum += Math.abs(pattern[i]) || 0.2;
  if (patSum < 1e-4) {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      batch.addSegment(a.x, a.y, a.z, b.x, b.y, b.z, colorPair);
    }
    return;
  }

  let adaptScale = 1.0;
  if (totalPolyLen / patSum > 60) {
    adaptScale = (totalPolyLen / 35) / patSum;
  } else if (totalPolyLen / patSum < 0.35) {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      batch.addSegment(a.x, a.y, a.z, b.x, b.y, b.z, colorPair);
    }
    return;
  }

  const effPattern = pattern.map(v => v * adaptScale);
  const effSum = patSum * adaptScale;

  let patIdx = 0;
  let patRem = Math.abs(effPattern[0]) || (effSum * 0.05);
  let isDraw = effPattern[0] >= 0;

  for (let i = 0; i < pts.length - 1; i++) {
    const pA = pts[i], pB = pts[i + 1];
    const dx = pB.x - pA.x, dy = pB.y - pA.y, dz = pB.z - pA.z;
    const segLen = Math.hypot(dx, dy, dz);
    if (segLen < 1e-9) continue;

    const ux = dx / segLen, uy = dy / segLen, uz = dz / segLen;
    let dist = 0;
    let curX = pA.x, curY = pA.y, curZ = pA.z;

    while (dist < segLen - 1e-7) {
      const step = Math.min(patRem, segLen - dist);
      const nx = curX + ux * step, ny = curY + uy * step, nz = curZ + uz * step;
      if (isDraw) batch.addSegment(curX, curY, curZ, nx, ny, nz, colorPair);
      curX = nx; curY = ny; curZ = nz;
      dist += step;
      patRem -= step;
      if (patRem <= 1e-7) {
        patIdx = (patIdx + 1) % effPattern.length;
        const rawP = effPattern[patIdx];
        isDraw = rawP >= 0;
        patRem = Math.abs(rawP) < 1e-4 ? (effSum * 0.04) : Math.abs(rawP);
      }
    }
  }
}

export { polygonSignedArea2D, isPointInPolygon2D, classifyHatchLoops, tessellatePolylineSegmentsToBatch };
