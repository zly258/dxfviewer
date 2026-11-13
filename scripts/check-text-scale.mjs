/**
 * 文字缩放回归校验（`npm run check:text-scale`）。
 *
 * 断言「中英混排时西文字符不因中文的 em 盒被放大」：
 * 系统字体里中文字形墨迹高约占 em 的 87%，西文大写约占 67%，
 * 若整行统一按中文分母缩放，英文会偏大 1.31× —— 表现为同一行里
 * 字号忽大忽小（实测：图纸说明段落里的 "C15" 明显比周围中文大）。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FONT = path.join(ROOT, 'dxfviewer-example', 'public', 'fonts', 'simfang.ttf');

let failed = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '✔' : '✘'} ${label}${detail ? `  [${detail}]` : ''}`);
  if (!ok) failed++;
};

if (!fsExists(FONT)) {
  console.log('· 未找到测试字体，跳过');
  process.exit(0);
}
function fsExists(p) { try { readFileSync(p); return true; } catch { return false; } }

const { setOutlineFont, layoutOutlineToTriangles, measureOutlineTextWidth } =
  await import(new URL('../dist/render.js', import.meta.url).href);

setOutlineFont(readFileSync(FONT));

const HEIGHT = 100;

/** 取一行文字里各字符的实际墨迹高度（世界单位）。 */
const inkHeights = (text) => {
  const run = layoutOutlineToTriangles(text, HEIGHT, 1);
  if (!run) return null;
  const v = run.vertices;
  const n = v.length / 2;
  // 按 x 分组（字符是顺序排列的），取每组的 y 跨度
  const groups = [];
  let cur = null;
  for (let i = 0; i < n; i++) {
    const x = v[i * 2], y = v[i * 2 + 1];
    if (!cur || x - cur.maxX > HEIGHT * 0.12) {
      cur = { minY: Infinity, maxY: -Infinity, maxX: x };
      groups.push(cur);
    }
    cur.minY = Math.min(cur.minY, y);
    cur.maxY = Math.max(cur.maxY, y);
    cur.maxX = Math.max(cur.maxX, x);
  }
  return groups.map(g => g.maxY - g.minY);
};

// 1) 纯英文：字高应 ≈ 标称高度（西文按大写字高度量）
const latinOnly = inkHeights('AB');
check('纯西文字高 ≈ 标称', latinOnly && Math.abs(latinOnly[0] - HEIGHT) < HEIGHT * 0.06,
  latinOnly ? `实测 ${latinOnly[0].toFixed(1)}，期望 ${HEIGHT}` : '无输出');

// 2) 纯中文：字高应 ≈ 标称高度（中文按字身度量）
const cjkOnly = inkHeights('设计');
check('纯中文字高 ≈ 标称', cjkOnly && Math.abs(cjkOnly[0] - HEIGHT) < HEIGHT * 0.06,
  cjkOnly ? `实测 ${cjkOnly[0].toFixed(1)}，期望 ${HEIGHT}` : '无输出');

// 3) 混排：英文的高度必须与纯英文时一致（不能被中文 em 盒放大）
const mixed = inkHeights('设A计');
const latinInMixed = mixed ? mixed[1] : null;
check('混排中英文字高与纯英文一致',
  latinInMixed !== null && Math.abs(latinInMixed - latinOnly[0]) < HEIGHT * 0.06,
  `混排中 ${latinInMixed?.toFixed(1)}，纯英文 ${latinOnly[0].toFixed(1)}`);

// 4) 混排中文字高必须与纯中文时一致
const cjkInMixed = mixed ? mixed[0] : null;
check('混排中中文字高与纯中文一致',
  cjkInMixed !== null && Math.abs(cjkInMixed - cjkOnly[0]) < HEIGHT * 0.06,
  `混排中 ${cjkInMixed?.toFixed(1)}，纯中文 ${cjkOnly[0].toFixed(1)}`);

// 5) 宽度测量必须与几何实际宽度一致（否则换行/对齐会错位）
const wMeasure = measureOutlineTextWidth('设A计', HEIGHT, 1);
const run = layoutOutlineToTriangles('设A计', HEIGHT, 1);
const wGeom = run ? run.totalWidth : 0;
check('宽度测量与几何一致', Math.abs(wMeasure - wGeom) < 1e-6,
  `测量 ${wMeasure.toFixed(2)}，几何 ${wGeom.toFixed(2)}`);

console.log(failed === 0 ? '\n文字缩放校验全部通过。' : `\n失败 ${failed} 项。`);
process.exit(failed === 0 ? 0 : 1);
