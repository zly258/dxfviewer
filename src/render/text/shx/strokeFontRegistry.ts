/**
 * 描边字体注册表：DXF 字体名 → 单线描边字形。
 *
 * 三层来源（优先级从高到低）：
 * 1. 用户注册的真实 .shx 文件（registerShxFont，二进制解析见 shxParser）；
 * 2. 内置 Hershey 单线字体（公版数据，视觉上等价于 romans/simplex/txt 等
 *    AutoCAD 形字体的单线风格，覆盖 ASCII）；
 * 3. 未命中 → 返回 undefined，调用方回退到系统字体图集路径（文字仍可读）。
 *
 * 这是修复「SHX 字体渲染不对」的核心：旧实现对所有 SHX 样式直接套用仿宋等
 * 系统字体，宽度、字重与 CAD 单线字形完全不符；现在 ASCII 走真实描边字形，
 * 中文（bigfont 字符）单独走系统字体图集，混排结果与 AutoCAD 一致。
 */

import { hersheySimplex } from './data/hersheySimplex';
import type { StrokeFontData, StrokeGlyph } from './shxParser';

export type StrokeFont = StrokeFontData;

/** 内置 Hershey 字体缓存（懒构建）。 */
let builtinFont: StrokeFont | null = null;

const buildBuiltinFont = (): StrokeFont => {
  const glyphs = new Map<number, StrokeGlyph>();
  for (const [ch, g] of Object.entries(hersheySimplex)) {
    const code = ch.charCodeAt(0);
    if (glyphs.has(code)) continue;
    glyphs.set(code, { advance: g.a, strokes: g.s });
  }
  return {
    glyphs,
    capHeight: 1,
    descender: 0.33,
    isBigFont: false,
  };
};

export const getBuiltinStrokeFont = (): StrokeFont => {
  if (!builtinFont) builtinFont = buildBuiltinFont();
  return builtinFont;
};

/** 用户注册的真实 .shx 字体（文件名小写、无路径、无扩展名 → 字体数据）。 */
const registeredFonts = new Map<string, StrokeFont>();

/** 直接登记已解析的字体数据（解析见 shxParser.parseShxFont）。 */
export const registerParsedShxFont = (fileName: string, font: StrokeFontData): void => {
  registeredFonts.set(normalizeFontName(fileName), font);
};

/** 规范化 DXF 字体文件名：去路径、去扩展名、小写。 */
export const normalizeFontName = (name?: string): string =>
  (name || '')
    .replace(/^.*[\\/]/, '')
    .replace(/\.(shx|shp|shb)$/i, '')
    .trim()
    .toLowerCase();

/**
 * 内置字体可覆盖的常见工程形字体名单。
 * gbcbig 等 CJK 大字体不在列——它们需要真实的 CJK 字形，走系统字体图集。
 */
const BUILTIN_FONT_NAMES = new Set([
  'txt', 'txt1', 'simplex', 'simplex1', 'simplex2', 'romans', 'romans1', 'romans2',
  'roman', 'romant', 'gbenor', 'gbeno', 'gbeite', 'monotxt', 'monotxt1', 'monos',
  'complex', 'greeks', 'sanss', 'sansb', 'iso3098', 'iso30985', 'isoct', 'isoct30985',
  'gbtxt', 'wcadeng', 'tssdeng', 'hztxt', 'hztxt1', 'hztxt2', 'hzfs', 'hzst',
]);

/** 提示斜体（单线斜体族）的字体名片段。 */
const ITALIC_HINTS = ['italic', 'rombit', 'gmtk', 'gbeite', 'simplex-italic'];

export interface StrokeFontResolution {
  font: StrokeFont;
  /** 字体名暗示斜体时给定的默认斜切角（度）。 */
  obliqueAngle: number | undefined;
}

/**
 * 解析文字样式对应的描边字体。
 * @returns undefined 表示该样式没有可用的描边字形（调用方走系统字体图集）。
 */
export const resolveStrokeFont = (
  fontFileName?: string,
  bigFontFileName?: string,
  /**
   * 是否允许回落到内置 Hershey 单线字体。
   * 交互渲染默认 false：内置字体只有 ASCII 字形，与中文系统字体混排时
   * 字重与步进都不一致（实测同一行出现空隙/重叠的"完全不对"观感）。
   * 只有宿主显式注册了真实 .shx 时才走描边路径。
   */
  allowBuiltin = false,
): StrokeFontResolution | undefined => {
  const primary = normalizeFontName(fontFileName);
  const bigFont = normalizeFontName(bigFontFileName);
  if (!primary && !bigFont) return undefined;

  // 1. 用户注册的真实字体（主字体优先，其次 bigfont）。
  const registered = (primary && registeredFonts.get(primary)) || (bigFont && registeredFonts.get(bigFont));
  if (registered) return { font: registered, obliqueAngle: undefined };
  if (!allowBuiltin) return undefined;

  // 2. 内置单线字体（含 CJK 大字体名映射：工程图 hztxt 等的 ASCII 部分与
  //    simplex 同风格，CJK 字符仍回退图集，因此整样式按内置字体处理）。
  const candidate = primary || bigFont;
  if (!candidate) return undefined;
  const stem = candidate.replace(/\d+$/, '');
  if (BUILTIN_FONT_NAMES.has(candidate) || BUILTIN_FONT_NAMES.has(stem)) {
    const italic = ITALIC_HINTS.some(hint => candidate.includes(hint));
    return {
      font: getBuiltinStrokeFont(),
      obliqueAngle: italic ? 15 : undefined,
    };
  }
  return undefined;
};

/** 清空用户注册字体（切换图纸 / 测试用）。 */
export const clearRegisteredShxFonts = (): void => {
  registeredFonts.clear();
};

