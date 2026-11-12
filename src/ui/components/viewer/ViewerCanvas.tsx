import React, { useRef, useState, WheelEvent, MouseEvent, useEffect, useCallback } from 'react';
import { AnyEntity, ViewPort, DxfLayer, DxfBlock, DxfStyle, DxfLineType, Point2D, CanvasTheme, DrawingColorMode } from '@/types';
import { hitTest, hitTestBox } from '@/render/picking/hitTest';
import { RenderEngine } from '@/render/webgl/renderEngine';
import { CanvasRenderEngine } from '@/render/canvas/CanvasRenderEngine';
import type { EngineKind, InteractiveRenderEngine } from '@/render/engine';
import { TEXT_RENDER_MODE } from '@/config/viewerConfig';
import { hasOutlineFont, hasOutlineFontCjkCoverage, loadOutlineFont } from '@/render/text/outlineText';
import { Language, t } from '@/ui/i18n';
import { CANVAS_THEME_COLORS, SELECTION_CONFIG, SHORTCUT_CONFIG, VIEWER_DEFAULTS, ZOOM_CONFIG, BREAKPOINTS, INTERACTION_CONFIG, CONTEXT_MENU_CONFIG } from '@/config/viewerConfig';
import { boxQueryBounds, createSceneIndex, pointQueryBounds, SceneBounds, SceneIndex } from '@/render/picking/sceneIndex';
import { SCENE_INDEX_ASYNC_THRESHOLD } from '@/render/picking/sceneIndexBuilder';
import type { SceneIndexBuildHandle } from '@/render/picking/sceneIndexAsync';

/**
 * 视图画布组件：双渲染引擎宿主（WebGL / Canvas 2D 可切换对比）。
 *
 * - 场景重建（低频）：实体/图层/样式/可见性/主题变化时 engine.setScene；
 * - 帧渲染（高频）：平移/缩放仅更新引擎状态，rAF 循环按脏标记出帧；
 * - 引擎切换：重建引擎实例并重放当前场景（视口/选中状态天然保持）；
 * - 本组件只负责交互：滚轮/触控缩放平移、点击拾取、框选、右键菜单。
 */
interface ViewerCanvasProps {
  active?: boolean;
  /** 渲染引擎：webgl（默认）或 canvas（对比用）。 */
  engine?: EngineKind;
  entities: AnyEntity[];
  /** 模型空间实体：渲染纸张空间布局时供视口投影使用（当前布局为模型空间时不传/传同数组）。 */
  modelEntities?: AnyEntity[];
  layers: Record<string, DxfLayer>;
  blocks?: Record<string, DxfBlock>;
  styles?: Record<string, DxfStyle>;
  lineTypes?: Record<string, DxfLineType>;
  viewPort: ViewPort;
  onViewPortChange: (vp: ViewPort) => void;
  selectedEntityIds: Set<string>;
  onSelectIds: (ids: Set<string>) => void;
  onFitView: () => void;
  worldOffset?: Point2D;
  ltScale?: number;
  theme: CanvasTheme;
  drawingColorMode: DrawingColorMode;
  lang: Language;
  onMouseMoveWorld?: (x: number, y: number) => void;
  onRenderError?: (message: string | null) => void;
  hiddenLayers?: Set<string>;
  hiddenEntityIds?: ReadonlySet<string>;
  isolatedEntityIds?: ReadonlySet<string> | null;
  onShowAll?: () => void;
  onHideSelected?: (ids?: Set<string>) => void;
  onIsolateSelected?: (ids?: Set<string>) => void;
  onHideSelectedLayers?: (ids?: Set<string>) => void;
}

/** 稳定的空集合默认值：未传可见性集合时避免每次渲染新建对象。 */
const EMPTY_ENTITY_IDS: ReadonlySet<string> = new Set<string>();

const ViewerCanvas: React.FC<ViewerCanvasProps> = ({
  active = true,
  engine: engineKind = 'webgl',
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
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<InteractiveRenderEngine | null>(null);
  /** 文字覆盖层（仅 WebGL 引擎）：几何走 GPU，文字走浏览器原生文本引擎。 */
  const textCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const textEngineRef = useRef<CanvasRenderEngine | null>(null);
  const viewPortRef = useRef(viewPort);
  const onViewPortChangeRef = useRef(onViewPortChange);
  const dirtyRef = useRef(true);
  const selectedRef = useRef(selectedEntityIds);
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  const isInteractingRef = useRef(false);
  const lastMiddleClickRef = useRef<{ time: number; x: number; y: number } | null>(null);

  // 视图 ref 与 prop 同步守卫：交互期间 ref 持有最新视图值（prop 延迟提交），
  // 交互结束后由防抖提交收敛，prop 与 ref 自然一致。
  if (!isInteractingRef.current) {
    viewPortRef.current = viewPort;
  }
  onViewPortChangeRef.current = onViewPortChange;
  selectedRef.current = selectedEntityIds;

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
  const [outlineFontVersion, setOutlineFontVersion] = useState(0);

  /**
   * WebGL 的文字有两种来源：
   * - GPU 几何（`TEXT_RENDER_MODE === 'sdf'`）：轮廓字体三角化，字形最准，
   *   但需要宿主在 `public/fonts/` 放 simfang.ttf（约 10MB，库不内置）；
   * - Canvas 2D 覆盖层（overlay）：几何走 GPU、文字由浏览器原生文本引擎绘制，
   *   与 Canvas 引擎完全同源（CJK/字距/行距/对齐/字号天然一致）。
   *
   * 轮廓字体不可用时**必须**退回覆盖层：GPU 兜底路径（字形图集 + 描边字体）
   * 会把字号、标点与笔画都画坏 —— 实测标题栏同一张图里字号大小不一、
   * 句号变成空心圆、笔画断裂，而同一张图的 Canvas 引擎完全正常。
   */
  const textOverlayActive = engineKind === 'webgl'
    && (TEXT_RENDER_MODE === 'overlay' || !hasOutlineFontCjkCoverage());

  // 尝试自动异步预载轮廓字体（工程仿宋为主字体，Arial 为西文/特殊符号后备字体）
  useEffect(() => {
    let cancelled = false;
    const candidates = ['/fonts/simfang.ttf', '/fonts/outline.ttf', 'fonts/simfang.ttf'];
    const fallbackCandidates = ['/fonts/arial.ttf', 'fonts/arial.ttf'];
    const tryLoad = async () => {
      let mainLoaded = hasOutlineFont();
      if (!mainLoaded) {
        for (const url of candidates) {
          if (cancelled) break;
          const ok = await loadOutlineFont(url, false);
          if (ok && !cancelled) {
            mainLoaded = true;
            setOutlineFontVersion(v => v + 1);
            break;
          }
        }
      }
      // 预载后备字体以完美支持 Ø, ², ³, ₐ 等符号
      for (const url of fallbackCandidates) {
        if (cancelled) break;
        const ok = await loadOutlineFont(url, true);
        if (ok && !cancelled) {
          setOutlineFontVersion(v => v + 1);
          break;
        }
      }
    };
    tryLoad();
    return () => { cancelled = true; };
  }, []);

  const safeClamp = (value: number, min: number, max: number): number => {
    if (!isFinite(value)) return 0;
    return Math.max(Math.min(value, max), min);
  };

  // 从屏幕坐标计算世界坐标（以中心为原点）
  const screenToWorld = (sx: number, sy: number) => {
    const container = containerRef.current;
    if (!container) return { x: 0, y: 0 };
    const rect = container.getBoundingClientRect();
    const currentViewPort = viewPortRef.current;
    const safeZoom = Math.max(Math.abs(currentViewPort.zoom), Number.MIN_VALUE);
    const wx = (sx - rect.width / 2) / safeZoom + currentViewPort.targetX;
    const wy = currentViewPort.targetY - (sy - rect.height / 2) / safeZoom;
    return {
      x: safeClamp(wx, -Number.MAX_VALUE, Number.MAX_VALUE),
      y: safeClamp(wy, -Number.MAX_VALUE, Number.MAX_VALUE),
    };
  };

  /** 请求下一帧重绘（平移/缩放/选中/尺寸变化共用入口）。 */
  const requestFrame = useCallback(() => {
    dirtyRef.current = true;
  }, []);

  // ── 引擎生命周期与渲染循环（engineKind 变化时重建引擎并重放场景） ──
  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let engine: InteractiveRenderEngine;
    try {
      engine = engineKind === 'canvas'
        ? new CanvasRenderEngine(canvas)
        : new RenderEngine(canvas);
    } catch (err) {
      onRenderError?.(err instanceof Error ? err.message : String(err));
      return;
    }
    engineRef.current = engine;
    // WebGL 模式下额外挂一层文字覆盖层：字形由 Canvas 2D 文本引擎绘制，
    // 与 Canvas 引擎完全同源（CJK/字距/行距/对齐天然一致），
    // 几何仍由 GPU 渲染。GL 场景因此可跳过全部文字烘焙。
    let textEngine: CanvasRenderEngine | null = null;
    if (engineKind === 'webgl' && textOverlayActive && textCanvasRef.current) {
      try {
        textEngine = new CanvasRenderEngine(textCanvasRef.current, { textOnly: true });
        textEngineRef.current = textEngine;
      } catch {
        textEngine = null;
      }
    }
    // 调试句柄：控制台可用 __dxfEngine.stats 查看引擎状态。
    (window as unknown as { __dxfEngine?: InteractiveRenderEngine }).__dxfEngine = engine;

    let rafId = 0;
    let errorReported = false;
    const loop = () => {
      if (dirtyRef.current) {
        const { width, height, dpr } = sizeRef.current;
        if (width > 0 && height > 0) {
          try {
            const renderParams = {
              viewPort: viewPortRef.current,
              cssWidth: width,
              cssHeight: height,
              dpr,
              selectedIds: selectedRef.current,
            };
            engine.render(renderParams);
            textEngine?.render(renderParams);
            if (errorReported) {
              errorReported = false;
              onRenderError?.(null);
            }
          } catch (err) {
            if (!errorReported) {
              errorReported = true;
              onRenderError?.(err instanceof Error ? err.message : String(err));
            }
          }
        }
        dirtyRef.current = false;
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);

    // 引擎重建后重放当前场景（依赖 engineKind 触发本 effect 重跑）。
    engine.setTheme(theme, CANVAS_THEME_COLORS[theme]);
    try {
      const sceneOptions = {
        entities,
        modelEntities: modelEntities && modelEntities !== entities ? modelEntities : undefined,
        layers,
        blocks,
        styles,
        lineTypes,
        ltScale,
        theme,
        drawingColorMode,
        hiddenLayers,
        hiddenEntityIds,
        isolatedEntityIds,
      };
      // GL 引擎跳过文字烘焙（由覆盖层渲染），文字引擎只画文字。
      engine.setScene(textEngine ? { ...sceneOptions, skipText: true } as never : sceneOptions);
      textEngine?.setTheme(theme, CANVAS_THEME_COLORS[theme]);
      textEngine?.setScene(sceneOptions);
      onRenderError?.(null);
    } catch (err) {
      onRenderError?.(err instanceof Error ? err.message : String(err));
    }
    requestFrame();

    return () => {
      cancelAnimationFrame(rafId);
      engine.dispose();
      textEngine?.dispose();
      if (textEngineRef.current === textEngine) textEngineRef.current = null;
      if (engineRef.current === engine) engineRef.current = null;
    };
    // onRenderError 允许变化但不重建引擎（经 ref 语义使用）。
    // textOverlayActive 变化（轮廓字体加载完成 / 失败）需要重建引擎与文字层。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, engineKind, textOverlayActive]);

  // ── 场景重建（低频）：实体/样式/可见性/主题变化 ──
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setTheme(theme, CANVAS_THEME_COLORS[theme]);
    const textEngine = textEngineRef.current;
    try {
      const sceneOptions = {
        entities,
        modelEntities: modelEntities && modelEntities !== entities ? modelEntities : undefined,
        layers,
        blocks,
        styles,
        lineTypes,
        ltScale,
        theme,
        drawingColorMode,
        hiddenLayers,
        hiddenEntityIds,
        isolatedEntityIds,
      };
      engine.setScene(textEngine ? { ...sceneOptions, skipText: true } as never : sceneOptions);
      if (textEngine) {
        textEngine.setTheme(theme, CANVAS_THEME_COLORS[theme]);
        textEngine.setScene(sceneOptions);
      }
      onRenderError?.(null);
    } catch (err) {
      onRenderError?.(err instanceof Error ? err.message : String(err));
    }
    requestFrame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineRef.current, entities, modelEntities, layers, blocks, styles, lineTypes, ltScale, theme, drawingColorMode, hiddenLayers, hiddenEntityIds, isolatedEntityIds, outlineFontVersion, requestFrame]);

  // 选中变化：只重绘（叠加在引擎内重建）。
  useEffect(() => {
    requestFrame();
  }, [selectedEntityIds, requestFrame]);

  // ── 视图提交防抖：交互停止 150ms 后收敛到 React 状态 ──
  const commitTimerRef = useRef<number | undefined>(undefined);
  const scheduleViewPortCommit = useCallback(() => {
    if (commitTimerRef.current !== undefined) window.clearTimeout(commitTimerRef.current);
    commitTimerRef.current = window.setTimeout(() => {
      commitTimerRef.current = undefined;
      isInteractingRef.current = false;
      onViewPortChangeRef.current(viewPortRef.current);
    }, INTERACTION_CONFIG.interactionRefineDelayMs);
  }, []);

  const scheduleViewPortChange = useCallback((nextViewPort: ViewPort) => {
    viewPortRef.current = nextViewPort;
    isInteractingRef.current = true;
    requestFrame();
    scheduleViewPortCommit();
  }, [requestFrame, scheduleViewPortCommit]);

  useEffect(() => () => {
    if (commitTimerRef.current !== undefined) window.clearTimeout(commitTimerRef.current);
  }, []);

  // ── 尺寸同步 ──
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;
    let resizeFrame: number | undefined;
    const syncSize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      sizeRef.current = { width: rect.width, height: rect.height, dpr };
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
      }
      requestFrame();
    };
    const scheduleResize = () => {
      if (resizeFrame !== undefined) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = undefined;
        syncSize();
        setCanvasSizeVersion(version => version + 1);
      });
    };
    syncSize();
    const observer = new ResizeObserver(scheduleResize);
    observer.observe(container);
    return () => {
      observer.disconnect();
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
    };
  }, [active, requestFrame]);

  // ── 场景索引（拾取用，与渲染无关） ──
  const [sceneIndex, setSceneIndex] = useState<SceneIndex | undefined>(undefined);
  /** 索引镜像：引擎（重）创建后立即注入，避免闭包读到旧值。 */
  const sceneIndexRef = useRef<SceneIndex | undefined>(undefined);
  sceneIndexRef.current = sceneIndex;
  useEffect(() => {
    if (entities.length < SCENE_INDEX_ASYNC_THRESHOLD) {
      setSceneIndex(createSceneIndex(entities));
      return undefined;
    }
    let cancelled = false;
    let handle: SceneIndexBuildHandle | undefined;
    setSceneIndex(undefined);
    void import('@/render/picking/sceneIndexAsync').then(({ buildSceneIndexAsync }) => {
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

  // 索引就绪 / 引擎重建后注入引擎，省掉引擎内部重复建树。
  useEffect(() => {
    engineRef.current?.setSceneIndex?.(sceneIndexRef.current ?? null);
    requestFrame();
  }, [sceneIndex, engineKind, requestFrame]);

  // 视图 prop 由外部变化（适应视图 / 历史回退）：重绘。
  useEffect(() => {
    requestFrame();
  }, [viewPort, canvasSizeVersion, requestFrame]);

  const contextMenuLabels = {
    showAll: t(lang, 'showAll'),
    hideSelected: t(lang, 'hideSelected'),
    isolateSelected: t(lang, 'isolateSelected'),
    hideLayer: t(lang, 'hideSelectedLayer'),
  };
  const hasContextSelection = contextMenu ? contextMenu.selectionIds.size > 0 : false;

  contextMenuRef.current = contextMenu;

  const getPickableEntities = useCallback((bounds: SceneBounds) => {
    const candidates = sceneIndex ? sceneIndex.query(bounds) : entities;
    return candidates.filter(entity => {
      if (entity.visible === false || hiddenLayers.has(entity.layer)) return false;
      if (hiddenEntityIds.has(entity.id)) return false;
      if (isolatedEntityIds && !isolatedEntityIds.has(entity.id)) return false;
      return true;
    });
  }, [entities, hiddenEntityIds, hiddenLayers, isolatedEntityIds, sceneIndex]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextMenu]);

  useEffect(() => {
    if (active) return;
    setContextMenu(null);
    setIsPanning(false);
    setIsBoxSelecting(false);
    isInteractingRef.current = false;
  }, [active]);

  // ── 交互事件 ──
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const scaleFactor = INTERACTION_CONFIG.wheelZoomFactor;
      const currentVP = viewPortRef.current;
      const newZoom = e.deltaY < 0 ? currentVP.zoom * scaleFactor : currentVP.zoom / scaleFactor;

      const MIN_ZOOM = ZOOM_CONFIG.minZoom;
      const MAX_ZOOM = ZOOM_CONFIG.maxZoom;
      if (newZoom < MIN_ZOOM || newZoom > MAX_ZOOM) return;

      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const safeZoom = Math.max(Math.min(newZoom, MAX_ZOOM), MIN_ZOOM);
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      const newTargetX = currentVP.targetX + (mouseX - centerX) * (1 / currentVP.zoom - 1 / safeZoom);
      const newTargetY = currentVP.targetY - (mouseY - centerY) * (1 / currentVP.zoom - 1 / safeZoom);

      scheduleViewPortChange({
        targetX: newTargetX,
        targetY: newTargetY,
        zoom: safeZoom,
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
            zoom: currentVP.zoom,
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

        const targetXWithZoom = currentVP.targetX + (zoomCenterX - viewCenterX) * (1 / currentVP.zoom - 1 / safeZoom);
        const targetYWithZoom = currentVP.targetY - (zoomCenterY - viewCenterY) * (1 / currentVP.zoom - 1 / safeZoom);

        const panDx = midX - lastTouchRef.current.x;
        const panDy = midY - lastTouchRef.current.y;

        const finalTargetX = targetXWithZoom - panDx / safeZoom;
        const finalTargetY = targetYWithZoom + panDy / safeZoom;

        scheduleViewPortChange({
          targetX: safeClamp(finalTargetX, -Number.MAX_VALUE, Number.MAX_VALUE),
          targetY: safeClamp(finalTargetY, -Number.MAX_VALUE, Number.MAX_VALUE),
          zoom: safeZoom,
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
            thresholdCap,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

      const currentViewPort = viewPortRef.current;
      const safeZoom = Math.max(Math.abs(currentViewPort.zoom), Number.MIN_VALUE);
      const newTargetX = currentViewPort.targetX - dx / safeZoom;
      const newTargetY = currentViewPort.targetY + dy / safeZoom;

      scheduleViewPortChange({
        targetX: safeClamp(newTargetX, -Number.MAX_VALUE, Number.MAX_VALUE),
        targetY: safeClamp(newTargetY, -Number.MAX_VALUE, Number.MAX_VALUE),
        zoom: currentViewPort.zoom,
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
          thresholdCap,
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
          isCrossing,
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
      <canvas key={engineKind} ref={canvasRef} />
      {engineKind === 'webgl' && textOverlayActive && (
        <canvas key={`text-${engineKind}`} ref={textCanvasRef} className="viewer-text-layer" />
      )}

      {isBoxSelecting && (
        <div
          className={`selection-box ${currentMousePos.x < dragStart.x ? 'crossing' : ''}`}
          style={{
            left: Math.min(dragStart.x, currentMousePos.x),
            top: Math.min(dragStart.y, currentMousePos.y),
            width: Math.abs(currentMousePos.x - dragStart.x),
            height: Math.abs(currentMousePos.y - dragStart.y),
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

export default React.memo(ViewerCanvas);








