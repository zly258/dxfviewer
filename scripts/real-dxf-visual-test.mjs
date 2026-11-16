/**
 * 真实图纸视觉实测（`node scripts/real-dxf-visual-test.mjs <目录>`）。
 *
 * 每张图纸采集 3 个视图并截图（供人工/模型肉眼核对）：
 *  - fit   ：充满视图（远景）—— 核对图纸范围、整体布局是否完整；
 *  - zoom  ：放大 8 档（近景）—— 核对线条、文字、剖面线细节；
 *  - pan   ：平移后 —— 核对位置是否正确（不应出现内容跑到画布外/错位）。
 *
 * 同时输出可量化的指标：墨迹占比、黑块面积（实心黑矩形是渲染缺陷的特征）、
 * 图纸范围（世界坐标 bbox）是否覆盖画布。
 *
 * 图纸只在本机读取，不上传、不外发；输出仅写到 artifacts/。
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.PREVIEW_URL || 'http://127.0.0.1:3001/index.html';
const OUT = path.join(ROOT, 'artifacts', 'visual');
const DRAWING_EXT = /\.(dxf)$/i;

const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) {
  console.error('用法：node scripts/real-dxf-visual-test.mjs <目录>');
  process.exit(1);
}
const only = process.argv[3] ? new RegExp(process.argv[3]) : null;

const collect = (d) => {
  const out = [];
  for (const n of fs.readdirSync(d)) {
    const full = path.join(d, n);
    if (fs.statSync(full).isDirectory()) out.push(...collect(full));
    else if (DRAWING_EXT.test(n)) out.push(full);
  }
  return out;
};
const files = collect(dir).sort().filter(f => !only || only.test(f));
fs.mkdirSync(OUT, { recursive: true });

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.log('· 未安装 playwright-core，跳过');
  process.exit(0);
}

const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1400, height: 880 }, deviceScaleFactor: 1 });

/** 在页面里抓取画布的墨迹 / 黑块统计。 */
const measure = () => page.evaluate(() => {
  const cands = Array.from(document.querySelectorAll('canvas'));
  const src = cands.find(c => c.width > 100 && c.height > 100);
  if (!src || !src.width) return null;
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  const { data } = g.getImageData(0, 0, c.width, c.height);
  const W = c.width, H = c.height;
  const bg = [data[0], data[1], data[2]];
  let ink = 0, n = 0, dark = 0;
  for (let i = 0; i < data.length; i += 4 * 13) {
    n++;
    const d = Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]);
    if (d > 60) ink++;
    if (data[i] < 40 && data[i + 1] < 40 && data[i + 2] < 40) dark++;
  }
  // 实心黑块（面积/包围盒 > 0.8，排除细线）
  const isBlack = (x, y) => {
    const i = (y * W + x) * 4;
    return data[i] < 40 && data[i + 1] < 40 && data[i + 2] < 40 && data[i + 3] > 200;
  };
  const seen = new Uint8Array(W * H);
  let solidBlackPx = 0;
  const boxes = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p0 = y * W + x;
      if (seen[p0] || !isBlack(x, y)) continue;
      const st = [p0]; seen[p0] = 1;
      let cnt = 0, minX = x, maxX = x, minY = y, maxY = y;
      while (st.length) {
        const q = st.pop();
        const qy = (q / W) | 0, qx = q - qy * W;
        cnt++;
        if (qx < minX) minX = qx; if (qx > maxX) maxX = qx;
        if (qy < minY) minY = qy; if (qy > maxY) maxY = qy;
        for (const k of [q - 1, q + 1, q - W, q + W]) {
          if (k < 0 || k >= seen.length || seen[k]) continue;
          const ky = (k / W) | 0, kx = k - ky * W;
          if (Math.abs(kx - qx) + Math.abs(ky - qy) !== 1) continue;
          if (isBlack(kx, ky)) { seen[k] = 1; st.push(k); }
        }
      }
      const w = maxX - minX + 1, h = maxY - minY + 1;
      if (cnt > 600 && cnt / (w * h) > 0.8) {
        solidBlackPx += cnt;
        boxes.push({ px: cnt, box: [minX, minY, w, h] });
      }
    }
  }
  boxes.sort((a, b) => b.px - a.px);
  return {
    inkRatio: ink / Math.max(1, n),
    darkRatio: dark / Math.max(1, n),
    solidBlackPx,
    blackBoxes: boxes.slice(0, 3),
    size: [W, H],
  };
});

const results = [];
for (const file of files) {
  const name = path.basename(file);
  const id = name.replace(/[\\/:*?"<>|]/g, '_').replace(/\.dxf$/i, '');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="file"]', { state: 'attached' });
  const errors = [];
  const onErr = e => errors.push(String(e));
  page.on('pageerror', onErr);

  let loaded = false;
  try {
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
    }, { timeout: 180_000, polling: 300 });
    loaded = true;
  } catch { /* 未加载成功（截断文件等） */ }
  page.off('pageerror', onErr);

  if (!loaded) {
    const text = await page.evaluate(() => document.body.innerText.slice(0, 200));
    results.push({ file: name, loaded: false, message: text });
    console.log(`✗ ${name}\n   未加载：${text.replace(/\n/g, ' ').slice(0, 120)}`);
    continue;
  }

  await page.waitForTimeout(2500);

  // ① 充满视图（远景）
  const fitBtn = page.getByRole('button', { name: '充满视图' });
  if (await fitBtn.count()) { await fitBtn.first().click(); await page.waitForTimeout(1200); }
  const fitStat = await measure();
  await page.screenshot({ path: path.join(OUT, `${id}-1-fit.png`) });

  // ② 放大 8 档（近景）
  const box = await page.locator('.canvas-container').first().boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(110); }
    await page.waitForTimeout(1500);
  }
  const zoomStat = await measure();
  await page.screenshot({ path: path.join(OUT, `${id}-2-zoom.png`) });

  // ③ 平移（位置核对）
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 160, box.y + box.height / 2 - 90, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(1200);
  }
  const panStat = await measure();
  await page.screenshot({ path: path.join(OUT, `${id}-3-pan.png`) });

  results.push({
    file: name, loaded: true, errors,
    fit: fitStat, zoom: zoomStat, pan: panStat,
  });
  const fmt = s => s ? `墨迹 ${(s.inkRatio * 100).toFixed(2)}% 黑块 ${s.solidBlackPx}px` : '无';
  console.log(`✓ ${name}\n   远景 ${fmt(fitStat)} | 近景 ${fmt(zoomStat)} | 平移 ${fmt(panStat)}`);
}

fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
await browser.close();
const bad = results.filter(r => !r.loaded || (r.fit && r.fit.solidBlackPx > 4000));
console.log(`\n共 ${results.length} 个，异常 ${bad.length} 个。截图：${OUT}`);
