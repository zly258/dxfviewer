/**
 * 如果 public/fonts 里放了 hztxt.shx / tssdeng.shx，就检查能解析出字形。
 * 没有这些文件时跳过（字体不入库，由使用者自己放进 fonts 目录）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'dxfviewer-example', 'public', 'fonts');
const hztxt = path.join(dir, 'hztxt.shx');
const tssdeng = path.join(dir, 'tssdeng.shx');

if (!fs.existsSync(hztxt) || !fs.existsSync(tssdeng)) {
  console.log('· 未找到 fonts/hztxt.shx 或 fonts/tssdeng.shx，跳过 SHX 字形校验');
  process.exit(0);
}

const { parseShxFont } = await import(new URL('../dist/render.js', import.meta.url).href);
const asBuffer = (file) => {
  const b = fs.readFileSync(file);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? `  [${detail}]` : ''}`);
  if (!ok) failed++;
};

const eng = parseShxFont(asBuffer(tssdeng));
const hz = parseShxFont(asBuffer(hztxt));
check('tssdeng 能解析且含字母 H', eng.glyphs.has(72) && (eng.glyphs.get(72)?.strokes.length ?? 0) > 0,
  `字形 ${eng.glyphs.size}，字高 ${eng.capHeight}`);
check('hztxt 是大字体且汉字够多', hz.isBigFont && hz.glyphs.size > 5000 && hz.capHeight > 0,
  `字形 ${hz.glyphs.size}，字高 ${hz.capHeight}`);

const dec = new TextDecoder('gbk');
let she = 0;
for (let hi = 0x81; hi <= 0xFE && !she; hi++) {
  for (let lo = 0x40; lo <= 0xFE; lo++) {
    if (lo === 0x7F) continue;
    if (dec.decode(Uint8Array.from([hi, lo])) === '设') {
      she = (hi << 8) | lo;
      break;
    }
  }
}
const glyph = hz.glyphs.get(she);
check('hztxt 含「设」的单线笔画', !!glyph && glyph.strokes.length > 0 && glyph.advance === hz.capHeight,
  glyph ? `笔画 ${glyph.strokes.length}，步进 ${glyph.advance}` : '没有这个形');

console.log(failed === 0 ? '\nSHX 字体校验通过。' : `\n失败 ${failed} 项。`);
process.exit(failed === 0 ? 0 : 1);
