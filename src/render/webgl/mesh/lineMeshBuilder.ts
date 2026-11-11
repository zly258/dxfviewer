/**
 * 线条网格构建器：折线 → 屏幕空间展开四边形网格。
 *
 * 顶点表示（每折线点 2 个顶点，供四边形上下两条边复用）：
 * - a_pos    : 折线点坐标（分块局部，f32×2）——展开偏移在顶点着色器做；
 * - a_normal : 该点的「斜接法线」（相邻段方向的平均垂直方向，f32×2）；
 * - a_params : (side×miterScale, widthPx, arcLen, dashIdx) f32×4；
 * - a_color  : RGBA 归一化 ubyte×4。
 *
 * 索引：每段 6 个索引构成一个四边形（2 三角形），相邻段共享端点顶点，
 * 一条 N 点折线只产生 2N 顶点 + 6(N-1) 索引。
 */

export const LINE_VERTEX_STRIDE_FLOATS = 8; // pos(2) + normal(2) + params(4)
export const LINE_VERTEX_STRIDE_BYTES = LINE_VERTEX_STRIDE_FLOATS * 4 + 4;

export interface LineStyle {
  /** 屏幕像素线宽（渲染语义与 CAD 显示一致）。 */
  widthPx: number;
  /** 虚线模式索引：0 = 实线，>0 = 虚线模式表中的 1-based 索引。 */
  dashIdx: number;
  /** 颜色 [r,g,b,a]，0-255。 */
  color: [number, number, number, number];
}

interface Vec2 { x: number; y: number }

/** 单条折线写入记录（分块虚线分组用）。 */
export interface LinePolylineOp {
  dashIdx: number;
  /** builder 索引数组中的起点 */
  indexStart: number;
  indexCount: number;
}

/** 膨胀中的网格累积器（可复用 TypedArray，避免万级折线时反复扩容分配）。 */
export class LineMeshBuilder {
  vertices: Float32Array;
  colors: Uint8Array;
  vertexCount = 0;
  indices: Uint32Array;
  indexCount = 0;
  /** 每次 addPolyline 的索引段记录（reset 清空）。 */
  ops: LinePolylineOp[] = [];
  /** 分块原点：写入顶点时以 float64 减去，避免先落 float32 世界坐标再相减造成的精度损失。 */
  originX = 0;
  originY = 0;

  private static readonly INITIAL_VERTICES = 4096;
  private static readonly INITIAL_INDICES = 6144;

  constructor(capacityHint = 0) {
    const vCap = Math.max(LineMeshBuilder.INITIAL_VERTICES, capacityHint * 2);
    const iCap = Math.max(LineMeshBuilder.INITIAL_INDICES, capacityHint * 6);
    this.vertices = new Float32Array(vCap * LINE_VERTEX_STRIDE_FLOATS);
    this.colors = new Uint8Array(vCap * 4);
    this.indices = new Uint32Array(iCap);
  }

  reset(): void {
    this.vertexCount = 0;
    this.indexCount = 0;
    this.ops.length = 0;
  }

  private ensureVertexCapacity(needed: number): void {
    if (this.vertexCount + needed <= this.vertices.length / LINE_VERTEX_STRIDE_FLOATS) return;
    let cap = this.vertices.length / LINE_VERTEX_STRIDE_FLOATS;
    while (cap < this.vertexCount + needed) cap *= 2;
    const nextVertices = new Float32Array(cap * LINE_VERTEX_STRIDE_FLOATS);
    nextVertices.set(this.vertices.subarray(0, this.vertexCount * LINE_VERTEX_STRIDE_FLOATS));
    this.vertices = nextVertices;
    const nextColors = new Uint8Array(cap * 4);
    nextColors.set(this.colors.subarray(0, this.vertexCount * 4));
    this.colors = nextColors;
  }

  private ensureIndexCapacity(needed: number): void {
    if (this.indexCount + needed <= this.indices.length) return;
    let cap = this.indices.length;
    while (cap < this.indexCount + needed) cap *= 2;
    const next = new Uint32Array(cap);
    next.set(this.indices.subarray(0, this.indexCount));
    this.indices = next;
  }

  /**
   * 追加一条折线（或闭合多边形）。
   * points 需为有限坐标；退化折线（<2 有效点）被忽略。
   * 返回写入的顶点范围 [vertexStart, vertexCount)，供选择叠加复用。
   */
  addPolyline(points: ArrayLike<number>, style: LineStyle, closed: boolean): { vertexStart: number; vertexCount: number } {
    const n = points.length / 2;
    if (n < 2) return { vertexStart: this.vertexCount, vertexCount: 0 };

    const vertexStart = this.vertexCount;
    const dashIdx = style.dashIdx;
    const [r, g, b, a] = style.color;

    // 每点 2 顶点：先写所有顶点，再补索引。
    let arcLen = 0;
    let prevX = 0, prevY = 0;
    let hasPrev = false;

    for (let i = 0; i < n; i++) {
      const x = points[i * 2];
      const y = points[i * 2 + 1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) return { vertexStart, vertexCount: 0 };

      if (hasPrev) arcLen += Math.hypot(x - prevX, y - prevY);
      prevX = x; prevY = y; hasPrev = true;

      // ── 斜接法线与缩放 ──
      // dirIn / dirOut：相邻段方向；端点取唯一段方向。
      let inX = 0, inY = 0, outX = 0, outY = 0;
      let hasIn = false, hasOut = false;

      if (i > 0) {
        const dx = x - points[(i - 1) * 2];
        const dy = y - points[(i - 1) * 2 + 1];
        const len = Math.hypot(dx, dy);
        if (len > 1e-12) { inX = dx / len; inY = dy / len; hasIn = true; }
      } else if (closed && n > 2) {
        const dx = x - points[(n - 1) * 2];
        const dy = y - points[(n - 1) * 2 + 1];
        const len = Math.hypot(dx, dy);
        if (len > 1e-12) { inX = dx / len; inY = dy / len; hasIn = true; }
      }
      if (i < n - 1) {
        const dx = points[(i + 1) * 2] - x;
        const dy = points[(i + 1) * 2 + 1] - y;
        const len = Math.hypot(dx, dy);
        if (len > 1e-12) { outX = dx / len; outY = dy / len; hasOut = true; }
      } else if (closed && n > 2) {
        const dx = points[0] - x;
        const dy = points[1] - y;
        const len = Math.hypot(dx, dy);
        if (len > 1e-12) { outX = dx / len; outY = dy / len; hasOut = true; }
      }

      // 平均法线（miter）：n = perp(inDir + outDir)，scale = 1/dot(n, perp(in))。
      let mx = 0, my = 0, miterScale = 1;
      if (hasIn && hasOut) {
        const bisX = inX + outX, bisY = inY + outY;
        const bisLen = Math.hypot(bisX, bisY);
        if (bisLen > 1e-9) {
          // 垂直于平分方向 → 斜接方向。
          mx = -bisY / bisLen;
          my = bisX / bisLen;
          const cosHalf = mx * -inY + my * inX; // dot(m, perp(in))
          miterScale = Math.abs(cosHalf) > 0.2 ? 1 / Math.abs(cosHalf) : 3;
          miterScale = Math.min(miterScale, 3);
        } else {
          // 折返段（180°）：用入段法线。
          mx = -inY; my = inX;
        }
      } else if (hasIn) { mx = -inY; my = inX; }
      else if (hasOut) { mx = -outY; my = outX; }
      else { mx = 0; my = 1; }

      this.ensureVertexCapacity(2);
      const vBase = this.vertexCount * LINE_VERTEX_STRIDE_FLOATS;
      const cBase = this.vertexCount * 4;
      // 顶点 0：+side
      this.vertices[vBase] = x - this.originX;
      this.vertices[vBase + 1] = y - this.originY;
      this.vertices[vBase + 2] = mx;
      this.vertices[vBase + 3] = my;
      this.vertices[vBase + 4] = miterScale;   // +side × scale
      this.vertices[vBase + 5] = style.widthPx;
      this.vertices[vBase + 6] = arcLen;
      this.vertices[vBase + 7] = dashIdx;
      this.colors[cBase] = r; this.colors[cBase + 1] = g; this.colors[cBase + 2] = b; this.colors[cBase + 3] = a;
      // 顶点 1：-side
      this.vertices[vBase + 8] = x - this.originX;
      this.vertices[vBase + 9] = y - this.originY;
      this.vertices[vBase + 10] = mx;
      this.vertices[vBase + 11] = my;
      this.vertices[vBase + 12] = -miterScale; // -side × scale
      this.vertices[vBase + 13] = style.widthPx;
      this.vertices[vBase + 14] = arcLen;
      this.vertices[vBase + 15] = dashIdx;
      this.colors[cBase + 4] = r; this.colors[cBase + 5] = g; this.colors[cBase + 6] = b; this.colors[cBase + 7] = a;
      this.vertexCount += 2;
    }

    // 索引：每段四边形 [i+, j+, j-, i-]。
    const segCount = closed ? n : n - 1;
    this.ensureIndexCapacity(segCount * 6);
    const indexStartBefore = this.indexCount;
    for (let s = 0; s < segCount; s++) {
      const i = s % n;
      const j = (s + 1) % n;
      const iTop = vertexStart + i * 2;
      const iBot = iTop + 1;
      const jTop = vertexStart + j * 2;
      const jBot = jTop + 1;
      // 零长度段跳过。
      const ax = points[i * 2], ay = points[i * 2 + 1];
      const bx = points[j * 2], by = points[j * 2 + 1];
      if (Math.abs(ax - bx) < 1e-12 && Math.abs(ay - by) < 1e-12) continue;
      const base = this.indexCount;
      this.indices[base] = iTop;
      this.indices[base + 1] = jTop;
      this.indices[base + 2] = jBot;
      this.indices[base + 3] = iTop;
      this.indices[base + 4] = jBot;
      this.indices[base + 5] = iBot;
      this.indexCount += 6;
    }

    const opIndexCount = this.indexCount - indexStartBefore;
    if (opIndexCount > 0) {
      this.ops.push({ dashIdx: style.dashIdx, indexStart: indexStartBefore, indexCount: opIndexCount });
    }

    return { vertexStart, vertexCount: this.vertexCount - vertexStart };
  }

  /** 追加单条线段（LINE/RAY/XLINE 的便捷入口）。 */
  /** 线段写入的复用缓冲（避免每条线段分配一个数组）。 */
  private readonly segmentScratch = new Float64Array(4);

  addSegment(ax: number, ay: number, bx: number, by: number, style: LineStyle): { vertexStart: number; vertexCount: number } {
    const s = this.segmentScratch;
    s[0] = ax; s[1] = ay; s[2] = bx; s[3] = by;
    return this.addPolyline(s, style, false);
  }
  finish(): { vertices: Float32Array; colors: Uint8Array; indices: Uint32Array } {
    return {
      vertices: this.vertices.subarray(0, this.vertexCount * LINE_VERTEX_STRIDE_FLOATS),
      colors: this.colors.subarray(0, this.vertexCount * 4),
      indices: this.indices.subarray(0, this.indexCount),
    };
  }
}

/** 计算折线总长度（虚线相位 / LOD 用）。 */
export const polylineLength = (points: ArrayLike<number>, closed: boolean): number => {
  const n = points.length / 2;
  if (n < 2) return 0;
  let total = 0;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const j = (i + 1) % n;
    total += Math.hypot(points[j * 2] - points[i * 2], points[j * 2 + 1] - points[i * 2 + 1]);
  }
  return total;
};

export type { Vec2 };
