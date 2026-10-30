/**
 * SVG 导出（矢量，M6）。
 *
 * 与 PNG/PDF 共用同一套无头渲染管线（resolveSceneView + renderEntitiesToCanvas），
 * 仅把绘制后端换成 SvgRenderContext，因此取景、留白与 PNG 完全一致，
 * 放大任意倍数都是矢量。
 *
 * 文字以 <text> 输出（字体名沿用 fontResolver 的系统字体映射），
 * 大多数矢量场景够用；需要「绝对一致」的出版级输出走 M7 矢量 PDF（文字轮廓化）。
 */
import { CanvasTheme, DrawingColorMode, DxfData, ViewPort } from '@/types';
import { resolveSceneView } from '@/renderer/headless';
import { renderEntitiesToCanvas } from '@/renderer/services/canvasRenderService';
import { SvgRenderContext } from '@/export/svg/svgContext';

export interface SvgExportOptions {
  /** 画布宽度（CSS 像素，即 SVG 用户单位） */
  width: number;
  /** 画布高度 */
  height: number;
  /** 布局名/id，缺省为当前激活布局 */
  layout?: string;
  /** 背景色，默认白色；null 表示透明 */
  background?: string | null;
  /** 内边距（像素），默认 24，与 exportPng 一致 */
  padding?: number;
  theme?: CanvasTheme;
  drawingColorMode?: DrawingColorMode;
  hiddenLayers?: Iterable<string>;
  /** 显式视口：提供时不做 fit 适配（导出当前视图） */
  viewPort?: ViewPort;
}

/**
 * 渲染为 SVG 文本。
 *
 * 纯同步、零 DOM 依赖（不需要 Canvas），Node/Worker 亦可调用。
 */
export const exportSvg = (
  data: DxfData,
  options: SvgExportOptions,
): string => {
  const {
    width,
    height,
    layout,
    background = '#ffffff',
    padding = 24,
    theme = 'white',
    drawingColorMode = 'original',
    hiddenLayers,
    viewPort,
  } = options;

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`无效的导出尺寸：${width}×${height}`);
  }

  const scene = resolveSceneView(data, { layout, width, height, padding, viewPort });
  const svg = new SvgRenderContext(width, height, background);

  renderEntitiesToCanvas({
    ctx: svg,
    entities: scene.entities,
    layers: data.layers ?? {},
    blocks: data.blocks ?? {},
    styles: data.styles ?? {},
    lineTypes: data.lineTypes ?? {},
    ltScale: data.header?.ltScale ?? 1,
    viewPort: scene.viewPort,
    width,
    height,
    theme,
    drawingColorMode,
    hiddenLayers: new Set(hiddenLayers ?? []),
    selectedIds: new Set<string>(),
    // 导出必须完整
    lodCulling: false,
    background: null, // 背景由 SvgRenderContext 构造函数绘制，避免双重底色
    // 线宽补偿：大尺寸导出时线条保持视觉粗细
    lineWidthScale: Math.max(1, width / 1280),
  });

  return svg.toString();
};
