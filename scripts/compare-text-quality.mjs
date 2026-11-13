/**
 * 文字渲染质量量化对比：同一图纸、同一批世界坐标点、同一视口，
 * 分别用 WebGL 与 Canvas 渲染，统计：
 *  - 墨迹占比（文字多少）
 *  - 「实心度」：文字笔画被填死时墨迹/包围盒 会异常高（乱码特征）
 *  - 逐像素差分
 *
 * 用法：node scripts/compare-text-quality.mjs <dxf> [点数]
 */
import path from 'node:path';
import fs from 'node:fs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.PREVIEW_URL || 'http://127.0.0.1:3001/index.html';
const file = process.argv[2];
const N = Number(process.argv[3] ?? 6);
const OUT = path.join(ROOT, 'artifacts', 'text-quality');
fs.mkdirSync(OUT, { recursive: true });

// ── 从图纸里挑文字密集的点 ──────────────────────────────────────
const { parseDxf } = await import(new URL('../dist/parser.js', import.meta.url).href);
const decode = b => { try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return new TextDecoder('gb18030').decode(b); } };
const data = await parseDxf(decode(readFileSync(file)), undefined, { yieldIntervalMs: 0 });

// 按 600 单位网格统计文字字符数，取最密的若干格中心
const G = 600;
const m = new Map();
for (const e of data.entities) {
  if (!['TEXT', 'MTEXT', 'ATTRIB'].includes(e.type) || !e.extents) continue;
  const x = (e.extents.min.x + e.extents.max.x) / 2;
  const y = (e.extents.min.y + e.extents.max.y) / 2;
  const k = Math.floor(x / G) + ',' + Math.floor(y / G);
  const a = m.get(k) ?? { n: 0, chars: 0, sx: 0, sy: 0, h: 0 };
  a.n++; a.chars += (e.value ?? '').length; a.sx += x; a.sy += y;
  a.h = Math.max(a.h, e.extents.max.y - e.extents.min.y);
  m.set(k, a);
}
const spots = [...m.values()]
  .filter(v => v.n >= 2)
  .sort((a, b) => b.chars - a.chars)
  .slice(0, N)
  .map(v => ({ x: v.sx / v.n, y: v.sy / v.n, chars: v.chars, n: v.n, h: v.h }));
console.log('采样点:', spots.map(s => `(${s.x.toFixed(0)},${s.y.toFixed(0)})${s.n}字`).join(' '));

// ── 浏览器对比 ──────────────────────────────────────────────────
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1400, height: 880 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('pageerror', String(e)));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.locator('input[type="file"]').first().setInputFiles(file);
await page.waitForFunction(() => {
  const cands = Array.from(document.querySelectorAll('canvas'));
  const src = cands.find(c => c.width > 100 && c.height > 100);
  if (!src || !src.width) return false;
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  const { data } = g.getImageData(0, 0, c.width, c.height);
  const bg = [data[0], data[1], data[2]];
  let ink = 0;
  for (let i = 0; i < data.length; i += 4 * 37) {
    if (Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 60) ink++;
  }
  return ink > 20;
}, { timeout: 180000, polling: 300 });
await page.waitForTimeout(3000);

const switchEngine = async (label) => {
  await page.getByRole('button', { name: '视图', exact: true }).click();
  await page.waitForTimeout(300);
  await page.getByText(label).first().click({ force: true });
  await page.waitForTimeout(3000);
};
const setVP = (x, y, z) => page.evaluate(({ x, y, z }) => {
  window.__dxfViewport?.set({ targetX: x, targetY: y, zoom: z });
}, { x, y, z });

/** 统计画布上「文字块」的墨迹与实心度。 */
const textStats = () => page.evaluate(() => {
  const cands = Array.from(document.querySelectorAll('canvas'));
  const src = cands.find(c => c.width > 100 && c.height > 100);
  if (!src) return null;
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  const { data } = g.getImageData(0, 0, c.width, c.height);
  const W = c.width, H = c.height;
  const bg = [data[0], data[1], data[2]];
  // 统计所有「深色」像素 + 按 8x8 块统计密度
  const S = 8;
  let dark = 0, total = 0;
  const blocks = [];
  for (let by = 0; by + S <= H; by += S) {
    for (let bx = 0; bx + S <= W; bx += S) {
      let d = 0;
      for (let y = by; y < by + S; y++) for (let x = bx; x < bx + S; x++) {
        const i = (y * W + x) * 4;
        if (Math.abs(data[i]-bg[0]) + Math.abs(data[i+1]-bg[1]) + Math.abs(data[i+2]-bg[2]) > 150) d++;
      }
      total++;
      if (d >= S * S * 0.9) dark++;
      if (d > 0) blocks.push(d / (S * S));
    }
  }
  const inkBlocks = blocks.length / total;
  // 实心块占比：整块几乎全暗（笔画被填死 / 实心黑块）
  const solidRatio = dark / total;
  return {
    inkBlocks: +inkBlocks.toFixed(4),
    solidRatio: +solidRatio.toFixed(4),
    avgBlockInk: +(blocks.reduce((a, b) => a + b, 0) / Math.max(1, blocks.length)).toFixed(4),
  };
});

const id = path.parse(path.basename(file)).name.replace(/[^\w-]+/g, '_');
const results = [];
for (let i = 0; i < spots.length; i++) {
  const s = spots[i];
  // 缩放：让字高约为 60px（看得清）
  const zoom = 60 / Math.max(1, s.h);
  const row = { spot: s, zoom };
  for (const engine of ['Canvas 2D', 'WebGL']) {
    await switchEngine(engine);
    await setVP(s.x, s.y, zoom);
    await page.waitForTimeout(1400);
    const st = await textStats();
    row[engine === 'WebGL' ? 'webgl' : 'canvas'] = st;
    const tag = engine === 'WebGL' ? 'webgl' : 'canvas';
    await page.screenshot({ path: path.join(OUT, `${id}-p${i}-${tag}.png`) });
  }
  const c = row.canvas, w = row.webgl;
  console.log(`点${i} (${s.x.toFixed(0)},${s.y.toFixed(0)}) 字高${s.h.toFixed(0)} zoom=${zoom.toFixed(3)}`);
  console.log(`   Canvas: 墨迹块 ${(c?.inkBlocks * 100).toFixed(2)}% 实心 ${(c?.solidRatio * 100).toFixed(2)}% 均墨 ${(c?.avgBlockInk * 100).toFixed(1)}%`);
  console.log(`   WebGL : 墨迹块 ${(w?.inkBlocks * 100).toFixed(2)}% 实心 ${(w?.solidRatio * 100).toFixed(2)}% 均墨 ${(w?.avgBlockInk * 100).toFixed(1)}%`);
  results.push(row);
}
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
await browser.close();
console.log('输出:', OUT);
