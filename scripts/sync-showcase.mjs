import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const htmlFile = path.join(rootDir, 'examples', 'index.html');
const dxfFile = path.join(rootDir, 'examples', 'samples', 'elements_showcase_2d.dxf');

const html = fs.readFileSync(htmlFile, 'utf8');
const dxfText = fs.readFileSync(dxfFile, 'utf8');

// Locate the embedded copy of the showcase drawing inside PRESETS.
const key = '"elements_2d": {';
const k = html.indexOf(key);
if (k < 0) {
  console.error('[sync-showcase] elements_2d preset not found');
  process.exit(1);
}
const dxfKey = html.indexOf('"dxf": ', k);
const start = dxfKey + '"dxf": '.length;
// The embedded value is a JSON string literal: find its closing quote.
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
  console.error('[sync-showcase] could not find the end of the embedded DXF string');
  process.exit(1);
}

const current = html.slice(start, end + 1);
const wanted = JSON.stringify(dxfText);
if (current === wanted) {
  console.log('[sync-showcase] already up to date');
  process.exit(0);
}
const out = html.slice(0, start) + wanted + html.slice(end + 1);
fs.writeFileSync(htmlFile, out);
console.log(`[sync-showcase] updated the embedded showcase drawing (${current.length} → ${wanted.length} chars)`);
