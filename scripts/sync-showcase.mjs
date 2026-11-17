/**
 * Keeps the DXF drawings that are embedded in the example app in sync with
 * the files under examples/samples.
 *
 * The example is a single self-contained HTML file, so the sample drawings
 * have to be embedded as strings. This script copies the current file content
 * into the matching preset, so editing a sample on disk and running
 *   node scripts/make-showcase.mjs && node scripts/sync-showcase.mjs
 * updates both.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const htmlFile = path.join(rootDir, 'examples', 'index.html');

const PRESETS = [
  { key: 'elements_2d', file: 'elements_showcase_2d.dxf' },
  { key: 'elements_3d', file: 'elements_showcase_3d.dxf' }
];

let html = fs.readFileSync(htmlFile, 'utf8');
let changed = 0;

for (const { key, file } of PRESETS) {
  const dxfPath = path.join(rootDir, 'examples', 'samples', file);
  if (!fs.existsSync(dxfPath)) {
    console.log(`[sync-showcase] ${file} not found — skipped`);
    continue;
  }
  const dxfText = fs.readFileSync(dxfPath, 'utf8');

  const k = html.indexOf(`"${key}": {`);
  if (k < 0) {
    console.log(`[sync-showcase] preset ${key} not found — skipped`);
    continue;
  }
  const dxfKey = html.indexOf('"dxf": ', k);
  if (dxfKey < 0) continue;
  const start = dxfKey + '"dxf": '.length;

  let inStr = false, esc = false, end = -1;
  for (let p = start; p < html.length; p++) {
    const ch = html[p];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = false; end = p; break; }
    } else if (ch === '"') inStr = true;
  }
  if (end < 0) {
    console.error(`[sync-showcase] could not find the end of the ${key} DXF string`);
    process.exit(1);
  }

  const wanted = JSON.stringify(dxfText);
  const current = html.slice(start, end + 1);
  if (current === wanted) {
    console.log(`[sync-showcase] ${key} is already up to date`);
    continue;
  }
  html = html.slice(0, start) + wanted + html.slice(end + 1);
  changed++;
  console.log(`[sync-showcase] updated ${key} (${current.length} → ${wanted.length} chars)`);
}

if (changed) {
  fs.writeFileSync(htmlFile, html);
  console.log(`[sync-showcase] ${changed} preset(s) updated`);
} else {
  console.log('[sync-showcase] nothing to do');
}
