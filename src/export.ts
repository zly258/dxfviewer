/**
 * 导出入口（PNG / PDF）。
 *
 * 依赖 Canvas 能力：浏览器主线程、Worker（OffscreenCanvas）可用；
 * Node 环境需注入自定义画布实现（createCanvas 选项）。
 */
export { assertCanvasSize, exportPng, exportPngDataUrl } from '@/export/pngExporter';
export type { PngExportOptions } from '@/export/pngExporter';

export { exportPdf, exportPdfBytes } from '@/export/pdfExporter';
export type { PdfExportOptions } from '@/export/pdfExporter';

export { exportPdfVector, exportPdfVectorBytes } from '@/export/pdf/vectorExporter';
export type { PdfVectorExportOptions } from '@/export/pdf/vectorExporter';

export { exportSvg } from '@/export/svgExporter';
export type { SvgExportOptions } from '@/export/svgExporter';

export {
  MM_PER_INCH,
  MM_TO_PT,
  PAPER_SIZES,
  mmToPixels,
  mmToPt,
  ptToMm,
  resolvePage,
} from '@/export/paperSizes';
export type {
  PaperOrientation,
  PaperSizeInput,
  PaperSpec,
  ResolvedPage,
  StandardPaperSize,
} from '@/export/paperSizes';

export type { PdfImagePlacement } from '@/export/pdf/minimalPdf';
