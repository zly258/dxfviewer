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
 * 某字符的字高度量分母（em 比例）。
 *
 * 全角字符按中文字身度量，其余按西文大写字高度量 —— 与 WebGL 轮廓排版
 * 规则一致（见 outlineText.ts 的 isFullWidthChar/charScale）。
 */
export const charHeightRatio = (char: string): number => {
  const code = char.codePointAt(0) ?? 0;
  const isFullWidth =
    (code >= 0x2e80 && code <= 0x9fff) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6);
  const metrics = currentMetrics;
  return isFullWidth ? metrics.cjkHeightRatio : metrics.capHeightRatio;
};

/**
 * 一段文字的 Canvas font-size（CSS px）换算系数：em = 字高 / 度量高度。
 *
 * 与轮廓排版保持同一规则：**逐字符**取值 —— 中英混排时英文不会被
 * 中文的 em 盒放大（这是此前 WebGL 与 Canvas 最大的观感差异来源）。
 */
export const canvasFontScaleFactor = (text: string): number => {
  const chars = Array.from(text);
  if (chars.length === 0) return 1 / currentMetrics.capHeightRatio;
  // 整段同族（全是中文或全是西文）→ 用该族的度量比例；
  // 混排 → 逐字符换算，等价于「每个字符按自己的度量对齐到同一字高」。
  let sum = 0;
  for (const ch of chars) sum += 1 / charHeightRatio(ch);
  return sum / chars.length;
};

/**
 * 单个字符的 Canvas font-size 比例（em = 字高 / 该字符的度量高度）。
 */
export const canvasCharFontScaleFactor = (char: string): number => 1 / charHeightRatio(char);
