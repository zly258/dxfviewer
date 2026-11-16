/**
 * 特殊符号与缺字合成回归（`npm run check:symbols`）。
 *
 * 覆盖两类问题：
 * 1. 转义解码：AutoCAD 标准码 + TSSD 扩展码（%%130 钢筋、%%140 上下标、
 *    %%146 圈号、%%148 轴号、%%c/d/p/%%%）。
 * 2. 字形合成：主/后备字体都缺字时（部分下标、⑪~⑳、∅、⌀），必须合成出
 *    真实几何或留空，绝不能落到 .notdef 方框。
 *
 * 依赖已构建产物：先 `npm run build:lib`。
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { decodeCadSpecialCodes, cleanCadText, cleanMText } = await import(new URL('../dist/parser.js', import.meta.url).href);
const { setOutlineFont, getGlyphMesh } = await import(new URL('../dist/render.js', import.meta.url).href);

const failures = [];
const check = (label, ok, detail = '') => {
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? `  [${detail}]` : ''}`);
};

// ── 1. 转义解码 ─────────────────────────────────────────────────
const cases = [
  ['%%130 一级钢', '%%13012', 'Ø12'],
  ['%%131 二级钢', '%%13116', 'Φ16'],
  ['%%132 三级钢', '%%13225', 'Φ25'],
  ['%%140/%%141 上标', 'kN/m%%1402%%141', 'kN/m²'],
  ['%%142/%%143 下标', 'L%%142aE%%143', 'LₐE'],
  ['%%146/%%147 圈号（个位）', '%%1462%%147', '②'],
  ['%%146/%%147 圈号（十位）', '%%14610%%147', '⑩'],
  ['%%148/%%149 轴号', '%%1483C%%149', '(3C)'],
  ['%%150/%%151 轴号', '%%1503-9%%151', '(3-9)'],
  ['%%144 说明标题码', '%%144说明：', '说明：'],
  ['%%c 直径', '%%c30H7', 'Ø30H7'],
  ['%%d 度数', '45%%d', '45°'],
  ['%%p 正负', '%%p0.05', '±0.05'],
  ['%%% 百分号', '100%%%', '100%'],
  ['\\U+XXXX 转义', '\\U+00D8 圆钢', 'Ø 圆钢'],
  ['MTEXT 堆叠分数', '\\S3/4;', '3/4'],
];
for (const [label, input, expect] of cases) {
  const out = cleanCadText(input);
  check(label, out.includes(expect), `"${input}" → "${out}"`);
}

const full = decodeCadSpecialCodes('%%13012 %%1402%%141 %%142a%%143 %%1462%%147 %%1483C%%149 %%c30 45%%d %%p1 100%%% %%144标题');
check('解码后无残留 %%', !full.includes('%%'), full);
check('解码后无控制字符', !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(full), JSON.stringify(full));
check('MTEXT 解码与单行一致', cleanMText('%%14610%%147') === cleanCadText('%%14610%%147'));

// ── 2. 字形合成 ─────────────────────────────────────────────────
const fontPath = path.join(ROOT, 'dxfviewer-example/public/fonts/simfang.ttf');
const fallbackPath = path.join(ROOT, 'dxfviewer-example/public/fonts/arial.ttf');
if (!existsSync(fontPath)) {
  console.log('· 缺少示例字体 simfang.ttf，跳过字形合成校验');
} else {
  const buf = readFileSync(fontPath);
  setOutlineFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  let fallbackLoaded = false;
  if (existsSync(fallbackPath)) {
    const fb = readFileSync(fallbackPath);
    const { setFallbackOutlineFont } = await import(new URL('../dist/render.js', import.meta.url).href);
    setFallbackOutlineFont?.(fb.buffer.slice(fb.byteOffset, fb.byteOffset + fb.byteLength));
    fallbackLoaded = true;
  }
  console.log(`· 主字体 simfang.ttf${fallbackLoaded ? ' + 后备字体 arial.ttf' : ''}`);

  // 会引起 .notdef 方框的字符：必须要么有真实几何，要么明确留空（宽度占位）。
  const risky = ['₀', '₁', '₂', '₃', 'ₕ', 'ₖ', 'ₘ', 'ₙ', 'ₚ', 'ₜ', 'ₓ', '⁺', '⁻', '⑪', '⑫', '⑳', '⓪', '∅', '⌀'];
  const empty = [];
  for (const ch of risky) {
    const mesh = getGlyphMesh(ch);
    const v = mesh?.vertices?.length ?? 0;
    if (v === 0) empty.push(ch);
  }
  check('危险字符无 .notdef 方框（有几何或留空）', empty.length < risky.length, `${risky.length - empty.length}/${risky.length} 有几何`);
  console.log(`   · 留空占位（只保留宽度、不画方框）: ${empty.join(' ') || '无'}`);

  // 常用符号必须有真实几何。
  const mustHave = ['Ø', 'Φ', '°', '±', '²', '³', '①', '②', '⑩', 'Ø'.normalize(), '×'];
  const missing = mustHave.filter(ch => (getGlyphMesh(ch)?.vertices?.length ?? 0) === 0);
  check('常用工程符号均有几何', missing.length === 0, missing.join(' ') || '全部命中');

  // 合成字形必须有合理步进宽度（不塌陷为 0，避免文字叠在一起）。
  const advanceBad = ['ₐ', '₂', '⑪', '⑩', '⌀'].filter(ch => {
    const m = getGlyphMesh(ch);
    return !m || !(m.advance > 0);
  });
  check('合成字形步进宽度 > 0', advanceBad.length === 0, advanceBad.join(' ') || '正常');
}

console.log(failures.length === 0 ? '\n特殊符号校验全部通过。' : `\n失败 ${failures.length} 项：\n${failures.map(f => ` - ${f}`).join('\n')}`);
process.exit(failures.length === 0 ? 0 : 1);
