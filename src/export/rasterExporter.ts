/**
 * WebGL 栅格导出：把一份 DxfData 渲染到离屏画布并读回像素。
 *
 * 与交互查看器共用同一套 RenderEngine / 场景构建（所见即所得）：
 * 离屏 canvas 建 WebGL2 上下文 → setScene → render（白底/透明底）→
 * readPixels 回读 → 落到 2D 画布（供 toBlob / toDataURL / JPEG 编码）。
 *
 * 每次导出创建临时引擎并在完成后释放，不占用常驻 GL 上下文。
 */

import type { CanvasTheme, DrawingColorMode, DxfData, ViewPort } from '@/types';
import { RenderEngine } from '@/render/webgl/renderEngine';
import { CanvasRenderEngine } from '@/render/canvas/CanvasRenderEngine';

import { resolveSceneView } from './sceneView';
import type { HeadlessCanvas } from './canvasUtils';

export type { HeadlessCanvas };

export interface RasterRenderOptions {
  /** 画布 CSS 像素宽度 */
  width: number;
  /** 画布 CSS 像素高度 */
  height: number;
  /** 布局名/id，缺省取激活布局 */
  layout?: string;
  /** 背景色：默认白色；null 表示透明底 */
  background?: string | null;
  /** 内边距（CSS 像素），默认 24 */
  padding?: number;
  theme?: CanvasTheme;
  drawingColorMode?: DrawingColorMode;
  hiddenLayers?: Iterable<string>;
  /** 设备像素比（输出分辨率 = width × dpr） */
  devicePixelRatio?: number;
  /** 显式视口（导出当前视图）：提供时跳过 fit 适配 */
  viewPort?: ViewPort;
}

const createCanvasElement = (width: number, height: number): HTMLCanvasElement | OffscreenCanvas => {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  throw new Error('当前环境不支持 Canvas（既无 document 也无 OffscreenCanvas），无法执行栅格导出');
};

/**
 * 渲染一份图纸到 2D 画布（像素已就绪，可直接 toBlob/toDataURL）。
 *
 * 抛错场景：环境不支持 WebGL2、尺寸超出 GL 限制、参数非法。
 */
export const renderSceneToRasterCanvas = (
  data: DxfData,
  options: RasterRenderOptions,
): HeadlessCanvas => {
  const {
    width,
    height,
    layout: layoutName,
    background = '#ffffff',
    padding = 24,
    theme = 'white',
    drawingColorMode = 'original',
    hiddenLayers,
    devicePixelRatio = 1,
    viewPort: explicitViewPort,
  } = options;

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`无效的导出尺寸：${width}×${height}`);
  }
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const pixelWidth = Math.round(width * dpr);
  const pixelHeight = Math.round(height * dpr);

  // 与交互查看器同一判定：轮廓字体不可用时，GPU 文字只能退化为字形图集/描边
  // 字体（字号不一、标点走形），必须改由 Canvas 2D 文字层绘制后叠加。
  const textOverlayActive = true;

  const glCanvas = createCanvasElement(pixelWidth, pixelHeight);
  const engine = new RenderEngine(glCanvas as HTMLCanvasElement);
  try {
    const scene = resolveSceneView(data, { layout: layoutName, width, height, padding, viewPort: explicitViewPort });

    engine.setScene({
      entities: scene.entities,
      // 纸张空间布局的视口需要投影模型空间内容
      modelEntities: scene.layout?.isModel ? undefined : data.entities,
      layers: data.layers ?? {},
      blocks: data.blocks ?? {},
      styles: data.styles ?? {},
      lineTypes: data.lineTypes ?? {},
      ltScale: data.header?.ltScale ?? 1,
      theme,
      drawingColorMode,
      hiddenLayers: new Set(hiddenLayers ?? []),
      // 导出补偿：以 1280 物理像素为基准放大线宽（与旧导出管线语义一致）。
      lineWidthScale: Math.max(1, pixelWidth / 1280),
      // overlay 模式下文字由 Canvas 层合成；sdf 模式下文字已在 GPU 网格里。
      skipText: textOverlayActive,
    });
    engine.render({
      viewPort: scene.viewPort,
      cssWidth: width,
      cssHeight: height,
      dpr,
      background,
    });

    // 文字层：与交互渲染一致，文字由浏览器原生文本引擎绘制后叠加到栅格上
    // （GL 场景已跳过文字烘焙，保证导出与屏幕显示逐像素同源）。
    const textCanvas = createCanvasElement(pixelWidth, pixelHeight);
    let textCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
    try {
      textCtx = textCanvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    } catch {
      textCtx = null;
    }

    // 读回像素 → 2D 画布（GL 自下而上 → 翻转为自上而下）。
    const pixels = engine.readCanvasPixels(pixelWidth, pixelHeight);
    const out = createCanvasElement(pixelWidth, pixelHeight);
    const ctx = (out as HTMLCanvasElement).getContext('2d') as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!ctx) throw new Error('无法获取 2D 上下文（像素落盘失败）');
    const imageData = ctx.createImageData(pixelWidth, pixelHeight);
    imageData.data.set(pixels);
    ctx.putImageData(imageData, 0, 0);

    // 文字覆盖层再叠到输出画布上。
    if (textCtx && textOverlayActive) {
      try {
        const textEngine = new CanvasRenderEngine(textCanvas as HTMLCanvasElement, { textOnly: true });
        try {
          textEngine.setTheme(theme, background ?? '#ffffff');
          textEngine.setScene({
            entities: scene.entities,
            modelEntities: scene.layout?.isModel ? undefined : data.entities,
            layers: data.layers ?? {},
            blocks: data.blocks ?? {},
            styles: data.styles ?? {},
            lineTypes: data.lineTypes ?? {},
            ltScale: data.header?.ltScale ?? 1,
            theme,
            drawingColorMode,
            hiddenLayers: new Set(hiddenLayers ?? []),
          });
          textEngine.render({
            viewPort: scene.viewPort,
            cssWidth: width,
            cssHeight: height,
            dpr,
            background: null,
          } as never);
        } finally {
          textEngine.dispose();
        }
        ctx.drawImage(textCanvas as CanvasImageSource, 0, 0);
      } catch {
        /* 文字层失败不影响几何导出 */
      }
    }
    return out;
  } finally {
    engine.dispose();
  }
};






