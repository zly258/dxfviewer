/**
 * DXF 实体 → Three.js 几何转换。
 *
 * 把全部已解析的 DXF 图元转成三类「三角面汤 / 线段汤 / 点汤」世界坐标数组，
 * 供 Three 引擎合并成少量 BufferGeometry 绘制：
 * - 线段（LineSegments）：LINE/ARC/CIRCLE/ELLIPSE/SPLINE/POLYLINE/LEADER/RAY/XLINE…
 * - 三角面（Mesh）：SOLID/3DFACE/HATCH/WIPEOUT（3DFACE 使用真实 z，支持三维）
 * - 点（Points）：POINT
 *
 * 文字（TEXT/MTEXT/ATTRIB/ATTDEF）不在此绘制——与 WebGL 老引擎一致，
 * 由独立的 Canvas 2D 文字覆盖层渲染，保证与 Canvas 引擎文字完全同源。
 */
import earcut from 'earcut';
import type { AnyEntity, CanvasTheme, DrawingColorMode, DxfBlock, DxfDimension, DxfHatch, DxfInsert, DxfLayer, Point2D, Point3D } from '@/types';
import { EntityType } from '@/types';
import { resolveEntityColor } from '@/utils/entityColor';
import { createBlockPointTransform, isDimensionBlockLocal } from '@/core/geometry/transform';
import {
  sampleArcPoints,
  sampleEllipsePoints,
  sampleSplinePoints,
  sampleHatchLoop,
} from '@/core/geometry/curveSampling';

const TWO_PI = Math.PI * 2;

export interface ThreeGeometryData {
  linePos: number[]; lineCol: number[];
  triPos: number[]; triCol: number[];
  ptPos: number[]; ptCol: number[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface BuildThreeGeometryOptions {
  entities: AnyEntity[];
  blocks: Record<string, DxfBlock>;
  layers: Record<string, DxfLayer>;
  theme: CanvasTheme;
  drawingColorMode: DrawingColorMode;
  hiddenLayers?: Set<string>;
  hiddenEntityIds?: ReadonlySet<string>;
  isolatedEntityIds?: ReadonlySet<string> | null;
}

const hexToRgb = (hex: string): [number, number, number] => {
  let h = hex.trim();
  if (h.startsWith('#')) h = h.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h || 'ffffff', 16);
  if (!Number.isFinite(n)) return [1, 1, 1];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

const zOf = (p: Point2D | undefined): number =>
  p && Number.isFinite((p as Point3D).z) ? (p as Point3D).z : 0;

export const buildThreeGeometry = (opts: BuildThreeGeometryOptions): ThreeGeometryData => {
  const { entities, blocks, layers, theme, drawingColorMode, hiddenLayers, hiddenEntityIds, isolatedEntityIds } = opts;

  const data: ThreeGeometryData = {
    linePos: [], lineCol: [],
    triPos: [], triCol: [],
    ptPos: [], ptCol: [],
    bounds: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  };

  const updateBounds = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < data.bounds.minX) data.bounds.minX = x;
    if (x > data.bounds.maxX) data.bounds.maxX = x;
    if (y < data.bounds.minY) data.bounds.minY = y;
    if (y > data.bounds.maxY) data.bounds.maxY = y;
  };

  const pushVertexColor = (col: [number, number, number], colArr: number[]) => {
    colArr.push(col[0], col[1], col[2]);
  };

  const sanitize = (...vals: number[]): boolean => {
    for (const v of vals) if (!Number.isFinite(v) || Math.abs(v) > 1e8) return false;
    return true;
  };

  const addSegment = (a: Point2D, b: Point2D, col: [number, number, number], xf: (p: Point2D) => Point2D) => {
    const pa = xf(a); const pb = xf(b);
    const za = zOf(a); const zb = zOf(b);
    if (!sanitize(pa.x, pa.y, pb.x, pb.y)) return;
    data.linePos.push(pa.x, pa.y, za, pb.x, pb.y, zb);
    pushVertexColor(col, data.lineCol);
    pushVertexColor(col, data.lineCol);
    updateBounds(pa.x, pa.y); updateBounds(pb.x, pb.y);
  };

  const addPolyline = (pts: Point2D[], closed: boolean, col: [number, number, number], xf: (p: Point2D) => Point2D) => {
    if (!pts || pts.length < 2) return;
    const list = closed ? [...pts, pts[0]] : pts;
    for (let i = 0; i + 1 < list.length; i++) addSegment(list[i], list[i + 1], col, xf);
  };

  const addTriangle = (a: Point2D, b: Point2D, c: Point2D, col: [number, number, number], xf: (p: Point2D) => Point2D) => {
    const pa = xf(a), pb = xf(b), pc = xf(c);
    if (!sanitize(pa.x, pa.y, pb.x, pb.y, pc.x, pc.y)) return;
    data.triPos.push(pa.x, pa.y, zOf(a), pb.x, pb.y, zOf(b), pc.x, pc.y, zOf(c));
    for (let k = 0; k < 3; k++) pushVertexColor(col, data.triCol);
    updateBounds(pa.x, pa.y); updateBounds(pb.x, pb.y); updateBounds(pc.x, pc.y);
  };

  const addPolygonFill = (rings: Point2D[][], col: [number, number, number], xf: (p: Point2D) => Point2D) => {
    if (!rings.length) return;
    // 以最外环为外边界，其余环作为孔洞（简单偶奇挖空）。
    const flat: number[] = [];
    const holeIndices: number[] = [];
    let outer = rings[0];
    let outerArea = Math.abs(ringArea(outer));
    for (const r of rings) {
      const area = Math.abs(ringArea(r));
      if (area > outerArea) { outerArea = area; outer = r; }
    }
    const order = [outer, ...rings.filter(r => r !== outer)];
    order.forEach((ring, idx) => {
      if (ring.length < 3) return;
      if (idx === 0) {
        holeIndices.length = 0;
      } else {
        holeIndices.push(flat.length / 2);
      }
      for (const p of ring) { const q = xf(p); flat.push(q.x, q.y); updateBounds(q.x, q.y); }
    });
    const tris = earcut(flat, holeIndices, 2);
    const get = (vi: number): Point2D => ({ x: flat[vi * 2], y: flat[vi * 2 + 1] });
    for (let i = 0; i + 2 < tris.length; i += 3) {
      const a = get(tris[i]), b = get(tris[i + 1]), c = get(tris[i + 2]);
      data.triPos.push(a.x, a.y, 0, b.x, b.y, 0, c.x, c.y, 0);
      for (let k = 0; k < 3; k++) pushVertexColor(col, data.triCol);
    }
  };

  const ringArea = (ring: Point2D[]): number => {
    let s = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      s += (ring[j].x * ring[i].y - ring[i].x * ring[j].y);
    }
    return s / 2;
  };

  const identity = (p: Point2D): Point2D => p;
  const blockStack: string[] = [];

  const emit = (ent: AnyEntity, xf: (p: Point2D) => Point2D, color: string, parentLayerName: string | undefined, depth: number): void => {
    if (depth > 12) return;
    const skip = (globalThis as { __DXF_SKIP_TYPES?: Set<string> }).__DXF_SKIP_TYPES;
    if (skip && skip.has(ent.type)) return;
    if (ent.visible === false) return;
    const layerName = (ent.layer === '0' && parentLayerName) ? parentLayerName : ent.layer;
    if (hiddenLayers && hiddenLayers.has(layerName)) return;
    const layer = layers[layerName];
    if (layer && layer.isVisible === false) return;

    const col = hexToRgb(color);

    switch (ent.type) {
      case EntityType.LINE:
        addSegment(ent.start, ent.end, col, xf);
        break;
      case EntityType.RAY: {
        const L = 1e7;
        addSegment(ent.basePoint, { x: ent.basePoint.x + ent.direction.x * L, y: ent.basePoint.y + ent.direction.y * L }, col, xf);
        break;
      }
      case EntityType.XLINE: {
        const L = 1e7;
        addSegment(
          { x: ent.basePoint.x - ent.direction.x * L, y: ent.basePoint.y - ent.direction.y * L },
          { x: ent.basePoint.x + ent.direction.x * L, y: ent.basePoint.y + ent.direction.y * L },
          col, xf,
        );
        break;
      }
      case EntityType.POINT: {
        const p = xf(ent.position);
        data.ptPos.push(p.x, p.y, zOf(ent.position));
        pushVertexColor(col, data.ptCol);
        updateBounds(p.x, p.y);
        break;
      }
      case EntityType.CIRCLE: {
        const pts = sampleArcPoints(ent.center, ent.radius, 0, TWO_PI, true);
        addPolyline(pts, true, col, xf);
        break;
      }
      case EntityType.ARC: {
        // DXF 组码 50/51 以「度」存储；sampleArcPoints 需要弧度。
        const a0 = (ent.startAngle || 0) * Math.PI / 180;
        let a1 = (ent.endAngle || 0) * Math.PI / 180;
        if (a1 <= a0) a1 += TWO_PI;
        const pts = sampleArcPoints(ent.center, ent.radius, a0, a1, true);
        addPolyline(pts, false, col, xf);
        break;
      }
      case EntityType.ELLIPSE: {
        const pts = sampleEllipsePoints(ent.center, ent.majorAxis, ent.ratio, ent.startParam, ent.endParam, true);
        addPolyline(pts, false, col, xf);
        break;
      }
      case EntityType.LWPOLYLINE:
      case EntityType.POLYLINE:
        addPolyline(ent.points, ent.closed, col, xf);
        break;
      case EntityType.MLINE:
        addPolyline(ent.vertices, !!ent.closed, col, xf);
        break;
      case EntityType.SPLINE: {
        const pts = (ent.calculatedPoints && ent.calculatedPoints.length >= 2)
          ? ent.calculatedPoints
          : sampleSplinePoints(ent.controlPoints, ent.degree ?? 3, ent.knots, ent.weights);
        addPolyline(pts, false, col, xf);
        break;
      }
      case EntityType.SOLID:
      case EntityType.THREEDFACE: {
        const p = ent.points;
        if (p && p.length >= 3) {
          addTriangle(p[0], p[1], p[2], col, xf);
          if (p.length >= 4) addTriangle(p[0], p[2], p[3], col, xf);
        }
        break;
      }
      case EntityType.HATCH: {
        const hatch = ent as DxfHatch;
        const rings: Point2D[][] = [];
        for (const loop of hatch.loops || []) {
          const ring = sampleHatchLoop(loop);
          if (ring.length >= 3) rings.push(ring);
        }
        // 只填充实心区域；不再把每个环当作闭合折线描边——
        // 采样环在个别图纸里存在跨环跳点，描边会画出横穿全图的斜线。
        if (rings.length) addPolygonFill(rings, col, xf);
        break;
      }
      case EntityType.WIPEOUT: {
        const pts = (ent as { points?: Point2D[] }).points;
        if (pts && pts.length >= 3) {
          const bg: [number, number, number] = hexToRgb(theme === 'black' ? '#212121' : '#FFFFFF');
          addPolygonFill([pts], bg, xf);
        }
        break;
      }
      case EntityType.LEADER:
        addPolyline(ent.points, false, col, xf);
        break;
      case EntityType.MLEADER: {
        if (ent.leaderLines) for (const line of ent.leaderLines) addPolyline(line, false, col, xf);
        if (ent.doglegVector && ent.textPosition) {
          addSegment(ent.textPosition, { x: ent.textPosition.x + ent.doglegVector.x, y: ent.textPosition.y + ent.doglegVector.y }, col, xf);
        }
        break;
      }
      case EntityType.INSERT: {
        const ins = ent as DxfInsert;
        const block = blocks[ins.blockName];
        if (!block || blockStack.includes(ins.blockName)) break;
        const childXf = (p: Point2D) => xf(createBlockPointTransform(block, ins.position, ins.scale || { x: 1, y: 1, z: 1 }, ins.rotation || 0)(p));
        blockStack.push(ins.blockName);
        for (const child of block.entities) {
          if (child.type === EntityType.ATTDEF) continue;
          if (hiddenEntityIds && hiddenEntityIds.has(child.id)) continue;
          const childColor = resolveEntityColor(child, layers[child.layer], color, drawingColorMode, theme);
          emit(child, childXf, childColor, layerName, depth + 1);
        }
        blockStack.pop();
        break;
      }
      case EntityType.DIMENSION: {
        const dim = ent as DxfDimension;
        const block = blocks[dim.blockName];
        if (!block || blockStack.includes(dim.blockName)) break;
        const local = isDimensionBlockLocal(block, dim.definitionPoint, 5);
        const baseXf = local
          ? createBlockPointTransform(block, dim.definitionPoint, { x: 1, y: 1, z: 1 }, 0)
          : identity;
        const childXf = (p: Point2D) => xf(baseXf(p));
        blockStack.push(dim.blockName);
        for (const child of block.entities) {
          if (hiddenEntityIds && hiddenEntityIds.has(child.id)) continue;
          const childColor = resolveEntityColor(child, layers[child.layer], color, drawingColorMode, theme);
          emit(child, childXf, childColor, layerName, depth + 1);
        }
        blockStack.pop();
        break;
      }
      case EntityType.ACAD_TABLE: {
        const block = blocks[(ent as { blockName?: string }).blockName || ''];
        if (!block) break;
        const childXf = (p: Point2D) => xf(createBlockPointTransform(block, (ent as { position: Point2D }).position, (ent as { scale?: { x: number; y: number; z: number } }).scale || { x: 1, y: 1, z: 1 }, (ent as { rotation?: number }).rotation || 0)(p));
        for (const child of block.entities) {
          if (hiddenEntityIds && hiddenEntityIds.has(child.id)) continue;
          const childColor = resolveEntityColor(child, layers[child.layer], color, drawingColorMode, theme);
          emit(child, childXf, childColor, layerName, depth + 1);
        }
        break;
      }
      case EntityType.VIEWPORT: {
        const vp = ent as { center: Point2D; width: number; height: number };
        const hw = Math.abs(vp.width) / 2, hh = Math.abs(vp.height) / 2;
        const pts: Point2D[] = [
          { x: vp.center.x - hw, y: vp.center.y - hh },
          { x: vp.center.x + hw, y: vp.center.y - hh },
          { x: vp.center.x + hw, y: vp.center.y + hh },
          { x: vp.center.x - hw, y: vp.center.y + hh },
        ];
        addPolyline(pts, true, col, xf);
        break;
      }
      // 文字类：由 Canvas 文字层绘制
      case EntityType.TEXT:
      case EntityType.MTEXT:
      case EntityType.ATTRIB:
      case EntityType.ATTDEF:
      // 无几何数据的实体：暂不绘制
      case EntityType.SHAPE:
      case EntityType.IMAGE:
      case EntityType.REGION:
      case EntityType.SOLID3D:
      case EntityType.BODY:
      case EntityType.SURFACE:
      case EntityType.HELIX:
      case EntityType.TOLERANCE:
        break;
      default:
        break;
    }
  };

  for (const ent of entities) {
    if (hiddenEntityIds && hiddenEntityIds.has(ent.id)) continue;
    if (isolatedEntityIds && !isolatedEntityIds.has(ent.id)) continue;
    const layer = layers[ent.layer];
    const color = resolveEntityColor(ent, layer, undefined, drawingColorMode, theme);
    emit(ent as AnyEntity, identity, color, undefined, 0);
  }

  if (!Number.isFinite(data.bounds.minX)) {
    data.bounds = { minX: -100, minY: -100, maxX: 100, maxY: 100 };
  }
  return data;
};

export { hexToRgb };

