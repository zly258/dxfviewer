/**
 * 无字体引擎环境下的文字度量启发式（SVG / PDF 矢量后端共用）。
 *
 * 背景：交互与 PNG 用 Canvas measureText；矢量导出后端没有 Canvas 可用时
 * （或代价过高）需要纯函数度量。CJK≈1em、ASCII≈0.55em 的启发式与多数
 * 系统字体的实测宽度偏差在几个百分点内，只影响换行/对齐的细小位置，
 * 不影响几何。SVG 端文字由查看器渲染、PDF 端文字由浏览器光栅化，
 * 字形本身不受该启发式影响。
 */
import type { RenderTextMetrics } from '@/renderer/context';

export interface ParsedFont {
  size: number;
  family: string;
  weight?: string;
  style?: string;
}

export const isFullWidthChar = (code: number): boolean =>
  (code >= 0x1100 && code <= 0x115f)      // Hangul Jamo
  || (code >= 0x2e80 && code <= 0xa4cf)   // CJK 部首～Yi
  || (code >= 0xac00 && code <= 0xd7a3)   // Hangul 音节
  || (code >= 0xf900 && code <= 0xfaff)   // CJK 兼容表意
  || (code >= 0xfe30 && code <= 0xfe4f)   // CJK 兼容形式
  || (code >= 0xff00 && code <= 0xff60)   // 全角形式
  || (code >= 0xffe0 && code <= 0xffe6)
  || (code >= 0x20000 && code <= 0x3fffd);

export const parseFont = (font: string): ParsedFont => {
  let rest = (font || '').trim() || '10px sans-serif';
  let style: string | undefined;
  let weight: string | undefined;

  const italic = /^(italic|oblique)\s+/.exec(rest);
  if (italic) { style = italic[1]; rest = rest.slice(italic[0].length); }

  const weightMatch = /^(bold|[1-9]00)\s+/.exec(rest);
  if (weightMatch) { weight = weightMatch[1]; rest = rest.slice(weightMatch[0].length); }

  const sizeMatch = /^([\d.]+)(px|pt|em)\s+(.*)$/.exec(rest);
  if (!sizeMatch) return { size: 10, family: rest || 'sans-serif', weight, style };

  let size = Number.parseFloat(sizeMatch[1]);
  if (sizeMatch[2] === 'pt') size *= 96 / 72;
  if (sizeMatch[2] === 'em') size *= 16;
  return { size, family: sizeMatch[3].trim() || 'sans-serif', weight, style };
};

export const measureTextHeuristic = (text: string, font: string): RenderTextMetrics => {
  const { size } = parseFont(font);
  let width = 0;
  for (const character of Array.from(text)) {
    const code = character.codePointAt(0) ?? 0;
    width += isFullWidthChar(code) ? size : size * 0.55;
  }
  return {
    width,
    actualBoundingBoxLeft: 0,
    actualBoundingBoxRight: width,
    actualBoundingBoxAscent: size * 0.8,
    actualBoundingBoxDescent: size * 0.2,
    fontBoundingBoxAscent: size,
    fontBoundingBoxDescent: size * 0.25,
  };
};
