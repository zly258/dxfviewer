/** 统计真实图纸里块内文字 / 属性文字的坐标，判断该用世界坐标还是块变换。 */
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

const summarize = (data) => {
  let blockText = 0;
  let inserts = 0;
  let attribs = 0;
  let attribPreferMoved = 0;
  let attribPreferRaw = 0;
  const samples = [];
  const countBlock = (block, depth = 0) => {
    if (!block || depth > 4) return;
    for (const e of block.entities || []) {
      if (['TEXT', 'MTEXT', 'ATTRIB', 'ATTDEF'].includes(e.type) && e.value) blockText++;
      if (e.type === 'INSERT' && data.blocks?.[e.blockName]) countBlock(data.blocks[e.blockName], depth + 1);
    }
  };
  for (const b of Object.values(data.blocks || {})) countBlock(b);
  for (const e of data.entities || []) {
    if (e.type !== 'INSERT') continue;
    inserts++;
    const attrs = e.attributes || [];
    if (!attrs.length) continue;
    const block = data.blocks?.[e.blockName];
    const bx = block?.basePoint?.x || 0;
    const by = block?.basePoint?.y || 0;
    const sx = e.scale?.x || 1;
    const sy = e.scale?.y || 1;
    const rot = (e.rotation || 0) * Math.PI / 180;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const xf = (p) => {
      const dx = (p.x - bx) * sx;
      const dy = (p.y - by) * sy;
      return { x: e.position.x + dx * cos - dy * sin, y: e.position.y + dx * sin + dy * cos };
    };
    for (const a of attrs) {
      if (!a.position || !String(a.value || '').trim()) continue;
      attribs++;
      const moved = xf(a.position);
      const distRaw = Math.hypot(a.position.x - e.position.x, a.position.y - e.position.y);
      const distMoved = Math.hypot(moved.x - e.position.x, moved.y - e.position.y);
      if (distMoved < distRaw) attribPreferMoved++;
      else attribPreferRaw++;
      if (samples.length < 3 && distMoved !== distRaw) {
        samples.push({
          block: e.blockName,
          value: String(a.value).slice(0, 20),
          raw: [Math.round(a.position.x), Math.round(a.position.y)],
          moved: [Math.round(moved.x), Math.round(moved.y)],
          insert: [Math.round(e.position.x), Math.round(e.position.y)],
          prefer: distMoved < distRaw ? 'moved' : 'raw',
        });
      }
    }
  }
  return { blockText, inserts, attribs, attribPreferMoved, attribPreferRaw, samples };
};

for (const file of files.sort()) {
  let data;
  try { data = await parseDxf(decode(fs.readFileSync(file)), undefined, { yieldIntervalMs: 0 }); }
  catch { console.log('ERR', path.basename(file)); continue; }
  const s = summarize(data);
  if (s.blockText || s.attribs) {
    console.log(`${String(s.blockText).padStart(6)} blockText  ${String(s.attribs).padStart(5)} attrib  raw ${s.attribPreferRaw} moved ${s.attribPreferMoved}  ${path.basename(file)}`);
    for (const sample of s.samples) console.log('   ', JSON.stringify(sample));
  }
}
