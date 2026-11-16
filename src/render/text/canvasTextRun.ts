import type { VectorContext } from '@/render/vector/context';
import { canvasCharMetrics } from './fontMetrics';
import { TEXT_RENDER_CONFIG } from '@/config/viewerConfig';
import { getSimplexGlyph, hasSimplexGlyph, SIMPLEX_CAP_HEIGHT } from './simplexFont';

/**
 * Canvas 文字的测量与绘制。
 *
 * `ctx.font` 里的 px 是 CAD 字高。绘制时按字符换算 em：
 * - 汉字：em 让中文墨迹高 = 标称字高；
 * - 英文数字：同一 em（TTF 路径）或**单线笔画字库**（SHX 样式）。
 *
 * 单线笔画：AutoCAD 的 SHX（simplex.shx / wcad.shx 等）是单线体，笔画中心线按线宽
 * 描边。这里内置 Hershey Simplex（公有领域）在 SHX 样式下绘制 ASCII，字形与
 * AutoCAD 一致（大写高度 = 字高），而不是系统 TTF 的填充字。
 */

const FONT_SIZE_RE = /(-?\d+(?:\.\d+)?)px/;

const fontWithSize = (font: string, px: number): string => font.replace(FONT_SIZE_RE, `${px}px`);

const readFontPx = (font: string): number => {
  const match = font.match(FONT_SIZE_RE);
  return match ? Number(match[1]) : 0;
};

const CJK_CHAR = /[\u2e80-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/;

export interface CadTextRunOptions {
  /** 横向压缩系数（1 = 不压缩；默认 0.86）。 */
  cjkXScale?: number;
  /** ASCII 是否用单线笔画字库（SHX 样式）。 */
  strokeAscii?: boolean;
}

/** 当前实体的横向压缩系数（按实体设置，绘制/测量期间生效）。 */
let currentCjkXScale = TEXT_RENDER_CONFIG.textCondenseX;
export const setCjkXScale = (value: number): number => {
  const previous = currentCjkXScale;
  currentCjkXScale = Number.isFinite(value) && value > 0 ? value : 1;
  return previous;
};
export const getCjkXScale = (): number => currentCjkXScale;

/** 当前实体是否用单线字库绘制 ASCII（SHX 样式）。 */
let currentStrokeAscii = false;
export const setStrokeAscii = (value: boolean): boolean => {
  const previous = currentStrokeAscii;
  currentStrokeAscii = value;
  return previous;
};
export const getStrokeAscii = (): boolean => currentStrokeAscii;

const measureNative = (ctx: VectorContext, value: string): number => {
  const metrics = ctx.measureText(value);
  const bbox = Math.abs((metrics.actualBoundingBoxRight || 0) - (metrics.actualBoundingBoxLeft || 0));
  return Math.max(metrics.width || 0, bbox || 0);
};

interface ScaledRun {
  text: string;
  px: number;
  xScale: number;
  stroke: boolean;
}

/**
 * 把文字切成「同一渲染方式 + 同一字号 + 同一横向压缩」的连续段。
 */
const splitScaledRuns = (
  value: string,
  cadPx: number,
  font: string,
  cjkXScale: number,
  strokeAscii: boolean,
): ScaledRun[] => {
  const runs: ScaledRun[] = [];
  let text = '';
  let px = 0;
  let xScale = 1;
  let stroke = false;
  let key = '';
  const baseXScale = cjkXScale > 0 ? cjkXScale : currentCjkXScale;
  for (const ch of Array.from(value)) {
    const isCjk = CJK_CHAR.test(ch);
    const useStroke = strokeAscii && !isCjk && hasSimplexGlyph(ch);
    const metrics = useStroke ? null : canvasCharMetrics(ch, font);
    const nextPx = useStroke ? cadPx : Math.max(0.1, cadPx * (metrics as { pxScale: number }).pxScale);
    const nextScale = (useStroke ? TEXT_RENDER_CONFIG.strokeFontAspect : (metrics as { xScale: number }).xScale) * baseXScale;
    const nextKey = `${useStroke ? 's' : 'f'}:${Math.round(nextPx * 100)}:${Math.round(nextScale * 100)}`;
    if (!text || nextKey !== key) {
      if (text) runs.push({ text, px, xScale, stroke });
      text = ch;
      px = nextPx;
      xScale = nextScale;
      stroke = useStroke;
      key = nextKey;
    } else {
      text += ch;
    }
  }
  if (text) runs.push({ text, px, xScale, stroke });
  return runs;
};

/** 单线字库的缩放：大写高度 21 单位 → CAD 字高（AutoCAD SHX 语义：cap = 字高）。 */
const strokeScale = (px: number): number => px / SIMPLEX_CAP_HEIGHT;

const measureStrokeRun = (run: ScaledRun): number => {
  let width = 0;
  for (const ch of Array.from(run.text)) {
    const glyph = getSimplexGlyph(ch.codePointAt(0) ?? -1);
    width += (glyph ? glyph.advance : SIMPLEX_CAP_HEIGHT * 0.5) * strokeScale(run.px);
  }
  return width * run.xScale;
};

/**
 * 字形相对 alphabetic 基线的上下延伸。
 */
export const measureCadTextVertical = (
  ctx: VectorContext,
  value: string,
  options?: CadTextRunOptions,
): { ascent: number; descent: number } | null => {
  const cadPx = readFontPx(ctx.font);
  if (!(cadPx > 0)) return null;

  const original = ctx.font;
  let ascent = 0;
  let descent = 0;
  for (const run of splitScaledRuns(value || 'Mg', cadPx, original, options?.cjkXScale ?? currentCjkXScale, options?.strokeAscii ?? currentStrokeAscii)) {
    if (run.stroke) {
      // 单线字库：基线 y=0，大写高 21，下伸最多 ~7 单位（g/j/p/q/y 等）。
      const scale = strokeScale(run.px);
      ascent = Math.max(ascent, SIMPLEX_CAP_HEIGHT * scale);
      descent = Math.max(descent, 7 * scale);
      continue;
    }
    ctx.font = fontWithSize(original, run.px);
    const metrics = ctx.measureText(run.text);
    ascent = Math.max(ascent, metrics.actualBoundingBoxAscent || 0);
    descent = Math.max(descent, metrics.actualBoundingBoxDescent || 0);
  }
  ctx.font = original;
  if (ascent + descent <= 0) return null;
  return { ascent, descent };
};

/** 与当前 ctx.font 一致的文字宽度（含横向压缩与单线字库）。 */
export const measureCadTextRun = (
  ctx: VectorContext,
  value: string,
  options?: CadTextRunOptions,
): number => {
  if (!value) return 0;
  const cadPx = readFontPx(ctx.font);
  if (!(cadPx > 0)) return measureNative(ctx, value);

  const original = ctx.font;
  let width = 0;
  for (const run of splitScaledRuns(value, cadPx, original, options?.cjkXScale ?? currentCjkXScale, options?.strokeAscii ?? currentStrokeAscii)) {
    if (run.stroke) {
      width += measureStrokeRun(run);
      continue;
    }
    ctx.font = fontWithSize(original, run.px);
    width += (ctx.measureText(run.text).width || 0) * run.xScale;
  }
  ctx.font = original;
  return width;
};

/**
 * 按当前文字对齐方式的起点绘制（调用方已把对齐折算成左起点）。
 * `y` 是 alphabetic 基线。宽度与 measureCadTextRun 完全一致。
 */
export const fillCadTextRun = (
  ctx: VectorContext,
  value: string,
  x: number,
  y: number,
  options?: CadTextRunOptions,
): void => {
  if (!value) return;
  const cadPx = readFontPx(ctx.font);
  if (!(cadPx > 0)) {
    ctx.fillText(value, x, y);
    return;
  }

  const original = ctx.font;
  const previousStroke = ctx.strokeStyle;
  const previousWidth = ctx.lineWidth;
  const previousCap = ctx.lineCap;
  const previousJoin = ctx.lineJoin;
  let cursor = x;
  for (const run of splitScaledRuns(value, cadPx, original, options?.cjkXScale ?? currentCjkXScale, options?.strokeAscii ?? currentStrokeAscii)) {
    if (run.stroke) {
      const scale = strokeScale(run.px);
      ctx.save();
      ctx.translate(cursor, y);
      if (run.xScale !== 1) ctx.scale(run.xScale, 1);
      ctx.strokeStyle = ctx.fillStyle as string;
      ctx.lineWidth = Math.max(0.35, cadPx * TEXT_RENDER_CONFIG.strokeFontLineWidthFactor);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (const ch of Array.from(run.text)) {
        const glyph = getSimplexGlyph(ch.codePointAt(0) ?? -1);
        const advance = (glyph ? glyph.advance : SIMPLEX_CAP_HEIGHT * 0.5) * scale;
        if (glyph) {
          for (const path of glyph.paths) {
            for (let i = 0; i < path.length; i += 2) {
              const px = path[i] * scale;
              const py = -path[i + 1] * scale;
              if (i === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            }
          }
        }
        ctx.translate(advance, 0);
      }
      ctx.stroke();
      ctx.restore();
      cursor += measureStrokeRun(run);
      continue;
    }
    ctx.font = fontWithSize(original, run.px);
    const width = (ctx.measureText(run.text).width || 0) * run.xScale;
    if (run.xScale !== 1) {
      ctx.save();
      ctx.translate(cursor, y);
      ctx.scale(run.xScale, 1);
      ctx.fillText(run.text, 0, 0);
      ctx.restore();
    } else {
      ctx.fillText(run.text, cursor, y);
    }
    cursor += width;
  }
  ctx.font = original;
  ctx.strokeStyle = previousStroke;
  ctx.lineWidth = previousWidth;
  ctx.lineCap = previousCap;
  ctx.lineJoin = previousJoin;
};
