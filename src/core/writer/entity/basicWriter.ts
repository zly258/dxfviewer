/**
 * 基础几何图元写出器。
 *
 * 覆盖：LINE, POINT, CIRCLE, ARC, ELLIPSE, LWPOLYLINE, POLYLINE, SPLINE, RAY, XLINE。
 * 支持 AC1015 (AutoCAD 2000) 与 AC1009 (R12 降级) 模式。
 */
import {
  DxfArc,
  DxfCircle,
  DxfEllipse,
  DxfLine,
  DxfPoint,
  DxfRay,
  DxfShape,
  DxfSpline,
  DxfXLine,
  Point2D,
} from '@/types';
import { WriterState } from '../writerState';
import { writeEntityCommon } from '../groupWriter';
import { applyOffsetToPoint } from '../offsets';

/**
 * LINE 直线
 */
export const writeLine = (state: WriterState, ent: DxfLine, ownerHandle: string): void => {
  writeEntityCommon(state, 'LINE', 'AcDbLine', ent, ownerHandle);
  const start = applyOffsetToPoint(ent.start, state.offset);
  const end = applyOffsetToPoint(ent.end, state.offset);
  state.writeGroup(10, start.x);
  state.writeGroup(20, start.y);
  state.writeGroup(30, 0);
  state.writeGroup(11, end.x);
  state.writeGroup(21, end.y);
  state.writeGroup(31, 0);
};

/**
 * POINT 点
 */
export const writePoint = (state: WriterState, ent: DxfPoint, ownerHandle: string): void => {
  writeEntityCommon(state, 'POINT', 'AcDbPoint', ent, ownerHandle);
  const pos = applyOffsetToPoint(ent.position, state.offset);
  state.writeGroup(10, pos.x);
  state.writeGroup(20, pos.y);
  state.writeGroup(30, 0);
};

/**
 * CIRCLE 圆
 */
export const writeCircle = (state: WriterState, ent: DxfCircle, ownerHandle: string): void => {
  writeEntityCommon(state, 'CIRCLE', 'AcDbCircle', ent, ownerHandle);
  const center = applyOffsetToPoint(ent.center, state.offset);
  state.writeGroup(10, center.x);
  state.writeGroup(20, center.y);
  state.writeGroup(30, 0);
  state.writeGroup(40, ent.radius);
};

/**
 * ARC 圆弧
 */
export const writeArc = (state: WriterState, ent: DxfArc, ownerHandle: string): void => {
  writeEntityCommon(state, 'ARC', 'AcDbCircle', ent, ownerHandle);
  state.writeSubclass('AcDbArc');
  const center = applyOffsetToPoint(ent.center, state.offset);
  state.writeGroup(10, center.x);
  state.writeGroup(20, center.y);
  state.writeGroup(30, 0);
  state.writeGroup(40, ent.radius);
  state.writeGroup(50, ent.startAngle);
  state.writeGroup(51, ent.endAngle);
};

/**
 * 多段线写出所需的最小结构。
 *
 * 允许 ELLIPSE / SPLINE / HATCH 在 R12 降级时复用同一套写出逻辑，
 * 而不必把源实体强转成 DxfPolyline（类型上并不重叠）。
 */
export interface PolylineWriteInput {
  id?: string;
  layer?: string;
  color?: number;
  trueColor?: number;
  lineType?: string;
  lineTypeScale?: number;
  lineweight?: number;
  transparency?: number;
  visible?: boolean;
  inPaperSpace?: boolean;
  points: Point2D[];
  bulges?: number[];
  closed?: boolean;
  constantWidth?: number;
}

/**
 * POLYLINE 顶点与结束符（R12 或 3D 传统多段线格式）
 */
export const writePolylineLegacy = (
  state: WriterState,
  ent: PolylineWriteInput,
  ownerHandle: string,
): void => {
  writeEntityCommon(state, 'POLYLINE', 'AcDb2dPolyline', ent, ownerHandle);
  state.writeGroup(66, 1); // 存在后续顶点
  state.writeGroup(70, ent.closed ? 1 : 0);
  state.writeGroup(10, 0);
  state.writeGroup(20, 0);
  state.writeGroup(30, 0);

  const points = ent.points || [];
  const bulges = ent.bulges || [];

  for (let i = 0; i < points.length; i++) {
    const pt = applyOffsetToPoint(points[i], state.offset);
    state.writeGroup(0, 'VERTEX');
    state.writeHandle();
    state.writeOwner(ownerHandle);
    state.writeSubclass('AcDbEntity');
    state.writeGroup(8, ent.layer || '0');
    state.writeSubclass('AcDbVertex');
    state.writeSubclass('AcDb2dVertex');
    state.writeGroup(10, pt.x);
    state.writeGroup(20, pt.y);
    state.writeGroup(30, 0);
    const b = bulges[i] || 0;
    if (b !== 0) {
      state.writeGroup(42, b);
    }
  }

  // SEQEND
  state.writeGroup(0, 'SEQEND');
  state.writeHandle();
  state.writeOwner(ownerHandle);
  state.writeSubclass('AcDbEntity');
  state.writeGroup(8, ent.layer || '0');
};

/**
 * LWPOLYLINE 轻量多段线（R12 模式下自动降级为 POLYLINE）
 */
export const writeLwPolyline = (state: WriterState, ent: PolylineWriteInput, ownerHandle: string): void => {
  if (state.isR12()) {
    writePolylineLegacy(state, ent, ownerHandle);
    return;
  }

  writeEntityCommon(state, 'LWPOLYLINE', 'AcDbPolyline', ent, ownerHandle);
  const points = ent.points || [];
  const bulges = ent.bulges || [];

  state.writeGroup(90, points.length);
  state.writeGroup(70, ent.closed ? 1 : 0);
  if (ent.constantWidth !== undefined && ent.constantWidth > 0) {
    state.writeGroup(43, ent.constantWidth);
  }

  for (let i = 0; i < points.length; i++) {
    const pt = applyOffsetToPoint(points[i], state.offset);
    state.writeGroup(10, pt.x);
    state.writeGroup(20, pt.y);
    const b = bulges[i] || 0;
    if (b !== 0) {
      state.writeGroup(42, b);
    }
  }
};

/**
 * ELLIPSE 椭圆 / 椭圆弧（R12 下离散化降级）
 */
export const writeEllipse = (state: WriterState, ent: DxfEllipse, ownerHandle: string): void => {
  if (state.isR12()) {
    state.addSkipped('ELLIPSE', 'R12 (AC1009) 不支持 ELLIPSE 实体，已离散化为 POLYLINE', ent.id);
    const sampled = sampleEllipseToPoints(ent, 32);
    writePolylineLegacy(state, {
      id: ent.id,
      layer: ent.layer,
      color: ent.color,
      trueColor: ent.trueColor,
      lineType: ent.lineType,
      lineTypeScale: ent.lineTypeScale,
      lineweight: ent.lineweight,
      transparency: ent.transparency,
      visible: ent.visible,
      inPaperSpace: ent.inPaperSpace,
      points: sampled,
      closed: Math.abs(ent.endParam - ent.startParam) >= Math.PI * 2 - 1e-4,
    }, ownerHandle);
    return;
  }

  writeEntityCommon(state, 'ELLIPSE', 'AcDbEllipse', ent, ownerHandle);
  const center = applyOffsetToPoint(ent.center, state.offset);
  state.writeGroup(10, center.x);
  state.writeGroup(20, center.y);
  state.writeGroup(30, 0);
  state.writeGroup(11, ent.majorAxis.x);
  state.writeGroup(21, ent.majorAxis.y);
  state.writeGroup(31, 0);
  state.writeGroup(40, ent.ratio);
  state.writeGroup(41, ent.startParam);
  state.writeGroup(42, ent.endParam);
};

const sampleEllipseToPoints = (ent: DxfEllipse, segments: number): Point2D[] => {
  const points: Point2D[] = [];
  const start = ent.startParam || 0;
  let end = ent.endParam ?? Math.PI * 2;
  if (end <= start) end += Math.PI * 2;
  const step = (end - start) / segments;
  const majorLen = Math.hypot(ent.majorAxis.x, ent.majorAxis.y);
  const angle = Math.atan2(ent.majorAxis.y, ent.majorAxis.x);
  const a = majorLen;
  const b = majorLen * ent.ratio;

  for (let i = 0; i <= segments; i++) {
    const t = start + i * step;
    const lx = a * Math.cos(t);
    const ly = b * Math.sin(t);
    const rx = lx * Math.cos(angle) - ly * Math.sin(angle);
    const ry = lx * Math.sin(angle) + ly * Math.cos(angle);
    points.push({ x: ent.center.x + rx, y: ent.center.y + ry });
  }
  return points;
};

/**
 * SPLINE 样条曲线（R12 下离散化降级）
 */
export const writeSpline = (state: WriterState, ent: DxfSpline, ownerHandle: string): void => {
  if (state.isR12()) {
    state.addSkipped('SPLINE', 'R12 (AC1009) 不支持 SPLINE 实体，已离散化为 POLYLINE', ent.id);
    const sampled = ent.calculatedPoints || ent.controlPoints || [];
    writePolylineLegacy(state, {
      id: ent.id,
      layer: ent.layer,
      color: ent.color,
      trueColor: ent.trueColor,
      lineType: ent.lineType,
      lineTypeScale: ent.lineTypeScale,
      lineweight: ent.lineweight,
      transparency: ent.transparency,
      visible: ent.visible,
      inPaperSpace: ent.inPaperSpace,
      points: sampled,
      closed: false,
    }, ownerHandle);
    return;
  }

  writeEntityCommon(state, 'SPLINE', 'AcDbSpline', ent, ownerHandle);
  const controlPoints = ent.controlPoints || [];
  const knots = ent.knots || [];
  const weights = ent.weights || [];
  const fitPoints = ent.fitPoints || [];

  let flags = ent.flags ?? 8;
  if (weights.length > 0) flags |= 4; // rational

  state.writeGroup(70, flags);
  state.writeGroup(71, ent.degree ?? 3);
  state.writeGroup(72, knots.length);
  state.writeGroup(73, controlPoints.length);
  state.writeGroup(74, fitPoints.length);

  for (const k of knots) {
    state.writeGroup(40, k);
  }
  for (const w of weights) {
    state.writeGroup(41, w);
  }
  for (const cp of controlPoints) {
    const pt = applyOffsetToPoint(cp, state.offset);
    state.writeGroup(10, pt.x);
    state.writeGroup(20, pt.y);
    state.writeGroup(30, 0);
  }
  for (const fp of fitPoints) {
    const pt = applyOffsetToPoint(fp, state.offset);
    state.writeGroup(11, pt.x);
    state.writeGroup(21, pt.y);
    state.writeGroup(31, 0);
  }
};

/**
 * RAY / XLINE 射线与构造线
 */
export const writeRayXLine = (
  state: WriterState,
  ent: DxfRay | DxfXLine,
  ownerHandle: string,
): void => {
  if (state.isR12()) {
    state.addSkipped(ent.type, `R12 (AC1009) 不支持 ${ent.type} 实体`, ent.id);
    return;
  }

  const isRay = ent.type === 'RAY';
  writeEntityCommon(state, isRay ? 'RAY' : 'XLINE', isRay ? 'AcDbRay' : 'AcDbXline', ent, ownerHandle);
  const base = applyOffsetToPoint(ent.basePoint, state.offset);
  state.writeGroup(10, base.x);
  state.writeGroup(20, base.y);
  state.writeGroup(30, 0);
  // 方向向量不受平移影响
  state.writeGroup(11, ent.direction.x);
  state.writeGroup(21, ent.direction.y);
  state.writeGroup(31, 0);
};

/**
 * SHAPE 形引用（遗留实体：R2000 下无 100 子类标记）。
 * 与解析器（geometryEntityParser.parseShape）捕获的组码对称：
 * 2 名称、10/20/30 插入点、40 大小、41 X 比例、50 旋转、51 斜切。
 */
export const writeShape = (
  state: WriterState,
  ent: DxfShape,
  ownerHandle: string,
): void => {
  writeEntityCommon(state, 'SHAPE', '', ent, ownerHandle);
  state.writeGroup(2, ent.name);
  const position = applyOffsetToPoint(ent.position, state.offset);
  state.writeGroup(10, position.x);
  state.writeGroup(20, position.y);
  state.writeGroup(30, 0);
  state.writeGroup(40, ent.size ?? 1);
  state.writeGroup(41, ent.xScale ?? 1);
  state.writeGroup(50, ent.rotation ?? 0);
  state.writeGroup(51, ent.oblique ?? 0);
};
