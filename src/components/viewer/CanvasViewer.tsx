import React, { useRef, useState, WheelEvent, MouseEvent, useEffect, useLayoutEffect, useCallback } from 'react';
import { AnyEntity, ViewPort, DxfLayer, DxfBlock, DxfStyle, DxfLineType, Point2D, CanvasTheme, DrawingColorMode } from '@/types';
import { renderEntitiesToCanvas, hitTest, hitTestBox } from '@/renderer/services/canvasRenderService';
import { Language, t } from '@/config/i18n';
import { CANVAS_THEME_COLORS, SELECTION_CONFIG, SHORTCUT_CONFIG, VIEWER_DEFAULTS, ZOOM_CONFIG, BREAKPOINTS, INTERACTION_CONFIG, CONTEXT_MENU_CONFIG } from '@/config/viewerConfig';
import { boxQueryBounds, createSceneIndex, pointQueryBounds, SceneBounds, SceneIndex } from '@/renderer/services/sceneIndex';
import { SCENE_INDEX_ASYNC_THRESHOLD } from '@/renderer/services/sceneIndexBuilder';
import type { SceneIndexBuildHandle } from '@/hooks/sceneIndexAsync';

/**
 * Canvas 渲染核心组件
 * 负责 Canvas 渲染、坐标转换、缩放平移交互以及拾取逻辑
 */
interface CanvasViewerProps {
  active?: boolean;
  entities: AnyEntity[]; // 要渲染的实体列表
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
  snapshotMode?: boolean; // 快照平移缩放（性能模式）：交互期间用快照位图贴图
}

/** 稳定的空集合默认值：未传可见性集合时避免每次渲染新建对象。 */
const EMPTY_ENTITY_IDS: ReadonlySet<string> = new Set<string>();

const CanvasViewer: React.FC<CanvasViewerProps> = ({ 
    active = true,
    entities, 
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
    snapshotMode = true
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

  // ---- 交互期快照渲染（freeze + refine，CAD 常用技巧）----
  // 平移/缩放进行中：只把上一帧完整画面按视图增量变换后 drawImage 贴出
  // （一次 GPU blit，成本与实体数量无关）；交互停止 150ms 后触发一次
  // 全量精绘。这样拖动/滚轮期间帧耗时不再随场景规模增长。
  const snapshotCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const snapshotValidRef = useRef(false);
  const snapshotStateRef = useRef<{ viewPort: ViewPort; width: number; height: number; dpr: number } | null>(null);
  const refineTimerRef = useRef<number | undefined>(undefined);

  /** 把当前主画布内容存为快照，并记录对应的视图状态。 */
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
  const drawSnapshotTransformed = useCallback((nextViewPort: ViewPort) => {
    const canvas = canvasRef.current;
    const snap = snapshotCanvasRef.current;
    const state = snapshotStateRef.current;
    if (!canvas || !snap || !state || !snapshotValidRef.current) return false;

    const ctx = canvas.getContext('2d');
    if (!ctx) return false;

    // 主画布按新视图清底（设备像素坐标）
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = CANVAS_THEME_COLORS[theme];
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 快照视图 → 新视图的屏幕映射（设备像素）：
    // 世界点 p 在快照中的位置 s0 = (p - t0) * z0 * dpr + c0；
    // 在新视图中的位置 s1 = (p - t1) * z1 * dpr + c1。
    // 因此 s1 = (s0 - c0) * (z1/z0) + c0 + (t0 - t1) * z1 * dpr
    //           + (c1 - c0)，c1 = c0 = 画布中心。
    const dpr = window.devicePixelRatio || 1;
    const ratio = nextViewPort.zoom / state.viewPort.zoom;
    const c0x = state.width / 2;
    const c0y = state.height / 2;
    const c1x = canvas.width / 2;
    const c1y = canvas.height / 2;

    ctx.drawImage(
      snap,
      0, 0, state.width, state.height,
      (0 - c0x) * ratio + c1x + (state.viewPort.targetX - nextViewPort.targetX) * nextViewPort.zoom * dpr,
      (0 - c0y) * ratio + c1y - (state.viewPort.targetY - nextViewPort.targetY) * nextViewPort.zoom * dpr,
      state.width * ratio,
      state.height * ratio,
    );
    return true;
  }, [theme]);

  /** 交互结束后的精绘调度。 */
  const scheduleRefine = useCallback(() => {
    if (refineTimerRef.current !== undefined) window.clearTimeout(refineTimerRef.current);
    refineTimerRef.current = window.setTimeout(() => {
      refineTimerRef.current = undefined;
      isInteractingRef.current = false;
      // 把交互期间累积的最新视图提交给 React 状态——viewPort prop 变化
      // 会触发渲染 effect 执行一次全量精绘。
      const pending = pendingViewPortRef.current;
      pendingViewPortRef.current = null;
      if (pending) onViewPortChangeRef.current(pending);
      // 视图无变化时（如尺寸调整）也要保证精绘一次。
      setCanvasSizeVersion(v => v + 1);
    }, INTERACTION_CONFIG.interactionRefineDelayMs);
  }, []);

  useEffect(() => () => {
    if (refineTimerRef.current !== undefined) window.clearTimeout(refineTimerRef.current);
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

    // 快照模式（freeze 阶段）：立即用快照近似呈现新视图——一次 drawImage
    // 贴图，成本与实体数量无关；并抑制本次 rAF 全量渲染。
    // 交互停止 150ms 后由 scheduleRefine 触发一次全量精绘（refine 阶段）。
    // 非 snapshotMode 时走下方 rAF 路径：每帧提交视图并全量重绘（精确但较慢）。
    if (snapshotMode && snapshotValidRef.current && drawSnapshotTransformed(nextViewPort)) {
      isInteractingRef.current = true;
      // 取消已排队的全量渲染帧，交互期间只走快照路径。
      if (viewPortUpdateFrameRef.current !== undefined) {
        cancelAnimationFrame(viewPortUpdateFrameRef.current);
        viewPortUpdateFrameRef.current = undefined;
      }
      scheduleRefine();
      return;
    }

    if (viewPortUpdateFrameRef.current !== undefined) return;
    viewPortUpdateFrameRef.current = requestAnimationFrame(() => {
      viewPortUpdateFrameRef.current = undefined;
      const pending = pendingViewPortRef.current;
      pendingViewPortRef.current = null;
      if (pending) onViewPortChangeRef.current(pending);
    });
  }, [drawSnapshotTransformed, scheduleRefine, snapshotMode]);

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
    if (viewPortUpdateFrameRef.current !== undefined) {
      cancelAnimationFrame(viewPortUpdateFrameRef.current);
      viewPortUpdateFrameRef.current = undefined;
    }
    if (refineTimerRef.current !== undefined) {
      window.clearTimeout(refineTimerRef.current);
      refineTimerRef.current = undefined;
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
     const render = () => {
        const canvas = canvasRef.current;
        if (!canvas || !containerRef.current) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // 处理高 DPI
        const rect = containerRef.current.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        // 如果需要，调整大小
        const pixelWidth = Math.max(1, Math.round(rect.width * dpr));
        const pixelHeight = Math.max(1, Math.round(rect.height * dpr));
        if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
            canvas.width = pixelWidth;
            canvas.height = pixelHeight;
            canvas.style.width = `${rect.width}px`;
            canvas.style.height = `${rect.height}px`;
        }

        // 为 DPI 重置缩放
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);

        try {
            renderEntitiesToCanvas({
                ctx,
                entities,
                layers,
                blocks,
                styles,
                lineTypes,
                ltScale,
                viewPort,
                selectedIds: selectedEntityIds,
                width: rect.width,
                height: rect.height,
                theme,
                drawingColorMode,
                hiddenLayers,
                hiddenEntityIds,
                isolatedEntityIds,
                sceneIndex,
            });
            onRenderError?.(null);

            // 完整精绘成功后更新快照，供下一次交互期贴图使用
            captureSnapshot();

        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            ctx.fillStyle = CANVAS_THEME_COLORS[theme];
            ctx.fillRect(0, 0, rect.width, rect.height);
            onRenderError?.(message);
        }
     };

     if (renderRef.current) cancelAnimationFrame(renderRef.current);
     renderRef.current = requestAnimationFrame(render);

     return () => {
        if (renderRef.current) cancelAnimationFrame(renderRef.current);
     };
  }, [active, entities, layers, blocks, styles, lineTypes, ltScale, viewPort, selectedEntityIds, worldOffset, theme, drawingColorMode, onRenderError, hiddenLayers, hiddenEntityIds, isolatedEntityIds, canvasSizeVersion, sceneIndex, captureSnapshot]);

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
