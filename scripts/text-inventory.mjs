/** 统计每张图纸的文字：能否打开、样式、字体、一条可放大的样例。 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2];
const { parseDxf } = await import(new URL('../dist/parser.js', import.meta.url).href);
const files = [];
const walk = (d) => {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.dxf$/i.test(n)) files.push(p);
  }
};
walk(root);

const decode = (b) => {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); }
  catch { return new TextDecoder('gb18030').decode(b); }
};

const rows = [];
for (const file of files.sort()) {
  const buf = fs.readFileSync(file);
  const rel = path.relative(root, file);
  let data;
  try {
    data = await parseDxf(decode(buf), undefined, { yieldIntervalMs: 0 });
  } catch (error) {
    rows.push({ file: rel, ok: false, error: error.message.split('\n')[0] });
    console.log('ERR', rel);
    continue;
  }
  const texts = [];
  const styles = {};
  const visit = (e) => {
    if (!e || !['TEXT', 'MTEXT', 'ATTRIB'].includes(e.type)) return;
    const value = String(e.value || '').replace(/\s+/g, ' ').trim();
    if (!value) return;
    texts.push(e);
    const style = data.styles?.[e.styleName] || data.styles?.[String(e.styleName || '').toUpperCase()] || {};
    const key = `${e.styleName || ''}|${style.fontFileName || ''}|${style.bigFontFileName || ''}`;
    styles[key] = (styles[key] || 0) + 1;
  };
  for (const e of data.entities || []) visit(e);
  const sample = texts.find(e => /[\u4e00-\u9fff]/.test(e.value || '') && (e.height || 0) >= 2)
    || texts.find(e => (e.value || '').length >= 2)
    || null;
  rows.push({
    file: rel,
    ok: true,
    model: data.entities?.length || 0,
    texts: texts.length,
    styles,
    sample: sample ? {
      type: sample.type,
      value: String(sample.value).replace(/\s+/g, ' ').slice(0, 40),
      x: sample.position?.x,
      y: sample.position?.y,
      h: sample.height,
      style: sample.styleName,
      rot: sample.rotation || 0,
    } : null,
  });
  console.log('OK', String(texts.length).padStart(6), rel);
}
const out = path.resolve('artifacts/text-inventory.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(rows, null, 2));
console.log('wrote', out, 'files', rows.length, 'fail', rows.filter(r => !r.ok).length);
