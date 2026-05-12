import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import '../../styles/styles.css';
import DxfViewer from './components/DxfViewer';
import Sidebar from './components/Sidebar';
import PropertiesPanel from './components/PropertiesPanel';
import ToolBar from './components/ToolBar';
import { parseDxf, calculateExtents } from './services/dxfService';
import { AnyEntity, ViewPort, DxfLayer, DxfBlock, EntityType, DxfStyle, DxfLineType, Point2D } from '../../types';
import { DEFAULT_LAYER, DEFAULT_VIEWPORT, LAYOUT_CONFIG, VIEWER_DEFAULTS, ZOOM_CONFIG } from '../../shared/config/viewerConfig';
import { Language } from '../../constants/i18n';
import { decodeDxfBuffer } from '../../shared/utils/textDecoder';
import { CanvasTheme, UiTheme } from '../../shared/types/ui';

/**
 * DXF 查看器主容器组件
 * 负责解析文件、管理全局状态、协调侧边栏与主查看器的交互
 */
interface DxfViewerMainProps {
  initFile?: string | File;
  fileName?: string;
  showOpenMenu?: boolean;
  tabStrip?: React.ReactNode;
  onError?: (err: Error) => void; // 错误回调
  onLoad?: (data: any) => void; // 加载完成回调
  onOpenFiles?: (files: File[]) => void; // 由外层容器接管文件打开时使用
  defaultLanguage?: Language; // 默认语言
  lang?: Language; // 受控语言属性
  onLanguageChange?: (lang: Language) => void;
}

const DxfViewerMain: React.FC<DxfViewerMainProps> = ({ 
  initFile,
  fileName, 
  showOpenMenu = true,
  tabStrip,
  onError, 
  onLoad,
  onOpenFiles,
  defaultLanguage = VIEWER_DEFAULTS.language,
  lang: controlledLang,
  onLanguageChange
}) => {
  const [entities, setEntities] = useState<AnyEntity[]>([]);
  const [layers, setLayers] = useState<Record<string, DxfLayer>>({ [DEFAULT_LAYER.name]: DEFAULT_LAYER });
  const [blocks, setBlocks] = useState<Record<string, DxfBlock>>({});
  const [styles, setStyles] = useState<Record<string, DxfStyle>>({});
  const [lineTypes, setLineTypes] = useState<Record<string, DxfLineType>>({});
  const [ltScale, setLtScale] = useState(VIEWER_DEFAULTS.defaultLineTypeScale);
  const [worldOffset, setWorldOffset] = useState<Point2D | undefined>();
  const [showDrawingExtents, setShowDrawingExtents] = useState(false);
  
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingFileName, setLoadingFileName] = useState('');

  const [selectedEntityIds, setSelectedEntityIds] = useState<Set<string>>(new Set());
  
  const [showSidebar, setShowSidebar] = useState(true);
  const [showProperties, setShowProperties] = useState(true);

  const [viewPort, setViewPort] = useState<ViewPort>(DEFAULT_VIEWPORT);
  const [uiTheme, setUiTheme] = useState<UiTheme>(VIEWER_DEFAULTS.uiTheme);
  const [canvasTheme, setCanvasTheme] = useState<CanvasTheme>(VIEWER_DEFAULTS.canvasTheme);
  const [internalLang, setInternalLang] = useState<Language>(defaultLanguage);
  const [mouseCoords, setMouseCoords] = useState<{x: number, y: number}>({x: 0, y: 0});
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  
  const [parseErrorMessage, setParseErrorMessage] = useState<string | null>(null);
  const [renderErrorMessage, setRenderErrorMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<{msg: string, isError: boolean} | null>(null);

  const showToast = (msg: string, isError: boolean = true) => {
    setToastMessage({msg, isError});
    setTimeout(() => setToastMessage(null), VIEWER_DEFAULTS.toastDurationMs);
  };

  const lang = controlledLang || internalLang;
  const handleSetLang = useCallback((newLang: Language) => {
    setInternalLang(newLang);
    onLanguageChange?.(newLang);
  }, [onLanguageChange]);

  const fitView = useCallback((ents: AnyEntity[], blks: Record<string, DxfBlock>, currentStyles: Record<string, DxfStyle> = styles) => {
    if (ents.length === 0) return;
    const visibleEnts = ents.filter(e => e.visible !== false && e.type !== EntityType.ATTDEF);
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
      const sidebarWidth = showSidebar ? LAYOUT_CONFIG.fallbackSidebarWidth : 0;
      const propsWidth = showProperties ? LAYOUT_CONFIG.fallbackPropertiesWidth : 0;
      containerW = rect.width - sidebarWidth - propsWidth;
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
  }, [showSidebar, showProperties, styles]);

  const drawingExtents = useMemo(() => {
    if (entities.length === 0) return null;
    const visibleEnts = entities.filter(e => e.visible !== false && e.type !== EntityType.ATTDEF && e.type !== EntityType.ATTRIB);
    if (visibleEnts.length === 0) return null;
    return calculateExtents(visibleEnts, blocks, styles);
  }, [entities, blocks, styles]);

  const processBuffer = async (buffer: ArrayBuffer) => {
    let decoded: ReturnType<typeof decodeDxfBuffer>;
    try {
        decoded = decodeDxfBuffer(buffer);
    } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        onError?.(error);
        const message = lang === 'zh' ? `DXF 解码失败：${error.message}` : `DXF decode failed: ${error.message}`;
        setParseErrorMessage(message);
        setRenderErrorMessage(null);
        setEntities([]);
        showToast(message);
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
        setParseErrorMessage(message);
        setRenderErrorMessage(null);
        setEntities([]);
        showToast(message);
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
        setParseErrorMessage(message);
        setRenderErrorMessage(null);
        setEntities([]);
        showToast(message);
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
        setParseErrorMessage(message);
        setRenderErrorMessage(null);
        setEntities([]);
        showToast(message);
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
    const observer = new ResizeObserver((entries) => {
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
      if (ids.size === 1) {
          const id = Array.from(ids)[0];
          const ent = entities.find(e => e.id === id);
          if (ent) {
              const extents = calculateExtents([ent], blocks, styles);

              const sidebarWidth = showSidebar ? LAYOUT_CONFIG.fallbackSidebarWidth : 0;
              const propsWidth = showProperties ? LAYOUT_CONFIG.fallbackPropertiesWidth : 0;
              const containerW = window.innerWidth - sidebarWidth - propsWidth;
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

  const handleFitView = () => {
      fitView(entities, blocks);
  };

  const handleClear = () => {
      setParseErrorMessage(null);
      setRenderErrorMessage(null);
      setEntities([]);
      setLayers({ [DEFAULT_LAYER.name]: DEFAULT_LAYER });
      setBlocks({});
      setStyles({});
      setLineTypes({});
      setSelectedEntityIds(new Set());
      setViewPort(DEFAULT_VIEWPORT);
  };



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
    if (parseErrorMessage || isLoading) return null;
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
  }, [parseErrorMessage, isLoading, renderErrorMessage, initFile, entities.length, visibleEntityCount, lang]);

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
        <div className="loading-overlay">
          <div className="loading-box">
            <div className="loading-text">{lang === 'zh' ? '正在加载：' : 'Loading: '}{loadingFileName || (lang === 'zh' ? 'DXF 文件' : 'DXF file')}</div>
            <div className="progress-bar-container">
              <div 
                className="progress-bar"
                style={{ width: `${loadingProgress}%` }}
              ></div>
            </div>
            <div className="progress-text">{loadingProgress}%</div>
          </div>
        </div>
      )}

      <ToolBar 
        onImport={handleImport}
        onClear={handleClear}
        onFitView={handleFitView}
        showDrawingExtents={showDrawingExtents}
        onToggleDrawingExtents={() => setShowDrawingExtents(v => !v)}
        showSidebar={showSidebar}
        onToggleSidebar={() => setShowSidebar(!showSidebar)}
        showProperties={showProperties}
        onToggleProperties={() => setShowProperties(!showProperties)}
        showOpen={showOpenMenu}
        uiTheme={uiTheme}
        onSetUiTheme={setUiTheme}
        canvasTheme={canvasTheme}
        onSetCanvasTheme={setCanvasTheme}
        lang={lang}
        onSetLang={handleSetLang}
      />
      
      {tabStrip}

      <div className="main-content">
        {showSidebar && (
            <Sidebar 
            layers={layers} 
            entities={entities} 
            selectedEntityIds={selectedEntityIds}
            onSelectIds={handleSidebarSelectIds}
            theme={canvasTheme}
            lang={lang}
            />
        )}
        
        <main ref={viewerRef} className="viewer-container">
          {(parseErrorMessage || viewerNoticeMessage) && (
            <div className="viewer-error-panel">
              <div className="viewer-error-title">
                {parseErrorMessage ? (lang === 'zh' ? 'DXF 打开失败' : 'Failed to Open DXF') : (lang === 'zh' ? '没有可显示内容' : 'Nothing Visible')}
              </div>
              <div className="viewer-error-message">{parseErrorMessage || viewerNoticeMessage}</div>
              {!parseErrorMessage && entities.length > 0 && (
                <button type="button" className="viewer-error-button" onClick={handleFitView}>
                  {lang === 'zh' ? '充满视图' : 'Fit View'}
                </button>
              )}
              <button type="button" className="viewer-error-button" onClick={() => { setParseErrorMessage(null); setRenderErrorMessage(null); }}>
                {lang === 'zh' ? '关闭提示' : 'Dismiss'}
              </button>
            </div>
          )}
          <DxfViewer 
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
            overlayExtents={showDrawingExtents && drawingExtents ? { min: drawingExtents.min, max: drawingExtents.max } : null}
            theme={canvasTheme}
            lang={lang}
            onMouseMoveWorld={(x, y) => setMouseCoords({x, y})}
            onRenderError={setRenderErrorMessage}
          />
        </main>

        {showProperties && (
            <PropertiesPanel 
                entities={selectedEntities} 
                layers={Object.values(layers)}
                styles={styles}
                offset={worldOffset}
                theme={canvasTheme}
                lang={lang}
            />
        )}
      </div>

      {/* 状态栏 */}
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
            <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
              <span>{lang === 'zh' ? `已选择 ${selectedEntityIds.size} 个对象` : `Selected ${selectedEntityIds.size} objects`}</span>
              {selectedEntityIds.size === 1 && (
                <span style={{ opacity: 0.8, fontSize: '10px' }}>
                  {lang === 'zh' ? '选择单个对象以查看详细属性' : 'Select a single object to view detailed properties'}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="status-right">
          <div style={{ display: 'flex', gap: '20px' }}>
            <div>
              {lang === 'zh' ? '实体数' : 'Entities'}: <span className="status-value">{entities.length}</span>
            </div>
            <div style={{ opacity: 0.8 }}>
              {lang === 'zh' ? '就绪' : 'Ready'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DxfViewerMain;
