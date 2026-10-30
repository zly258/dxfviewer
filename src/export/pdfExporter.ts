/**
 * PDF 导出（栅格版，M3）。
 *
 * 做法：按纸张尺寸渲染布局到离屏画布 → 编码 JPEG → 用最小 PDF 写出器内嵌为整页图像。
 * 因此输出的 PDF 是位图页（不可选字、放大后为像素），换来的是零依赖与实现确定性；
 * 矢量页在 M7（显示列表 + PDF 内容流后端）实现。
 *
 * 比例保证：页面内容区尺寸 = 纸张尺寸 − 2×页边距，画布像素 = 内容区 mm 按 dpi 换算，
 * 图像铺满内容区。这样「图上 100 mm 线段在 1:1 打印下量出 100 mm」成立，
 * dpi 只影响清晰度而不改变比例。
 */
import { CanvasTheme, DrawingColorMode, DxfData } from '@/types';
import { HeadlessCanvas, renderSceneToCanvas, resolveLayout } from '@/renderer/headless';
import { assertCanvasSize } from '@/export/limits';
import { canvasToBytes } from '@/export/canvasUtils';
import {
  PaperOrientation,
  PaperSizeInput,
  mmToPixels,
  mmToPt,
  resolvePage,
} from '@/export/paperSizes';
import { PdfImagePlacement, buildPdfFromJpegPages, pdfBytesToBlob } from '@/export/pdf/minimalPdf';

export interface PdfExportOptions {
  /** 标准纸张名或自定义 [宽, 高]（mm），默认 A4 */
  paperSize?: PaperSizeInput;
  /** 方向，默认 portrait */
  orientation?: PaperOrientation;
  /** 页边距（mm），默认 10 */
  marginMm?: number;
  /** 栅格分辨率（dpi），默认 300 */
  dpi?: number;
  /** 单页布局名/id；缺省用当前激活布局 */
  layout?: string;
  /** 多页输出：按顺序把每个布局写成一页（与 layout 互斥，优先生效） */
  layouts?: Iterable<string>;
  /**
   * 背景色。PDF 页无透明通道：传 null 会按白色处理。
   */
  background?: string | null;
  /** 内容区内边距（像素），默认 0（图纸铺满内容区，保证 1:1 比例） */
  padding?: number;
  /** JPEG 质量 0–1，默认 0.92 */
  jpegQuality?: number;
  theme?: CanvasTheme;
  drawingColorMode?: DrawingColorMode;
  hiddenLayers?: Iterable<string>;
  /** PDF 文档标题元数据 */
  title?: string;
  maxDimension?: number;
  maxPixels?: number;
  /** 自定义画布工厂（Node/测试环境注入） */
  createCanvas?: (width: number, height: number) => HeadlessCanvas;
}

const DEFAULT_DPI = 300;
const DEFAULT_MARGIN_MM = 10;
const DEFAULT_JPEG_QUALITY = 0.92;

const collectLayoutNames = (data: DxfData, options: PdfExportOptions): string[] => {
  if (options.layouts) {
    const names = [...options.layouts].filter(name => typeof name === 'string' && name.length > 0);
    if (names.length === 0) throw new Error('layouts 为空：至少需要一个布局名');
    return names;
  }
  if (options.layout) return [options.layout];
  const fallback = resolveLayout(data);
  return [fallback?.name ?? 'Model'];
};

/** 渲染单个布局并返回一页 PDF 放置数据。 */
const renderPage = async (
  data: DxfData,
  layoutName: string,
  options: PdfExportOptions,
): Promise<PdfImagePlacement> => {
  const dpi = Number.isFinite(options.dpi ?? NaN) && (options.dpi as number) > 0
    ? (options.dpi as number)
    : DEFAULT_DPI;

  const page = resolvePage(options.paperSize ?? 'A4', options.orientation ?? 'portrait');
  const marginMm = Number.isFinite(options.marginMm ?? NaN) ? (options.marginMm as number) : DEFAULT_MARGIN_MM;

  const contentWidthMm = page.widthMm - marginMm * 2;
  const contentHeightMm = page.heightMm - marginMm * 2;
  if (contentWidthMm <= 0 || contentHeightMm <= 0) {
    throw new Error(
      `页边距过大：纸张 ${page.widthMm}×${page.heightMm} mm，边距 ${marginMm} mm，内容区尺寸非正。`,
    );
  }

  const pixelWidth = mmToPixels(contentWidthMm, dpi);
  const pixelHeight = mmToPixels(contentHeightMm, dpi);
  assertCanvasSize(pixelWidth, pixelHeight, {
    maxDimension: options.maxDimension,
    maxPixels: options.maxPixels,
  });

  const canvas = renderSceneToCanvas(data, {
    width: pixelWidth,
    height: pixelHeight,
    layout: layoutName,
    background: options.background === null || options.background === undefined
      ? '#ffffff'
      : options.background,
    padding: options.padding ?? 0,
    theme: options.theme ?? 'white',
    drawingColorMode: options.drawingColorMode,
    hiddenLayers: options.hiddenLayers,
    devicePixelRatio: 1,
    lodCulling: false,
    createCanvas: options.createCanvas,
  });

  const jpeg = await canvasToBytes(canvas, 'image/jpeg', options.jpegQuality ?? DEFAULT_JPEG_QUALITY);

  return {
    jpeg,
    widthPx: pixelWidth,
    heightPx: pixelHeight,
    pageWidthPt: page.widthPt,
    pageHeightPt: page.heightPt,
    xPt: mmToPt(marginMm),
    // PDF 原点在左下角，图像上边距即页顶往下一段留白，因此 Y 取 margin。
    yPt: mmToPt(marginMm),
    drawWidthPt: mmToPt(contentWidthMm),
    drawHeightPt: mmToPt(contentHeightMm),
  };
};

/** 导出 PDF 字节（Node/测试友好）。 */
export const exportPdfBytes = async (
  data: DxfData,
  options: PdfExportOptions = {},
): Promise<Uint8Array> => {
  const layoutNames = collectLayoutNames(data, options);
  const placements: PdfImagePlacement[] = [];
  for (const name of layoutNames) {
    placements.push(await renderPage(data, name, options));
  }
  return buildPdfFromJpegPages(placements, { title: options.title });
};

/** 导出 PDF Blob（浏览器下载直接用）。 */
export const exportPdf = async (
  data: DxfData,
  options: PdfExportOptions = {},
): Promise<Blob> => pdfBytesToBlob(await exportPdfBytes(data, options));
