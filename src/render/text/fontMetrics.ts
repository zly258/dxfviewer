/**
 * 字体度量共享模块。
 *
 * 背景：双引擎此前各自用自己的度量换算「CAD 字高 ↔ 屏幕字号」：
 * - Canvas 引擎：系统字体 + **固定**系数（拉丁 1.39 / 中文 1.14 em→capHeight）
 * - WebGL 引擎：轮廓字体（simfang.ttf）的**真实**capHeight / 中文墨迹高
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
 * 字高/字宽/基线与 WebGL 轮廓排版逐像素一致。
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

const CJK_CHAR = /[\u2e80-\u9fff\uf900-\ufaff]/;

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

/** 汉字墨迹高度目标（各系统字体约 0.90~0.92em，取 0.91 作为统一目标）。 */
const CJK_INK_TARGET = 0.91;

const detectLatinCapRatio = (font: string): number => {
  for (const [re, ratio] of LATIN_CAP_RATIO_BY_FAMILY) {
    if (re.test(font)) return ratio;
  }
  return 0.76; // 无衬线兜底
};

/**
 * 单个字符的 em / 字高。
 * - 汉字：字号 = 字高（字宽≈字号，乘宽度因子后等于格子宽，不撑破表格列宽）。
 * - 英文数字：按当前字体族的真实大写比例放大，使墨迹高度与汉字一致（≈0.91em），
 *   从而同一字高下中英文、不同字体之间视觉高度统一。
 */
export const canvasCharFontScaleFactor = (ch?: string, font?: string): number => {
  if (ch && CJK_CHAR.test(ch)) return 1;
  return CJK_INK_TARGET / detectLatinCapRatio(font || '');
};
