import React, { useRef, useState, WheelEvent, MouseEvent, useEffect, useLayoutEffect, useCallback } from 'react';
import { AnyEntity, ViewPort, DxfLayer, DxfBlock, DxfStyle, DxfLineType, Point2D, CanvasTheme, DrawingColorMode } from '@/types';
import { renderEntitiesToCanvas, hitTest, hitTestBox } from '@/renderer/services/canvasRenderService';
import { buildPathCache, PathCache } from '@/renderer/services/pathCache';
import { Language, t } from '@/config/i18n';
import { CANVAS_THEME_COLORS, SELECTION_CONFIG, SHORTCUT_CONFIG, VIEWER_DEFAULTS, ZOOM_CONFIG, BREAKPOINTS, INTERACTION_CONFIG, CONTEXT_MENU_CONFIG } from '@/config/viewerConfig';
import { boxQueryBounds, createSceneIndex, pointQueryBounds, SceneBounds, SceneIndex } from '@/renderer/services/sceneIndex';
import { SCENE_INDEX_ASYNC_THRESHOLD } from '@/renderer/services/sceneIndexBuilder';
import type { SceneIndexBuildHandle } from '@/hooks/sceneIndexAsync';

/** Path2D 缓存的使用门控：缓存几何无 LOD 剔除——zoom × 可入缓存的实体数
 *  低于该值（全图视图下投影过小）时走逐实体 LOD 路径更快。
 *  zoom × entities ≈ 全部线段的像素长度量级，量级上等同于"内容像素总长"。 */
const PATH_CACHE_MIN_COVERAGE = 5000;

/**
 * Canvas 渲染核心组件
 * 负责 Canvas 渲染、坐标转换、缩放平移交互以及拾取逻辑
 */
interface CanvasViewerProps {
  active?: boolean;
  entities: AnyEntity[]; // 要渲染的实体列表
  /** 模型空间实体：渲染纸张空间布局时供视口投影使用（当前布局为模型空间时不传/传同数组）。 */
  modelEntities?: AnyEntity[];
  layers: Record<string, DxfLayer>; // 图层信息
  blocks?: Record<string, DxfBlock>; // 块定义
  styles?: Record<string, DxfStyle>; // 文字样式
  lineTypes?: Record<string, DxfLineType>; // 线型定义
  viewPort: ViewPort; // 当前视图参数（缩放、目标位置）
  onViewPortChange: (vp: ViewPort) => void; // 视图更新回调
  selectedEntityIds: Set<string>; // 已选择实体的 ID 集合
  onSelectIds: (ids: Set<string>) => void; // 选择状态更新回调
  onFitView: () => void; // 适应视图回调
  worldOffset?: Point2D; // 坐标偏移（用于显示原始坐标）
  ltScale?: number; // 全局线型比例
  theme: CanvasTheme; // 画布背景主题
  drawingColorMode: DrawingColorMode;
  lang: Language; // 当前语言。
  onMouseMoveWorld?: (x: number, y: number) => void; // 鼠标移动时的世界坐标回调
  onRenderError?: (message: string | null) => void; // 渲染异常回调
  hiddenLayers?: Set<string>; // 隐藏图层集合
  /** 被用户临时隐藏的顶层实体 ID（右键隐藏）。 */
  hiddenEntityIds?: ReadonlySet<string>;
  /** 非空时仅渲染集合内的顶层实体（隔离模式）。 */
  isolatedEntityIds?: ReadonlySet<string> | null;
  onShowAll?: () => void; // 显示全部实体与图层
  onHideSelected?: (ids?: Set<string>) => void; // 隐藏当前选择
  onIsolateSelected?: (ids?: Set<string>) => void; // 隔离当前选择
  onHideSelectedLayers?: (ids?: Set<string>) => void; // 关闭当前选择所在图层
  /** 已废弃：交互期显示策略改为"保持上一帧 + 停止后一次渲染"（无模糊、无闪烁），此属性不再影响行为。 */
  snapshotMode?: boolean;
}

/** 稳定的空集合默认值：未传可见性集合时避免每次渲染新建对象。 */
const EMPTY_ENTITY_IDS: ReadonlySet<string> = new Set<string>();

const CanvasViewer: React.FC<CanvasViewerProps> = ({ 
    active = true,
    entities, 
    modelEntities,
    layers, 
    blocks = {}, 
    styles = {}, 
    lineTypes = {}, 
    viewPort, 
    onViewPortChange, 
    selectedEntityIds, 
    onSelectIds, 
    onFitView,
    worldOffset,
    ltScale = VIEWER_DEFAULTS.defaultLineTypeScale, 
    theme,
    drawingColorMode,
    lang,
    onMouseMoveWorld,
    onRenderError,
    hiddenLayers = new Set(),
    hiddenEntityIds = EMPTY_ENTITY_IDS,
    isolatedEntityIds = null,
    onShowAll,
    onHideSelected,
    onIsolateSelected,
    onHideSelectedLayers,
    // snapshotMode 已废弃：交互策略改为"保持上一帧 + 停止后一次渲染"
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewPortRef = useRef(viewPort);
  const onViewPortChangeRef = useRef(onViewPortChange);
  const pendingViewPortRef = useRef<ViewPort | null>(null);
  const viewPortUpdateFrameRef = useRef<number | undefined>(undefined);
  const lastMiddleClickRef = useRef<{ time: number; x: number; y: number } | null>(null);
  const isInteractingRef = useRef(false);

  // 视图 ref 与 prop 同步守卫：交互（平移/缩放）期间 ref 持有最新视图值，
  // 而父级 prop 仍是交互前的旧值（快照模式刻意延迟提交）。此时若用 prop
  // 覆写 ref，下一次鼠标移动会从旧视图重新计算增量，表现为视图弹回、
  // 无法平移。交互结束后由精绘提交最新视图，prop 与 ref 自然收敛。
  if (!isInteractingRef.current) {
    viewPortRef.current = viewPort;
  }
  onViewPortChangeRef.current = onViewPortChange;
  
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const lastTouchRef = useRef<{ x: number; y: number; dist: number } | null>(null);
  const isTouchPanningRef = useRef<boolean>(false);
  const longPressTimerRef = useRef<number | undefined>(undefined);
  
  const [isPanning, setIsPanning] = useState(false);
  const [isBoxSelecting, setIsBoxSelecting] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; selectionIds: Set<string> } | null>(null);
  const contextMenuRef = useRef<typeof contextMenu>(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [currentMousePos, setCurrentMousePos] = useState({ x: 0, y: 0 });
  const [canvasSizeVersion, setCanvasSizeVersion] = useState(0);
  // 从屏幕坐标计算世界坐标（以中心为原点）
  const screenToWorld = (sx: number, sy: number) => {
     const canvas = canvasRef.current;
     if (!canvas) return { x: 0, y: 0 };
     const rect = containerRef.current?.getBoundingClientRect() || { width: canvas.width, height: canvas.height };
     
     const currentViewPort = viewPortRef.current;
     const safeZoom = Math.max(Math.abs(currentViewPort.zoom), Number.MIN_VALUE);
     
     const wx = (sx - rect.width / 2) / safeZoom + currentViewPort.targetX;
     const wy = currentViewPort.targetY - (sy - rect.height / 2) / safeZoom;
     
     return {
         x: safeClamp(wx, -Number.MAX_VALUE, Number.MAX_VALUE),
         y: safeClamp(wy, -Number.MAX_VALUE, Number.MAX_VALUE)
     };
  };

  const safeClamp = (value: number, min: number, max: number): number => {
    if (!isFinite(value)) return 0;
    return Math.max(Math.min(value, max), min);
  };

  const renderRef = useRef<number | undefined>(undefined);

  // 场景索引：实体数组只在加载/布局切换时变化（可见性隐藏/隔离不触发重建）。
  // 小图同步构建（与旧 useMemo 行为一致）；大图（≥阈值）改在 Worker 中异步
  // 建树与样条采样，期间 sceneIndex 为 undefined，渲染/拾取回退全量剔除，
  // 构建完成后 setState 触发一次精绘。Worker 失败回退同步构建。
  const [sceneIndex, setSceneIndex] = useState<SceneIndex | undefined>(undefined);
  useEffect(() => {
    if (entities.length < SCENE_INDEX_ASYNC_THRESHOLD) {
      setSceneIndex(createSceneIndex(entities));
      return undefined;
    }
    let cancelled = false;
    let handle: SceneIndexBuildHandle | undefined;
    setSceneIndex(undefined);
    // 动态导入：Worker 编排与其内嵌的 Worker 资源保持独立懒加载 chunk，
    // 仅大图纸异步建索引时才下载（与 useDxfLoader 的加载 Worker 同策略）。
    void import('@/hooks/sceneIndexAsync').then(({ buildSceneIndexAsync }) => {
      if (cancelled) return;
      handle = buildSceneIndexAsync(
        entities,
        index => { if (!cancelled) setSceneIndex(index); },
        () => { if (!cancelled) setSceneIndex(createSceneIndex(entities)); },
      );
    });
    return () => {
      cancelled = true;
      handle?.cancel();
    };
  }, [entities]);

  // ---- 交互期显示策略：保持上一帧，停止后一次性渲染 ----
  // 平移进行中：上一帧按位移精确平移贴出（纯位移、像素级精确、无模糊），
  // 提供连续的视觉反馈；缩放进行中：保持上一帧不动（缩放贴图会模糊）。
  // 交互停止 150ms 后：离屏一次性渲染当前屏幕范围，完成后原子呈现——
  // 任何时刻可见画布都是一张完整画面，无闪烁、无模糊、无渐进。
  const snapshotCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const snapshotValidRef = useRef(false);
  const snapshotStateRef = useRef<{ viewPort: ViewPort; width: number; height: number; dpr: number } | null>(null);
  /** 离屏渲染画布：最终渲染在此进行，完成后原子呈现到可见画布。 */
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  /** 世界坐标 Path2D 缓存：每样式组一次 stroke（消除逐实体路径调用）。 */
  const pathCacheRef = useRef<PathCache | null>(null);
  const pathCacheSourceRef = useRef<AnyEntity[] | null>(null);
  const pathCacheThemeRef = useRef<string | null>(null);
  const pathCacheHiddenRef = useRef<Set<string> | null>(null);
  const renderTimerRef = useRef<number | undefined>(undefined);
  /** 会话完成提交视图后跳过一次冗余的 prop 驱动重绘（画布已是该视图的完整画面）。 */
  const skipNextRenderRef = useRef(false);

  /** 取消已调度的延迟渲染。 */
  const cancelScheduledRender = useCallback(() => {
    if (renderTimerRef.current !== undefined) {
      window.clearTimeout(renderTimerRef.current);
      renderTimerRef.current = undefined;
    }
  }, []);

  /** 把当前主画布内容存为上一帧（供平移时精确贴图）。 */
  const captureSnapshot = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvas.width === 0 || canvas.height === 0) return;
    let snap = snapshotCanvasRef.current;
    if (!snap) {
      snap = document.createElement('canvas');
      snapshotCanvasRef.current = snap;
    }
    if (snap.width !== canvas.width || snap.height !== canvas.height) {
      snap.width = canvas.width;
      snap.height = canvas.height;
    }
    const sctx = snap.getContext('2d');
    if (!sctx) return;
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.clearRect(0, 0, snap.width, snap.height);
    sctx.drawImage(canvas, 0, 0);
    snapshotStateRef.current = {
      viewPort: { ...viewPortRef.current },
      width: canvas.width,
      height: canvas.height,
      dpr: window.devicePixelRatio || 1,
    };
    snapshotValidRef.current = true;
  }, []);

  /**
   * 用快照近似呈现新视图：对快照按"新视图相对快照视图"的比例做
   * drawImage 变换贴图。平移是精确的；缩放是非精确放大/缩小，
   * 但仅持续到交互结束后的精绘，视觉可接受（与商业查看器一致）。
   */
  const drawSnapshotTransformed = useCallback((nextViewPort: ViewPort, targetCtx?: CanvasRenderingContext2D) => {
    const canvas = canvasRef.current;
    const snap = snapshotCanvasRef.current;
    const state = snapshotStateRef.current;
    if (!canvas || !snap || !state || !snapshotValidRef.current) return false;

    const ctx = targetCtx ?? canvas.getContext('2d');
    if (!ctx) return false;

    // 目标画布按新视图清底（设备像素坐标）
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = CANVAS_THEME_COLORS[theme];
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // 快照视图 → 新视图的屏幕映射（设备像素）：
    // 世界点 p 在快照中的位置 s0 = (p - t0) * z0 * dpr + c0；
    // 在新视图中的位置 s1 = (p - t1) * z1 * dpr + c1。
    // 因此 s1 = (s0 - c0) * (z1/z0) + c0 + (t0 - t1) * z1 * dpr
    //           + (c1 - c0)，c1 = c0 = 画布中心。
    const dpr = window.devicePixelRatio || 1;
    const rawRatio = nextViewPort.zoom / state.viewPort.zoom;
    // 纯平移（比例≈1）时按 1:1 贴图并取整偏移到设备像素，
    // 避免亚像素重采样导致文字与细线发虚。
    const isPurePan = Math.abs(rawRatio - 1) < 0.005;
    const ratio = isPurePan ? 1 : rawRatio;
    const c0x = state.width / 2;
    const c0y = state.height / 2;
    const c1x = ctx.canvas.width / 2;
    const c1y = ctx.canvas.height / 2;

    let dx = (0 - c0x) * ratio + c1x + (state.viewPort.targetX - nextViewPort.targetX) * nextViewPort.zoom * dpr;
    let dy = (0 - c0y) * ratio + c1y - (state.viewPort.targetY - nextViewPort.targetY) * nextViewPort.zoom * dpr;
    if (isPurePan) {
      dx = Math.round(dx);
      dy = Math.round(dy);
    }

    ctx.drawImage(
      snap,
      0, 0, state.width, state.height,
      dx,
      dy,
      state.width * ratio,
      state.height * ratio,
    );
    return true;
  }, [theme]);

  /**
   * 构建 RenderSceneOptions：一次性渲染（离屏）与 prop 驱动重绘共用，
   * 保证两条渲染路径的输入完全一致。
   */
  const buildRenderOptions = useCallback((vp: ViewPort, targetCtx?: CanvasRenderingContext2D) => ({
    ctx: targetCtx ?? canvasRef.current!.getContext('2d')!,
    entities,
    layers,
    blocks,
    styles,
    lineTypes,
    ltScale,
    viewPort: vp,
    selectedIds: selectedEntityIds,
    modelEntities,
    width: containerRef.current!.getBoundingClientRect().width,
    height: containerRef.current!.getBoundingClientRect().height,
    theme,
    drawingColorMode,
    hiddenLayers,
    hiddenEntityIds,
    isolatedEntityIds,
    sceneIndex,
  }), [entities, modelEntities, layers, blocks, styles, lineTypes, ltScale, selectedEntityIds, theme, drawingColorMode, hiddenLayers, hiddenEntityIds, isolatedEntityIds, sceneIndex]);

  /** 同步画布尺寸与 DPR 变换，返回 CSS 尺寸。 */
  const prepareCanvas = useCallback((): { width: number; height: number } | null => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return null;
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.max(1, Math.round(rect.width * dpr));
    const pixelHeight = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    return { width: rect.width, height: rect.height };
  }, []);

  /**
   * 一次性渲染当前视图：在离屏画布完成全部绘制后原子呈现到可见画布。
   *
   * 渲染期间可见画布保持上一帧不变（无空白、无半成品帧）；完成后整帧
   * 切换——用户要求的"交互保持上一帧，停止后一次加载"语义。
   *
   * 简单几何（LINE/LWPOLYLINE/CIRCLE/ARC）走世界坐标 Path2D 缓存：
   * 每样式组一次 stroke（视口矩阵经 setTransform 应用），消除逐实体
   * 路径调用；缓存过期（实体/图层/主题变化）时重建。
   */
  const renderAndPresent = useCallback((vp: ViewPort) => {
    const canvas = canvasRef.current;
    if (!canvas || !containerRef.current) return;

    const size = prepareCanvas();
    if (!size) return;

    // 离屏画布（尺寸/DPR 与主画布一致）
    let off = offscreenRef.current;
    if (!off) {
      off = document.createElement('canvas');
      offscreenRef.current = off;
    }
    if (off.width !== canvas.width || off.height !== canvas.height) {
      off.width = canvas.width;
      off.height = canvas.height;
    }
    const offCtx = off.getContext('2d');
    if (!offCtx) return;
    offCtx.setTransform(1, 0, 0, 1, 0, 0);
    const dpr = window.devicePixelRatio || 1;
    offCtx.scale(dpr, dpr);

    try {
      // ── Path2D 缓存路径：覆盖的简单几何按样式组批量 stroke ──
      // 缓存失效条件：实体集变化 / 图层显隐 / 主题 / 颜色模式 / 线型比例。
      // 缓存内几何无 LOD 剔除——全图视图（zoom 极小）下万级实体全画反而
      // 慢于 LOD 剔除的逐实体路径，故按 zoom 门控：zoom 足够大才用缓存。
      if (pathCacheSourceRef.current !== entities
        || pathCacheThemeRef.current !== theme + drawingColorMode + ltScale
        || pathCacheHiddenRef.current !== hiddenLayers) {
        // 缓存与缩放完全解耦（几何为世界坐标，线宽/虚线渲染时按 zoom 换算）
        // ——缩放交互不再触发重建。
        pathCacheRef.current = buildPathCache(entities, {
          layers, lineTypes, globalLineTypeScale: ltScale, drawingColorMode, theme,
        }, hiddenLayers);
        pathCacheSourceRef.current = entities;
        pathCacheThemeRef.current = theme + drawingColorMode + ltScale;
        pathCacheHiddenRef.current = hiddenLayers;
      }
      const cache = pathCacheRef.current;
      const useCache = cache !== null
        && selectedEntityIds.size === 0 && hiddenEntityIds.size === 0 && !isolatedEntityIds
        && vp.zoom * Math.max(cache.stats.entities, 1) > PATH_CACHE_MIN_COVERAGE;

      if (useCache && cache) {
        // 背景：批量几何之前铺主题色（下方逐实体路径以透明底叠加其余内容）
        offCtx.setTransform(1, 0, 0, 1, 0, 0);
        offCtx.fillStyle = CANVAS_THEME_COLORS[theme];
        offCtx.fillRect(0, 0, size.width * dpr, size.height * dpr);
        // 视口矩阵：世界 → 屏幕（CSS px，y 翻转），含 DPR
        offCtx.setTransform(dpr * vp.zoom, 0, 0, -dpr * vp.zoom,
          dpr * (size.width / 2 - vp.targetX * vp.zoom),
          dpr * (size.height / 2 + vp.targetY * vp.zoom));
        offCtx.lineCap = 'round';
        offCtx.lineJoin = 'round';
        for (const g of cache.groups) {
          offCtx.strokeStyle = g.color;
          // 线宽：屏幕像素语义 → 世界变换下需除以 zoom；并保底 1px
          offCtx.lineWidth = Math.max(g.lineWidthPx / vp.zoom, 1 / vp.zoom);
          // 虚线：世界节距 → 像素（变换下 × zoom）
          offCtx.setLineDash(g.dashPattern.map(v => v * vp.zoom));
          offCtx.stroke(g.path);
        }
        // 恢复屏幕空间变换（后续逐实体路径按 CSS px 绘制）
        offCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        offCtx.setLineDash([]);
        // 其余实体（文字/标注/INSERT/填充）仍走逐实体路径（跳过已批量的）
        renderEntitiesToCanvas({
          ...buildRenderOptions(vp, offCtx),
          width: size.width,
          height: size.height,
          pathCacheCovered: cache.coveredIds,
          background: null,
        });
        onRenderError?.(null);
      } else {
        renderEntitiesToCanvas({ ...buildRenderOptions(vp, offCtx), width: size.width, height: size.height });
        onRenderError?.(null);
      }
    } catch (err) {
      onRenderError?.(err instanceof Error ? err.message : String(err));
      return;
    }

    // 原子呈现：离屏完整帧一次性贴到可见画布（设备像素对设备像素）
    const vctx = canvas.getContext('2d');
    if (vctx) {
      vctx.save();
      vctx.setTransform(1, 0, 0, 1, 0, 0);
      vctx.drawImage(off, 0, 0);
      vctx.restore();
    }
    // 完整渲染成功后更新上一帧，供平移时精确贴图使用
    captureSnapshot();
  }, [entities, layers, blocks, styles, lineTypes, ltScale, selectedEntityIds, theme, drawingColorMode, onRenderError, hiddenLayers, hiddenEntityIds, isolatedEntityIds, sceneIndex, captureSnapshot, buildRenderOptions]);

  /** 交互停止后的调度：防抖 150ms，一次性渲染当前屏幕范围。 */
  const scheduleRender = useCallback(() => {
    if (renderTimerRef.current !== undefined) window.clearTimeout(renderTimerRef.current);
    renderTimerRef.current = window.setTimeout(() => {
      renderTimerRef.current = undefined;
      isInteractingRef.current = false;
      const pending = pendingViewPortRef.current ?? viewPortRef.current;
      pendingViewPortRef.current = null;
      if (pending) {
        renderAndPresent(pending);
        // 提交视图（收敛 React 状态），并跳过随之触发的冗余 prop 重绘
        skipNextRenderRef.current = true;
        onViewPortChangeRef.current(pending);
      }
    }, INTERACTION_CONFIG.interactionRefineDelayMs);
  }, [renderAndPresent]);

  useEffect(() => () => {
    if (renderTimerRef.current !== undefined) window.clearTimeout(renderTimerRef.current);
  }, []);
  const contextMenuLabels = {
    showAll: t(lang, 'showAll'),
    hideSelected: t(lang, 'hideSelected'),
    isolateSelected: t(lang, 'isolateSelected'),
    hideLayer: t(lang, 'hideSelectedLayer'),
  };
  const hasContextSelection = contextMenu ? contextMenu.selectionIds.size > 0 : false;

  contextMenuRef.current = contextMenu;

  const getPickableEntities = useCallback((bounds: SceneBounds) => {
    // 索引未就绪（大图异步构建中）时回退为全量候选，结果一致，仅本次查询 O(n)。
    const candidates = sceneIndex ? sceneIndex.query(bounds) : entities;
    return candidates.filter(entity => {
      if (entity.visible === false || hiddenLayers.has(entity.layer)) return false;
      if (hiddenEntityIds.has(entity.id)) return false;
      if (isolatedEntityIds && !isolatedEntityIds.has(entity.id)) return false;
      return true;
    });
  }, [entities, hiddenEntityIds, hiddenLayers, isolatedEntityIds, sceneIndex]);


  const scheduleViewPortChange = useCallback((nextViewPort: ViewPort) => {
    pendingViewPortRef.current = nextViewPort;
    viewPortRef.current = nextViewPort;
    cancelScheduledRender();

    // 交互期显示策略：
    // - 平移（纯位移）：上一帧按位移精确贴出——像素级精确、无模糊，
    //   提供连续的视觉反馈；
    // - 缩放：保持上一帧不动（缩放贴图会模糊，不做）。
    // 两种情况都不触发重绘；交互停止 150ms 后一次性渲染当前屏幕范围。
    const snapZoom = snapshotStateRef.current?.viewPort.zoom;
    const ratio = snapZoom ? nextViewPort.zoom / snapZoom : 1;
    if (snapshotValidRef.current && Math.abs(ratio - 1) < 0.005) {
      drawSnapshotTransformed(nextViewPort);
      isInteractingRef.current = true;
      if (viewPortUpdateFrameRef.current !== undefined) {
        cancelAnimationFrame(viewPortUpdateFrameRef.current);
        viewPortUpdateFrameRef.current = undefined;
      }
      scheduleRender();
      return;
    }

    scheduleRender();
  }, [cancelScheduledRender, drawSnapshotTransformed, scheduleRender]);

  useEffect(() => () => {
    if (viewPortUpdateFrameRef.current !== undefined) cancelAnimationFrame(viewPortUpdateFrameRef.current);
  }, []);

  const closeContextMenu = () => setContextMenu(null);

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current !== undefined) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = undefined;
    }
  };

  /** 将菜单约束在画布可见区域内，避免移动端和右下角右键时错位或溢出。 */
  const clampContextMenuPosition = (x: number, y: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x, y };
    const isMobileViewport = typeof window !== 'undefined' && window.matchMedia?.(`(max-width: ${BREAKPOINTS.mobile}px)`).matches;
    const menuWidth = isMobileViewport ? CONTEXT_MENU_CONFIG.mobileWidth : CONTEXT_MENU_CONFIG.desktopWidth;
    const menuHeight = isMobileViewport ? CONTEXT_MENU_CONFIG.mobileHeight : CONTEXT_MENU_CONFIG.desktopHeight;
    const padding = isMobileViewport ? CONTEXT_MENU_CONFIG.mobilePadding : CONTEXT_MENU_CONFIG.padding;
    return {
      x: safeClamp(x, padding, Math.max(padding, rect.width - menuWidth - padding)),
      y: safeClamp(y, padding, Math.max(padding, rect.height - menuHeight - padding)),
    };
  };

  /** 根据浏览器 client 坐标打开上下文菜单，内部统一转换为画布局部坐标。 */
  const openContextMenuAtClient = (clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;
    const wPos = screenToWorld(mouseX, mouseY);
    const currentViewPort = viewPortRef.current;
    const safeZoom = Math.max(Math.abs(currentViewPort.zoom), Number.MIN_VALUE);
    const worldPerPixel = 1 / safeZoom;
    const threshold = Math.max(SELECTION_CONFIG.geometryHitTolerancePixels * worldPerPixel, SELECTION_CONFIG.minimumHitToleranceWorld);
    const hitId = hitTest(
      wPos.x,
      wPos.y,
      threshold,
      getPickableEntities(pointQueryBounds(wPos.x, wPos.y, threshold)),
      blocks,
      layers,
      styles,
      sceneIndex?.splineSamples,
    );
    const position = clampContextMenuPosition(mouseX, mouseY);

    if (hitId && !selectedEntityIds.has(hitId)) {
      const nextSelection = new Set([hitId]);
      onSelectIds(nextSelection);
      setContextMenu({ ...position, selectionIds: nextSelection });
      return;
    }

    if (hitId || selectedEntityIds.size > 0) {
      setContextMenu({ ...position, selectionIds: new Set(selectedEntityIds) });
      return;
    }

    setContextMenu({ ...position, selectionIds: new Set() });
  };

  /** 防止右键菜单内部鼠标事件冒泡到画布，避免菜单在按钮 click 前被关闭。 */
  const stopContextMenuPointerEvent = (event: React.MouseEvent) => {
    event.stopPropagation();
  };

  const suppressNativeContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => closeContextMenu();
    window.addEventListener('click', close);
    window.addEventListener('keydown', close);
    window.addEventListener('wheel', close, { passive: true });
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', close);
      window.removeEventListener('wheel', close);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (active) return;
    setContextMenu(null);
    setIsPanning(false);
    setIsBoxSelecting(false);
    pendingViewPortRef.current = null;
    isInteractingRef.current = false;
    cancelScheduledRender();
    skipNextRenderRef.current = false;
    if (viewPortUpdateFrameRef.current !== undefined) {
      cancelAnimationFrame(viewPortUpdateFrameRef.current);
      viewPortUpdateFrameRef.current = undefined;
    }
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;
    let resizeFrame: number | undefined;
    const scheduleResize = () => {
      if (resizeFrame !== undefined) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = undefined;
        setCanvasSizeVersion(version => version + 1);
      });
    };
    const observer = new ResizeObserver(scheduleResize);
    observer.observe(container);
    return () => {
      observer.disconnect();
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
    };
  }, [active]);


  useLayoutEffect(() => {
     if (!active) return;
     // 交互后的一次性渲染已提交视图并画好完整画面：跳过这一次冗余重绘
     if (skipNextRenderRef.current) { skipNextRenderRef.current = false; return; }
     cancelScheduledRender();
     if (renderRef.current) cancelAnimationFrame(renderRef.current);
     renderRef.current = requestAnimationFrame(() => renderAndPresent(viewPort));

     return () => {
        if (renderRef.current) cancelAnimationFrame(renderRef.current);
     };
  }, [active, viewPort, canvasSizeVersion, renderAndPresent, cancelScheduledRender]);

  // 处理滚轮和触控事件
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const scaleFactor = INTERACTION_CONFIG.wheelZoomFactor;
      const currentVP = viewPortRef.current;
      const newZoom = e.deltaY < 0 ? currentVP.zoom * scaleFactor : currentVP.zoom / scaleFactor;

      // 大幅放宽缩放限制以支持极端坐标
      const MIN_ZOOM = ZOOM_CONFIG.minZoom;
      const MAX_ZOOM = ZOOM_CONFIG.maxZoom;
      if (newZoom < MIN_ZOOM || newZoom > MAX_ZOOM) return;

      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const safeZoom = Math.max(Math.min(newZoom, MAX_ZOOM), MIN_ZOOM);

      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      const newTargetX = currentVP.targetX + (mouseX - centerX) * (1/currentVP.zoom - 1/safeZoom);
      const newTargetY = currentVP.targetY - (mouseY - centerY) * (1/currentVP.zoom - 1/safeZoom);

      scheduleViewPortChange({
        targetX: newTargetX,
        targetY: newTargetY,
        zoom: safeZoom
      });
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
        lastTouchRef.current = { x: touch.clientX, y: touch.clientY, dist: 0 };
        isTouchPanningRef.current = false;
        clearLongPressTimer();
        longPressTimerRef.current = window.setTimeout(() => {
          if (!isTouchPanningRef.current && touchStartRef.current) {
            openContextMenuAtClient(touchStartRef.current.x, touchStartRef.current.y);
          }
        }, INTERACTION_CONFIG.touchLongPressDelayMs);
      } else if (e.touches.length === 2) {
        clearLongPressTimer();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        const midX = (t1.clientX + t2.clientX) / 2;
        const midY = (t1.clientY + t2.clientY) / 2;
        lastTouchRef.current = { x: midX, y: midY, dist };
        isTouchPanningRef.current = true;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!lastTouchRef.current) return;
      
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        const dx = touch.clientX - lastTouchRef.current.x;
        const dy = touch.clientY - lastTouchRef.current.y;
        
        if (!isTouchPanningRef.current && touchStartRef.current) {
          const moveDist = Math.hypot(touch.clientX - touchStartRef.current.x, touch.clientY - touchStartRef.current.y);
          if (moveDist > INTERACTION_CONFIG.touchMoveThresholdPixels) {
            clearLongPressTimer();
            isTouchPanningRef.current = true;
          }
        }
        
        if (isTouchPanningRef.current) {
          if (e.cancelable) e.preventDefault();
          const currentVP = viewPortRef.current;
          const safeZoom = Math.max(Math.abs(currentVP.zoom), Number.MIN_VALUE);
          const newTargetX = currentVP.targetX - dx / safeZoom;
          const newTargetY = currentVP.targetY + dy / safeZoom;
          
          scheduleViewPortChange({
            targetX: safeClamp(newTargetX, -Number.MAX_VALUE, Number.MAX_VALUE),
            targetY: safeClamp(newTargetY, -Number.MAX_VALUE, Number.MAX_VALUE),
            zoom: currentVP.zoom
          });
          
          lastTouchRef.current = { x: touch.clientX, y: touch.clientY, dist: 0 };
        }
      } else if (e.touches.length === 2) {
        if (e.cancelable) e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        const midX = (t1.clientX + t2.clientX) / 2;
        const midY = (t1.clientY + t2.clientY) / 2;
        
        const currentVP = viewPortRef.current;
        const lastDist = lastTouchRef.current.dist || dist;
        const scaleFactor = dist / lastDist;
        const newZoom = currentVP.zoom * scaleFactor;
        
        const MIN_ZOOM = 1e-10;
        const MAX_ZOOM = 1e10;
        const safeZoom = Math.max(Math.min(newZoom, MAX_ZOOM), MIN_ZOOM);
        
        const rect = container.getBoundingClientRect();
        const zoomCenterX = midX - rect.left;
        const zoomCenterY = midY - rect.top;
        const viewCenterX = rect.width / 2;
        const viewCenterY = rect.height / 2;
        
        const targetXWithZoom = currentVP.targetX + (zoomCenterX - viewCenterX) * (1/currentVP.zoom - 1/safeZoom);
        const targetYWithZoom = currentVP.targetY - (zoomCenterY - viewCenterY) * (1/currentVP.zoom - 1/safeZoom);
        
        const panDx = midX - lastTouchRef.current.x;
        const panDy = midY - lastTouchRef.current.y;
        
        const finalTargetX = targetXWithZoom - panDx / safeZoom;
        const finalTargetY = targetYWithZoom + panDy / safeZoom;
        
        scheduleViewPortChange({
          targetX: safeClamp(finalTargetX, -Number.MAX_VALUE, Number.MAX_VALUE),
          targetY: safeClamp(finalTargetY, -Number.MAX_VALUE, Number.MAX_VALUE),
          zoom: safeZoom
        });
        
        lastTouchRef.current = { x: midX, y: midY, dist };
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      clearLongPressTimer();
      if (!isTouchPanningRef.current && touchStartRef.current && e.touches.length === 0 && !contextMenuRef.current) {
        const duration = Date.now() - touchStartRef.current.time;
        if (duration < INTERACTION_CONFIG.touchTapMaxDurationMs) {
          const rect = container.getBoundingClientRect();
          const tapX = touchStartRef.current.x - rect.left;
          const tapY = touchStartRef.current.y - rect.top;
          const wPos = screenToWorld(tapX, tapY);
          
          const currentVP = viewPortRef.current;
          const safeZoom = Math.max(Math.abs(currentVP.zoom), Number.MIN_VALUE);
          const worldPerPixel = 1 / safeZoom;
          const viewWorldSpan = Math.max(rect.width, rect.height) * worldPerPixel;
          const thresholdCap = Math.max(viewWorldSpan * SELECTION_CONFIG.maximumHitToleranceViewportFactor, SELECTION_CONFIG.minimumHitToleranceWorld);
          
          const threshold = Math.min(
              Math.max(SELECTION_CONFIG.geometryHitTolerancePixels * INTERACTION_CONFIG.touchHitToleranceMultiplier * worldPerPixel, SELECTION_CONFIG.minimumHitToleranceWorld),
              thresholdCap
          );
          
          const hitId = hitTest(
            wPos.x,
            wPos.y,
            threshold,
            getPickableEntities(pointQueryBounds(wPos.x, wPos.y, threshold)),
            blocks,
            layers,
            styles,
            sceneIndex?.splineSamples,
          );
          
          if (hitId) {
            onSelectIds(new Set([hitId]));
          } else {
            onSelectIds(new Set());
          }
        }
      }
      
      touchStartRef.current = null;
      lastTouchRef.current = null;
      isTouchPanningRef.current = false;
    };

    container.addEventListener('wheel', onWheel as any, { passive: false });
    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      container.removeEventListener('wheel', onWheel as any);
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      clearLongPressTimer();
    };
  }, [active, blocks, getPickableEntities, layers, onSelectIds, scheduleViewPortChange, sceneIndex, styles]);

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    clearLongPressTimer();
    openContextMenuAtClient(e.clientX, e.clientY);
  };

  const handleMouseDown = (e: MouseEvent) => {
    closeContextMenu();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (e.button === SHORTCUT_CONFIG.middleButton) {
      e.preventDefault();
      const now = Date.now();
      const lastClick = lastMiddleClickRef.current;
      const moved = lastClick ? Math.hypot(e.clientX - lastClick.x, e.clientY - lastClick.y) : Infinity;
      if (lastClick && now - lastClick.time <= SHORTCUT_CONFIG.middleDoubleClickDelayMs && moved <= SHORTCUT_CONFIG.middleDoubleClickDistancePixels) {
        lastMiddleClickRef.current = null;
        setIsPanning(false);
        onFitView();
        return;
      }
      lastMiddleClickRef.current = { time: now, x: e.clientX, y: e.clientY };
      setIsPanning(true);
      setDragStart({ x: e.clientX, y: e.clientY });
    } else if (e.button === 0 && e.altKey) {
      e.preventDefault();
      setIsPanning(true);
      setDragStart({ x: e.clientX, y: e.clientY }); 
    } else if (e.button === 0) {
      setIsBoxSelecting(true);
      setDragStart({ x: mouseX, y: mouseY }); 
      setCurrentMousePos({ x: mouseX, y: mouseY });
    }
  };

  const handleMouseMove = (e: MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    const worldPos = screenToWorld(mouseX, mouseY);
    onMouseMoveWorld?.(worldPos.x + (worldOffset?.x || 0), worldPos.y + (worldOffset?.y || 0));

    if (isPanning) {
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      
      // 新目标 X = 旧目标 X - dx / 缩放比例
      const currentViewPort = viewPortRef.current;
      const safeZoom = Math.max(Math.abs(currentViewPort.zoom), Number.MIN_VALUE);
      const newTargetX = currentViewPort.targetX - dx / safeZoom;
      const newTargetY = currentViewPort.targetY + dy / safeZoom;

      scheduleViewPortChange({
        targetX: safeClamp(newTargetX, -Number.MAX_VALUE, Number.MAX_VALUE),
        targetY: safeClamp(newTargetY, -Number.MAX_VALUE, Number.MAX_VALUE),
        zoom: currentViewPort.zoom
      });
      setDragStart({ x: e.clientX, y: e.clientY });
    } else if (isBoxSelecting) {
      setCurrentMousePos({ x: mouseX, y: mouseY });
    }
  };

  const handleMouseUp = (e: MouseEvent) => {
    if (isPanning) {
      setIsPanning(false);
    } else if (isBoxSelecting) {
      setIsBoxSelecting(false);
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const dist = Math.sqrt(Math.pow(mouseX - dragStart.x, 2) + Math.pow(mouseY - dragStart.y, 2));
      
      const wPos = screenToWorld(mouseX, mouseY);

      if (dist < SELECTION_CONFIG.clickMovementTolerancePixels) {
         const currentViewPort = viewPortRef.current;
         const safeZoom = Math.max(Math.abs(currentViewPort.zoom), Number.MIN_VALUE);
         const worldPerPixel = 1 / safeZoom;
         const viewWorldSpan = Math.max(rect.width, rect.height) * worldPerPixel;
         const thresholdCap = Math.max(viewWorldSpan * SELECTION_CONFIG.maximumHitToleranceViewportFactor, SELECTION_CONFIG.minimumHitToleranceWorld);
         const threshold = Math.min(
             Math.max(SELECTION_CONFIG.geometryHitTolerancePixels * worldPerPixel, SELECTION_CONFIG.minimumHitToleranceWorld),
             thresholdCap
         );
         const hitId = hitTest(
             wPos.x,
             wPos.y,
             threshold,
             getPickableEntities(pointQueryBounds(wPos.x, wPos.y, threshold)),
             blocks,
             layers,
             styles,
             sceneIndex?.splineSamples,
         );
         
         if (hitId) {
             const newSet = new Set(e.ctrlKey || e.shiftKey ? selectedEntityIds : []);
             if (e.ctrlKey && selectedEntityIds.has(hitId)) newSet.delete(hitId);
             else newSet.add(hitId);
             onSelectIds(newSet);
         } else {
             if (!e.ctrlKey) onSelectIds(new Set());
         }

      } else {
         const startW = screenToWorld(dragStart.x, dragStart.y);
         const endW = wPos;
         
         // CAD 风格选择：
         // 从左向右框选：包含选择，仅选中完全在框内的实体。
         // 从右向左框选：交叉选择，选中框内或相交的实体。
         const isCrossing = wPos.x < screenToWorld(dragStart.x, dragStart.y).x;

         const boxIds = hitTestBox(
             { x1: startW.x, y1: startW.y, x2: endW.x, y2: endW.y },
             getPickableEntities(boxQueryBounds({ x1: startW.x, y1: startW.y, x2: endW.x, y2: endW.y })),
             layers,
             blocks,
             isCrossing // 传递选择模式
         );

          if (e.ctrlKey || e.shiftKey) {
             const newSet = new Set(selectedEntityIds);
             boxIds.forEach(id => newSet.add(id));
             onSelectIds(newSet);
          } else {
             onSelectIds(boxIds);
          }
       }
       setDragStart({ x: 0, y: 0 });

    }
  };

  // 根据主题计算画布背景色，并通过内联样式写入容器，
  // 确保样式兜底值和主题切换瞬间不会出现黑色闪烁。
  const canvasBgColor = CANVAS_THEME_COLORS[theme];

  return (
    <div
      ref={containerRef}
      className="canvas-container"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onContextMenu={handleContextMenu}
      onMouseLeave={() => {
        setIsPanning(false);
        setIsBoxSelecting(false);
      }}
      style={{ cursor: isPanning ? 'grabbing' : 'default', '--canvas-bg': canvasBgColor } as React.CSSProperties}
    >
      <canvas ref={canvasRef} />
      

      {isBoxSelecting && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(dragStart.x, currentMousePos.x),
            top: Math.min(dragStart.y, currentMousePos.y),
            width: Math.abs(currentMousePos.x - dragStart.x),
            height: Math.abs(currentMousePos.y - dragStart.y),
            backgroundColor: currentMousePos.x < dragStart.x ? SELECTION_CONFIG.crossingSelectionFill : SELECTION_CONFIG.windowSelectionFill,
            border: `1px ${currentMousePos.x < dragStart.x ? 'dashed' : 'solid'} ${currentMousePos.x < dragStart.x ? SELECTION_CONFIG.crossingSelectionBorder : SELECTION_CONFIG.windowSelectionBorder}`,
            pointerEvents: 'none'
          }}
        />
      )}

      {contextMenu && (
        <div
          className="canvas-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={stopContextMenuPointerEvent}
          onMouseUp={stopContextMenuPointerEvent}
          onContextMenu={suppressNativeContextMenu}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={() => { closeContextMenu(); onShowAll?.(); }}>{contextMenuLabels.showAll}</button>
          <div className="canvas-context-divider" />
          <button type="button" disabled={!hasContextSelection} onClick={() => { const ids = new Set(contextMenu.selectionIds); closeContextMenu(); onHideSelected?.(ids); }}>{contextMenuLabels.hideSelected}</button>
          <button type="button" disabled={!hasContextSelection} onClick={() => { const ids = new Set(contextMenu.selectionIds); closeContextMenu(); onIsolateSelected?.(ids); }}>{contextMenuLabels.isolateSelected}</button>
          <button type="button" disabled={!hasContextSelection} onClick={() => { const ids = new Set(contextMenu.selectionIds); closeContextMenu(); onHideSelectedLayers?.(ids); }}>{contextMenuLabels.hideLayer}</button>
        </div>
      )}


    </div>
  );
};

export default React.memo(CanvasViewer);
