/**
 * 夹具自检：解析 samples/dxf/*.dxf，打印实体统计。
 *
 * 用途：验证夹具本身合法、解析器对夹具的覆盖符合预期。
 * 运行：node scripts/check-fixtures.mjs（需先 npm run build:lib）
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '..');
const dir = join(root, 'samples', 'dxf');

const { parseDxf } = await import(new URL('../dist/parser.js', import.meta.url).href);

const files = readdirSync(dir).filter(name => name.endsWith('.dxf')).sort();
if (files.length === 0) {
  console.error('未找到夹具文件：samples/dxf/*.dxf');
  process.exit(1);
}

let failed = 0;

for (const name of files) {
  const text = readFileSync(join(dir, name), 'utf8');
  try {
    const data = await parseDxf(text, undefined, { yieldIntervalMs: 0 });
    const counts = new Map();
    for (const entity of data.entities) {
      counts.set(entity.type, (counts.get(entity.type) ?? 0) + 1);
    }
    const layers = Object.keys(data.layers).join(',') || '-';
    const blocks = Object.keys(data.blocks).join(',') || '-';
    const summary = [...counts.entries()].map(([type, n]) => `${type}×${n}`).join(' ') || '（空）';
    const ext = data.extents;
    const extText = ext
      ? `${ext.min.x.toFixed(2)},${ext.min.y.toFixed(2)} → ${ext.max.x.toFixed(2)},${ext.max.y.toFixed(2)}`
      : '无';
    console.log(`✔ ${name}`);
    console.log(`   实体: ${data.entities.length}  [${summary}]`);
    console.log(`   布局: ${data.layouts.map(l => l.name).join(',')} | 图层: ${layers} | 块: ${blocks}`);
    console.log(`   范围: ${extText} | offset: ${data.offset ? `${data.offset.x},${data.offset.y}` : '无'}`);
  } catch (error) {
    failed++;
    console.error(`✘ ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(`\n共 ${files.length} 个夹具，失败 ${failed} 个。`);
process.exit(failed === 0 ? 0 : 1);
