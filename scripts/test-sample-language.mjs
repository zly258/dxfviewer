/**
 * End-to-end check that sample drawings follow the UI language.
 *
 * Switches each bilingual preset between English and Chinese and verifies
 * that the rendered drawing changes (the text labels are localized).
 *
 * Run:  node scripts/test-sample-language.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.E2E_LANG_PORT || 3112);
const URL = `http://127.0.0.1:${PORT}/examples/index.html`;

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.log('[lang-e2e] playwright-core is not installed — skipping');
  process.exit(0);
}

const fail = [];
const ok = (c, m) => {
  console.log((c ? '  [PASS] ' : '  [FAIL] ') + m);
  if (!c) fail.push(m);
};

const server = spawn(process.execPath, [path.join(rootDir, 'scripts', 'serve.mjs')], {
  cwd: rootDir,
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore'
});
const stop = () => { try { server.kill(); } catch (_) {} };
process.on('exit', stop);

async function waitForServer(timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if ((await fetch(URL)).ok) return true; } catch (_) {}
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}
if (!await waitForServer()) {
  console.error('[lang-e2e] server did not start');
  stop();
  process.exit(1);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  ok((await page.evaluate(() => document.getElementById('btnLangToggle').textContent)).trim() === '中文',
    'the viewer opens in English');

  async function loadPreset(key) {
    await page.click('#btnSampleDropdown');
    await page.waitForTimeout(200);
    await page.click(`[data-preset="${key}"]`);
    await page.waitForFunction(() => {
      const el = document.getElementById('statsSummaryReadout');
      return el && /[0-9]/.test(el.textContent || '');
    }, null, { timeout: 120000 });
    await page.waitForTimeout(2200);
  }

  const dir = path.join(rootDir, 'artifacts', 'visual');
  fs.mkdirSync(dir, { recursive: true });

  for (const key of ['elements_2d', 'elements_3d', 'huge_2d']) {
    await loadPreset(key);
    const box = await page.locator('canvas').first().boundingBox();
    const shot = async (lang) => {
      const p = path.join(dir, `lang-${key}-${lang}.png`);
      await page.screenshot({ path: p, clip: box });
      return fs.statSync(p).size;
    };
    const en = await shot('en');
    await page.click('#btnLangToggle');
    await page.waitForTimeout(3800);
    const zh = await shot('zh');
    ok(en !== zh, `${key}: the drawing labels change with the language`);
    await page.click('#btnLangToggle');
    await page.waitForTimeout(1500);
  }
  ok(errors.length === 0, 'no runtime errors were raised' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
} finally {
  await browser.close();
  stop();
}

console.log(fail.length ? `\n[lang-e2e] ${fail.length} check(s) failed` : '\n[lang-e2e] all checks passed');
process.exit(fail.length ? 1 : 0);
