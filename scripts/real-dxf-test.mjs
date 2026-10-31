/**
 * 真实 DXF 批量测试（手动运行，不进 check 链）。
 *
 * 递归收集目录下全部 *.dxf，对每个文件执行与应用一致的完整链路：
 *   解码（utf-8 失败回退 gb18030，与 TEXT_DECODER_CONFIG 一致）
 *   → parseDxf 计时
 *   → createSceneIndex 计时
 *   → renderEntitiesToCanvas 影子渲染计时 + 绘制调用计数
 *   → exportSvg NaN/Infinity 扫描
 *   → writeDxf 写出还原（输出到 os.tmpdir，源目录只读不写）
 *
 * 用法：node scripts/real-dxf-test.mjs <目录>
 */
import { performance } from 'node:perf_hooks';
import { readFileSync, readdirSync, statSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = process.argv[2];
if (!root) {
  console.error('用法：node scripts/real-dxf-test.mjs <目录>');
  process.exit(1);
}

const { parseDxf } = await import(new URL('../dist/parser.js', import.meta.url).href);
const { renderEntitiesToCanvas, createSceneIndex } = await import(new URL('../dist/render.js', import.meta.url).href);
const { exportSvg } = await import(new URL('../dist/export.js', import.meta.url).href);
const { writeDxf } = await import(new URL('../dist/writer.js', import.meta.url).href);
const { createFakeCanvas } = await import('./canvas-mock.mjs');

// ── 收集 DXF（只读） ────────────────────────────────────────────
const collectDxf = dir => {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...collectDxf(full));
    else if (name.toLowerCase().endsWith('.dxf')) out.push(full);
  }
  return out;
};

const files = collectDxf(root).sort();
if (files.length === 0) {
  console.error(`未找到 DXF：${root}`);
  process.exit(1);
}

// 与应用一致的解码：utf-8 严格失败回退 gb18030
const decodeDxf = buffer => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('gb18030').decode(buffer);
  }
};

const tmpOut = mkdtempSync(join(tmpdir(), 'dxfviewer-real-'));
let failed = 0;
const rows = [];

for (const path of files) {
  const rel = path.slice(root.length + 1);
  try {
    const buffer = readFileSync(path);
    const text = decodeDxf(buffer);

    let t0 = performance.now();
    const data = await parseDxf(text, undefined, { yieldIntervalMs: 0 });
    const parseMs = performance.now() - t0;

    t0 = performance.now();
    const index = createSceneIndex(data.entities);
    const indexMs = performance.now() - t0;

    const center = data.extents?.center ?? { x: 0, y: 0 };
    t0 = performance.now();
    const { canvas, counter } = createFakeCanvas(1280, 800);
    renderEntitiesToCanvas({
      ctx: canvas.getContext('2d'),
      entities: data.entities,
      layers: data.layers,
      blocks: data.blocks,
      styles: data.styles,
      lineTypes: data.lineTypes,
      ltScale: data.header?.ltScale ?? 1,
      viewPort: { targetX: center.x, targetY: center.y, zoom: Math.max(data.extents ? 1280 / data.extents.width : 1, 1e-6) },
      width: 1280,
      height: 800,
      theme: 'white',
      sceneIndex: index,
    });
    const renderMs = performance.now() - t0;
    const draws = counter.stroke + counter.fill + counter.fillText + counter.strokeText;
    if (draws === 0) throw new Error('渲染未产生绘制调用');

    // SVG 导出扫描：真实图纸中最容易暴露 NaN/Infinity 类几何缺陷
    const svg = exportSvg(data, { width: 2560, height: 1600, background: '#ffffff' });
    if (/NaN|undefined|Infinity/.test(svg)) throw new Error('SVG 含非法数值（NaN/undefined/Infinity）');
    if (!svg.startsWith('<svg') || !svg.trimEnd().endsWith('</svg>')) throw new Error('SVG 结构不完整');

    // 写出还原（输出到临时目录，源目录零写入）
    const { content, skipped } = writeDxf(data);
    const outPath = join(tmpOut, rel.replace(/[\\/:*?"<>|]/g, '_') + '.out.dxf');
    writeFileSync(outPath, content, 'utf8');
    const reparsed = await parseDxf(content, undefined, { yieldIntervalMs: 0 });
    const before = data.entities.length;
    const after = reparsed.entities.length;
    // 写出器对 LEADER/REGION/SHAPE 等类型是已知的跳过限制（skipped 报告，
    // 含块内实体）。超出报告范围的丢失才视为问题。
    const loss = before - after;
    if (loss > skipped.length) {
      throw new Error(`写出还原丢失 ${loss} 个实体，超出 skipped 报告 ${skipped.length}`);
    }

    rows.push({
      rel,
      size: buffer.length,
      parseMs,
      indexMs,
      renderMs,
      draws,
      entities: before,
      layers: Object.keys(data.layers).length,
      blocks: Object.keys(data.blocks).length,
      layouts: (data.layouts ?? []).length,
      texts: data.entities.filter(e => ['TEXT', 'MTEXT', 'ATTRIB'].includes(e.type)).length,
      skipped: skipped.length,
      loss,
      svgKB: Math.round(svg.length / 1024),
    });
  } catch (error) {
    failed++;
    console.error(`✘ ${rel}：${error instanceof Error ? error.message : String(error)}`);
  }
}

const pad = (v, w) => String(v).padEnd(w);
console.log(
  pad('文件', 40) + pad('大小', 10) + pad('解析', 9) + pad('索引', 8) + pad('渲染', 9)
  + pad('实体', 9) + pad('图层', 7) + pad('块', 6) + pad('布局', 6) + pad('文字', 7) + pad('跳过', 6) + '绘制',
);
for (const r of rows) {
  console.log(
    pad(r.rel.length > 38 ? '…' + r.rel.slice(-37) : r.rel, 40)
    + pad(`${(r.size / 1024 / 1024).toFixed(1)}MB`, 10)
    + pad(`${r.parseMs.toFixed(0)}ms`, 9)
    + pad(`${r.indexMs.toFixed(0)}ms`, 8)
    + pad(`${r.renderMs.toFixed(1)}ms`, 9)
    + pad(r.entities, 9) + pad(r.layers, 7) + pad(r.blocks, 6) + pad(r.layouts, 6)
    + pad(r.texts, 7) + pad(r.skipped, 6) + r.draws,
  );
}

const totalParse = rows.reduce((s, r) => s + r.parseMs, 0);
console.log(`\n共 ${files.length} 个文件，失败 ${failed} 个；解析总耗时 ${totalParse.toFixed(0)} ms。`);
console.log(`写出还原输出（临时）：${tmpOut}`);
rmSync(tmpOut, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
