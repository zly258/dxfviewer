/**
 * 世界坐标 Path2D 缓存：把简单几何（LINE/LWPOLYLINE/POLYLINE/CIRCLE/ARC）
 * 按「颜色|虚线|线宽」样式组预先构建为 Path2D（世界坐标），渲染时每样式组
 * 只需一次 stroke——消除逐实体的 beginPath/moveTo/lineTo/stroke 调用
 * （88k 实体 ≈ 15 万次 canvas 调用 → 66 次）。
 *
 * 关键语义：
 * - Path2D 存世界坐标；渲染时 ctx.setTransform(视口矩阵) 后 stroke，
 *   线宽用 lineWidth / zoom 换算（变换会缩放线宽）。
 * - 虚线节距在世界坐标系下定义（与 CAD 语义一致），无需求像素换算。
 * - 缓存键含图层可见性无关因素之外的全部样式因素；实体级可见性在
 *   构建期跳过，图层显隐变化时整缓存重建（重建 ~150ms，可接受；
   *   后续可拆分层级增量重建）。
 *
 * 不参与缓存的实体（文字/标注/INSERT/填充/引线等）仍走逐实体绘制路径。
 */
import { AnyEntity, EntityType, Point2D, DxfLayer, DxfLineType, DrawingColorMode, CanvasTheme } from '@/types';
import { resolveEntityColor } from '@/utils/entityColor';
import { resolveCadStrokeStyle } from '@/utils/lineStyle';
import { sampleBulgeSegment } from '@/core/geometry/bulge';

export interface PathCacheStyleInput {
  entity: AnyEntity;
  layer: DxfLayer | undefined;
  lineTypes: Record<string, DxfLineType>;
  globalLineTypeScale: number;
  drawingColorMode: DrawingColorMode;
  theme: CanvasTheme;
}

export interface PathCacheGroup {
  /** 样式键：颜色|虚线签名|线宽(px) */
  readonly key: string;
  readonly color: string;
  /** 虚线节距（世界单位，空=实线；渲染时 × zoom 转像素） */
  readonly dashPattern: number[];
  /** 线宽（屏幕像素语义；渲染时 lineWidth = px / zoom 配合世界变换） */
  readonly lineWidthPx: number;
  readonly path: Path2D;
}

export interface PathCache {
  readonly groups: PathCacheGroup[];
  /** 覆盖的实体 id 集合（渲染时跳过这些实体，其余走逐实体路径） */
  readonly coveredIds: Set<string>;
  readonly stats: { entities: number; groups: number; builtMs: number };
}

interface GroupAcc {
  key: string;
  color: string;
  dashSignature: string;
  dashPattern: number[];
  lineWidthPx: number;
  path: Path2D;
  count: number;
}

/** 判断实体是否为可入缓存的简单描边几何。 */
export const isPathCacheableType = (type: string): boolean =>
  type === EntityType.LINE || type === EntityType.LWPOLYLINE || type === EntityType.POLYLINE
  || type === EntityType.CIRCLE || type === EntityType.ARC;

/** 样式解析（与 Canvas2D 主路径同源；线宽/虚线以屏幕像素语义存储）。 */
const resolveStyle = (input: PathCacheStyleInput): { color: string; dashPattern: number[]; lineWidthPx: number } | null => {
  const { entity, layer, theme, drawingColorMode } = input;
  if (entity.visible === false) return null;
  if (layer && layer.isVisible === false) return null;

  const color = resolveEntityColor(entity, layer, undefined, drawingColorMode, theme);

  const stroke = resolveCadStrokeStyle({
    entity,
    layer,
    parentLineType: undefined,
    parentLineweight: undefined,
    lineTypes: input.lineTypes,
    globalLineTypeScale: input.globalLineTypeScale,
    viewScale: 1,          // 虚线以世界节距 × zoom 渲染，与 CAD 语义一致
    isSelected: false,
  });

  // 线宽：屏幕像素语义（渲染时 lineWidth = px / zoom，配合世界变换）
  const lineWidthPx = Math.max(0.01, stroke.lineWidth);

  // 虚线：resolveCadStrokeStyle 的节距已按 viewScale=1 → 世界节距
  const dashWorld = stroke.dashPattern.map(v => v);
  if (dashWorld.length && dashWorld.every(v => v <= 0)) return { color, dashPattern: [0.5, 0.5], lineWidthPx };

  return { color, dashPattern: dashWorld, lineWidthPx };
};

export interface PathCacheBuildInput {
  layers: Record<string, DxfLayer>;
  lineTypes: Record<string, DxfLineType>;
  globalLineTypeScale: number;
  drawingColorMode: DrawingColorMode;
  theme: CanvasTheme;
}

/**
 * 构建世界坐标 Path2D 缓存。
 *
 * 视口相关量（LOD 剔除、可视裁剪）随缩放变化，缓存无法跟随——因此
 * 缓存收录全部简单几何（放大后本就该全部可见）；全图视图下走逐实体
 * 路径的 LOD 剔除更划算（由调用方按 zoom 判定）。
 */
export const buildPathCache = (
  entities: AnyEntity[],
  input: PathCacheBuildInput,
  hiddenLayers: Set<string>,
): PathCache => {
  const t0 = performance.now();
  const groups = new Map<string, GroupAcc>();
  const coveredIds = new Set<string>();
  let count = 0;

  const getGroup = (style: { color: string; dashPattern: number[]; lineWidthPx: number }): GroupAcc => {
    const dashSig = style.dashPattern.length === 0 ? 'solid' : style.dashPattern.map(v => v.toFixed(2)).join(',');
    // 线宽量化到 0.1px，避免浮点噪声导致组爆炸
    const key = `${style.color}|${dashSig}|${style.lineWidthPx.toFixed(1)}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, color: style.color, dashSignature: dashSig, dashPattern: style.dashPattern, lineWidthPx: style.lineWidthPx, path: new Path2D(), count: 0 };
      groups.set(key, g);
    }
    return g;
  };

  const appendLine = (path: Path2D, start: Point2D, end: Point2D): void => {
    path.moveTo(start.x, start.y);
    path.lineTo(end.x, end.y);
  };

  const appendPolyline = (path: Path2D, points: Point2D[], bulges: number[] | undefined, closed: boolean): void => {
    if (points.length < 2) return;
    path.moveTo(points[0].x, points[0].y);
    const n = closed ? points.length : points.length - 1;
    for (let i = 0; i < n; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % points.length];
      const bulge = bulges ? (bulges[i] || 0) : 0;
      if (Math.abs(bulge) < 1e-6) {
        path.lineTo(p2.x, p2.y);
      } else {
        const arc = sampleBulgeSegment(p1, p2, bulge);
        for (let k = 1; k < arc.length; k++) path.lineTo(arc[k].x, arc[k].y);
      }
    }
    if (closed) path.closePath();
  };

  const appendCircle = (path: Path2D, c: Point2D, r: number): void => {
    // 两个半圆 arc：闭合圆由两段 arc 构成（moveTo 分隔子路径）
    path.moveTo(c.x + r, c.y);
    path.arc(c.x, c.y, r, 0, Math.PI * 2);
  };

  const appendArc = (path: Path2D, c: Point2D, r: number, startDeg: number, endDeg: number, ccw: boolean): void => {
    const s = (startDeg || 0) * Math.PI / 180;
    const e = (endDeg || 0) * Math.PI / 180;
    path.moveTo(c.x + r * Math.cos(s), c.y + r * Math.sin(s));
    path.arc(c.x, c.y, r, s, e, ccw);
  };

  for (const ent of entities) {
    if (!isPathCacheableType(ent.type)) continue;
    if (ent.visible === false) continue;
    const layerName = ent.layer;
    if (hiddenLayers.has(layerName)) continue;
    const layer = input.layers[layerName];
    if (layer && layer.isVisible === false) continue;
    if (!ent.extents) continue;

    const style = resolveStyle({
      entity: ent, layer,
      lineTypes: input.lineTypes,
      globalLineTypeScale: input.globalLineTypeScale,
      drawingColorMode: input.drawingColorMode,
      theme: input.theme,
    });
    if (!style) continue;

    const g = getGroup(style);
    switch (ent.type) {
      case EntityType.LINE: appendLine(g.path, ent.start, ent.end); break;
      case EntityType.LWPOLYLINE:
      case EntityType.POLYLINE: appendPolyline(g.path, ent.points, ent.bulges, ent.closed); break;
      case EntityType.CIRCLE: appendCircle(g.path, ent.center, ent.radius); break;
      case EntityType.ARC: appendArc(g.path, ent.center, ent.radius, ent.startAngle || 0, ent.endAngle || 0, ent.isCounterClockwise !== false); break;
    }
    g.count++;
    coveredIds.add(ent.id);
    count++;
  }

  return {
    groups: [...groups.values()].map(g => ({ key: g.key, color: g.color, dashPattern: g.dashPattern, lineWidthPx: g.lineWidthPx, path: g.path })),
    coveredIds,
    stats: { entities: count, groups: groups.size, builtMs: performance.now() - t0 },
  };
};
