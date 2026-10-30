/**
 * 视口适配（fit-to-box）公共实现。
 *
 * 抽出的动机：交互查看器的「适应视图」和导出（PNG/PDF）必须用**同一套**
 * 数学把图纸装进画布，否则「屏幕上看到的」与「导出的」会出现比例/留白差异，
 * 而这类差异用户一眼就能发现。此前该逻辑内联在 DxfViewer.fitView 中。
 */
import { Point2D, ViewPort } from '@/types';

export interface Extents2D {
  center: Point2D;
  width: number;
  height: number;
  min: Point2D;
  max: Point2D;
}

export interface FitBoxOptions {
  /** 画布内边距（像素）。导出时用来留白，交互查看器为 0。 */
  padding?: number;
  /** 额外缩放系数：交互查看器用 0.98 留一点边，导出用 1 精确贴合。 */
  marginFactor?: number;
  /** 缩放下限/上限；交互查看器需要钳制，导出应传 Infinity/0 以保持精确。 */
  minZoom?: number;
  maxZoom?: number;
}

const isPositiveFinite = (value: number): boolean => Number.isFinite(value) && value > 0;

/**
 * 计算把世界坐标包围盒装进 `width × height` 画布所需的视口。
 *
 * 空尺寸或退化包围盒（宽高为 0）时返回 zoom=1、对准中心的视口，调用方无需特判。
 */
export const fitExtentsToBox = (
  extents: Extents2D | undefined,
  width: number,
  height: number,
  options: FitBoxOptions = {},
): ViewPort => {
  const { padding = 0, marginFactor = 1, minZoom = 0, maxZoom = Number.MAX_VALUE } = options;
  const fallback: ViewPort = {
    targetX: extents?.center?.x ?? 0,
    targetY: extents?.center?.y ?? 0,
    zoom: 1,
  };

  if (!extents || !isPositiveFinite(width) || !isPositiveFinite(height)) return fallback;

  const worldW = extents.width > 0 ? extents.width : extents.max.x - extents.min.x;
  const worldH = extents.height > 0 ? extents.height : extents.max.y - extents.min.y;
  if (!isPositiveFinite(worldW) && !isPositiveFinite(worldH)) return fallback;

  const availableW = Math.max(1, width - padding * 2);
  const availableH = Math.max(1, height - padding * 2);

  // 单轴退化（例如一条水平线，高度为 0）时该轴不参与取小，与旧交互逻辑一致。
  const scaleX = isPositiveFinite(worldW) ? availableW / worldW : Number.POSITIVE_INFINITY;
  const scaleY = isPositiveFinite(worldH) ? availableH / worldH : Number.POSITIVE_INFINITY;

  let zoom = Math.min(scaleX, scaleY) * marginFactor;
  if (!isPositiveFinite(zoom)) zoom = 1;
  zoom = Math.min(Math.max(zoom, minZoom), maxZoom);

  return { targetX: extents.center.x, targetY: extents.center.y, zoom };
};

/** 由 min/max 直接构造包围盒（导出场景只剩范围、没有中心信息时使用）。 */
export const extentsFromBounds = (min: Point2D, max: Point2D): Extents2D => ({
  min,
  max,
  center: { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2 },
  width: max.x - min.x,
  height: max.y - min.y,
});

/**
 * 图纸空间布局的适配：优先用布局自带的打印范围（paperMin/paperMax），
 * 没有时退回布局实体包围盒。
 */
export const fitPaperLayoutToBox = (
  layout: { extents?: Extents2D; paperMin?: Point2D; paperMax?: Point2D } | undefined,
  width: number,
  height: number,
  options: FitBoxOptions = {},
): ViewPort => {
  if (!layout) return fitExtentsToBox(undefined, width, height, options);
  if (layout.paperMin && layout.paperMax) {
    return fitExtentsToBox(extentsFromBounds(layout.paperMin, layout.paperMax), width, height, options);
  }
  return fitExtentsToBox(layout.extents, width, height, options);
};
