/**
 * 夹具自检：解析内置夹具（运行时生成到临时目录），打印实体统计。
 *
 * 用途：验证夹具本身合法、解析器对夹具的覆盖符合预期。
 * 运行：node scripts/check-fixtures.mjs（需先 npm run build:lib）
 */
import { readFileSync } from 'node:fs';
import { materializeFixtures } from './fixtures.mjs';

const { parseDxf } = await import(new URL('../dist/parser.js', import.meta.url).href);

const fixtures = await materializeFixtures('dxfviewer-check-');
const fileNames = Object.keys(fixtures.files).sort();

let failed = 0;

try {
  for (const name of fileNames) {
    const text = readFileSync(fixtures.files[name], 'utf8');
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
} finally {
  await fixtures.cleanup();
}

console.log(`\n共 ${fileNames.length} 个夹具，失败 ${failed} 个。`);
process.exit(failed === 0 ? 0 : 1);
