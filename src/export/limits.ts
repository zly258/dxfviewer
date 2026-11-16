/**
 * 光栅输出尺寸保护。
 *
 * 浏览器对单个 Canvas 的面积/边长有硬性上限（各厂商不同，Safari 更严格），
 * 超限往往表现为「空白图」而不是报错。导出前必须先校验并给出可执行的提示。
 */

/** 单边像素上限（保守值，覆盖 Chrome/Firefox/Safari 常见限制）。 */
export const DEFAULT_MAX_DIMENSION = 16384;
/** 总像素上限：约 2.68 亿（256 MP）。 */
export const DEFAULT_MAX_PIXELS = 268_435_456;

export interface CanvasSizeLimits {
  maxDimension?: number;
  maxPixels?: number;
}

/**
 * 校验像素尺寸；超限时抛出带建议的 Error。
 */
export const assertCanvasSize = (
  pixelWidth: number,
  pixelHeight: number,
  limits: CanvasSizeLimits = {},
): void => {
  const maxDimension = limits.maxDimension ?? DEFAULT_MAX_DIMENSION;
  const maxPixels = limits.maxPixels ?? DEFAULT_MAX_PIXELS;

  if (!Number.isFinite(pixelWidth) || !Number.isFinite(pixelHeight) || pixelWidth <= 0 || pixelHeight <= 0) {
    throw new Error(`无效的导出尺寸：${pixelWidth}×${pixelHeight}`);
  }

  if (pixelWidth > maxDimension || pixelHeight > maxDimension) {
    throw new Error(
      `导出尺寸过大：${pixelWidth}×${pixelHeight} 像素超过单边上限 ${maxDimension}。`
      + '请降低 devicePixelRatio（或 dpi），或改用 PDF 导出。',
    );
  }

  if (pixelWidth * pixelHeight > maxPixels) {
    const megapixels = (pixelWidth * pixelHeight / 1_000_000).toFixed(1);
    throw new Error(
      `导出尺寸过大：${pixelWidth}×${pixelHeight}（约 ${megapixels} 百万像素）超过上限 `
      + `${(maxPixels / 1_000_000).toFixed(0)} 百万像素。请降低尺寸后重试。`,
    );
  }
};
