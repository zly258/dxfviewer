/**
 * 极简预览组件 · 浏览器实测（`npm run check:preview`）。
 *
 * 校验 DxfPreview 的接入契约与关键修复：
 * 1. 极简结构：只有一块画布，无工具栏 / 侧栏 / 状态栏；
 * 2. 加载图纸后画布有内容（与背景色不同的墨迹）；
 * 3. 充满视图时仍有内容（远景文字不再整幅消失）；
 * 4. 滚轮缩放生效；
 * 5. 主题切换为黑底；
 * 6. 无控制台错误（忽略 favicon 等无关资源 404）。
 *
 * 依赖 playwright-core；未安装时以 0 退出。需先启动示例 dev server：
 *   npm --workspace dxfviewer-example run dev
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.PREVIEW_URL || 'http://127.0.0.1:3011/preview.html';

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.log('· 未安装 playwright-core，跳过浏览器实测');
  process.exit(0);
}

const failures = [];
const check = (label, ok, detail = '') => {
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? `  [${detail}]` : ''}`);
};

// 夹具运行时生成（*.dxf 不入库），不依赖任何本地样例文件。
const { materializeFixtures } = await import('./fixtures.mjs');
const fixtures = await materializeFixtures('dxfviewer-preview-');
const sample = fixtures.files['special-codes.dxf'];

const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 1 });

const consoleErrors = [];
const badRequests = [];
page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('pageerror', err => consoleErrors.push(String(err)));
page.on('response', res => {
  if (res.status() >= 400 && !/favicon/i.test(res.url())) badRequests.push(`${res.status()} ${res.url()}`);
});

await page.goto(BASE, { waitUntil: 'networkidle' });

const structure = await page.evaluate(() => ({
  canvases: document.querySelectorAll('.dxf-preview canvas').length,
  chrome: document.querySelectorAll('[role="toolbar"], .ui-toolbar-row, .side-panel-frame, .status-bar').length,
}));
check('挂载画布（几何画布 + 可选文字覆盖层）', structure.canvases >= 1 && structure.canvases <= 2, `canvas=${structure.canvases}`);
check('无工具栏 / 侧栏 / 状态栏', structure.chrome === 0, `匹配=${structure.chrome}`);

/**
 * 画布统计：用页面截图的合成结果统计「墨迹」占比。
 *
 * 不能用 `drawImage(webglCanvas)`：WebGL 画布未开 preserveDrawingBuffer，
 * 合成后读回是空白；而且文字覆盖层模式下画布有两块（GPU 几何 + Canvas 文字），
 * 只有截屏能拿到最终显示效果。
 */
const inkStats = async () => {
  const box = await page.locator('.dxf-preview').boundingBox();
  if (!box || box.width < 2 || box.height < 2) return null;
  const shot = await page.screenshot({
    clip: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) },
  });
  return page.evaluate(async (src) => {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = src;
    });
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    const bg = [data[0], data[1], data[2]];
    let ink = 0;
    let sampled = 0;
    for (let i = 0; i < data.length; i += 4 * 7) { // 稀疏采样，够用且快
      sampled++;
      const dr = Math.abs(data[i] - bg[0]);
      const dg = Math.abs(data[i + 1] - bg[1]);
      const db = Math.abs(data[i + 2] - bg[2]);
      if (dr + dg + db > 60) ink++;
    }
    return {
      bg,
      inkRatio: ink / Math.max(1, sampled),
      corner: [data[0], data[1], data[2]],
    };
  }, `data:image/png;base64,${shot.toString('base64')}`);
};

await page.locator('input[type="file"]').setInputFiles(sample);
await page.waitForTimeout(2600);

const initial = await inkStats();
check('加载后画布有内容', !!initial && initial.inkRatio > 0.005, initial ? `墨迹占比=${(initial.inkRatio * 100).toFixed(2)}%` : '无画布');

// 充满视图（双击 = fit）后仍应有内容：远景文字不应整幅消失
await page.locator('.dxf-preview').dblclick();
await page.waitForTimeout(1200);
const fitted = await inkStats();
check('充满视图后仍有内容', !!fitted && fitted.inkRatio > 0.002, fitted ? `墨迹占比=${(fitted.inkRatio * 100).toFixed(2)}%` : '无画布');

// 滚轮缩放
const box = await page.locator('.dxf-preview').boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.wheel(0, -700);
await page.waitForTimeout(1000);
const zoomed = await inkStats();
check(
  '滚轮缩放改变画面',
  !!zoomed && Math.abs(zoomed.inkRatio - fitted.inkRatio) > 1e-4,
  `${((fitted?.inkRatio ?? 0) * 100).toFixed(2)}% → ${((zoomed?.inkRatio ?? 0) * 100).toFixed(2)}%`,
);

// 主题切换：深色 → #212121
await page.getByRole('button', { name: '深色' }).click();
await page.waitForTimeout(900);
const dark = await inkStats();
check('深色主题为 #212121 黑底', !!dark && dark.corner.join(',') === '33,33,33', dark?.corner.join(','));

check('无失败资源请求', badRequests.length === 0, badRequests.slice(0, 2).join(' | '));
check('无控制台错误', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));

fs.mkdirSync(path.join(ROOT, 'artifacts', 'preview'), { recursive: true });
await page.screenshot({ path: path.join(ROOT, 'artifacts', 'preview', 'dark.png') }).catch(() => {});
await browser.close();
await fixtures.cleanup();

console.log(failures.length === 0 ? '\n预览组件实测全部通过。' : `\n失败 ${failures.length} 项：\n${failures.map(f => ` - ${f}`).join('\n')}`);
process.exit(failures.length === 0 ? 0 : 1);