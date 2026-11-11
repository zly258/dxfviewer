/**
 * 交互渲染引擎抽象：WebGL 与 Canvas 2D 两个实现共用同一接口，
 * 查看器可在运行时切换引擎对比效果（视口/选中/图层状态保持不变）。
 */

import type { AnyEntity, CanvasTheme, DxfBlock, DxfLayer, DxfLineType, DxfStyle, DrawingColorMode, ViewPort } from '@/types';
import type { SceneIndex } from '@/render/picking/sceneIndex';

export type EngineKind = 'webgl' | 'canvas';

/** 场景输入（两引擎语义一致）。 */
export interface EngineSceneOptions {
  entities: AnyEntity[];
  /** 渲染纸张空间布局时提供模型空间实体（视口投影用）。 */
  modelEntities?: AnyEntity[];
  layers: Record<string, DxfLayer>;
  blocks: Record<string, DxfBlock>;
  styles: Record<string, DxfStyle>;
  lineTypes: Record<string, DxfLineType>;
  ltScale: number;
  theme: CanvasTheme;
  drawingColorMode: DrawingColorMode;
  hiddenLayers?: Set<string>;
  hiddenEntityIds?: ReadonlySet<string>;
  isolatedEntityIds?: ReadonlySet<string> | null;
  /** 宿主已就绪的场景索引（拾取与视口剔除共用）；未提供时引擎自行兜底。 */
  sceneIndex?: SceneIndex | null;
}

/** 单帧渲染参数。 */
export interface EngineRenderParams {
  viewPort: ViewPort;
  /** CSS 像素尺寸 */
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  selectedIds?: ReadonlySet<string>;
  /** undefined = 主题背景；null = 透明；字符串 = 指定颜色 */
  background?: string | null;
}

export interface InteractiveRenderEngine {
  readonly kind: EngineKind;
  /** 场景重建（实体/图层/样式/可见性/主题变化时调用；低频）。 */
  setScene(options: EngineSceneOptions): void;
  /**
   * 注入宿主已构建好的场景索引（可选）。
   *
   * 宿主（ViewerCanvas）为拾取本来就要建一份索引：大图纸在 Worker 里异步建、
   * 小图纸同步建。引擎若自行再建一份，就是纯粹重复的 CPU 开销
   * （10 万实体同步建树约 170ms，且卡在主线程）。支持该方法的引擎在索引
   * 就绪后直接复用，无需重建场景。
   */
  setSceneIndex?(index: SceneIndex | null): void;
  /** 渲染一帧（平移缩放期间每帧调用）。 */
  render(params: EngineRenderParams): void;
  setTheme(theme: CanvasTheme, background: string): void;
  dispose(): void;
  /** 引擎统计（draw calls / 分块 / 图集等，调试面板用）。 */
  readonly stats: Record<string, number>;
}
