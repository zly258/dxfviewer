import React, { useRef, useState, WheelEvent, MouseEvent, useEffect, useLayoutEffect, useCallback } from 'react';
import { AnyEntity, ViewPort, DxfLayer, DxfBlock, DxfStyle, DxfLineType, EntityType, Point2D } from '../types';
import { renderEntitiesToCanvas, hitTest, hitTestBox } from '../services/canvasRenderService';
import { Language, UI_TRANSLATIONS } from '../constants/i18n';

/**
 * DXF 渲染核心组件
 * 负责 Canvas 渲染、坐标转换、缩放平移交互以及拾取逻辑
 */
interface DxfViewerProps {
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
  theme: 'black' | 'white' | 'gray'; // 画布背景主题
  lang: Language; // 当前语言
  onMouseMoveWorld?: (x: number, y: number) => void; // 鼠标移动时的世界坐标回调
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
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 }); // 屏幕坐标
  const [currentMousePos, setCurrentMousePos] = useState({ x: 0, y: 0 }); // 屏幕坐标

  // 从屏幕坐标计算世界坐标（以中心为原点）
  const screenToWorld = (sx: number, sy: number) => {
     const canvas = canvasRef.current;
     if (!canvas) return { x: 0, y: 0 };
     const rect = containerRef.current?.getBoundingClientRect() || { width: canvas.width, height: canvas.height };
     
     const safeZoom = Math.max(Math.abs(viewPort.zoom), Number.MIN_VALUE);
     
     // 世界坐标 X = (屏幕 X - 宽度 / 2) / 缩放比例 + 目标 X
     const wx = (sx - rect.width / 2) / safeZoom + viewPort.targetX;
     // 世界坐标 Y = 目标 Y - (屏幕 Y - 高度 / 2) / 缩放比例
     const wy = viewPort.targetY - (sy - rect.height / 2) / safeZoom;
     
     return {
         x: safeClamp(wx, -Number.MAX_VALUE, Number.MAX_VALUE),
         y: safeClamp(wy, -Number.MAX_VALUE, Number.MAX_VALUE)
     };
  };

  const [mouseWorldPos, setMouseWorldPos] = useState({ x: 0, y: 0 });

  // 显示坐标（原始坐标）
  const displayX = mouseWorldPos.x + (worldOffset?.x || 0);
  const displayY = mouseWorldPos.y + (worldOffset?.y || 0);

  // 缓存可见实体数量以优化性能
  const visibleCount = React.useMemo(() => {
    return entities.filter(e => e.visible !== false).length;
  }, [entities]);

  // 限制数值范围以防止 Infinity/NaN 问题
  const safeClamp = (value: number, min: number, max: number): number => {
    if (!isFinite(value)) return 0;
    return Math.max(Math.min(value, max), min);
  };

  // 画布渲染循环，使用 requestAnimationFrame 保证平滑度
  const renderRef = useRef<number>();
  
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

        renderEntitiesToCanvas(ctx, entities, layers, blocks, styles, lineTypes, ltScale, viewPort, selectedEntityIds, rect.width, rect.height, theme);
     };

     if (renderRef.current) cancelAnimationFrame(renderRef.current);
     renderRef.current = requestAnimationFrame(render);

     return () => {
        if (renderRef.current) cancelAnimationFrame(renderRef.current);
     };
  }, [entities, layers, blocks, styles, lineTypes, ltScale, viewPort, selectedEntityIds, worldOffset, theme]);

  // 处理滚轮事件，使用 passive: false 以允许 preventDefault
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
      
      // 新目标 X = 旧目标 X - dx / 缩放比例
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
         // 增加点选判定阈值使选择更容易，特别是对于文本
         // 防止极端的缩放值
         const safeZoom = Math.max(Math.abs(viewPort.zoom), Number.MIN_VALUE);
         // 增加点击判定范围，从 12 像素增加到 20 像素，使点选更灵敏
         const threshold = Math.min(Math.max(20 / safeZoom, 1e-12), 1e12);
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
      setDragStart({ x: 0, y: 0 }); // 重置拖拽起始点
    }
  };

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
      style={{ cursor: isPanning ? 'grabbing' : 'default' }}
    >
      <canvas ref={canvasRef} />
      
      {/* 框选视觉反馈 */}
      {isBoxSelecting && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(dragStart.x, currentMousePos.x),
            top: Math.min(dragStart.y, currentMousePos.y),
            width: Math.abs(currentMousePos.x - dragStart.x),
            height: Math.abs(currentMousePos.y - dragStart.y),
            backgroundColor: currentMousePos.x < dragStart.x ? 'rgba(0, 255, 0, 0.1)' : 'rgba(0, 0, 255, 0.1)', // 左移绿色(交叉)，右移蓝色(包含)
            border: `1px ${currentMousePos.x < dragStart.x ? 'dashed' : 'solid'} ${currentMousePos.x < dragStart.x ? '#00ff00' : '#0078d4'}`, // 虚线/实线
            pointerEvents: 'none'
          }}
        />
      )}
    </div>
  );
};

export default DxfViewer;