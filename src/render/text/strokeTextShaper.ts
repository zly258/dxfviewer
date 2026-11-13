/**
 * 描边文字整形器：字符串 → 定位折线（描边字体路径）。
 *
 * 输出坐标：文字局部空间——原点在插入点（基线左端），Y 向上，
 * 单位 = 模型单位（height 即大写字高）。由调用方再套旋转/对齐变换。
 *
 * 与 AutoCAD 语义一致：
 * - height 为大写字高（cap height），字形按 capHeight 归一化的描边字体直接缩放；
 * - widthFactor 作用于 X（窄体/宽体）；
 * - oblique 为斜切角（度），X 位移 = y * tan(oblique)；
 * - 中文等 bigfont 字符（>127 或描边字体缺字形）产出 cjk 项，由调用方
 *   走系统字体图集渲染（AutoCAD 中 bigfont 本就是独立字体文件）。
 */

import type { StrokeFont } from './shx/strokeFontRegistry';

export interface StrokeShaperOptions {
  height: number;
  widthFactor: number;
  oblique: number;
}

export type ShapedItem =
  | { kind: 'strokes'; strokes: number[][]; x: number; advance: number }
  | { kind: 'cjk'; char: string; x: number; advance: number; height: number };

export interface StrokeShapingResult {
  items: ShapedItem[];
  /** 总宽度（模型单位，含 cjk 字符） */
  advance: number;
  hasCjk: boolean;
}

const isCjkChar = (ch: string): boolean => {
  const code = ch.codePointAt(0) ?? 0;
  return code > 0x7F;
};

/** 估算 CJK 字符宽（无真实字形时的近似：全角 = 1 倍字高）。 */
export const estimateCjkAdvance = (height: number): number => height;

export const shapeStrokeText = (
  text: string,
  font: StrokeFont,
  options: StrokeShaperOptions,
): StrokeShapingResult => {
  const { height, widthFactor, oblique } = options;
  const shear = Math.tan((oblique * Math.PI) / 180);
  const scaleX = widthFactor;
  const capScale = height / (font.capHeight || 1);

  const items: ShapedItem[] = [];
  let x = 0;
  let hasCjk = false;

  let pendingStrokes: number[][] | null = null;
  let pendingStart = 0;

  const flushPending = () => {
    if (pendingStrokes && pendingStrokes.length) {
      items.push({ kind: 'strokes', strokes: pendingStrokes, x: pendingStart, advance: x - pendingStart });
    }
    pendingStrokes = null;
  };

  for (const ch of text) {
    if (ch === ' ') {
      flushPending();
      x += 0.55 * scaleX * height;
      continue;
    }

    if (isCjkChar(ch)) {
      flushPending();
      // 大字体汉字占一个方格：边长 = 字高，宽度再乘宽度因子（只压 X）。
      const w = estimateCjkAdvance(height) * Math.abs(scaleX);
      items.push({ kind: 'cjk', char: ch, x, advance: w, height });
      x += w;
      hasCjk = true;
      continue;
    }

    const glyph = font.glyphs.get(ch.charCodeAt(0));
    if (!glyph) {
      // 缺字形：按空格处理，避免错位。
      flushPending();
      x += 0.55 * scaleX * height;
      continue;
    }

    if (!pendingStrokes) {
      pendingStrokes = [];
      pendingStart = x;
    }
    for (const stroke of glyph.strokes) {
      const pts: number[] = [];
      for (let k = 0; k < stroke.length; k += 2) {
        const gx = stroke[k] * capScale;
        const gy = stroke[k + 1] * capScale;
        // X = 字形 x × 宽度系数 + 斜切；Y 直接缩放。
        pts.push(x + gx * scaleX + gy * shear, gy);
      }
      pendingStrokes.push(pts);
    }
    x += glyph.advance * capScale * scaleX;
  }
  flushPending();

  return { items, advance: x, hasCjk };
};

/** 计算整形结果的包围盒（X 范围用于对齐，Y 范围用于 LOD）。 */
export const strokeShapingBounds = (result: StrokeShapingResult): { minX: number; maxX: number; minY: number; maxY: number } => {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const item of result.items) {
    if (item.kind === 'strokes') {
      for (const stroke of item.strokes) {
        for (let k = 0; k < stroke.length; k += 2) {
          minX = Math.min(minX, stroke[k]);
          maxX = Math.max(maxX, stroke[k]);
          minY = Math.min(minY, stroke[k + 1]);
          maxY = Math.max(maxY, stroke[k + 1]);
        }
      }
    } else {
      minX = Math.min(minX, item.x);
      maxX = Math.max(maxX, item.x + item.advance);
      minY = Math.min(minY, 0);
      maxY = Math.max(maxY, item.height);
    }
  }
  if (!Number.isFinite(minX)) { minX = maxX = minY = maxY = 0; }
  return { minX, maxX, minY, maxY };
};
