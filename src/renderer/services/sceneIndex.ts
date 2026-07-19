import { sampleSplinePoints } from '@/core/geometry/curveSampling';
import { AnyEntity, EntityType, Point2D } from '@/types';

export interface SceneBounds {
  min: Point2D;
  max: Point2D;
}

interface IndexedEntity {
  index: number;
  bounds: SceneBounds;
  centerX: number;
  centerY: number;
}

interface BvhNode {
  bounds: SceneBounds;
  left?: BvhNode;
  right?: BvhNode;
  indices?: number[];
}

export interface SceneIndex {
  readonly entities: AnyEntity[];
  readonly entityByHandle: Map<string, AnyEntity>;
  readonly splineSamples: ReadonlyMap<string, Point2D[]>;
  query(bounds: SceneBounds): AnyEntity[];
}

const LEAF_SIZE = 32;

const isFiniteBounds = (bounds: SceneBounds | undefined): bounds is SceneBounds => {
  if (!bounds) return false;
  return [bounds.min.x, bounds.min.y, bounds.max.x, bounds.max.y].every(Number.isFinite)
    && bounds.min.x <= bounds.max.x
    && bounds.min.y <= bounds.max.y;
};

const mergeBounds = (items: IndexedEntity[]): SceneBounds => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const item of items) {
    minX = Math.min(minX, item.bounds.min.x);
    minY = Math.min(minY, item.bounds.min.y);
    maxX = Math.max(maxX, item.bounds.max.x);
    maxY = Math.max(maxY, item.bounds.max.y);
  }
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
};

const buildBvh = (items: IndexedEntity[]): BvhNode | undefined => {
  if (items.length === 0) return undefined;
  const bounds = mergeBounds(items);
  if (items.length <= LEAF_SIZE) {
    return { bounds, indices: items.map(item => item.index) };
  }

  const splitOnX = bounds.max.x - bounds.min.x >= bounds.max.y - bounds.min.y;
  items.sort((a, b) => splitOnX ? a.centerX - b.centerX : a.centerY - b.centerY);
  const middle = Math.floor(items.length / 2);
  return {
    bounds,
    left: buildBvh(items.slice(0, middle)),
    right: buildBvh(items.slice(middle)),
  };
};

const overlaps = (a: SceneBounds, b: SceneBounds): boolean => {
  return !(a.max.x < b.min.x || a.min.x > b.max.x || a.max.y < b.min.y || a.min.y > b.max.y);
};

const queryBvh = (node: BvhNode | undefined, bounds: SceneBounds, output: number[]): void => {
  if (!node || !overlaps(node.bounds, bounds)) return;
  if (node.indices) {
    output.push(...node.indices);
    return;
  }
  queryBvh(node.left, bounds, output);
  queryBvh(node.right, bounds, output);
};

/** 为静态图纸建立一次性 BVH；查询结果始终恢复为原始绘制顺序。 */
export const createSceneIndex = (entities: AnyEntity[]): SceneIndex => {
  const indexed: IndexedEntity[] = [];
  const fallbackIndices: number[] = [];
  const entityByHandle = new Map<string, AnyEntity>();
  const splineSamples = new Map<string, Point2D[]>();

  entities.forEach((entity, index) => {
    if (entity.handle) entityByHandle.set(entity.handle, entity);
    if (entity.type === EntityType.SPLINE) {
      const samples = entity.calculatedPoints?.length
        ? entity.calculatedPoints
        : entity.fitPoints && entity.fitPoints.length > 1
          ? entity.fitPoints
          : sampleSplinePoints(entity.controlPoints || [], entity.degree || 3, entity.knots, entity.weights);
      splineSamples.set(entity.id, samples);
    }

    if (!isFiniteBounds(entity.extents)) {
      fallbackIndices.push(index);
      return;
    }
    indexed.push({
      index,
      bounds: entity.extents,
      centerX: (entity.extents.min.x + entity.extents.max.x) / 2,
      centerY: (entity.extents.min.y + entity.extents.max.y) / 2,
    });
  });

  const root = buildBvh(indexed);
  return {
    entities,
    entityByHandle,
    splineSamples,
    query(bounds) {
      const indices = [...fallbackIndices];
      queryBvh(root, bounds, indices);
      indices.sort((a, b) => a - b);
      return indices.map(index => entities[index]);
    },
  };
};

export const pointQueryBounds = (x: number, y: number, tolerance: number): SceneBounds => ({
  min: { x: x - tolerance, y: y - tolerance },
  max: { x: x + tolerance, y: y + tolerance },
});

export const boxQueryBounds = (box: { x1: number; y1: number; x2: number; y2: number }): SceneBounds => ({
  min: { x: Math.min(box.x1, box.x2), y: Math.min(box.y1, box.y2) },
  max: { x: Math.max(box.x1, box.x2), y: Math.max(box.y1, box.y2) },
});
