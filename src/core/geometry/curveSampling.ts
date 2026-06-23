import { HatchEdge, HatchLoop, Point2D } from '@/types';
import { sampleBulgeSegment } from './bulge';

const TWO_PI = Math.PI * 2;

const isFinitePoint = (point: Point2D | undefined): point is Point2D => {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
};

const normalizeSweepEnd = (start: number, end: number, ccw = true): number => {
  if (!Number.isFinite(start)) start = 0;
  if (!Number.isFinite(end)) end = TWO_PI;

  if (Math.abs(end - start) >= TWO_PI - 1e-9) {
    return ccw ? start + TWO_PI : start - TWO_PI;
  }

  let normalizedEnd = end;
  if (ccw) {
    while (normalizedEnd < start) normalizedEnd += TWO_PI;
  } else {
    while (normalizedEnd > start) normalizedEnd -= TWO_PI;
  }
  return normalizedEnd;
};

export function sampleArcPoints(
  center: Point2D,
  radius: number,
  startAngle: number,
  endAngle: number,
  ccw = true,
  maxSegmentAngle = Math.PI / 24,
): Point2D[] {
  if (!isFinitePoint(center) || !Number.isFinite(radius) || radius <= 0) return [];
  const start = Number.isFinite(startAngle) ? startAngle : 0;
  const end = normalizeSweepEnd(start, Number.isFinite(endAngle) ? endAngle : TWO_PI, ccw);
  const sweep = Math.abs(end - start);
  const steps = Math.max(4, Math.min(192, Math.ceil(sweep / maxSegmentAngle)));
  const points: Point2D[] = [];
  for (let index = 0; index <= steps; index++) {
    const t = index / steps;
    const angle = start + (end - start) * t;
    points.push({
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    });
  }
  return points;
}

export function sampleEllipsePoints(
  center: Point2D,
  majorAxis: Point2D,
  ratio: number,
  startParam = 0,
  endParam = TWO_PI,
  ccw = true,
  maxSegmentAngle = Math.PI / 36,
): Point2D[] {
  if (!isFinitePoint(center) || !isFinitePoint(majorAxis)) return [];
  const majorLength = Math.hypot(majorAxis.x, majorAxis.y);
  if (!Number.isFinite(majorLength) || majorLength <= 1e-9) return [];
  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  const minorAxis = {
    x: -majorAxis.y * safeRatio,
    y: majorAxis.x * safeRatio,
  };
  const start = Number.isFinite(startParam) ? startParam : 0;
  const end = normalizeSweepEnd(start, Number.isFinite(endParam) ? endParam : TWO_PI, ccw);
  const sweep = Math.abs(end - start);
  const steps = Math.max(24, Math.min(288, Math.ceil(sweep / maxSegmentAngle)));
  const points: Point2D[] = [];
  for (let index = 0; index <= steps; index++) {
    const t = start + (end - start) * (index / steps);
    points.push({
      x: center.x + majorAxis.x * Math.cos(t) + minorAxis.x * Math.sin(t),
      y: center.y + majorAxis.y * Math.cos(t) + minorAxis.y * Math.sin(t),
    });
  }
  return points;
}

const createOpenUniformKnots = (controlPointCount: number, degree: number): number[] => {
  const n = controlPointCount - 1;
  const knots: number[] = [];
  for (let i = 0; i <= degree; i++) knots.push(0);
  const interiorCount = n - degree;
  for (let i = 1; i <= interiorCount; i++) knots.push(i / (interiorCount + 1));
  for (let i = 0; i <= degree; i++) knots.push(1);
  return knots;
};

export function sampleSplinePoints(
  controlPoints: Point2D[],
  degree = 3,
  knots?: number[],
  weights?: number[],
  segments?: number,
): Point2D[] {
  const points = (controlPoints || []).filter(isFinitePoint);
  if (points.length === 0) return [];
  const safeDegree = Math.max(1, Math.min(Math.floor(degree || 3), points.length - 1));
  if (points.length < safeDegree + 1) return points;

  const n = points.length - 1;
  const p = safeDegree;
  const sampleCount = segments && segments > 0
    ? segments
    : Math.max(48, Math.min(256, points.length * 16));

  const knotVector = knots && knots.length >= n + p + 2
    ? knots
    : createOpenUniformKnots(points.length, p);

  const domainStart = knotVector[p];
  const domainEnd = knotVector[knotVector.length - 1 - p];
  if (!Number.isFinite(domainStart) || !Number.isFinite(domainEnd) || domainEnd <= domainStart) return points;

  const result: Point2D[] = [];
  for (let step = 0; step <= sampleCount; step++) {
    let t = domainStart + (domainEnd - domainStart) * (step / sampleCount);
    if (step === sampleCount) t = domainEnd - 1e-9;

    let span = -1;
    for (let i = p; i < knotVector.length - 1 - p; i++) {
      if (t >= knotVector[i] && t < knotVector[i + 1]) {
        span = i;
        break;
      }
    }
    if (span === -1) span = knotVector.length - p - 2;

    const work: { x: number; y: number; w: number }[] = [];
    for (let j = 0; j <= p; j++) {
      const index = span - p + j;
      const weight = weights && Number.isFinite(weights[index]) ? weights[index] : 1;
      work.push({ x: points[index].x * weight, y: points[index].y * weight, w: weight });
    }

    for (let r = 1; r <= p; r++) {
      for (let j = p; j >= r; j--) {
        const denominator = knotVector[span + 1 + j - r] - knotVector[span - p + j];
        const alpha = Math.abs(denominator) < 1e-12 ? 0 : (t - knotVector[span - p + j]) / denominator;
        const prev = work[j - 1];
        const curr = work[j];
        work[j] = {
          x: (1 - alpha) * prev.x + alpha * curr.x,
          y: (1 - alpha) * prev.y + alpha * curr.y,
          w: (1 - alpha) * prev.w + alpha * curr.w,
        };
      }
    }

    const weight = Math.abs(work[p].w) > 1e-12 ? work[p].w : 1;
    result.push({ x: work[p].x / weight, y: work[p].y / weight });
  }
  return result;
}

export function sampleHatchEdge(edge: HatchEdge): Point2D[] {
  if (edge.calculatedPoints && edge.calculatedPoints.length > 0) return edge.calculatedPoints.filter(isFinitePoint);
  if (edge.type === 'LINE') {
    const points: Point2D[] = [];
    if (isFinitePoint(edge.start)) points.push(edge.start);
    if (isFinitePoint(edge.end)) points.push(edge.end);
    return points;
  }
  if (edge.type === 'ARC' && edge.center && edge.radius) {
    return sampleArcPoints(
      edge.center,
      edge.radius,
      ((edge.startAngle || 0) * Math.PI) / 180,
      ((edge.endAngle || 0) * Math.PI) / 180,
      edge.ccw !== false,
    );
  }
  if (edge.type === 'ELLIPSE' && edge.center && edge.majorAxis) {
    return sampleEllipsePoints(
      edge.center,
      edge.majorAxis,
      edge.ratio || 1,
      edge.startAngle || 0,
      edge.endAngle ?? TWO_PI,
      edge.ccw !== false,
    );
  }
  if (edge.type === 'SPLINE') {
    const points = edge.controlPoints || [];
    return sampleSplinePoints(points, edge.degree || 3, edge.knots, edge.weights, 64);
  }
  return [];
}

export function sampleHatchLoop(loop: HatchLoop): Point2D[] {
  if (loop.isPolyline && loop.points && loop.points.length > 0) {
    const result: Point2D[] = [];
    const count = loop.points.length;
    const segmentCount = count > 1 ? count : 0;
    for (let i = 0; i < segmentCount; i++) {
      const p1 = loop.points[i];
      const p2 = loop.points[(i + 1) % count];
      const bulge = loop.bulges?.[i] || 0;
      const sampled = sampleBulgeSegment(p1, p2, bulge);
      if (i === 0) result.push(...sampled);
      else result.push(...sampled.slice(1));
    }
    return result;
  }

  const result: Point2D[] = [];
  (loop.edges || []).forEach((edge, index) => {
    const points = sampleHatchEdge(edge);
    if (points.length === 0) return;
    if (index === 0 || result.length === 0) result.push(...points);
    else result.push(...points.slice(1));
  });
  return result;
}
