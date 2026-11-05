/**
 * 填充与面图元写出器（SOLID / 3DFACE / HATCH）。
 *
 * 包含 SOLID 蝴蝶结顶点顺序还原、HATCH 边界环与多段线路径输出及 R12 降级。
 */
import {
  Dxf3DFace,
  DxfHatch,
  DxfSolid,
  Point2D,
} from '@/types';
import { WriterState } from '../writerState';
import { writeEntityCommon } from '../groupWriter';
import { applyOffsetToPoint, applyOffsetToX, applyOffsetToY } from '../offsets';
import { writePolylineLegacy } from './basicWriter';
import { getHatchPattern } from '../patterns';

/**
 * SOLID 二维实心填充
 */
export const writeSolid = (state: WriterState, ent: DxfSolid, ownerHandle: string): void => {
  writeEntityCommon(state, 'SOLID', 'AcDbTrace', ent, ownerHandle);
  const pts = ent.points || [];
  if (pts.length < 3) return;

  // 解析器读取时将 [0, 1, 3, 2] 存为显示顺序；写出时需还原为 DXF 原始的蝴蝶结顶点顺序
  const p0 = applyOffsetToPoint(pts[0], state.offset);
  const p1 = applyOffsetToPoint(pts[1], state.offset);
  const p2 = applyOffsetToPoint(pts[3] || pts[2], state.offset);
  const p3 = applyOffsetToPoint(pts[2], state.offset);

  state.writeGroup(10, p0.x);
  state.writeGroup(20, p0.y);
  state.writeGroup(30, 0);

  state.writeGroup(11, p1.x);
  state.writeGroup(21, p1.y);
  state.writeGroup(31, 0);

  state.writeGroup(12, p2.x);
  state.writeGroup(22, p2.y);
  state.writeGroup(32, 0);

  state.writeGroup(13, p3.x);
  state.writeGroup(23, p3.y);
  state.writeGroup(33, 0);
};

/**
 * 3DFACE 三维面
 */
export const write3DFace = (state: WriterState, ent: Dxf3DFace, ownerHandle: string): void => {
  writeEntityCommon(state, '3DFACE', 'AcDbFace', ent, ownerHandle);
  const pts = ent.points || [];
  if (pts.length < 3) return;

  const p0 = applyOffsetToPoint(pts[0], state.offset);
  const p1 = applyOffsetToPoint(pts[1], state.offset);
  const p2 = applyOffsetToPoint(pts[2], state.offset);
  const p3 = applyOffsetToPoint(pts[3] || pts[2], state.offset);

  state.writeGroup(10, p0.x);
  state.writeGroup(20, p0.y);
  state.writeGroup(30, (pts[0] as any).z || 0);

  state.writeGroup(11, p1.x);
  state.writeGroup(21, p1.y);
  state.writeGroup(31, (pts[1] as any).z || 0);

  state.writeGroup(12, p2.x);
  state.writeGroup(22, p2.y);
  state.writeGroup(32, (pts[2] as any).z || 0);

  state.writeGroup(13, p3.x);
  state.writeGroup(23, p3.y);
  state.writeGroup(33, (pts[3] as any)?.z || 0);

  if (ent.edgeFlags !== undefined) {
    state.writeGroup(70, ent.edgeFlags);
  }
};

/**
 * HATCH 图案 / 实心填充（R12 模式下自动降级为边界 POLYLINE 轮廓线）
 */
export const writeHatch = (state: WriterState, ent: DxfHatch, ownerHandle: string): void => {
  const loops = ent.loops || [];

  if (state.isR12()) {
    state.addSkipped('HATCH', 'R12 (AC1009) 不支持 HATCH 实体，已降级为边界轮廓多段线', ent.id);
    loops.forEach((loop, idx) => {
      let points: Point2D[] = [];
      let bulges: number[] = [];
      if (loop.isPolyline && loop.points) {
        points = loop.points;
        bulges = loop.bulges || [];
      } else if (loop.edges) {
        loop.edges.forEach(edge => {
          if (edge.start) points.push(edge.start);
        });
      }
      if (points.length >= 2) {
        writePolylineLegacy(state, {
          id: `${ent.id || 'hatch'}_loop_${idx}`,
          layer: ent.layer,
          color: ent.color,
          trueColor: ent.trueColor,
          lineType: ent.lineType,
          lineTypeScale: ent.lineTypeScale,
          lineweight: ent.lineweight,
          transparency: ent.transparency,
          visible: ent.visible,
          inPaperSpace: ent.inPaperSpace,
          points,
          bulges,
          closed: true,
        }, ownerHandle);
      }
    });
    return;
  }

  writeEntityCommon(state, 'HATCH', 'AcDbHatch', ent, ownerHandle);

  state.writeGroup(10, 0);
  state.writeGroup(20, 0);
  state.writeGroup(30, 0);
  state.writeGroup(210, 0);
  state.writeGroup(220, 0);
  state.writeGroup(230, 1);

  state.writeGroup(2, ent.patternName || 'SOLID');
  state.writeGroup(70, ent.solid ? 1 : 0);
  state.writeGroup(71, 0); // 非关联
  state.writeGroup(91, loops.length);

  for (const loop of loops) {
    if (loop.isPolyline || (loop.points && loop.points.length > 0)) {
      const pts = loop.points || [];
      const bulges = loop.bulges || [];
      const hasBulge = bulges.some(b => b !== 0);

      state.writeGroup(92, loop.type || 2);
      state.writeGroup(72, hasBulge ? 1 : 0);
      state.writeGroup(73, 1); // 闭合环
      state.writeGroup(93, pts.length);

      for (let i = 0; i < pts.length; i++) {
        state.writeGroup(10, applyOffsetToX(pts[i].x, state.offset));
        state.writeGroup(20, applyOffsetToY(pts[i].y, state.offset));
        const b = bulges[i] || 0;
        if (hasBulge) {
          state.writeGroup(42, b);
        }
      }
      state.writeGroup(97, 0); // 边界源对象数
    } else {
      const edges = loop.edges || [];
      state.writeGroup(92, loop.type || 1);
      state.writeGroup(93, edges.length);

      for (const edge of edges) {
        if (edge.type === 'LINE' && edge.start && edge.end) {
          state.writeGroup(72, 1);
          state.writeGroup(10, applyOffsetToX(edge.start.x, state.offset));
          state.writeGroup(20, applyOffsetToY(edge.start.y, state.offset));
          state.writeGroup(11, applyOffsetToX(edge.end.x, state.offset));
          state.writeGroup(21, applyOffsetToY(edge.end.y, state.offset));
        } else if (edge.type === 'ARC' && edge.center && edge.radius !== undefined) {
          state.writeGroup(72, 2);
          state.writeGroup(10, applyOffsetToX(edge.center.x, state.offset));
          state.writeGroup(20, applyOffsetToY(edge.center.y, state.offset));
          state.writeGroup(40, edge.radius);
          state.writeGroup(50, edge.startAngle ?? 0);
          state.writeGroup(51, edge.endAngle ?? 360);
          state.writeGroup(73, edge.ccw !== false ? 1 : 0);
        } else if (edge.type === 'ELLIPSE' && edge.center && edge.majorAxis) {
          state.writeGroup(72, 3);
          state.writeGroup(10, applyOffsetToX(edge.center.x, state.offset));
          state.writeGroup(20, applyOffsetToY(edge.center.y, state.offset));
          state.writeGroup(11, edge.majorAxis.x);
          state.writeGroup(21, edge.majorAxis.y);
          state.writeGroup(40, edge.ratio ?? 1);
          const sDeg = (edge.startAngle ?? 0) * 180 / Math.PI;
          const eDeg = (edge.endAngle ?? (Math.PI * 2)) * 180 / Math.PI;
          state.writeGroup(50, sDeg);
          state.writeGroup(51, eDeg);
          state.writeGroup(73, edge.ccw !== false ? 1 : 0);
        } else if (edge.type === 'SPLINE' && edge.controlPoints) {
          state.writeGroup(72, 4);
          const weights = edge.weights || [];
          const knots = edge.knots || [];
          state.writeGroup(73, weights.length > 0 ? 1 : 0);
          state.writeGroup(74, edge.degree ?? 3);
          state.writeGroup(95, knots.length);
          state.writeGroup(96, edge.controlPoints.length);
          for (const k of knots) state.writeGroup(40, k);
          for (let i = 0; i < edge.controlPoints.length; i++) {
            const cp = edge.controlPoints[i];
            state.writeGroup(10, applyOffsetToX(cp.x, state.offset));
            state.writeGroup(20, applyOffsetToY(cp.y, state.offset));
            if (weights.length > 0) {
              state.writeGroup(42, weights[i] ?? 1);
            }
          }
        }
      }
      state.writeGroup(97, 0); // 边界源对象数
    }
  }

  state.writeGroup(75, 1); // 普通填充风格
  state.writeGroup(76, 1); // 预定义图案

  if (!ent.solid) {
    state.writeGroup(52, ent.angle || 0);
    state.writeGroup(41, ent.scale || 1);
    state.writeGroup(77, 0); // 不双向

    // 图案定义线：内置库按名称匹配；未命中时写 78=0，
    // 预定义图案名 CAD 仍会按内部图案库解析（自定义名会得到空填充，需报告）。
    const pattern = getHatchPattern(ent.patternName || '');
    if (pattern) {
      state.writeGroup(78, pattern.length);
      for (const line of pattern) {
        state.writeGroup(53, line.angleDeg);
        state.writeGroup(43, line.baseX);
        state.writeGroup(44, line.baseY);
        state.writeGroup(45, line.offsetX);
        state.writeGroup(46, line.offsetY);
        state.writeGroup(79, line.dashes.length);
        for (const dash of line.dashes) {
          state.writeGroup(49, dash);
        }
      }
    } else {
      state.writeGroup(78, 0);
      state.addSkipped(
        'HATCH',
        `未内置图案定义 "${ent.patternName}"，已写出 0 条图案线（预定义名 CAD 可自行解析，自定义名将无填充）`,
        ent.id,
      );
    }
  }

  state.writeGroup(98, 0); // 0 个种子点
};
