import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CanvasTheme, DrawingColorMode, DxfData, ViewPort } from '@/types';
import { CANVAS_THEME_COLORS, INTERACTION_CONFIG, ZOOM_CONFIG } from '@/config/viewerConfig';
import { calculateExtents, calculatePaperLayoutExtents } from '@/core/geometry/extents';
import { fitExtentsToBox } from '@/render/viewportFitting';
import { RenderEngine } from '@/render/webgl/renderEngine';
import { CanvasRenderEngine } from '@/render/canvas/CanvasRenderEngine';
import type { EngineKind, InteractiveRenderEngine } from '@/render/engine';
import { hasOutlineFont, loadOutlineFont } from '@/render/text/outlineText';
import { clearAllRenderCaches } from '@/render/text/renderCache';
import { createDxfLoaderWorker } from '@/io/loader/workerFactory';
import type { ParseWorkerResponse } from '@/io/loader/dxfLoader.worker';

/** 预览组件可接收的图纸来源：地址、File/Blob、原始字节或已解析数据。 */
export type DxfPreviewSource = string | File | Blob | ArrayBuffer | DxfData;

export interface DxfPreviewProps {
  /** 图纸来源。变化时自动重新加载。 */
  src?: DxfPreviewSource;
  /** 背景主题：light（白底）或 dark（黑底）。默认 light。 */
  theme?: 'light' | 'dark';
  /** 图纸颜色模式：original 原色 / monochrome 黑白。默认 original。 */
  colorMode?: DrawingColorMode;
  /** 渲染引擎，默认 webgl；不支持 WebGL2 时自动回退 canvas。 */
  engine?: EngineKind;
  /** 要显示的布局名（默认模型空间）。 */
  layout?: string;
  /** 轮廓字体地址（TTF/OTF）。不传则使用系统字体图集。 */
  fontUrl?: string;
  /** 西文/特殊符号后备字体地址（如 Arial），主字体缺字时回退。 */
  fallbackFontUrl?: string;
  /** 是否允许滚轮缩放 / 拖拽平移，默认 true。 */
  interactive?: boolean;
  /** 加载中占位内容；传 null 关闭。 */
  loadingFallback?: React.ReactNode;
  /** 出错时的占位渲染；不传则显示简短错误文字。 */
  renderError?: (error: Error) => React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  /** 加载并解析完成。 */
  onLoad?: (data: DxfData) => void;
  onError?: (error: Error) => void;
}

/** 命令式句柄（通过 ref 使用）。 */
export interface DxfPreviewHandle {
  /** 适应视图。 */
  fit: () => void;
  /** 当前视口。 */
  getViewPort: () => ViewPort;
  setViewPort: (viewPort: ViewPort) => void;
}

const isDxfData = (value: unknown): value is DxfData =>
  !!value && typeof value === 'object' && Array.isArray((value as DxfData).entities) && 'layers' in (value as object);

const toBuffer = async (src: Exclude<DxfPreviewSource, DxfData>, signal: AbortSignal): Promise<ArrayBuffer> => {
  if (typeof src === 'string') {
    const response = await fetch(src, { signal });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());
    return response.arrayBuffer();
  }
  if (src instanceof ArrayBuffer) return src.slice(0);
  return src.arrayBuffer();
};

/** 在后台线程解析，主线程不阻塞。 */
const parseInWorker = (buffer: ArrayBuffer, signal: AbortSignal): Promise<DxfData> =>
  new Promise((resolve, reject) => {
    const worker = createDxfLoaderWorker();
    const abort = () => {
      worker.terminate();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<ParseWorkerResponse>) => {
      const message = event.data;
      if (message.type === 'progress') return;
      signal.removeEventListener('abort', abort);
      worker.terminate();
      if (message.type === 'success') resolve(message.data);
      else reject(new Error(message.error));
    };
    worker.onerror = (event) => {
      signal.removeEventListener('abort', abort);
      worker.terminate();
      reject(new Error(event.message || 'DXF worker error'));
    };
    worker.postMessage({ type: 'parse', requestId: 1, buffer }, [buffer]);
  });

/**
 * 极简 DXF 预览组件：只有画布（无工具栏 / 面板 / 状态栏 / 菜单），
 * 填满父容器，便于第三方库嵌入。
 *
 * 交互：滚轮缩放、拖拽平移、双击适应视图。
 */
const DxfPreview = React.forwardRef<DxfPreviewHandle, DxfPreviewProps>(function DxfPreview({
  src,
  theme = 'light',
  colorMode = 'original',
  engine: engineKind = 'webgl',
  layout,
  fontUrl,
  fallbackFontUrl,
  interactive = true,
  loadingFallback,
  renderError,
  className,
  style,
  onLoad,
  onError,
}, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** WebGL 文字覆盖层画布与引擎（轮廓字体不可用时启用）。 */
  const textCanvasRef = useRef<HTMLCanvasElement>(null);
  const textEngineRef = useRef<CanvasRenderEngine | null>(null);
  const engineRef = useRef<InteractiveRenderEngine | null>(null);
  const viewPortRef = useRef<ViewPort>({ targetX: 0, targetY: 0, zoom: 1 });
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  const dirtyRef = useRef(true);
  const fittedRef = useRef(false);
  const onLoadRef = useRef(onLoad);
  const onErrorRef = useRef(onError);
  onLoadRef.current = onLoad;
  onErrorRef.current = onError;

  const [data, setData] = useState<DxfData | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);
  const [fontVersion, setFontVersion] = useState(0);
  const [engineFallback, setEngineFallback] = useState(false);
  const [panning, setPanning] = useState(false);

  const canvasTheme: CanvasTheme = theme === 'dark' ? 'black' : 'white';
  /**
   * 引擎选择：WebGL2 不可用时回退 Canvas。
   *
   * 文字：WebGL 的 GPU 文字依赖宿主提供轮廓字体（public/fonts/simfang.ttf）。
   * 字体不可用（没放 / 不含中文）时**不要把整个引擎降级为 Canvas**（大图会掉帧），
   * 而是给 WebGL 叠一层 Canvas 2D 文字覆盖层 —— 几何仍在 GPU，文字与 Canvas
   * 引擎同源（见 useTextOverlay）。
   */
  const effectiveEngine: EngineKind = engineFallback ? 'canvas' : engineKind;
  const useTextOverlay = effectiveEngine === 'webgl';

  // ── 当前布局的实体与范围 ──
  const view = useMemo(() => {
    if (!data) return null;
    const layouts = data.layouts || [];
    const target = (layout && layouts.find(l => l.name === layout))
      || layouts.find(l => l.name === data.activeLayoutName)
      || layouts.find(l => l.isModel)
      || layouts[0];
    const entities = target?.entities ?? data.entities;
    const modelEntities = layouts.find(l => l.isModel)?.entities;
    return { entities, modelEntities, extents: target?.extents ?? data.extents, isPaper: !!target && !target.isModel };
  }, [data, layout]);

  const requestFrame = useCallback(() => { dirtyRef.current = true; }, []);

  const fit = useCallback(() => {
    if (!view || !data) return;
    const { width, height } = sizeRef.current;
    if (width <= 0 || height <= 0) return;
    const extents = view.extents
      ?? (view.isPaper
        ? calculatePaperLayoutExtents(view.entities, data.blocks, data.styles)
        : calculateExtents(view.entities, data.blocks, data.styles));
    viewPortRef.current = fitExtentsToBox(extents, width, height, {
      marginFactor: ZOOM_CONFIG.fitViewMarginFactor,
      minZoom: ZOOM_CONFIG.minZoom,
      maxZoom: ZOOM_CONFIG.maxZoom,
    });
    fittedRef.current = true;
    requestFrame();
  }, [data, requestFrame, view]);

  React.useImperativeHandle(ref, () => ({
    fit,
    getViewPort: () => viewPortRef.current,
    setViewPort: (vp: ViewPort) => { viewPortRef.current = vp; requestFrame(); },
  }), [fit, requestFrame]);

  // ── 字体（可选） ──
  useEffect(() => {
    if (!fontUrl && !fallbackFontUrl) return;
    let cancelled = false;
    void (async () => {
      let changed = false;
      if (fontUrl && !hasOutlineFont()) changed = (await loadOutlineFont(fontUrl, false)) || changed;
      if (fallbackFontUrl) changed = (await loadOutlineFont(fallbackFontUrl, true)) || changed;
      if (!cancelled && changed) setFontVersion(v => v + 1);
    })();
    return () => { cancelled = true; };
  }, [fontUrl, fallbackFontUrl]);

  // ── 加载 ──
  useEffect(() => {
    if (src === undefined || src === null) { setData(null); return; }
    fittedRef.current = false;
    setError(null);
    if (isDxfData(src)) {
      clearAllRenderCaches();
      setData(src);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    void (async () => {
      try {
        const buffer = await toBuffer(src as Exclude<DxfPreviewSource, DxfData>, controller.signal);
        const parsed = await parseInWorker(buffer, controller.signal);
        if (controller.signal.aborted) return;
        clearAllRenderCaches();
        setData(parsed);
        setLoading(false);
        onLoadRef.current?.(parsed);
      } catch (err) {
        if (controller.signal.aborted || (err as Error)?.name === 'AbortError') return;
        const normalized = err instanceof Error ? err : new Error(String(err));
        setError(normalized);
        setLoading(false);
        onErrorRef.current?.(normalized);
      }
    })();
    return () => controller.abort();
  }, [src]);

  // ── 尺寸同步 ──
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const sync = () => {
      const rect = host.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const prev = sizeRef.current;
      sizeRef.current = { width: rect.width, height: rect.height, dpr };
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
      }
      // 首次拿到有效尺寸 / 容器尺寸变化且尚未手动操作：重新适应。
      if (!fittedRef.current && rect.width > 0 && rect.height > 0) fit();
      else if (prev.width > 0 && prev.height > 0 && (prev.width !== rect.width || prev.height !== rect.height)) {
        // 保持视野中心与缩放，仅重绘。
      }
      requestFrame();
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(host);
    return () => observer.disconnect();
  }, [fit, requestFrame]);

  // ── 引擎生命周期 + 渲染循环 ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let engine: InteractiveRenderEngine;
    try {
      engine = effectiveEngine === 'canvas' ? new CanvasRenderEngine(canvas) : new RenderEngine(canvas);
    } catch (err) {
      if (effectiveEngine !== 'canvas') {
        setEngineFallback(true); // WebGL2 不可用：回退 Canvas 2D
        return;
      }
      setError(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    engineRef.current = engine;
    // WebGL + 轮廓字体不可用（宿主没放字体 / 字体不含中文）时，文字改由
    // Canvas 2D 覆盖层绘制：几何仍在 GPU（大图性能不受影响），文字与 Canvas
    // 引擎同源，不会出现字号不一、标点走形。
    let textEngine: CanvasRenderEngine | null = null;
    if (effectiveEngine === 'webgl' && useTextOverlay && textCanvasRef.current) {
      try {
        textEngine = new CanvasRenderEngine(textCanvasRef.current, { textOnly: true });
        textEngineRef.current = textEngine;
      } catch {
        textEngine = null;
      }
    }
    let raf = 0;
    const loop = () => {
      if (dirtyRef.current) {
        const { width, height, dpr } = sizeRef.current;
        if (width > 0 && height > 0) {
          try {
            const params = { viewPort: viewPortRef.current, cssWidth: width, cssHeight: height, dpr };
            engine.render(params);
            textEngine?.render(params);
          } catch (err) {
            setError(err instanceof Error ? err : new Error(String(err)));
          }
        }
        dirtyRef.current = false;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    requestFrame();
    return () => {
      cancelAnimationFrame(raf);
      engine.dispose();
      textEngine?.dispose();
      if (textEngineRef.current === textEngine) textEngineRef.current = null;
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [effectiveEngine, useTextOverlay, requestFrame]);

  // ── 场景更新（图纸 / 主题 / 颜色模式 / 字体变化） ──
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !data || !view) return;
    engine.setTheme(canvasTheme, CANVAS_THEME_COLORS[canvasTheme]);
    const sceneOptions = {
      entities: view.entities,
      modelEntities: view.modelEntities && view.modelEntities !== view.entities ? view.modelEntities : undefined,
      layers: data.layers,
      blocks: data.blocks,
      styles: data.styles,
      lineTypes: data.lineTypes,
      ltScale: data.header?.ltScale ?? 1,
      theme: canvasTheme,
      drawingColorMode: colorMode,
    };
    try {
      // 有文字覆盖层时，GL 场景跳过文字烘焙，文字由 textEngine 单独绘制。
      engine.setScene(textEngineRef.current ? { ...sceneOptions, skipText: true } as never : sceneOptions);
      const textEngine = textEngineRef.current;
      if (textEngine) {
        textEngine.setTheme(canvasTheme, CANVAS_THEME_COLORS[canvasTheme]);
        textEngine.setScene(sceneOptions);
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
    if (!fittedRef.current) fit();
    requestFrame();
  }, [data, view, canvasTheme, colorMode, fontVersion, effectiveEngine, fit, requestFrame]);

  // ── 交互：滚轮缩放 / 拖拽平移 / 双击适应 ──
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !interactive) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const vp = viewPortRef.current;
      const factor = INTERACTION_CONFIG.wheelZoomFactor;
      const zoom = Math.min(ZOOM_CONFIG.maxZoom, Math.max(ZOOM_CONFIG.minZoom, e.deltaY < 0 ? vp.zoom * factor : vp.zoom / factor));
      if (zoom === vp.zoom) return;
      const rect = host.getBoundingClientRect();
      const dx = e.clientX - rect.left - rect.width / 2;
      const dy = e.clientY - rect.top - rect.height / 2;
      const k = 1 / vp.zoom - 1 / zoom;
      viewPortRef.current = { targetX: vp.targetX + dx * k, targetY: vp.targetY - dy * k, zoom };
      requestFrame();
    };

    // 指针：单指/鼠标拖拽平移；双指捏合缩放。
    const pointers = new Map<number, { x: number; y: number }>();
    let lastPinch = 0;
    const onPointerDown = (e: PointerEvent) => {
      host.setPointerCapture?.(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) setPanning(true);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        lastPinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const vp = viewPortRef.current;
      if (pointers.size === 1) {
        viewPortRef.current = {
          targetX: vp.targetX - (e.clientX - prev.x) / vp.zoom,
          targetY: vp.targetY + (e.clientY - prev.y) / vp.zoom,
          zoom: vp.zoom,
        };
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        requestFrame();
      } else if (pointers.size === 2) {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (lastPinch > 0 && dist > 0) {
          const zoom = Math.min(ZOOM_CONFIG.maxZoom, Math.max(ZOOM_CONFIG.minZoom, vp.zoom * dist / lastPinch));
          const rect = host.getBoundingClientRect();
          const dx = (a.x + b.x) / 2 - rect.left - rect.width / 2;
          const dy = (a.y + b.y) / 2 - rect.top - rect.height / 2;
          const k = 1 / vp.zoom - 1 / zoom;
          viewPortRef.current = { targetX: vp.targetX + dx * k, targetY: vp.targetY - dy * k, zoom };
          requestFrame();
        }
        lastPinch = dist;
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size === 0) setPanning(false);
      lastPinch = 0;
    };
    const onDoubleClick = () => fit();

    host.addEventListener('wheel', onWheel, { passive: false });
    host.addEventListener('pointerdown', onPointerDown);
    host.addEventListener('pointermove', onPointerMove);
    host.addEventListener('pointerup', onPointerUp);
    host.addEventListener('pointercancel', onPointerUp);
    host.addEventListener('dblclick', onDoubleClick);
    return () => {
      host.removeEventListener('wheel', onWheel);
      host.removeEventListener('pointerdown', onPointerDown);
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerup', onPointerUp);
      host.removeEventListener('pointercancel', onPointerUp);
      host.removeEventListener('dblclick', onDoubleClick);
    };
  }, [fit, interactive, requestFrame]);

  const background = CANVAS_THEME_COLORS[canvasTheme];
  const errorNode = error
    ? (renderError ? renderError(error) : <div className="dxf-preview-message">{error.message}</div>)
    : null;
  const loadingNode = loading && !error && loadingFallback !== null
    ? (loadingFallback ?? <div className="dxf-preview-spinner" role="status" aria-label="loading" />)
    : null;

  return (
    <div
      ref={hostRef}
      className={`dxf-preview${panning ? ' is-panning' : ''}${className ? ` ${className}` : ''}`}
      style={{ ...style, ['--dxf-preview-bg' as string]: background }}
    >
      {/* key 随引擎变化：同一 canvas 元素不能同时持有 WebGL 与 2D 上下文 */}
      <canvas key={effectiveEngine} ref={canvasRef} />
      {useTextOverlay && (
        <canvas key={`text-${effectiveEngine}`} ref={textCanvasRef} className="dxf-preview-text-layer" />
      )}
      {loadingNode}
      {errorNode}
    </div>
  );
});

export default DxfPreview;
