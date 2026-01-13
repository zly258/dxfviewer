import React, { useState, useCallback, useEffect } from 'react';
import DxfViewer from './components/DxfViewer';
import Sidebar from './components/Sidebar';
import PropertiesPanel from './components/PropertiesPanel';
import ToolBar from './components/ToolBar';
import { parseDxf, calculateExtents } from './services/dxfService';
import { AnyEntity, ViewPort, DxfLayer, DxfBlock, EntityType, DxfStyle, DxfLineType, Point2D } from './types';
import { DEFAULT_VIEWPORT } from './constants';

function App() {
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

  const fitView = (ents: AnyEntity[], blks: Record<string, DxfBlock>) => {
     if (ents.length === 0) return;
     const visibleEnts = ents.filter(e => e.visible !== false && e.type !== EntityType.ATTDEF);
     if (visibleEnts.length === 0) return;

     const extents = calculateExtents(visibleEnts, blks);
     
     const sidebarWidth = showSidebar ? 256 : 0; // 64 (w-64) = 256px
     const propsWidth = showProperties ? 320 : 0; // 80 (w-80) = 320px
     const containerW = window.innerWidth - sidebarWidth - propsWidth;
     const containerH = window.innerHeight - 40 - 24; // Toolbar (40) + Status (24)
     
     if (extents.width <= 0 && extents.height <= 0) {
        setViewPort({ x: containerW/2 - extents.center.x, y: containerH/2 + extents.center.y, zoom: 1 });
        return;
     }

     const w = extents.width || 1;
     const h = extents.height || 1;

     const zoomX = containerW / w;
     const zoomY = containerH / h;
     const zoom = Math.min(zoomX, zoomY, 500) * 0.9;
     
     const screenCenterX = containerW / 2;
     const screenCenterY = containerH / 2;
     
     const x = screenCenterX - extents.center.x * zoom;
     const y = screenCenterY + extents.center.y * zoom;

     setViewPort({ x, y, zoom });
  };

  const handleSidebarSelectIds = (ids: Set<string>) => {
      setSelectedEntityIds(ids);
      if (ids.size === 1) {
          const id = Array.from(ids)[0];
          const ent = entities.find(e => e.id === id);
          if (ent) {
              const extents = calculateExtents([ent], blocks);
              
              const sidebarWidth = showSidebar ? 256 : 0;
              const propsWidth = showProperties ? 320 : 0;
              const containerW = window.innerWidth - sidebarWidth - propsWidth;
              const containerH = window.innerHeight - 64;

              let zoom = viewPort.zoom;
              const w = extents.width;
              const h = extents.height;
              
              if (w > 0 || h > 0) {
                  const targetW = Math.max(w, 1);
                  const targetH = Math.max(h, 1);
                  const zoomX = containerW / targetW;
                  const zoomY = containerH / targetH;
                  zoom = Math.min(zoomX, zoomY, 200) * 0.6; 
              }

              const screenCenterX = containerW / 2;
              const screenCenterY = containerH / 2;
              const x = screenCenterX - extents.center.x * zoom;
              const y = screenCenterY + extents.center.y * zoom;
              setViewPort({ x, y, zoom });
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

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
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
        setTimeout(async () => {
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
                requestAnimationFrame(() => fitView(data.entities, data.blocks));
            } catch (err) {
                alert("DXF Parse Error: " + (err as any).message);
                console.error(err);
            } finally {
                setIsLoading(false);
            }
        }, 50);
      } catch (err) {
        setIsLoading(false);
        alert("File Read Error");
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
      />
      
      <div className="main-content">
        {showSidebar && (
            <Sidebar 
            layers={layers} 
            entities={entities} 
            selectedEntityIds={selectedEntityIds}
            onSelectIds={handleSidebarSelectIds}
            />
        )}
        
        <main className="viewer-container bg-[#212121] shadow-inner flex flex-col border-l border-r border-gray-300">
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
          />
        </main>

        {showProperties && (
            <PropertiesPanel 
                entities={selectedEntities} 
                layers={Object.values(layers)}
                styles={styles}
            />
        )}
      </div>
    </div>
  );
}

export default App;