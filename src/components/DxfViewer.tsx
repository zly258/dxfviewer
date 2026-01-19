import React, { useRef, useState, WheelEvent, MouseEvent, useEffect, useLayoutEffect, useCallback } from 'react';
import { AnyEntity, ViewPort, DxfLayer, DxfBlock, DxfStyle, DxfLineType, EntityType, Point2D } from '../types';
import { renderEntitiesToCanvas, hitTest, hitTestBox } from '../services/canvasRenderService';
import { Language, UI_TRANSLATIONS } from '../constants/i18n';

interface DxfViewerProps {
  entities: AnyEntity[];
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
  theme: 'black' | 'white' | 'gray';
  lang: Language;
  onMouseMoveWorld?: (x: number, y: number) => void;
}

const DxfViewer: React.FC<DxfViewerProps> = ({ 
    entities, 
    layers, 
    blocks = {}, 
    styles = {}, 
    lineTypes = {}, 
    viewPort, 
    onViewPortChange, 
    selectedEntityIds, 
    onSelectIds, 
    worldOffset, 
    ltScale = 1.0, 
    theme, 
    lang,
    onMouseMoveWorld
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewPortRef = useRef(viewPort);
  viewPortRef.current = viewPort;
  
  const t = UI_TRANSLATIONS[lang];
  
  const [isPanning, setIsPanning] = useState(false);
  const [isBoxSelecting, setIsBoxSelecting] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 }); // Screen coords
  const [currentMousePos, setCurrentMousePos] = useState({ x: 0, y: 0 }); // Screen coords

  // Calculate World Coordinates from Screen Coordinates (Centered)
  const screenToWorld = (sx: number, sy: number) => {
     const canvas = canvasRef.current;
     if (!canvas) return { x: 0, y: 0 };
     const rect = containerRef.current?.getBoundingClientRect() || { width: canvas.width, height: canvas.height };
     
     const safeZoom = Math.max(Math.abs(viewPort.zoom), Number.MIN_VALUE);
     
     // worldX = (screenX - width / 2) / zoom + targetX
     const wx = (sx - rect.width / 2) / safeZoom + viewPort.targetX;
     // worldY = targetY - (screenY - height / 2) / zoom
     const wy = viewPort.targetY - (sy - rect.height / 2) / safeZoom;
     
     return {
         x: safeClamp(wx, -Number.MAX_VALUE, Number.MAX_VALUE),
         y: safeClamp(wy, -Number.MAX_VALUE, Number.MAX_VALUE)
     };
  };

  const [mouseWorldPos, setMouseWorldPos] = useState({ x: 0, y: 0 });

  // Display coordinates (Original)
  const displayX = mouseWorldPos.x + (worldOffset?.x || 0);
  const displayY = mouseWorldPos.y + (worldOffset?.y || 0);

  // Memoize visible count for performance
  const visibleCount = React.useMemo(() => {
    return entities.filter(e => e.visible !== false).length;
  }, [entities]);

  // Clamp values to prevent Infinity/NaN issues
  const safeClamp = (value: number, min: number, max: number): number => {
    if (!isFinite(value)) return 0;
    return Math.max(Math.min(value, max), min);
  };

  // Canvas Render Loop with requestAnimationFrame for smoothness
  const renderRef = useRef<number>();
  
  useLayoutEffect(() => {
     const render = () => {
        const canvas = canvasRef.current;
        if (!canvas || !containerRef.current) return;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Handle High DPI
        const rect = containerRef.current.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        
        // Resize if needed
        if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            canvas.style.width = `${rect.width}px`;
            canvas.style.height = `${rect.height}px`;
        }

        // Reset scale for DPI
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);

        renderEntitiesToCanvas(ctx, entities, layers, blocks, styles, lineTypes, ltScale, viewPort, selectedEntityIds, rect.width, rect.height, theme);
     };

     if (renderRef.current) cancelAnimationFrame(renderRef.current);
     renderRef.current = requestAnimationFrame(render);

     return () => {
        if (renderRef.current) cancelAnimationFrame(renderRef.current);
     };
  }, [entities, layers, blocks, styles, lineTypes, ltScale, viewPort, selectedEntityIds, worldOffset, theme]);

  // Handle Wheel Event with passive: false to allow preventDefault
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const scaleFactor = 1.2;
      const currentVP = viewPortRef.current;
      const newZoom = e.deltaY < 0 ? currentVP.zoom * scaleFactor : currentVP.zoom / scaleFactor;

      // Widen zoom limits significantly to support extreme coordinates
      const MIN_ZOOM = 1e-50;
      const MAX_ZOOM = 1e20;
      if (newZoom < MIN_ZOOM || newZoom > MAX_ZOOM) return;

      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const safeZoom = Math.max(Math.min(newZoom, MAX_ZOOM), MIN_ZOOM);

      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      const newTargetX = currentVP.targetX + (mouseX - centerX) * (1/currentVP.zoom - 1/safeZoom);
      const newTargetY = currentVP.targetY - (mouseY - centerY) * (1/currentVP.zoom - 1/safeZoom);

      onViewPortChange({
        targetX: newTargetX,
        targetY: newTargetY,
        zoom: safeZoom
      });
    };

    container.addEventListener('wheel', onWheel as any, { passive: false });
    return () => container.removeEventListener('wheel', onWheel as any);
  }, [onViewPortChange]);

  const handleMouseDown = (e: MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (e.button === 1 || (e.button === 0 && e.altKey)) {
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
    setMouseWorldPos(worldPos);
    onMouseMoveWorld?.(worldPos.x + (worldOffset?.x || 0), worldPos.y + (worldOffset?.y || 0));

    if (isPanning) {
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      
      // newTargetX = oldTargetX - dx / zoom
      const newTargetX = viewPort.targetX - dx / viewPort.zoom;
      const newTargetY = viewPort.targetY + dy / viewPort.zoom;

      onViewPortChange({
        targetX: safeClamp(newTargetX, -Number.MAX_VALUE, Number.MAX_VALUE),
        targetY: safeClamp(newTargetY, -Number.MAX_VALUE, Number.MAX_VALUE),
        zoom: viewPort.zoom
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

      if (dist < 5) {
         // Increase hit test threshold to make selection easier, especially for text
         // Protect against extreme zoom values
         const safeZoom = Math.max(Math.abs(viewPort.zoom), Number.MIN_VALUE);
         const threshold = Math.min(Math.max(12 / safeZoom, 1e-12), 1e12);
         const hitId = hitTest(wPos.x, wPos.y, threshold, entities, blocks, layers, styles);
         
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
         
         const boxIds = hitTestBox(
             { x1: startW.x, y1: startW.y, x2: endW.x, y2: endW.y },
             entities,
             layers,
             blocks
         );
         
         const newSelection = new Set<string>(e.ctrlKey || e.shiftKey ? selectedEntityIds : []);
         boxIds.forEach(id => newSelection.add(id));
         onSelectIds(newSelection);
      }
    }
  };

  const safeTargetX = isNaN(viewPort.targetX) ? 0 : viewPort.targetX;
    const safeTargetY = isNaN(viewPort.targetY) ? 0 : viewPort.targetY;
    const safeZoom = isNaN(viewPort.zoom) || viewPort.zoom === 0 ? 1 : viewPort.zoom;

    const getCanvasBg = () => {
        if (theme === 'white') return '#ffffff';
        if (theme === 'gray') return '#808080';
        return '#212121';
    };

    return (
    <div className="viewer-wrapper">
        <div 
        ref={containerRef}
        className="canvas-container"
        style={{ '--canvas-bg': getCanvasBg() } as React.CSSProperties}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onContextMenu={(e) => e.preventDefault()}
        >
        <canvas 
            ref={canvasRef}
            className="main-canvas"
        />

        {isBoxSelecting && (
            <div 
            className="selection-box"
            style={{
                left: Math.min(dragStart.x, currentMousePos.x),
                top: Math.min(dragStart.y, currentMousePos.y),
                width: Math.abs(currentMousePos.x - dragStart.x),
                height: Math.abs(currentMousePos.y - dragStart.y)
            }}
            />
        )}
        </div>
    </div>
  );
};

export default DxfViewer;