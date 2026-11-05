/**
 * 导出入口（PNG / SVG / 矢量 PDF）。
 *
 * PNG：WebGL 栅格导出（与交互查看器同一 RenderEngine，所见即所得）；
 * SVG / PDF：矢量写出（render/vector 场景写入器，无限放大）。
 * 依赖 WebGL2（PNG）与 Canvas 编码能力；矢量导出零 DOM 依赖（Node 可用）。
 */
export { assertCanvasSize, exportPng, exportPngDataUrl } from '@/export/pngExporter';
export type { PngExportOptions } from '@/export/pngExporter';

export { exportPdfVector, exportPdfVectorBytes } from '@/export/pdf/vectorExporter';
export type { PdfVectorExportOptions } from '@/export/pdf/vectorExporter';

export { exportSvg } from '@/export/svgExporter';
export type { SvgExportOptions } from '@/export/svgExporter';

export { renderSceneToRasterCanvas } from '@/export/rasterExporter';
export type { RasterRenderOptions } from '@/export/rasterExporter';
export type { HeadlessCanvas } from '@/export/canvasUtils';

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

