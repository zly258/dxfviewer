import React, { useRef, useState, WheelEvent, MouseEvent, useEffect, useLayoutEffect } from 'react';
import { AnyEntity, ViewPort, DxfLayer, DxfBlock, DxfStyle, DxfLineType, Point2D, CanvasTheme, DrawingColorMode } from '@/types';
import { renderEntitiesToCanvas, hitTest, hitTestBox } from '@/renderer/services/canvasRenderService';
import { Language } from '@/config/i18n';
import { SELECTION_CONFIG, SHORTCUT_CONFIG, VIEWER_DEFAULTS } from '@/config/viewerConfig';
import { subscribeShxFontChanged } from '@/renderer/services/shxFontService';

/**
 * Canvas 渲染核心组件
 * 负责 Canvas 渲染、坐标转换、缩放平移交互以及拾取逻辑
 */
interface CanvasViewerProps {
  entities: AnyEntity[]; // 要渲染的实体列表
  layers: Record<string, DxfLayer>; // 图层信息
  blocks?: Record<string, DxfBlock>; // 块定义
  styles?: Record<string, DxfStyle>; // 文字样式
  lineTypes?: Record<string, DxfLineType>; // 线型定义
  viewPort: ViewPort; // 当前视图参数（缩放、目标位置）
  onViewPortChange: (vp: ViewPort) => void; // 视图更新回调
  selectedEntityIds: Set<string>; // 已选择实体的 ID 集合
  onSelectIds: (ids: Set<string>) => void; // 选择状态更新回调
  onFitView: () => void; // 适应视图回调
  worldOffset?: Point2D; // 坐标偏移（用于显示原始坐标）
  ltScale?: number; // 全局线型比例
  theme: CanvasTheme; // 画布背景主题
  drawingColorMode: DrawingColorMode;
  lang: Language; // 当前语言
  onMouseMoveWorld?: (x: number, y: number) => void; // 鼠标移动时的世界坐标回调
  onRenderError?: (message: string | null) => void; // 渲染异常回调
  hiddenLayers?: Set<string>; // 隐藏图层集合
}

const CanvasViewer: React.FC<CanvasViewerProps> = ({ 
    entities, 
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
    onMouseMoveWorld,
    onRenderError,
    hiddenLayers = new Set()
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewPortRef = useRef(viewPort);
  const lastMiddleClickRef = useRef<{ time: number; x: number; y: number } | null>(null);
  viewPortRef.current = viewPort;
  
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const lastTouchRef = useRef<{ x: number; y: number; dist: number } | null>(null);
  const isTouchPanningRef = useRef<boolean>(false);
  
  const [isPanning, setIsPanning] = useState(false);
  const [isBoxSelecting, setIsBoxSelecting] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [currentMousePos, setCurrentMousePos] = useState({ x: 0, y: 0 });
  const [fontVersion, setFontVersion] = useState(0);
  


  // 从屏幕坐标计算世界坐标（以中心为原点）
  const screenToWorld = (sx: number, sy: number) => {
     const canvas = canvasRef.current;
     if (!canvas) return { x: 0, y: 0 };
     const rect = containerRef.current?.getBoundingClientRect() || { width: canvas.width, height: canvas.height };
     
     const currentViewPort = viewPortRef.current;
     const safeZoom = Math.max(Math.abs(currentViewPort.zoom), Number.MIN_VALUE);
     
     const wx = (sx - rect.width / 2) / safeZoom + currentViewPort.targetX;
     const wy = currentViewPort.targetY - (sy - rect.height / 2) / safeZoom;
     
     return {
         x: safeClamp(wx, -Number.MAX_VALUE, Number.MAX_VALUE),
         y: safeClamp(wy, -Number.MAX_VALUE, Number.MAX_VALUE)
     };
  };

  const safeClamp = (value: number, min: number, max: number): number => {
    if (!isFinite(value)) return 0;
    return Math.max(Math.min(value, max), min);
  };

  const renderRef = useRef<number | undefined>(undefined);


  // SHX 字体是异步读取的，字体加载完成后需要主动重绘当前画布。
  useEffect(() => {
    return subscribeShxFontChanged(() => setFontVersion(version => version + 1));
  }, []);

  useLayoutEffect(() => {
     const render = () => {
        const canvas = canvasRef.current;
        if (!canvas || !containerRef.current) return;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // 处理高 DPI
        const rect = containerRef.current.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        
        // 如果需要，调整大小
        if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            canvas.style.width = `${rect.width}px`;
            canvas.style.height = `${rect.height}px`;
        }

        // 为 DPI 重置缩放
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);

        try {
            renderEntitiesToCanvas(ctx, entities, layers, blocks, styles, lineTypes, ltScale, viewPort, selectedEntityIds, rect.width, rect.height, theme, drawingColorMode, hiddenLayers);
            onRenderError?.(null);



        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            ctx.fillStyle = theme === 'white' ? '#FFFFFF' : '#212121';
            ctx.fillRect(0, 0, rect.width, rect.height);
            onRenderError?.(message);
        }
     };

     if (renderRef.current) cancelAnimationFrame(renderRef.current);
     renderRef.current = requestAnimationFrame(render);

     return () => {
        if (renderRef.current) cancelAnimationFrame(renderRef.current);
     };
  }, [entities, layers, blocks, styles, lineTypes, ltScale, viewPort, selectedEntityIds, worldOffset, theme, drawingColorMode, onRenderError, fontVersion, hiddenLayers, currentMousePos]);

  // 处理滚轮和触控事件
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const scaleFactor = 1.2;
      const currentVP = viewPortRef.current;
      const newZoom = e.deltaY < 0 ? currentVP.zoom * scaleFactor : currentVP.zoom / scaleFactor;

      // 大幅放宽缩放限制以支持极端坐标
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

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
        lastTouchRef.current = { x: touch.clientX, y: touch.clientY, dist: 0 };
        isTouchPanningRef.current = false;
      } else if (e.touches.length === 2) {
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
          if (moveDist > 6) {
            isTouchPanningRef.current = true;
          }
        }
        
        if (isTouchPanningRef.current) {
          if (e.cancelable) e.preventDefault();
          const currentVP = viewPortRef.current;
          const safeZoom = Math.max(Math.abs(currentVP.zoom), Number.MIN_VALUE);
          const newTargetX = currentVP.targetX - dx / safeZoom;
          const newTargetY = currentVP.targetY + dy / safeZoom;
          
          onViewPortChange({
            targetX: safeClamp(newTargetX, -Number.MAX_VALUE, Number.MAX_VALUE),
            targetY: safeClamp(newTargetY, -Number.MAX_VALUE, Number.MAX_VALUE),
            zoom: currentVP.zoom
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
        
        const targetXWithZoom = currentVP.targetX + (zoomCenterX - viewCenterX) * (1/currentVP.zoom - 1/safeZoom);
        const targetYWithZoom = currentVP.targetY - (zoomCenterY - viewCenterY) * (1/currentVP.zoom - 1/safeZoom);
        
        const panDx = midX - lastTouchRef.current.x;
        const panDy = midY - lastTouchRef.current.y;
        
        const finalTargetX = targetXWithZoom - panDx / safeZoom;
        const finalTargetY = targetYWithZoom + panDy / safeZoom;
        
        onViewPortChange({
          targetX: safeClamp(finalTargetX, -Number.MAX_VALUE, Number.MAX_VALUE),
          targetY: safeClamp(finalTargetY, -Number.MAX_VALUE, Number.MAX_VALUE),
          zoom: safeZoom
        });
        
        lastTouchRef.current = { x: midX, y: midY, dist };
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!isTouchPanningRef.current && touchStartRef.current && e.touches.length === 0) {
        const duration = Date.now() - touchStartRef.current.time;
        if (duration < 300) {
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
              Math.max(SELECTION_CONFIG.geometryHitTolerancePixels * 2.5 * worldPerPixel, SELECTION_CONFIG.minimumHitToleranceWorld),
              thresholdCap
          );
          
          const hitId = hitTest(wPos.x, wPos.y, threshold, entities, blocks, layers, styles);
          
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
    };
  }, [onViewPortChange, entities, blocks, layers, styles, onSelectIds]);

  const handleMouseDown = (e: MouseEvent) => {
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
      
      // 新目标 X = 旧目标 X - dx / 缩放比例
      const currentViewPort = viewPortRef.current;
      const safeZoom = Math.max(Math.abs(currentViewPort.zoom), Number.MIN_VALUE);
      const newTargetX = currentViewPort.targetX - dx / safeZoom;
      const newTargetY = currentViewPort.targetY + dy / safeZoom;

      onViewPortChange({
        targetX: safeClamp(newTargetX, -Number.MAX_VALUE, Number.MAX_VALUE),
        targetY: safeClamp(newTargetY, -Number.MAX_VALUE, Number.MAX_VALUE),
        zoom: currentViewPort.zoom
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
             thresholdCap
         );
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
         
         // CAD 风格选择：
         // 从左向右 (endW.x > startW.x): 包含选择 (Window Selection) - 仅选中完全在框内的实体
         // 从右向左 (endW.x < startW.x): 交叉选择 (Crossing Selection) - 选中框内或相交的实体
         const isCrossing = wPos.x < screenToWorld(dragStart.x, dragStart.y).x;

         const boxIds = hitTestBox(
             { x1: startW.x, y1: startW.y, x2: endW.x, y2: endW.y },
             entities,
             layers,
             blocks,
             isCrossing // 传递选择模式
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

  // 根据 theme 计算 --canvas-bg 的实际色值，通过 inline style 写入容器，
  // 确保 CSS fallback 和主题切换瞬间不会出现黑色闪烁。
  const canvasBgColor = theme === 'white' ? '#FFFFFF' : '#212121';

  return (
    <div
      ref={containerRef}
      className="canvas-container"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => {
        setIsPanning(false);
        setIsBoxSelecting(false);
      }}
      style={{ cursor: isPanning ? 'grabbing' : 'default', '--canvas-bg': canvasBgColor } as React.CSSProperties}
    >
      <canvas ref={canvasRef} />
      

      {isBoxSelecting && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(dragStart.x, currentMousePos.x),
            top: Math.min(dragStart.y, currentMousePos.y),
            width: Math.abs(currentMousePos.x - dragStart.x),
            height: Math.abs(currentMousePos.y - dragStart.y),
            backgroundColor: currentMousePos.x < dragStart.x ? SELECTION_CONFIG.crossingSelectionFill : SELECTION_CONFIG.windowSelectionFill,
            border: `1px ${currentMousePos.x < dragStart.x ? 'dashed' : 'solid'} ${currentMousePos.x < dragStart.x ? SELECTION_CONFIG.crossingSelectionBorder : SELECTION_CONFIG.windowSelectionBorder}`,
            pointerEvents: 'none'
          }}
        />
      )}


    </div>
  );
};

export default CanvasViewer;
