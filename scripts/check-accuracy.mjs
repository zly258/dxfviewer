/**
 * 渲染准确性自动校验（手动运行，已接入 check 链）。
 *
 * 用变换跟踪的影子画布执行真实渲染路径，对"已知答案"夹具做断言：
 * - accuracy-grid.dxf：3×3 网格，每格对角 LINE + 居中 CIRCLE + 居中 TEXT
 *   （TEXT 的第一对齐点故意偏移 6 单位——回归"锚点必须取第二对齐点"）
 * - 断言：
 *   1) 解析实体数 = 27
 *   2) 内容绘制包围盒 ≈ 世界范围投影（抓整体偏移/缩放错误）
 *   3) 每个单元格有内容且无越界野图元（抓错位/野几何）
 *   4) 每格 CIRCLE 包围盒中心 ≈ 单元中心（抓圆心解析错误）
 *   5) 每格 LINE 包围盒 ≈ 单元对角（抓端点解析错误）
 *   6) 每格 TEXT 水平中心 ≈ 单元中心（抓锚点/对齐错误）
 *
 * 运行：node scripts/check-accuracy.mjs（需先 npm run build:lib）
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { materializeFixtures } from './fixtures.mjs';

const { parseDxf } = await import(new URL('../dist/parser.js', import.meta.url).href);
const { renderEntitiesToCanvas } = await import(new URL('../dist/render.js', import.meta.url).href);

let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) console.log(`✔ ${name}`);
  else { failed++; console.error(`✘ ${name}${detail ? `：${detail}` : ''}`); }
};

// ── 变换跟踪影子画布 ──────────────────────────────────────────────
const createTrackingCanvas = (width, height) => {
  let m = [1, 0, 0, 1, 0, 0]; // a b c d e f
  const stack = [];
  const apply = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const extend = (bbox, px, py) => {
    bbox.minX = Math.min(bbox.minX, px);
    bbox.minY = Math.min(bbox.minY, py);
    bbox.maxX = Math.max(bbox.maxX, px);
    bbox.maxY = Math.max(bbox.maxY, py);
  };
  const newBbox = () => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
  const bboxArea = b => (b.maxX - b.minX) * (b.maxY - b.minY);
  const bboxIntersects = (a, b) => !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
  const bboxCenter = b => [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];

  let font = '10px sans-serif';
  const fontPx = () => Number.parseFloat(font) || 10;
  const fakeWidth = s => [...String(s)].reduce((acc, ch) => acc + (ch.codePointAt(0) > 255 ? fontPx() : fontPx() * 0.55), 0);

  let pathBbox = null;      // 整条路径包围盒（fill 用）
  let subPathBboxes = [];   // 各子路径包围盒（stroke 按子路径记录，兼容批渲染）
  let currentSub = null;    // 当前子路径包围盒（moveTo 分隔）
  const pathPoint = (x, y) => {
    const [px, py] = apply(x, y);
    if (!pathBbox) pathBbox = newBbox();
    extend(pathBbox, px, py);
    if (!currentSub) currentSub = newBbox();
    extend(currentSub, px, py);
  };
  const endSubPath = () => {
    if (currentSub && bboxArea(currentSub) > 1) subPathBboxes.push(currentSub);
    currentSub = null;
  };
  const resetPath = () => { pathBbox = null; subPathBboxes = []; currentSub = null; };

  const ops = []; // { type, bbox, text? }
  const canvas = {
    width, height,
    getContext: () => ctx,
  };
  const ctx = {
    canvas,
    get font() { return font; },
    set font(v) { font = String(v); },
    setTransform(a, b, c, d, e, f) { m[0] = a; m[1] = b; m[2] = c; m[3] = d; m[4] = e; m[5] = f; },
    translate(x, y) { m[4] += m[0] * x + m[2] * y; m[5] += m[1] * x + m[3] * y; },
    scale(sx, sy) { m[0] *= sx; m[1] *= sx; m[2] *= sy; m[3] *= sy; },
    rotate(r) {
      const cos = Math.cos(r), sin = Math.sin(r);
      const [a, b, c, d, e, f] = m;
      m[0] = a * cos + c * sin; m[1] = b * cos + d * sin;
      m[2] = -a * sin + c * cos; m[3] = -b * sin + d * cos;
    },
    save() { stack.push([...m]); },
    restore() { const s = stack.pop(); if (s) m = s; },
    beginPath() { resetPath(); },
    moveTo(x, y) { endSubPath(); pathPoint(x, y); },
    lineTo(x, y) { pathPoint(x, y); },
    arc(cx, cy, r) {
      if (!pathBbox) pathBbox = newBbox();
      if (!currentSub) currentSub = newBbox();
      for (const [ox, oy] of [[-r, -r], [r, -r], [-r, r], [r, r]]) {
        const [px, py] = apply(cx + ox, cy + oy);
        extend(pathBbox, px, py);
        extend(currentSub, px, py);
      }
    },
    closePath() {},
    fill() {
      if (pathBbox && bboxArea(pathBbox) > 1) ops.push({ type: 'fill', bbox: { ...pathBbox } });
      resetPath();
    },
    stroke() {
      // 按子路径记录：批渲染的一次 stroke 绘制多个子路径，
      // 每个子路径的包围盒才是位置校验的有效单元。
      endSubPath();
      for (const b of subPathBboxes) ops.push({ type: 'stroke', bbox: { ...b } });
      resetPath();
    },
    fillRect(x, y, w, h) {
      const [x0, y0] = apply(x, y);
      const [x1, y1] = apply(x + w, y + h);
      const bbox = { minX: Math.min(x0, x1), minY: Math.min(y0, y1), maxX: Math.max(x0, x1), maxY: Math.max(y0, y1) };
      // 全画布底色填充不计入内容
      if (w < canvas.width - 1 || h < canvas.height - 1) ops.push({ type: 'fill', bbox });
    },
    fillText(text, x, y) {
      const w = fakeWidth(text);
      const fs = fontPx();
      // 包围盒：基线两端点 + 字高包络（上 0.8×字号 / 下 0.2×字号）
      const pts = [apply(x, y), apply(x + w, y), apply(x, y - fs * 0.8), apply(x, y + fs * 0.2)];
      const bbox = {
        minX: Math.min(...pts.map(p => p[0])),
        minY: Math.min(...pts.map(p => p[1])),
        maxX: Math.max(...pts.map(p => p[0])),
        maxY: Math.max(...pts.map(p => p[1])),
      };
      ops.push({ type: 'text', text: String(text), bbox });
    },
    strokeText() {},
    setLineDash() {},
    getLineDash() { return []; },
    ellipse(cx, cy, rx, ry) {
      if (!pathBbox) pathBbox = newBbox();
      if (!currentSub) currentSub = newBbox();
      for (const [ox, oy] of [[-rx, -ry], [rx, -ry], [-rx, ry], [rx, ry]]) {
        const [px, py] = apply(cx + ox, cy + oy);
        extend(pathBbox, px, py);
        extend(currentSub, px, py);
      }
    },
    quadraticCurveTo() {},
    rect() {},
    clip() {},
    isPointInPath() { return false; },
    drawImage() {},
    getImageData() { return { data: new Uint8ClampedArray(4) }; },
    putImageData() {},
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
    createPattern() { return {}; },
    measureText(s) {
      const w = fakeWidth(s);
      return { width: w, actualBoundingBoxLeft: 0, actualBoundingBoxRight: w, actualBoundingBoxAscent: fontPx() * 0.8, actualBoundingBoxDescent: fontPx() * 0.2 };
    },
  };
  return { canvas, ops, bboxArea, bboxIntersects, bboxCenter };
};

// ── 已知答案网格断言 ──────────────────────────────────────────────
const fixtures = await materializeFixtures('accuracy-');
try {
  const text = readFileSync(fixtures.files['accuracy-grid.dxf'], 'utf8');
  const data = await parseDxf(text, undefined, { yieldIntervalMs: 0 });

  check('解析：27 个实体', data.entities.length === 27, `实际 ${data.entities.length}`);

  const SIZE = 900;
  const ZOOM = 3;
  // 渲染使用偏移后的内部坐标：视口目标 = 世界中心 - data.offset
  const off = data.offset ?? { x: 0, y: 0 };
  const { canvas, ops, bboxArea, bboxIntersects, bboxCenter } = createTrackingCanvas(SIZE, SIZE);
  renderEntitiesToCanvas({
    ctx: canvas.getContext('2d'),
    entities: data.entities,
    layers: data.layers,
    blocks: data.blocks,
    styles: data.styles,
    lineTypes: data.lineTypes,
    ltScale: 1,
    viewPort: { targetX: 150 - off.x, targetY: 150 - off.y, zoom: ZOOM },
    width: SIZE,
    height: SIZE,
    theme: 'white',
  });

  const contentOps = ops.filter(op => op.bbox && bboxArea(op.bbox) > 1);
  check('渲染：产生内容绘制调用', contentOps.length >= 27, `内容绘制 ${contentOps.length} 次`);

  // 内容包围盒 ≈ 实际绘制内容的投影：对角线内缩 10 世界单位（×3 = 30px），
  // 圆内缩 20 单位 → 整体内容包围盒 [30, 870]（世界 [0,300] 的空边距不产生绘制）
  const world = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const op of contentOps) {
    world.minX = Math.min(world.minX, op.bbox.minX);
    world.minY = Math.min(world.minY, op.bbox.minY);
    world.maxX = Math.max(world.maxX, op.bbox.maxX);
    world.maxY = Math.max(world.maxY, op.bbox.maxY);
  }
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  check('整体位置：内容包围盒 ≈ 已知几何投影',
    near(world.minX, 30, 6) && near(world.minY, 30, 6) && near(world.maxX, 870, 6) && near(world.maxY, 870, 6),
    `bbox [${world.minX.toFixed(1)}, ${world.minY.toFixed(1)}] → [${world.maxX.toFixed(1)}, ${world.maxY.toFixed(1)}]`);

  // 逐单元格断言
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const cell = { minX: col * 300, minY: row * 300, maxX: col * 300 + 300, maxY: row * 300 + 300 };
      const cellOps = contentOps.filter(op => bboxIntersects(op.bbox, cell));
      const label = `单元 (${col},${row})`;
      if (cellOps.length < 3) { check(`${label}：内容存在`, false, `仅 ${cellOps.length} 次绘制`); continue; }

      // LINE：笔画包围盒 ≈ 单元对角内缩 10 世界单位（×3 = 30px）
      const strokeOps = cellOps.filter(op => op.type === 'stroke');
      const inset = 30;
      const bigStroke = strokeOps.find(op => (op.bbox.maxX - op.bbox.minX) > 150 && (op.bbox.maxY - op.bbox.minY) > 150);
      check(`${label}：LINE 对角位置`, Boolean(bigStroke) &&
        near(bigStroke.bbox.minX, cell.minX + inset, 6) && near(bigStroke.bbox.maxX, cell.maxX - inset, 6) &&
        near(bigStroke.bbox.minY, cell.minY + inset, 6) && near(bigStroke.bbox.maxY, cell.maxY - inset, 6),
        bigStroke ? `bbox [${bigStroke.bbox.minX.toFixed(0)}, ${bigStroke.bbox.minY.toFixed(0)}] → [${bigStroke.bbox.maxX.toFixed(0)}, ${bigStroke.bbox.maxY.toFixed(0)}]` : '未找到');

      // CIRCLE：圆心 ≈ 单元中心，直径 ≈ 60 世界单位 × 3 = 180px（stroke 类型）
      const circleOp = cellOps.find(op => op.type !== 'text'
        && Math.abs((op.bbox.maxX - op.bbox.minX) - (op.bbox.maxY - op.bbox.minY)) < 8
        && (op.bbox.maxX - op.bbox.minX) > 150 && (op.bbox.maxX - op.bbox.minX) < 210);
      if (circleOp) {
        const [ccx, ccy] = bboxCenter(circleOp.bbox);
        check(`${label}：CIRCLE 圆心`, near(ccx, cell.minX + 150, 6) && near(ccy, cell.minY + 150, 6),
          `中心 (${ccx.toFixed(1)}, ${ccy.toFixed(1)})`);
      } else {
        check(`${label}：CIRCLE 存在`, false, '未找到圆弧类绘制');
      }

      // TEXT：水平中心 ≈ 单元中心（锚点回归断言）
      const textOps = cellOps.filter(op => op.type === 'text');
      const textOp = textOps[0];
      if (textOp) {
        const [tcx] = bboxCenter(textOp.bbox);
        check(`${label}：TEXT 水平锚点（第二对齐点）`, near(tcx, cell.minX + 150, 4),
          `中心 ${tcx.toFixed(1)}，期望 ${cell.minX + 150}，文字"${textOp.text}"`);
      } else {
        check(`${label}：TEXT 存在`, false, '未找到文字绘制');
      }

      // 无越界野图元：所有该格绘制均在格内（容差 8px）
      const stray = cellOps.filter(op =>
        op.bbox.minX < cell.minX - 8 || op.bbox.maxX > cell.maxX + 8 ||
        op.bbox.minY < cell.minY - 8 || op.bbox.maxY > cell.maxY + 8);
      check(`${label}：无越界野图元`, stray.length === 0, stray.length ? `${stray.length} 次越界绘制` : '');
    }
  }
} catch (error) {
  failed++;
  console.error(`✘ 网格区块异常：${error instanceof Error ? error.message : String(error)}`);
}

// ── 特殊格式文字转换断言 ──────────────────────────────────────────
try {
  const text = readFileSync(fixtures.files['special-codes.dxf'], 'utf8');
  const data = await parseDxf(text, undefined, { yieldIntervalMs: 0 });

  check('特殊格式：解析 5 个文字实体', data.entities.length === 5, `实际 ${data.entities.length}`);

  const SIZE = 900;
  const off = data.offset ?? { x: 0, y: 0 };
  const { canvas, ops } = createTrackingCanvas(SIZE, 400);
  renderEntitiesToCanvas({
    ctx: canvas.getContext('2d'),
    entities: data.entities,
    layers: data.layers,
    blocks: data.blocks,
    styles: data.styles,
    lineTypes: data.lineTypes,
    ltScale: 1,
    viewPort: { targetX: 0 - off.x, targetY: 200 - off.y, zoom: 1 },
    width: SIZE,
    height: 400,
    theme: 'white',
  });

  const drawn = ops.filter(op => op.type === 'text').map(op => op.text).join('\n');
  const expectIncludes = ['Ø', '°', '±', 'ABC', '∅', '3/4', '下划线', '恢复', '第二行'];
  for (const token of expectIncludes) {
    check(`特殊格式：绘制内容包含 "${token}"`, drawn.includes(token), `实际绘制文本：${drawn.slice(0, 120)}`);
  }
  check('特殊格式：无残留未转换的 %%', !drawn.includes('%%'), drawn.includes('%%') ? `残留：${drawn.match(/.{0,10}%%.{0,10}/g)?.join(' | ')}` : '');
  check('特殊格式：无残留未转换的 \\U+', !drawn.includes('U+') && !drawn.includes('\\U'), '');
} finally {
  await fixtures.cleanup();
}

console.log(failed === 0 ? '\n渲染准确性校验全部通过。' : `\n渲染准确性校验失败 ${failed} 项。`);
process.exit(failed === 0 ? 0 : 1);
