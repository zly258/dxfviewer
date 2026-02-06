import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import './styles/styles.css';
import DxfViewer from './components/DxfViewer';
import Sidebar from './components/Sidebar';
import PropertiesPanel from './components/PropertiesPanel';
import ToolBar from './components/ToolBar';
import { parseDxf, calculateExtents, calculateSmartExtents } from './services/dxfService';
import { AnyEntity, ViewPort, DxfLayer, DxfBlock, EntityType, DxfStyle, DxfLineType, Point2D } from './types';
import { DEFAULT_VIEWPORT } from './constants';
import { Language } from './constants/i18n';

/**
 * DXF 查看器主容器组件
 * 负责解析文件、管理全局状态、协调侧边栏与主查看器的交互
 */
interface DxfViewerMainProps {
  initFile?: string | File; // 初始加载的文件或 URL
  showOpenMenu?: boolean; // 是否在工具栏显示打开文件按钮
  onError?: (err: Error) => void; // 错误回调
  onLoad?: (data: any) => void; // 加载完成回调
  defaultLanguage?: Language; // 默认语言
  lang?: Language; // 受控语言属性
  onLanguageChange?: (lang: Language) => void; // 语言切换回调
}

const DxfViewerMain: React.FC<DxfViewerMainProps> = ({ 
  initFile, 
  showOpenMenu = true, 
  onError, 
  onLoad,
  defaultLanguage = 'zh',
  lang: controlledLang,
  onLanguageChange
}) => {
  const [entities, setEntities] = useState<AnyEntity[]>([]);
  const [layers, setLayers] = useState<Record<string, DxfLayer>>({ '0': { name: '0', color: 7 }});
  const [blocks, setBlocks] = useState<Record<string, DxfBlock>>({});
  const [styles, setStyles] = useState<Record<string, DxfStyle>>({});
  const [lineTypes, setLineTypes] = useState<Record<string, DxfLineType>>({});
  const [ltScale, setLtScale] = useState(1.0);
  const [worldOffset, setWorldOffset] = useState<Point2D | undefined>();
  const [showDrawingExtents, setShowDrawingExtents] = useState(false);
  
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);

  const [selectedEntityIds, setSelectedEntityIds] = useState<Set<string>>(new Set());
  
  const [showSidebar, setShowSidebar] = useState(true);
  const [showProperties, setShowProperties] = useState(true);

  const [viewPort, setViewPort] = useState<ViewPort>(DEFAULT_VIEWPORT);
  const [uiTheme, setUiTheme] = useState<'light' | 'dark'>('light');
  const [canvasTheme, setCanvasTheme] = useState<'black' | 'white' | 'gray'>('black');
  const [internalLang, setInternalLang] = useState<Language>(defaultLanguage);
  const [mouseCoords, setMouseCoords] = useState<{x: number, y: number}>({x: 0, y: 0});
  const [isExporting, setIsExporting] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);

  const lang = controlledLang || internalLang;
  const handleSetLang = useCallback((newLang: Language) => {
    setInternalLang(newLang);
    onLanguageChange?.(newLang);
  }, [onLanguageChange]);

  const fitView = useCallback((ents: AnyEntity[], blks: Record<string, DxfBlock>) => {
    if (ents.length === 0) {
      console.warn('[DXF Viewer] No entities to fit view.');
      return;
    }
    const visibleEnts = ents.filter(e => e.visible !== false && e.type !== EntityType.ATTDEF);
    if (visibleEnts.length === 0) {
      console.warn('[DXF Viewer] All entities are hidden; cannot fit view.');
      return;
    }

    // 第 1 步：计算世界包围盒
    const extents = calculateSmartExtents(visibleEnts, blks);

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
      const sidebarWidth = showSidebar ? 256 : 0;
      const propsWidth = showProperties ? 320 : 0;
      containerW = rect.width - sidebarWidth - propsWidth;
      containerH = rect.height - 30 - 24;
    }

    containerW = Math.max(containerW, 100);
    containerH = Math.max(containerH, 100);

    if (extents.width <= 0 && extents.height <= 0) {
      console.warn('[DXF Viewer] Invalid extents detected; fallback to center/zoom=1.', extents);
      setViewPort(prev => ({ ...prev, targetX: centerX, targetY: centerY, zoom: 1 }));
      return;
    }

    const worldW = extents.width;
    const worldH = extents.height;

    const marginFactor = 0.98; 
    const scaleX = (containerW / worldW) * marginFactor;
    const scaleY = (containerH / worldH) * marginFactor;
    let zoom = Math.min(scaleX, scaleY);
    
    if (isNaN(zoom) || !isFinite(zoom) || zoom <= 0) {
        zoom = 1.0;
    }

    zoom = Math.max(Math.min(zoom, 1e20), 1e-50);

    setViewPort({ 
        targetX: centerX, 
        targetY: centerY, 
        zoom 
    });
  }, [showSidebar, showProperties]);

  const drawingExtents = useMemo(() => {
    if (entities.length === 0) return null;
    const visibleEnts = entities.filter(e => e.visible !== false && e.type !== EntityType.ATTDEF && e.type !== EntityType.ATTRIB);
    if (visibleEnts.length === 0) return null;
    return calculateExtents(visibleEnts, blocks);
  }, [entities, blocks]);

  const processBuffer = async (buffer: ArrayBuffer) => {
    console.info('[DXF Viewer] Processing buffer.', { byteLength: buffer.byteLength });
    let content = '';
    // 自动检测编码
    try {
        const decoder = new TextDecoder('utf-8', { fatal: true });
        content = decoder.decode(buffer);
    } catch (err) {
        // 对于中文 CAD 文件回退到 GB18030
        const decoder = new TextDecoder('gb18030');
        content = decoder.decode(buffer);
    }

    try {
        const data = await parseDxf(content, (progress) => {
            setLoadingProgress(progress);
        });
        console.info('[DXF Viewer] Parsed DXF.', {
          entities: data.entities.length,
          layers: Object.keys(data.layers).length,
          blocks: Object.keys(data.blocks).length,
          hasHeader: Boolean(data.header),
          extents: data.extents
        });
        if (data.entities.length === 0) {
          console.warn('[DXF Viewer] Parsed DXF contains no entities. Check section names or visibility settings.');
        }
        setEntities(data.entities);
        setLayers(data.layers);
        setBlocks(data.blocks);
        setStyles(data.styles);
        setLineTypes(data.lineTypes);
        setLtScale(data.header?.ltScale ?? 1.0);
        setWorldOffset(data.offset);
        onLoad?.(data);
        
        // 立即使用新数据调整视图
        fitView(data.entities, data.blocks);
    } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        onError?.(error);
        alert("DXF Parse Error: " + error.message);
        console.error(err);
    } finally {
        setIsLoading(false);
    }
  };

  const loadFromUrl = async (url: string) => {
    setIsLoading(true);
    setLoadingProgress(0);
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
        const buffer = await response.arrayBuffer();
        await processBuffer(buffer);
    } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        onError?.(error);
        alert(error.message);
        setIsLoading(false);
    }
  };

  const loadFromFile = async (file: File) => {
    setIsLoading(true);
    setLoadingProgress(0);
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const buffer = evt.target?.result as ArrayBuffer;
      await processBuffer(buffer);
    };
    reader.onerror = () => {
        const error = new Error("File Read Error");
        onError?.(error);
        alert(error.message);
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
              const extents = calculateSmartExtents([ent], blocks);

              const sidebarWidth = showSidebar ? 256 : 0;
              const propsWidth = showProperties ? 320 : 0;
              const containerW = window.innerWidth - sidebarWidth - propsWidth;
              const containerH = window.innerHeight - 30 - 24;

              const w = extents.width;
              const h = extents.height;

              if (w > 0 || h > 0) {
                  const marginFactor = 0.9; // 单个实体聚焦时稍微多留一点边距
                  const zoomX = (containerW / w) * marginFactor;
                  const zoomY = (containerH / h) * marginFactor;
                  // 限制缩放以防止在极小实体上过度缩放
                  let zoom = Math.min(zoomX, zoomY, 1000000);

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
      setEntities([]);
      setLayers({ '0': { name: '0', color: 7 }});
      setBlocks({});
      setStyles({});
      setLineTypes({});
      setSelectedEntityIds(new Set());
      setViewPort(DEFAULT_VIEWPORT);
  };



  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setLoadingProgress(0);

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const buffer = evt.target?.result as ArrayBuffer;
      let content = '';
      
      // 自动检测编码
      try {
          const decoder = new TextDecoder('utf-8', { fatal: true });
          content = decoder.decode(buffer);
      } catch (err) {
          // 对于中文 CAD 文件回退到 GB18030
          const decoder = new TextDecoder('gb18030');
          content = decoder.decode(buffer);
      }

      try {
        const data = await parseDxf(content, (progress) => {
            setLoadingProgress(progress);
        });
        setEntities(data.entities);
        setLayers(data.layers);
        setBlocks(data.blocks);
        setStyles(data.styles);
        setLineTypes(data.lineTypes);
        setLtScale(data.header?.ltScale ?? 1.0);
        setWorldOffset(data.offset);
        
        // 立即使用新数据调整视图
        fitView(data.entities, data.blocks);
      } catch (err) {
        alert("DXF Parse Error: " + (err as any).message);
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const selectedEntities = entities.filter(e => selectedEntityIds.has(e.id));

  return (
    <div ref={containerRef} className={`app-container ${uiTheme === 'dark' ? 'theme-dark' : ''}`} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {isLoading && (
        <div className="loading-overlay">
          <div className="loading-box">
            <div className="loading-text">正在解析 DXF...</div>
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
