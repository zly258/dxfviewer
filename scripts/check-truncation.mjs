/**
 * 检查截断检测的准确性：目录内每个 DXF 应被正确判定为「完整」或「截断」。
 * 预期：4 个 JQG142401-FCS01.x 文件为截断，其余完整。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const { parseDxf } = await import(new URL('../dist/parser.js', import.meta.url).href);

const root = process.argv[2];
const collect = dir => {
  const out = [];
  for (const n of readdirSync(dir)) {
    const full = join(dir, n);
    if (statSync(full).isDirectory()) out.push(...collect(full));
    else if (n.toLowerCase().endsWith('.dxf')) out.push(full);
  }
  return out;
};
const decode = b => { try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return new TextDecoder('gb18030').decode(b); } };

let truncated = 0, ok = 0;
for (const f of collect(root).sort()) {
  const text = decode(readFileSync(f));
  let verdict = '完整', err = null;
  try {
    const d = await parseDxf(text, undefined, { yieldIntervalMs: 0 });
    if (d.entities.length === 0 && (d.allEntities?.length ?? 0) === 0) verdict = '空图(0 实体)';
    else verdict = `完整(${d.entities.length} 实体)`;
  } catch (e) {
    verdict = '拒绝打开';
    err = e.message;
    truncated++;
  }
  if (verdict.startsWith('完整')) ok++;
  console.log(`${verdict.startsWith('拒绝') || verdict.startsWith('空图') ? '✗' : '✓'} ${verdict}  ${f.replace(root, '')}`);
  if (err) console.log(`     ${err}`);
}
console.log(`\n可打开 ${ok} 个，拒绝 ${truncated} 个。`);
