/**
 * Keeps the DXF drawings embedded in the example app in sync with the files
 * under examples/samples.
 *
 * Each bilingual preset carries three payloads:
 *   dxf      — the English drawing (backwards-compatible fallback)
 *   dxf_en   — the English drawing
 *   dxf_zh   — the Chinese drawing
 *
 * This script only replaces the *value* of existing fields — it never touches
 * the surrounding object structure, so it is safe to run repeatedly.
 *
 * Run:  node scripts/sync-showcase.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const htmlFile = path.join(rootDir, 'examples', 'index.html');

const PRESETS = [
  { key: 'elements_2d', en: 'elements_showcase_2d.dxf', zh: 'elements_showcase_2d_zh.dxf' },
  { key: 'elements_3d', en: 'elements_showcase_3d.dxf', zh: 'elements_showcase_3d_zh.dxf' },
  { key: 'huge_2d', en: 'plant_layout_huge_2d.dxf', zh: 'plant_layout_huge_2d_zh.dxf' }
];

function findStringEnd(src, from) {
  let inStr = false, esc = false;
  for (let p = from; p < src.length; p++) {
    const ch = src[p];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') return p;
    } else if (ch === '"') inStr = true;
  }
  return -1;
}

let html = fs.readFileSync(htmlFile, 'utf8');
let changed = 0;

// The preset may be embedded in the HTML or registered lazily at runtime;
// replace every occurrence of the field value to cover both.
for (const preset of PRESETS) {
  for (const [field, file] of [['dxf_en', preset.en], ['dxf_zh', preset.zh]]) {
    const p = path.join(rootDir, 'examples', 'samples', file);
    if (!fs.existsSync(p)) {
      console.log(`[sync-showcase] ${file} missing — skipped`);
      continue;
    }
    const wanted = JSON.stringify(fs.readFileSync(p, 'utf8'));
    const fieldPrefix = `"${field}": `;
    let pos = 0;
    while ((pos = html.indexOf(fieldPrefix, pos)) >= 0) {
      const start = pos + fieldPrefix.length;
      const end = findStringEnd(html, start);
      if (end < 0) break;
      const current = html.slice(start, end + 1);
      if (current !== wanted) {
        html = html.slice(0, start) + wanted + html.slice(end + 1);
        changed++;
        console.log(`[sync-showcase] updated ${field} from ${file}`);
      }
      pos = end + 1;
    }
  }
}

if (changed) {
  fs.writeFileSync(htmlFile, html);
  console.log(`[sync-showcase] ${changed} field(s) updated`);
} else {
  console.log('[sync-showcase] nothing to do');
}
