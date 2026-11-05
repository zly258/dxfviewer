import { AnyEntity, EntityType, Point2D } from '@/types';
import { FlatBvh, flatPointsToPoints } from './flatBvh';
import { isFiniteBounds, SceneBounds, SceneIndex } from './sceneIndex';

/**
 * 场景索引构建（纯函数部分）。
 *
 * BVH 建树（O(n log n) 排序）与样条 de Boor 采样在大图纸上会造成明显的
 * 主线程长任务；实际构建在 Worker 中进行（见 hooks/sceneIndexAsync.ts），
 * 跨线程只传输轻量数值数据（包围盒/控制点的 TypedArray，transferable
 * 零拷贝），实体对象本体留在主线程，查询器返回的仍是原实体引用。
 *
 * 本模块保持无 Worker 依赖：输入收集与结果重建为纯函数，可被 Node
 * 校验脚本直接复用（与 sceneIndex.ts 参考实现做等价性回归）。
 */

/** 超过该实体数的场景改用 Worker 异步构建。 */
export const SCENE_INDEX_ASYNC_THRESHOLD = 10_000;

/** Worker 样条任务描述。 */
export interface SplineTask {
  id: string;
  degree: number;
  knots?: number[];
  weights?: number[];
  controlPoints: Point2D[];
}

/** 建树输入：数值数据供 Worker，附属上下文留在主线程。 */
export interface SceneIndexBuildInput {
  /** 每实体 4 分量包围盒（minX, minY, maxX, maxY）。 */
  bounds: Float64Array;
  /** 参与建树的原始实体索引，与 bounds 行一一对应。 */
  indices: Int32Array;
  /** 无有限包围盒、始终参与查询结果的实体索引。 */
  fallbackIndices: number[];
  /** 需要 Worker 采样的样条。 */
  splines: SplineTask[];
  /** 已有采样（calculatedPoints/fitPoints）的样条直接就位。 */
  splineSamples: Map<string, Point2D[]>;
  /** handle → 实体映射（引线关联解析用）。 */
  entityByHandle: Map<string, AnyEntity>;
}

/** 扁平 BVH + 上下文重建查询器所需的附属数据。 */
export interface FlatSceneIndexContext {
  fallbackIndices: number[];
  entityByHandle: Map<string, AnyEntity>;
  splineSamples: Map<string, Point2D[]>;
}

/**
 * 从实体数组收集建树输入。纯函数，Node 校验脚本可复用。
 */
export const collectSceneIndexBuildInput = (entities: AnyEntity[]): SceneIndexBuildInput => {
  const indexed: number[] = [];
  const bounds: number[] = [];
  const fallbackIndices: number[] = [];
  const splines: SplineTask[] = [];
  const splineSamples = new Map<string, Point2D[]>();
  const entityByHandle = new Map<string, AnyEntity>();

  entities.forEach((entity, index) => {
    if (entity.handle) entityByHandle.set(entity.handle, entity);

    if (entity.type === EntityType.SPLINE) {
      const ready = entity.calculatedPoints?.length
        ? entity.calculatedPoints
        : entity.fitPoints && entity.fitPoints.length > 1
          ? entity.fitPoints
          : undefined;
      if (ready) {
        splineSamples.set(entity.id, ready);
      } else {
        splines.push({
          id: entity.id,
          degree: entity.degree || 3,
          knots: entity.knots,
          weights: entity.weights,
          controlPoints: entity.controlPoints || [],
        });
      }
    }

    if (!isFiniteBounds(entity.extents)) {
      fallbackIndices.push(index);
      return;
    }
    bounds.push(
      entity.extents.min.x,
      entity.extents.min.y,
      entity.extents.max.x,
      entity.extents.max.y,
    );
    indexed.push(index);
  });

  return {
    bounds: Float64Array.from(bounds),
    indices: Int32Array.from(indexed),
    fallbackIndices,
    splines,
    splineSamples,
    entityByHandle,
  };
};

/**
 * 由扁平 BVH 与主线程上下文重建 SceneIndex。
 * 查询语义与 sceneIndex.ts 的 createSceneIndex 完全一致：
 * 结果恢复原始绘制顺序，且始终包含无包围盒的兜底实体。
 */
export const createFlatSceneIndex = (
  entities: AnyEntity[],
  flat: FlatBvh,
  context: FlatSceneIndexContext,
): SceneIndex => {
  const { nodeBounds, nodeLeft, nodeRight, leafStart, leafCount, order } = flat;

  const query = (bounds: SceneBounds): AnyEntity[] => {
    const result = context.fallbackIndices.slice();

    if (nodeBounds.length > 0) {
      const stack: number[] = [0];
      while (stack.length > 0) {
        const node = stack.pop()!;
        const b = node * 4;
        if (bounds.max.x < nodeBounds[b] || bounds.min.x > nodeBounds[b + 2] ||
            bounds.max.y < nodeBounds[b + 1] || bounds.min.y > nodeBounds[b + 3]) {
          continue;
        }
        const count = leafCount[node];
        if (count > 0) {
          const start = leafStart[node];
          for (let i = start; i < start + count; i++) result.push(order[i]);
        } else {
          stack.push(nodeLeft[node], nodeRight[node]);
        }
      }
    }

    result.sort((a, b) => a - b);
    return result.map(index => entities[index]);
  };

  return {
    entities,
    entityByHandle: context.entityByHandle,
    splineSamples: context.splineSamples,
    query,
  };
};

/**
 * 合并 Worker 采样结果并完成索引构建。
 */
export const finalizeSceneIndex = (
  entities: AnyEntity[],
  input: SceneIndexBuildInput,
  flat: FlatBvh,
  sampledSplines: { id: string; points: Float64Array }[],
): SceneIndex => {
  for (const sample of sampledSplines) {
    input.splineSamples.set(sample.id, flatPointsToPoints(sample.points));
  }
  return createFlatSceneIndex(entities, flat, {
    fallbackIndices: input.fallbackIndices,
    entityByHandle: input.entityByHandle,
    splineSamples: input.splineSamples,
  });
};
