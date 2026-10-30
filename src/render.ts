/**
 * 无头渲染入口（不依赖 React / 不引入样式）。
 *
 * 适用于：导出 PNG/PDF、缩略图生成、Web Worker 内渲染、Node（需自备 Canvas）。
 */
export { renderEntitiesToCanvas } from '@/renderer/services/canvasRenderService';
export type { RenderSceneOptions } from '@/renderer/services/canvasRenderService';

export { renderSceneToCanvas, resolveLayout, resolveLayoutExtents } from '@/renderer/headless';
export type { HeadlessCanvas, RenderSceneToCanvasOptions } from '@/renderer/headless';

export { extentsFromBounds, fitExtentsToBox, fitPaperLayoutToBox } from '@/renderer/services/viewportFitting';
export type { Extents2D, FitBoxOptions } from '@/renderer/services/viewportFitting';

export { createSceneIndex } from '@/renderer/services/sceneIndex';
export type { SceneBounds, SceneIndex } from '@/renderer/services/sceneIndex';
