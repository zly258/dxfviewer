/**
 * 从 Hershey .jhf 生成内置单线字库模块。
 *
 * 数据来源：Hershey 矢量字体（公有领域），取 futural（Simplex Roman）——与 AutoCAD
 * simplex.shx 同类的单线体，用于把西文/数字渲染成「单线笔画」而不是系统 TTF 填充。
 *
 * 用法：node scripts/generate-hershey.mjs <futural.jhf> <输出 ts>
 */
import fs from 'fs';

const [, , jhfPath, outPath] = process.argv;
if (!jhfPath || !outPath) {
  console.error('用法: node scripts/generate-hershey.mjs <futural.jhf> <out.ts>');
  process.exit(1);
}

const raw = fs.readFileSync(jhfPath, 'utf8').split(/\r?\n/).filter((l) => l.length >= 10);
const val = (c) => c.charCodeAt(0) - 82; // 'R'

const glyphs = [];
let ascii = 32;
for (const line of raw) {
  const nverts = parseInt(line.slice(5, 8), 10);
  const left = val(line[8]);
  const right = val(line[9]);
  const verts = line.slice(10);
  // 第一对是 (left,right)，真正的顶点数 = nverts - 1
  const count = nverts - 1;
  const pair = (k) => [verts[k * 2], verts[k * 2 + 1]];
  const paths = [];
  let j = 0;
  for (let i = 1; i <= count; i++) {
    const [a, b] = pair(i);
    const penUp = a === ' ' && b === 'R';
    if (i === count || penUp) {
      const current = [];
      for (let k = j; k < i; k++) {
        const [x, y] = pair(k);
        if (x === undefined || y === undefined) continue;
        current.push([val(x) - left, 9 - val(y)]);
      }
      if (current.length >= 2) paths.push(current);
      j = i + 1;
    }
  }
  glyphs.push({ code: ascii++, advance: right - left, paths });
}

const round = (n) => Math.round(n * 100) / 100;
const body = glyphs
  .map((g) => {
    const pts = g.paths.map((p) => p.map(([x, y]) => `${round(x)},${round(y)}`).join(' ')).join('|');
    return `  [${g.code}, ${g.advance}, '${pts}'],`;
  })
  .join('\n');

const out = `/**
 * 内置单线笔画字库（Hershey Simplex Roman）。
 *
 * 数据来源：Hershey 矢量字体（公有领域，futural.jhf）。AutoCAD 的 simplex.shx
 * 属于同类单线体：笔画中心线，按线宽描边，缩放到任意倍率都不糊。
 * 这里只内置 ASCII 32..126；汉字仍由系统字体绘制。
 *
 * 生成方式：node scripts/generate-hershey.mjs futural.jhf src/render/text/simplexFont.ts
 * 坐标：y 轴向上，基线 y=0，大写高度 ${21} 单位；x 从字形左缘 0 开始。
 */

/** 单线字库的大写高度（字体单位）。 */
export const SIMPLEX_CAP_HEIGHT = 21;

interface GlyphRecord { code: number; advance: number; paths: string }

const RAW: Array<[number, number, string]> = [
${body}
];

export interface SimplexGlyph {
  /** 字距（字体单位）。 */
  advance: number;
  /** 笔画路径：每项是 [x0, y0, x1, y1, ...]。 */
  paths: number[][];
}

const CACHE = new Map<number, SimplexGlyph | null>();

const parseGlyph = (code: number, advance: number, packed: string): SimplexGlyph => {
  const paths = packed
    ? packed.split('|').map((path) =>
        path
          .split(' ')
          .filter(Boolean)
          .flatMap((pair) => pair.split(',').map(Number)),
      )
    : [];
  return { advance, paths };
};

/** 取某个 ASCII 字符的单线字形（无对应字形时返回 null）。 */
export const getSimplexGlyph = (code: number): SimplexGlyph | null => {
  const cached = CACHE.get(code);
  if (cached !== undefined) return cached;
  const row = RAW.find((r) => r[0] === code);
  const glyph = row ? parseGlyph(row[0], row[1], row[2]) : null;
  CACHE.set(code, glyph);
  return glyph;
};

/** 该字符是否可用单线字库绘制。 */
export const hasSimplexGlyph = (ch: string): boolean => {
  const code = ch.codePointAt(0) ?? -1;
  return code >= 32 && code <= 126 && getSimplexGlyph(code) !== null;
};
`;

fs.writeFileSync(outPath, out);
console.log(`生成 ${outPath}：${glyphs.length} 个字形`);
