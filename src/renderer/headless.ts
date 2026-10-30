/**
 * 无头渲染入口。
 *
 * 目标：不依赖 React、不依赖交互状态，把一份 `DxfData` 按「装进指定像素画布」
 * 的方式渲染出来。导出（PNG / PDF）与未来的缩略图、服务端预渲染都走这里。
 *
 * 与交互查看器的关系：两者共用 `renderEntitiesToCanvas` 与 `viewportFitting`，
 * 差别只在「背景、选中集、LOD、DPR」这些由参数显式控制的开关。
 */
import {
  CanvasTheme,
  DrawingColorMode,
  DxfData,
  DxfLayout,
  AnyEntity,
  ViewPort,
} from '@/types';
import { renderEntitiesToCanvas } from '@/renderer/services/canvasRenderService';
import { SceneIndex } from '@/renderer/services/sceneIndex';
import { fitExtentsToBox, fitPaperLayoutToBox } from '@/renderer/services/viewportFitting';

export type HeadlessCanvas = HTMLCanvasElement | OffscreenCanvas;

export interface RenderSceneToCanvasOptions {
  /** 画布 CSS 像素宽度 */
  width: number;
  /** 画布 CSS 像素高度 */
  height: number;
  /** 布局名或布局 id，缺省取 `data.activeLayoutName`，再退回模型空间 */
  layout?: string;
  /** 背景色：默认白色；传 null 表示透明底（调用方需自行清空画布） */
  background?: string | null;
  /** 内边距（CSS 像素），默认 24 */
  padding?: number;
  theme?: CanvasTheme;
  drawingColorMode?: DrawingColorMode;
  hiddenLayers?: Iterable<string>;
  /** 设备像素比，默认 1（导出应显式指定以控制输出分辨率） */
  devicePixelRatio?: number;
  /** 是否启用 LOD 剔除，导出默认关闭 */
  lodCulling?: boolean;
  sceneIndex?: SceneIndex;
  /** 自定义画布工厂（Node/测试环境注入） */
  createCanvas?: (width: number, height: number) => HeadlessCanvas;
  /**
   * 显式指定视口（「导出当前视图」用）。
   * 提供时跳过 fit 适配，直接按该视口渲染——所见即所得。
   */
  viewPort?: ViewPort;
}

const DEFAULT_PADDING = 24;

/**
 * 按布局名/id 查找布局；找不到时回退到模型空间，再回退到首个布局。
 */
export const resolveLayout = (data: DxfData, name?: string): DxfLayout | undefined => {
  const layouts = data.layouts ?? [];
  if (name) {
    const target = name.trim();
    const matched = layouts.find(layout =>
      layout.name === target
      || layout.id === target
      || layout.displayName === target,
    );
    if (matched) return matched;
  }
  const active = layouts.find(layout => layout.name === data.activeLayoutName);
  if (active) return active;
  return layouts.find(layout => layout.isModel) ?? layouts[0];
};

/**
 * 取布局可用的包围盒：布局自带 extents 优先，其次 paper 范围，最后退回整图 extents。
 */
export const resolveLayoutExtents = (
  data: DxfData,
  layout: DxfLayout | undefined,
): DxfLayout['extents'] | DxfData['extents'] => layout?.extents ?? data.extents;

const createDefaultCanvas = (width: number, height: number): HeadlessCanvas => {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  throw new Error('当前环境不支持 Canvas（既无 document 也无 OffscreenCanvas）');
};

/**
 * 渲染一份图纸到画布。
 *
 * 返回的 canvas 已按 `devicePixelRatio` 放大物理像素，逻辑坐标仍为 CSS 像素。
 */
export const renderSceneToCanvas = (
  data: DxfData,
  options: RenderSceneToCanvasOptions,
): HeadlessCanvas => {
  const {
    width,
    height,
    layout: layoutName,
    background = '#ffffff',
    padding = DEFAULT_PADDING,
    theme = 'white',
    drawingColorMode = 'original',
    hiddenLayers,
    devicePixelRatio = 1,
    lodCulling = false,
    sceneIndex,
    createCanvas = createDefaultCanvas,
    viewPort: explicitViewPort,
  } = options;

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`无效的导出尺寸：${width}×${height}`);
  }

  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const canvas = createCanvas(Math.round(width * dpr), Math.round(height * dpr));

  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (!ctx) throw new Error('无法获取 2D 渲染上下文');

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);

  const scene = resolveSceneView(data, { layout: layoutName, width, height, padding, viewPort: explicitViewPort });

  renderEntitiesToCanvas({
    ctx,
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
    sceneIndex,
    background,
    lodCulling,
    // 导出补偿：以 1280 物理像素为基准放大线宽。
    // PNG 默认 dpr=2（1280 CSS px → 2560 物理像素），必须按物理像素算，
    // 否则高分辨率图里线条只有屏幕视觉粗细的一半。
    lineWidthScale: Math.max(1, (width * dpr) / 1280),
  });

  return canvas;
};

export interface SceneView {
  layout: DxfLayout | undefined;
  entities: AnyEntity[];
  viewPort: ViewPort;
}

/**
 * 解析布局 + 计算适配视口。
 *
 * Canvas（PNG）与 SVG 两个后端共用，保证同一份图纸在两种导出里的
 * 取景与留白完全一致。
 */
export const resolveSceneView = (
  data: DxfData,
  options: {
    layout?: string;
    width: number;
    height: number;
    padding?: number;
    /** 显式视口（导出当前视图）：提供时跳过 fit 适配 */
    viewPort?: ViewPort;
  },
): SceneView => {
  const layout = resolveLayout(data, options.layout);
  const extents = resolveLayoutExtents(data, layout);
  const viewPort = options.viewPort
    ?? (layout && !layout.isModel
      ? fitPaperLayoutToBox(layout, options.width, options.height, { padding: options.padding })
      : fitExtentsToBox(extents, options.width, options.height, { padding: options.padding }));

  const entities = layout?.entities?.length
    ? layout.entities
    : (data.entities ?? []);

  return { layout, entities, viewPort };
};
