import { Point2D } from '@/types';

/**
 * 扁平化二叉 BVH：节点数据存入并行 TypedArray，可跨 Worker 结构克隆 /
 * 转移（transferable），主线程重建查询器时无需触碰实体对象。
 *
 * 与 sceneIndex.ts 的 buildBvh 语义一致（中位数切分、LEAF_SIZE 叶容量），
 * 供 sceneIndex.worker.ts 构建与 check 脚本做等价性回归。
 */

/** 叶节点容纳的最大实体数，与 sceneIndex.ts 保持一致。 */
export const FLAT_BVH_LEAF_SIZE = 32;

/** 扁平 BVH 数据：node i 的包围盒位于 nodeBounds[i*4 .. i*4+3]。 */
export interface FlatBvh {
  /** 每节点 4 个分量：minX, minY, maxX, maxY。 */
  nodeBounds: Float64Array;
  /** 左子节点索引，-1 表示无。 */
  nodeLeft: Int32Array;
  /** 右子节点索引，-1 表示无。 */
  nodeRight: Int32Array;
  /** 叶节点在 order 中的起始下标，内部节点为 -1。 */
  leafStart: Int32Array;
  /** 叶节点覆盖的实体数，内部节点为 0。 */
  leafCount: Int32Array;
  /** 叶序排列的原始实体索引（即 bounds/indices 的行序）。 */
  order: Int32Array;
}

/**
 * 构建扁平 BVH。
 *
 * @param bounds  每行 4 分量包围盒（minX, minY, maxX, maxY），行号与 indices 下标一一对应
 * @param indices 每行对应的原始实体索引（可为稀疏，如跳过无包围盒实体后的压缩列表）
 */
export const buildFlatBvh = (bounds: Float64Array, indices: Int32Array): FlatBvh => {
  // 建树期间排序的是「紧凑行号」；包围盒按下标 r * 4 读取。
  // 叶序确定后再映射回原始实体索引，保证查询端 entities[order[i]] 直达。
  const rowCount = indices.length;
  const rows = Array.from({ length: rowCount }, (_, row) => row);
  const nodeBounds: number[] = [];
  const nodeLeft: number[] = [];
  const nodeRight: number[] = [];
  const leafStart: number[] = [];
  const leafCount: number[] = [];

  const build = (lo: number, hi: number): number => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = lo; i < hi; i++) {
      const b = rows[i] * 4;
      if (bounds[b] < minX) minX = bounds[b];
      if (bounds[b + 1] < minY) minY = bounds[b + 1];
      if (bounds[b + 2] > maxX) maxX = bounds[b + 2];
      if (bounds[b + 3] > maxY) maxY = bounds[b + 3];
    }

    const node = nodeBounds.length / 4;
    nodeBounds.push(minX, minY, maxX, maxY);
    nodeLeft.push(-1);
    nodeRight.push(-1);
    leafStart.push(-1);
    leafCount.push(0);

    if (hi - lo <= FLAT_BVH_LEAF_SIZE) {
      leafStart[node] = lo;
      leafCount[node] = hi - lo;
      return node;
    }

    const splitOnX = maxX - minX >= maxY - minY;
    const slice = rows.slice(lo, hi);
    if (splitOnX) {
      slice.sort((a, b) => (bounds[a * 4] + bounds[a * 4 + 2]) - (bounds[b * 4] + bounds[b * 4 + 2]));
    } else {
      slice.sort((a, b) => (bounds[a * 4 + 1] + bounds[a * 4 + 3]) - (bounds[b * 4 + 1] + bounds[b * 4 + 3]));
    }
    for (let i = 0; i < slice.length; i++) rows[lo + i] = slice[i];

    const mid = lo + Math.floor((hi - lo) / 2);
    nodeLeft[node] = build(lo, mid);
    nodeRight[node] = build(mid, hi);
    return node;
  };

  if (rowCount > 0) build(0, rowCount);

  return {
    nodeBounds: Float64Array.from(nodeBounds),
    nodeLeft: Int32Array.from(nodeLeft),
    nodeRight: Int32Array.from(nodeRight),
    leafStart: Int32Array.from(leafStart),
    leafCount: Int32Array.from(leafCount),
    order: Int32Array.from(rows, row => indices[row]),
  };
};

/** 点格式转换：交错的 (x, y) Float64 → Point2D 数组。 */
export const flatPointsToPoints = (flat: Float64Array): Point2D[] => {
  const points: Point2D[] = [];
  for (let i = 0; i < flat.length; i += 2) {
    points.push({ x: flat[i], y: flat[i + 1] });
  }
  return points;
};
