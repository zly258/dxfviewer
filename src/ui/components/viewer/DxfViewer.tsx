import React, { useState, useCallback, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import ViewerCanvas from '@/ui/components/viewer/ViewerCanvas';
import ViewerToolbar, { ExportKind } from '@/ui/components/viewer/ViewerToolbar';
import ViewerHeader from '@/ui/components/viewer/ViewerHeader';
import { exportPng, exportPdfVector, exportSvg } from '@/export';
import { writeDxf } from '@/writer';
import MobileViewerControls from '@/ui/components/viewer/MobileViewerControls';
import { LoadingOverlay, Toast, ToastState, ViewerNotice } from '@/ui/components/common/Overlays';
import { SpaceSwitchBar, StatusBar } from '@/ui/components/common/StatusBars';

const AboutDialog = lazy(() => import('@/ui/components/common/AboutDialog'));
const DxfTextSearchPanel = lazy(() => import('@/ui/components/viewer/DxfTextSearchPanel'));
const LayerPanel = lazy(() => import('@/ui/components/viewer/LayerPanel'));
const PropertiesPanel = lazy(() => import('@/ui/components/viewer/PropertiesPanel'));

import { useIsMobile } from '@/ui/hooks/useMediaQuery';
import { useViewHistory } from '@/ui/hooks/useViewHistory';
import { useEntityVisibility } from '@/ui/hooks/useEntityVisibility';
import { useDxfLoader } from '@/io/loader/useDxfLoader';
import { isAbortError } from '@/utils/abortError';
import { calculateExtents, calculatePaperLayoutExtents } from '@/core/geometry/extents';
import { fitExtentsToBox } from '@/render/viewportFitting';
import { AnyEntity, ViewPort, DxfLayer, DxfBlock, DxfData, EntityType, DxfStyle, DxfLineType, Point2D, CanvasTheme, DrawingColorMode, UiTheme, DxfLayout, ResolvedUiTheme, DxfLoadResult, DxfLoadedData } from '@/types';
import { CANVAS_THEME_COLORS, DEFAULT_LAYER, DEFAULT_VIEWPORT, LAYOUT_CONFIG, SHORTCUT_CONFIG, VIEWER_DEFAULTS, ZOOM_CONFIG, PANEL_CONFIG, clampPanelWidth, canvasThemeFromUiTheme, getSystemUiTheme, resolveUiTheme } from '@/config/viewerConfig';
import { Language, t } from '@/ui/i18n';
import { readViewerUiSettings, ViewerUiSettings, writeViewerUiSettings } from './viewerUiSettings';
import { TextSearchMatch } from '@/utils/entityTextSearch';
import { clearAllRenderCaches } from '@/render/text/renderCache';

/**
 * DXF 查看器主容器组件
 * 负责解析文件、管理全局状态、协调侧边栏与主查看器的交互
 */

/** 判断图纸空间是否可以切换。模型空间始终保留，空图纸空间不进入底部切换栏。 */
const isSwitchableLayout = (layout: DxfLayout): boolean => layout.isModel || layout.entities?.length > 0;

export interface DxfViewerProps {
  active?: boolean;
  initFile?: string | File;
  fileName?: string;
  showOpenMenu?: boolean;
  /** 关闭当前图纸。由工作区接管时弹出确认。 */
  onClose?: () => void;
  onError?: (err: Error) => void; // 错误回调
  onLoad?: (data: DxfLoadedData) => void; // 加载完成回调
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
  active = true,
  initFile,
  fileName, 
  showOpenMenu = true,
  onClose,
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
  // 当前布局名镜像：供不参与依赖链的回调读取（避免触发重新加载）
  const activeLayoutNameRef = useRef('Model');
  useEffect(() => { activeLayoutNameRef.current = activeLayoutName; }, [activeLayoutName]);
  const [layers, setLayers] = useState<Record<string, DxfLayer>>({ [DEFAULT_LAYER.name]: DEFAULT_LAYER });
  const [showAbout, setShowAbout] = useState(false);
  const [showTextSearch, setShowTextSearch] = useState(false);
  const isMobile = useIsMobile();
  const mobileFileInputRef = useRef<HTMLInputElement>(null);

  const {
    hiddenLayers,
    setHiddenLayers,
    hiddenLayersRef,
    hiddenEntityIds,
    setHiddenEntityIds,
    isolatedEntityIds,
    setIsolatedEntityIds,
    toggleLayerVisibility,
    displayEntities,
    resetVisibility
  } = useEntityVisibility(entities);

  const [blocks, setBlocks] = useState<Record<string, DxfBlock>>({});
  const [styles, setStyles] = useState<Record<string, DxfStyle>>({});
  const [lineTypes, setLineTypes] = useState<Record<string, DxfLineType>>({});
  const [ltScale, setLtScale] = useState(VIEWER_DEFAULTS.defaultLineTypeScale);
  const [worldOffset, setWorldOffset] = useState<Point2D | undefined>();
  const [showLayerPanel, setShowLayerPanel] = useState(savedUiSettingsRef.current.showLayerPanel ?? savedUiSettingsRef.current.showSidebar ?? true);
  const [showProperties, setShowProperties] = useState(savedUiSettingsRef.current.showProperties ?? true);
  const [layerPanelWidth, setLayerPanelWidth] = useState(() =>
    clampPanelWidth(PANEL_CONFIG.layerPanelMinWidth, PANEL_CONFIG.layerPanelViewportRatio, PANEL_CONFIG.layerPanelMaxWidth));
  const [propertiesWidth, setPropertiesWidth] = useState(() =>
    clampPanelWidth(PANEL_CONFIG.propertiesPanelMinWidth, PANEL_CONFIG.propertiesPanelViewportRatio, PANEL_CONFIG.propertiesPanelMaxWidth));
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
      setLayerPanelWidth(Math.max(PANEL_CONFIG.layerPanelMinWidth, Math.min(PANEL_CONFIG.layerPanelMaxWidth, resizeStartWidthRef.current + delta)));
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
      setPropertiesWidth(Math.max(PANEL_CONFIG.propertiesPanelMinWidth, Math.min(PANEL_CONFIG.propertiesPanelMaxWidth, resizeStartWidthRef.current - delta)));
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
  
  const [selectedEntityIds, setSelectedEntityIds] = useState<Set<string>>(new Set());

  // 视口投影用：模型空间布局的实体引用（当前布局即模型空间时由 CanvasViewer 自引用防护禁用）
  const modelLayoutEntities = useMemo(
    () => layouts.find(l => l.isModel)?.entities ?? [],
    [layouts],
  );
  
  const {
    viewPort,
    setViewPort,
    resetViewHistory,
    handlePreviousView,
    handleNextView,
    canGoPreviousView,
    canGoNextView
  } = useViewHistory(DEFAULT_VIEWPORT, entities.length > 0);

  const [internalUiTheme, setInternalUiTheme] = useState<UiTheme>(savedUiSettingsRef.current.uiTheme ?? VIEWER_DEFAULTS.uiTheme);
  const [internalDrawingColorMode, setInternalDrawingColorMode] = useState<DrawingColorMode>(savedUiSettingsRef.current.drawingColorMode ?? VIEWER_DEFAULTS.drawingColorMode);
  const [internalLang, setInternalLang] = useState<Language>(savedUiSettingsRef.current.language ?? defaultLanguage);
  const [systemTheme, setSystemTheme] = useState<ResolvedUiTheme>(() => getSystemUiTheme());
  const [mouseCoords, setMouseCoords] = useState<{x: number, y: number}>({x: 0, y: 0});
  const pendingMouseCoordsRef = useRef<{ x: number; y: number } | null>(null);
  const mouseCoordsFrameRef = useRef<number | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const fitViewFrameRef = useRef<number | undefined>(undefined);
  const onLoadRef = useRef(onLoad);
  /**
   * 已成功加载完成的 initFile 标识：切换文件标签（active 变化）或右键标签时
   * 不得重复加载/刷新；只有 initFile 真正变化、或上次加载被中断时才重新解析。
   */
  const loadedInitFileRef = useRef<string | File | undefined>(undefined);
  /** 最近一次发起加载的 initFile（加载成功时提升为 loadedInitFileRef）。 */
  const pendingInitFileRef = useRef<string | File | undefined>(undefined);
  
  const [parseErrorMessage, setParseErrorMessage] = useState<string | null>(null);
  const [renderErrorMessage, setRenderErrorMessage] = useState<string | null>(null);
  const [isNoticeDismissed, setIsNoticeDismissed] = useState(false);
  const [toastMessage, setToastMessage] = useState<ToastState | null>(null);
  /** 最近一次成功加载的完整图纸数据（导出用：含全部布局/块/图层）。 */
  const loadedDataRef = useRef<DxfData | null>(null);

  useEffect(() => {
    onLoadRef.current = onLoad;
  }, [onLoad]);

  const showToast = useCallback((msg: string, isError: boolean = true) => {
    setToastMessage({msg, isError});
    setTimeout(() => setToastMessage(null), VIEWER_DEFAULTS.toastDurationMs);
  }, []);

  const reportOpenFailure = useCallback((message: string) => {
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
  }, [onOpenFailed, setHiddenEntityIds, setHiddenLayers, setIsolatedEntityIds, showToast]);

  const lang = controlledLang || internalLang;
  const { isLoading, loadingProgress, loadingFileName, loadFromUrl, loadFromFile } = useDxfLoader(lang, onError);

  const uiTheme = controlledUiTheme || internalUiTheme;
  const effectiveUiTheme = resolveUiTheme(uiTheme, systemTheme);

  // 画布背景跟随最终 UI 主题：浅色 UI → 白底，深色 UI → 黑底。
  // 不再单独暴露 canvasTheme，避免 UI 主题与画布背景不一致。
  const canvasTheme: CanvasTheme = canvasThemeFromUiTheme(effectiveUiTheme);
  const canvasBgColor = CANVAS_THEME_COLORS[canvasTheme];

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

  const handleSetLang = useCallback((newLang: Language) => {
    setInternalLang(newLang);
    onLanguageChange?.(newLang);
  }, [onLanguageChange]);

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

  const fitView = useCallback((
    ents: AnyEntity[],
    blks: Record<string, DxfBlock>,
    currentStyles: Record<string, DxfStyle>,
    knownExtents?: DxfLayout['extents'],
  ) => {
    if (ents.length === 0) return;
    const currentHiddenLayers = hiddenLayersRef.current;
    const visibleEnts = ents.filter(e => e.visible !== false && e.type !== EntityType.ATTDEF && !currentHiddenLayers.has(e.layer));
    if (visibleEnts.length === 0) return;

    const canUseKnownExtents = Boolean(knownExtents)
      && ents.every(entity => entity.visible !== false)
      && currentHiddenLayers.size === 0;
    // 纸张空间布局按图框取景：视口矩形可能远大于图纸（初始 1:1 视口），
    // 直接用实体范围会被空白拉小。
    // 用 ref 镜像当前布局名：若把 activeLayoutName 放进依赖链，
    // 会连带 scheduleFitView → applyLoadResult → 加载 effect 重跑，
    // 导致切换布局后文件被重新加载、布局被重置回模型空间。
    const isPaperLayout = activeLayoutNameRef.current !== 'Model';
    const extents = canUseKnownExtents
      ? knownExtents!
      : (isPaperLayout
          ? calculatePaperLayoutExtents(visibleEnts, blks, currentStyles)
          : calculateExtents(visibleEnts, blks, currentStyles));

    // 第 2 步：从 viewerRef 获取实际容器尺寸
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

    // 视口适配数学与导出（PNG/PDF）共用 viewportFitting，保证所见即所得。
    setViewPort(fitExtentsToBox(extents, containerW, containerH, {
        marginFactor: ZOOM_CONFIG.fitViewMarginFactor,
        minZoom: ZOOM_CONFIG.minZoom,
        maxZoom: ZOOM_CONFIG.maxZoom,
    }));
  }, [setViewPort]);

  const scheduleFitView = useCallback((
    ents: AnyEntity[],
    blks: Record<string, DxfBlock>,
    currentStyles: Record<string, DxfStyle>,
    knownExtents?: DxfLayout['extents'],
  ) => {
    if (fitViewFrameRef.current !== undefined) cancelAnimationFrame(fitViewFrameRef.current);
    fitViewFrameRef.current = requestAnimationFrame(() => {
      fitViewFrameRef.current = undefined;
      fitView(ents, blks, currentStyles, knownExtents);
    });
  }, [fitView]);

  useEffect(() => () => {
    if (fitViewFrameRef.current !== undefined) cancelAnimationFrame(fitViewFrameRef.current);
  }, []);

  useEffect(() => {
    if (active) return;
    if (fitViewFrameRef.current !== undefined) {
      cancelAnimationFrame(fitViewFrameRef.current);
      fitViewFrameRef.current = undefined;
    }
  }, [active]);

  const handleViewPortChange = useCallback((nextViewPort: ViewPort) => {
    setViewPort(nextViewPort);
  }, [setViewPort]);

  const applyLoadResult = useCallback((result: DxfLoadResult) => {
    const data = result.data;
    // 标记该 initFile 已完成加载：切换标签时不再重复解析（不刷新重载）。
    loadedInitFileRef.current = pendingInitFileRef.current;
    // 图纸切换后旧渲染缓存（测量/文字布局）全部作废，统一清空防止串图。
    clearAllRenderCaches();
    loadedDataRef.current = data;
    setParseErrorMessage(null);
    setRenderErrorMessage(null);
    const parsedLayouts = data.layouts || [];
    const switchableLayouts = parsedLayouts.filter(isSwitchableLayout);
    const initialLayout = switchableLayouts.find((layout: DxfLayout) => layout.name === data.activeLayoutName)
      || switchableLayouts.find((layout: DxfLayout) => layout.isModel)
      || switchableLayouts[0];
    const initialEntities = initialLayout?.entities || data.entities;

    resetViewHistory();
    resetVisibility();
    setShowTextSearch(false);
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
    onLoadRef.current?.({ ...data, sourceFormat: result.sourceFormat });

    scheduleFitView(initialEntities, data.blocks, data.styles, initialLayout?.extents || data.extents);
  }, [resetViewHistory, resetVisibility, scheduleFitView]);

  const handleLoadFromUrl = useCallback(async (url: string) => {
    try {
      const result = await loadFromUrl(url, fileName);
      applyLoadResult(result);
    } catch (error: unknown) {
      if (isAbortError(error)) return;
      reportOpenFailure(error instanceof Error ? error.message : String(error));
    }
  }, [applyLoadResult, fileName, loadFromUrl, reportOpenFailure]);

  const handleLoadFromFile = useCallback(async (file: File) => {
    try {
      const result = await loadFromFile(file);
      applyLoadResult(result);
    } catch (error: unknown) {
      if (isAbortError(error)) return;
      reportOpenFailure(error instanceof Error ? error.message : String(error));
    }
  }, [applyLoadResult, loadFromFile, reportOpenFailure]);

  /**
   * 加载策略：首次显示（active）时加载一次；切换标签 / 右键标签只切显隐，不再解析。
   *
   * 只有「成功加载完成」才会写入 loadedInitFileRef（在 applyLoadResult 里提升），
   * 因此 React StrictMode 开发态「挂载→卸载→再挂载」导致首次加载被取消后，
   * 重挂载会自然地重新发起一次加载，不会卡在空状态。
   */
  useEffect(() => {
    if (!initFile || !active) return;
    if (loadedInitFileRef.current === initFile) return;
    pendingInitFileRef.current = initFile;
    if (typeof initFile === 'string') void handleLoadFromUrl(initFile);
    else void handleLoadFromFile(initFile);
  }, [active, handleLoadFromFile, handleLoadFromUrl, initFile]);

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

  const handleLayerPanelSelectIds = useCallback((ids: Set<string>) => {
      handleSelectAndLocateIds(ids);
  }, [handleSelectAndLocateIds]);

  const handleFitView = useCallback(() => {
      fitView(displayEntities, blocks, styles);
  }, [displayEntities, blocks, fitView, styles]);

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

      scheduleFitView(layout.entities, blocks, styles, layout.extents);
  }, [activeLayoutName, blocks, layouts, resetViewHistory, scheduleFitView, styles]);

  // ---------------------------------------------------------------------------
  // 导出：PNG / SVG / 栅格 PDF / 矢量 PDF / 写出 DXF（还原验证）
  // ---------------------------------------------------------------------------
  const handleExport = useCallback(async (kind: ExportKind) => {
    const data = loadedDataRef.current;
    if (!data || entities.length === 0) {
      showToast(t(lang, 'exportNoData'));
      return;
    }

    const baseName = (fileName || 'drawing').replace(/\.dxf$/i, '') || 'drawing';
    const download = (blob: Blob, name: string) => {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    };

    // 导出与当前视图一致的图层状态（隐藏图层同样隐藏）
    const currentHiddenLayers = [...hiddenLayersRef.current];
    const viewOptions = {
      layout: activeLayoutName,
      hiddenLayers: currentHiddenLayers,
      theme: 'white' as CanvasTheme,
      drawingColorMode,
    };

    try {
      if (kind === 'pngView' || kind === 'svgView') {
        // 所见即所得：按查看器当前视口与画布尺寸导出（放大查看局部时最清晰）
        const rect = viewerRef.current?.getBoundingClientRect();
        const w = Math.max(320, Math.round(rect?.width ?? 1280));
        const h = Math.max(240, Math.round(rect?.height ?? 800));
        const viewOpts = { ...viewOptions, width: w, height: h, padding: 0, viewPort };
        if (kind === 'pngView') {
          const blob = await exportPng(data, { ...viewOpts, background: '#ffffff', devicePixelRatio: 2 });
          download(blob, `${baseName}-view.png`);
        } else {
          const svg = exportSvg(data, { ...viewOpts, background: '#ffffff' });
          download(new Blob([svg], { type: 'image/svg+xml' }), `${baseName}-view.svg`);
        }
      } else if (kind === 'png') {
        const blob = await exportPng(data, { ...viewOptions, width: 2560, height: 1600, background: '#ffffff', padding: 32 });
        download(blob, `${baseName}.png`);
      } else if (kind === 'svg') {
        const svg = exportSvg(data, { ...viewOptions, width: 2560, height: 1600, background: '#ffffff', padding: 32 });
        download(new Blob([svg], { type: 'image/svg+xml' }), `${baseName}.svg`);
      } else if (kind === 'pdfVector') {
        const blob = await exportPdfVector(data, {
          ...viewOptions,
          paperSize: 'A4', orientation: 'landscape', marginMm: 8,
          title: baseName,
          textRasterScale: 3,
        });
        download(blob, `${baseName}-vector.pdf`);
      } else {
        // 写出 DXF：重建式写出（还原验证：重新打开该文件应与原图渲染一致）
        const { content, skipped } = writeDxf(data);
        download(new Blob([content], { type: 'application/dxf' }), `${baseName}.out.dxf`);
        showToast(
          skipped.length > 0
            ? t(lang, 'exportSkipped', { count: skipped.length })
            : `${t(lang, 'exportSuccess')} DXF`,
          false,
        );
        return;
      }
      showToast(`${t(lang, 'exportSuccess')} ${kind.toUpperCase()}`, false);
    } catch (error) {
      showToast(`${t(lang, 'exportFailed')}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [activeLayoutName, drawingColorMode, entities.length, fileName, hiddenLayersRef, lang, showToast, viewPort]);

  useEffect(() => {
    if (!active) return;
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
  }, [active, handleFitView]);



  const handleImport = async (files: File[]) => {
    if (files.length === 0) return;

    if (onOpenFiles) {
      onOpenFiles(files);
      return;
    }

    await handleLoadFromFile(files[0]);
  };

  // ---- 拖拽打开 DXF ----
  const [isDragOver, setIsDragOver] = useState(false);
  const handleDragOver = useCallback((event: React.DragEvent) => {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return;
    event.preventDefault();
    setIsDragOver(true);
  }, []);
  const handleDragLeave = useCallback((event: React.DragEvent) => {
    if (event.currentTarget.contains(event.relatedTarget as Node)) return;
    setIsDragOver(false);
  }, []);
  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDragOver(false);
    const files = Array.from(event.dataTransfer.files).filter(file => /\.dxf$/i.test(file.name));
    if (files.length === 0) return;
    void handleImport(files);
  }, [handleImport]);

  const handleMobileFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    event.target.value = '';
    if (files.length > 0) handleImport(files);
  };

  const handleMouseMoveWorld = useCallback((x: number, y: number) => {
    pendingMouseCoordsRef.current = { x, y };
    if (mouseCoordsFrameRef.current !== undefined) return;
    mouseCoordsFrameRef.current = requestAnimationFrame(() => {
      mouseCoordsFrameRef.current = undefined;
      const pending = pendingMouseCoordsRef.current;
      pendingMouseCoordsRef.current = null;
      if (pending) setMouseCoords(pending);
    });
  }, []);

  useEffect(() => () => {
    if (mouseCoordsFrameRef.current !== undefined) cancelAnimationFrame(mouseCoordsFrameRef.current);
  }, []);

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

  const selectedEntities = useMemo(
    () => entities.filter(entity => selectedEntityIds.has(entity.id)),
    [entities, selectedEntityIds],
  );
  const viewerNoticeMessage = useMemo(() => {
    if (parseErrorMessage || isLoading || isNoticeDismissed) return null;
    if (renderErrorMessage) {
      return t(lang, 'renderFailed', { message: renderErrorMessage });
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
    <div className="side-panel-shell">
      <div className="side-panel-frame" style={{ width: layerPanelWidth }}>
        {layerPanelContent}
      </div>
      <div
        className="panel-resize-handle panel-resize-handle-right"
        onMouseDown={startResizeLayerPanel}
        title={t(lang, 'dragResize')}
        aria-label={t(lang, 'dragResize')}
      />
    </div>
  ) : null;

  const propertiesPanelWrapped = !isMobile && showProperties ? (
    <Suspense fallback={null}>
      <div className="side-panel-shell">
        <div
          className="panel-resize-handle panel-resize-handle-left"
          onMouseDown={startResizePropertiesPanel}
          title={t(lang, 'dragResize')}
          aria-label={t(lang, 'dragResize')}
        />
        <div className="side-panel-frame" style={{ width: propertiesWidth }}>
          {propertiesContent}
        </div>
      </div>
    </Suspense>
  ) : null;

  return (
    <div ref={containerRef} className={`app-container ${effectiveUiTheme === 'dark' ? 'theme-dark' : ''} ${isMobile ? 'is-mobile' : ''} ${isDragOver ? 'drag-over' : ''}`} style={{ '--canvas-bg': canvasBgColor } as React.CSSProperties}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        ref={mobileFileInputRef}
        type="file"
        accept=".dxf"
        onChange={handleMobileFileChange}
        className="hidden-file-input"
      />
      {toastMessage && <Toast toast={toastMessage} lang={lang} onClose={() => setToastMessage(null)} />}
      {isLoading && <LoadingOverlay lang={lang} fileName={loadingFileName} progress={loadingProgress} />}

      {/* 顶部：桌面端为「图标+文字」工具条（无标题、无经典菜单）；移动端为纯图标顶栏。 */}
      {isMobile ? (
        <ViewerHeader
          lang={lang}
          fileName={fileName}
          fileTag="DXF"
          onExport={handleExport}
          canExport={entities.length > 0}
          onShowAbout={() => setShowAbout(true)}
          onClose={onClose}
        />
      ) : (
        <div className="ui-toolbar-row">
          <ViewerToolbar
            onImport={handleImport}
            onFitView={handleFitView}
            onPreviousView={handlePreviousView}
            onNextView={handleNextView}
            onToggleSearch={() => setShowTextSearch(value => !value)}
            isSearchActive={showTextSearch}
            canGoPreviousView={canGoPreviousView}
            canGoNextView={canGoNextView}
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
            showLabels
            onShowAbout={() => setShowAbout(true)}
          />
        </div>
      )}

      <div className="main-content">
        <Suspense fallback={null}>
          {layerPanelWrapped}
        </Suspense>

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
            <Suspense fallback={null}>
              <DxfTextSearchPanel
                entities={entities}
                blocks={blocks}
                lang={lang}
                onLocate={handleLocateTextMatch}
                onClose={() => setShowTextSearch(false)}
              />
            </Suspense>
          )}
          <ViewerCanvas
            active={active}
            entities={entities}
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
            onMouseMoveWorld={handleMouseMoveWorld}
            onRenderError={setRenderErrorMessage}
            hiddenLayers={hiddenLayers}
            hiddenEntityIds={hiddenEntityIds}
            isolatedEntityIds={isolatedEntityIds}
            modelEntities={modelLayoutEntities}
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
              canGoPreviousView={canGoPreviousView}
              canGoNextView={canGoNextView}
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
          fileName={fileName}
        />
      )}

      <Suspense fallback={null}>
        {showAbout && <AboutDialog lang={lang} onClose={() => setShowAbout(false)} />}
      </Suspense>
    </div>
  );
}

export default DxfViewer;






