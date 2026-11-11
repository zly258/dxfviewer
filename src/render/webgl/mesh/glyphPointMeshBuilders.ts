/**
 * 字形与点网格构建器。
 *
 * 字形四边形：TTF/中文文字经字形图集光栅化后，每个字形一个四边形；
 * SHX 形字体文字不走本构建器（它们是描边字形，直接进 LineMeshBuilder，
 * 与 CAD 形字体的单线条视觉一致）。
 */

export const GLYPH_VERTEX_STRIDE_FLOATS = 5; // pos(2) + uv(2) + page(1)
export const GLYPH_VERTEX_STRIDE_BYTES = GLYPH_VERTEX_STRIDE_FLOATS * 4 + 4;

export const POINT_VERTEX_STRIDE_FLOATS = 2;
export const POINT_VERTEX_STRIDE_BYTES = POINT_VERTEX_STRIDE_FLOATS * 4 + 4;

export interface TextStyle {
  color: [number, number, number, number];
}

export class GlyphMeshBuilder {
  vertices: Float32Array;
  colors: Uint8Array;
  vertexCount = 0;
  /** 分块原点：写入时以 float64 减去。 */
  originX = 0;
  originY = 0;

  constructor(capacityHint = 0) {
    const cap = Math.max(1024, capacityHint * 4);
    this.vertices = new Float32Array(cap * GLYPH_VERTEX_STRIDE_FLOATS);
    this.colors = new Uint8Array(cap * 4);
  }

  reset(): void {
    this.vertexCount = 0;
  }

  private ensureCapacity(quads: number): void {
    if (this.vertexCount + quads * 6 <= this.vertices.length / GLYPH_VERTEX_STRIDE_FLOATS) return;
    let cap = this.vertices.length / GLYPH_VERTEX_STRIDE_FLOATS;
    while (cap < this.vertexCount + quads * 6) cap *= 2;
    const nextVertices = new Float32Array(cap * GLYPH_VERTEX_STRIDE_FLOATS);
    nextVertices.set(this.vertices.subarray(0, this.vertexCount * GLYPH_VERTEX_STRIDE_FLOATS));
    this.vertices = nextVertices;
    const nextColors = new Uint8Array(cap * 4);
    nextColors.set(this.colors.subarray(0, this.vertexCount * 4));
    this.colors = nextColors;
  }

  /**
   * 直写四角字形四边形：角点与 UV 已由调用方算好（含旋转），
   * 构建器只负责顶点排布。corners 顺序 TL/TR/BR/BL（模型 Y 向上）。
   */
  addQuadCorners(
    corners: Array<[number, number]>,
    uvs: Array<[number, number]>,
    style: TextStyle,
    page = 0,
  ): void {
    this.ensureCapacity(1);
    this.writeCorners(corners, uvs, style, page);
  }

  private writeCorners(
    corners: Array<[number, number]>,
    uvs: Array<[number, number]>,
    style: TextStyle,
    page = 0,
  ): void {
    const color = style.color;
    const vBase = this.vertexCount * GLYPH_VERTEX_STRIDE_FLOATS;
    const cBase = this.vertexCount * 4;
    // 两个三角形：TL→TR→BR + TL→BR→BL（6 顶点，无索引缓冲的 TRIANGLES 模式）
    const order = [0, 1, 2, 0, 2, 3];
    for (let i = 0; i < 6; i++) {
      const ci = order[i];
      this.vertices[vBase + i * 5] = corners[ci][0] - this.originX;
      this.vertices[vBase + i * 5 + 1] = corners[ci][1] - this.originY;
      this.vertices[vBase + i * 5 + 2] = uvs[ci][0];
      this.vertices[vBase + i * 5 + 3] = uvs[ci][1];
      this.vertices[vBase + i * 5 + 4] = page;
      const co = cBase + i * 4;
      this.colors[co] = color[0];
      this.colors[co + 1] = color[1];
      this.colors[co + 2] = color[2];
      this.colors[co + 3] = color[3];
    }
    this.vertexCount += 6;
  }

  finish(): { vertices: Float32Array; colors: Uint8Array } {
    return {
      vertices: this.vertices.subarray(0, this.vertexCount * GLYPH_VERTEX_STRIDE_FLOATS),
      colors: this.colors.subarray(0, this.vertexCount * 4),
    };
  }
}

export class PointMeshBuilder {
  vertices: Float32Array;
  colors: Uint8Array;
  vertexCount = 0;
  originX = 0;
  originY = 0;

  constructor(capacityHint = 64) {
    const cap = Math.max(64, capacityHint);
    this.vertices = new Float32Array(cap * POINT_VERTEX_STRIDE_FLOATS);
    this.colors = new Uint8Array(cap * 4);
  }

  reset(): void {
    this.vertexCount = 0;
  }

  private ensureCapacity(needed: number): void {
    if (this.vertexCount + needed <= this.vertices.length / POINT_VERTEX_STRIDE_FLOATS) return;
    let cap = this.vertices.length / POINT_VERTEX_STRIDE_FLOATS;
    while (cap < this.vertexCount + needed) cap *= 2;
    const nextVertices = new Float32Array(cap * POINT_VERTEX_STRIDE_FLOATS);
    nextVertices.set(this.vertices.subarray(0, this.vertexCount * POINT_VERTEX_STRIDE_FLOATS));
    this.vertices = nextVertices;
    const nextColors = new Uint8Array(cap * 4);
    nextColors.set(this.colors.subarray(0, this.vertexCount * 4));
    this.colors = nextColors;
  }

  addPoint(x: number, y: number, style: TextStyle): void {
    this.ensureCapacity(1);
    const vBase = this.vertexCount * POINT_VERTEX_STRIDE_FLOATS;
    const cBase = this.vertexCount * 4;
    this.vertices[vBase] = x - this.originX;
    this.vertices[vBase + 1] = y - this.originY;
    const [r, g, b, a] = style.color;
    this.colors[cBase] = r;
    this.colors[cBase + 1] = g;
    this.colors[cBase + 2] = b;
    this.colors[cBase + 3] = a;
    this.vertexCount += 1;
  }

  finish(): { vertices: Float32Array; colors: Uint8Array } {
    return {
      vertices: this.vertices.subarray(0, this.vertexCount * POINT_VERTEX_STRIDE_FLOATS),
      colors: this.colors.subarray(0, this.vertexCount * 4),
    };
  }
}


