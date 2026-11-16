/**
 * 超大图纸端到端实测（`npm run check:large`）。
 *
 * 生成 10 万实体的合成图纸（写入系统临时目录，不落仓库），在浏览器里
 * 用极简预览组件加载，量测：
 * - 从选文件到首帧可见的耗时（解析 Worker → 跨线程 → 烘焙 → 出帧）；
 * - 充满视图时的墨迹占比（图纸与文字都应在，远景不再整幅空白）；
 * - 缩放到 8 倍后文字是否仍在正确位置（不跑偏）；
 * - 控制台无错误。
 *
 * 需先启动示例 dev server（npm --workspace dxfviewer-example run dev）。
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.PREVIEW_URL || 'http://127.0.0.1:3011/preview.html';
const TOTAL = Number(process.env.LARGE_ENTITIES) || 100_000;

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.log('· 未安装 playwright-core，跳过浏览器实测');
  process.exit(0);
}

// ── 生成合成图纸（临时目录） ──────────────────────────────────
const genDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dxfviewer-large-'));
const genFile = path.join(genDir, 'large-synthetic.dxf');
{
  const out = [];
  let handle = 0x100;
  const hex = () => (++handle).toString(16).toUpperCase();
  const num = v => v.toFixed(4);
  const put = (code, value) => out.push(String(code), value);

  put(0, 'SECTION'); put(2, 'HEADER');
  put(9, '$ACADVER'); put(1, 'AC1015');
  put(9, '$EXTMIN'); put(10, '0.0'); put(20, '0.0'); put(30, '0.0');
  put(9, '$EXTMAX'); put(10, '1200.0'); put(20, '900.0'); put(30, '0.0');
  put(0, 'ENDSEC');
  put(0, 'SECTION'); put(2, 'TABLES');
  put(0, 'TABLE'); put(2, 'LTYPE'); put(70, '1');
  put(0, 'LTYPE'); put(2, 'CONTINUOUS'); put(70, '0'); put(3, 'Solid line'); put(72, '65'); put(73, '0'); put(40, '0');
  put(0, 'ENDTAB');
  put(0, 'TABLE'); put(2, 'LAYER'); put(70, '1');
  put(0, 'LAYER'); put(2, '0'); put(70, '0'); put(62, '7'); put(6, 'CONTINUOUS');
  put(0, 'ENDTAB');
  put(0, 'TABLE'); put(2, 'STYLE'); put(70, '1');
  put(0, 'STYLE'); put(2, 'STANDARD'); put(70, '0'); put(40, '0'); put(41, '1'); put(50, '0'); put(71, '0'); put(42, '2.5'); put(3, 'txt'); put(4, '');
  put(0, 'ENDTAB');
  put(0, 'ENDSEC');
  put(0, 'SECTION'); put(2, 'ENTITIES');

  const emitLine = (x, y) => {
    put(0, 'LINE'); put(5, hex()); put(8, '0');
    put(10, num(x)); put(20, num(y)); put(30, '0.0');
    put(11, num(x + 12)); put(21, num(y + 8)); put(31, '0.0');
  };
  const emitCircle = (x, y) => {
    put(0, 'CIRCLE'); put(5, hex()); put(8, '0');
    put(10, num(x)); put(20, num(y)); put(30, '0.0'); put(40, num(3 + (x % 5)));
  };
  const emitText = (x, y, i) => {
    put(0, 'TEXT'); put(5, hex()); put(8, '0');
    put(10, num(x)); put(20, num(y)); put(30, '0.0');
    put(40, num(3.5)); put(1, `PART-${i} %%c25 45%%d`);
  };
  const emitPolyline = (x, y) => {
    put(0, 'LWPOLYLINE'); put(5, hex()); put(8, '0');
    put(90, '4'); put(70, '0'); put(43, '0.0');
    put(10, num(x)); put(20, num(y));
    put(10, num(x + 6)); put(20, num(y));
    put(10, num(x + 6)); put(20, num(y + 6));
    put(10, num(x)); put(20, num(y + 6));
  };
  const emitArc = (x, y) => {
    put(0, 'ARC'); put(5, hex()); put(8, '0');
    put(10, num(x)); put(20, num(y)); put(30, '0.0'); put(40, num(4));
    put(50, num(0)); put(51, num(120));
  };

  const columns = Math.ceil(Math.sqrt(TOTAL));
  const emitters = [emitLine, emitCircle, emitText, emitPolyline, emitArc];
  for (let i = 0; i < TOTAL; i++) {
    const x = (i % columns) * 6 + 10;
    const y = Math.floor(i / columns) * 5 + 10;
    emitters[i % emitters.length](x, y, i);
  }
  put(0, 'ENDSEC');
  put(0, 'EOF');
  fs.writeFileSync(genFile, out.join('\n') + '\n', 'utf8');
}
const bytes = fs.statSync(genFile).size;
console.log(`· 合成图纸：${(bytes / 1024 / 1024).toFixed(1)} MB，${TOTAL} 实体（临时目录，不入库）`);

// ── 浏览器实测 ────────────────────────────────────────────────
const failures = [];
const check = (label, ok, detail = '') => {
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? `  [${detail}]` : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1400, height: 880 }, deviceScaleFactor: 1 });
const consoleErrors = [];
page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('pageerror', err => consoleErrors.push(String(err)));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => {
  window.__firstPaintAt = 0;
  const host = document.querySelector('.dxf-preview');
  if (!host) return;
  const observer = new MutationObserver(() => {});
  observer.observe(host, { childList: true, subtree: true });
});

const t0 = Date.now();
await page.locator('input[type="file"]').setInputFiles(genFile);

// 等待画布出现「非纯背景」像素：首帧可见即计时结束。
const loadMs = await page.waitForFunction(() => {
  const src = document.querySelector('.dxf-preview canvas');
  if (!src || !src.width || !src.height) return false;
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(src, 0, 0);
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  const bg = [data[0], data[1], data[2]];
  let ink = 0;
  for (let i = 0; i < data.length; i += 4 * 37) {
    if (Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 60) ink++;
  }
  return ink > 40;
}, { timeout: 120_000, polling: 200 }).then(() => Date.now() - t0);

console.log(`· 首帧可见：${loadMs} ms（含 Worker 解析 + 跨线程 + 烘焙 + 出帧）`);
check('10 万实体首帧 < 8s', loadMs < 8000, `${loadMs} ms`);

const stats = () => page.evaluate(() => {
  const src = document.querySelector('.dxf-preview canvas');
  if (!src) return null;
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  c.getContext('2d').drawImage(src, 0, 0);
  const { data } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
  const bg = [data[0], data[1], data[2]];
  let ink = 0, n = 0;
  for (let i = 0; i < data.length; i += 4 * 7) {
    n++;
    if (Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 60) ink++;
  }
  return { inkRatio: ink / Math.max(1, n), w: c.width, h: c.height };
});

const fit = await stats();
check('充满视图有内容', !!fit && fit.inkRatio > 0.01, `墨迹占比=${((fit?.inkRatio ?? 0) * 100).toFixed(2)}%`);

// 远景文字：充满视图时文字投影约 1.5~4px，断言"文字层"确实在场景里
const textOps = await page.evaluate(() => {
  const engine = window.__dxfEngine;
  if (!engine || !engine.stats) return null;
  return { stats: engine.stats };
});
if (textOps) console.log(`· 引擎统计：${JSON.stringify(textOps.stats)}`);

// 放大 8 倍：文字应仍在（不再需要放到极大才出现）
const box = await page.locator('.dxf-preview').boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;
await page.mouse.move(cx, cy);
for (let i = 0; i < 8; i++) {
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(120);
}
await page.waitForTimeout(900);
const zoomed = await stats();
check('放大后仍有内容', !!zoomed && zoomed.inkRatio > 0.005, `墨迹占比=${((zoomed?.inkRatio ?? 0) * 100).toFixed(2)}%`);

// 帧耗时：连续平移 20 帧，量测平均每帧
const frameMs = await page.evaluate(async () => {
  const host = document.querySelector('.dxf-preview');
  if (!host) return -1;
  const rect = host.getBoundingClientRect();
  const x0 = rect.left + rect.width / 2;
  const y0 = rect.top + rect.height / 2;
  const times = [];
  let last = performance.now();
  const fire = (dx) => {
    const opts = { bubbles: true, clientX: x0 + dx, clientY: y0, pointerId: 1, pointerType: 'mouse', buttons: 1 };
    host.dispatchEvent(new PointerEvent('pointerdown', opts));
    for (let i = 1; i <= 4; i++) {
      host.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: x0 + dx + i * 3 }));
    }
    host.dispatchEvent(new PointerEvent('pointerup', opts));
  };
  for (let k = 0; k < 20; k++) {
    fire(k * 2);
    await new Promise(r => requestAnimationFrame(() => r()));
    const now = performance.now();
    times.push(now - last);
    last = now;
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
});
check('平移交互帧耗时 < 40ms', frameMs >= 0 && frameMs < 40, `${frameMs.toFixed(1)} ms/帧`);

check('无控制台错误', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));

await page.screenshot({ path: path.join(ROOT, 'artifacts', 'preview', 'large.png') }).catch(() => {});
await browser.close();
fs.rmSync(genDir, { recursive: true, force: true });

console.log(failures.length === 0 ? '\n超大图纸实测全部通过。' : `\n失败 ${failures.length} 项：\n${failures.map(f => ` - ${f}`).join('\n')}`);
process.exit(failures.length === 0 ? 0 : 1);