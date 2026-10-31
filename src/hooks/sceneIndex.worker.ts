import { Point2D } from '@/types';
import { sampleSplinePoints } from '@/core/geometry/curveSampling';
import { buildFlatBvh, FlatBvh } from '@/renderer/services/flatBvh';

/**
 * 场景索引构建 Worker：接收轻量数值数据（包围盒 TypedArray + 样条控制点），
 * 返回扁平 BVH 与样条采样结果。实体对象本体不跨线程，主线程零拷贝保留引用。
 */

interface SplineTask {
  id: string;
  degree: number;
  knots?: number[];
  weights?: number[];
  controlPoints: Point2D[];
}

export interface SceneIndexBuildRequest {
  type: 'build';
  buildId: number;
  /** 每实体 4 分量包围盒（minX, minY, maxX, maxY）。 */
  bounds: Float64Array;
  /** 参与建树的原始实体索引，与 bounds 行一一对应。 */
  indices: Int32Array;
  splines: SplineTask[];
}

export interface SceneIndexSampleResult {
  id: string;
  /** 交错 (x, y) 的采样点。 */
  points: Float64Array;
}

export type SceneIndexBuildResponse =
  | ({ type: 'built'; buildId: number } & FlatBvh & { samples: SceneIndexSampleResult[] })
  | { type: 'failed'; buildId: number; error: string };

const sampleSplines = (splines: SplineTask[]): SceneIndexSampleResult[] => {
  return splines.map(task => {
    const points = sampleSplinePoints(task.controlPoints, task.degree, task.knots, task.weights);
    const flat = new Float64Array(points.length * 2);
    for (let i = 0; i < points.length; i++) {
      flat[i * 2] = points[i].x;
      flat[i * 2 + 1] = points[i].y;
    }
    return { id: task.id, points: flat };
  });
};

const postMessage = (message: SceneIndexBuildResponse, transfer?: ArrayBuffer[]): void => {
  (self as unknown as { postMessage: (message: SceneIndexBuildResponse, transfer?: ArrayBuffer[]) => void })
    .postMessage(message, transfer);
};

self.onmessage = (e: MessageEvent<SceneIndexBuildRequest>) => {
  const { type, buildId, bounds, indices, splines } = e.data || ({} as SceneIndexBuildRequest);
  if (type !== 'build') return;

  try {
    const flat = buildFlatBvh(bounds, indices);
    const samples = sampleSplines(splines || []);
    const transfer = [
      flat.nodeBounds.buffer,
      flat.nodeLeft.buffer,
      flat.nodeRight.buffer,
      flat.leafStart.buffer,
      flat.leafCount.buffer,
      flat.order.buffer,
      ...samples.map(sample => sample.points.buffer),
    ] as ArrayBuffer[];
    postMessage({ type: 'built', buildId, ...flat, samples }, transfer);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    postMessage({ type: 'failed', buildId, error: message });
  }
};
