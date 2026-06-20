import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import CanvasViewer from '@/components/ui/CanvasViewer';
import Sidebar from '@/components/ui/Sidebar';
import PropertiesPanel from '@/components/ui/PropertiesPanel';
import ToolBar from '@/components/ui/ToolBar';
import { parseDxf } from '@/core/parser/parseDxf';
import { calculateExtents } from '@/core/geometry/extents';
import { AnyEntity, ViewPort, DxfLayer, DxfBlock, EntityType, DxfStyle, DxfLineType, Point2D, CanvasTheme, DrawingColorMode, UiTheme } from '@/types';
import { DEFAULT_LAYER, DEFAULT_VIEWPORT, LAYOUT_CONFIG, SHORTCUT_CONFIG, VIEWER_DEFAULTS, ZOOM_CONFIG, canvasThemeFromUiTheme } from '@/config/viewerConfig';
import { Language } from '@/config/i18n';
import { decodeDxfBuffer } from '@/core/parser/utils/textDecoder';

/**
 * DXF 查看器主容器组件
 * 负责解析文件、管理全局状态、协调侧边栏与主查看器的交互
 */
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


interface ViewerUiSettings {
  uiTheme?: UiTheme;
  drawingColorMode?: DrawingColorMode;
  language?: Language;
  showSidebar?: boolean;
  showProperties?: boolean;
}

const VIEWER_UI_SETTINGS_KEY = 'dxfviewer.uiSettings.v1';

const readViewerUiSettings = (): ViewerUiSettings => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(VIEWER_UI_SETTINGS_KEY);
    return raw ? JSON.parse(raw) as ViewerUiSettings : {};
  } catch {
    return {};
  }
};

const writeViewerUiSettings = (settings: ViewerUiSettings) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(VIEWER_UI_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // 浏览器隐私模式或配额限制时忽略保存失败，不影响查看器运行。
  }
};

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
  const [layers, setLayers] = useState<Record<string, DxfLayer>>({ [DEFAULT_LAYER.name]: DEFAULT_LAYER });
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(new Set());
  const [showAbout, setShowAbout] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobilePropertiesOpen, setMobilePropertiesOpen] = useState(false);

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
  const [showSidebar, setShowSidebar] = useState(savedUiSettingsRef.current.showSidebar ?? true);
  const [showProperties, setShowProperties] = useState(savedUiSettingsRef.current.showProperties ?? true);
  
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingFileName, setLoadingFileName] = useState('');

  const [selectedEntityIds, setSelectedEntityIds] = useState<Set<string>>(new Set());
  
  const [viewPort, setViewPort] = useState<ViewPort>(DEFAULT_VIEWPORT);
  const [internalUiTheme, setInternalUiTheme] = useState<UiTheme>(savedUiSettingsRef.current.uiTheme ?? VIEWER_DEFAULTS.uiTheme);
  const [internalDrawingColorMode, setInternalDrawingColorMode] = useState<DrawingColorMode>(savedUiSettingsRef.current.drawingColorMode ?? VIEWER_DEFAULTS.drawingColorMode);
  const [internalLang, setInternalLang] = useState<Language>(savedUiSettingsRef.current.language ?? defaultLanguage);
  const [mouseCoords, setMouseCoords] = useState<{x: number, y: number}>({x: 0, y: 0});
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  
  const [parseErrorMessage, setParseErrorMessage] = useState<string | null>(null);
  const [renderErrorMessage, setRenderErrorMessage] = useState<string | null>(null);
  const [isNoticeDismissed, setIsNoticeDismissed] = useState(false);
  const [toastMessage, setToastMessage] = useState<{msg: string, isError: boolean} | null>(null);

  const showToast = (msg: string, isError: boolean = true) => {
    setToastMessage({msg, isError});
    setTimeout(() => setToastMessage(null), VIEWER_DEFAULTS.toastDurationMs);
  };

  const reportOpenFailure = (message: string) => {
    setParseErrorMessage(null);
    setRenderErrorMessage(null);
    setEntities([]);
    showToast(message);
    onOpenFailed?.(message);
  };

  const lang = controlledLang || internalLang;
  const handleSetLang = useCallback((newLang: Language) => {
    setInternalLang(newLang);
    onLanguageChange?.(newLang);
  }, [onLanguageChange]);

  const uiTheme = controlledUiTheme || internalUiTheme;
  const handleSetUiTheme = useCallback((newTheme: UiTheme) => {
    setInternalUiTheme(newTheme);
    onUiThemeChange?.(newTheme);
  }, [onUiThemeChange]);

  // 画布背景跟随 UI 主题：浅色 UI → 白底，深色 UI → 黑底。
  // 不再单独暴露 canvasTheme，避免 UI 主题与画布背景不一致。
  const canvasTheme: CanvasTheme = canvasThemeFromUiTheme(uiTheme);

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
      showSidebar,
      showProperties,
    });
  }, [uiTheme, drawingColorMode, lang, showSidebar, showProperties]);

  const fitView = useCallback((ents: AnyEntity[], blks: Record<string, DxfBlock>, currentStyles: Record<string, DxfStyle> = styles) => {
    if (ents.length === 0) return;
    const visibleEnts = ents.filter(e => e.visible !== false && e.type !== EntityType.ATTDEF && !hiddenLayers.has(e.layer));
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
      // 如果 viewerRef 尚未准备好，则回退到 app-container 减去估计的栏宽
      const rect = containerRef.current.getBoundingClientRect();
      containerW = rect.width - LAYOUT_CONFIG.fallbackSidebarWidth - LAYOUT_CONFIG.fallbackPropertiesWidth;
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
  }, [styles, hiddenLayers]);

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
        setEntities(data.entities);
        setLayers(data.layers);
        setBlocks(data.blocks);
        setStyles(data.styles);
        setLineTypes(data.lineTypes);
        setLtScale(data.header?.ltScale ?? VIEWER_DEFAULTS.defaultLineTypeScale);
        setWorldOffset(data.offset);
        onLoad?.({ ...data, sourceFormat: decoded.format });
        
        const applyFitView = () => fitView(data.entities, data.blocks, data.styles);
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
      // 使用 requestAnimationFrame 以避免 "ResizeObserver loop limit exceeded" 错误
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

  const handleSidebarSelectIds = (ids: Set<string>) => {
      setSelectedEntityIds(ids);
      setMobileSidebarOpen(false);
      if (ids.size === 1) {
          const id = Array.from(ids)[0];
          const ent = entities.find(e => e.id === id);
          if (ent) {
              const extents = calculateExtents([ent], blocks, styles);

              const containerW = window.innerWidth - LAYOUT_CONFIG.fallbackSidebarWidth - LAYOUT_CONFIG.fallbackPropertiesWidth;
              const containerH = window.innerHeight - LAYOUT_CONFIG.fallbackToolbarHeight - LAYOUT_CONFIG.fallbackStatusBarHeight;

              const w = extents.width;
              const h = extents.height;

              if (w > 0 || h > 0) {
                  const zoomX = (containerW / w) * ZOOM_CONFIG.singleEntityMarginFactor;
                  const zoomY = (containerH / h) * ZOOM_CONFIG.singleEntityMarginFactor;
                  const zoom = Math.min(zoomX, zoomY, ZOOM_CONFIG.maxSingleEntityZoom);

                  setViewPort({
                    targetX: extents.center.x,
                    targetY: extents.center.y,
                    zoom
                  });
              }
          }
      }
  };

  const handleFitView = useCallback(() => {
      fitView(entities, blocks);
  }, [entities, blocks, fitView]);

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

  const selectedEntities = entities.filter(e => selectedEntityIds.has(e.id));
  const visibleEntityCount = useMemo(() => entities.filter(e => e.visible !== false && e.type !== EntityType.ATTDEF && e.type !== EntityType.ATTRIB).length, [entities]);
  const viewerNoticeMessage = useMemo(() => {
    if (parseErrorMessage || isLoading || isNoticeDismissed) return null;
    if (renderErrorMessage) {
      return lang === 'zh' ? `DXF 渲染失败：${renderErrorMessage}` : `DXF render failed: ${renderErrorMessage}`;
    }
    if (initFile && entities.length === 0) {
      return lang === 'zh' ? 'DXF 已打开，但没有解析到模型空间实体。请检查文件是否只包含布局空间、外部参照或暂不支持的代理对象。' : 'DXF opened, but no model-space entities were parsed. Check whether the file only contains layout-space objects, external references, or unsupported proxy objects.';
    }
    if (entities.length > 0 && visibleEntityCount === 0) {
      return lang === 'zh' ? 'DXF 已解析，但当前没有可显示实体。请检查图层显示状态或对象是否全部位于布局空间。' : 'DXF parsed, but there are no visible entities. Check layer visibility or paper-space objects.';
    }
    return null;
  }, [parseErrorMessage, isLoading, isNoticeDismissed, renderErrorMessage, initFile, entities.length, visibleEntityCount, lang]);

  return (
    <div ref={containerRef} className={`app-container ${uiTheme === 'dark' ? 'theme-dark' : ''}`} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {toastMessage && (
        <div className="toast-container">
          <div className={`toast ${toastMessage.isError ? 'error' : 'success'}`}>
            <span className="toast-message">{toastMessage.msg}</span>
            <span className="toast-close" onClick={() => setToastMessage(null)}>×</span>
          </div>
        </div>
      )}


      {isLoading && (
        <div className="loading-overlay" aria-live="polite" aria-busy="true">
          <div className="loading-inline" title={loadingFileName}>
            <div className="loading-title">{lang === 'zh' ? '正在加载 DXF' : 'Loading DXF'}</div>
            <div className="loading-file">{loadingFileName || (lang === 'zh' ? 'DXF 文件' : 'DXF file')}</div>
            <div className="loading-progressbar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={loadingProgress}>
              <div className="loading-progressbar-value" style={{ width: `${Math.max(0, Math.min(100, loadingProgress))}%` }} />
            </div>
            <div className="loading-progress-text">{loadingProgress}%</div>
          </div>
        </div>
      )}

      <div className="menu-tab-row">
        <ToolBar
          onImport={handleImport}
          onFitView={handleFitView}
          showOpen={showOpenMenu}
          uiTheme={uiTheme}
          onSetUiTheme={handleSetUiTheme}
          drawingColorMode={drawingColorMode}
          onSetDrawingColorMode={handleSetDrawingColorMode}
          lang={lang}
          onSetLang={handleSetLang}
          showSidebar={showSidebar}
          onToggleSidebar={() => setShowSidebar(v => !v)}
          showProperties={showProperties}
          onToggleProperties={() => setShowProperties(v => !v)}
          onShowAbout={() => setShowAbout(true)}
        />
        {tabStrip && <div className="menu-tab-strip">{tabStrip}</div>}
      </div>

      <div className="main-content">
        {/* Drawer Backdrop for Mobile */}
        <div 
          className={`drawer-backdrop ${(mobileSidebarOpen || mobilePropertiesOpen) ? 'visible' : ''}`}
          onClick={() => {
            setMobileSidebarOpen(false);
            setMobilePropertiesOpen(false);
          }}
        />

        {showSidebar && (
          <Sidebar
              className={mobileSidebarOpen ? 'open' : ''}
              layers={layers}
              entities={entities}
              selectedEntityIds={selectedEntityIds}
              onSelectIds={handleSidebarSelectIds}
              lang={lang}
              hiddenLayers={hiddenLayers}
              onToggleLayerVisibility={toggleLayerVisibility}
              />
        )}
        
        <main ref={viewerRef} className="viewer-container">
          {viewerNoticeMessage && (
            <div className="viewer-error-panel">
              <div className="viewer-error-title">
                {lang === 'zh' ? '没有可显示内容' : 'Nothing Visible'}
              </div>
              <div className="viewer-error-message">{viewerNoticeMessage}</div>
              {entities.length > 0 && (
                <button type="button" className="viewer-error-button" onClick={handleFitView}>
                  {lang === 'zh' ? '充满视图' : 'Fit View'}
                </button>
              )}
              <button type="button" className="viewer-error-button" onClick={() => { setRenderErrorMessage(null); setIsNoticeDismissed(true); }}>
                {lang === 'zh' ? '关闭提示' : 'Dismiss'}
              </button>
            </div>
          )}
          <CanvasViewer
            entities={entities}
            layers={layers}
            blocks={blocks}
            styles={styles}
            lineTypes={lineTypes}
            ltScale={ltScale}
            viewPort={viewPort}
            onViewPortChange={setViewPort}
            selectedEntityIds={selectedEntityIds}
            onSelectIds={setSelectedEntityIds}
            onFitView={handleFitView}
            worldOffset={worldOffset}
            theme={canvasTheme}
            drawingColorMode={drawingColorMode}
            lang={lang}
            onMouseMoveWorld={(x, y) => setMouseCoords({x, y})}
            onRenderError={setRenderErrorMessage}
            hiddenLayers={hiddenLayers}
          />
        </main>

        {/* Floating toggle buttons (mobile only): circular icons at top-left / top-right of the canvas */}
        {showSidebar && (
          <button
            type="button"
            className={`floating-toggle-btn btn-left ${mobileSidebarOpen ? 'active' : ''}`}
            onClick={() => {
              setMobileSidebarOpen(prev => !prev);
              setMobilePropertiesOpen(false);
            }}
            title={lang === 'zh' ? '切换图层结构' : 'Toggle Layers'}
            aria-label={lang === 'zh' ? '图层' : 'Layers'}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
              <polyline points="2 17 12 22 22 17"></polyline>
              <polyline points="2 12 12 17 22 12"></polyline>
            </svg>
          </button>
        )}

        {showProperties && (
          <button
            type="button"
            className={`floating-toggle-btn btn-right ${mobilePropertiesOpen ? 'active' : ''}`}
            onClick={() => {
              setMobilePropertiesOpen(prev => !prev);
              setMobileSidebarOpen(false);
            }}
            title={lang === 'zh' ? '切换属性面板' : 'Toggle Properties'}
            aria-label={lang === 'zh' ? '属性' : 'Properties'}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
          </button>
        )}

        {showProperties && (
          <PropertiesPanel
                className={mobilePropertiesOpen ? 'open' : ''}
                entities={selectedEntities}
                styles={styles}
                offset={worldOffset}
                lang={lang}
            />
        )}
      </div>

      <div className="status-bar">
        <div className="status-left">
          <div className="status-coords">
            <span>X: <span className="status-value">{mouseCoords.x.toFixed(3)}</span></span>
            <span>Y: <span className="status-value">{mouseCoords.y.toFixed(3)}</span></span>
          </div>
        </div>

        <div className="status-center">
          {selectedEntityIds.size === 0 ? (
            <span>{lang === 'zh' ? '未选择对象' : 'No objects selected'}</span>
          ) : (
            <div className="status-selection">
              <span>{lang === 'zh' ? `已选 ${selectedEntityIds.size}` : `Selected ${selectedEntityIds.size}`}</span>
            </div>
          )}
        </div>

        <div className="status-right">
          <div className="status-summary">
            <span>{lang === 'zh' ? '实体' : 'Entities'}: <span className="status-value">{entities.length}</span></span>
          </div>
        </div>
      </div>
      
      {showAbout && (
        <div className="about-modal-overlay" onClick={() => setShowAbout(false)}>
          <div className="about-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="about-modal-header">
              <span className="about-modal-title">{lang === 'zh' ? '关于 DXF Viewer' : 'About DXF Viewer'}</span>
              <span className="about-modal-close" onClick={() => setShowAbout(false)}>×</span>
            </div>
            <div className="about-modal-body">
              <div className="about-logo">CAD</div>
              <h3>{lang === 'zh' ? 'DXF 浏览器' : 'DXF Viewer'}</h3>
              <p className="about-desc">
                {lang === 'zh' 
                  ? '这是一个用 React 和 HTML5 Canvas 构建的高性能、现代化的 DXF CAD 图纸双向查看与编辑库。支持 20 多种几何体及标注实体的读写渲染。' 
                  : 'A high-performance React and Canvas-based DXF viewer & writer library. Supports parsing, rendering, and exporting over 20+ CAD geometries.'}
              </p>
              <div className="about-info-grid">
                <div className="about-info-label">{lang === 'zh' ? '联系邮箱' : 'Contact Email'}</div>
                <div className="about-info-value">
                  <a href="mailto:zhangly1403@qq.com" className="about-email-link">zhangly1403@qq.com</a>
                </div>
                <div className="about-info-label">{lang === 'zh' ? '开源协议' : 'License'}</div>
                <div className="about-info-value">MIT License</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DxfViewer;
