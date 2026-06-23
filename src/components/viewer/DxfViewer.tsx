import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import CanvasViewer from '@/components/viewer/CanvasViewer';
import LayerPanel from '@/components/viewer/LayerPanel';
import PropertiesPanel from '@/components/viewer/PropertiesPanel';
import ViewerToolbar from '@/components/viewer/ViewerToolbar';
import DxfTextSearchPanel from '@/components/viewer/DxfTextSearchPanel';
import MobileViewerControls from '@/components/viewer/MobileViewerControls';
import AboutDialog from './AboutDialog';
import { LoadingOverlay, Toast, ToastState, ViewerNotice } from './ViewerFeedback';
import { SpaceSwitchBar, StatusBar } from './ViewerStatus';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { parseDxf } from '@/core/parser/dxfParser';
import { calculateExtents } from '@/core/geometry/extents';
import { AnyEntity, ViewPort, DxfLayer, DxfBlock, EntityType, DxfStyle, DxfLineType, Point2D, CanvasTheme, DrawingColorMode, UiTheme, DxfLayout, ResolvedUiTheme } from '@/types';
import { DEFAULT_LAYER, DEFAULT_VIEWPORT, LAYOUT_CONFIG, SHORTCUT_CONFIG, VIEWER_DEFAULTS, ZOOM_CONFIG, canvasThemeFromUiTheme, getSystemUiTheme, resolveUiTheme } from '@/config/viewerConfig';
import { Language } from '@/config/i18n';
import { decodeDxfBuffer } from '@/core/parser/utils/textDecoder';
import { readViewerUiSettings, ViewerUiSettings, writeViewerUiSettings } from './viewerUiSettings';
import { TextSearchMatch } from '@/utils/entityTextSearch';

/**
 * DXF 查看器主容器组件
 * 负责解析文件、管理全局状态、协调侧边栏与主查看器的交互
 */


/** 判断图纸空间是否可以切换。模型空间始终保留，空图纸空间不进入底部切换栏。 */
const isSwitchableLayout = (layout: DxfLayout): boolean => layout.isModel || layout.entities.length > 0;

/** 判断两个视图是否足够接近，避免同一视图重复入栈。 */
const isSameViewPort = (a: ViewPort, b: ViewPort): boolean => {
  const positionBase = Math.max(1, Math.abs(a.targetX), Math.abs(a.targetY), Math.abs(b.targetX), Math.abs(b.targetY));
  const zoomBase = Math.max(1, Math.abs(a.zoom), Math.abs(b.zoom));
  const positionTolerance = VIEWER_DEFAULTS.viewHistoryPositionTolerance * positionBase;
  const zoomTolerance = VIEWER_DEFAULTS.viewHistoryZoomTolerance * zoomBase;
  return Math.abs(a.targetX - b.targetX) <= positionTolerance
    && Math.abs(a.targetY - b.targetY) <= positionTolerance
    && Math.abs(a.zoom - b.zoom) <= zoomTolerance;
};

export interface DxfViewerProps {
  initFile?: string | File;
  fileName?: string;
  showOpenMenu?: boolean;
  tabStrip?: React.ReactNode;
  onError?: (err: Error) => void; // 错误回调
  onLoad?: (data: any) => void; // 加载完成回调
  onOpenFiles?: (files: File[]) => void; // 由外层容器接管文件打开时使用
  onOpenFailed?: (message: string) => void; // 打开失败回调
  defaultLanguage?: Language; // 默认语言
  lang?: Language; // 受控语言属性
  onLanguageChange?: (lang: Language) => void;
  uiTheme?: UiTheme; // 受控UI主题（画布背景跟随该主题：浅色→白底，深色→黑底）
  onUiThemeChange?: (theme: UiTheme) => void;
  drawingColorMode?: DrawingColorMode; // 受控图纸色彩模式
  onDrawingColorModeChange?: (mode: DrawingColorMode) => void;
}


const DxfViewer: React.FC<DxfViewerProps> = ({ 
  initFile,
  fileName, 
  showOpenMenu = true,
  tabStrip,
  onError, 
  onLoad,
  onOpenFiles,
  onOpenFailed,
  defaultLanguage = VIEWER_DEFAULTS.language,
  lang: controlledLang,
  onLanguageChange,
  uiTheme: controlledUiTheme,
  onUiThemeChange,
  drawingColorMode: controlledDrawingColorMode,
  onDrawingColorModeChange
}) => {
  const savedUiSettingsRef = useRef<ViewerUiSettings>(readViewerUiSettings());
  const [entities, setEntities] = useState<AnyEntity[]>([]);
  const [layouts, setLayouts] = useState<DxfLayout[]>([]);
  const [activeLayoutName, setActiveLayoutName] = useState('Model');
  const [layers, setLayers] = useState<Record<string, DxfLayer>>({ [DEFAULT_LAYER.name]: DEFAULT_LAYER });
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(new Set());
  const hiddenLayersRef = useRef(hiddenLayers);
  const [hiddenEntityIds, setHiddenEntityIds] = useState<Set<string>>(new Set());
  const [isolatedEntityIds, setIsolatedEntityIds] = useState<Set<string> | null>(null);
  const [showAbout, setShowAbout] = useState(false);
  const [showTextSearch, setShowTextSearch] = useState(false);
  const isMobile = useIsMobile();
  const mobileFileInputRef = useRef<HTMLInputElement>(null);

  const toggleLayerVisibility = useCallback((layerName: string) => {
    setHiddenLayers(prev => {
      const next = new Set(prev);
      if (next.has(layerName)) next.delete(layerName);
      else next.add(layerName);
      return next;
    });
  }, []);
  const [blocks, setBlocks] = useState<Record<string, DxfBlock>>({});
  const [styles, setStyles] = useState<Record<string, DxfStyle>>({});
  const [lineTypes, setLineTypes] = useState<Record<string, DxfLineType>>({});
  const [ltScale, setLtScale] = useState(VIEWER_DEFAULTS.defaultLineTypeScale);
  const [worldOffset, setWorldOffset] = useState<Point2D | undefined>();
  const [showLayerPanel, setShowLayerPanel] = useState(savedUiSettingsRef.current.showLayerPanel ?? savedUiSettingsRef.current.showSidebar ?? true);
  const [showProperties, setShowProperties] = useState(savedUiSettingsRef.current.showProperties ?? true);
  const [layerPanelWidth, setLayerPanelWidth] = useState(270);
  const [propertiesWidth, setPropertiesWidth] = useState(330);
  const layerResizingRef = useRef(false);
  const propertiesResizingRef = useRef(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(0);

  const startResizeLayerPanel = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    layerResizingRef.current = true;
    resizeStartXRef.current = e.clientX;
    resizeStartWidthRef.current = layerPanelWidth;
    const onMove = (me: MouseEvent) => {
      if (!layerResizingRef.current) return;
      const delta = me.clientX - resizeStartXRef.current;
      setLayerPanelWidth(Math.max(160, Math.min(520, resizeStartWidthRef.current + delta)));
    };
    const onUp = () => {
      layerResizingRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [layerPanelWidth]);

  const startResizePropertiesPanel = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    propertiesResizingRef.current = true;
    resizeStartXRef.current = e.clientX;
    resizeStartWidthRef.current = propertiesWidth;
    const onMove = (me: MouseEvent) => {
      if (!propertiesResizingRef.current) return;
      const delta = me.clientX - resizeStartXRef.current;
      setPropertiesWidth(Math.max(180, Math.min(560, resizeStartWidthRef.current - delta)));
    };
    const onUp = () => {
      propertiesResizingRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [propertiesWidth]);
  
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingFileName, setLoadingFileName] = useState('');

  const [selectedEntityIds, setSelectedEntityIds] = useState<Set<string>>(new Set());
  
  const [viewPort, setViewPort] = useState<ViewPort>(DEFAULT_VIEWPORT);
  const [viewHistory, setViewHistory] = useState<ViewPort[]>([]);
  const [viewHistoryIndex, setViewHistoryIndex] = useState(-1);
  const viewHistoryRef = useRef<ViewPort[]>([]);
  const viewHistoryIndexRef = useRef(-1);
  const viewHistoryTimerRef = useRef<number | undefined>(undefined);
  const isRestoringViewHistoryRef = useRef(false);
  const [internalUiTheme, setInternalUiTheme] = useState<UiTheme>(savedUiSettingsRef.current.uiTheme ?? VIEWER_DEFAULTS.uiTheme);
  const [internalDrawingColorMode, setInternalDrawingColorMode] = useState<DrawingColorMode>(savedUiSettingsRef.current.drawingColorMode ?? VIEWER_DEFAULTS.drawingColorMode);
  const [internalLang, setInternalLang] = useState<Language>(savedUiSettingsRef.current.language ?? defaultLanguage);
  const [systemTheme, setSystemTheme] = useState<ResolvedUiTheme>(() => getSystemUiTheme());
  const [mouseCoords, setMouseCoords] = useState<{x: number, y: number}>({x: 0, y: 0});
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  
  const [parseErrorMessage, setParseErrorMessage] = useState<string | null>(null);
  const [renderErrorMessage, setRenderErrorMessage] = useState<string | null>(null);
  const [isNoticeDismissed, setIsNoticeDismissed] = useState(false);
  const [toastMessage, setToastMessage] = useState<ToastState | null>(null);

  const showToast = (msg: string, isError: boolean = true) => {
    setToastMessage({msg, isError});
    setTimeout(() => setToastMessage(null), VIEWER_DEFAULTS.toastDurationMs);
  };

  const reportOpenFailure = (message: string) => {
    setParseErrorMessage(null);
    setRenderErrorMessage(null);
    setEntities([]);
    setLayouts([]);
    setActiveLayoutName('Model');
    setHiddenLayers(new Set());
    setHiddenEntityIds(new Set());
    setIsolatedEntityIds(null);
    setShowTextSearch(false);
    showToast(message);
    onOpenFailed?.(message);
  };

  const lang = controlledLang || internalLang;
  const handleSetLang = useCallback((newLang: Language) => {
    setInternalLang(newLang);
    onLanguageChange?.(newLang);
  }, [onLanguageChange]);

  const uiTheme = controlledUiTheme || internalUiTheme;
  const effectiveUiTheme = resolveUiTheme(uiTheme, systemTheme);
  const handleSetUiTheme = useCallback((newTheme: UiTheme) => {
    setInternalUiTheme(newTheme);
    onUiThemeChange?.(newTheme);
  }, [onUiThemeChange]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const updateSystemTheme = () => setSystemTheme(media.matches ? 'dark' : 'light');
    updateSystemTheme();
    media.addEventListener?.('change', updateSystemTheme);
    return () => media.removeEventListener?.('change', updateSystemTheme);
  }, []);

  useEffect(() => {
    hiddenLayersRef.current = hiddenLayers;
  }, [hiddenLayers]);

  const displayEntities = useMemo(() => {
    return entities.filter(entity => {
      if (hiddenEntityIds.has(entity.id)) return false;
      if (isolatedEntityIds && !isolatedEntityIds.has(entity.id)) return false;
      return true;
    });
  }, [entities, hiddenEntityIds, isolatedEntityIds]);

  // 画布背景跟随最终 UI 主题：浅色 UI → 白底，深色 UI → 黑底。
  // 不再单独暴露 canvasTheme，避免 UI 主题与画布背景不一致。
  const canvasTheme: CanvasTheme = canvasThemeFromUiTheme(effectiveUiTheme);
  const canvasBgColor = canvasTheme === 'white' ? '#FFFFFF' : '#212121';

  const drawingColorMode = controlledDrawingColorMode || internalDrawingColorMode;
  const handleSetDrawingColorMode = useCallback((newMode: DrawingColorMode) => {
    setInternalDrawingColorMode(newMode);
    onDrawingColorModeChange?.(newMode);
  }, [onDrawingColorModeChange]);

  useEffect(() => {
    writeViewerUiSettings({
      uiTheme,
      drawingColorMode,
      language: lang,
      showLayerPanel,
      showProperties,
    });
  }, [uiTheme, drawingColorMode, lang, showLayerPanel, showProperties]);

  const clearViewHistoryTimer = useCallback(() => {
    if (viewHistoryTimerRef.current !== undefined) {
      window.clearTimeout(viewHistoryTimerRef.current);
      viewHistoryTimerRef.current = undefined;
    }
  }, []);

  const applyViewHistory = useCallback((history: ViewPort[], index: number) => {
    viewHistoryRef.current = history;
    viewHistoryIndexRef.current = index;
    setViewHistory(history);
    setViewHistoryIndex(index);
  }, []);

  const resetViewHistory = useCallback(() => {
    clearViewHistoryTimer();
    applyViewHistory([], -1);
  }, [applyViewHistory, clearViewHistoryTimer]);

  const commitViewHistory = useCallback((nextViewPort: ViewPort) => {
    const history = viewHistoryRef.current;
    const currentIndex = viewHistoryIndexRef.current;
    const currentViewPort = currentIndex >= 0 ? history[currentIndex] : undefined;
    if (currentViewPort && isSameViewPort(currentViewPort, nextViewPort)) return;

    const baseHistory = currentIndex >= 0 ? history.slice(0, currentIndex + 1) : [];
    const lastViewPort = baseHistory[baseHistory.length - 1];
    if (lastViewPort && isSameViewPort(lastViewPort, nextViewPort)) return;

    const limitedHistory = [...baseHistory, nextViewPort].slice(-VIEWER_DEFAULTS.viewHistoryMaxSize);
    applyViewHistory(limitedHistory, limitedHistory.length - 1);
  }, [applyViewHistory]);

  const handleViewPortChange = useCallback((nextViewPort: ViewPort) => {
    setViewPort(nextViewPort);
  }, []);

  const goToViewHistory = useCallback((nextIndex: number) => {
    const history = viewHistoryRef.current;
    if (nextIndex < 0 || nextIndex >= history.length) return;
    clearViewHistoryTimer();
    isRestoringViewHistoryRef.current = true;
    viewHistoryIndexRef.current = nextIndex;
    setViewHistoryIndex(nextIndex);
    setViewPort(history[nextIndex]);
  }, [clearViewHistoryTimer]);

  const handlePreviousView = useCallback(() => {
    goToViewHistory(viewHistoryIndexRef.current - 1);
  }, [goToViewHistory]);

  const handleNextView = useCallback(() => {
    goToViewHistory(viewHistoryIndexRef.current + 1);
  }, [goToViewHistory]);

  useEffect(() => {
    viewHistoryRef.current = viewHistory;
  }, [viewHistory]);

  useEffect(() => {
    viewHistoryIndexRef.current = viewHistoryIndex;
  }, [viewHistoryIndex]);

  useEffect(() => {
    if (isRestoringViewHistoryRef.current) {
      isRestoringViewHistoryRef.current = false;
      return;
    }
    if (entities.length === 0) return;
    clearViewHistoryTimer();
    viewHistoryTimerRef.current = window.setTimeout(() => {
      commitViewHistory(viewPort);
      viewHistoryTimerRef.current = undefined;
    }, VIEWER_DEFAULTS.viewHistoryIdleMs);

    return clearViewHistoryTimer;
  }, [clearViewHistoryTimer, commitViewHistory, entities.length, viewPort]);

  const fitView = useCallback((ents: AnyEntity[], blks: Record<string, DxfBlock>, currentStyles: Record<string, DxfStyle> = styles) => {
    if (ents.length === 0) return;
    const currentHiddenLayers = hiddenLayersRef.current;
    const visibleEnts = ents.filter(e => e.visible !== false && e.type !== EntityType.ATTDEF && !currentHiddenLayers.has(e.layer));
    if (visibleEnts.length === 0) return;

    const extents = calculateExtents(visibleEnts, blks, currentStyles);

    // 第 2 步：计算世界中心
    const centerX = extents.center.x;
    const centerY = extents.center.y;

    // 第 3 步：从 viewerRef 获取实际容器尺寸
    let containerW = window.innerWidth;
    let containerH = window.innerHeight;

    if (viewerRef.current) {
      const rect = viewerRef.current.getBoundingClientRect();
      containerW = rect.width;
      containerH = rect.height;
    } else if (containerRef.current) {
      // 如果查看器容器尚未准备好，则回退到应用容器并减去估计的栏宽。
      const rect = containerRef.current.getBoundingClientRect();
      containerW = rect.width - LAYOUT_CONFIG.fallbackLayerPanelWidth - LAYOUT_CONFIG.fallbackPropertiesWidth;
      containerH = rect.height - LAYOUT_CONFIG.fallbackToolbarHeight - LAYOUT_CONFIG.fallbackStatusBarHeight;
    }

    containerW = Math.max(containerW, LAYOUT_CONFIG.minViewportWidth);
    containerH = Math.max(containerH, LAYOUT_CONFIG.minViewportHeight);

    if (extents.width <= 0 && extents.height <= 0) {
        setViewPort(prev => ({ ...prev, targetX: centerX, targetY: centerY, zoom: 1 }));
        return;
    }

    const worldW = extents.width;
    const worldH = extents.height;

    const scaleX = (containerW / worldW) * ZOOM_CONFIG.fitViewMarginFactor;
    const scaleY = (containerH / worldH) * ZOOM_CONFIG.fitViewMarginFactor;
    let zoom = Math.min(scaleX, scaleY);
    
    if (isNaN(zoom) || !isFinite(zoom) || zoom <= 0) {
        zoom = 1.0;
    }

    zoom = Math.max(Math.min(zoom, ZOOM_CONFIG.maxZoom), ZOOM_CONFIG.minZoom);

    setViewPort({ 
        targetX: centerX, 
        targetY: centerY, 
        zoom 
    });
  }, [styles]);

  const processBuffer = async (buffer: ArrayBuffer) => {
    let decoded: ReturnType<typeof decodeDxfBuffer>;
    try {
        decoded = decodeDxfBuffer(buffer);
    } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        onError?.(error);
        const message = lang === 'zh' ? `DXF 解码失败：${error.message}` : `DXF decode failed: ${error.message}`;
        reportOpenFailure(message);
        setIsLoading(false);
        return;
    }

    try {
        const data = await parseDxf(decoded.text, (progress) => {
            setLoadingProgress(progress);
        });
        setParseErrorMessage(null);
        setRenderErrorMessage(null);
        const parsedLayouts = data.layouts || [];
        const switchableLayouts = parsedLayouts.filter(isSwitchableLayout);
        const initialLayout = switchableLayouts.find(layout => layout.name === data.activeLayoutName)
          || switchableLayouts.find(layout => layout.isModel)
          || switchableLayouts[0];
        const initialEntities = initialLayout?.entities || data.entities;

        resetViewHistory();
        setHiddenEntityIds(new Set());
        setIsolatedEntityIds(null);
        setShowTextSearch(false);
        setHiddenLayers(new Set());
        setLayouts(switchableLayouts);
        setActiveLayoutName(initialLayout?.name || 'Model');
        setEntities(initialEntities);
        setSelectedEntityIds(new Set());
        setLayers(data.layers);
        setBlocks(data.blocks);
        setStyles(data.styles);
        setLineTypes(data.lineTypes);
        setLtScale(data.header?.ltScale ?? VIEWER_DEFAULTS.defaultLineTypeScale);
        setWorldOffset(data.offset);
        onLoad?.({ ...data, sourceFormat: decoded.format });
        
        const applyFitView = () => fitView(initialEntities, data.blocks, data.styles);
        applyFitView();
        requestAnimationFrame(applyFitView);
        window.setTimeout(applyFitView, 0);
    } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        onError?.(error);
        const message = lang === 'zh' ? `DXF 解析失败：${error.message}` : `DXF parse failed: ${error.message}`;
        reportOpenFailure(message);
        console.error(err);
    } finally {
        setIsLoading(false);
    }
  };

  const loadFromUrl = async (url: string) => {
    setIsLoading(true);
    setLoadingProgress(0);
    setLoadingFileName(fileName || url.split(/[\\/]/).pop() || url);
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
        const buffer = await response.arrayBuffer();
        await processBuffer(buffer);
    } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        onError?.(error);
        const message = lang === 'zh' ? `DXF 加载失败：${error.message}` : `DXF load failed: ${error.message}`;
        reportOpenFailure(message);
        setIsLoading(false);
    }
  };

  const loadFromFile = async (file: File) => {
    setIsLoading(true);
    setLoadingProgress(0);
    setLoadingFileName(file.name);
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const buffer = evt.target?.result as ArrayBuffer;
      await processBuffer(buffer);
    };
    reader.onerror = () => {
        const error = new Error(lang === 'zh' ? "文件读取失败" : "File Read Error");
        onError?.(error);
        const message = lang === 'zh' ? `DXF 加载失败：${error.message}` : `DXF load failed: ${error.message}`;
        reportOpenFailure(message);
        setIsLoading(false);
    };
    reader.readAsArrayBuffer(file);
  };

  // 在窗口大小调整或布局更改时调整视图
  useEffect(() => {
    const handleResize = () => {
      if (entities.length > 0) {
        fitView(entities, blocks);
      }
    };
    
    // 观察 viewerRef 以进行更准确的大小调整检测
    const observer = new ResizeObserver(() => {
      // 使用下一帧回调，避免尺寸观察器循环限制错误。
      requestAnimationFrame(() => {
        handleResize();
      });
    });

    if (viewerRef.current) {
      observer.observe(viewerRef.current);
    } else if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    
    window.addEventListener('resize', handleResize);
    
    // 初始调整
    handleResize();
    
    return () => {
      window.removeEventListener('resize', handleResize);
      observer.disconnect();
    };
  }, [entities, blocks, fitView]);

  // 如果提供了初始文件，则加载
  useEffect(() => {
    if (initFile) {
        if (typeof initFile === 'string') {
            loadFromUrl(initFile);
        } else if (initFile instanceof File) {
            loadFromFile(initFile);
        }
    }
  }, [initFile]);

  const locateEntity = useCallback((entity: AnyEntity) => {
      const extents = calculateExtents([entity], blocks, styles);
      const containerRect = viewerRef.current?.getBoundingClientRect();
      const containerW = Math.max(containerRect?.width || window.innerWidth - LAYOUT_CONFIG.fallbackLayerPanelWidth - LAYOUT_CONFIG.fallbackPropertiesWidth, LAYOUT_CONFIG.minViewportWidth);
      const containerH = Math.max(containerRect?.height || window.innerHeight - LAYOUT_CONFIG.fallbackToolbarHeight - LAYOUT_CONFIG.fallbackStatusBarHeight, LAYOUT_CONFIG.minViewportHeight);

      const w = extents.width;
      const h = extents.height;
      if (w > 0 || h > 0) {
          const zoomX = w > 0 ? (containerW / w) * ZOOM_CONFIG.singleEntityMarginFactor : ZOOM_CONFIG.maxSingleEntityZoom;
          const zoomY = h > 0 ? (containerH / h) * ZOOM_CONFIG.singleEntityMarginFactor : ZOOM_CONFIG.maxSingleEntityZoom;
          const zoom = Math.min(zoomX, zoomY, ZOOM_CONFIG.maxSingleEntityZoom);
          handleViewPortChange({ targetX: extents.center.x, targetY: extents.center.y, zoom });
      } else {
          handleViewPortChange({ targetX: extents.center.x, targetY: extents.center.y, zoom: Math.min(viewPort.zoom, ZOOM_CONFIG.maxSingleEntityZoom) || 1 });
      }
  }, [blocks, handleViewPortChange, styles, viewPort.zoom]);

  const handleSelectAndLocateIds = useCallback((ids: Set<string>) => {
      setSelectedEntityIds(ids);
      if (ids.size === 1) {
          const id = Array.from(ids)[0];
          const ent = entities.find(e => e.id === id);
          if (ent) locateEntity(ent);
      }
  }, [entities, locateEntity]);

  const handleLayerPanelSelectIds = (ids: Set<string>) => {
      handleSelectAndLocateIds(ids);
  };

  const handleFitView = useCallback(() => {
      fitView(displayEntities, blocks);
  }, [displayEntities, blocks, fitView]);

  const handleSetActiveLayout = useCallback((layoutName: string) => {
      const layout = layouts.find(item => item.name === layoutName);
      if (!layout || layout.name === activeLayoutName) return;
      resetViewHistory();
      setActiveLayoutName(layout.name);
      setEntities(layout.entities);
      setSelectedEntityIds(new Set());
      setHiddenEntityIds(new Set());
      setIsolatedEntityIds(null);
      setShowTextSearch(false);
      setRenderErrorMessage(null);
      setIsNoticeDismissed(false);

      const applyFitView = () => fitView(layout.entities, blocks, styles);
      applyFitView();
      requestAnimationFrame(applyFitView);
  }, [activeLayoutName, blocks, fitView, layouts, resetViewHistory, styles]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!containerRef.current) return;
      if (getComputedStyle(containerRef.current).visibility === 'hidden') return;
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      if (tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target?.isContentEditable) return;

      const key = event.key.toLowerCase();
      if (!event.ctrlKey && !event.metaKey && SHORTCUT_CONFIG.fitViewKeys.includes(key)) {
        event.preventDefault();
        handleFitView();
        return;
      }

      if (event.key === SHORTCUT_CONFIG.clearSelectionKey) {
        setSelectedEntityIds(new Set());
        setParseErrorMessage(null);
        setRenderErrorMessage(null);
        setIsNoticeDismissed(true);
      }
    };

    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [handleFitView]);



  const handleImport = async (files: File[]) => {
    if (files.length === 0) return;

    if (onOpenFiles) {
      onOpenFiles(files);
      return;
    }

    setIsLoading(true);
    setLoadingProgress(0);
    setLoadingFileName(files[0].name);
    await loadFromFile(files[0]);
  };

  const handleMobileFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    event.target.value = '';
    if (files.length > 0) handleImport(files);
  };

  const handleShowAllEntities = useCallback(() => {
    setHiddenLayers(new Set());
    setHiddenEntityIds(new Set());
    setIsolatedEntityIds(null);
  }, []);

  const resolveActionSelection = useCallback((ids?: Set<string>) => {
    return ids && ids.size > 0 ? new Set(ids) : new Set(selectedEntityIds);
  }, [selectedEntityIds]);

  const handleHideSelectedEntities = useCallback((ids?: Set<string>) => {
    const actionIds = resolveActionSelection(ids);
    if (actionIds.size === 0) return;
    setHiddenEntityIds(prev => new Set([...prev, ...actionIds]));
    setIsolatedEntityIds(prev => {
      if (!prev) return prev;
      const next = new Set([...prev].filter(id => !actionIds.has(id)));
      return next.size > 0 ? next : null;
    });
    setSelectedEntityIds(new Set());
  }, [resolveActionSelection]);

  const handleIsolateSelectedEntities = useCallback((ids?: Set<string>) => {
    const actionIds = resolveActionSelection(ids);
    if (actionIds.size === 0) return;
    setHiddenLayers(new Set());
    setHiddenEntityIds(new Set());
    setIsolatedEntityIds(actionIds);
    setSelectedEntityIds(actionIds);
  }, [resolveActionSelection]);

  const handleHideSelectedLayers = useCallback((ids?: Set<string>) => {
    const actionIds = resolveActionSelection(ids);
    if (actionIds.size === 0) return;
    const selectedLayers = new Set(entities.filter(entity => actionIds.has(entity.id)).map(entity => entity.layer));
    if (selectedLayers.size === 0) return;
    setHiddenLayers(prev => new Set([...prev, ...selectedLayers]));
    setIsolatedEntityIds(null);
    setSelectedEntityIds(new Set());
  }, [entities, resolveActionSelection]);

  const handleLocateTextMatch = useCallback((match: TextSearchMatch) => {
    setHiddenEntityIds(prev => {
      if (!prev.has(match.id)) return prev;
      const next = new Set(prev);
      next.delete(match.id);
      return next;
    });
    setHiddenLayers(prev => {
      if (!prev.has(match.entity.layer)) return prev;
      const next = new Set(prev);
      next.delete(match.entity.layer);
      return next;
    });
    setIsolatedEntityIds(null);
    handleSelectAndLocateIds(new Set([match.id]));
  }, [handleSelectAndLocateIds]);

  const selectedEntities = entities.filter(e => selectedEntityIds.has(e.id));
  const viewerNoticeMessage = useMemo(() => {
    if (parseErrorMessage || isLoading || isNoticeDismissed) return null;
    if (renderErrorMessage) {
      return lang === 'zh' ? `DXF 渲染失败：${renderErrorMessage}` : `DXF render failed: ${renderErrorMessage}`;
    }
    return null;
  }, [parseErrorMessage, isLoading, isNoticeDismissed, renderErrorMessage, lang]);

  const layerPanelContent = (
    <LayerPanel
      layers={layers}
      entities={displayEntities}
      selectedEntityIds={selectedEntityIds}
      onSelectIds={handleLayerPanelSelectIds}
      lang={lang}
      hiddenLayers={hiddenLayers}
      onToggleLayerVisibility={toggleLayerVisibility}
    />
  );

  const propertiesContent = (
    <PropertiesPanel
      entities={selectedEntities}
      styles={styles}
      offset={worldOffset}
      lang={lang}
    />
  );

  // PC 模式下带动态宽度的面板包裹器
  const layerPanelWrapped = !isMobile && showLayerPanel ? (
    <div style={{ display: 'flex', flexShrink: 0, height: '100%' }}>
      <div style={{ width: layerPanelWidth, flexShrink: 0, height: '100%', overflow: 'hidden' }}>
        {layerPanelContent}
      </div>
      <div
        className="panel-resize-handle panel-resize-handle-right"
        onMouseDown={startResizeLayerPanel}
        title="Drag to resize"
      />
    </div>
  ) : null;

  const propertiesPanelWrapped = !isMobile && showProperties ? (
    <div style={{ display: 'flex', flexShrink: 0, height: '100%' }}>
      <div
        className="panel-resize-handle panel-resize-handle-left"
        onMouseDown={startResizePropertiesPanel}
        title="Drag to resize"
      />
      <div style={{ width: propertiesWidth, flexShrink: 0, height: '100%', overflow: 'hidden' }}>
        {propertiesContent}
      </div>
    </div>
  ) : null;

  return (
    <div ref={containerRef} className={`app-container ${effectiveUiTheme === 'dark' ? 'theme-dark' : ''} ${isMobile ? 'is-mobile' : ''}`} style={{ height: '100%', display: 'flex', flexDirection: 'column', '--canvas-bg': canvasBgColor } as React.CSSProperties}>
      <input
        ref={mobileFileInputRef}
        type="file"
        accept=".dxf"
        multiple
        onChange={handleMobileFileChange}
        className="hidden-file-input"
      />
      {toastMessage && <Toast toast={toastMessage} onClose={() => setToastMessage(null)} />}
      {isLoading && <LoadingOverlay lang={lang} fileName={loadingFileName} progress={loadingProgress} />}

      {(!isMobile || tabStrip) && (
        <div className="menu-tab-row">
        {!isMobile && (
          <ViewerToolbar
            onImport={handleImport}
            onFitView={handleFitView}
            onPreviousView={handlePreviousView}
            onNextView={handleNextView}
            onToggleSearch={() => setShowTextSearch(value => !value)}
            isSearchActive={showTextSearch}
            canGoPreviousView={viewHistoryIndex > 0}
            canGoNextView={viewHistoryIndex >= 0 && viewHistoryIndex < viewHistory.length - 1}
            showOpen={showOpenMenu}
            uiTheme={uiTheme}
            onSetUiTheme={handleSetUiTheme}
            drawingColorMode={drawingColorMode}
            onSetDrawingColorMode={handleSetDrawingColorMode}
            lang={lang}
            onSetLang={handleSetLang}
            showLayerPanel={showLayerPanel}
            onToggleLayerPanel={() => setShowLayerPanel(v => !v)}
            showProperties={showProperties}
            onToggleProperties={() => setShowProperties(v => !v)}
            onShowAbout={() => setShowAbout(true)}
          />
        )}
        {tabStrip && <div className="menu-tab-strip">{tabStrip}</div>}
        </div>
      )}

      <div className="main-content">
        {layerPanelWrapped}

        <main ref={viewerRef} className="viewer-container">
          {viewerNoticeMessage && (
            <ViewerNotice
              lang={lang}
              message={viewerNoticeMessage}
              hasEntities={entities.length > 0}
              onFitView={handleFitView}
              onDismiss={() => { setRenderErrorMessage(null); setIsNoticeDismissed(true); }}
            />
          )}
          {entities.length > 0 && showTextSearch && (
            <DxfTextSearchPanel
              entities={entities}
              blocks={blocks}
              lang={lang}
              onLocate={handleLocateTextMatch}
              onClose={() => setShowTextSearch(false)}
            />
          )}
          <CanvasViewer
            entities={displayEntities}
            layers={layers}
            blocks={blocks}
            styles={styles}
            lineTypes={lineTypes}
            ltScale={ltScale}
            viewPort={viewPort}
            onViewPortChange={handleViewPortChange}
            selectedEntityIds={selectedEntityIds}
            onSelectIds={setSelectedEntityIds}
            onFitView={handleFitView}
            onShowAll={handleShowAllEntities}
            onHideSelected={handleHideSelectedEntities}
            onIsolateSelected={handleIsolateSelectedEntities}
            onHideSelectedLayers={handleHideSelectedLayers}
            worldOffset={worldOffset}
            theme={canvasTheme}
            drawingColorMode={drawingColorMode}
            lang={lang}
            onMouseMoveWorld={(x, y) => setMouseCoords({x, y})}
            onRenderError={setRenderErrorMessage}
            hiddenLayers={hiddenLayers}
          />


          {isMobile && (
            <MobileViewerControls
              lang={lang}
              showOpen={showOpenMenu}
              onOpen={() => mobileFileInputRef.current?.click()}
              onFitView={handleFitView}
              onPreviousView={handlePreviousView}
              onNextView={handleNextView}
              onToggleSearch={() => setShowTextSearch(value => !value)}
              isSearchActive={showTextSearch}
              canGoPreviousView={viewHistoryIndex > 0}
              canGoNextView={viewHistoryIndex >= 0 && viewHistoryIndex < viewHistory.length - 1}
              uiTheme={uiTheme}
              onSetUiTheme={handleSetUiTheme}
              drawingColorMode={drawingColorMode}
              onSetDrawingColorMode={handleSetDrawingColorMode}
              onSetLang={handleSetLang}
              onShowAbout={() => setShowAbout(true)}
              mouseCoords={mouseCoords}
              selectedCount={selectedEntityIds.size}
              layerPanelContent={layerPanelContent}
              propertiesContent={propertiesContent}
              layouts={layouts}
              activeLayoutName={activeLayoutName}
              onSelectLayout={handleSetActiveLayout}
            />
          )}
        </main>

        {propertiesPanelWrapped}
      </div>

      {!isMobile && layouts.length > 1 && (
        <SpaceSwitchBar
          layouts={layouts}
          activeLayoutName={activeLayoutName}
          lang={lang}
          onSelect={handleSetActiveLayout}
        />
      )}

      {!isMobile && (
        <StatusBar
          lang={lang}
          mouseCoords={mouseCoords}
          selectedCount={selectedEntityIds.size}
          activeLayoutName={activeLayoutName}
          entityCount={displayEntities.length}
        />
      )}

      {showAbout && <AboutDialog lang={lang} onClose={() => setShowAbout(false)} />}
    </div>
  );
}

export default DxfViewer;
