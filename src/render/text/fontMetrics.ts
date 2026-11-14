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

const CJK_TEXT = /[\u2e80-\u9fff\uf900-\ufaff]/;

/**
 * 系统字体的 em 系数。画面不再画轮廓字体，所以不用轮廓度量。
 * 含中文时按中文字身（约 0.88em）换算，否则中文比字高大一截，
 * 多行文字会提前碰到列宽、行数明显变多。
 */
export const canvasFontScaleFactor = (text?: string): number => {
  const metrics = SYSTEM_FONT_METRICS;
  const ratio = text && CJK_TEXT.test(text) ? metrics.cjkHeightRatio : metrics.capHeightRatio;
  return 1 / ratio;
};

/** 与整段相同。系统字体一段一个字号。 */
export const canvasCharFontScaleFactor = (text?: string): number => canvasFontScaleFactor(text);
