/**
 * RenderContext 的 SVG 后端。
 *
 * 把绘制调用直接串接成 SVG 文档字符串：
 * - 路径 → <path d>（arc 转换为 A 圆弧指令，与 Canvas 角度语义一致）
 * - 文字 → <text>（ctx.font 解析为 font-family/size/weight，textAlign/textBaseline
 *   映射为 text-anchor/dominant-baseline；maxWidth 映射为 textLength）
 * - 图案（createPattern）→ <pattern>+<image>（用源画布的 dataURL），fill 引用 url(#id)
 * - 变换 → 当前矩阵非恒等时输出 transform="matrix(...)"
 *
 * 已知取舍（导出场景可接受）：
 * - measureText 用字宽启发式（CJK≈1em、ASCII≈0.55em），换行位置可能与屏幕渲染有细小差异
 * - drawImage/IMAGE 占位框按描边矩形输出（渲染器本就只画占位框）
 * - OffscreenCanvas 图案源无同步 toDataURL 时降级为半透明纯色
 */
import type { RenderContext, RenderTextMetrics } from '@/renderer/context';
import { measureTextHeuristic, parseFont } from '@/export/textMetrics';

interface SvgPatternInfo {
  id: string;
  dataUrl: string | null;
  fallbackColor: string;
}

interface SvgState {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  dash: number[];
  matrix: [number, number, number, number, number, number];
}

const IDENTITY: SvgState['matrix'] = [1, 0, 0, 1, 0, 0];

const escapeXml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const n = (value: number): string => {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 1000) / 1000;
  return String(rounded);
};

const colorToSvg = (paint: string | CanvasGradient | CanvasPattern): string => {
  if (typeof paint === 'string') return paint;
  const info = (paint as { __svgPattern?: SvgPatternInfo }).__svgPattern as SvgPatternInfo | undefined;
  if (info) {
    return info.dataUrl ? `url(#${info.id})` : info.fallbackColor;
  }
  return '#000000';
};

const BASELINE_TO_DOMINANT: Record<string, string> = {
  alphabetic: 'alphabetic',
  top: 'text-before-edge',
  bottom: 'text-after-edge',
  middle: 'central',
  hanging: 'hanging',
  ideographic: 'ideographic',
};

const ALIGN_TO_ANCHOR: Record<string, string> = {
  start: 'start',
  left: 'start',
  center: 'middle',
  end: 'end',
  right: 'end',
};

export class SvgRenderContext implements RenderContext {
  private readonly states: SvgState[] = [];
  private readonly parts: string[] = [];
  private readonly patternInfos = new Map<CanvasPattern, SvgPatternInfo>();
  private patternCounter = 0;

  private currentPath: string[] = [];
  private state: SvgState;

  public readonly width: number;
  public readonly height: number;

  constructor(width: number, height: number, background?: string | null) {
    this.width = width;
    this.height = height;
    this.state = {
      fillStyle: '#000000',
      strokeStyle: '#000000',
      lineWidth: 1,
      lineCap: 'butt',
      lineJoin: 'miter',
      font: '10px sans-serif',
      textAlign: 'start',
      textBaseline: 'alphabetic',
      dash: [],
      matrix: [...IDENTITY] as SvgState['matrix'],
    };

    this.parts.push(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${n(width)}" height="${n(height)}" viewBox="0 0 ${n(width)} ${n(height)}">`,
      `<defs></defs>`,
    );

    if (background) {
      this.parts.push(
        `<rect width="${n(width)}" height="${n(height)}" fill="${escapeXml(background)}"/>`,
      );
    }
  }

  // ---- 状态属性 ----
  get fillStyle(): string | CanvasGradient | CanvasPattern { return this.state.fillStyle; }
  set fillStyle(value: string | CanvasGradient | CanvasPattern) { this.state.fillStyle = value; }

  get strokeStyle(): string | CanvasGradient | CanvasPattern { return this.state.strokeStyle; }
  set strokeStyle(value: string | CanvasGradient | CanvasPattern) { this.state.strokeStyle = value; }

  get lineWidth(): number { return this.state.lineWidth; }
  set lineWidth(value: number) { this.state.lineWidth = Number.isFinite(value) && value > 0 ? value : 1; }

  get lineCap(): string { return this.state.lineCap; }
  set lineCap(value: string) { this.state.lineCap = value; }

  get lineJoin(): string { return this.state.lineJoin; }
  set lineJoin(value: string) { this.state.lineJoin = value; }

  get font(): string { return this.state.font; }
  set font(value: string) { this.state.font = value; }

  get textAlign(): CanvasTextAlign { return this.state.textAlign; }
  set textAlign(value: CanvasTextAlign) { this.state.textAlign = value; }

  get textBaseline(): CanvasTextBaseline { return this.state.textBaseline; }
  set textBaseline(value: CanvasTextBaseline) { this.state.textBaseline = value; }

  // ---- 变换 ----
  private multiply(m: SvgState['matrix']): void {
    const [a1, b1, c1, d1, e1, f1] = this.state.matrix;
    const [a2, b2, c2, d2, e2, f2] = m;
    this.state.matrix = [
      a1 * a2 + c1 * b2,
      b1 * a2 + d1 * b2,
      a1 * c2 + c1 * d2,
      b1 * c2 + d1 * d2,
      a1 * e2 + c1 * f2 + e1,
      b1 * e2 + d1 * f2 + f1,
    ];
  }

  private matrixAttribute(): string {
    const [a, b, c, d, e, f] = this.state.matrix;
    if (a === 1 && b === 0 && c === 0 && d === 1 && e === 0 && f === 0) return '';
    return ` transform="matrix(${n(a)} ${n(b)} ${n(c)} ${n(d)} ${n(e)} ${n(f)})"`;
  }

  save(): void {
    this.states.push({ ...this.state, dash: [...this.state.dash], matrix: [...this.state.matrix] as SvgState['matrix'] });
  }

  restore(): void {
    const previous = this.states.pop();
    if (previous) this.state = previous;
  }

  translate(x: number, y: number): void { this.multiply([1, 0, 0, 1, x, y]); }
  rotate(angle: number): void {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    this.multiply([cos, sin, -sin, cos, 0, 0]);
  }
  scale(x: number, y: number): void { this.multiply([x, 0, 0, y, 0, 0]); }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.state.matrix = [a, b, c, d, e, f];
  }

  // ---- 路径 ----
  beginPath(): void {
    this.currentPath = [];
  }

  moveTo(x: number, y: number): void {
    this.currentPath.push(`M ${n(x)} ${n(y)}`);
  }

  lineTo(x: number, y: number): void {
    if (this.currentPath.length === 0) {
      this.currentPath.push(`M ${n(x)} ${n(y)}`);
      return;
    }
    this.currentPath.push(`L ${n(x)} ${n(y)}`);
  }

  closePath(): void {
    this.currentPath.push('Z');
  }

  /**
   * Canvas arc 语义 → SVG A 指令。
   * 与 Canvas 相同的方向归一化：顺时针取正增量、逆时针取负增量；
   * 整圆输出两段半弧（SVG 单条 A 无法表达整圆）。
   */
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise = false): void {
    const startX = x + radius * Math.cos(startAngle);
    const startY = y + radius * Math.sin(startAngle);

    if (this.currentPath.length === 0) {
      this.currentPath.push(`M ${n(startX)} ${n(startY)}`);
    } else {
      // Canvas 语义：从当前点到弧起点的隐式连线
      this.currentPath.push(`L ${n(startX)} ${n(startY)}`);
    }

    let delta = endAngle - startAngle;
    if (counterclockwise) {
      while (delta > 0) delta -= Math.PI * 2;
    } else {
      while (delta < 0) delta += Math.PI * 2;
    }

    const sweep = counterclockwise ? 0 : 1;
    const endX = x + radius * Math.cos(endAngle);
    const endY = y + radius * Math.sin(endAngle);

    if (Math.abs(Math.abs(delta) - Math.PI * 2) < 1e-9) {
      // 整圆：两段半弧
      const midAngle = startAngle + delta / 2;
      const midX = x + radius * Math.cos(midAngle);
      const midY = y + radius * Math.sin(midAngle);
      this.currentPath.push(
        `A ${n(radius)} ${n(radius)} 0 0 ${sweep} ${n(midX)} ${n(midY)}`,
        `A ${n(radius)} ${n(radius)} 0 0 ${sweep} ${n(endX)} ${n(endY)}`,
      );
      return;
    }

    const largeArc = Math.abs(delta) > Math.PI ? 1 : 0;
    this.currentPath.push(`A ${n(radius)} ${n(radius)} 0 ${largeArc} ${sweep} ${n(endX)} ${n(endY)}`);
  }

  // ---- 绘制 ----
  private applyStrokeAttributes(): string {
    const dash = this.state.dash.filter(v => v > 0);
    const dashAttr = dash.length > 0 ? ` stroke-dasharray="${dash.map(n).join(' ')}"` : '';
    return ` stroke="${colorToSvg(this.state.strokeStyle)}" stroke-width="${n(this.state.lineWidth)}"`
      + ` stroke-linecap="${this.state.lineCap}" stroke-linejoin="${this.state.lineJoin}"${dashAttr}`;
  }

  stroke(): void {
    if (this.currentPath.length === 0) return;
    this.parts.push(`<path d="${this.currentPath.join(' ')}" fill="none"${this.applyStrokeAttributes()}${this.matrixAttribute()}/>`);
  }

  fill(fillRule?: CanvasFillRule): void {
    if (this.currentPath.length === 0) return;
    const rule = fillRule === 'evenodd' ? ' fill-rule="evenodd"' : '';
    const fill = colorToSvg(this.state.fillStyle);
    // 图案填充（<pattern>）需要底色遮罩：Canvas 的 fill 不带描边，直接 fill 引用即可
    this.parts.push(`<path d="${this.currentPath.join(' ')}" fill="${fill}"${rule}${this.matrixAttribute()}/>`);
  }

  fillRect(x: number, y: number, width: number, height: number): void {
    const fill = colorToSvg(this.state.fillStyle);
    this.parts.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(width)}" height="${n(height)}" fill="${fill}"${this.matrixAttribute()}/>`);
  }

  strokeRect(x: number, y: number, width: number, height: number): void {
    this.parts.push(
      `<rect x="${n(x)}" y="${n(y)}" width="${n(width)}" height="${n(height)}" fill="none"${this.applyStrokeAttributes()}${this.matrixAttribute()}/>`,
    );
  }

  setLineDash(segments: number[]): void {
    this.state.dash = [...(segments || [])];
  }

  createPattern(image: CanvasImageSource, _repetition?: string | null): CanvasPattern | null {
    let dataUrl: string | null = null;
    const source = image as { toDataURL?: (type?: string) => string };
    if (typeof source.toDataURL === 'function') {
      try { dataUrl = source.toDataURL('image/png'); } catch { dataUrl = null; }
    }

    const id = `dxfviewer-pattern-${++this.patternCounter}`;
    const info: SvgPatternInfo = {
      id,
      dataUrl,
      fallbackColor: 'rgba(128,128,128,0.35)',
    };

    if (dataUrl) {
      // 10×10 图案平铺（渲染器图案源固定 10×10 斜线）
      const patternEl =
        `<pattern id="${id}" width="10" height="10" patternUnits="userSpaceOnUse">`
        + `<image href="${dataUrl}" x="0" y="0" width="10" height="10"/>`
        + `</pattern>`;
      this.parts.splice(2, 0, patternEl);
    }

    const token = { __svgPattern: info } as unknown as CanvasPattern;
    this.patternInfos.set(token, info);
    return token;
  }

  // ---- 文字 ----
  measureText(text: string): RenderTextMetrics {
    return measureTextHeuristic(text, this.state.font);
  }

  fillText(text: string, x: number, y: number, maxWidth?: number): void {
    const value = String(text ?? '');
    if (!value) return;

    const { size, family, weight, style } = parseFont(this.state.font);
    const anchor = ALIGN_TO_ANCHOR[this.state.textAlign] ?? 'start';
    const dominant = BASELINE_TO_DOMINANT[this.state.textBaseline] ?? 'alphabetic';

    const attrs = [
      `x="${n(x)}"`,
      `y="${n(y)}"`,
      `fill="${colorToSvg(this.state.fillStyle)}"`,
      `font-family="${escapeXml(family)}"`,
      `font-size="${n(size)}"`,
      weight ? `font-weight="${weight === 'bold' ? 'bold' : weight}"` : '',
      style ? `font-style="${style}"` : '',
      `text-anchor="${anchor}"`,
      `dominant-baseline="${dominant}"`,
      maxWidth !== undefined && Number.isFinite(maxWidth) && maxWidth > 0
        ? `textLength="${n(maxWidth)}" lengthAdjust="spacingAndGlyphs"`
        : '',
      this.matrixAttribute(),
    ].filter(Boolean).join(' ');

    this.parts.push(`<text ${attrs}>${escapeXml(value)}</text>`);
  }

  /** 串接最终 SVG 文档。 */
  toString(): string {
    return `${this.parts.join('\n')}\n</svg>\n`;
  }
}
