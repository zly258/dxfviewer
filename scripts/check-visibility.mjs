/**
 * 渲染回归校验：隐藏/隔离实体语义 + 场景索引等价性。
 *
 * 两组断言：
 *
 * A. 扁平 BVH（Worker 使用的实现）与参考实现 createSceneIndex 查询结果
 *    完全一致 —— 用 3 万个合成实体（含无包围盒的兜底实体）对比多组查询窗口。
 *
 * B. 隐藏/隔离的两条实现路径逐调用等价：
 *    - 旧语义：先按可见性过滤实体数组，再渲染（不传可见性集合）
 *    - 新语义：完整实体数组 + hiddenEntityIds / isolatedEntityIds 集合
 *    两条路径对同一场景必须产生完全相同的绘制调用序列（含顺序）；
 *    带 BVH 索引与不带索引的结果也必须一致。
 *    每次 run 前清空渲染缓存，保证文字布局缓存不影响序列。
 *
 * 运行：node scripts/check-visibility.mjs（需先 npm run build:lib）
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { materializeFixtures } from './fixtures.mjs';
import { createFakeCanvas } from './canvas-mock.mjs';

const { parseDxf } = await import(new URL('../dist/parser.js', import.meta.url).href);
const {
  renderEntitiesToCanvas,
  createSceneIndex,
  clearAllRenderCaches,
  collectSceneIndexBuildInput,
  buildFlatBvh,
  createFlatSceneIndex,
} = await import(new URL('../dist/render.js', import.meta.url).href);

let failed = 0;
const check = (name, condition, detail = '') => {
  if (condition) {
    console.log(`✔ ${name}`);
  } else {
    failed++;
    console.error(`✘ ${name}${detail ? `：${detail}` : ''}`);
  }
};

const opsEqual = (a, b) => a.length === b.length && a.every((op, i) => op === b[i]);
const idsOf = entities => entities.map(entity => entity.id).join(',');

// ---------------------------------------------------------------------------
// A. 扁平 BVH 与参考实现的查询等价性（合成大场景）
// ---------------------------------------------------------------------------
{
  const count = 30_000;
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  const entities = [];
  for (let i = 0; i < count; i++) {
    // 每 17 个实体留一个无包围盒的兜底实体（查询结果必须始终包含）。
    if (i % 17 === 0) {
      entities.push({ id: `E${i}`, type: 'LINE', layer: '0', visible: true });
      continue;
    }
    const x = rand() * 10_000;
    const y = rand() * 10_000;
    const w = 1 + rand() * 50;
    const h = 1 + rand() * 50;
    entities.push({
      id: `E${i}`,
      type: 'LINE',
      layer: '0',
      visible: true,
      extents: { min: { x, y }, max: { x: x + w, y: y + h } },
    });
  }

  const reference = createSceneIndex(entities);
  const input = collectSceneIndexBuildInput(entities);
  const flat = buildFlatBvh(input.bounds, input.indices);
  const flatIndex = createFlatSceneIndex(entities, flat, {
    fallbackIndices: input.fallbackIndices,
    entityByHandle: input.entityByHandle,
    splineSamples: input.splineSamples,
  });

  const withExtents = entities.filter(entity => entity.extents);
  const xs = withExtents.map(entity => entity.extents.min.x).sort((a, b) => a - b);
  const ys = withExtents.map(entity => entity.extents.min.y).sort((a, b) => a - b);
  const midX = xs[Math.floor(xs.length / 2)];
  const midY = ys[Math.floor(ys.length / 2)];
  const bounds = entity => entity.extents;

  const windows = [
    { name: '全图', box: { min: { x: -1, y: -1 }, max: { x: 11_000, y: 11_000 } } },
    { name: '左下四分之一', box: { min: { x: -1, y: -1 }, max: { x: midX, y: midY } } },
    { name: '右上四分之一', box: { min: { x: midX, y: midY }, max: { x: 11_000, y: 11_000 } } },
    { name: '窄横带', box: { min: { x: -1, y: midY - 40 }, max: { x: 11_000, y: midY + 40 } } },
    { name: '点状窗口', box: { min: { x: midX, y: midY }, max: { x: midX + 0.001, y: midY + 0.001 } } },
  ];

  for (const { name, box } of windows) {
    const refList = reference.query(box);
    const flatList = flatIndex.query(box);
    const same = refList.length === flatList.length && idsOf(refList) === idsOf(flatList);
    check(`A/${name}：扁平 BVH 查询与参考实现一致`, same,
      `参考 ${refList.length} 项，扁平 ${flatList.length} 项`);
  }

  // 全图查询必须包含全部兜底实体（无包围盒者）。
  const fullQuery = flatIndex.query({ min: { x: -1, y: -1 }, max: { x: 11_000, y: 11_000 } });
  const fallbackAll = entities
    .filter(entity => !entity.extents)
    .every(entity => fullQuery.includes(entity));
  check('A/兜底实体：无包围盒实体始终包含在查询结果中', fallbackAll);

  // 两种实现的 handle 映射一致。
  const refHandles = [...reference.entityByHandle.keys()].sort();
  const flatHandles = [...flatIndex.entityByHandle.keys()].sort();
  check('A/handle 映射：一致', JSON.stringify(refHandles) === JSON.stringify(flatHandles));
}

// ---------------------------------------------------------------------------
// B. 隐藏/隔离渲染语义等价（visibility-mixed 夹具）
// ---------------------------------------------------------------------------
{
  const fixtures = await materializeFixtures('dxfviewer-visibility-');
  try {
    const text = readFileSync(fixtures.files['visibility-mixed.dxf'], 'utf8');
    const data = await parseDxf(text, undefined, { yieldIntervalMs: 0 });
    const ents = data.entities;
    const center = data.extents.center;
    const viewPort = { targetX: center.x, targetY: center.y, zoom: 4 };

    const run = (entities, opts = {}, index) => {
      clearAllRenderCaches();
      const { canvas, counter, ops } = createFakeCanvas(800, 600);
      renderEntitiesToCanvas({
        ctx: canvas.getContext('2d'),
        entities,
        layers: data.layers,
        blocks: data.blocks,
        styles: data.styles,
        lineTypes: data.lineTypes,
        ltScale: 1,
        viewPort,
        width: 800,
        height: 600,
        theme: 'white',
        ...opts,
        ...(index ? { sceneIndex: index } : {}),
      });
      const draws = counter.stroke + counter.fill + counter.fillText + counter.strokeText;
      return { ops, counter, draws };
    };

    const lineId = ents.find(entity => entity.type === 'LINE')?.id;
    const wallLineId = ents.filter(entity => entity.type === 'LINE')[1]?.id;
    const circleId = ents.find(entity => entity.type === 'CIRCLE')?.id;
    const textId = ents.find(entity => entity.type === 'TEXT')?.id;
    const insertId = ents.find(entity => entity.type === 'INSERT')?.id;
    check('B/前置：夹具实体齐全',
      Boolean(lineId && wallLineId && circleId && textId && insertId),
      'LINE/CIRCLE/TEXT/INSERT 至少各一');

    const baselinePlain = run(ents);
    const baselineIndexed = run(ents, {}, createSceneIndex(ents));
    check('B/基线：有索引与无索引绘制序列一致',
      opsEqual(baselinePlain.ops, baselineIndexed.ops));
    check('B/基线：产生绘制调用', baselinePlain.draws > 0);

    // 隐藏普通图元（一条线 + 文字）
    const hiddenSet = new Set([wallLineId, textId]);
    const legacyHide = run(ents.filter(entity => !hiddenSet.has(entity.id)));
    const setHide = run(ents, { hiddenEntityIds: hiddenSet });
    const setHideIndexed = run(ents, { hiddenEntityIds: hiddenSet }, createSceneIndex(ents));
    check('B/隐藏：旧数组过滤与新集合路径绘制序列一致',
      opsEqual(legacyHide.ops, setHide.ops));
    check('B/隐藏：集合路径 + 索引与无索引一致',
      opsEqual(setHide.ops, setHideIndexed.ops));
    check('B/隐藏：绘制量少于基线',
      setHide.draws < baselinePlain.draws,
      `隐藏后 ${setHide.draws}，基线 ${baselinePlain.draws}`);

    // 隐藏块引用：块内子实体必须一并消失（深度 0 过滤）
    const legacyHideInsert = run(ents.filter(entity => entity.id !== insertId));
    const setHideInsert = run(ents, { hiddenEntityIds: new Set([insertId]) });
    check('B/隐藏块：两条路径绘制序列一致',
      opsEqual(legacyHideInsert.ops, setHideInsert.ops));
    check('B/隐藏块：绘制量少于基线',
      setHideInsert.draws < baselinePlain.draws);

    // 隔离（仅渲染集合内实体）
    const isolatedSet = new Set([circleId, insertId]);
    const legacyIsolate = run(ents.filter(entity => isolatedSet.has(entity.id)));
    const setIsolate = run(ents, { isolatedEntityIds: isolatedSet });
    const setIsolateIndexed = run(ents, { isolatedEntityIds: isolatedSet }, createSceneIndex(ents));
    check('B/隔离：旧数组过滤与新集合路径绘制序列一致',
      opsEqual(legacyIsolate.ops, setIsolate.ops));
    check('B/隔离：集合路径 + 索引与无索引一致',
      opsEqual(setIsolate.ops, setIsolateIndexed.ops));
    check('B/隔离：绘制量少于基线',
      setIsolate.draws < baselinePlain.draws,
      `隔离后 ${setIsolate.draws}，基线 ${baselinePlain.draws}`);

    // 全部隐藏：除背景 fillRect 外不应有任何绘制调用
    const hideAll = run(ents, { hiddenEntityIds: new Set(ents.map(entity => entity.id)) });
    check('B/全部隐藏：零绘制调用',
      hideAll.draws === 0,
      `剩余 ${hideAll.draws} 次绘制`);
    check('B/全部隐藏：与空数组渲染序列一致',
      opsEqual(hideAll.ops, run([]).ops));
  } finally {
    await fixtures.cleanup();
  }
}

console.log(failed === 0 ? '\n渲染回归校验全部通过。' : `\n渲染回归校验失败 ${failed} 项。`);
process.exit(failed === 0 ? 0 : 1);
