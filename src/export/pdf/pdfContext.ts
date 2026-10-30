/**
 * RenderContext 的 PDF 内容流后端（M7 矢量 PDF）。
 *
 * 设计要点：
 * - **几何全矢量**：路径 → m/l/c（arc 按标准 kappa 转三次贝塞尔）、填充 f/f*、描边 S
 * - **变换在 JS 侧完成**：维护 Canvas 同款矩阵，输出坐标已是页面坐标——
 *   这与 Canvas「路径在构造时定格变换」的语义完全一致，也绕开了 PDF 无法
 *   绝对重置 CTM 的限制；q/Q 只承担样式栈
 * - **y 轴翻转**：初始化矩阵为 [1,0,0,-1,0,pageHeight]，上层按 Canvas 习惯
 *   （y 向下、左上原点）输出即可
 * - **文字混合策略**：fillText 采集为文字运行（text runs），由导出器用浏览器
 *   Canvas 光栅化后以带 /SMask 的图像叠加——几何是矢量、文字保系统字体渲染；
 *   原因：浏览器拿不到系统字体字形轮廓，opentype.js 轮廓化路线对系统字体不可行
 * - **图案填充**：createPattern 时对源画布做同步 getImageData，取非透明像素的
 *   平均色作为实心填充（PDF 平铺图案的复杂度不值得，剖面线视觉近似即可）
 */

import type { RenderContext, RenderPaint, RenderTextMetrics } from '@/renderer/context';
import { measureTextHeuristic, parseFont } from '@/export/textMetrics';

export interface TextRun {
  text: string;
  /** 页面坐标（pt，y 向上） */
  x: number;
  y: number;
  font: string;
  fill: string;
  align: CanvasTextAlign;
  baseline: CanvasTextBaseline;
  maxWidth?: number;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

const PRECISION = 3;
const num = (value: number): string => {
  if (!Number.isFinite(value)) return '0';
  return String(Math.round(value * 10 ** PRECISION) / 10 ** PRECISION);
};

const NAMED_COLORS: Record<string, string> = {
  white: '#ffffff',
  black: '#000000',
  red: '#ff0000',
  green: '#008000',
  lime: '#00ff00',
  blue: '#0000ff',
  yellow: '#ffff00',
  cyan: '#00ffff',
  aqua: '#00ffff',
  magenta: '#ff00ff',
  fuchsia: '#ff00ff',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  orange: '#ffa500',
  purple: '#800080',
  maroon: '#800000',
  navy: '#000080',
  olive: '#808000',
  teal: '#008080',
};

/** 解析渲染器会用到的 CSS 颜色（hex / rgb / rgba / 常用命名色）。 */
export const parseCssColor = (input: string): Rgb => {
  const value = (input || '').trim().toLowerCase();
  const fallback: Rgb = { r: 0, g: 0, b: 0, a: 1 };

  if (NAMED_COLORS[value]) return parseCssColor(NAMED_COLORS[value]);
  if (value === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

  if (value.startsWith('#')) {
    const hex = value.slice(1);
    if (hex.length === 3) {
      return {
        r: Number.parseInt(hex[0] + hex[0], 16),
        g: Number.parseInt(hex[1] + hex[1], 16),
        b: Number.parseInt(hex[2] + hex[2], 16),
        a: 1,
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      return {
        r: Number.parseInt(hex.slice(0, 2), 16),
        g: Number.parseInt(hex.slice(2, 4), 16),
        b: Number.parseInt(hex.slice(4, 6), 16),
        a: hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1,
      };
    }
    return fallback;
  }

  const rgbMatch = /^rgba?\(([^)]+)\)$/.exec(value);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(/[,/\s]+/).filter(Boolean).map(Number.parseFloat);
    if (parts.length >= 3) {
      return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
    }
  }
  return fallback;
};

/** alpha 混合到页面底色（PDF v1 无逐对象透明度，颜色预算在导出侧完成）。 */
export const blendOnBackground = (color: Rgb, background: Rgb): Rgb => ({
  r: color.r * color.a + background.r * (1 - color.a),
  g: color.g * color.a + background.g * (1 - color.a),
  b: color.b * color.a + background.b * (1 - color.a),
  a: 1,
});

const LINE_CAPS: Record<string, number> = { butt: 0, round: 1, square: 2 };
const LINE_JOINS: Record<string, number> = { miter: 0, round: 1, bevel: 2 };

/** 圆弧转三次贝塞尔：每段圆心角不超过 90°。 */
const arcToBeziers = (
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
  counterclockwise: boolean,
): Array<[number, number, number, number, number, number]> => {
  let delta = endAngle - startAngle;
  if (counterclockwise) {
    while (delta > 0) delta -= Math.PI * 2;
  } else {
    while (delta < 0) delta += Math.PI * 2;
  }

  const segments = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
  const step = delta / segments;
  const k = (4 / 3) * Math.tan(step / 4);
  const controls: Array<[number, number, number, number, number, number]> = [];

  let angle = startAngle;
  for (let i = 0; i < segments; i++) {
    const cos0 = Math.cos(angle);
    const sin0 = Math.sin(angle);
    const cos1 = Math.cos(angle + step);
    const sin1 = Math.sin(angle + step);

    controls.push([
      cx + radius * (cos0 - k * sin0),
      cy + radius * (sin0 + k * cos0),
      cx + radius * (cos1 + k * sin1),
      cy + radius * (sin1 - k * cos1),
      cx + radius * cos1,
      cy + radius * sin1,
    ]);
    angle += step;
  }
  return controls;
};

type Matrix = [number, number, number, number, number, number];

const multiply = (m1: Matrix, m2: Matrix): Matrix => [
  m1[0] * m2[0] + m1[2] * m2[1],
  m1[1] * m2[0] + m1[3] * m2[1],
  m1[0] * m2[2] + m1[2] * m2[3],
  m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
  m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
];

export interface PdfRenderContextOptions {
  pageWidthPt: number;
  pageHeightPt: number;
  /** 页面底色（rgba 颜色的 alpha 混合基准），默认白 */
  background?: string;
}

export class PdfRenderContext implements RenderContext {
  private readonly ops: string[] = [];
  private readonly styleStack: string[] = [];
  private matrix: Matrix;
  private readonly backgroundRgb: Rgb;

  private currentPath: string[] = [];
  private strokeStyleValue: string | CanvasGradient | CanvasPattern = '#000000';
  private fillStyleValue: string | CanvasGradient | CanvasPattern = '#000000';
  private lineWidthValue = 1;
  private lineCapValue = 'butt';
  private lineJoinValue = 'miter';
  private dashValue: number[] = [];
  private fontValue = '10px sans-serif';
  private textAlignValue: CanvasTextAlign = 'start';
  private textBaselineValue: CanvasTextBaseline = 'alphabetic';

  private readonly textRuns: TextRun[] = [];
  private readonly patternColors = new Map<CanvasPattern, string>();

  public readonly pageWidthPt: number;
  public readonly pageHeightPt: number;

  constructor(options: PdfRenderContextOptions) {
    this.pageWidthPt = options.pageWidthPt;
    this.pageHeightPt = options.pageHeightPt;
    this.backgroundRgb = parseCssColor(options.background ?? '#ffffff');
    // Canvas 习惯（y 向下、左上原点）→ PDF（y 向上、左下原点）
    this.matrix = [1, 0, 0, -1, 0, options.pageHeightPt];
  }

  // ---- 状态属性（延迟生效：绘制时按需输出样式操作符） ----
  get fillStyle(): RenderPaint { return this.fillStyleValue; }
  set fillStyle(value: RenderPaint) { this.fillStyleValue = value; }

  get strokeStyle(): RenderPaint { return this.strokeStyleValue; }
  set strokeStyle(value: RenderPaint) { this.strokeStyleValue = value; }

  get lineWidth(): number { return this.lineWidthValue; }
  set lineWidth(value: number) { this.lineWidthValue = Number.isFinite(value) && value > 0 ? value : 1; }

  get lineCap(): string { return this.lineCapValue; }
  set lineCap(value: string) { this.lineCapValue = value; }

  get lineJoin(): string { return this.lineJoinValue; }
  set lineJoin(value: string) { this.lineJoinValue = value; }

  get font(): string { return this.fontValue; }
  set font(value: string) { this.fontValue = value; }

  get textAlign(): CanvasTextAlign { return this.textAlignValue; }
  set textAlign(value: CanvasTextAlign) { this.textAlignValue = value; }

  get textBaseline(): CanvasTextBaseline { return this.textBaselineValue; }
  set textBaseline(value: CanvasTextBaseline) { this.textBaselineValue = value; }

  // ---- 变换（JS 侧矩阵，坐标输出前变换） ----
  save(): void {
    this.styleStack.push(
      JSON.stringify([
        this.strokeStyleValue, this.fillStyleValue, this.lineWidthValue,
        this.lineCapValue, this.lineJoinValue, this.dashValue,
        this.fontValue, this.textAlignValue, this.textBaselineValue,
      ]),
    );
    this.styleStack.push(`M:${JSON.stringify(this.matrix)}`);
  }

  restore(): void {
    // 先弹矩阵标记，再弹样式
    for (let i = 0; i < 2; i++) {
      const top = this.styleStack.pop();
      if (top === undefined) break;
      if (top.startsWith('M:')) {
        this.matrix = JSON.parse(top.slice(2)) as Matrix;
      } else {
        const [stroke, fill, width, cap, join, dash, font, align, baseline] = JSON.parse(top) as [
          string | CanvasGradient | CanvasPattern,
          string | CanvasGradient | CanvasPattern,
          number, string, string, number[], string, CanvasTextAlign, CanvasTextBaseline,
        ];
        this.strokeStyleValue = stroke;
        this.fillStyleValue = fill;
        this.lineWidthValue = width;
        this.lineCapValue = cap;
        this.lineJoinValue = join;
        this.dashValue = dash;
        this.fontValue = font;
        this.textAlignValue = align;
        this.textBaselineValue = baseline;
      }
    }
  }

  translate(x: number, y: number): void {
    this.matrix = multiply(this.matrix, [1, 0, 0, 1, x, y]);
  }

  rotate(angle: number): void {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    this.matrix = multiply(this.matrix, [cos, sin, -sin, cos, 0, 0]);
  }

  scale(x: number, y: number): void {
    this.matrix = multiply(this.matrix, [x, 0, 0, y, 0, 0]);
  }

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.matrix = [a, b, c, d, e, f];
  }

  private apply(x: number, y: number): [number, number] {
    const [a, b, c, d, e, f] = this.matrix;
    return [a * x + c * y + e, b * x + d * y + f];
  }

  // ---- 路径 ----
  beginPath(): void {
    this.currentPath = [];
  }

  moveTo(x: number, y: number): void {
    const [px, py] = this.apply(x, y);
    this.currentPath.push(`${num(px)} ${num(py)} m`);
  }

  lineTo(x: number, y: number): void {
    const [px, py] = this.apply(x, y);
    if (this.currentPath.length === 0) {
      this.currentPath.push(`${num(px)} ${num(py)} m`);
      return;
    }
    this.currentPath.push(`${num(px)} ${num(py)} l`);
  }

  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise = false): void {
    const [sx, sy] = this.apply(x + radius * Math.cos(startAngle), y + radius * Math.sin(startAngle));
    if (this.currentPath.length > 0) {
      // Canvas 语义：从当前点到弧起点的隐式连线
      this.currentPath.push(`${num(sx)} ${num(sy)} l`);
    } else {
      // PDF 的 c 操作符需要当前点，空路径先落到弧起点
      this.currentPath.push(`${num(sx)} ${num(sy)} m`);
    }

    for (const [c1x, c1y, c2x, c2y, px, py] of arcToBeziers(x, y, radius, startAngle, endAngle, counterclockwise)) {
      const [p1x, p1y] = this.apply(c1x, c1y);
      const [p2x, p2y] = this.apply(c2x, c2y);
      const [ex, ey] = this.apply(px, py);
      this.currentPath.push(`${num(p1x)} ${num(p1y)} ${num(p2x)} ${num(p2y)} ${num(ex)} ${num(ey)} c`);
    }
  }

  closePath(): void {
    this.currentPath.push('h');
  }

  // ---- 样式与绘制 ----
  private resolvePaint(paint: string | CanvasGradient | CanvasPattern): string {
    if (typeof paint === 'string') return paint;
    const patternColor = (paint as { __pdfPatternColor?: string }).__pdfPatternColor;
    if (patternColor) return patternColor;
    return '#808080';
  }

  private emitStrokeStyle(): void {
    const color = blendOnBackground(parseCssColor(this.resolvePaint(this.strokeStyleValue)), this.backgroundRgb);
    this.ops.push(`${num(color.r / 255)} ${num(color.g / 255)} ${num(color.b / 255)} RG`);
    this.ops.push(`${num(this.lineWidthValue)} w`);
    this.ops.push(`${LINE_CAPS[this.lineCapValue] ?? 0} J`);
    this.ops.push(`${LINE_JOINS[this.lineJoinValue] ?? 0} j`);
    const dash = this.dashValue.filter(v => v > 0);
    this.ops.push(dash.length > 0 ? `[${dash.map(num).join(' ')}] 0 d` : '[] 0 d');
  }

  private emitFillStyle(): void {
    const color = blendOnBackground(parseCssColor(this.resolvePaint(this.fillStyleValue)), this.backgroundRgb);
    this.ops.push(`${num(color.r / 255)} ${num(color.g / 255)} ${num(color.b / 255)} rg`);
  }

  stroke(): void {
    if (this.currentPath.length === 0) return;
    this.emitStrokeStyle();
    this.ops.push(...this.currentPath, 'S');
    this.currentPath = [];
  }

  fill(fillRule?: CanvasFillRule): void {
    if (this.currentPath.length === 0) return;
    this.emitFillStyle();
    this.ops.push(...this.currentPath, fillRule === 'evenodd' ? 'f*' : 'f');
    this.currentPath = [];
  }

  fillRect(x: number, y: number, width: number, height: number): void {
    this.emitFillStyle();
    this.ops.push(...this.rectPath(x, y, width, height), 'f');
  }

  strokeRect(x: number, y: number, width: number, height: number): void {
    this.emitStrokeStyle();
    this.ops.push(...this.rectPath(x, y, width, height), 'S');
  }

  private rectPath(x: number, y: number, width: number, height: number): string[] {
    const corners: Array<[number, number]> = [
      this.apply(x, y),
      this.apply(x + width, y),
      this.apply(x + width, y + height),
      this.apply(x, y + height),
    ];
    const first = corners[0];
    const path = [`${num(first[0])} ${num(first[1])} m`];
    for (let i = 1; i < corners.length; i++) {
      path.push(`${num(corners[i][0])} ${num(corners[i][1])} l`);
    }
    path.push('h');
    return path;
  }

  setLineDash(segments: number[]): void {
    this.dashValue = [...(segments || [])];
  }

  createPattern(image: CanvasImageSource, _repetition?: string | null): CanvasPattern | null {
    // 取源画布非透明像素的平均色作为填充色（剖面线→线条色，视觉近似）
    let avg: Rgb | null = null;
    try {
      const source = image as {
        width?: number;
        height?: number;
        getContext?: (type: string) => { getImageData?: (x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray } } | null;
      };
      const width = source.width ?? 10;
      const height = source.height ?? 10;
      const ctx = source.getContext?.('2d');
      const imageData = ctx?.getImageData?.(0, 0, width, height);
      if (imageData && imageData.data.length >= width * height * 4) {
        let r = 0;
        let g = 0;
        let b = 0;
        let count = 0;
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] > 8) {
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            count++;
          }
        }
        if (count > 0) {
          avg = { r: r / count, g: g / count, b: b / count, a: 1 };
        }
      }
    } catch {
      avg = null;
    }

    const color = avg ? `rgb(${Math.round(avg.r)},${Math.round(avg.g)},${Math.round(avg.b)})` : 'rgb(128,128,128)';
    const token = { __pdfPatternColor: color } as unknown as CanvasPattern;
    this.patternColors.set(token, color);
    return token;
  }

  // ---- 文字 ----
  measureText(text: string): RenderTextMetrics {
    return measureTextHeuristic(text, this.fontValue);
  }

  fillText(text: string, x: number, y: number, maxWidth?: number): void {
    const value = String(text ?? '');
    if (!value) return;

    const [px, py] = this.apply(x, y);
    const color = blendOnBackground(parseCssColor(this.resolvePaint(this.fillStyleValue)), this.backgroundRgb);
    this.textRuns.push({
      text: value,
      x: px,
      y: py,
      font: this.fontValue,
      fill: `rgb(${Math.round(color.r)},${Math.round(color.g)},${Math.round(color.b)})`,
      align: this.textAlignValue,
      baseline: this.textBaselineValue,
      maxWidth: maxWidth !== undefined && Number.isFinite(maxWidth) && maxWidth > 0 ? maxWidth : undefined,
    });
  }

  /** 页面内容流（不含文字图像放置，由导出器追加）。 */
  getContentStream(): string {
    return this.ops.join('\n');
  }

  /** 采集到的文字运行。 */
  getTextRuns(): readonly TextRun[] {
    return this.textRuns;
  }

  /** 字体解析（导出器光栅化文字时需要 size/family）。 */
  static parseFont = parseFont;
}
