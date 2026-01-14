import React, { useState, useCallback, useEffect } from 'react';
import DxfViewer from './components/DxfViewer';
import Sidebar from './components/Sidebar';
import PropertiesPanel from './components/PropertiesPanel';
import ToolBar from './components/ToolBar';
import { parseDxf, calculateExtents, calculateSmartExtents } from './services/dxfService';
import { AnyEntity, ViewPort, DxfLayer, DxfBlock, EntityType, DxfStyle, DxfLineType, Point2D } from './types';
import { DEFAULT_VIEWPORT } from './constants';
import { Language } from './constants/i18n';

interface DxfViewerMainProps {
  initFiles?: string | File;
  showOpenMenu?: boolean;
  onError?: (err: Error) => void;
  onLoad?: (data: any) => void;
  defaultLanguage?: Language;
  lang?: Language;
  onLanguageChange?: (lang: Language) => void;
}

const DxfViewerMain: React.FC<DxfViewerMainProps> = ({ 
  initFiles, 
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
  
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);

  const [selectedEntityIds, setSelectedEntityIds] = useState<Set<string>>(new Set());
  
  const [showSidebar, setShowSidebar] = useState(true);
  const [showProperties, setShowProperties] = useState(true);

  const [viewPort, setViewPort] = useState<ViewPort>(DEFAULT_VIEWPORT);
  const [theme, setTheme] = useState<'black' | 'white'>('black');
  const [internalLang, setInternalLang] = useState<Language>(defaultLanguage);

  const lang = controlledLang || internalLang;
  const handleSetLang = useCallback((newLang: Language) => {
    setInternalLang(newLang);
    onLanguageChange?.(newLang);
  }, [onLanguageChange]);

  const fitView = useCallback((ents: AnyEntity[], blks: Record<string, DxfBlock>) => {
    if (ents.length === 0) return;
    const visibleEnts = ents.filter(e => e.visible !== false && e.type !== EntityType.ATTDEF);
    if (visibleEnts.length === 0) return;

    // Step 1: Calculate world bounding box (min/max) using smart logic to ignore outliers
    const extents = calculateSmartExtents(visibleEnts, blks);

    // Step 2: Calculate world center
    const centerX = extents.center.x;
    const centerY = extents.center.y;

    // Step 3: Calculate scale
    const sidebarWidth = showSidebar ? 256 : 0;
    const propsWidth = showProperties ? 320 : 0;
    
    // Get actual container dimensions
    const containerW = Math.max(window.innerWidth - sidebarWidth - propsWidth, 100);
    const containerH = Math.max(window.innerHeight - 40, 100); // 40 is header height

    if (extents.width <= 0 && extents.height <= 0) {
        setViewPort({ targetX: centerX, targetY: centerY, zoom: 1 });
        return;
    }

    const worldW = extents.width;
    const worldH = extents.height;

    // marginFactor: 1.0 means exact fit, 0.95 means 5% total margin.
    // User wants it to "correctly fill", so we use a very small margin.
    const marginFactor = 0.98; 
    const scaleX = (containerW / worldW) * marginFactor;
    const scaleY = (containerH / worldH) * marginFactor;
    let zoom = Math.min(scaleX, scaleY);
    
    // Final safety check for zoom
    if (isNaN(zoom) || !isFinite(zoom) || zoom <= 0) {
        zoom = 1.0;
    }

    // Clamp zoom to reasonable values (extended for extreme coordinates)
    zoom = Math.max(Math.min(zoom, 1e20), 1e-50);

    // Step 4: Set Viewport (will be used by renderer's setTransform)
    // Using targetX/targetY as the world center ensures the "subtract first" principle
    // is applied during rendering.
    setViewPort({ 
        targetX: centerX, 
        targetY: centerY, 
        zoom 
    });
  }, [showSidebar, showProperties]);

  const processBuffer = async (buffer: ArrayBuffer) => {
    let content = '';
    // Auto-detect encoding
    try {
        const decoder = new TextDecoder('utf-8', { fatal: true });
        content = decoder.decode(buffer);
    } catch (err) {
        // Fallback to GB18030 for Chinese CAD files
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
        onLoad?.(data);
        
        // Fit view immediately with the new data
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

  // Fit view on resize or layout change
  useEffect(() => {
    const handleResize = () => {
      if (entities.length > 0) {
        fitView(entities, blocks);
      }
    };
    window.addEventListener('resize', handleResize);
    // Also trigger on sidebar/properties toggle
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, [entities, blocks, fitView, showSidebar, showProperties]);

  // Load initial file if provided
  useEffect(() => {
    if (initFiles) {
        if (typeof initFiles === 'string') {
            loadFromUrl(initFiles);
        } else if (initFiles instanceof File) {
            loadFromFile(initFiles);
        }
    }
  }, [initFiles]);

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
              const containerH = window.innerHeight - 40;

              const w = extents.width;
              const h = extents.height;

              if (w > 0 || h > 0) {
                  const marginFactor = 0.9; // Slightly more margin for single entity focus
                  const zoomX = (containerW / w) * marginFactor;
                  const zoomY = (containerH / h) * marginFactor;
                  // Clamp zoom to prevent excessive zoom on tiny entities
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
      
      // Auto-detect encoding
      try {
          const decoder = new TextDecoder('utf-8', { fatal: true });
          content = decoder.decode(buffer);
      } catch (err) {
          // Fallback to GB18030 for Chinese CAD files
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
        
        // Fit view immediately with the new data
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
    <div className="app-container">
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
        showSidebar={showSidebar}
        onToggleSidebar={() => setShowSidebar(!showSidebar)}
        showProperties={showProperties}
        onToggleProperties={() => setShowProperties(!showProperties)}
        showOpen={showOpenMenu}
        theme={theme}
        onToggleTheme={() => setTheme(theme === 'black' ? 'white' : 'black')}
        lang={lang}
        onSetLang={handleSetLang}
      />
      
      <div className="main-content" style={{ height: 'calc(100vh - 40px)' }}>
        {showSidebar && (
            <Sidebar 
            layers={layers} 
            entities={entities} 
            selectedEntityIds={selectedEntityIds}
            onSelectIds={handleSidebarSelectIds}
            theme={theme}
            lang={lang}
            />
        )}
        
        <main className={`viewer-container shadow-inner flex flex-col border-l border-r border-gray-300 ${theme === 'black' ? 'bg-[#212121]' : 'bg-white'}`}>
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
            theme={theme}
            lang={lang}
          />
        </main>

        {showProperties && (
            <PropertiesPanel 
                entities={selectedEntities} 
                layers={Object.values(layers)}
                styles={styles}
                offset={worldOffset}
                theme={theme}
                lang={lang}
            />
        )}
      </div>
    </div>
  );
}

export default DxfViewerMain;