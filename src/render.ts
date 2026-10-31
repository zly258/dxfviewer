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

/** 渲染缓存（文字测量/布局）清理：切换图纸或隔离渲染对比时使用。 */
export { clearAllRenderCaches } from '@/renderer/services/renderCache';

/**
 * 扁平 BVH 工具：与场景索引 Worker 使用同一实现，可在自托管 Worker 或
 * Node 校验脚本中直接复用（等价性回归）。
 */
export { buildFlatBvh } from '@/renderer/services/flatBvh';
export type { FlatBvh } from '@/renderer/services/flatBvh';
export {
  collectSceneIndexBuildInput,
  createFlatSceneIndex,
  finalizeSceneIndex,
  SCENE_INDEX_ASYNC_THRESHOLD,
} from '@/renderer/services/sceneIndexBuilder';
export type { SceneIndexBuildInput } from '@/renderer/services/sceneIndexBuilder';
