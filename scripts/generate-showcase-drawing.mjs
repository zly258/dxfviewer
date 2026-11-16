/**
 * 综合测试图纸生成器（真实感建筑平面图风格）。
 *
 * 覆盖目标：所有受支持实体 × 多种变体，多图层 / 线型 / 文字样式 / 块 / 属性 /
 * 标注 / 引线 / 公差 / 填充 —— 全部走本库 createDocument 构建器 + writeDxf 写出，
 * 既验证库自身能力，产物又是「已知正确」的测试输入。
 *
 * 输出到指定目录（.gitignore 全局忽略 *.dxf，不会入库）。
 *
 * 用法：node scripts/generate-showcase-drawing.mjs <输出目录>
 * 可选：--raw 用保真回放模式写出
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const lib = async (name) => {
  try {
    return await import(new URL(`../dist/${name}`, import.meta.url).href);
  } catch {
    return await import(`@zhangly1403/dxfviewer/${name.replace('.js', '')}`);
  }
};

const { createDocument } = await lib('writer.js');

const outDir = resolve(process.argv[2] ?? './showcase');
const useRaw = process.argv.includes('--raw');
mkdirSync(outDir, { recursive: true });

const doc = createDocument({ version: 'AC1015', units: 4 }); // 4 = mm

// ---------------------------------------------------------------------------
// 图层：9 个，覆盖颜色/线型/线宽/冻结
// ---------------------------------------------------------------------------
doc.addLayer({ name: 'WALL', color: 7, lineweight: 50 });
doc.addLayer({ name: 'AXIS', color: 1, lineType: 'CENTER', lineweight: 18 });
doc.addLayer({ name: 'DIM', color: 3, lineweight: 13 });
doc.addLayer({ name: 'TEXT', color: 2 });
doc.addLayer({ name: 'FURNITURE', color: 4 });
doc.addLayer({ name: 'HATCH-P', color: 8 });
doc.addLayer({ name: 'CENTER-LINE', color: 5, lineType: 'PHANTOM' });
doc.addLayer({ name: 'HIDDEN-FLOOR', color: 9, lineType: 'DASHED', isVisible: false });

// ---------------------------------------------------------------------------
// 块：门 / 窗 / 椅子（带 ATTDEF）/ 标题栏（带多个 ATTDEF）
// ---------------------------------------------------------------------------
doc.addBlock({
  name: 'DOOR',
  basePoint: { x: 0, y: 0 },
  build: (b) => b
    .addLine({ start: { x: 0, y: 0 }, end: { x: 0, y: 900 } })
    .addArc({ center: { x: 0, y: 0 }, radius: 900, startAngle: 0, endAngle: 90 })
    .addLine({ start: { x: 900, y: 0 }, end: { x: 900, y: 900 } }),
});

doc.addBlock({
  name: 'WINDOW',
  basePoint: { x: 0, y: 0 },
  build: (b) => b
    .addLine({ start: { x: 0, y: 0 }, end: { x: 1500, y: 0 } })
    .addLine({ start: { x: 0, y: 60 }, end: { x: 1500, y: 60 } })
    .addLine({ start: { x: 0, y: 30 }, end: { x: 1500, y: 30 } })
    .addLine({ start: { x: 0, y: 0 }, end: { x: 0, y: 60 } })
    .addLine({ start: { x: 1500, y: 0 }, end: { x: 1500, y: 60 } }),
});

doc.addBlock({
  name: 'CHAIR',
  basePoint: { x: 0, y: 0 },
  build: (b) => b
    .addPolyline({
      points: [{ x: -200, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 400 }, { x: -200, y: 400 }],
      closed: true,
    })
    .addCircle({ center: { x: 0, y: 200 }, radius: 120 }),
});

// 标题栏：内容 + 属性占位（ATTDEF 走 addText 近似，属性由 INSERT 时给出）
doc.addBlock({
  name: 'TITLE_BLOCK',
  basePoint: { x: 0, y: 0 },
  build: (b) => b
    .addLine({ start: { x: 0, y: 0 }, end: { x: 18000, y: 0 } })
    .addLine({ start: { x: 0, y: 0 }, end: { x: 0, y: 5000 } })
    .addText({ position: { x: 200, y: 2500 }, height: 350, value: '综合测试项目', styleName: 'SONGTI' })
    .addText({ position: { x: 200, y: 1200 }, height: 300, value: '图号 DXF-2026-001' })
    .addText({ position: { x: 6000, y: 2500 }, height: 300, value: '比例 1:100' })
    .addText({ position: { x: 6000, y: 1200 }, height: 300, value: '日期 2026-10-30' }),
});

// ---------------------------------------------------------------------------
// 轴网：点划线 + 轴号
// ---------------------------------------------------------------------------
const axisXs = [0, 5400, 11400, 17400, 24000];
const axisYs = [0, 6600, 14400];
axisXs.forEach((x, i) => {
  doc.addLine({ layer: 'AXIS', start: { x, y: -2000 }, end: { x, y: 16000 } });
  doc.addCircle({ layer: 'AXIS', center: { x, y: 16600 }, radius: 400 });
  doc.addText({
    layer: 'AXIS', position: { x, y: 16450 }, height: 350,
    value: String(i + 1), hAlign: 1, styleName: 'STANDARD',
  });
});
axisYs.forEach((y, i) => {
  doc.addLine({ layer: 'AXIS', start: { x: -2000, y }, end: { x: 26000, y } });
  doc.addCircle({ layer: 'AXIS', center: { x: -2600, y }, radius: 400 });
  doc.addText({
    layer: 'AXIS', position: { x: -2600, y: y - 150 }, height: 350,
    value: String.fromCharCode(65 + i), hAlign: 1, styleName: 'STANDARD',
  });
});

// ---------------------------------------------------------------------------
// 墙体 + 柱（SOLID）
// ---------------------------------------------------------------------------
doc.addPolyline({ layer: 'WALL', points: [{ x: 0, y: 0 }, { x: 24000, y: 0 }] });
doc.addPolyline({ layer: 'WALL', points: [{ x: 0, y: 14400 }, { x: 24000, y: 14400 }] });
doc.addPolyline({ layer: 'WALL', points: [{ x: 0, y: 0 }, { x: 0, y: 14400 }] });
doc.addPolyline({ layer: 'WALL', points: [{ x: 24000, y: 0 }, { x: 24000, y: 14400 }] });
doc.addLine({ layer: 'WALL', start: { x: 11400, y: 0 }, end: { x: 11400, y: 9000 } });
doc.addLine({ layer: 'WALL', start: { x: 11400, y: 9000 }, end: { x: 24000, y: 9000 } });
for (const x of axisXs) {
  for (const y of axisYs) {
    doc.addSolid({
      layer: 'WALL',
      points: [{ x: x - 200, y: y - 200 }, { x: x + 200, y: y - 200 }, { x: x + 200, y: y + 200 }, { x: x - 200, y: y + 200 }],
    });
  }
}

// ---------------------------------------------------------------------------
// 门（INSERT 三种变体：普通 / 镜像 scale.x=-1 / 旋转 90°）
// ---------------------------------------------------------------------------
doc.addInsert({ layer: 'FURNITURE', blockName: 'DOOR', position: { x: 5400, y: 0 } });
doc.addInsert({ layer: 'FURNITURE', blockName: 'DOOR', position: { x: 11400, y: 0 }, scale: { x: -1, y: 1, z: 1 } });
doc.addInsert({ layer: 'FURNITURE', blockName: 'DOOR', position: { x: 17400, y: 0 }, rotation: 90 });

// 窗（阵列：1 行 3 列，间距 1800）
doc.addInsert({
  layer: 'FURNITURE', blockName: 'WINDOW', position: { x: 2000, y: 14340 },
  colCount: 3, colSpacing: 1800,
});

// 椅子（块引用，CHAIR 编号由 addText 模拟属性显示）
const chair = (x, y, no) => {
  doc.addInsert({ layer: 'FURNITURE', blockName: 'CHAIR', position: { x, y } });
  doc.addText({
    layer: 'TEXT', position: { x, y: y - 260 }, height: 120,
    value: no, hAlign: 1, color: 2,
  });
};
chair(3000, 3000, 'A-01');
chair(3800, 3000, 'A-02');
chair(3000, 4600, 'A-03');
chair(3800, 4600, 'A-04');
chair(14000, 11000, 'B-01');
chair(14800, 11000, 'B-02');

// ---------------------------------------------------------------------------
// 房间文字：TEXT（默认/旋转/宽度因子）+ MTEXT（多行/居中附着/行距 1.4）
// ---------------------------------------------------------------------------
doc.addText({ layer: 'TEXT', position: { x: 3000, y: 7000 }, height: 600, value: '办公室 A', styleName: 'SONGTI' });
doc.addText({ layer: 'TEXT', position: { x: 16000, y: 7000 }, height: 600, value: '办公室 B', styleName: 'SONGTI' });
doc.addText({
  layer: 'TEXT', position: { x: 12000, y: 11000 }, height: 400,
  value: '会议区', rotation: 30, widthFactor: 0.8, styleName: 'SONGTI',
});
doc.addMText({
  layer: 'TEXT', position: { x: 3000, y: 12000 }, height: 400, width: 6000,
  value: '技术要求：\\P1. 墙体采用 200 厚加气混凝土砌块；\\P2. 门窗表详见门窗大样图；\\P3. 未标注尺寸详见相关图纸。',
  styleName: 'SONGTI',
});
doc.addMText({
  layer: 'TEXT', position: { x: 16000, y: 12500 }, height: 350, width: 5000,
  value: '房间面积：\\P办公室 A：约 68 ㎡\\P办公室 B：约 75 ㎡',
  attachmentPoint: 2, styleName: 'SONGTI',
});

// ---------------------------------------------------------------------------
// 填充：ANSI31 / NET / SOLID 三种
// ---------------------------------------------------------------------------
doc.addSolidHatch({
  layer: 'HATCH-P',
  patternName: 'ANSI31',
  outer: [{ x: 12000, y: 200 }, { x: 23800, y: 200 }, { x: 23800, y: 8800 }, { x: 12000, y: 8800 }],
});
doc.addSolidHatch({
  layer: 'HATCH-P', patternName: 'NET',
  outer: [{ x: 1000, y: 1000 }, { x: 5000, y: 1000 }, { x: 5000, y: 5000 }, { x: 1000, y: 5000 }],
});
doc.addSolidHatch({
  layer: 'HATCH-P', color: 3, patternName: 'SOLID',
  outer: [{ x: 20500, y: 10000 }, { x: 23000, y: 10000 }, { x: 23000, y: 12500 }, { x: 20500, y: 12500 }],
});

// ---------------------------------------------------------------------------
// 标注：三条水平尺寸（含延伸线/尺寸线/文字，DIMENSION 实体引用匿名块由
// writeDxf 以同名 *D 块输出 —— 这里块名为 *D1，块内容在下方 addBlock 中给出）
// ---------------------------------------------------------------------------
const drawDim = (x1, x2, y) => {
  const dimY = y - 1500;
  doc.addDimension({
    layer: 'DIM',
    blockName: '*D1',
    definitionPoint: { x: (x1 + x2) / 2, y: dimY },
    textMidPoint: { x: (x1 + x2) / 2, y: dimY + 500 },
    dimType: 32,
    measurement: x2 - x1,
    linearP1: { x: x1, y },
    linearP2: { x: x2, y },
  });
  // 可见几何（DIMENSION 的匿名块由查看器渲染，这里再补一份显式几何便于 CAD 端阅读）
  doc.addLine({ layer: 'DIM', start: { x: x1, y }, end: { x: x1, y: dimY } });
  doc.addLine({ layer: 'DIM', start: { x: x2, y }, end: { x: x2, y: dimY } });
  doc.addLine({ layer: 'DIM', start: { x: x1, y: dimY }, end: { x: x2, y: dimY } });
  doc.addLine({ layer: 'DIM', start: { x: x1, y: dimY - 200 }, end: { x: x1, y: dimY + 200 } });
  doc.addLine({ layer: 'DIM', start: { x: x2, y: dimY - 200 }, end: { x: x2, y: dimY + 200 } });
  doc.addText({ layer: 'DIM', position: { x: (x1 + x2) / 2 - 400, y: dimY + 250 }, height: 350, value: String(x2 - x1) });
};
drawDim(0, 5400, 0);
drawDim(5400, 11400, 0);
drawDim(11400, 24000, 0);

// 标注匿名块 *D1：真实 CAD 中它承载标注的可见几何；本图已用显式实体绘制
// 尺寸线/界线/文字，所以这里必须是**空块**——若放任何几何，渲染器会把它
// 平移到每个 DIMENSION 的定义点附近，产生杂散短线（偏移干扰元素）。
doc.addBlock({ name: '*D1', basePoint: { x: 0, y: 0 } });

// ---------------------------------------------------------------------------
// 引线（LEADER 风格：折线 + MTEXT 注释）
// ---------------------------------------------------------------------------
doc.addPolyline({
  layer: 'DIM', color: 3,
  points: [{ x: 9000, y: 11000 }, { x: 11000, y: 13500 }, { x: 14000, y: 13500 }],
});
doc.addMText({
  layer: 'DIM', color: 3, position: { x: 14100, y: 13300 }, height: 300, width: 4000,
  value: '轻钢龙骨石膏板隔墙', attachmentPoint: 4,
});

// ---------------------------------------------------------------------------
// 设备中心线 / 隐藏层 / 真彩色 / 线型比例变体
// ---------------------------------------------------------------------------
doc.addPolyline({
  layer: 'CENTER-LINE', trueColor: 0x0070c0,
  points: [{ x: 0, y: 15500 }, { x: 24000, y: 15500 }],
});
doc.addPolyline({
  layer: 'HIDDEN-FLOOR',
  points: [{ x: 0, y: -3000 }, { x: 24000, y: -3000 }],
});
doc.addPolyline({
  layer: 'FURNITURE', lineType: 'PHANTOM', color: 4, lineTypeScale: 0.5,
  points: [{ x: 1000, y: 8000 }, { x: 9000, y: 8000 }, { x: 9000, y: 13000 }],
});

// 其余实体类型：3DFACE / RAY / XLINE / POINT / ELLIPSE / SPLINE / 椭圆弧
doc.addSpline({
  layer: 'FURNITURE', color: 6, degree: 3,
  controlPoints: [{ x: 18000, y: 11500 }, { x: 19000, y: 13500 }, { x: 20000, y: 9500 }, { x: 21000, y: 11500 }],
  knots: [0, 0, 0, 0, 1, 1, 1, 1],
});
doc.addEllipse({
  layer: 'FURNITURE', color: 6,
  center: { x: 21000, y: 13500 }, majorAxis: { x: 900, y: 0 }, ratio: 0.55,
});
doc.addEllipse({
  layer: 'FURNITURE', color: 6,
  center: { x: 22500, y: 13500 }, majorAxis: { x: 700, y: 0 }, ratio: 0.7,
  startParam: 0, endParam: Math.PI,
});

// 3DFACE（用 addSolid 的 3DFACE 变体不存在，用 SOLID 表达）+ POINT + RAY/XLINE 用 LINE 模拟可见部分
doc.addPoint({ layer: 'FURNITURE', color: 6, position: { x: 2000, y: 2000 } });
doc.addSolid({
  layer: 'FURNITURE', color: 4,
  points: [{ x: 19000, y: 11000 }, { x: 20000, y: 11000 }, { x: 20000, y: 11800 }, { x: 19000, y: 11800 }],
});
doc.addLine({ layer: 'AXIS', color: 1, start: { x: 24000, y: 14400 }, end: { x: 28000, y: 17200 } });
doc.addLine({ layer: 'AXIS', color: 1, start: { x: 0, y: 8000 }, end: { x: 28000, y: 8000 } });

// ---------------------------------------------------------------------------
// 写出（AC1015；--raw 时先解析回读再用保真回放）
// ---------------------------------------------------------------------------
const data = doc.toDxfData();
let result;
if (useRaw) {
  const { parseDxf } = await lib('parser.js');
  const roundtripped = await parseDxf(doc.toDxfString().content, undefined, { yieldIntervalMs: 0, preserveRaw: true });
  result = (await lib('writer.js')).writeDxf(roundtripped, { preserveRaw: true });
} else {
  result = doc.toDxfString();
}

const outFile = join(outDir, 'showcase.dxf');
writeFileSync(outFile, result.content, 'utf8');

const stats = {};
for (const e of data.entities) stats[e.type] = (stats[e.type] || 0) + 1;
console.log(`✔ 生成 ${outFile}`);
console.log(`   实体 ${data.entities.length} 个：${Object.entries(stats).map(([t, n]) => `${t}×${n}`).join(' ')}`);
console.log(`   skipped ${result.skipped.length} 项${result.skipped.length ? '：' + result.skipped.slice(0, 3).map(s => `${s.type}(${s.reason.slice(0, 30)})`).join('、') : ''}`);
