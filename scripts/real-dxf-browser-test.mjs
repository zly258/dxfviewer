/**
 * 真实图纸浏览器实测（`node scripts/real-dxf-browser-test.mjs <目录>`）。
 *
 * 只在本地浏览器里打开用户指定的图纸文件（不回传、不上传），逐张检查：
 * - 首帧可见耗时（解析 → 烘焙 → 出帧）
 * - 充满视图是否有墨迹（空图 = 失败）
 * - 控制台错误 / 未捕获异常
 * - 页面报错提示（ErrorBoundary / onError）
 *
 * 图纸只在本机读取，输出仅写到 artifacts/ 下的截图与 JSON。
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.PREVIEW_URL || 'http://127.0.0.1:3001/preview.html';
const OUT = path.join(ROOT, 'artifacts', 'real-browser');
const DRAWING_EXT = /\.(dxf)$/i;

const dir = process.argv[2];
if (!dir) {
  console.error('用法：node scripts/real-dxf-browser-test.mjs <目录>');
  process.exit(1);
}
if (!fs.existsSync(dir)) {
  console.error(`✗ 目录不存在：${dir}`);
  process.exit(1);
}

const collect = (d) => {
  const out = [];
  for (const n of fs.readdirSync(d)) {
    const full = path.join(d, n);
    const st = fs.statSync(full);
    if (st.isDirectory()) out.push(...collect(full));
    else if (DRAWING_EXT.test(n)) out.push(full);
  }
  return out;
};
const files = collect(dir).sort();
if (!files.length) {
  console.error(`✗ 目录中没有 DXF：${dir}`);
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.log('· 未安装 playwright-core，跳过浏览器实测');
  process.exit(0);
}

const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1400, height: 880 }, deviceScaleFactor: 1 });

let consoleErrors = [];
/**
 * 开发态噪音过滤：React StrictMode 的 createRoot 重复调用警告、
 * Vite HMR 日志等与图纸渲染无关的控制台输出，不计入失败。
 */
const isBenignConsoleError = (text) =>
  /createRoot\(\) on a container that has already been passed/i.test(text)
  || /\[vite\] (connecting|connected|hot updated)/i.test(text)
  || /Download the React DevTools/i.test(text);

page.on('console', m => { if (m.type() === 'error' && !isBenignConsoleError(m.text())) consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push('pageerror: ' + String(e)));

await page.goto(BASE, { waitUntil: 'networkidle' });

/** 统计画布上非背景像素比例。 */
const inkStats = () => page.evaluate(() => {
  const src = document.querySelector('.dxf-preview canvas');
  if (!src || !src.width || !src.height) return null;
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  const { data } = g.getImageData(0, 0, c.width, c.height);
  const bg = [data[0], data[1], data[2]];
  let ink = 0, n = 0;
  for (let i = 0; i < data.length; i += 4 * 17) {
    n++;
    if (Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 60) ink++;
  }
  return { ratio: ink / Math.max(1, n), w: c.width, h: c.height };
});

const results = [];
for (const file of files) {
  const name = path.basename(file);
  consoleErrors = [];
  const t0 = Date.now();
  let loadMs = -1, ink = null, errorText = null;

  try {
    // 每张图纸前重置页面：否则上一张的画布残留会被误判为「已有内容」。
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('input[type="file"]', { state: 'attached' });
    consoleErrors = [];
    const t0File = Date.now();
    await page.locator('input[type="file"]').setInputFiles(file);
    // 等画布出现内容（首帧可见）。
    // 文件被截断时解析器会直接报错，页面给出提示而不是白屏 —— 这属于
    // 「正确行为」，不算失败：先等内容，若超时再看页面是否给出了明确错误。
    try {
      await page.waitForFunction(() => {
        const src = document.querySelector('.dxf-preview canvas');
        if (!src || !src.width || !src.height) return false;
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
      }, { timeout: 60_000, polling: 300 });
      loadMs = Date.now() - t0File;
    } catch {
      loadMs = -1;
    }

    // 页面内错误提示文案
    errorText = await page.evaluate(() => {
      const el = document.querySelector('.dxf-preview');
      const scope = el && el.innerText ? el.innerText : document.body.innerText;
      if (!scope) return null;
      const m = scope.match(/[^\n]{0,120}(失败|错误|异常|无法|未找到|不完整|截断)[^\n]{0,120}/);
      return m ? m[0].trim() : null;
    });

    ink = await inkStats();
    await page.screenshot({ path: path.join(OUT, `${name.replace(/[\\/:*?"<>|]/g, '_')}.png`) }).catch(() => {});
  } catch (e) {
    errorText = `超时/异常：${e instanceof Error ? e.message.split('\n')[0] : String(e)}`;
  }

  // 「文件被截断」是源文件本身的缺陷：查看器给出明确提示即为正确行为。
  const isRejectedTruncated = !!errorText && /不完整|截断/.test(errorText);
  const ok = isRejectedTruncated
    || (loadMs >= 0 && ink && ink.ratio > 0.001 && consoleErrors.length === 0);
  results.push({ file: name, loadMs, inkRatio: ink?.ratio ?? 0, errorText, consoleErrors, isRejectedTruncated, ok });
  console.log(
    `${ok ? '✓' : '✗'} ${name}${isRejectedTruncated ? '（已明确提示文件被截断）' : ''}`
    + `\n   首帧 ${loadMs} ms，墨迹 ${((ink?.ratio ?? 0) * 100).toFixed(3)}%`
    + (errorText ? `\n   页面提示：${errorText}` : '')
    + (consoleErrors.length ? `\n   控制台错误 ${consoleErrors.length} 条：${consoleErrors.slice(0, 2).join(' | ').slice(0, 300)}` : ''),
  );
}

fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
await browser.close();
const failed = results.filter(r => !r.ok);
console.log(`\n共 ${results.length} 个文件，失败 ${failed.length} 个。截图与结果：${OUT}`);
process.exit(failed.length === 0 ? 0 : 1);
