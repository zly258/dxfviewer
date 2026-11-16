/**
 * 世界坐标 Path2D 缓存：简单几何（LINE/LWPOLYLINE/POLYLINE/CIRCLE/ARC）
 * 按样式组（颜色|虚线|线宽）合并为少量 Path2D，渲染时每组一次 stroke。
 *
 * 这是 Canvas 2D 引擎的交互性能核心：万级实体的简单几何从「逐实体 beginPath/
 * stroke」降为「每样式组一次 stroke」；视口矩阵经 setTransform 应用，
 * 几何以世界坐标存储，缩放平移不触发重建。
 */

import type { AnyEntity, DxfLayer, DxfLineType, CanvasTheme, DrawingColorMode } from '@/types';
import { resolveEntityColor } from '@/utils/entityColor';
import { resolveCadStrokeStyle } from '@/utils/lineStyle';
import type { Point2D } from '@/types';

export interface PathCacheGroup {
  path: Path2D;
  color: string;
  lineWidthPx: number;
  dashPattern: number[];
}

export interface PathCache {
  groups: PathCacheGroup[];
  /** 已被缓存覆盖的实体 id（其余实体仍走逐实体绘制）。 */
  coveredIds: Set<string>;
  stats: { entities: number };
}

const PATH_CACHE_TYPES = new Set(['LINE', 'LWPOLYLINE', 'POLYLINE', 'CIRCLE', 'ARC']);

interface BuildCtx {
  layers: Record<string, DxfLayer>;
  lineTypes: Record<string, DxfLineType>;
  globalLineTypeScale: number;
  drawingColorMode: DrawingColorMode;
  theme: CanvasTheme;
  hiddenLayers: Set<string>;
}

const appendEntityPath = (path: Path2D, ent: AnyEntity): void => {
  switch (ent.type) {
    case 'LINE': {
      path.moveTo(ent.start.x, ent.start.y);
      path.lineTo(ent.end.x, ent.end.y);
      break;
    }
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      if (ent.points.length < 2) break;
      path.moveTo(ent.points[0].x, ent.points[0].y);
      const segCount = ent.closed ? ent.points.length : ent.points.length - 1;
      for (let i = 0; i < segCount; i++) {
        const p1 = ent.points[i];
        const p2 = ent.points[(i + 1) % ent.points.length];
        const bulge = ent.bulges?.[i] || 0;
        if (Math.abs(bulge) < 1e-6) {
          path.lineTo(p2.x, p2.y);
        } else {
          // bulge 圆弧按 8 段折线近似（缓存路径的视觉精度足够）。
          const chord = Math.hypot(p2.x - p1.x, p2.y - p1.y);
          if (chord < 1e-9) continue;
          const theta = 4 * Math.atan(bulge);
          const radius = Math.abs(chord / (2 * Math.sin(theta / 2)));
          const midX = (p1.x + p2.x) / 2, midY = (p1.y + p2.y) / 2;
          const h = chord / 2 / Math.tan(theta / 2);
          const dirX = (p2.x - p1.x) / chord, dirY = (p2.y - p1.y) / chord;
          const cx = midX - dirY * h;
          const cy = midY + dirX * h;
          const a0 = Math.atan2(p1.y - cy, p1.x - cx);
          const a1 = Math.atan2(p2.y - cy, p2.x - cx);
          let sweep = a1 - a0;
          if (bulge > 0 && sweep < 0) sweep += Math.PI * 2;
          if (bulge < 0 && sweep > 0) sweep -= Math.PI * 2;
          for (let s = 1; s <= 8; s++) {
            const a = a0 + sweep * (s / 8);
            path.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
          }
        }
      }
      if (ent.closed) path.closePath();
      break;
    }
    case 'CIRCLE': {
      if (ent.radius <= 0) break;
      path.moveTo(ent.center.x + ent.radius, ent.center.y);
      path.arc(ent.center.x, ent.center.y, ent.radius, 0, Math.PI * 2);
      break;
    }
    case 'ARC': {
      if (ent.radius <= 0) break;
      const startRad = (ent.startAngle || 0) * Math.PI / 180;
      const endRad = (ent.endAngle || 0) * Math.PI / 180;
      // 渲染变换会翻转 Y，圆弧角度取负并与 canvas 语义一致。
      const isCcw = ent.isCounterClockwise !== false;
      path.moveTo(
        ent.center.x + ent.radius * Math.cos(-startRad),
        ent.center.y + ent.radius * Math.sin(-startRad),
      );
      path.arc(ent.center.x, ent.center.y, ent.radius, -startRad, -endRad, isCcw);
      break;
    }
    default:
      break;
  }
};

/** 构建世界坐标 Path2D 缓存（可缓存实体不足时返回 null 走逐实体路径）。 */
export const buildPathCache = (
  entities: AnyEntity[],
  ctxOptions: BuildCtx,
): PathCache | null => {
  const groups = new Map<string, PathCacheGroup>();
  const coveredIds = new Set<string>();
  let cachedCount = 0;

  for (const ent of entities) {
    if (!PATH_CACHE_TYPES.has(ent.type)) continue;
    if (ent.visible === false) continue;
    if (ctxOptions.hiddenLayers.has(ent.layer)) continue;
    const layer = ctxOptions.layers[ent.layer];
    if (layer && layer.isVisible === false) continue;

    const color = resolveEntityColor(ent, layer, undefined, ctxOptions.drawingColorMode, ctxOptions.theme);
    const stroke = resolveCadStrokeStyle({
      entity: ent,
      layer,
      parentLineType: undefined,
      parentLineweight: undefined,
      lineTypes: ctxOptions.lineTypes,
      globalLineTypeScale: ctxOptions.globalLineTypeScale,
      viewScale: 1,
      isSelected: false,
    });
    const key = `${color}\u0000${stroke.dashPattern.join(',')}\u0000${stroke.lineWidth}`;

    let group = groups.get(key);
    if (!group) {
      group = { path: new Path2D(), color, lineWidthPx: stroke.lineWidth, dashPattern: stroke.dashPattern };
      groups.set(key, group);
    }
    appendEntityPath(group.path, ent);
    coveredIds.add(ent.id);
    cachedCount++;
  }

  if (cachedCount === 0) return null;
  return {
    groups: [...groups.values()],
    coveredIds,
    stats: { entities: cachedCount },
  };
};

/** 缓存判定：zoom × 可缓存实体数低于阈值时逐实体 LOD 路径更快（全图远景）。 */
export const PATH_CACHE_MIN_COVERAGE = 5000;

export type { Point2D };
