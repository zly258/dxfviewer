/**
 * 交互渲染引擎抽象：WebGL 与 Canvas 2D 两个实现共用同一接口，
 * 查看器可在运行时切换引擎对比效果（视口/选中/图层状态保持不变）。
 */

import type { AnyEntity, CanvasTheme, DxfBlock, DxfLayer, DxfLineType, DxfStyle, DrawingColorMode, ViewPort } from '@/types';

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
  /** 渲染一帧（平移缩放期间每帧调用）。 */
  render(params: EngineRenderParams): void;
  setTheme(theme: CanvasTheme, background: string): void;
  dispose(): void;
  /** 引擎统计（draw calls / 分块 / 图集等，调试面板用）。 */
  readonly stats: Record<string, number>;
}
