/**
 * 字形图集：系统字体（TTF/中文字体）字形 → 单通道遮罩纹理页。
 *
 * 用途：WebGL 文字渲染的光栅缓存。SHX 描边字体不走图集（它们是线段字形，
 * 直接进线段网格）；TTF 与 CJK 字符按「页」光栅化：
 * - 每页 1024×1024，R8 单通道，行式装箱（shelf packing）；
 * - 字形以固定 em 尺寸（rasterPx）光栅化一次，场景构建时按文字字高缩放
 *   四边形尺寸——烘焙网格与缩放解耦；
 * - 渲染前 uploadDirtyPages() 把脏页上传 GPU。
 */

import type { GlDevice } from '../webgl/glDevice';
import { buildSdfPage } from './sdf';

export interface AtlasGlyph {
  page: number;
  /** 图集 UV（0..1，v 自上而下） */
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** 字形四边形尺寸（px @ rasterPx em 尺寸） */
  widthPx: number;
  heightPx: number;
  /** 笔位到字形左/基线的偏移（px，Y 向上为正） */
  offsetX: number;
  offsetY: number;
  /** 步进宽度（px @ rasterPx） */
  advancePx: number;
}

export interface GlyphStyleKey {
  fontFamily: string;
  bold: boolean;
  italic: boolean;
}

export const PAGE_SIZE = 1024;
/** 字形光栅 em 尺寸（px）：SDF 下 96px 已足够任意缩放锐利，且每页可容纳更多字形。 */
export const RASTER_PX = 96;
/** 每侧留白（px）= SDF 距离场半宽，避免双线性采样串页并容纳边缘过渡。 */
export const GLYPH_SDF_SPREAD = 6;
const GLYPH_PADDING = GLYPH_SDF_SPREAD;
const MAX_PAGES = 64;

interface PageState {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  cursorX: number;
  cursorY: number;
  rowHeight: number;
  dirty: boolean;
}

export class GlyphAtlas {
  private readonly pages: PageState[] = [];
  private readonly glyphs = new Map<string, AtlasGlyph>();
  private readonly gl: GlDevice;
  /** 2D 数组纹理：所有页作为一个纹理的 layer（页号 = layer）。 */
  private arrayTexture: WebGLTexture | null = null;
  /** 已上传到 GPU 的页数（数组深度）。 */
  private uploadedDepth = 0;
  /** 缺字统计：超限后停止光栅化（极端图纸防御）。 */
  private missingCount = 0;
  /** 字体大写字母高度比（capHeight / em），按样式缓存。 */
  private readonly capRatios = new Map<string, number>();
  /** 单字形 SDF 计算用的临时画布（按需扩容复用）。 */
  private cellCanvas: { canvas: OffscreenCanvas | HTMLCanvasElement; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D; w: number; h: number } | null = null;

  /** 取（或扩容）单字形临时画布。 */
  private ensureCellCanvas(w: number, h: number): { canvas: OffscreenCanvas | HTMLCanvasElement; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } {
    if (this.cellCanvas && this.cellCanvas.w >= w && this.cellCanvas.h >= h) return this.cellCanvas;
    const cw = Math.max(w, this.cellCanvas?.w ?? 0);
    const ch = Math.max(h, this.cellCanvas?.h ?? 0);
    let canvas: OffscreenCanvas | HTMLCanvasElement;
    let ctx2d: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (typeof OffscreenCanvas !== 'undefined') {
      canvas = new OffscreenCanvas(cw, ch);
      ctx2d = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
    } else {
      const el = document.createElement('canvas');
      el.width = cw;
      el.height = ch;
      canvas = el;
      ctx2d = el.getContext('2d') as CanvasRenderingContext2D;
    }
    this.cellCanvas = { canvas, ctx: ctx2d, w: cw, h: ch };
    return this.cellCanvas;
  }

  constructor(gl: GlDevice) {
    this.gl = gl;
  }

  /** 字体「大写字高 / em」比值：CAD 文字字高 = 大写字高，需据此换算 em 尺寸。 */
  getCapRatio(style: GlyphStyleKey): number {
    const styleId = `${style.fontFamily}\u0000${style.bold ? 1 : 0}\u0000${style.italic ? 1 : 0}`;
    const cached = this.capRatios.get(styleId);
    if (cached) return cached;

    let ratio = 0.7;
    try {
      const page = this.allocatePage();
      const ctx = page.ctx;
      const weight = style.bold ? '700' : '400';
      const slant = style.italic ? 'italic ' : '';
      ctx.font = `${slant}${weight} ${RASTER_PX}px ${style.fontFamily}`;
      const metrics = ctx.measureText('H');
      const ascent = metrics.actualBoundingBoxAscent;
      if (Number.isFinite(ascent) && ascent > 0) {
        ratio = Math.min(1.2, Math.max(0.4, ascent / RASTER_PX));
      }
    } catch {
      /* 保持默认值 */
    }
    this.capRatios.set(styleId, ratio);
    return ratio;
  }

  /** 字形缓存键。 */
  private static key(style: GlyphStyleKey, char: string): string {
    return `${style.fontFamily}\u0000${style.bold ? 1 : 0}\u0000${style.italic ? 1 : 0}\u0000${char}`;
  }

  /** 取字形（未缓存时同步光栅化）。 */
  get(style: GlyphStyleKey, char: string): AtlasGlyph | undefined {
    const key = GlyphAtlas.key(style, char);
    const cached = this.glyphs.get(key);
    if (cached) return cached;

    const glyph = this.rasterize(style, char, key);
    if (!glyph) {
      this.missingCount++;
      return undefined;
    }
    this.glyphs.set(key, glyph);
    return glyph;
  }

  /** 统计信息（调试/面板用）。 */
  get stats(): { pages: number; glyphs: number } {
    return { pages: this.pages.length, glyphs: this.glyphs.size };
  }

  private rasterize(style: GlyphStyleKey, char: string, key: string): AtlasGlyph | undefined {
    if (!char.trim() || char.codePointAt(0)! < 32) return undefined;
    if (this.pages.length >= MAX_PAGES) return undefined; // 硬上限（防极端图纸爆显存）
    let page = this.allocatePage();
    const ctx = page.ctx;

    const weight = style.bold ? '700' : '400';
    const slant = style.italic ? 'italic ' : '';
    ctx.font = `${slant}${weight} ${RASTER_PX}px ${style.fontFamily}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#fff';

    const metrics = ctx.measureText(char);
    const left = Math.ceil(Math.max(0, -metrics.actualBoundingBoxLeft)) + GLYPH_PADDING;
    const right = Math.ceil(Math.max(1, metrics.actualBoundingBoxRight)) + GLYPH_PADDING;
    const ascent = Math.ceil(Math.max(metrics.actualBoundingBoxAscent, RASTER_PX * 0.02)) + GLYPH_PADDING;
    const descent = Math.ceil(Math.max(metrics.actualBoundingBoxDescent, 1)) + GLYPH_PADDING;
    const w = left + right;
    const h = ascent + descent;

    // 行式装箱：当前行放不下则换行；换行后整页仍放不下则强制开新页。
    if (page.cursorX + w > PAGE_SIZE) {
      page.cursorX = 0;
      page.cursorY += page.rowHeight;
      page.rowHeight = 0;
    }
    if (page.cursorY + h > PAGE_SIZE) {
      if (this.pages.length >= MAX_PAGES) return undefined;
      page = this.allocatePage(true);
    }
    const x = page.cursorX;
    const y = page.cursorY;
    page.cursorX += w;
    page.rowHeight = Math.max(page.rowHeight, h);

    // ── 逐字形计算 SDF ──
    // 必须按「单个字形单元」算距离场：若整页一次计算，相邻字形的墨迹会侵入
    // 本字形的留白区，导致边缘被邻居污染（实测「翼缘」显示成「翼且」）。
    const cell = this.ensureCellCanvas(w, h);
    const cellCtx = cell.ctx;
    cellCtx.clearRect(0, 0, w, h);
    cellCtx.font = ctx.font;
    cellCtx.textAlign = 'left';
    cellCtx.textBaseline = 'alphabetic';
    cellCtx.fillStyle = '#fff';
    cellCtx.fillText(char, left, ascent - GLYPH_PADDING);

    const mask = cellCtx.getImageData(0, 0, w, h);
    const sdf = buildSdfPage(mask, GLYPH_SDF_SPREAD);
    // 写回页面（R 通道存距离场，A 置 255）。
    const out = cellCtx.createImageData(w, h);
    for (let p = 0, q = 0; q < sdf.length; p += 4, q++) {
      out.data[p] = sdf[q];
      out.data[p + 1] = sdf[q];
      out.data[p + 2] = sdf[q];
      out.data[p + 3] = 255;
    }
    page.ctx.putImageData(out, x, y);
    page.dirty = true;

    const glyph: AtlasGlyph = {
      page: this.pages.indexOf(page),
      u0: x / PAGE_SIZE,
      v0: y / PAGE_SIZE,
      u1: (x + w) / PAGE_SIZE,
      v1: (y + h) / PAGE_SIZE,
      widthPx: w,
      heightPx: h,
      // 笔位 → 四边形左下角：左移 left（含留白），下移到 descent 底。
      offsetX: -left,
      offsetY: -(descent - GLYPH_PADDING),
      advancePx: metrics.width,
    };
    void key;
    return glyph;
  }

  /** 取（或创建）有空间的页；force = 无条件开新页。 */
  private allocatePage(force = false): PageState {
    const last = this.pages[this.pages.length - 1];
    if (!force && last && last.cursorY + last.rowHeight < PAGE_SIZE && last.cursorX < PAGE_SIZE) return last;
    const create = (): { canvas: OffscreenCanvas | HTMLCanvasElement; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } => {
      if (typeof OffscreenCanvas !== 'undefined') {
        const canvas = new OffscreenCanvas(PAGE_SIZE, PAGE_SIZE);
        return { canvas, ctx: canvas.getContext('2d') as OffscreenCanvasRenderingContext2D };
      }
      const canvas = document.createElement('canvas');
      canvas.width = PAGE_SIZE;
      canvas.height = PAGE_SIZE;
      return { canvas, ctx: canvas.getContext('2d') as CanvasRenderingContext2D };
    };
    const { canvas, ctx } = create();
    ctx.clearRect(0, 0, PAGE_SIZE, PAGE_SIZE);
    const page: PageState = {
      canvas,
      ctx,
      cursorX: 0,
      cursorY: 0,
      rowHeight: 0,
      dirty: true,
    };
    this.pages.push(page);
    return page;
  }

  /** 上传所有脏页到 2D 数组纹理（渲染前调用；重复调用零开销）。
   *  多页字形必须用 TEXTURE_2D_ARRAY：若只绑页 0，其余页的字形会采样到
   *  页 0 同 UV 位置的其它字符（表现为文字字符错乱）。 */
  uploadDirtyPages(): void {
    const gl = this.gl.gl;
    if (!this.pages.length) return;
    if (!this.arrayTexture) this.arrayTexture = this.gl.createTexture();
    const tex = this.arrayTexture;
    if (!tex) return;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    const prevPages = this.uploadedDepth;
    if (this.uploadedDepth < this.pages.length) {
      // 扩容：重新分配整个数组（已有 layer 内容一并重传）。
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage3D(
        gl.TEXTURE_2D_ARRAY, 0, gl.R8, PAGE_SIZE, PAGE_SIZE, this.pages.length,
        0, gl.RED, gl.UNSIGNED_BYTE, null,
      );
      this.uploadedDepth = this.pages.length;
      // 扩容后所有已上传页需要重传。
      for (let i = 0; i < Math.min(prevPages, this.pages.length); i++) this.pages[i].dirty = true;
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    for (let i = 0; i < this.pages.length; i++) {
      const page = this.pages[i];
      if (!page.dirty && i < prevPages) continue;
      // 页内已是逐字形 SDF（见 rasterize），直接取 R 通道上传。
      const image = page.ctx.getImageData(0, 0, PAGE_SIZE, PAGE_SIZE);
      const red = new Uint8Array(PAGE_SIZE * PAGE_SIZE);
      for (let p = 0, q = 0; q < red.length; p += 4, q++) red[q] = image.data[p];
      gl.texSubImage3D(
        gl.TEXTURE_2D_ARRAY, 0, 0, 0, i,
        PAGE_SIZE, PAGE_SIZE, 1, gl.RED, gl.UNSIGNED_BYTE, red,
      );
      page.dirty = false;
    }
  }

  /** 绑定图集数组纹理（unit 0）。 */
  bindPage(_page: number, unit: number = 0): void {
    const gl = this.gl.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.arrayTexture);
  }

  dispose(): void {
    if (this.arrayTexture) this.gl.deleteTexture(this.arrayTexture);
    this.arrayTexture = null;
    this.pages.length = 0;
    this.glyphs.clear();
  }
}






