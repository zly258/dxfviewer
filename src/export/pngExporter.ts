/**
 * PNG 导出。
 *
 * 只做「尺寸/背景/布局/边距」这类与输出相关的事，渲染交给无头渲染入口，
 * 保证与交互查看器同一套绘制管线（所见即所得）。
 */
import { CanvasTheme, DrawingColorMode, DxfData } from '@/types';
import { HeadlessCanvas, renderSceneToCanvas } from '@/renderer/headless';
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
  /** 总像素上限，默认 2.68 亿（浏览器 Canvas 面积上限的保守值） */
  maxPixels?: number;
  /** 自定义画布工厂（Node/测试环境注入，浏览器无需传） */
  createCanvas?: (width: number, height: number) => HeadlessCanvas;
}

const renderForExport = (data: DxfData, options: PngExportOptions): HeadlessCanvas => {
  const dpr = options.devicePixelRatio ?? 2;
  const safeDpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;

  assertCanvasSize(
    Math.round(options.width * safeDpr),
    Math.round(options.height * safeDpr),
    { maxDimension: options.maxDimension, maxPixels: options.maxPixels },
  );

  return renderSceneToCanvas(data, {
    width: options.width,
    height: options.height,
    layout: options.layout,
    background: options.background === undefined ? '#ffffff' : options.background,
    padding: options.padding,
    theme: options.theme ?? 'white',
    drawingColorMode: options.drawingColorMode,
    hiddenLayers: options.hiddenLayers,
    devicePixelRatio: safeDpr,
    // 导出必须完整：LOD 剔除会让小尺寸实体消失，只存在于交互性能优化。
    lodCulling: false,
    createCanvas: options.createCanvas,
  });
};

/** 导出 PNG Blob（浏览器 / Worker 均可，Worker 中需提供 OffscreenCanvas）。 */
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

// 尺寸校验属于导出公共能力，保留转发以兼容既有引用。
export { assertCanvasSize };
