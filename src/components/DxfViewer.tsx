import React, { useRef, useState, WheelEvent, MouseEvent, useEffect, useLayoutEffect } from 'react';
import { AnyEntity, ViewPort, DxfLayer, DxfBlock, DxfStyle, DxfLineType, EntityType, Point2D } from '../types';
import { GRID_SIZE } from '../constants';
import { renderEntitiesToCanvas, hitTest, hitTestBox } from '../services/canvasRenderService';

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
}

const DxfViewer: React.FC<DxfViewerProps> = ({ entities, layers, blocks = {}, styles = {}, lineTypes = {}, viewPort, onViewPortChange, selectedEntityIds, onSelectIds, worldOffset, ltScale = 1.0 }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const [isPanning, setIsPanning] = useState(false);
  const [isBoxSelecting, setIsBoxSelecting] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 }); // Screen coords
  const [currentMousePos, setCurrentMousePos] = useState({ x: 0, y: 0 }); // Screen coords

  // Calculate World Coordinates from Screen Coordinates (Centered)
  const screenToWorld = (sx: number, sy: number) => {
     const safeZoom = Math.max(Math.abs(viewPort.zoom), Number.MIN_VALUE);
     // Return centered coordinates (0,0 is at viewPort.x, viewPort.y)
     const wx = (sx - viewPort.x) / safeZoom;
     const wy = -(sy - viewPort.y) / safeZoom;
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

        renderEntitiesToCanvas(ctx, entities, layers, blocks, styles, lineTypes, ltScale, viewPort, selectedEntityIds, rect.width, rect.height);
     };

     if (renderRef.current) cancelAnimationFrame(renderRef.current);
     renderRef.current = requestAnimationFrame(render);

     return () => {
        if (renderRef.current) cancelAnimationFrame(renderRef.current);
     };
  }, [entities, layers, blocks, styles, lineTypes, ltScale, viewPort, selectedEntityIds, worldOffset]);

  // Handle Wheel Event with passive: false to allow preventDefault
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const scaleFactor = 1.2;
      const newZoom = e.deltaY < 0 ? viewPort.zoom * scaleFactor : viewPort.zoom / scaleFactor;

      // Widen zoom limits significantly to support extreme coordinates
      // Use Number.MAX_SAFE_INTEGER as upper bound for practical purposes
      const MIN_ZOOM = Number.MIN_VALUE;
      const MAX_ZOOM = Number.MAX_VALUE;
      if (newZoom < MIN_ZOOM || newZoom > MAX_ZOOM) return;

      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Clamp zoom to avoid Infinity values
      const safeZoom = Math.max(Math.min(newZoom, MAX_ZOOM), MIN_ZOOM);

      const newX = mouseX - (mouseX - viewPort.x) * (safeZoom / viewPort.zoom);
      const newY = mouseY - (mouseY - viewPort.y) * (safeZoom / viewPort.zoom);
      onViewPortChange({ x: newX, y: newY, zoom: safeZoom });
    };

    container.addEventListener('wheel', onWheel as any, { passive: false });
    return () => container.removeEventListener('wheel', onWheel as any);
  }, [viewPort, onViewPortChange]);

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

    if (isPanning) {
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      const newX = viewPort.x + dx;
      const newY = viewPort.y + dy;
      // Clamp to prevent infinite/NaN values
      onViewPortChange({
        x: safeClamp(newX, -Number.MAX_VALUE, Number.MAX_VALUE),
        y: safeClamp(newY, -Number.MAX_VALUE, Number.MAX_VALUE),
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

  return (
    <div className="viewer-wrapper">
        <div 
        ref={containerRef}
        className="canvas-container"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onContextMenu={(e) => e.preventDefault()}
        >
        <svg className="grid-svg">
            <defs>
            <pattern id="grid" width={Math.max(Math.min(GRID_SIZE * viewPort.zoom, 1e6), 5)} height={Math.max(Math.min(GRID_SIZE * viewPort.zoom, 1e6), 5)} patternUnits="userSpaceOnUse">
                <path d={`M ${Math.max(Math.min(GRID_SIZE * viewPort.zoom, 1e6), 5)} 0 L 0 0 0 ${Math.max(Math.min(GRID_SIZE * viewPort.zoom, 1e6), 5)}`} fill="none" stroke="#444" strokeWidth="1"/>
            </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
        
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

        {/* Status Bar */}
        <div className="status-bar">
            <div className="status-coords">
                <span>X: <span className="status-value">{displayX.toFixed(3)}</span></span>
                <span>Y: <span className="status-value">{displayY.toFixed(3)}</span></span>
            </div>
            <div className="status-spacer"></div>
            <div>
                实体数: <span className="status-value">{visibleCount}</span>
            </div>
        </div>
    </div>
  );
};

export default DxfViewer;