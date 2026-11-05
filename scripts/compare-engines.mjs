/**
 * 双引擎像素级对比工装。
 *
 * 流程：同一张图纸 → 在 WebGL 引擎下导航到目标视图 → 截画布 →
 * 切到 Canvas 引擎（viewPort 由 React state 保留，视口完全一致）→ 再截画布 →
 * 在浏览器内做逐像素差分，输出统计与热力图。
 */
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';

const exe = process.env.LOCALAPPDATA + '\\ms-playwright\\chromium-1248\\chrome-win64\\chrome.exe';
const DIR = 'E:/AI图纸测试/图纸/已生成';
const OUT = 'C:/Users/14532/AppData/Local/Temp/cmp';

/** 场景定义：文件 + 视图操作 */
const scenarios = [
  { id: 'jichu-fit', file: '设备基础.dxf', ents: '实体: 561', fit: true, zoom: 0, pan: [0, 0] },
  { id: 'jichu-zoom', file: '设备基础.dxf', ents: '实体: 561', fit: true, zoom: 5, pan: [0, 0] },
  { id: 'gao-notes', file: '高层框架平面+立面.dxf', ents: '实体: 3919', fit: true, zoom: 4, pan: [0, 0] },
  { id: 'guanlang-fit', file: '厂区管廊结构图.dxf', ents: '实体: 40893', fit: true, zoom: 0, pan: [0, 0] },
  { id: 'guanlang-zoom', file: '厂区管廊结构图.dxf', ents: '实体: 40893', fit: true, zoom: 5, pan: [-120, -60] },
];

const browser = await chromium.launch({ executablePath: exe, headless: true });
const p = await browser.newPage({ viewport: { width: 1400, height: 820 }, deviceScaleFactor: 1 });
await p.goto('http://localhost:3001');
await p.waitForTimeout(1600);

const switchEngine = async (label) => {
  await p.getByRole('button', { name: '视图', exact: true }).click();
  await p.waitForTimeout(250);
  await p.getByText(label).first().click({ force: true });
  await p.waitForTimeout(2600);
};

const results = [];
let currentFile = '';

for (const sc of scenarios) {
  if (currentFile !== sc.file) {
    await p.locator('input[type="file"]').first().setInputFiles(`${DIR}/${sc.file}`);
    await p.waitForFunction((t) => document.body.innerText.includes(t), sc.ents, { timeout: 180000 });
    await p.waitForTimeout(4200);
    currentFile = sc.file;
    // 确保从 WebGL 起步
    const inCanvas = await p.evaluate(() => !!document.querySelector('.viewer-text-layer') === false && false);
    void inCanvas;
  }
  // 统一回 WebGL
  await switchEngine('WebGL');
  await p.getByRole('button', { name: '充满视图' }).click();
  await p.waitForTimeout(700);

  // 视图导航（鼠标居中，确定性）
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
  writeFileSync(`${OUT}/${sc.id}-webgl.png`, glShot);

  await switchEngine('Canvas 2D');
  await p.waitForTimeout(600);
  const cvShot = await p.screenshot({ clip });
  writeFileSync(`${OUT}/${sc.id}-canvas.png`, cvShot);

  // 逐像素差分（浏览器内）
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
      const dr = Math.abs(d1[i] - d2[i]);
      const dg = Math.abs(d1[i + 1] - d2[i + 1]);
      const db = Math.abs(d1[i + 2] - d2[i + 2]);
      const d = Math.max(dr, dg, db);
      sum += d;
      if (d > max) max = d;
      if (d > 16) { diffPx++; if (d > 96) bigDiffPx++; }
      const o = i;
      if (d > 16) {
        heat.data[o] = 255; heat.data[o + 1] = Math.max(0, 200 - d); heat.data[o + 2] = 0;
      } else {
        const lum = Math.round((d2[i] + d2[i + 1] + d2[i + 2]) / 3 * 0.35 + 220 * 0.65);
        heat.data[o] = lum; heat.data[o + 1] = lum; heat.data[o + 2] = lum;
      }
      heat.data[o + 3] = 255;
    }
    g2.putImageData(heat, 0, 0);
    const total = (d1.length / 4);
    return {
      width: w, height: h,
      diffPx,
      bigDiffPx,
      diffRatio: +(diffPx / total * 100).toFixed(3),
      bigDiffRatio: +(bigDiffPx / total * 100).toFixed(3),
      meanDiff: +(sum / total).toFixed(2),
      maxDiff: max,
      heatUrl: c2.toDataURL('image/png'),
    };
  }, [toUrl(glShot), toUrl(cvShot)]);

  writeFileSync(`${OUT}/${sc.id}-diff.png`, Buffer.from(diff.heatUrl.split(',')[1], 'base64'));
  delete diff.heatUrl;
  results.push({ scenario: sc.id, file: sc.file, ...diff });
  console.log(`${sc.id}: 差异像素 ${diff.diffRatio}% (强差异 ${diff.bigDiffRatio}%), 平均 ${diff.meanDiff}, 最大 ${diff.maxDiff}`);
}

writeFileSync(`${OUT}/stats.json`, JSON.stringify(results, null, 2));
await browser.close();
console.log('完成:', OUT);
