/**
 * Canvas 2D 交互渲染引擎（InteractiveRenderEngine 的 Canvas 实现）。
 *
 * 帧流程：
 * 1. 尺寸/DPR 同步 → 清屏铺主题底色；
 * 2. 快速路径：无选中/隐藏且覆盖度足够时，用世界坐标 Path2D 缓存
 *    按样式组批量 stroke（万级简单几何 → 个位数 stroke 调用）；
 * 3. 其余实体（文字/标注/INSERT/填充/被选中者）走逐实体遍历
 *    （批渲染 + 视口剔除 + LOD 剔除）。
 *
 * 与 WebGL 引擎对比的预期差异：文字为系统字体近似（无 SHX 描边字形）、
 * 无图案解析填充（HATCH 图案为 45° 平铺近似）、超大图纸交互依赖
 * LOD/剔除而非 GPU 批处理。
 */

import type { AnyEntity, CanvasTheme } from '@/types';
import { CANVAS_THEME_COLORS } from '@/config/viewerConfig';
import { createSceneIndex, type SceneIndex } from '@/render/picking/sceneIndex';
import { SCENE_INDEX_ASYNC_THRESHOLD } from '@/render/picking/sceneIndexBuilder';
import { buildPathCache, PATH_CACHE_MIN_COVERAGE, type PathCache } from './pathCache';
import { renderEntitiesToCanvas } from './canvasRenderService';
import type {
  EngineRenderParams,
  EngineSceneOptions,
  InteractiveRenderEngine,
} from '../engine';

export class CanvasRenderEngine implements InteractiveRenderEngine {
  readonly kind = 'canvas' as const;

  private readonly ctx: CanvasRenderingContext2D;
  private sceneOptions: EngineSceneOptions | null = null;
  private sceneIndex: SceneIndex | null = null;
  private pathCache: PathCache | null = null;
  private pathCacheSource: AnyEntity[] | null = null;
  private pathCacheKey = '';
  private theme: CanvasTheme = 'black';
  private themeBackground = CANVAS_THEME_COLORS.black;
  private lastDrawCalls = 0;
  private frameDrawCalls = 0;

  /** textOnly = 文字覆盖层模式：只画文字、不画背景、不建 Path2D 缓存。 */
  private readonly textOnly: boolean;

  constructor(private readonly canvas: HTMLCanvasElement, options?: { textOnly?: boolean }) {
    this.textOnly = options?.textOnly === true;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法获取 Canvas 2D 上下文');
    this.ctx = ctx;
  }

  setScene(options: EngineSceneOptions): void {
    this.sceneOptions = options;
    // 场景索引：拾取/剔除共用。优先级：
    // 1. 宿主随场景传入的现成索引（ViewerCanvas 小图纸同步建好后直接给）；
    // 2. 大图纸（≥ 异步阈值）不在主线程建树——宿主正在 Worker 里建，
    //    就绪后通过 setSceneIndex 注入。此前这里无条件同步建一遍，
    //    10 万实体要多花约 170ms 并阻塞主线程；
    // 3. 其余情况同步兜底。
    if (options.sceneIndex !== undefined) {
      this.sceneIndex = options.sceneIndex;
    } else if (options.entities.length > 0 && options.entities.length < SCENE_INDEX_ASYNC_THRESHOLD) {
      this.sceneIndex = createSceneIndex(options.entities);
    } else {
      this.sceneIndex = null;
    }
    this.pathCacheSource = null; // 强制重建
    this.pathCache = null;
  }

  /** 复用宿主已建好的索引（大图纸由 Worker 异步产出），避免重复建树。 */
  setSceneIndex(index: SceneIndex | null): void {
    if (this.sceneIndex === index) return;
    this.sceneIndex = index;
  }

  setTheme(theme: CanvasTheme, background: string): void {
    if (this.theme !== theme) this.pathCache = null;
    this.theme = theme;
    this.themeBackground = background;
  }

  render(params: EngineRenderParams): void {
    const options = this.sceneOptions;
    if (!options) return;
    const { viewPort, cssWidth, cssHeight, dpr } = params;
    const pixelWidth = Math.max(1, Math.round(cssWidth * dpr));
    const pixelHeight = Math.max(1, Math.round(cssHeight * dpr));
    if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth;
    if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight;

    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const bg = params.background === undefined ? this.themeBackground : params.background;
    if (this.textOnly) {
      ctx.clearRect(0, 0, pixelWidth, pixelHeight);
    } else if (bg === null) {
      ctx.clearRect(0, 0, pixelWidth, pixelHeight);
    } else {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, pixelWidth, pixelHeight);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const sceneIndex = this.sceneIndex ?? undefined;
    const hiddenLayers = options.hiddenLayers ?? new Set<string>();

    // ── 快速路径：世界坐标 Path2D 缓存 ──
    const cacheUsable = !this.textOnly && (params.selectedIds?.size ?? 0) === 0
      && (options.hiddenEntityIds?.size ?? 0) === 0
      && !options.isolatedEntityIds
      && !(options as { lineWidthScale?: number }).lineWidthScale;
    const cache = cacheUsable ? this.ensurePathCache(options, hiddenLayers) : null;
    const useCache = !!cache
      && viewPort.zoom * Math.max(cache.stats.entities, 1) > PATH_CACHE_MIN_COVERAGE;

    let drawCalls = 0;

    if (useCache && cache) {
      // 视口矩阵：世界 → 屏幕（CSS px，y 翻转），含 DPR。
      ctx.setTransform(
        dpr * viewPort.zoom, 0, 0, -dpr * viewPort.zoom,
        dpr * (cssWidth / 2 - viewPort.targetX * viewPort.zoom),
        dpr * (cssHeight / 2 + viewPort.targetY * viewPort.zoom),
      );
      for (const group of cache.groups) {
        ctx.strokeStyle = group.color;
        // 线宽为屏幕像素语义 → 世界变换下除以 zoom，并保底 1px。
        ctx.lineWidth = Math.max(group.lineWidthPx / viewPort.zoom, 1 / viewPort.zoom);
        ctx.setLineDash(group.dashPattern.map(v => v * viewPort.zoom));
        ctx.stroke(group.path);
        drawCalls++;
      }
      ctx.setLineDash([]);
      // 恢复屏幕空间变换，其余实体按 CSS px 绘制。
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    renderEntitiesToCanvas({
      ctx: ctx as unknown as CanvasRenderingContext2D,
      entities: options.entities,
      modelEntities: options.modelEntities && options.modelEntities !== options.entities
        ? options.modelEntities
        : undefined,
      layers: options.layers,
      blocks: options.blocks,
      styles: options.styles,
      lineTypes: options.lineTypes,
      ltScale: options.ltScale,
      viewPort,
      width: cssWidth,
      height: cssHeight,
      theme: options.theme,
      drawingColorMode: options.drawingColorMode,
      hiddenLayers,
      hiddenEntityIds: options.hiddenEntityIds,
      isolatedEntityIds: options.isolatedEntityIds,
      selectedIds: params.selectedIds ? new Set(params.selectedIds) : new Set<string>(),
      sceneIndex,
      background: null,
      lodCulling: true,
      pathCacheCovered: useCache && cache ? cache.coveredIds : undefined,
      textOnly: this.textOnly,
    });

    this.frameDrawCalls = drawCalls + Math.round((drawCalls - this.lastDrawCalls) * 0);
    this.lastDrawCalls = drawCalls;
  }

  /** Path2D 缓存（失效条件：实体集/主题/颜色模式/线型比例/隐藏图层）。 */
  private ensurePathCache(options: EngineSceneOptions, hiddenLayers: Set<string>): PathCache | null {
    const key = `${options.theme}|${options.drawingColorMode}|${options.ltScale}|${hiddenLayers.size}|[...hiddenLayers].sort().join()`;
    if (this.pathCache && this.pathCacheSource === options.entities && this.pathCacheKey === key) {
      return this.pathCache;
    }
    this.pathCache = buildPathCache(options.entities, {
      layers: options.layers,
      lineTypes: options.lineTypes,
      globalLineTypeScale: options.ltScale,
      drawingColorMode: options.drawingColorMode,
      theme: options.theme,
      hiddenLayers,
    });
    this.pathCacheSource = options.entities;
    this.pathCacheKey = key;
    return this.pathCache;
  }

  get stats(): Record<string, number> {
    return {
      engine: 1,
      pathCacheGroups: this.pathCache?.groups.length ?? 0,
      pathCacheEntities: this.pathCache?.stats.entities ?? 0,
      drawCalls: this.frameDrawCalls,
    };
  }

  dispose(): void {
    // Canvas 2D 无 GPU 资源；保留画布内容交由浏览器回收。
  }
}


