/**
 * WebGL 渲染引擎：分块场景 → 每帧绘制。
 *
 * 每帧流程（零几何重建）：
 * 1. 清屏（主题背景 / 导出白底 / 透明底）；
 * 2. 可选网格背景（全屏三角形 + 解析着色）；
 * 3. 视口剔除（分块包围盒 ∩ 视口）；
 * 4. 填充（实心 + 图案区域）→ 线段（按虚线分组）→ 字形 → 点；
 * 5. 选中高亮（覆盖色重绘选中实体的线段索引段）。
 *
 * 平移/缩放只更新 uniform 矩阵；分块局部坐标 + 原点 uniform 保证大坐标精度。
 */

import type { CanvasTheme } from '@/types';
import { CANVAS_THEME_COLORS, TEXT_RENDER_CONFIG } from '@/config/viewerConfig';
import { GlDevice, GlProgram } from './glDevice';
import { SHADER_SOURCES } from './shaders';
import {
  Chunk,
  uploadChunkToGpu,
  disposeChunkStore,
} from './scene/chunkStore';
import { GlyphAtlas } from '../text/glyphAtlas';
import { buildScene, SceneBuildOptions, BuiltScene } from '../scene/sceneBuilder';
import type { InteractiveRenderEngine } from '../engine';

export interface Viewport {
  targetX: number;
  targetY: number;
  zoom: number;
}

const SELECTION_COLOR = '#00A8FF';

export interface RenderParams {
  viewPort: Viewport;
  /** CSS 像素尺寸 */
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  selectedIds?: ReadonlySet<string>;
  /** undefined = 主题背景；null = 透明（导出叠加用）；字符串 = 指定颜色 */
  background?: string | null;
  showGrid?: boolean;
}

interface SelectionPart {
  chunk: Chunk;
  start: number;
  count: number;
}

export class RenderEngine implements InteractiveRenderEngine {
  readonly kind = 'webgl' as const;
  readonly device: GlDevice;
  private readonly programs: Record<'line' | 'fill' | 'glyph' | 'point' | 'grid', GlProgram>;
  private readonly atlas: GlyphAtlas;

  private scene: BuiltScene | null = null;
  private gridBuffer: WebGLBuffer | null = null;
  private disposed = false;

  private theme: CanvasTheme = 'black';
  private themeBackground = CANVAS_THEME_COLORS.black;

  private selection: {
    ids: string[];
    buffer: WebGLBuffer | null;
    count: number;
    lineParts: SelectionPart[];
    fillParts: SelectionPart[];
    glyphParts: SelectionPart[];
  } | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.device = new GlDevice(canvas);
    this.programs = {
      line: new GlProgram(this.device.gl, SHADER_SOURCES.line.vertex, SHADER_SOURCES.line.fragment),
      fill: new GlProgram(this.device.gl, SHADER_SOURCES.fill.vertex, SHADER_SOURCES.fill.fragment),
      glyph: new GlProgram(this.device.gl, SHADER_SOURCES.glyph.vertex, SHADER_SOURCES.glyph.fragment),
      point: new GlProgram(this.device.gl, SHADER_SOURCES.point.vertex, SHADER_SOURCES.point.fragment),
      grid: new GlProgram(this.device.gl, SHADER_SOURCES.grid.vertex, SHADER_SOURCES.grid.fragment),
    };
    this.atlas = new GlyphAtlas(this.device);
  }

  // ─────────────────────────────────────────────────────────────
  // 场景
  // ─────────────────────────────────────────────────────────────

  /** 重建场景（实体/图层/主题/可见性变化时调用；低频）。 */
  setScene(options: SceneBuildOptions): void {
    this.disposeScene();
    this.scene = buildScene(options, this.atlas);
    for (const chunk of this.scene.chunks) {
      uploadChunkToGpu(this.device, chunk);
    }
    this.atlas.uploadDirtyPages();
    this.selection = null;
  }

  get stats(): BuiltScene['stats'] & { atlasPages: number; atlasGlyphs: number } {
    const a = this.atlas.stats;
    return this.scene
      ? { ...this.scene.stats, atlasPages: a.pages, atlasGlyphs: a.glyphs }
      : { entities: 0, bakedEntities: 0, lineVertices: 0, fillVertices: 0, glyphVertices: 0, points: 0, chunks: 0, atlasPages: a.pages, atlasGlyphs: a.glyphs };
  }

  setTheme(theme: CanvasTheme, background: string): void {
    if (this.theme !== theme) this.selection = null;
    this.theme = theme;
    this.themeBackground = background;
  }

  // ─────────────────────────────────────────────────────────────
  // 绘制
  // ─────────────────────────────────────────────────────────────

  render(params: RenderParams): void {
    if (this.disposed || !this.scene) return;
    const { viewPort, cssWidth, cssHeight, dpr } = params;
    const pixelWidth = Math.max(1, Math.round(cssWidth * dpr));
    const pixelHeight = Math.max(1, Math.round(cssHeight * dpr));
    this.device.resize(pixelWidth, pixelHeight);

    const gl = this.device.gl;
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const bgColor = params.background === undefined
      ? this.themeBackground
      : params.background;
    if (bgColor === null) {
      gl.clearColor(0, 0, 0, 0);
    } else {
      const [r, g, b] = hexToNormalized(bgColor);
      gl.clearColor(r, g, b, 1);
    }
    gl.clear(gl.COLOR_BUFFER_BIT);

    const pxPerModel = viewPort.zoom * dpr;
    const halfW = cssWidth / 2 / viewPort.zoom;
    const halfH = cssHeight / 2 / viewPort.zoom;
    const viewMinX = viewPort.targetX - halfW;
    const viewMaxX = viewPort.targetX + halfW;
    const viewMinY = viewPort.targetY - halfH;
    const viewMaxY = viewPort.targetY + halfH;

    const visibleChunks = this.scene.chunks.filter(chunk =>
      chunk.bounds.maxX >= viewMinX && chunk.bounds.minX <= viewMaxX &&
      chunk.bounds.maxY >= viewMinY && chunk.bounds.minY <= viewMaxY);

    /** 模型（分块局部）→ 裁剪。世界 Y 向上，裁剪 Y 向上：不翻转。 */
    const projOf = (originX: number, originY: number): Float32Array => {
      const sx = viewPort.zoom / (cssWidth / 2);
      const sy = viewPort.zoom / (cssHeight / 2);
      return new Float32Array([
        sx, 0, 0,
        0, sy, 0,
        (originX - viewPort.targetX) * sx,
        (originY - viewPort.targetY) * sy,
        1,
      ]);
    };

    if (params.showGrid) {
      this.renderGrid(params, pxPerModel);
    }

    // ── 按构建顺序执行分块绘制指令（drawOps 语义 = 实体绘制顺序） ──
    // 填充 → 线段 → 字形 → 点在同一循环内按 op 切换程序，保证
    // 图案填充 / WIPEOUT 遮罩 / 边界线的层叠关系与 Canvas 渲染一致。
    let activeProgram: GlProgram | null = null;
    let activeScissorId = -1;
    const applyScissor = (clipRectId: number): void => {
      if (clipRectId === activeScissorId) return;
      activeScissorId = clipRectId;
      if (clipRectId < 0) {
        gl.disable(gl.SCISSOR_TEST);
        return;
      }
      const rect = this.scene!.clipRects[clipRectId];
      if (!rect) {
        gl.disable(gl.SCISSOR_TEST);
        return;
      }
      const toPxX = (x: number) => (x - viewPort.targetX) * viewPort.zoom * dpr + pixelWidth / 2;
      const toPxYTop = (y: number) => pixelHeight / 2 - (y - viewPort.targetY) * viewPort.zoom * dpr;
      const x = Math.max(0, Math.floor(toPxX(rect.minX)));
      const yTop = toPxYTop(rect.maxY);
      const y = Math.max(0, Math.floor(pixelHeight - yTop - (rect.maxY - rect.minY) * viewPort.zoom * dpr));
      const w = Math.min(pixelWidth - x, Math.ceil((rect.maxX - rect.minX) * viewPort.zoom * dpr));
      const h = Math.min(pixelHeight - y, Math.ceil((rect.maxY - rect.minY) * viewPort.zoom * dpr));
      if (w <= 0 || h <= 0) {
        gl.disable(gl.SCISSOR_TEST);
        return;
      }
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(x, y, w, h);
    };

    const useProgram = (program: GlProgram): void => {
      if (activeProgram !== program) {
        program.use();
        activeProgram = program;
      }
    };

    // 程序级常量 uniform（每帧一次）。
    const lineProgram = this.programs.line;
    lineProgram.use();
    gl.uniform2f(lineProgram.locateUniform('u_viewportSize'), pixelWidth, pixelHeight);
    gl.uniform1f(lineProgram.locateUniform('u_pxPerModel'), pxPerModel);
    gl.uniform1f(lineProgram.locateUniform('u_featherPx'), 0.8);
    gl.uniform4f(lineProgram.locateUniform('u_overrideColor'), 0, 0, 0, 0);
    const fillProgram = this.programs.fill;
    fillProgram.use();
    gl.uniform1f(fillProgram.locateUniform('u_fillMode'), 0);
    gl.uniform2f(fillProgram.locateUniform('u_patternDir'), 1, 0);
    gl.uniform1f(fillProgram.locateUniform('u_patternSpacing'), 1);
    gl.uniform1f(fillProgram.locateUniform('u_pxPerModel'), pxPerModel);
    const glyphProgram = this.programs.glyph;
    glyphProgram.use();
    gl.uniform1i(glyphProgram.locateUniform('u_atlas'), 0);
    const pointProgram = this.programs.point;
    pointProgram.use();
    gl.uniform1f(pointProgram.locateUniform('u_pointSizePx'), Math.max(3, dpr * 3));

    // 字形图集上传（首次使用时）。
    this.atlas.uploadDirtyPages();

    // 文字 LOD 阈值：文字投影高度低于该值（CSS 像素）时跳过该条文字指令。
    // 采用逐 op 字高判定（而非分块最小值），避免"一张图里有一行极小字 →
    // 整块文字都不显示"的过度剔除。
    // 与 Canvas 引擎共用同一常量，保证双引擎在任意缩放下显示的文字集合一致。
    const minTextScreenPx = TEXT_RENDER_CONFIG.minimumTextRenderPixelHeight;
    // 判定用 CSS 像素：pxPerModel 含 dpr（设备像素），此处换算回 CSS 像素，
    // 否则高 DPI 屏上阈值被放大一倍、文字会更晚出现。
    const pxPerModelCss = viewPort.zoom;

    for (const chunk of visibleChunks) {
      const gpu = chunk.gpu;
      if (!gpu) continue;
      if (gpu.lineIndexCount === 0 && gpu.fillVertexCount === 0 && gpu.glyphVertexCount === 0 && gpu.pointVertexCount === 0) continue;

      const proj = projOf(chunk.originX, chunk.originY);
      // 分块内最小字高都达标的，整块文字直接画（快速路径）。
      const allTextVisible = chunk.textOpsStart < 0 || chunk.minTextHeight * pxPerModelCss >= minTextScreenPx;
      for (let opIdx = 0; opIdx < chunk.drawOps.length; opIdx++) {
        const op = chunk.drawOps[opIdx];
        if (!allTextVisible && opIdx >= chunk.textOpsStart && op.textHeight !== undefined
          && op.textHeight * pxPerModelCss < minTextScreenPx) continue;
        applyScissor(op.clipRectId);
        switch (op.mesh) {
          case 'line': {
            if (gpu.lineIndexCount === 0) break;
            useProgram(lineProgram);
            this.bindLineVao(gpu);
            gl.uniformMatrix3fv(lineProgram.locateUniform('u_proj'), false, proj);
            this.setDashUniforms(lineProgram, op.dashIdx > 0 ? this.scene.dashPatterns[op.dashIdx - 1] : null, pxPerModel);
            gl.drawElements(gl.TRIANGLES, op.count, gl.UNSIGNED_INT, op.start * 4);
            break;
          }
          case 'fill': {
            if (gpu.fillVertexCount === 0) break;
            useProgram(fillProgram);
            this.bindFillVao(gpu);
            gl.uniformMatrix3fv(fillProgram.locateUniform('u_proj'), false, proj);
            gl.uniform2f(fillProgram.locateUniform('u_chunkOrigin'), chunk.originX, chunk.originY);
            if (op.hatchRegionId >= 0) {
              const region = chunk.hatchRegions[op.hatchRegionId];
              if (region) {
                gl.uniform1f(fillProgram.locateUniform('u_fillMode'), region.mode);
                gl.uniform2f(fillProgram.locateUniform('u_patternDir'), region.dir[0], region.dir[1]);
                gl.uniform1f(fillProgram.locateUniform('u_patternSpacing'), region.spacing);
              }
            } else {
              gl.uniform1f(fillProgram.locateUniform('u_fillMode'), 0);
            }
            gl.drawArrays(gl.TRIANGLES, op.start, op.count);
            break;
          }
          case 'glyph': {
            if (gpu.glyphVertexCount === 0) break;
            useProgram(glyphProgram);
            this.bindGlyphVao(gpu);
            // 字形四边形的 UV 引用图集页号（顶点 attr 4），绘制前绑定对应纹理。
            // 当前实现：全部字形落页 0（单页图集），显式绑定防止单元 0 被占用。
            this.atlas.bindPage(0, 0);
            gl.uniformMatrix3fv(glyphProgram.locateUniform('u_proj'), false, proj);
            gl.drawArrays(gl.TRIANGLES, op.start, op.count);
            break;
          }
          case 'point': {
            if (gpu.pointVertexCount === 0) break;
            useProgram(pointProgram);
            this.bindPointVao(gpu);
            gl.uniformMatrix3fv(pointProgram.locateUniform('u_proj'), false, proj);
            gl.drawArrays(gl.POINTS, op.start, op.count);
            break;
          }
        }
      }
    }
    applyScissor(-1);

    // ── 选中叠加 ──
    if (params.selectedIds && params.selectedIds.size > 0) {
      this.renderSelectionOverlay(params, visibleChunks, projOf, pxPerModel, pixelWidth, pixelHeight);
    }
  }

  private setDashUniforms(program: GlProgram, pattern: number[] | null, _pxPerModel: number): void {
    const gl = this.device.gl;
    if (!pattern || !pattern.length) {
      gl.uniform1f(program.locateUniform('u_dashPeriod'), 0);
      return;
    }
    let total = 0;
    for (const v of pattern) total += Math.abs(v);
    gl.uniform1f(program.locateUniform('u_dashPeriod'), total);
    const segs = [0, 0, 0, 0];
    for (let i = 0; i < Math.min(4, pattern.length); i++) segs[i] = pattern[i];
    gl.uniform4f(program.locateUniform('u_dashSegs'), segs[0], segs[1], segs[2], segs[3]);
  }

  // ─────────────────────────────────────────────────────────────
  // 网格背景
  // ─────────────────────────────────────────────────────────────

  private renderGrid(params: RenderParams, pxPerModel: number): void {
    const gl = this.device.gl;
    const program = this.programs.grid;
    program.use();
    if (!this.gridBuffer) {
      this.gridBuffer = this.device.createBuffer(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]));
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.gridBuffer);
    const loc = program.locateAttrib('a_corner');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const { viewPort } = params;
    const sx = viewPort.zoom / (params.cssWidth / 2);
    const sy = viewPort.zoom / (params.cssHeight / 2);
    const inv = new Float32Array([
      1 / sx, 0, 0,
      0, 1 / sy, 0,
      viewPort.targetX, viewPort.targetY, 1,
    ]);
    gl.uniformMatrix3fv(program.locateUniform('u_projInv'), false, inv);
    gl.uniform1f(program.locateUniform('u_pxPerModel'), pxPerModel);
    const dark = this.theme === 'black';
    gl.uniform3f(program.locateUniform('u_gridMinor'), dark ? 0.32 : 0.82, dark ? 0.32 : 0.82, dark ? 0.32 : 0.82);
    gl.uniform3f(program.locateUniform('u_gridMajor'), dark ? 0.46 : 0.68, dark ? 0.46 : 0.68, dark ? 0.46 : 0.68);
    gl.uniform3f(program.locateUniform('u_axisX'), 0.80, 0.38, 0.38);
    gl.uniform3f(program.locateUniform('u_axisY'), 0.38, 0.68, 0.38);
    gl.uniform1f(program.locateUniform('u_gridStepPx'), 100);
    gl.uniform1f(program.locateUniform('u_opacity'), 1.0);
    gl.uniform1f(program.locateUniform('u_axesEnabled'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // grid 使用裸 attrib 绑定，重置 VAO 防止污染后续绑定。
    this.device.bindVao(null);
    this.invalidateVaoCache();
  }

  // ─────────────────────────────────────────────────────────────
  // 选中叠加
  // ─────────────────────────────────────────────────────────────

  private renderSelectionOverlay(
    params: RenderParams,
    visibleChunks: Chunk[],
    projOf: (x: number, y: number) => Float32Array,
    pxPerModel: number,
    pixelWidth: number,
    pixelHeight: number,
  ): void {
    const selected = params.selectedIds!;
    const ids = Array.from(selected);
    const prev = this.selection;
    const sameSelection = !!prev && prev.ids.length === ids.length && ids.every(id => prev.ids.includes(id));
    if (!sameSelection) this.rebuildSelectionBuffer(ids);

    const state = this.selection;
    if (!state || state.count === 0) return;

    const gl = this.device.gl;
    const sel = hexToNormalized(SELECTION_COLOR);

    // 1. 线段高亮
    if (state.lineParts.length > 0 && state.buffer) {
      const program = this.programs.line;
      program.use();
      gl.uniform2f(program.locateUniform('u_viewportSize'), pixelWidth, pixelHeight);
      gl.uniform1f(program.locateUniform('u_featherPx'), 0.8);
      this.setDashUniforms(program, null, pxPerModel);
      gl.uniform4f(program.locateUniform('u_overrideColor'), sel[0], sel[1], sel[2], 0.95);

      for (const part of state.lineParts) {
        if (!visibleChunks.includes(part.chunk)) continue;
        const gpu = part.chunk.gpu;
        if (!gpu?.vaoLine) continue;
        this.bindLineVao(gpu);
        gl.uniformMatrix3fv(program.locateUniform('u_proj'), false, projOf(part.chunk.originX, part.chunk.originY));
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, state.buffer);
        gl.drawElements(gl.TRIANGLES, part.count, gl.UNSIGNED_INT, part.start * 4);
      }
      for (const part of state.lineParts) {
        const gpu = part.chunk.gpu;
        if (!gpu?.vaoLine || !gpu.iboLine) continue;
        this.device.bindVao(gpu.vaoLine);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpu.iboLine);
      }
    }

    // 2. 填充高亮（含矢量文字三角形、实心填充）
    if (state.fillParts.length > 0) {
      const fillProg = this.programs.fill;
      fillProg.use();
      gl.uniform4f(fillProg.locateUniform('u_overrideColor'), sel[0], sel[1], sel[2], 0.95);
      gl.uniform1f(fillProg.locateUniform('u_fillMode'), 0.0);

      for (const part of state.fillParts) {
        if (!visibleChunks.includes(part.chunk)) continue;
        const gpu = part.chunk.gpu;
        if (!gpu?.vaoFill) continue;
        this.bindFillVao(gpu);
        gl.uniformMatrix3fv(fillProg.locateUniform('u_proj'), false, projOf(part.chunk.originX, part.chunk.originY));
        gl.drawArrays(gl.TRIANGLES, part.start, part.count);
      }
      gl.uniform4f(fillProg.locateUniform('u_overrideColor'), 0, 0, 0, 0);
    }

    // 3. 图集字形高亮
    if (state.glyphParts.length > 0) {
      const glyphProg = this.programs.glyph;
      glyphProg.use();
      gl.uniform1i(glyphProg.locateUniform('u_atlas'), 0);
      gl.uniform4f(glyphProg.locateUniform('u_overrideColor'), sel[0], sel[1], sel[2], 0.95);
      this.atlas.bindPage(0, 0);

      for (const part of state.glyphParts) {
        if (!visibleChunks.includes(part.chunk)) continue;
        const gpu = part.chunk.gpu;
        if (!gpu?.vaoGlyph) continue;
        this.bindGlyphVao(gpu);
        gl.uniformMatrix3fv(glyphProg.locateUniform('u_proj'), false, projOf(part.chunk.originX, part.chunk.originY));
        gl.drawArrays(gl.TRIANGLES, part.start, part.count);
      }
      gl.uniform4f(glyphProg.locateUniform('u_overrideColor'), 0, 0, 0, 0);
    }

    this.device.bindVao(null);
    this.invalidateVaoCache();
  }

  private rebuildSelectionBuffer(ids: string[]): void {
    const gl = this.device.gl;
    const scene = this.scene;
    if (!scene) return;

    const lineIndices: number[] = [];
    const lineParts: SelectionPart[] = [];
    const fillParts: SelectionPart[] = [];
    const glyphParts: SelectionPart[] = [];
    let lineCursor = 0;

    for (const chunk of scene.chunks) {
      const partLineStart = lineCursor;
      for (const [entityId, ranges] of chunk.entityRanges) {
        if (!ids.includes(entityId)) continue;
        if (ranges.line && ranges.line.count > 0) {
          for (let i = 0; i < ranges.line.count; i++) {
            lineIndices.push(chunk.lineIndices[ranges.line.start + i]);
          }
          lineCursor += ranges.line.count;
        }
        if (ranges.fill && ranges.fill.count > 0) {
          fillParts.push({ chunk, start: ranges.fill.start, count: ranges.fill.count });
        }
        if (ranges.glyph && ranges.glyph.count > 0) {
          glyphParts.push({ chunk, start: ranges.glyph.start, count: ranges.glyph.count });
        }
      }
      if (lineCursor > partLineStart) {
        lineParts.push({ chunk, start: partLineStart, count: lineCursor - partLineStart });
      }
    }

    if (this.selection?.buffer) gl.deleteBuffer(this.selection.buffer);
    this.selection = {
      ids,
      buffer: lineIndices.length ? this.device.createBuffer(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(lineIndices)) : null,
      count: lineIndices.length + fillParts.length + glyphParts.length,
      lineParts,
      fillParts,
      glyphParts,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // 导出与生命周期
  // ─────────────────────────────────────────────────────────────

  /** 读取画布像素（GL 自下而上 → 翻转为自上而下 RGBA）。 */
  readCanvasPixels(width: number, height: number): Uint8Array {
    const data = this.device.readPixels(0, 0, width, height);
    const flipped = new Uint8Array(data.length);
    const rowBytes = width * 4;
    for (let y = 0; y < height; y++) {
      flipped.set(data.subarray((height - 1 - y) * rowBytes, (height - y) * rowBytes), y * rowBytes);
    }
    return flipped;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disposeScene();
    if (this.selection?.buffer) this.device.deleteBuffer(this.selection.buffer);
    if (this.gridBuffer) this.device.deleteBuffer(this.gridBuffer);
    Object.values(this.programs).forEach(p => p.dispose());
    this.atlas.dispose();
    this.device.dispose();
  }

  private disposeScene(): void {
    if (this.scene) {
      disposeChunkStore(this.device, this.scene.chunks);
      this.scene = null;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // VAO 绑定缓存（GL 的 VAO 绑定是全局状态，单一跟踪变量即可）
  // ─────────────────────────────────────────────────────────────

  private boundVao: WebGLVertexArrayObject | null = null;

  private bindLineVao(gpu: NonNullable<Chunk['gpu']>): void {
    if (this.boundVao !== gpu.vaoLine) {
      this.device.bindVao(gpu.vaoLine);
      this.boundVao = gpu.vaoLine;
    }
  }
  private bindFillVao(gpu: NonNullable<Chunk['gpu']>): void {
    if (this.boundVao !== gpu.vaoFill) {
      this.device.bindVao(gpu.vaoFill);
      this.boundVao = gpu.vaoFill;
    }
  }
  private bindGlyphVao(gpu: NonNullable<Chunk['gpu']>): void {
    if (this.boundVao !== gpu.vaoGlyph) {
      this.device.bindVao(gpu.vaoGlyph);
      this.boundVao = gpu.vaoGlyph;
    }
  }
  private bindPointVao(gpu: NonNullable<Chunk['gpu']>): void {
    if (this.boundVao !== gpu.vaoPoint) {
      this.device.bindVao(gpu.vaoPoint);
      this.boundVao = gpu.vaoPoint;
    }
  }
  private invalidateVaoCache(): void {
    this.boundVao = null;
  }
}

const hexToNormalized = (hex: string): [number, number, number] => {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b];
};




