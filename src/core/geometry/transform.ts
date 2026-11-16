import { DxfBlock, Point2D } from '@/types';

export type Extents2D = { min: Point2D; max: Point2D };
export type Scale2D = { x: number; y: number; z?: number };
export type PointTransform = (point: Point2D) => Point2D;

/** 对点进行缩放、旋转、平移变换。 */
export const transformPoint = (
    point: Point2D,
    position: Point2D,
    scale: Scale2D,
    rotationDegrees: number,
): Point2D => {
    const rotation = rotationDegrees * Math.PI / 180;
    const sx = point.x * scale.x;
    const sy = point.y * scale.y;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    return {
        x: position.x + sx * cos - sy * sin,
        y: position.y + sx * sin + sy * cos,
    };
};

export const composePointTransform = (
    inner: PointTransform,
    outer?: PointTransform,
): PointTransform => {
    return outer ? (point: Point2D) => outer(inner(point)) : inner;
};

export const transformExtentsByPointTransform = (
    extents: Extents2D,
    transform: PointTransform,
): Extents2D | null => {
    const corners = [
        transform({ x: extents.min.x, y: extents.min.y }),
        transform({ x: extents.max.x, y: extents.min.y }),
        transform({ x: extents.max.x, y: extents.max.y }),
        transform({ x: extents.min.x, y: extents.max.y }),
    ];

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    corners.forEach(point => {
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
    });

    if (minX === Infinity || minY === Infinity || maxX === -Infinity || maxY === -Infinity) return null;
    return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
};

/** 创建块定义局部坐标到世界坐标的变换。 */
export const createBlockPointTransform = (
    block: DxfBlock,
    position: Point2D,
    scale: Scale2D = { x: 1, y: 1, z: 1 },
    rotationDegrees = 0,
): PointTransform => {
    return (point: Point2D) => transformPoint(
        { x: point.x - block.basePoint.x, y: point.y - block.basePoint.y },
        position,
        scale,
        rotationDegrees,
    );
};

/** 将块的包围盒变换到世界坐标后，重新计算 AABB。 */
export const transformExtentsCorners = (
    extents: Extents2D,
    basePoint: Point2D,
    position: Point2D,
    scale: Scale2D,
    rotationDegrees: number,
): Extents2D | null => {
    const block: DxfBlock = { name: '', basePoint, entities: [] };
    return transformExtentsByPointTransform(
        extents,
        createBlockPointTransform(block, position, scale, rotationDegrees),
    );
};

export const isDimensionBlockLocal = (
    block: DxfBlock,
    definitionPoint: Point2D,
    distanceFactor: number,
): boolean => {
    if (!block.extents) return false;
    const blockWidth = block.extents.max.x - block.extents.min.x;
    const blockHeight = block.extents.max.y - block.extents.min.y;
    const blockSize = Math.max(Math.abs(blockWidth), Math.abs(blockHeight), 1);
    const blockCenter = {
        x: (block.extents.min.x + block.extents.max.x) / 2,
        y: (block.extents.min.y + block.extents.max.y) / 2,
    };
    const distance = Math.hypot(blockCenter.x - definitionPoint.x, blockCenter.y - definitionPoint.y);
    return distance > blockSize * distanceFactor;
};

export const createDimensionPointTransform = (
    block: DxfBlock,
    definitionPoint: Point2D,
    treatAsLocal: boolean,
): PointTransform => {
    if (!treatAsLocal) return (point: Point2D) => point;
    return (point: Point2D) => ({
        x: definitionPoint.x + (point.x - block.basePoint.x),
        y: definitionPoint.y + (point.y - block.basePoint.y),
    });
};
