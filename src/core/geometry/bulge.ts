import { Point2D } from '@/types';

export interface BulgeArcGeometry {
  center: Point2D;
  radius: number;
  startAngle: number;
  endAngle: number;
  ccw: boolean;
  sweep: number;
}

const TWO_PI = Math.PI * 2;
const normalizeAngle = (value: number): number => {
  let angle = value % TWO_PI;
  if (angle < 0) angle += TWO_PI;
  return angle;
};

export function getBulgeArcGeometry(p1: Point2D, p2: Point2D, bulge: number): BulgeArcGeometry | null {
  if (!Number.isFinite(bulge) || Math.abs(bulge) < 1e-9) return null;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const chord = Math.hypot(dx, dy);
  if (!Number.isFinite(chord) || chord < 1e-9) return null;

  const theta = 4 * Math.atan(bulge);
  const sinHalf = Math.sin(theta / 2);
  if (Math.abs(sinHalf) < 1e-9) return null;

  const radius = Math.abs(chord / (2 * sinHalf));
  const midX = (p1.x + p2.x) / 2;
  const midY = (p1.y + p2.y) / 2;
  const nx = -dy / chord;
  const ny = dx / chord;
  const centerOffset = chord * (1 - bulge * bulge) / (4 * bulge);
  const center = {
    x: midX + nx * centerOffset,
    y: midY + ny * centerOffset,
  };
  const startAngle = Math.atan2(p1.y - center.y, p1.x - center.x);
  const endAngle = Math.atan2(p2.y - center.y, p2.x - center.x);
  const ccw = bulge > 0;
  const sweep = Math.abs(theta);

  return { center, radius, startAngle, endAngle, ccw, sweep };
}

export function sampleBulgeSegment(p1: Point2D, p2: Point2D, bulge: number, maxSegmentAngle = Math.PI / 18): Point2D[] {
  const arc = getBulgeArcGeometry(p1, p2, bulge);
  if (!arc) return [p1, p2];

  const steps = Math.max(2, Math.min(96, Math.ceil(arc.sweep / maxSegmentAngle)));
  const start = normalizeAngle(arc.startAngle);
  let end = normalizeAngle(arc.endAngle);
  if (arc.ccw && end <= start) end += TWO_PI;
  if (!arc.ccw && end >= start) end -= TWO_PI;

  const points: Point2D[] = [];
  for (let index = 0; index <= steps; index++) {
    const t = index / steps;
    const angle = start + (end - start) * t;
    points.push({
      x: arc.center.x + arc.radius * Math.cos(angle),
      y: arc.center.y + arc.radius * Math.sin(angle),
    });
  }
  return points;
}
