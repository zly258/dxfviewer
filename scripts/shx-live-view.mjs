/**
 * 打开真实图纸，在文字位置截 WebGL / Canvas 近景，供肉眼核对 SHX。
 * 图纸只在本机读取。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.argv[2];
const BASE = process.env.PREVIEW_URL || 'http://127.0.0.1:3001/index.html';
const OUT = path.join(ROOT, 'artifacts', 'visual', 'shx-live');
fs.mkdirSync(OUT, { recursive: true });

const { parseDxf } = await import(new URL('../dist/parser.js', import.meta.url).href);
const buf = fs.readFileSync(FILE);
let text;
try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
catch { text = new TextDecoder('gb18030').decode(buf); }
const data = await parseDxf(text, undefined, { yieldIntervalMs: 0 });
const samples = [];
for (const e of data.entities) {
  if (e.type !== 'TEXT' || !e.value || !e.position) continue;
  if (!/[\u4e00-\u9fff]/.test(e.value)) continue;
  if ((e.height || 0) < 200) continue;
  const style = data.styles?.[e.styleName] || {};
  samples.push({
    value: String(e.value).replace(/\s+/g, ' ').slice(0, 24),
    x: e.position.x,
    y: e.position.y,
    h: e.height,
    style: e.styleName,
    font: style.fontFileName,
    big: style.bigFontFileName,
  });
  if (samples.length >= 400) break;
}
// 取相距较远的三处，避免截到同一块。
const picks = [];
for (const s of samples) {
  if (picks.every(p => Math.hypot(p.x - s.x, p.y - s.y) > 8000)) picks.push(s);
  if (picks.length === 3) break;
}
console.log('offset', data.offset);
console.log('picks', picks);
if (!picks.length) {
  console.error('没有找到中文 TEXT');
  process.exit(1);
}

const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
const shx = [];
const errors = [];
page.on('response', (res) => {
  if (res.url().includes('.shx')) shx.push(`${res.status()} ${res.url()}`);
});
page.on('pageerror', (err) => errors.push(String(err)));
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.locator('input[type="file"]').first().setInputFiles(FILE);
await page.waitForFunction(() => {
  const c = document.querySelector('canvas');
  return c && c.width > 100;
}, null, { timeout: 180000 });
await page.waitForTimeout(4000);
console.log('shx requests', shx);
console.log('page errors', errors.slice(0, 5));

const shot = async (name) => {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file });
  console.log('shot', file);
};

const fit = page.getByRole('button', { name: '充满视图' });
if (await fit.count()) await fit.first().click();
await page.waitForTimeout(1500);
await shot('webgl-fit.png');

const zoomTo = async (p) => {
  await page.evaluate((vp) => {
    const api = window.__dxfViewport;
    if (!api) throw new Error('no viewport api');
    api.set(vp);
  }, { targetX: p.x, targetY: p.y, zoom: Math.min(0.35, 36 / p.h) });
  await page.waitForTimeout(900);
};

for (let i = 0; i < picks.length; i++) {
  await zoomTo(picks[i]);
  await shot(`webgl-text-${i}.png`);
}

const viewBtn = page.getByRole('button', { name: '视图' });
if (await viewBtn.count()) {
  await viewBtn.first().click();
  const canvasItem = page.getByRole('button', { name: '渲染引擎：Canvas 2D（对比）' });
  if (await canvasItem.count()) await canvasItem.first().click();
  await page.waitForTimeout(2000);
}
for (let i = 0; i < picks.length; i++) {
  await zoomTo(picks[i]);
  await shot(`canvas-text-${i}.png`);
}
if (await fit.count()) {
  await fit.first().click();
  await page.waitForTimeout(800);
}
await shot('canvas-fit.png');
await browser.close();
