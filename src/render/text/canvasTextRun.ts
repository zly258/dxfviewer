/**
 * Canvas 文字的测量与绘制。
 *
 * 轮廓字体已注册时，字号按字符分别换算（全角用中文字身、其余用西文大写字高），
 * 与 WebGL 轮廓排版 `charScale` 同一规则：中英混排时每个字符的墨迹高都等于
 * CAD 字高，而不是整段共用一个 em。
 *
 * 此时 `ctx.font` 里的 px 是 **CAD 字高**（不是 em）。系统字体回退时 px 仍是
 * em，走浏览器原生 measureText / fillText。
 */

import type { VectorContext } from '@/render/vector/context';
import { canvasCharFontScaleFactor, OUTLINE_FONT_FAMILY, getFontMetrics } from './fontMetrics';

const FONT_SIZE_RE = /(-?\d+(?:\.\d+)?)px/;

export const isOutlineFontRun = (font: string): boolean =>
  getFontMetrics().fromOutlineFont && font.includes(OUTLINE_FONT_FAMILY);

const fontWithSize = (font: string, px: number): string =>
  font.replace(FONT_SIZE_RE, `${px}px`);

const readFontPx = (font: string): number => {
  const match = font.match(FONT_SIZE_RE);
  return match ? Number(match[1]) : 0;
};

const measureNative = (ctx: VectorContext, value: string): number => {
  const metrics = ctx.measureText(value);
  const bbox = Math.abs((metrics.actualBoundingBoxRight || 0) - (metrics.actualBoundingBoxLeft || 0));
  return Math.max(metrics.width || 0, bbox || 0);
};

/**
 * 把文字切成「同一字号」的连续段。
 * 全角一段、西文一段，而不是每个字都改一次 ctx.font。
 * 中文说明通常整段同字号，测量和绘制都从 O(字符) 次字体切换降到 O(段)。
 */
const splitScaledRuns = (value: string, cadPx: number): Array<{ text: string; px: number }> => {
  const runs: Array<{ text: string; px: number }> = [];
  let text = '';
  let px = 0;
  let key = 0;
  for (const ch of Array.from(value)) {
    const nextPx = Math.max(0.1, cadPx * canvasCharFontScaleFactor(ch));
    const nextKey = Math.round(nextPx * 100);
    if (!text || nextKey !== key) {
      if (text) runs.push({ text, px });
      text = ch;
      px = nextPx;
      key = nextKey;
    } else {
      text += ch;
    }
  }
  if (text) runs.push({ text, px });
  return runs;
};

/**
 * 字形相对 alphabetic 基线的上下延伸。
 * 轮廓字体按逐字符字号测量，不再把 ascent+descent 归一成字高
 * （那会把没有下行部分的文字也撑出一块假的下沉）。
 */
export const measureCadTextVertical = (
  ctx: VectorContext,
  value: string,
): { ascent: number; descent: number } | null => {
  if (!isOutlineFontRun(ctx.font)) return null;
  const cadPx = readFontPx(ctx.font);
  if (!(cadPx > 0)) return null;

  const original = ctx.font;
  let ascent = 0;
  let descent = 0;
  for (const run of splitScaledRuns(value || 'Mg', cadPx)) {
    ctx.font = fontWithSize(original, run.px);
    const metrics = ctx.measureText(run.text);
    ascent = Math.max(ascent, metrics.actualBoundingBoxAscent || 0);
    descent = Math.max(descent, metrics.actualBoundingBoxDescent || 0);
  }
  ctx.font = original;
  if (ascent + descent <= 0) return null;
  return { ascent, descent };
};

/** 与当前 ctx.font 一致的文字宽度（轮廓字体为逐字符宽度之和）。 */
export const measureCadTextRun = (ctx: VectorContext, value: string): number => {
  if (!value) return 0;
  if (!isOutlineFontRun(ctx.font)) return measureNative(ctx, value);

  const cadPx = readFontPx(ctx.font);
  if (!(cadPx > 0)) return measureNative(ctx, value);

  const original = ctx.font;
  let width = 0;
  for (const run of splitScaledRuns(value, cadPx)) {
    ctx.font = fontWithSize(original, run.px);
    width += ctx.measureText(run.text).width || 0;
  }
  ctx.font = original;
  return width;
};

/**
 * 按当前文字对齐方式的起点绘制（调用方已把对齐折算成左起点）。
 * `y` 是 alphabetic 基线。
 */
export const fillCadTextRun = (ctx: VectorContext, value: string, x: number, y: number): void => {
  if (!value) return;
  if (!isOutlineFontRun(ctx.font)) {
    ctx.fillText(value, x, y);
    return;
  }

  const cadPx = readFontPx(ctx.font);
  if (!(cadPx > 0)) {
    ctx.fillText(value, x, y);
    return;
  }

  const original = ctx.font;
  let cursor = x;
  for (const run of splitScaledRuns(value, cadPx)) {
    ctx.font = fontWithSize(original, run.px);
    ctx.fillText(run.text, cursor, y);
    cursor += ctx.measureText(run.text).width || 0;
  }
  ctx.font = original;
};
