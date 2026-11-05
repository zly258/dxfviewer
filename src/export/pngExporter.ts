/**
 * PNG 导出。
 *
 * 只做「尺寸/背景/布局/边距」这类与输出相关的事，渲染交给 WebGL 栅格导出
 * （与交互查看器同一套 RenderEngine，所见即所得）。
 */
import { CanvasTheme, DrawingColorMode, DxfData, ViewPort } from '@/types';
import { renderSceneToRasterCanvas, HeadlessCanvas } from '@/export/rasterExporter';
import { assertCanvasSize } from '@/export/limits';
import { blobToDataUrl, canvasToBlob } from '@/export/canvasUtils';

export interface PngExportOptions {
  /** 输出宽度（CSS 像素） */
  width: number;
  /** 输出高度（CSS 像素） */
  height: number;
  /** 布局名/id，缺省为当前激活布局 */
  layout?: string;
  /** 背景色，默认白色；null 表示透明底 */
  background?: string | null;
  /** 内边距（CSS 像素），默认 24 */
  padding?: number;
  theme?: CanvasTheme;
  drawingColorMode?: DrawingColorMode;
  hiddenLayers?: Iterable<string>;
  /** 设备像素比，默认 2（高清导出）；与 width/height 相乘得到实际像素尺寸 */
  devicePixelRatio?: number;
  /** 单边像素上限，默认 16384 */
  maxDimension?: number;
  /** 总像素上限，默认 2.68 亿 */
  maxPixels?: number;
  /** 显式视口：提供时不做 fit 适配，按该视口渲染（导出当前视图） */
  viewPort?: ViewPort;
}

/** 导出 PNG Blob（浏览器主线程；需要 WebGL2 支持）。 */
export const exportPng = async (
  data: DxfData,
  options: PngExportOptions,
): Promise<Blob> => canvasToBlob(renderForExport(data, options), 'image/png');

/** 导出 PNG dataURL（便于直接塞进 <img src> 或下载链接）。 */
export const exportPngDataUrl = async (
  data: DxfData,
  options: PngExportOptions,
): Promise<string> => {
  const canvas = renderForExport(data, options);

  if (typeof (canvas as HTMLCanvasElement).toDataURL === 'function') {
    return (canvas as HTMLCanvasElement).toDataURL('image/png');
  }

  return blobToDataUrl(await canvasToBlob(canvas, 'image/png'));
};

const renderForExport = (data: DxfData, options: PngExportOptions): HeadlessCanvas => {
  const dpr = options.devicePixelRatio ?? 2;
  const safeDpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;

  assertCanvasSize(
    Math.round(options.width * safeDpr),
    Math.round(options.height * safeDpr),
    { maxDimension: options.maxDimension, maxPixels: options.maxPixels },
  );

  return renderSceneToRasterCanvas(data, {
    width: options.width,
    height: options.height,
    layout: options.layout,
    background: options.background === undefined ? '#ffffff' : options.background,
    padding: options.padding,
    theme: options.theme ?? 'white',
    drawingColorMode: options.drawingColorMode,
    hiddenLayers: options.hiddenLayers,
    devicePixelRatio: safeDpr,
    viewPort: options.viewPort,
  });
};

// 尺寸校验属于导出公共能力，保留转发以兼容既有引用。
export { assertCanvasSize };
