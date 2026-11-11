/**
 * 双引擎像素级对比工装（`npm run compare:engines -- <目录>`）。
 *
 * 流程：同一张图纸 → WebGL 引擎下导航到目标视图 → 截画布 →
 * 切到 Canvas 引擎（视口由 React state 保留，完全一致）→ 再截画布 →
 * 浏览器内逐像素差分，输出统计与热力图。
 *
 * 图纸目录由命令行参数指定（不内置任何具体图纸）；不传目录时使用
 * scripts/fixtures.mjs 运行时生成的夹具，保证仓库内不出现图纸文件。
 *
 * 环境变量：
 *   DXFVIEWER_URL   应用地址，默认 http://localhost:3001
 *   COMPARE_OUT     输出目录，默认系统临时目录下 dxfviewer-compare
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = process.env.DXFVIEWER_URL || 'http://localhost:3001';
const OUT = process.env.COMPARE_OUT || path.join(os.tmpdir(), 'dxfviewer-compare');
const DRAWING_EXT = /\.(dxf)$/i;

const argvDir = process.argv.slice(2).find(a => !a.startsWith('-'));
fs.mkdirSync(OUT, { recursive: true });

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.log('· 未安装 playwright-core，跳过双引擎对比');
  process.exit(0);
}

// ── 图纸来源：命令行目录 / 运行时夹具 ──
// 每个文件生成两个场景：充满视图、放大 5 档。
const scenarios = [];
if (argvDir) {
  const dir = path.resolve(argvDir);
  if (!fs.existsSync(dir)) {
    console.error(`✗ 目录不存在：${dir}`);
    process.exit(1);
  }
  const files = fs.readdirSync(dir).filter(n => DRAWING_EXT.test(n)).sort();
  if (!files.length) {
    console.error(`✗ 目录中没有图纸文件：${dir}`);
    process.exit(1);
  }
  for (const file of files) {
    const id = path.parse(file).name.replace(/[^\w\-]+/g, '_');
    scenarios.push({ id: `${id}-fit`, file, dir, fit: true, zoom: 0, pan: [0, 0] });
    scenarios.push({ id: `${id}-zoom`, file, dir, fit: true, zoom: 5, pan: [-120, -60] });
  }
} else {
  console.log('· 未指定图纸目录，使用运行时生成的夹具');
}

let fixtureBundle;
if (!scenarios.length) {
  const { materializeFixtures } = await import('./fixtures.mjs');
  fixtureBundle = await materializeFixtures('dxfviewer-compare-');
  // 只取文字/几何都齐的最小夹具，避免对比耗时过长。
  const preferred = ['line-circle.dxf', 'text-mtext.dxf', 'special-codes.dxf', 'dimension.dxf'];
  const names = preferred.filter(n => fixtureBundle.files[n]);
  for (const name of (names.length ? names : Object.keys(fixtureBundle.files).slice(0, 4))) {
    const id = path.parse(name).name.replace(/[^\w\-]+/g, '_');
    scenarios.push({ id: `${id}-fit`, file: name, dir: fixtureBundle.dir, fit: true, zoom: 0, pan: [0, 0] });
    scenarios.push({ id: `${id}-zoom`, file: name, dir: fixtureBundle.dir, fit: true, zoom: 4, pan: [-80, -50] });
  }
}

const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
const p = await browser.newPage({ viewport: { width: 1400, height: 820 }, deviceScaleFactor: 1 });
await p.goto(BASE_URL);
await p.waitForTimeout(1600);

const switchEngine = async (label) => {
  await p.getByRole('button', { name: '视图', exact: true }).click();
  await p.waitForTimeout(250);
  await p.getByText(label).first().click({ force: true });
  await p.waitForTimeout(2600);
};

/** 等画布出现内容（不依赖具体实体数文案）。 */
const waitForInk = async (timeout = 120_000) => {
  await p.waitForFunction(() => {
    const src = document.querySelector('.tab-viewer-host[style*="visible"] canvas');
    if (!src || !src.width || !src.height) return false;
    const c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    c.getContext('2d').drawImage(src, 0, 0);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const bg = [d[0], d[1], d[2]];
    let ink = 0;
    for (let i = 0; i < d.length; i += 4 * 53) {
      if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 60) ink++;
    }
    return ink > 30;
  }, { timeout, polling: 250 });
};

const results = [];
let currentFile = '';

for (const sc of scenarios) {
  if (currentFile !== sc.file) {
    await p.locator('input[type="file"]').first().setInputFiles(path.join(sc.dir, sc.file));
    await waitForInk();
    await p.waitForTimeout(4200);
    currentFile = sc.file;
  }

  await switchEngine('WebGL');
  await p.getByRole('button', { name: '充满视图' }).click();
  await p.waitForTimeout(700);

  const box = await p.locator('.tab-viewer-host[style*="visible"] .canvas-container').first().boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  if (sc.pan[0] || sc.pan[1]) {
    await p.mouse.move(cx, cy);
    await p.mouse.down();
    await p.mouse.move(cx + sc.pan[0], cy + sc.pan[1], { steps: 6 });
    await p.mouse.up();
    await p.waitForTimeout(400);
  }
  if (sc.zoom > 0) {
    await p.mouse.move(cx, cy);
    for (let i = 0; i < sc.zoom; i++) { await p.mouse.wheel(0, -250); await p.waitForTimeout(90); }
  }
  await p.waitForTimeout(1200);

  const clip = { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
  const glShot = await p.screenshot({ clip });
  fs.writeFileSync(path.join(OUT, `${sc.id}-webgl.png`), glShot);

  await switchEngine('Canvas 2D');
  await p.waitForTimeout(600);
  const cvShot = await p.screenshot({ clip });
  fs.writeFileSync(path.join(OUT, `${sc.id}-canvas.png`), cvShot);

  const toUrl = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
  const diff = await p.evaluate(async ([a, b]) => {
    const load = (src) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = src; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const w = Math.min(ia.width, ib.width), h = Math.min(ia.height, ib.height);
    const c1 = document.createElement('canvas'); c1.width = w; c1.height = h;
    const c2 = document.createElement('canvas'); c2.width = w; c2.height = h;
    const g1 = c1.getContext('2d'), g2 = c2.getContext('2d');
    g1.drawImage(ia, 0, 0); g2.drawImage(ib, 0, 0);
    const d1 = g1.getImageData(0, 0, w, h).data;
    const d2 = g2.getImageData(0, 0, w, h).data;
    const heat = g2.createImageData(w, h);
    let diffPx = 0, bigDiffPx = 0, sum = 0, max = 0;
    for (let i = 0; i < d1.length; i += 4) {
      const d = Math.max(Math.abs(d1[i] - d2[i]), Math.abs(d1[i + 1] - d2[i + 1]), Math.abs(d1[i + 2] - d2[i + 2]));
      sum += d;
      if (d > max) max = d;
      if (d > 16) { diffPx++; if (d > 96) bigDiffPx++; }
      if (d > 16) {
        heat.data[i] = 255; heat.data[i + 1] = Math.max(0, 200 - d); heat.data[i + 2] = 0;
      } else {
        const lum = Math.round((d2[i] + d2[i + 1] + d2[i + 2]) / 3 * 0.35 + 220 * 0.65);
        heat.data[i] = lum; heat.data[i + 1] = lum; heat.data[i + 2] = lum;
      }
      heat.data[i + 3] = 255;
    }
    g2.putImageData(heat, 0, 0);
    const total = d1.length / 4;
    return {
      width: w, height: h,
      diffPx, bigDiffPx,
      diffRatio: +(diffPx / total * 100).toFixed(3),
      bigDiffRatio: +(bigDiffPx / total * 100).toFixed(3),
      meanDiff: +(sum / total).toFixed(2),
      maxDiff: max,
      heatUrl: c2.toDataURL('image/png'),
    };
  }, [toUrl(glShot), toUrl(cvShot)]);

  fs.writeFileSync(path.join(OUT, `${sc.id}-diff.png`), Buffer.from(diff.heatUrl.split(',')[1], 'base64'));
  delete diff.heatUrl;
  results.push({ scenario: sc.id, file: sc.file, ...diff });
  console.log(`${sc.id}: 差异像素 ${diff.diffRatio}% (强差异 ${diff.bigDiffRatio}%), 平均 ${diff.meanDiff}, 最大 ${diff.maxDiff}`);
}

fs.writeFileSync(path.join(OUT, 'stats.json'), JSON.stringify(results, null, 2));
await browser.close();
await fixtureBundle?.cleanup?.();

console.log('完成:', OUT);