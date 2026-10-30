/**
 * 坐标逆平移辅助。
 *
 * 解析时 dxfParser 对所有实体坐标应用了 offsetEntity(entity, offset)
 * （坐标减去了 offset.x/y）。
 * 写出时，必须在输出每个坐标前把 offset 加回来，恢复真实的图纸绝对坐标。
 * 纯函数计算，不修改原 DxfData 对象。
 */
import { Point2D } from '@/types';

export const applyOffsetToPoint = (p: Point2D, offset: Point2D): Point2D => ({
  x: p.x + offset.x,
  y: p.y + offset.y,
});

export const applyOffsetToX = (x: number, offset: Point2D): number => x + offset.x;
export const applyOffsetToY = (y: number, offset: Point2D): number => y + offset.y;
