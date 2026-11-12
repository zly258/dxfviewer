/**
 * 渲染入口（不依赖 React / 不引入样式）。
 *
 * - 交互渲染：WebGL2 引擎（`RenderEngine`）
 * - 矢量导出：场景写入器（`renderVectorScene`，SVG / PDF 后端共用）
 * - 拾取：CPU 命中测试（`hitTest` / `hitTestBox`，与渲染后端无关）
 * - SHX 形字体：宿主可注册真实 .shx 文件提升文字保真度
 */
export { RenderEngine } from '@/render/webgl/renderEngine';
export type { RenderParams, Viewport } from '@/render/webgl/renderEngine';

/** 场景构建（高级用法 / 测试：不依赖 React，可配合自定义宿主使用）。 */
export { buildScene } from '@/render/scene/sceneBuilder';
export type { BuiltScene, SceneBuildOptions } from '@/render/scene/sceneBuilder';

export { renderVectorScene, createVectorRenderSession } from '@/render/vector/sceneWriter';
export type { VectorSceneOptions, VectorRenderSession } from '@/render/vector/sceneWriter';
export type { VectorContext, RenderPaint, RenderTextMetrics } from '@/render/vector/context';

export { hitTest, hitTestBox } from '@/render/picking/hitTest';

// ── SHX 形字体：宿主可注册真实 .shx 文件提升文字保真度 ──
export { parseShxFont } from '@/render/text/shx/shxParser';
export type { StrokeFontData, StrokeGlyph } from '@/render/text/shx/shxParser';
export { registerParsedShxFont, resolveStrokeFont } from '@/render/text/shx/strokeFontRegistry';
export { setOutlineFont, setFallbackOutlineFont, loadOutlineFont, hasOutlineFont, hasOutlineFontCjkCoverage, getGlyphMesh, measureOutlineTextWidth } from '@/render/text/outlineText';
export type { GlyphMesh } from '@/render/text/outlineText';

export { extentsFromBounds, fitExtentsToBox, fitPaperLayoutToBox } from '@/render/viewportFitting';
export type { Extents2D, FitBoxOptions } from '@/render/viewportFitting';

export { createSceneIndex } from '@/render/picking/sceneIndex';
export type { SceneBounds, SceneIndex } from '@/render/picking/sceneIndex';

/** 渲染缓存（文字测量/布局）清理：切换图纸或隔离渲染对比时使用。 */
export { clearAllRenderCaches } from '@/render/text/renderCache';

/**
 * 扁平 BVH 工具：与场景索引 Worker 使用同一实现，可在自托管 Worker 或
 * Node 校验脚本中直接复用（等价性回归）。
 */
export { buildFlatBvh } from '@/render/picking/flatBvh';
export type { FlatBvh } from '@/render/picking/flatBvh';
export {
  collectSceneIndexBuildInput,
  createFlatSceneIndex,
} from '@/render/picking/sceneIndexBuilder';
export type { SceneIndexBuildInput } from '@/render/picking/sceneIndexBuilder';


