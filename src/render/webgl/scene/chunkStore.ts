/**
 * 分块场景存储：静态场景几何按空间网格分块，逐块持有 GPU 缓冲。
 *
 * 这是性能重构的核心数据结构：
 * - 场景构建（CPU）一次性把实体烘焙进分块网格（线段展开四边形 / 填充三角形 /
 *   字形四边形 / 点），之后 平移缩放零重建 —— 每帧只改 uniform；
 * - 每帧按「分块包围盒 ∩ 视口」剔除不可见分块，万级实体图纸全图视图下
 *   绝大多数分块直接跳过；
 * - 分块内按「虚线模式」分组记录索引范围，绘制组数 = 分块数 × 模式数（个位数），
 *   彻底消除 Canvas 2D 万级逐实体 draw call；
 * - 逐实体记录索引范围（entityRanges），选中高亮只重建一个小的覆盖索引缓冲，
 *   不触碰静态几何。
 */

import type { GlDevice } from '../glDevice';
import { LINE_ATTRIBS, FILL_ATTRIBS, GLYPH_ATTRIBS, POINT_ATTRIBS } from '../shaders';

export interface WorldRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type MeshKind = 'line' | 'fill' | 'glyph' | 'point';

/** 分块内一次绘制调用（按序执行；clipRectId ≥ 0 时启用剪裁）。 */
export interface ChunkDrawOp {
  mesh: MeshKind;
  /** line：虚线模式索引（0 = 实线）；其余 mesh 忽略。 */
  dashIdx: number;
  /** line = 索引缓冲起点；其余 = 顶点起点。 */
  start: number;
  count: number;
  /** 世界坐标裁剪矩形（纸张空间视口）；-1 = 无。 */
  clipRectId: number;
  /** fill：图案填充区域 id（chunk.hatchRegions 索引）；-1 = 实心。 */
  hatchRegionId: number;
  /** 文字 op 的世界字高（仅文字 op 有意义）：渲染时按屏幕像素高度逐个剔除。 */
  textHeight?: number;
}

/** 逐实体几何范围（选中叠加用）。 */
export interface EntityGeometryRanges {
  line?: { start: number; count: number };
  fill?: { start: number; count: number };
  glyph?: { start: number; count: number };
  point?: { start: number; count: number };
}

/** 分块内虚线索引段（draw 时按模式分组）。 */
export interface LineDashRange {
  dashIdx: number;
  /** chunk.lineIndices 中的起点 */
  indexStart: number;
  indexCount: number;
}

/** 单个分块的 GPU 资源。 */
export interface ChunkGpu {
  vaoLine: WebGLVertexArrayObject | null;
  vboLineData: WebGLBuffer | null;
  vboLineColor: WebGLBuffer | null;
  iboLine: WebGLBuffer | null;
  lineIndexCount: number;

  vaoFill: WebGLVertexArrayObject | null;
  vboFillData: WebGLBuffer | null;
  vboFillColor: WebGLBuffer | null;
  fillVertexCount: number;

  vaoGlyph: WebGLVertexArrayObject | null;
  vboGlyphData: WebGLBuffer | null;
  vboGlyphColor: WebGLBuffer | null;
  glyphVertexCount: number;

  vaoPoint: WebGLVertexArrayObject | null;
  vboPointData: WebGLBuffer | null;
  vboPointColor: WebGLBuffer | null;
  pointVertexCount: number;
}

/** 图案填充区域（解析着色；draw 时按区域设置 uniform）。 */
export interface HatchRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 0 实心 / 1 单向线 / 2 双向线 / 3 点阵 */
  mode: number;
  dir: [number, number];
  spacing: number;
  /** 该区域三角形的顶点范围 [start, start+count)（chunk.fillData 顶点计） */
  vertexStart: number;
  vertexCount: number;
}

export interface Chunk {
  /** 分块包围盒（世界坐标，含全部内容） */
  bounds: WorldRect;
  /** 分块原点（顶点坐标已减去，恢复时加回） */
  originX: number;
  originY: number;

  // ── CPU 侧累积结果（构建后上传 GPU）──
  lineData: Float32Array;
  lineColor: Uint8Array;
  lineIndices: Uint32Array;
  fillData: Float32Array;
  fillColor: Uint8Array;
  glyphData: Float32Array;
  glyphColor: Uint8Array;
  pointData: Float32Array;
  pointColor: Uint8Array;

  hatchRegions: HatchRegion[];
  drawOps: ChunkDrawOp[];
  entityRanges: Map<string, EntityGeometryRanges>;

  // ── 文字 LOD ──
  /** 文字 drawOps 在 drawOps 数组中的起始下标（几何 op 在前、文字 op 在后）。-1 = 无文字。 */
  textOpsStart: number;
  /** 本分块中最小的文字世界高度（用于渲染时按屏幕像素高度整批剔除过小文字）。 */
  minTextHeight: number;

  gpu: ChunkGpu | null;
}

export interface ChunkStoreOptions {
  gridMinX: number;
  gridMinY: number;
  chunkSize: number;
  gridCountX: number;
  gridCountY: number;
}

/** 烘焙中的累积缓冲（sceneBuilder 写入，finish 后进入 ChunkStore）。 */
export class SceneAccumulator {
  readonly chunks: Chunk[] = [];
  /** 虚线模式表（索引+1 = dashIdx；pattern 为模型单位，符号：正=实线段） */
  readonly dashPatterns: number[][] = [];
  private readonly dashPatternIndex = new Map<string, number>();
  /** 世界坐标裁剪矩形表（纸张空间视口投影） */
  readonly clipRects: WorldRect[] = [];

  constructor(private readonly options: ChunkStoreOptions) {}

  get storeOptions(): ChunkStoreOptions {
    return this.options;
  }

  chunkAt(worldX: number, worldY: number): Chunk {
    const { gridMinX, gridMinY, chunkSize, gridCountX, gridCountY } = this.options;
    const cx = Math.min(gridCountX - 1, Math.max(0, Math.floor((worldX - gridMinX) / chunkSize)));
    const cy = Math.min(gridCountY - 1, Math.max(0, Math.floor((worldY - gridMinY) / chunkSize)));
    const idx = cy * gridCountX + cx;
    let chunk = this.chunks[idx];
    if (!chunk) {
      chunk = {
        bounds: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
        originX: gridMinX + cx * chunkSize,
        originY: gridMinY + cy * chunkSize,
        lineData: new Float32Array(0),
        lineColor: new Uint8Array(0),
        lineIndices: new Uint32Array(0),
        fillData: new Float32Array(0),
        fillColor: new Uint8Array(0),
        glyphData: new Float32Array(0),
        glyphColor: new Uint8Array(0),
        pointData: new Float32Array(0),
        pointColor: new Uint8Array(0),
        hatchRegions: [],
        drawOps: [],
        textOpsStart: -1,
        minTextHeight: 0,
        entityRanges: new Map(),
        gpu: null,
      };
      this.chunks[idx] = chunk;
    }
    return chunk;
  }

  /** 登记虚线模式，返回 1-based dashIdx（0 = 实线）。 */
  dashIdxFor(pattern: number[]): number {
    if (!pattern.length) return 0;
    const key = pattern.join(',');
    const existing = this.dashPatternIndex.get(key);
    if (existing !== undefined) return existing + 1;
    const idx = this.dashPatterns.length;
    this.dashPatterns.push(pattern.slice());
    this.dashPatternIndex.set(key, idx);
    return idx + 1;
  }

  /** 登记裁剪矩形，返回 id。 */
  clipRectFor(rect: WorldRect): number {
    this.clipRects.push(rect);
    return this.clipRects.length - 1;
  }
}

/** 把 SceneAccumulator 的 CPU 数据固化为最终分块（紧凑数组 + 包围盒封口）。 */
export const finalizeAccumulator = (acc: SceneAccumulator): Chunk[] => {
  for (const chunk of acc.chunks) {
    if (!chunk) continue;
    if (!Number.isFinite(chunk.bounds.minX)) {
      chunk.bounds = { minX: chunk.originX, minY: chunk.originY, maxX: chunk.originX, maxY: chunk.originY };
    }
  }
  return acc.chunks.filter(Boolean);
};

/** 顶点局部坐标 → 分块局部坐标。 */
export const toChunkLocal = (chunk: Chunk, x: number, y: number): [number, number] => [
  x - chunk.originX,
  y - chunk.originY,
];

// ─────────────────────────────────────────────────────────────────────────────
// GPU 上传与 VAO 装配
// ─────────────────────────────────────────────────────────────────────────────

export const uploadChunkToGpu = (device: GlDevice, chunk: Chunk): void => {
  if (chunk.gpu) disposeChunkGpu(device, chunk);

  const gl = device.gl;
  const gpu: ChunkGpu = {
    vaoLine: null, vboLineData: null, vboLineColor: null, iboLine: null, lineIndexCount: chunk.lineIndices.length,
    vaoFill: null, vboFillData: null, vboFillColor: null, fillVertexCount: chunk.fillData.length / 2,
    vaoGlyph: null, vboGlyphData: null, vboGlyphColor: null, glyphVertexCount: chunk.glyphData.length / 5,
    vaoPoint: null, vboPointData: null, vboPointColor: null, pointVertexCount: chunk.pointData.length / 2,
  };

  // ── line：交错 f32 数据 + ubyte 颜色 + uint32 索引 ──
  if (chunk.lineIndices.length > 0) {
    gpu.vboLineData = device.createBuffer(gl.ARRAY_BUFFER, chunk.lineData);
    gpu.vboLineColor = device.createBuffer(gl.ARRAY_BUFFER, chunk.lineColor);
    gpu.iboLine = device.createBuffer(gl.ELEMENT_ARRAY_BUFFER, chunk.lineIndices);
    gpu.vaoLine = device.createVao();
    device.bindVao(gpu.vaoLine);
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.vboLineData);
    gl.enableVertexAttribArray(LINE_ATTRIBS.a_pos);
    gl.vertexAttribPointer(LINE_ATTRIBS.a_pos, 2, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(LINE_ATTRIBS.a_normal);
    gl.vertexAttribPointer(LINE_ATTRIBS.a_normal, 2, gl.FLOAT, false, 32, 8);
    gl.enableVertexAttribArray(LINE_ATTRIBS.a_params);
    gl.vertexAttribPointer(LINE_ATTRIBS.a_params, 4, gl.FLOAT, false, 32, 16);
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.vboLineColor);
    gl.enableVertexAttribArray(LINE_ATTRIBS.a_color);
    gl.vertexAttribPointer(LINE_ATTRIBS.a_color, 4, gl.UNSIGNED_BYTE, true, 4, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpu.iboLine);
    device.bindVao(null);
  }

  // ── fill ──
  if (gpu.fillVertexCount > 0) {
    gpu.vboFillData = device.createBuffer(gl.ARRAY_BUFFER, chunk.fillData);
    gpu.vboFillColor = device.createBuffer(gl.ARRAY_BUFFER, chunk.fillColor);
    gpu.vaoFill = device.createVao();
    device.bindVao(gpu.vaoFill);
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.vboFillData);
    gl.enableVertexAttribArray(FILL_ATTRIBS.a_pos);
    gl.vertexAttribPointer(FILL_ATTRIBS.a_pos, 2, gl.FLOAT, false, 8, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.vboFillColor);
    gl.enableVertexAttribArray(FILL_ATTRIBS.a_color);
    gl.vertexAttribPointer(FILL_ATTRIBS.a_color, 4, gl.UNSIGNED_BYTE, true, 4, 0);
    device.bindVao(null);
  }

  // ── glyph：pos(2f) + uv(2f) + page(1f) + color(4ub)，stride 20 字节 ──
  if (gpu.glyphVertexCount > 0) {
    gpu.vboGlyphData = device.createBuffer(gl.ARRAY_BUFFER, chunk.glyphData);
    gpu.vboGlyphColor = device.createBuffer(gl.ARRAY_BUFFER, chunk.glyphColor);
    gpu.vaoGlyph = device.createVao();
    device.bindVao(gpu.vaoGlyph);
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.vboGlyphData);
    gl.enableVertexAttribArray(GLYPH_ATTRIBS.a_pos);
    gl.vertexAttribPointer(GLYPH_ATTRIBS.a_pos, 2, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(GLYPH_ATTRIBS.a_uv);
    gl.vertexAttribPointer(GLYPH_ATTRIBS.a_uv, 2, gl.FLOAT, false, 20, 8);
    gl.enableVertexAttribArray(GLYPH_ATTRIBS.a_page);
    gl.vertexAttribPointer(GLYPH_ATTRIBS.a_page, 1, gl.FLOAT, false, 20, 16);
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.vboGlyphColor);
    gl.enableVertexAttribArray(GLYPH_ATTRIBS.a_color);
    gl.vertexAttribPointer(GLYPH_ATTRIBS.a_color, 4, gl.UNSIGNED_BYTE, true, 4, 0);
    device.bindVao(null);
  }

  // ── point ──
  if (gpu.pointVertexCount > 0) {
    gpu.vboPointData = device.createBuffer(gl.ARRAY_BUFFER, chunk.pointData);
    gpu.vboPointColor = device.createBuffer(gl.ARRAY_BUFFER, chunk.pointColor);
    gpu.vaoPoint = device.createVao();
    device.bindVao(gpu.vaoPoint);
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.vboPointData);
    gl.enableVertexAttribArray(POINT_ATTRIBS.a_pos);
    gl.vertexAttribPointer(POINT_ATTRIBS.a_pos, 2, gl.FLOAT, false, 8, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.vboPointColor);
    gl.enableVertexAttribArray(POINT_ATTRIBS.a_color);
    gl.vertexAttribPointer(POINT_ATTRIBS.a_color, 4, gl.UNSIGNED_BYTE, true, 4, 0);
    device.bindVao(null);
  }

  chunk.gpu = gpu;
};

export const disposeChunkGpu = (device: GlDevice, chunk: Chunk): void => {
  const gpu = chunk.gpu;
  if (!gpu) return;
  device.deleteBuffer(gpu.vboLineData);
  device.deleteBuffer(gpu.vboLineColor);
  device.deleteBuffer(gpu.iboLine);
  device.deleteVao(gpu.vaoLine);
  device.deleteBuffer(gpu.vboFillData);
  device.deleteBuffer(gpu.vboFillColor);
  device.deleteVao(gpu.vaoFill);
  device.deleteBuffer(gpu.vboGlyphData);
  device.deleteBuffer(gpu.vboGlyphColor);
  device.deleteVao(gpu.vaoGlyph);
  device.deleteBuffer(gpu.vboPointData);
  device.deleteBuffer(gpu.vboPointColor);
  device.deleteVao(gpu.vaoPoint);
  chunk.gpu = null;
};

export const disposeChunkStore = (device: GlDevice, chunks: Chunk[]): void => {
  for (const chunk of chunks) {
    if (chunk) disposeChunkGpu(device, chunk);
  }
};

