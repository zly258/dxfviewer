/**
 * 文字渲染专项对比（自动选点 + 双引擎同视口截图）。
 *
 * 1. 充满视图后扫描画布，找出墨迹最密（=文字最密）的屏幕区域；
 * 2. 用当前视口把该屏幕点换算成世界坐标；
 * 3. 逐步放大直到该点墨迹足够（文字看得清），记下 zoom；
 * 4. 把**两引擎**都设到完全相同的 (wx, wy, zoom) 后截图，逐字核对。
 *
 * 用法：node scripts/compare-text-detail.mjs <dxf> <outDir> [点数]
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.PREVIEW_URL || 'http://127.0.0.1:3001/index.html';
const file = process.argv[2];
const OUT = process.argv[3] || path.join(ROOT, 'artifacts', 'text-detail');
const N = Number(process.argv[4] ?? 3);
fs.mkdirSync(OUT, { recursive: true });

const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1400, height: 880 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));

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
const setVP = (wx, wy, zoom) => page.evaluate(({ wx, wy, zoom }) => {
  window.__dxfViewport?.set({ targetX: wx, targetY: wy, zoom });
}, { wx, wy, zoom });
const getVP = () => page.evaluate(() => window.__dxfViewport?.get() ?? null);

/** 画布墨迹统计 + 最密点（返回屏幕像素坐标与密度）。 */
const scan = () => page.evaluate(() => {
  const cands = Array.from(document.querySelectorAll('canvas'));
  const src = cands.find(c => c.width > 100 && c.height > 100);
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  const { data } = g.getImageData(0, 0, c.width, c.height);
  const W = c.width, H = c.height;
  const bg = [data[0], data[1], data[2]];
  let ink = 0, n = 0;
  for (let i = 0; i < data.length; i += 4 * 11) {
    n++;
    if (Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 90) ink++;
  }
  const S = 44;
  let best = null, bestN = -1;
  for (let y = 0; y + S <= H; y += 4) {
    for (let x = 0; x + S <= W; x += 4) {
      let k = 0;
      for (let yy = y; yy < y + S; yy++) for (let xx = x; xx < x + S; xx++) {
        const i = (yy * W + xx) * 4;
        if (Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 90) k++;
      }
      if (k > bestN) { bestN = k; best = { x: x + S / 2, y: y + S / 2 }; }
    }
  }
  return { inkRatio: ink / n, densest: best, density: bestN, W, H };
});

const id = path.parse(path.basename(file)).name.replace(/[^\w-]+/g, '_');

for (let i = 0; i < N; i++) {
  // 用 Canvas 引擎找点（文字渲染正确，便于定位文字）
  await switchEngine('Canvas 2D');
  await page.getByRole('button', { name: '充满视图' }).first().click();
  await page.waitForTimeout(1200);

  const s0 = await scan();
  const vp0 = await getVP();
  if (!vp0) { console.log('无视口信息'); break; }
  const k0 = vp0.zoom * (1); // devicePixelRatio = 1
  const wx = (s0.densest.x - s0.W / 2) / k0 + vp0.targetX;
  const wy = (s0.H / 2 - s0.densest.y) / k0 + vp0.targetY;

  // 逐步放大，找到墨迹足够（看得清文字）的缩放
  let zoom = vp0.zoom, ok = false, lastRatio = 0;
  for (const mult of [2, 4, 8, 16, 32, 64]) {
    const z = vp0.zoom * mult;
    await setVP(wx, wy, z);
    await page.waitForTimeout(500);
    const st = await scan();
    zoom = z;
    lastRatio = st.inkRatio;
    if (st.inkRatio > 0.015) { ok = true; break; }
  }
  console.log(`点 ${i}: 世界(${wx.toFixed(0)}, ${wy.toFixed(0)}) zoom=${zoom.toExponential(2)} 墨迹=${(lastRatio * 100).toFixed(1)}% ${ok ? '' : '(仍偏空)'}`);

  for (const engine of ['WebGL', 'Canvas 2D']) {
    await switchEngine(engine);
    await setVP(wx, wy, zoom);
    await page.waitForTimeout(1400);
    const tag = engine === 'WebGL' ? 'webgl' : 'canvas';
    await page.screenshot({ path: path.join(OUT, `${id}-p${i}-${tag}.png`) });
    const vp = await getVP();
    console.log(`    ${engine} 实际视口: 中心(${vp?.targetX.toFixed(0)}, ${vp?.targetY.toFixed(0)}) zoom=${vp?.zoom.toExponential(3)}`);
  }
}
console.log('错误:', errors.slice(0, 3));
console.log('输出:', OUT);
await browser.close();
