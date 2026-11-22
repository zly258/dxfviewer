/**
 * End-to-end checks for the example viewer.
 *
 * Starts the local server, loads the bundled all-element showcase drawing and
 * verifies the behaviour that cannot be covered by the unit tests:
 *   - the viewer opens in English and can be switched to Chinese
 *   - the language choice survives a reload
 *   - every element type in the showcase is pickable
 *   - a block reference is selected as a whole and lists its attributes
 *   - the wheel zoom step is more sensitive than before
 *
 * Run with:  node scripts/test-e2e.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.E2E_PORT || 3111);
const URL = `http://127.0.0.1:${PORT}/examples/index.html`;

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.log('[e2e] playwright-core is not installed — skipping the browser checks');
  process.exit(0);
}

const fail = [];
const ok = (cond, msg) => {
  console.log((cond ? '  [PASS] ' : '  [FAIL] ') + msg);
  if (!cond) fail.push(msg);
};

// ---------------------------------------------------------------- server
const server = spawn(process.execPath, [path.join(rootDir, 'scripts', 'serve.mjs')], {
  cwd: rootDir,
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore'
});

const stopServer = () => { try { server.kill(); } catch (_) {} };
process.on('exit', stopServer);

async function waitForServer(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(URL);
      if (res.ok) return true;
    } catch (_) {}
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

if (!await waitForServer()) {
  console.error('[e2e] the local server did not start');
  stopServer();
  process.exit(1);
}

let browser;
try {
  browser = await chromium.launch({ channel: process.env.E2E_CHANNEL || 'chrome', headless: true });
} catch (err) {
  console.log('[e2e] no Chrome/Chromium available — skipping browser checks (' + (err && err.message ? err.message.split('\n')[0] : err) + ')');
  stopServer();
  process.exit(0);
}
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push('console: ' + m.text()); });

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  console.log('[e2e] language');
  const lang0 = await page.evaluate(() => ({
    btn: (document.getElementById('btnLangToggle') || {}).textContent,
    sample: (document.getElementById('lblSample1') || {}).textContent
  }));
  ok(lang0.btn.trim() === '中文', 'the viewer opens in English');
  ok(/Planetary/i.test(lang0.sample), 'the sample titles are English by default');

  await page.click('#btnLangToggle');
  await page.waitForTimeout(300);
  const lang1 = await page.evaluate(() => ({
    btn: (document.getElementById('btnLangToggle') || {}).textContent,
    sample: (document.getElementById('lblSample1') || {}).textContent
  }));
  ok(lang1.btn.trim() === 'EN', 'the viewer switches to Chinese');
  ok(/行星/.test(lang1.sample), 'the sample titles switch to Chinese');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  const lang2 = await page.evaluate(() => (document.getElementById('btnLangToggle') || {}).textContent);
  ok(lang2.trim() === 'EN', 'the language choice survives a reload');
  await page.click('#btnLangToggle');
  await page.waitForTimeout(300);

  console.log('[e2e] the all-element showcase');
  await page.evaluate(() => document.querySelector('[data-preset="elements_2d"]').click());
  await page.waitForFunction(() => {
    const el = document.getElementById('statsSummaryReadout');
    return el && /[0-9]/.test(el.textContent || '');
  }, null, { timeout: 60000 });
  await page.waitForTimeout(2000);
  const stats = await page.evaluate(() => (document.getElementById('statsSummaryReadout') || {}).textContent);
  console.log('  stats:', stats);
  ok(/125 Entities/.test(stats), 'the showcase loads with 125 entities');

  console.log('[e2e] picking');
  const box = await page.locator('canvas').first().boundingBox();
  const found = new Map();
  for (let gx = 0.03; gx <= 0.97 && found.size < 16; gx += 0.02) {
    for (let gy = 0.05; gy <= 0.95 && found.size < 16; gy += 0.02) {
      await page.mouse.click(box.x + box.width * gx, box.y + box.height * gy);
      const info = await page.evaluate(() => {
        const body = document.getElementById('propertyPanelBody');
        if (!body) return null;
        const txt = body.innerText || '';
        if (/未选择|No object/i.test(txt)) return null;
        const lines = txt.split('\n');
        const get = (re) => { for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) return (lines[i + 1] || '').trim(); return ''; };
        return { type: get(/^Type$|^类型$/), block: get(/Block Name$|^块名$/), attrib: /ATTRIB/i.test(txt) };
      });
      if (info && !found.has(info.type)) found.set(info.type, info);
    }
  }
  console.log('  picked:', [...found.keys()].join(', '));
  for (const t of ['LINE', 'CIRCLE', 'ARC', 'ELLIPSE', 'SPLINE', 'LWPOLYLINE', 'POLYLINE', 'TEXT', 'MTEXT', 'DIMENSION', 'LEADER', 'HATCH', 'INSERT']) {
    ok(found.has(t), `the element type ${t} is pickable`);
  }
  const block = found.get('INSERT');
  ok(!!block && block.block === 'TAG_BLOCK', 'a block member selects the whole block reference');
  ok(!!block && block.attrib === true, 'the block attributes are listed in the property panel');

  console.log('[e2e] zoom');
  const zoomBase = await page.evaluate(() => {
    const src = Array.from(document.querySelectorAll('script')).map(s => s.textContent).join('\n');
    const m = /Math\.pow\(([0-9.]+),\s*delta\)/.exec(src);
    return m ? Number(m[1]) : null;
  });
  ok(zoomBase !== null && Math.pow(zoomBase, 100) > 1.09, 'the wheel zoom step scales with the wheel delta');

  ok(errors.length === 0, 'no runtime errors were raised' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
} finally {
  await browser.close();
  stopServer();
}

console.log(fail.length ? `\n[e2e] ${fail.length} check(s) failed` : '\n[e2e] all checks passed');
process.exit(fail.length ? 1 : 0);
