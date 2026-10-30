/**
 * 矢量 PDF 导出（M7）。
 *
 * - 几何：全部矢量（内容流操作符），无限放大
 * - 文字：浏览器 Canvas 光栅化 → 带 /SMask 的整页透明图层叠加。
 *   原因：浏览器拿不到系统字体的字形轮廓（opentype.js 需要 TTF 字节），
 *   光栅化是零依赖下保真度最高的方案；默认 2pt/px（≈144dpi），打印略软可调高
 * - 多布局 = 多页；1:1 出图与栅格版一致（mm→pt，页边距外扩）
 */
import { CanvasTheme, DrawingColorMode, DxfData } from '@/types';
import { HeadlessCanvas, resolveSceneView, resolveLayout } from '@/renderer/headless';
import { renderEntitiesToCanvas } from '@/renderer/services/canvasRenderService';
import { PdfRenderContext, parseCssColor } from '@/export/pdf/pdfContext';
import { PdfBuildOptions, VectorPdfPage, buildVectorPdf, pdfBytesToBlob } from '@/export/pdf/minimalPdf';
import { deflateBytes, deflateSupported } from '@/export/pdf/compression';
import {
  PaperOrientation,
  PaperSizeInput,
  mmToPt,
  resolvePage,
} from '@/export/paperSizes';

export interface PdfVectorExportOptions {
  /** 标准纸张名或自定义 [宽, 高]（mm），默认 A4 */
  paperSize?: PaperSizeInput;
  /** 方向，默认 portrait */
  orientation?: PaperOrientation;
  /** 页边距（mm），默认 10 */
  marginMm?: number;
  /** 单页布局名/id；缺省用当前激活布局 */
  layout?: string;
  /** 多页输出（与 layout 互斥，优先生效） */
  layouts?: Iterable<string>;
  /** 背景色，默认白；null 表示透明页 */
  background?: string | null;
  /** 内容区内边距（pt），默认 0 */
  padding?: number;
  theme?: CanvasTheme;
  drawingColorMode?: DrawingColorMode;
  hiddenLayers?: Iterable<string>;
  /** PDF 文档标题 */
  title?: string;
  /** 文字光栅化倍率（pt→px），默认 2；过大的页面会自动下调以控制内存 */
  textRasterScale?: number;
  /** 文字图层像素上限，默认 1600 万 */
  textMaxPixels?: number;
  /** 自定义画布工厂（Node/测试环境注入） */
  createCanvas?: (width: number, height: number) => HeadlessCanvas;
}

const DEFAULT_TEXT_RASTER_SCALE = 2;
const DEFAULT_TEXT_MAX_PIXELS = 16_000_000;

const collectLayoutNames = (data: DxfData, options: PdfVectorExportOptions): string[] => {
  if (options.layouts) {
    const names = [...options.layouts].filter(name => typeof name === 'string' && name.length > 0);
    if (names.length === 0) throw new Error('layouts 为空：至少需要一个布局名');
    return names;
  }
  if (options.layout) return [options.layout];
  const fallback = resolveLayout(data);
  return [fallback?.name ?? 'Model'];
};

/**
 * 把文字运行光栅化为整页透明图层（RGB + 灰度 alpha）。
 * 无 Canvas 或像素数据不可得时返回 undefined（页面就没有文字图层）。
 */
const rasterizeTextRuns = async (
  ctx: PdfRenderContext,
  contentWidthPt: number,
  contentHeightPt: number,
  options: PdfVectorExportOptions,
): Promise<VectorPdfPage['textImage']> => {
  const runs = ctx.getTextRuns();
  if (runs.length === 0) return undefined;

  let scale = options.textRasterScale ?? DEFAULT_TEXT_RASTER_SCALE;
  const maxPixels = options.textMaxPixels ?? DEFAULT_TEXT_MAX_PIXELS;
  const contentPixels = contentWidthPt * contentHeightPt;
  if (contentPixels > 0) {
    scale = Math.min(scale, Math.sqrt(maxPixels / contentPixels));
  }
  if (!Number.isFinite(scale) || scale <= 0) scale = 1;

  const widthPx = Math.max(1, Math.ceil(contentWidthPt * scale));
  const heightPx = Math.max(1, Math.ceil(contentHeightPt * scale));

  const createCanvas = options.createCanvas
    ?? ((width: number, height: number): HeadlessCanvas => {
      if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
      }
      if (typeof OffscreenCanvas !== 'undefined') {
        return new OffscreenCanvas(width, height);
      }
      throw new Error('当前环境不支持 Canvas，无法光栅化文字');
    });

  const canvas = createCanvas(widthPx, heightPx);
  const rasterCtx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (!rasterCtx) return undefined;

  rasterCtx.clearRect(0, 0, widthPx, heightPx);

  for (const run of runs) {
    const { size, family, weight, style } = PdfRenderContext.parseFont(run.font);
    rasterCtx.font = `${style ? `${style} ` : ''}${weight ? `${weight} ` : ''}${size * scale}px ${family}`;
    rasterCtx.fillStyle = run.fill;
    rasterCtx.textAlign = run.align;
    rasterCtx.textBaseline = run.baseline;
    // PDF 内容坐标 y 向上，光栅画布 y 向下
    rasterCtx.fillText(
      run.text,
      run.x * scale,
      (contentHeightPt - run.y) * scale,
      run.maxWidth !== undefined ? run.maxWidth * scale : undefined,
    );
  }

  const imageData = rasterCtx.getImageData(0, 0, widthPx, heightPx);
  const source = imageData.data;
  if (source.length < widthPx * heightPx * 4) return undefined;

  const rgb = new Uint8Array(widthPx * heightPx * 3);
  const alpha = new Uint8Array(widthPx * heightPx);
  let opaqueCount = 0;

  for (let pixel = 0, src = 0, dstRgb = 0, dstA = 0; pixel < widthPx * heightPx; pixel++, src += 4, dstRgb += 3, dstA++) {
    const a = source[src + 3];
    alpha[dstA] = a;
    if (a === 0) {
      rgb[dstRgb] = 255;
      rgb[dstRgb + 1] = 255;
      rgb[dstRgb + 2] = 255;
    } else {
      opaqueCount++;
      // 预乘转非预乘：canvas getImageData 返回非预乘 RGBA，直接搬运
      rgb[dstRgb] = source[src];
      rgb[dstRgb + 1] = source[src + 1];
      rgb[dstRgb + 2] = source[src + 2];
    }
  }

  // 全透明图层没有意义
  if (opaqueCount === 0) return undefined;

  const rgbResult = await deflateBytes(rgb);
  const alphaResult = await deflateBytes(alpha);

  return {
    widthPx,
    heightPx,
    rgb: rgbResult.data,
    rgbCompressed: rgbResult.compressed && deflateSupported(),
    alpha: alphaResult.data,
    alphaCompressed: alphaResult.compressed && deflateSupported(),
  };
};

/** 导出矢量 PDF 字节。 */
export const exportPdfVectorBytes = async (
  data: DxfData,
  options: PdfVectorExportOptions = {},
): Promise<Uint8Array> => {
  const layoutNames = collectLayoutNames(data, options);
  const buildOptions: PdfBuildOptions = { title: options.title };
  const pages: VectorPdfPage[] = [];

  for (const layoutName of layoutNames) {
    const page = resolvePage(options.paperSize ?? 'A4', options.orientation ?? 'portrait');
    const marginMm = Number.isFinite(options.marginMm ?? NaN) ? (options.marginMm as number) : 10;
    const marginPt = mmToPt(marginMm);

    const contentWidthPt = page.widthPt - marginPt * 2;
    const contentHeightPt = page.heightPt - marginPt * 2;
    if (contentWidthPt <= 0 || contentHeightPt <= 0) {
      throw new Error(
        `页边距过大：纸张 ${page.widthMm}×${page.heightMm} mm，边距 ${marginMm} mm，内容区尺寸非正。`,
      );
    }

    const ctx = new PdfRenderContext({
      pageWidthPt: contentWidthPt,
      pageHeightPt: contentHeightPt,
      background: options.background === null || options.background === undefined
        ? '#ffffff'
        : options.background,
    });

    const scene = resolveSceneView(data, {
      layout: layoutName,
      width: contentWidthPt,
      height: contentHeightPt,
      padding: options.padding ?? 0,
    });

    renderEntitiesToCanvas({
      ctx,
      entities: scene.entities,
      layers: data.layers ?? {},
      blocks: data.blocks ?? {},
      styles: data.styles ?? {},
      lineTypes: data.lineTypes ?? {},
      ltScale: data.header?.ltScale ?? 1,
      viewPort: scene.viewPort,
      width: contentWidthPt,
      height: contentHeightPt,
      theme: options.theme ?? 'white',
      drawingColorMode: options.drawingColorMode,
      hiddenLayers: new Set(options.hiddenLayers ?? []),
      selectedIds: new Set<string>(),
      lodCulling: false,
      background: null, // 底色由页面矩形（导出器追加）负责，避免叠加两层
    });

    // 底色矩形：透明页时跳过
    const background = options.background === null || options.background === undefined
      ? '#ffffff'
      : options.background;
    let pagePrefix = '';
    if (background) {
      const color = parseCssColor(background);
      const channel = (value: number) => Math.round(value / 255 * 1000) / 1000;
      pagePrefix = `${channel(color.r)} ${channel(color.g)} ${channel(color.b)} rg `
        + `0 0 ${Math.round(contentWidthPt * 1000) / 1000} ${Math.round(contentHeightPt * 1000) / 1000} re f\n`;
    }

    const textImage = await rasterizeTextRuns(ctx, contentWidthPt, contentHeightPt, options);

    const contentStream =
      `q\n1 0 0 1 ${Math.round(marginPt * 1000) / 1000} ${Math.round(marginPt * 1000) / 1000} cm\n`
      + pagePrefix
      + ctx.getContentStream()
      + '\nQ';

    pages.push({
      pageWidthPt: page.widthPt,
      pageHeightPt: page.heightPt,
      contentStream,
      textImage,
    });
  }

  return buildVectorPdf(pages, buildOptions);
};

/** 导出矢量 PDF Blob（浏览器下载直接用）。 */
export const exportPdfVector = async (
  data: DxfData,
  options: PdfVectorExportOptions = {},
): Promise<Blob> => pdfBytesToBlob(await exportPdfVectorBytes(data, options));
