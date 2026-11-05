/**
 * 填充网格构建器：多边形（含内孔）→ 三角形网格。
 *
 * - 实心填充（HATCH solid / SOLID / WIPEOUT / 3DFACE）走耳切三角化；
 * - 图案填充（ANSI31 等）不走本构建器：由 patternLines 生成斜线并做
 *   「偶奇配对」裁剪后写入 LineMeshBuilder（与 CAD 线型视觉一致）。
 *
 * 顶点布局：a_pos f32×2 + a_color ubyte×4 = 12 字节。
 */

export const FILL_VERTEX_STRIDE_FLOATS = 2;
export const FILL_VERTEX_STRIDE_BYTES = FILL_VERTEX_STRIDE_FLOATS * 4 + 4;

export interface FillStyle {
  color: [number, number, number, number];
}

interface Point { x: number; y: number }

/** 耳切三角化：外环 + 若干内孔（内孔自动桥接进外环后统一耳切）。 */
export const triangulatePolygon = (
  outer: Point[],
  holes: Point[][],
  out: number[],
): void => {
  let ring = buildSingleRing(outer, holes);
  if (ring.length < 3) return;

  // 防御：耳切为 O(n²)，超大环（曲线高密度采样等）先等距抽稀——
  // 填充边界视觉几乎无损，避免个别大环卡住整个场景构建。
  if (ring.length > MAX_EARCUT_RING_POINTS) {
    ring = decimateRing(ring, MAX_EARCUT_RING_POINTS);
  }

  // 耳切（索引表 + 笛卡尔符号判断；退化点跳过）。
  const n = ring.length;
  const indices: number[] = [];
  for (let i = 0; i < n; i++) indices.push(i);

  // 三角形包围盒预剔除用：每次耳剪时计算 (a,b,c) 的 bbox，点在盒外直接跳过。
  while (indices.length > 2) {
    let clipped = false;
    const m = indices.length;
    for (let i = 0; i < m; i++) {
      const a = indices[(i + m - 1) % m];
      const b = indices[i];
      const c = indices[(i + 1) % m];
      const pa = ring[a], pb = ring[b], pc = ring[c];
      const cross = (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x);
      if (Math.abs(cross) < 1e-12) {
        // 共线：直接丢弃中间点。
        if (cross >= 0) { indices.splice(i, 1); clipped = true; break; }
        continue;
      }
      if (cross <= 0) continue; // 凹角或反向环
      if (containsOtherVertex(ring, indices, a, b, c)) continue;
      out.push(pa.x, pa.y, pb.x, pb.y, pc.x, pc.y);
      indices.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // 数值退化：剩余点放弃（罕见）
  }
};

/** 耳切输入环的硬上限（超过则等距抽稀）。 */
const MAX_EARCUT_RING_POINTS = 512;

/** 等距抽稀环（保留首点；填充边界的视觉损失可忽略）。 */
const decimateRing = (ring: Point[], maxPoints: number): Point[] => {
  const step = ring.length / maxPoints;
  const out: Point[] = [];
  for (let i = 0; i < maxPoints; i++) {
    out.push(ring[Math.min(ring.length - 1, Math.floor(i * step))]);
  }
  return out;
};

/** 测试三角形 (a,b,c) 是否包含其他剩余顶点（含边上）。含包围盒快速剔除。 */
const containsOtherVertex = (
  ring: Point[],
  indices: number[],
  a: number,
  b: number,
  c: number,
): boolean => {
  const pa = ring[a], pb = ring[b], pc = ring[c];
  const area2 = (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x);
  if (Math.abs(area2) < 1e-12) return true;
  // 包围盒预剔除：点在三角形 bbox 外时不可能被包含。
  const minX = Math.min(pa.x, pb.x, pc.x);
  const minY = Math.min(pa.y, pb.y, pc.y);
  const maxX = Math.max(pa.x, pb.x, pc.x);
  const maxY = Math.max(pa.y, pb.y, pc.y);
  for (const idx of indices) {
    if (idx === a || idx === b || idx === c) continue;
    const p = ring[idx];
    if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) continue;
    const w1 = (pb.x - pa.x) * (p.y - pa.y) - (pb.y - pa.y) * (p.x - pa.x);
    const w2 = (pc.x - pb.x) * (p.y - pb.y) - (pc.y - pb.y) * (p.x - pb.x);
    const w3 = (pa.x - pc.x) * (p.y - pc.y) - (pa.y - pc.y) * (p.x - pc.x);
    if (w1 >= -1e-12 && w2 >= -1e-12 && w3 >= -1e-12) return true;
  }
  return false;
};

/** 把内孔按「最右顶点桥接」合并进外环（even-odd 语义下逐孔处理）。 */
const buildSingleRing = (outer: Point[], holes: Point[][]): Point[] => {
  // 复制并保证外环逆时针（面积 > 0）。
  let ring = ensureCounterClockwise(outer.map(p => ({ x: p.x, y: p.y })));
  if (ring.length < 3) return ring;

  const holesSorted = holes
    .map(h => ensureClockwise(h.map(p => ({ x: p.x, y: p.y }))))
    .filter(h => h.length >= 3)
    .sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));

  for (const hole of holesSorted) {
    ring = bridgeHole(ring, hole);
  }
  return ring;
};

const signedArea = (pts: Point[]): number => {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return area / 2;
};

const ensureCounterClockwise = (pts: Point[]): Point[] =>
  signedArea(pts) < 0 ? pts.slice().reverse() : pts;
const ensureClockwise = (pts: Point[]): Point[] =>
  signedArea(pts) > 0 ? pts.slice().reverse() : pts;

/** 桥接单个内孔：从孔的最右顶点向右射线，找最近的外环边上的可见桥点。 */
const bridgeHole = (outer: Point[], hole: Point[]): Point[] => {
  if (outer.length < 3) return outer;

  // 孔的最右（x 最大，其次 y 最大）顶点。
  let holeIdx = 0;
  for (let i = 1; i < hole.length; i++) {
    const a = hole[i], b = hole[holeIdx];
    if (a.x > b.x || (a.x === b.x && a.y > b.y)) holeIdx = i;
  }
  const m = hole[holeIdx];

  // 1) 射线 (m → +x) 与外环各边求交，取最近交点。
  let bestEdge = -1;
  let bestX = Infinity;
  for (let i = 0; i < outer.length; i++) {
    const a = outer[i];
    const b = outer[(i + 1) % outer.length];
    if ((a.y > m.y) === (b.y > m.y)) continue;
    const t = (m.y - a.y) / (b.y - a.y);
    const ix = a.x + t * (b.x - a.x);
    if (ix >= m.x && ix < bestX) {
      bestX = ix;
      bestEdge = i;
    }
  }
  if (bestEdge < 0) return outer; // 无桥接边（退化）：放弃该孔

  // 2) 可见性：外环顶点中 x ≥ bestX 的点里，选相对 m 张角最小的（cos 最大）。
  let bridgeIdx = (bestEdge + 1) % outer.length;
  let bestCos = -Infinity;
  const hx = m.x - hole[holeIdx].x;
  const hy = m.y - hole[holeIdx].y;
  for (let i = 0; i < outer.length; i++) {
    const p = outer[i];
    if (p.x < bestX - 1e-9) continue;
    const vx = m.x - p.x;
    const vy = m.y - p.y;
    const lv = Math.hypot(vx, vy);
    if (lv < 1e-12) { bridgeIdx = i; bestCos = Infinity; break; }
    const cos = (vx * hx + vy * hy) / (lv * (Math.hypot(hx, hy) || 1));
    if (cos > bestCos) { bestCos = cos; bridgeIdx = i; }
  }

  // 3) 合并：外环前段 + 孔环（从 holeIdx 环绕一圈）+ 外环后段。
  const merged: Point[] = [];
  for (let i = 0; i <= bridgeIdx; i++) merged.push(outer[i]);
  for (let k = 0; k <= hole.length; k++) {
    merged.push(hole[(holeIdx + k) % hole.length]);
  }
  for (let i = bridgeIdx; i < outer.length; i++) merged.push(outer[i]);
  return merged;
};

/** 填充网格累积器。 */
export class FillMeshBuilder {
  vertices: Float32Array;
  colors: Uint8Array;
  vertexCount = 0;

  constructor(capacityHint = 0) {
    const cap = Math.max(1024, capacityHint * 3);
    this.vertices = new Float32Array(cap * FILL_VERTEX_STRIDE_FLOATS);
    this.colors = new Uint8Array(cap * 4);
  }

  reset(): void {
    this.vertexCount = 0;
  }

  private ensureCapacity(needed: number): void {
    if (this.vertexCount + needed <= this.vertices.length / FILL_VERTEX_STRIDE_FLOATS) return;
    let cap = this.vertices.length / FILL_VERTEX_STRIDE_FLOATS;
    while (cap < this.vertexCount + needed) cap *= 2;
    const nextVertices = new Float32Array(cap * FILL_VERTEX_STRIDE_FLOATS);
    nextVertices.set(this.vertices.subarray(0, this.vertexCount * FILL_VERTEX_STRIDE_FLOATS));
    this.vertices = nextVertices;
    const nextColors = new Uint8Array(cap * 4);
    nextColors.set(this.colors.subarray(0, this.vertexCount * 4));
    this.colors = nextColors;
  }

  addTriangle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, style: FillStyle): void {
    this.ensureCapacity(3);
    const vBase = this.vertexCount * FILL_VERTEX_STRIDE_FLOATS;
    const cBase = this.vertexCount * 4;
    const [r, g, b, a] = style.color;
    const xs = [ax, bx, cx];
    const ys = [ay, by, cy];
    for (let i = 0; i < 3; i++) {
      this.vertices[vBase + i * 2] = xs[i];
      this.vertices[vBase + i * 2 + 1] = ys[i];
      this.colors[cBase + i * 4] = r;
      this.colors[cBase + i * 4 + 1] = g;
      this.colors[cBase + i * 4 + 2] = b;
      this.colors[cBase + i * 4 + 3] = a;
    }
    this.vertexCount += 3;
  }

  /** 三角化并写入整个多边形（含内孔）。 */
  addPolygon(outer: Point[], holes: Point[][], style: FillStyle): void {
    const scratch: number[] = [];
    triangulatePolygon(outer, holes, scratch);
    for (let i = 0; i + 5 < scratch.length; i += 6) {
      this.addTriangle(scratch[i], scratch[i + 1], scratch[i + 2], scratch[i + 3], scratch[i + 4], scratch[i + 5], style);
    }
  }

  finish(): { vertices: Float32Array; colors: Uint8Array } {
    return {
      vertices: this.vertices.subarray(0, this.vertexCount * FILL_VERTEX_STRIDE_FLOATS),
      colors: this.colors.subarray(0, this.vertexCount * 4),
    };
  }
}
