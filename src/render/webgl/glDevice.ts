/**
 * WebGL 设备层：上下文创建、能力探测与资源封装。
 *
 * 设计原则：
 * - 引擎其余模块只依赖本文件暴露的 `GlDevice`，不直接持有原生 GL 对象之外的全局状态；
 * - 仅支持 WebGL2（GLSL ES 3.00）：VAO、R8 纹理、着色器 uniform 数组动态索引都是
 *   分块渲染管线的基础依赖；WebGL1 已是 2020 年代遗留能力，不再维护双份着色器；
 * - 所有资源创建/销毁经过 device，便于统一排查泄漏。
 */

export interface GlCapabilities {
  /** 一次 draw 支持的最大顶点属性数 */
  maxVertexAttribs: number;
  /** 纹理最大尺寸（字形图集分页依据） */
  maxTextureSize: number;
  /** 单次 uniform 向量上限（虚线模式表容量依据） */
  maxFragmentUniformVectors: number;
}

/** 封装一个 GL 程序：着色器 + uniform/attribute 位置缓存。 */
export class GlProgram {
  readonly program: WebGLProgram;
  private readonly uniformLocations = new Map<string, WebGLUniformLocation | null>();
  private readonly attribLocations = new Map<string, number>();

  constructor(
    private readonly gl: WebGL2RenderingContext,
    vertexSource: string,
    fragmentSource: string,
  ) {
    this.program = createProgram(gl, vertexSource, fragmentSource);
  }

  use(): void {
    this.gl.useProgram(this.program);
  }

  locateUniform(name: string): WebGLUniformLocation | null {
    let loc = this.uniformLocations.get(name);
    if (loc === undefined) {
      loc = this.gl.getUniformLocation(this.program, name);
      this.uniformLocations.set(name, loc);
    }
    return loc;
  }

  /**
   * 数组 uniform 的定位。
   *
   * GLSL ES 3.00 里 `uniform vec4 u_clipPoly[64];` 的 location 只能通过
   * `u_clipPoly[0]` 取到；用基名 `u_clipPoly` 查询会返回 null，
   * 导致整块数组静默不上传（图案填充失去裁剪、溢出到边界外）。
   */
  locateUniformArray(name: string): WebGLUniformLocation | null {
    return this.locateUniform(`${name}[0]`);
  }

  locateAttrib(name: string): number {
    let loc = this.attribLocations.get(name);
    if (loc === undefined) {
      loc = this.gl.getAttribLocation(this.program, name);
      this.attribLocations.set(name, loc);
    }
    return loc;
  }

  dispose(): void {
    this.gl.deleteProgram(this.program);
  }
}

export class GlDevice {
  readonly gl: WebGL2RenderingContext;
  readonly caps: GlCapabilities;
  private readonly buffers = new Set<WebGLBuffer>();
  private readonly textures = new Set<WebGLTexture>();
  private disposed = false;

  constructor(readonly canvas: HTMLCanvasElement) {
    const attrs: WebGLContextAttributes = {
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
      // 导出 readPixels 需要读取回绘帧内容。
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    };
    const gl = canvas.getContext('webgl2', attrs) as WebGL2RenderingContext | null;
    if (!gl) {
      throw new Error('当前浏览器不支持 WebGL2，无法渲染图纸。请使用较新版本的 Chrome / Edge / Firefox / Safari。');
    }
    this.gl = gl;
    this.caps = {
      maxVertexAttribs: gl.getParameter(gl.MAX_VERTEX_ATTRIBS),
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      maxFragmentUniformVectors: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS),
    };
  }

  createBuffer(target: number, data: ArrayBufferView): WebGLBuffer {
    const gl = this.gl;
    const buf = gl.createBuffer();
    if (!buf) throw new Error('WebGLBuffer 创建失败');
    gl.bindBuffer(target, buf);
    gl.bufferData(target, data as BufferSource, gl.STATIC_DRAW);
    this.buffers.add(buf);
    return buf;
  }

  /** 覆写既有缓冲内容（尺寸可变化；重建场景时复用缓冲对象）。 */
  uploadBuffer(target: number, buffer: WebGLBuffer, data: ArrayBufferView): void {
    const gl = this.gl;
    gl.bindBuffer(target, buffer);
    gl.bufferData(target, data as BufferSource, gl.STATIC_DRAW);
  }

  deleteBuffer(buffer: WebGLBuffer | null): void {
    if (!buffer) return;
    this.gl.deleteBuffer(buffer);
    this.buffers.delete(buffer);
  }

  createTexture(): WebGLTexture | null {
    const tex = this.gl.createTexture();
    return tex;
  }

  deleteTexture(tex: WebGLTexture | null): void {
    if (!tex) return;
    this.gl.deleteTexture(tex);
  }

  createVao(): WebGLVertexArrayObject | null {
    return this.gl.createVertexArray();
  }

  bindVao(vao: WebGLVertexArrayObject | null): void {
    this.gl.bindVertexArray(vao);
  }

  deleteVao(vao: WebGLVertexArrayObject | null): void {
    if (!vao) return;
    this.gl.deleteVertexArray(vao);
  }

  /** 画布尺寸变化（drawing buffer 重设后调用）。 */
  resize(pixelWidth: number, pixelHeight: number): void {
    if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth;
    if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight;
    this.gl.viewport(0, 0, pixelWidth, pixelHeight);
  }

  /** 读取当前画布像素（PNG 导出用，返回 RGBA 8bit，GL 坐标自下而上）。 */
  readPixels(x: number, y: number, width: number, height: number): Uint8Array {
    const pixels = new Uint8Array(width * height * 4);
    this.gl.readPixels(x, y, width, height, this.gl.RGBA, this.gl.UNSIGNED_BYTE, pixels);
    return pixels;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.buffers.forEach(buf => this.gl.deleteBuffer(buf));
    this.textures.forEach(tex => this.gl.deleteTexture(tex));
    this.buffers.clear();
    this.textures.clear();
    // 上下文本身交由浏览器随 canvas 回收。
  }
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('WebGLShader 创建失败');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`着色器编译失败: ${log ?? 'unknown'}`);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error('WebGLProgram 创建失败');
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`着色器链接失败: ${log ?? 'unknown'}`);
  }
  return program;
}
