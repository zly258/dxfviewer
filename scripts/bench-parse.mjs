/**
 * 解析/渲染性能基准（手动运行，不进 check 链）。
 *
 * 生成大规模合成 DXF 文本（默认 10 万实体），计时：
 * - parseDxf 全量解析
 * - createSceneIndex 建索引
 * - renderEntitiesToCanvas 三次渲染取平均（影子 Canvas）
 *
 * 运行：node scripts/bench-parse.mjs（需先 npm run build:lib）
 * 可选参数：node scripts/bench-parse.mjs 200000
 */
import { performance } from 'node:perf_hooks';
import { createFakeCanvas } from './canvas-mock.mjs';

const { parseDxf } = await import(new URL('../dist/parser.js', import.meta.url).href);
const { renderEntitiesToCanvas, createSceneIndex } = await import(new URL('../dist/render.js', import.meta.url).href);

const total = Number(process.argv[2]) || 100_000;

// ─── 合成 DXF 文本 ─────────────────────────────────────────────
const lines = [];
let handle = 0x100;
const hex = () => (++handle).toString(16).toUpperCase();
const num = value => value.toFixed(4);
const put = (code, value) => lines.push(String(code), value);

const emitLine = (x, y) => {
  put(0, 'LINE'); put(5, hex()); put(8, '0');
  put(10, num(x)); put(20, num(y)); put(30, '0.0');
  put(11, num(x + 12)); put(21, num(y + 8)); put(31, '0.0');
};
const emitCircle = (x, y) => {
  put(0, 'CIRCLE'); put(5, hex()); put(8, '0');
  put(10, num(x)); put(20, num(y)); put(30, '0.0'); put(40, num(3 + (x % 5)));
};
const emitText = (x, y, i) => {
  put(0, 'TEXT'); put(5, hex()); put(8, '0');
  put(10, num(x)); put(20, num(y)); put(30, '0.0');
  put(40, num(3.5)); put(1, `PART-${i}`);
};
const emitPolyline = (x, y) => {
  put(0, 'LWPOLYLINE'); put(5, hex()); put(8, '0');
  put(90, '4'); put(70, '0'); put(43, '0.0');
  put(10, num(x)); put(20, num(y));
  put(10, num(x + 6)); put(20, num(y));
  put(10, num(x + 6)); put(20, num(y + 6));
  put(10, num(x)); put(20, num(y + 6));
};
const emitArc = (x, y) => {
  put(0, 'ARC'); put(5, hex()); put(8, '0');
  put(10, num(x)); put(20, num(y)); put(30, '0.0'); put(40, num(4));
  put(50, num(0)); put(51, num(120));
};
const emitInsert = (x, y) => {
  put(0, 'INSERT'); put(5, hex()); put(8, '0');
  put(2, 'BOLT'); put(10, num(x)); put(20, num(y)); put(30, '0.0');
  put(41, '1.0'); put(42, '1.0'); put(43, '1.0'); put(50, '0.0');
};

// 块定义（供 INSERT 引用）
put(0, 'SECTION'); put(2, 'HEADER');
put(9, '$ACADVER'); put(1, 'AC1015');
put(9, '$EXTMIN'); put(10, '0.0'); put(20, '0.0'); put(30, '0.0');
put(9, '$EXTMAX'); put(10, '1200.0'); put(20, '900.0'); put(30, '0.0');
put(0, 'ENDSEC');
put(0, 'SECTION'); put(2, 'BLOCKS');
put(0, 'BLOCK'); put(5, hex()); put(8, '0'); put(2, 'BOLT'); put(70, '0');
put(10, '0.0'); put(20, '0.0'); put(30, '0.0');
emitLine(0, 0); emitCircle(3, 3); emitLine(6, 0);
put(0, 'ENDBLK'); put(5, hex()); put(8, '0');
put(0, 'ENDSEC');
put(0, 'SECTION'); put(2, 'ENTITIES');

const cell = 30;
const columns = Math.ceil(Math.sqrt(total * cell * cell / (1200 * 900)));
const emitters = [emitLine, emitCircle, emitText, emitPolyline, emitArc, emitInsert];
for (let i = 0; i < total; i++) {
  const x = (i % columns) * 6 + 10;
  const y = Math.floor(i / columns) * 5 + 10;
  emitters[i % emitters.length](x, y, i);
}
put(0, 'ENDSEC');
put(0, 'EOF');
const dxfText = lines.join('\n') + '\n';

console.log(`合成 DXF：${(dxfText.length / 1024 / 1024).toFixed(1)} MB，${lines.length} 行，目标实体 ${total}`);

// ─── 计时 ───────────────────────────────────────────────────────
let data;
{
  const start = performance.now();
  data = await parseDxf(dxfText, undefined, { yieldIntervalMs: 0 });
  const ms = performance.now() - start;
  console.log(`parseDxf：${ms.toFixed(0)} ms（${data.entities.length} 实体，${(dxfText.length / 1024 / 1024 / (ms / 1000)).toFixed(1)} MB/s）`);
}

let index;
{
  const start = performance.now();
  index = createSceneIndex(data.entities);
  const ms = performance.now() - start;
  console.log(`createSceneIndex：${ms.toFixed(0)} ms`);
}

{
  const { canvas } = createFakeCanvas(1280, 800);
  const center = data.extents.center;
  const warm = () => renderEntitiesToCanvas({
    ctx: canvas.getContext('2d'),
    entities: data.entities,
    layers: data.layers,
    blocks: data.blocks,
    styles: data.styles,
    lineTypes: data.lineTypes,
    ltScale: 1,
    viewPort: { targetX: center.x, targetY: center.y, zoom: 0.5 },
    width: 1280,
    height: 800,
    theme: 'white',
    sceneIndex: index,
  });
  warm();
  const start = performance.now();
  const runs = 3;
  for (let i = 0; i < runs; i++) warm();
  const ms = (performance.now() - start) / runs;
  console.log(`renderEntitiesToCanvas 平均：${ms.toFixed(1)} ms/帧（${runs} 次）`);
}
