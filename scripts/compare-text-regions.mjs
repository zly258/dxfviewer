/**
 * 双引擎「同一视口」逐区域对比：把两引擎的视口强制设为完全相同的世界坐标，
 * 逐区域截图，供逐字核对文字/几何细节。
 *
 * 用法：node scripts/compare-text-regions.mjs <dxf> <outDir> [regions.json]
 * region: { name, wx, wy, zoom }  wx/wy 为世界坐标，zoom 为缩放
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.PREVIEW_URL || 'http://127.0.0.1:3001/index.html';
const file = process.argv[2];
const OUT = process.argv[3] || path.join(ROOT, 'artifacts', 'region-compare');
const REGIONS = process.argv[4]
  ? JSON.parse(fs.readFileSync(process.argv[4], 'utf8'))
  : [{ name: 'center', wx: 0, wy: 0, zoom: 1 }];

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

/** 强制设置视口（两引擎完全一致）。 */
const setVP = (wx, wy, zoom) => page.evaluate(({ wx, wy, zoom }) => {
  window.__dxfViewport?.set({ targetX: wx, targetY: wy, zoom });
}, { wx, wy, zoom });

const id = path.parse(path.basename(file)).name.replace(/[^\w\-]+/g, '_');

for (const r of REGIONS) {
  for (const engine of ['WebGL', 'Canvas 2D']) {
    await switchEngine(engine);
    await setVP(r.wx, r.wy, r.zoom);
    await page.waitForTimeout(1500);
    const tag = engine === 'WebGL' ? 'webgl' : 'canvas';
    await page.screenshot({ path: path.join(OUT, `${id}-${r.name}-${tag}.png`) });
  }
  console.log(`区域 ${r.name} 完成`);
}
console.log('错误:', errors.slice(0, 3));
console.log('输出:', OUT);
await browser.close();
