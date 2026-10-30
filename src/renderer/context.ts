/**
 * 后端无关的绘制上下文。
 *
 * 目标：把「实体如何画」与「画到哪里」解耦。renderer/entities 下的绘制函数
 * 只依赖本接口；Canvas 2D（交互与 PNG）与 SVG（矢量导出）各自实现一份。
 *
 * 设计约束：CanvasRenderingContext2D 必须**结构上满足**本接口（交互层零改动），
 * 因此这里只收录渲染器实际用到的方法，属性类型取 DOM 类型的超集。
 */

export interface RenderTextMetrics {
  width: number;
  actualBoundingBoxLeft?: number;
  actualBoundingBoxRight?: number;
  actualBoundingBoxAscent?: number;
  actualBoundingBoxDescent?: number;
  fontBoundingBoxAscent?: number;
  fontBoundingBoxDescent?: number;
}

/**
 * 填充/描边样式：CSS 颜色串、渐变（DOM 类型，渲染器当前未用）或图案令牌
 * （由 createPattern 产出；SVG 后端内部持有 dataURL，Canvas 后端即原生 CanvasPattern）。
 */
export type RenderPaint = string | CanvasGradient | CanvasPattern;

export interface RenderContext {
  // ---- 状态属性 ----
  fillStyle: RenderPaint;
  strokeStyle: RenderPaint;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;

  // ---- 路径 ----
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void;
  closePath(): void;

  // ---- 绘制 ----
  stroke(): void;
  fill(fillRule?: CanvasFillRule): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  strokeRect(x: number, y: number, width: number, height: number): void;
  setLineDash(segments: number[]): void;
  createPattern(image: CanvasImageSource, repetition?: string | null): CanvasPattern | null;

  // ---- 状态栈与变换 ----
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  scale(x: number, y: number): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;

  // ---- 文字 ----
  measureText(text: string): RenderTextMetrics;
  /** maxWidth 与 Canvas 语义一致：可选的压缩宽度（SVG 端映射为 textLength）。 */
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
}

/** 判断样式值是否为纯 CSS 颜色串。 */
export const isCssColor = (paint: RenderPaint): paint is string => typeof paint === 'string';
