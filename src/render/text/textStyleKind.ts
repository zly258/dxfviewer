import type { DxfStyle } from '@/types';

/**
 * 样式用的是不是 TrueType。
 *
 * AutoCAD 对两类字体的「字高」不是同一件事：
 * - TTF：字高 = 大写字母高度，整段共用一个 em，汉字按字体自己的比例更高；
 * - SHX / 大字体：字高 = 字形格子高度，汉字是边长等于字高的方格，再乘宽度因子。
 */
export const isTrueTypeFontName = (name?: string): boolean => {
  const file = (name || '').replace(/^.*[\\/]/, '').trim().toLowerCase();
  if (!file) return false;
  if (/\.(shx|shp|shb)$/.test(file)) return false;
  if (/\.(ttf|otf|ttc)$/.test(file)) return true;
  const stem = file.replace(/\.[a-z0-9]+$/, '');
  return /^(arial|arialn|simsun|nsimsun|simfang|simhei|simkai|simli|tahoma|times|cour|isocp)$/.test(stem);
};

/** 形字体或带大字体：按 AutoCAD SHX 规则排，不能套仿宋轮廓。 */
export const isShxTextStyle = (style?: DxfStyle): boolean => {
  if (!style) return true;
  if ((style.bigFontFileName || '').trim()) return true;
  return !isTrueTypeFontName(style.fontFileName);
};
