/**
 * 字体度量共享模块。
 *
 * 背景：双引擎此前各自用自己的度量换算「CAD 字高 ↔ 屏幕字号」：
 * - Canvas 引擎：系统字体 + **固定**系数（拉丁 1.39 / 中文 1.14 em→capHeight）
 * - 轮廓字体：真实 capHeight / 中文墨迹高
 *
 * 两套来源不同 → 同一字高下两引擎的字高/字宽/基线都不一致（实测拉丁偏小 7%），
 * 用户看到的现象是「两个引擎大小、宽度、高度、对齐总有些对不上」。
 *
 * 本模块把度量集中到一处：
 * - 轮廓字体可用时（宿主提供了 /fonts/*.ttf）→ 用**真实**度量，两个引擎一致；
 * - 轮廓字体不可用 → 退回系统字体的估算系数（保持离线可用）。
 *
 * 关键换算：CAD 字高是「大写字高 / 中文字身」语义，Canvas 的 font-size 是
 * em 尺寸，因此 em = 字高 / 度量高度。
 */

import { TEXT_RENDER_CONFIG } from '@/config/viewerConfig';

/** 一套字体的度量数据（单位：字体单位 / em 比例）。 */
export interface FontMetrics {
  /** 大写字母墨迹高（em 比例，如 0.668）。用于拉丁字符的字高换算。 */
  capHeightRatio: number;
  /** 中文字形墨迹高（em 比例，如 0.873）。用于中文字符的字高换算。 */
  cjkHeightRatio: number;
  /** 该度量是否来自真实轮廓字体（true 时两引擎可完全一致）。 */
  fromOutlineFont: boolean;
}

/** 系统字体的估算度量（轮廓字体不可用时的兜底）。 */
export const SYSTEM_FONT_METRICS: FontMetrics = {
  // 系统字体（FangSong/Arial 等）的大写高度约 0.70~0.73em。
  capHeightRatio: 1 / TEXT_RENDER_CONFIG.trueTypeFontHeightFactor,
  // 中文字形墨迹约 0.88em。
  cjkHeightRatio: 1 / TEXT_RENDER_CONFIG.cjkFontHeightFactor,
  fromOutlineFont: false,
};

let currentMetrics: FontMetrics = SYSTEM_FONT_METRICS;

/**
 * 当前生效的度量（轮廓字体加载后自动切换）。 */
export const getFontMetrics = (): FontMetrics => currentMetrics;

/** 设置度量（由轮廓字体加载模块在字体就绪时调用）。 */
export const setFontMetrics = (metrics: FontMetrics): void => {
  currentMetrics = metrics;
};

/** 复位为系统字体度量。 */
export const resetFontMetrics = (): void => {
  currentMetrics = SYSTEM_FONT_METRICS;
};

/**
 * 与轮廓字体同名的 CSS font-family 别名。
 *
 * 轮廓字体（simfang.ttf）注册到浏览器后（见 registerOutlineFontFace），
 * Canvas 引擎直接用这个家族名即可渲染**完全相同的字形**，
 * 字高/字宽/基线与轮廓排版一致。
 */
export const OUTLINE_FONT_FAMILY = 'DxfViewerOutlineFont';

/**
 * 轮廓字体是否已注册到浏览器（Canvas 引擎能否直接使用同一字体文件）。
 */
export const isOutlineFontAvailable = (): boolean => {
  if (typeof document === 'undefined' || !document.fonts) return false;
  try {
    return document.fonts.check(`1em "${OUTLINE_FONT_FAMILY}"`);
  } catch {
    return false;
  }
};

/**
 * TrueType 的 em 换算：字高 = 大写字高，整段同一个比例。
 * 汉字不再单独拉到字高，否则和 AutoCAD 的 TTF 排版不一致。
 */
export const charHeightRatio = (): number => currentMetrics.capHeightRatio;

/** ctx.font 里的 px 写 CAD 字高。逐字符的 em 换算在 canvasCharFontScaleFactor 里做。 */
export const canvasFontScaleFactor = (): number => 1;

/**
 * 各系统字体的真实「大写高度 / em」比例（实测，100px 下 measureText 的
 * actualBoundingBoxAscent）。差别很大：仿宋 0.67、宋体 0.68、雅黑/无衬线 0.76。
 * 若统一用一个系数，同字高的英文在仿宋里就明显比雅黑小 —— 这正是
 * 「部分偏大、部分偏小」的来源。这里按实际字体族归一。
 */
const LATIN_CAP_RATIO_BY_FAMILY: Array<[RegExp, number]> = [
  [/fangsong|仿宋|stfangsong/i, 0.67],
  [/simsun|宋体|stsong/i, 0.68],
  [/yahei|雅黑|simhei|黑体/i, 0.76],
  [/arial|helvetica|inter|roboto|segoe/i, 0.72],
];

const detectLatinCapRatio = (font: string): number => {
  for (const [re, ratio] of LATIN_CAP_RATIO_BY_FAMILY) {
    if (re.test(font)) return ratio;
  }
  return 0.76; // 无衬线兜底
};

/**
 * 汉字墨迹高度（em 比例）兜底值。汉字按 `em = 字高` 绘制，因此墨迹高
 * ≈ 1/cjkFontHeightFactor ≈ 0.877em。
 */
const CJK_INK_HEIGHT_RATIO = 1 / TEXT_RENDER_CONFIG.cjkFontHeightFactor;

const FONT_SIZE_RE = /(-?\d+(?:\.\d+)?)px/;

/** 探测用画布：实测「某字体族真正会渲染成什么比例」。 */
let probeCtx: CanvasRenderingContext2D | null | undefined;
const getProbeCtx = (): CanvasRenderingContext2D | null => {
  if (probeCtx === undefined) {
    try {
      probeCtx = typeof document !== 'undefined'
        ? document.createElement('canvas').getContext('2d')
        : null;
    } catch {
      probeCtx = null;
    }
  }
  return probeCtx;
};

interface InkRatios { cap: number; cjk: number }
const ratioCache = new Map<string, InkRatios>();

/**
 * 实测字体族的墨迹比例（相对于 em）。
 *
 * **不能用硬编码表**：字体栈（如 `FangSong, 仿宋, serif`）在本机没装第一个字体时
 * 会回退到别的字体，实际 cap 比例与表里写的完全不同，英文就会被放大过头
 * （用户实测「英文、数字比中文大很多」）。
 *
 * - cap：'H' 的墨迹高度 / em（西文大写语义）
 * - cjk：'国' 的墨迹高度 / em（中文语义，含上下墨迹）
 */
const measureInkRatios = (font: string): InkRatios => {
  const probeFont = font.replace(FONT_SIZE_RE, '100px');
  const cached = ratioCache.get(probeFont);
  if (cached) return cached;

  let cap = 0;
  let cjk = 0;
  const ctx = getProbeCtx();
  if (ctx) {
    const previous = ctx.font;
    try {
      ctx.font = probeFont;
      const latin = ctx.measureText('H');
      cap = (latin.actualBoundingBoxAscent || 0) / 100;
      const han = ctx.measureText('国');
      cjk = ((han.actualBoundingBoxAscent || 0) + (han.actualBoundingBoxDescent || 0)) / 100;
    } catch {
      cap = 0;
      cjk = 0;
    }
    try { ctx.font = previous; } catch { /* ignore */ }
  }

  // 极端/非法值兜底（无 DOM、字体未就绪、测出 0 等）。
  if (!(cap > 0.35 && cap < 1.2)) cap = detectLatinCapRatio(font);
  if (!(cjk > 0.5 && cjk < 1.5)) cjk = CJK_INK_HEIGHT_RATIO;

  const ratios: InkRatios = { cap, cjk };
  if (ratioCache.size > 256) ratioCache.clear();
  ratioCache.set(probeFont, ratios);
  return ratios;
};

const CJK_CHAR = /[\u2e80-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/;

/**
 * 单个字符的 em / 字高。
 *
 * 统一「墨迹高度 = 标称字高」：
 * - 汉字：中文字形墨迹高 = 字高；
 * - 英文数字：大写字母高 = 字高（AutoCAD 的 text height 即大写高度语义）。
 *
 * 这样同一字高下中英文、不同字体的**大小一致**（用户要求：大小要合理）。
 */
export interface CharMetrics {
  /** 字号倍率：font px = CAD 字高 × pxScale，使墨迹高度 = CAD 字高。 */
  pxScale: number;
  /** 横向倍率：让横向尺寸与 AutoCAD 一致（中文按字身宽、西文不额外压缩）。 */
  xScale: number;
}

/**
 * 单个字符的字号/横向倍率（AutoCAD 语义）。
 *
 * 目标：**墨迹高度 = 标称字高**，且**横向尺寸 = 字高 × 宽度因子**。
 * - 汉字：TTF 汉字 em 宽 = 1em、墨迹高 ≈ cjkInkRatio×em。取 em = 字高 / cjkInkRatio
 *   使墨迹高 = 字高；再乘 xScale = cjkInkRatio 使横向 = em×cjkInkRatio = 字高。
 *   → 汉字格子是「字高 × 字高」，与 AutoCAD 的 SHX/中文大字体一致。
 * - 西文：em = 字高 / capRatio 使大写高 = 字高，横向不额外压缩（×1）。
 */
export const canvasCharMetrics = (ch?: string, font?: string): CharMetrics => {
  const { cap, cjk } = measureInkRatios(font || '');
  if (ch && CJK_CHAR.test(ch)) return { pxScale: 1 / cjk, xScale: cjk };
  return { pxScale: 1 / cap, xScale: 1 };
};

export const canvasCharFontScaleFactor = (ch?: string, font?: string): number =>
  canvasCharMetrics(ch, font).pxScale;
