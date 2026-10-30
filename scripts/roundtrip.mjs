/**
 * DXF 写出器往返测试。
 *
 * 对 samples/dxf/*.dxf 逐个执行：
 *   parse → writeDxf(AC1015) → parse → 逐实体几何比对
 *
 * 校验项：
 * 1. 组码结构合法（奇数行是组码、可解析为整数）
 * 2. 句柄唯一，且 330/331/340/350/360 引用全部指向存在的句柄
 * 3. 实体总数与类型分布一致
 * 4. 逐实体几何签名一致（坐标保留 4 位小数比较）
 * 5. 图层 / 文字样式 / 线型 名称集合一致
 * 6. 块名与块内实体数一致
 * 7. AC1009 (R12) 降级模式可解析、不崩溃
 *
 * 运行：node scripts/roundtrip.mjs（需先 npm run build:lib）
 * 夹具运行时生成到临时目录（DXF 不入库），结束自动清理。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { materializeFixtures } from './fixtures.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '..');
const outputDir = join(root, 'samples', 'dxf-output');

const { parseDxf } = await import(new URL('../dist/parser.js', import.meta.url).href);
const { writeDxf, createDocument } = await import(new URL('../dist/writer.js', import.meta.url).href);

const r4 = value => (Number.isFinite(value) ? Math.round(value * 1e4) / 1e4 : value);
/** 按数据集 offset 平移坐标：raw 回放的几何在源绝对坐标系，与常规解析的查看器坐标系对齐。 */
const makePointFormatter = offset => {
  const ox = offset?.x ?? 0;
  const oy = offset?.y ?? 0;
  return point => (point ? `${r4(point.x + ox)},${r4(point.y + oy)}` : '-');
};

/** 逐实体几何签名：只取参与比对的稳定字段，忽略 id / 计算缓存 / 包围盒。 */
const entitySignature = (entity, fmt) => {
  const pf = fmt ?? (point => `${r4(point?.x)},${r4(point?.y)}`);
  const pt = point => pf(point);
  const base = `${entity.type}|${entity.layer}`;
  switch (entity.type) {
    case 'LINE':
      return `${base}|${pt(entity.start)}|${pt(entity.end)}`;
    case 'POINT':
      return `${base}|${pt(entity.position)}`;
    case 'CIRCLE':
      return `${base}|${pt(entity.center)}|${r4(entity.radius)}`;
    case 'ARC':
      return `${base}|${pt(entity.center)}|${r4(entity.radius)}|${r4(entity.startAngle)}|${r4(entity.endAngle)}`;
    case 'ELLIPSE':
      return `${base}|${pt(entity.center)}|${pt(entity.majorAxis)}|${r4(entity.ratio)}|${r4(entity.startParam)}|${r4(entity.endParam)}`;
    case 'LWPOLYLINE':
    case 'POLYLINE':
      return `${base}|${(entity.points || []).map(pt).join(';')}|${entity.closed ? 'C' : 'O'}`;
    case 'SPLINE':
      return `${base}|${(entity.controlPoints || []).map(pt).join(';')}|${entity.degree}|${(entity.knots || []).map(r4).join(',')}`;
    case 'TEXT':
    case 'MTEXT':
    case 'ATTRIB':
    case 'ATTDEF':
      return `${base}|${pt(entity.position)}|${r4(entity.height)}|${r4(entity.rotation || 0)}|${(entity.value || '').trim()}`;
    case 'INSERT':
      return `${base}|${entity.blockName}|${pt(entity.position)}|${r4(entity.rotation || 0)}`
        + `|${r4(entity.scale?.x ?? 1)},${r4(entity.scale?.y ?? 1)}`
        + `|${entity.rowCount}x${entity.colCount}`;
    case 'SOLID':
    case '3DFACE':
      return `${base}|${(entity.points || []).map(pt).join(';')}`;
    case 'HATCH':
      return `${base}|${entity.patternName}|${entity.solid ? 'solid' : 'pattern'}`
        + `|${(entity.loops || []).map(loop => (loop.points || loop.edges?.length || 0)).join(',')}`;
    case 'DIMENSION':
      return `${base}|${entity.blockName}|${pt(entity.definitionPoint)}|${r4(entity.measurement || 0)}`;
    case 'RAY':
    case 'XLINE':
      return `${base}|${pt(entity.basePoint)}|${pt(entity.direction)}`;
    default:
      return base;
  }
};

const typeHistogram = entities => {
  const map = new Map();
  for (const entity of entities) map.set(entity.type, (map.get(entity.type) || 0) + 1);
  return [...map.entries()].sort().map(([type, count]) => `${type}×${count}`).join(' ');
};

/** 组码结构校验 + 句柄唯一性/引用完整性校验。 */
const validateStructure = (content, label) => {
  const lines = content.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();

  if (lines.length % 2 !== 0) {
    throw new Error(`${label}: 组码-值不成对（共 ${lines.length} 行）`);
  }

  const handles = new Set();
  const refs = [];
  let lastVariable = '';
  let expectHandseed = false;

  for (let i = 0; i < lines.length; i += 2) {
    const codeText = lines[i].trim();
    const code = Number(codeText);
    if (!Number.isInteger(code) || codeText === '') {
      throw new Error(`${label}: 第 ${i + 1} 行不是合法组码："${lines[i]}"`);
    }
    const value = lines[i + 1].trim();
    if (code === 9) {
      lastVariable = value;
      expectHandseed = value === '$HANDSEED';
      continue;
    }
    if (code === 5) {
      if (expectHandseed) {
        expectHandseed = false;
        continue;
      }
      if (handles.has(value)) throw new Error(`${label}: 句柄重复 "${value}"`);
      handles.add(value);
      continue;
    }
    if (code === 9) lastVariable = value;
    if ([330, 331, 340, 350, 360].includes(code) && value !== '0') {
      refs.push([code, value, lastVariable]);
    }
  }

  const dangling = refs.filter(([, value]) => !handles.has(value));
  if (dangling.length > 0) {
    throw new Error(
      `${label}: ${dangling.length} 处句柄引用悬空，例如 ${dangling[0][0]}→${dangling[0][1]}`,
    );
  }

  if (!content.includes('0\nEOF')) throw new Error(`${label}: 缺少 EOF 结束标记`);
  const head = lines.slice(0, 4).map(line => line.trim());
  if (head[0] !== '0' || head[1] !== 'SECTION' || head[2] !== '2' || head[3] !== 'HEADER') {
    throw new Error(`${label}: 文件未以 HEADER 段开头（实际：${head.join(' / ')}）`);
  }

  return { handles: handles.size, refs: refs.length };
};

const diffSets = (a, b) => {
  const onlyA = [...a].filter(item => !b.has(item));
  const onlyB = [...b].filter(item => !a.has(item));
  return { onlyA, onlyB };
};

const compareData = (before, after, label) => {
  const problems = [];

  if (before.entities.length !== after.entities.length) {
    problems.push(`模型空间实体数 ${before.entities.length} → ${after.entities.length}`);
  }
  const histBefore = typeHistogram(before.entities);
  const histAfter = typeHistogram(after.entities);
  if (histBefore !== histAfter) {
    problems.push(`类型分布变化：${histBefore} → ${histAfter}`);
  }

  // 坐标系对齐：常规解析与 raw 回放的 data.offset 可能不同（raw 回放几何本就在
  // 源绝对坐标系），统一加回各自的 offset 后都落在源绝对坐标系再比对。
  const fmtBefore = makePointFormatter(before.offset);
  const fmtAfter = makePointFormatter(after.offset);
  const sigBefore = before.entities.map(entity => entitySignature(entity, fmtBefore)).sort();
  const sigAfter = after.entities.map(entity => entitySignature(entity, fmtAfter)).sort();
  const mismatch = [];
  const max = Math.max(sigBefore.length, sigAfter.length);
  for (let i = 0; i < max; i++) {
    if (sigBefore[i] !== sigAfter[i]) {
      mismatch.push(`#${i}: ${sigBefore[i] ?? '(缺失)'} ≠ ${sigAfter[i] ?? '(缺失)'}`);
    }
  }
  if (mismatch.length > 0) {
    problems.push(`几何签名不一致 ${mismatch.length} 处，例如 ${mismatch[0]}`);
  }

  const layersDiff = diffSets(new Set(Object.keys(before.layers)), new Set(Object.keys(after.layers)));
  if (layersDiff.onlyA.length || layersDiff.onlyB.length) {
    problems.push(`图层差异：缺少 [${layersDiff.onlyA.join(',')}] 多出 [${layersDiff.onlyB.join(',')}]`);
  }

  // 块对比：*Model_Space / *Paper_Space 是写出器按标准补齐的空间块，
  // 源文件可能根本没有这两个块定义，因此不计入差异，仅要求用户块一致。
  const isSpaceBlock = name => /^\*(model|paper)_space/i.test(name);
  const blocksBefore = new Set(Object.keys(before.blocks || {}).filter(name => !isSpaceBlock(name)));
  const blocksAfter = new Set(Object.keys(after.blocks || {}).filter(name => !isSpaceBlock(name)));
  const blocksDiff = diffSets(blocksBefore, blocksAfter);
  if (blocksDiff.onlyA.length || blocksDiff.onlyB.length) {
    problems.push(`块差异：缺少 [${blocksDiff.onlyA.join(',')}] 多出 [${blocksDiff.onlyB.join(',')}]`);
  }
  if (!blocksAfter.size && !blocksBefore.size && !after.blocks?.['*Model_Space']) {
    problems.push('输出缺少 *Model_Space 空间块');
  }

  // 块内实体数量一致性（仅用户块）
  for (const name of Object.keys(before.blocks || {})) {
    if (isSpaceBlock(name)) continue;
    const countBefore = before.blocks[name].entities?.length ?? 0;
    const countAfter = after.blocks?.[name]?.entities?.length ?? 0;
    if (countBefore !== countAfter) {
      problems.push(`块 ${name} 实体数 ${countBefore} → ${countAfter}`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`${label}: ${problems.join('；')}`);
  }
};

/** AC1009 降级模式：只要求能解析出实体、不崩溃。 */
const runR12Check = async (text, name) => {
  const data = await parseDxf(text, undefined, { yieldIntervalMs: 0 });
  const { content, skipped } = writeDxf(data, { version: 'AC1009' });
  validateStructure(content, `${name} [R12]`);
  const reparsed = await parseDxf(content, undefined, { yieldIntervalMs: 0 });
  if (data.entities.length > 0 && reparsed.entities.length === 0) {
    throw new Error(`${name} [R12]: 写出后解析不到任何实体`);
  }
  return { entities: reparsed.entities.length, skipped: skipped.length };
};

// 夹具运行时生成到临时目录（DXF 不入库）
const fixtures = await materializeFixtures('dxfviewer-roundtrip-');
const fileNames = Object.keys(fixtures.files).sort();
if (fileNames.length === 0) {
  console.error('夹具生成失败');
  process.exit(1);
}

try {
  mkdirSync(outputDir, { recursive: true });
} catch {
  /* 目录已存在 */
}

let failed = 0;
const rows = [];

for (const name of fileNames) {
  const sourceText = (await import('node:fs')).readFileSync(fixtures.files[name], 'utf8');
  try {
    const before = await parseDxf(sourceText, undefined, { yieldIntervalMs: 0 });
    const { content, skipped, version } = writeDxf(before);
    writeFileSync(join(outputDir, name.replace(/\.dxf$/i, '.out.dxf')), content, 'utf8');

    const structure = validateStructure(content, name);
    const after = await parseDxf(content, undefined, { yieldIntervalMs: 0 });
    compareData(before, after, name);

    // M8 保真往返：preserveRaw 采集 → 回放 → 再解析，实体必须逐一几何一致
    const rawBefore = await parseDxf(sourceText, undefined, { yieldIntervalMs: 0, preserveRaw: true });
    const rawCaptured = rawBefore.entities.filter(entity => entity.raw?.length).length;
    const { content: rawContent } = writeDxf(rawBefore, { preserveRaw: true });
    validateStructure(rawContent, `${name} [raw]`);
    const rawAfter = await parseDxf(rawContent, undefined, { yieldIntervalMs: 0 });
    compareData(before, rawAfter, `${name} [raw]`);

    const r12 = await runR12Check(sourceText, name);

    rows.push({
      name,
      version,
      entities: `${before.entities.length}→${after.entities.length}`,
      handles: structure.handles,
      refs: structure.refs,
      sizeKb: `${(content.length / 1024).toFixed(1)}K`,
      skipped: skipped.length,
      r12: r12.entities,
      raw: rawCaptured,
    });
  } catch (error) {
    failed++;
    console.error(`✘ ${name}`);
    console.error(`   ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** M5：编程式构建器 —— 从零生成图纸 → 写出 → 解析，校验实体/图层/块。 */
const runBuilderCheck = async () => {
  const doc = createDocument({ version: 'AC1015', units: 4 });
  doc.addLayer({ name: 'WALL', color: 1 })
    .addLine({ layer: 'WALL', start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } })
    .addCircle({ center: { x: 500, y: 500 }, radius: 200 })
    .addArc({ center: { x: 0, y: 0 }, radius: 100, startAngle: 0, endAngle: 90 })
    .addPolyline({ points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }], closed: true })
    .addText({ position: { x: 0, y: 20 }, height: 50, value: 'BUILDER 中文' })
    .addMText({ position: { x: 0, y: -100 }, height: 30, value: '第一行\\P第二行', width: 300 })
    .addSolidHatch({ outer: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }] })
    .addBlock({
      name: 'BOLT',
      basePoint: { x: 0, y: 0 },
      build: b => {
        b.addCircle({ center: { x: 0, y: 0 }, radius: 5 });
        b.addLine({ start: { x: -7, y: 0 }, end: { x: 7, y: 0 } });
      },
    })
    .addInsert({ blockName: 'BOLT', position: { x: 100, y: 100 }, rotation: 45, scale: { x: 2, y: 2, z: 1 } });

  const { content, skipped } = doc.toDxfString();
  validateStructure(content, 'builder');

  const data = await parseDxf(content, undefined, { yieldIntervalMs: 0 });
  const counts = {};
  for (const entity of data.entities) counts[entity.type] = (counts[entity.type] || 0) + 1;

  const expected = { LINE: 1, CIRCLE: 1, ARC: 1, LWPOLYLINE: 1, TEXT: 1, MTEXT: 1, HATCH: 1, INSERT: 1 };
  for (const [type, count] of Object.entries(expected)) {
    if ((counts[type] || 0) !== count) {
      throw new Error(`builder: ${type} 期望 ${count} 个，实际 ${counts[type] || 0} 个`);
    }
  }
  if (!data.layers?.WALL) throw new Error('builder: 缺少 WALL 图层');
  if (!data.blocks?.BOLT || (data.blocks.BOLT.entities?.length ?? 0) !== 2) {
    throw new Error('builder: BOLT 块实体数不符（期望 2）');
  }
  const line = data.entities.find(entity => entity.type === 'LINE');
  const length = Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y);
  if (Math.abs(length - 1000) > 0.01) throw new Error(`builder: 线段长度 ${length} ≠ 1000`);
  if (skipped.length !== 0) throw new Error(`builder: 意外 skipped ${JSON.stringify(skipped)}`);

  // R12 降级：MTEXT→TEXT 等，仍需可解析
  const r12Doc = createDocument({ version: 'AC1009' });
  r12Doc.addText({ position: { x: 0, y: 0 }, height: 10, value: 'R12' })
    .addMText({ position: { x: 0, y: 50 }, height: 10, value: '多行' });
  const r12Result = r12Doc.toDxfString();
  const r12Data = await parseDxf(r12Result.content, undefined, { yieldIntervalMs: 0 });
  if (r12Data.entities.length !== 2) {
    throw new Error(`builder R12: 期望 2 个实体，实际 ${r12Data.entities.length}`);
  }

  return { entities: data.entities.length, skipped: skipped.length, r12Skipped: r12Result.skipped.length };
};

const pad = (value, width) => String(value).padEnd(width);
if (rows.length > 0) {
  console.log(
    `\n${pad('夹具', 22)}${pad('版本', 9)}${pad('实体', 8)}${pad('句柄', 7)}${pad('引用', 7)}${pad('体积', 9)}${pad('跳过', 6)}${pad('R12实体', 8)}raw捕获`,
  );
  for (const row of rows) {
    console.log(
      `${pad(row.name, 22)}${pad(row.version, 9)}${pad(row.entities, 8)}${pad(row.handles, 7)}`
      + `${pad(row.refs, 7)}${pad(row.sizeKb, 9)}${pad(row.skipped, 6)}${pad(row.r12, 8)}${row.raw}`,
    );
  }
}

let builderInfo;
try {
  builderInfo = await runBuilderCheck();
  console.log(`\n✔ builder 生成图纸校验通过（模型实体 ${builderInfo.entities}，skipped ${builderInfo.skipped}，R12 降级 skipped ${builderInfo.r12Skipped}）`);
} catch (error) {
  failed++;
  console.error(`✘ builder: ${error instanceof Error ? error.message : String(error)}`);
}

console.log(`\n共 ${fileNames.length} 个夹具，失败 ${failed} 个。输出目录：samples/dxf-output/`);
await fixtures.cleanup();
process.exit(failed === 0 ? 0 : 1);
