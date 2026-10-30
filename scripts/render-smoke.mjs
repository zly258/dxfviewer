/**
 * 无头渲染 / PNG / PDF 导出冒烟测试。
 *
 * 没有浏览器时，用一个记录调用的 Canvas2D 影子实现跑通整条导出链路：
 * parseDxf → renderSceneToCanvas → exportPng / exportPdf / exportSvg / exportPdfVector。
 *
 * 校验内容：
 * - 渲染不抛异常且真的产生绘制调用（stroke/fill/text > 0）
 * - PNG Blob 类型正确
 * - PDF 结构合法：文件头、trailer、startxref，以及**交叉引用表偏移逐项回查**
 *   （偏移写错是手写 PDF 最容易致命化的错误，这里按字节验证每个对象位置）
 * - 矢量 PDF：内容流结构、Flate 流用 node:zlib 实际解压验证（SMask 尺寸/非空）
 *
 * 运行：node scripts/render-smoke.mjs（需先 npm run build:lib）
 */
import { inflateSync } from 'node:zlib';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '..');
const samplesDir = join(root, 'samples', 'dxf');

const { parseDxf } = await import(new URL('../dist/parser.js', import.meta.url).href);
const { exportPng, exportPdfBytes, exportSvg, exportPdfVectorBytes } = await import(new URL('../dist/export.js', import.meta.url).href);

/** 记录绘制调用次数的 Canvas2D 影子上下文。 */
const createFakeCanvas = (width, height) => {
  const counter = {
    stroke: 0,
    fill: 0,
    fillText: 0,
    strokeText: 0,
    drawImage: 0,
    fillRect: 0,
    moveTo: 0,
    lineTo: 0,
    arc: 0,
    bezierCurveTo: 0,
  };
  const noop = () => {};
  let font = '10px sans-serif';

  const canvas = {
    width,
    height,
    getContext: () => ctx,
    toBlob: (callback, type = 'image/png') => callback(new Blob([new Uint8Array(16)], { type })),
    toDataURL: type => `data:${type};base64,AAAAAAAAAAAAAAAAAAAAAA==`,
    convertToBlob: async ({ type = 'image/png' } = {}) => new Blob([new Uint8Array(16)], { type }),
  };

  const ctx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'canvas') return canvas;
        if (prop === 'font') return font;
        if (prop === 'measureText') {
          return text => {
            const size = Number.parseFloat(font) || 10;
            const value = String(text);
            const w = [...value].reduce((acc, ch) => acc + (ch.codePointAt(0) > 255 ? size : size * 0.55), 0);
            return {
              width: w,
              actualBoundingBoxLeft: 0,
              actualBoundingBoxRight: w,
              actualBoundingBoxAscent: size * 0.8,
              actualBoundingBoxDescent: size * 0.2,
            };
          };
        }
        if (prop === 'createPattern') return () => ({});
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
          return () => ({ addColorStop: noop });
        }
        if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
        if (prop in counter) return () => { counter[prop]++; };
        return noop;
      },
      set(_target, prop, value) {
        if (prop === 'font') font = String(value);
        return true;
      },
    },
  );

  return { canvas, counter };
};

/** 按字节校验 PDF 交叉引用表：每个 n 项偏移必须正好指向 "N 0 obj"。 */
const validatePdfStructure = (bytes, { expectPages, expectImages }) => {
  const text = new TextDecoder('latin1').decode(bytes);

  if (!text.startsWith('%PDF-1.4')) throw new Error('缺少 %PDF-1.4 文件头');
  if (text.lastIndexOf('%%EOF') < 0) throw new Error('缺少 %%EOF');

  const startxref = /startxref\s+(\d+)\s+%%EOF/.exec(text.slice(text.lastIndexOf('trailer')));
  if (!startxref) throw new Error('startxref 缺失或格式错误');
  const xrefPosition = Number(startxref[1]);
  if (!text.startsWith('xref', xrefPosition)) {
    throw new Error(`startxref 指向的位置不是 xref：偏移 ${xrefPosition}`);
  }

  const trailer = /trailer\s*<<\s*\/Size\s+(\d+)\s*\/Root\s+(\d+) 0 R\s*\/Info\s+(\d+) 0 R/.exec(text);
  if (!trailer) throw new Error('trailer 缺少 /Size /Root /Info');
  const size = Number(trailer[1]);
  const rootNumber = Number(trailer[2]);

  // xref 段：'xref' / '0 N' / N 条 20 字节条目（19 字符 + 换行）。
  const lines = text.slice(xrefPosition).split('\n');
  if (lines[0].trim() !== 'xref') throw new Error(`startxref 指向的位置不是 xref：偏移 ${xrefPosition}`);
  const range = /^0 (\d+)$/.exec(lines[1].trim());
  if (!range) throw new Error(`xref 段头异常："${lines[1]}"`);
  if (Number(range[1]) !== size) throw new Error(`xref 段头条目数 ${range[1]} 与 /Size ${size} 不一致`);

  for (let objectNumber = 0; objectNumber < size; objectNumber++) {
    const rawEntry = lines[2 + objectNumber];
    if (rawEntry === undefined) throw new Error(`xref 缺少对象 ${objectNumber} 的条目`);
    if (rawEntry.length !== 19) throw new Error(`对象 ${objectNumber} 的 xref 条目不是 20 字节：${JSON.stringify(rawEntry)}`);
    const match = /^(\d{10}) (\d{5}) ([nf])$/.exec(rawEntry.trim());
    if (!match) throw new Error(`对象 ${objectNumber} 的 xref 条目格式非法：${JSON.stringify(rawEntry)}`);
    if (objectNumber === 0) {
      if (match[3] !== 'f' || match[1] !== '0000000000') throw new Error('xref 首项必须是空闲表头');
      continue;
    }
    if (match[3] !== 'n') throw new Error(`对象 ${objectNumber} 未被标记为在用`);
    const offset = Number(match[1]);
    const expected = `${objectNumber} 0 obj`;
    if (!text.startsWith(expected, offset)) {
      throw new Error(`对象 ${objectNumber} 偏移错误：${offset} 处不是 "${expected}"`);
    }
  }

  if (!text.includes(`/Root ${rootNumber} 0 R`)) throw new Error('/Root 指向的对象不存在');

  const pageCount = (text.match(/\/Type \/Page[^s]/g) ?? []).length;
  if (pageCount !== expectPages) throw new Error(`页数不符：期望 ${expectPages}，实际 ${pageCount}`);

  // 图像数量按需校验：栅格版每页一张 JPEG；矢量版仅有文字图层时才有图像
  if (expectImages !== undefined) {
    const imageCount = (text.match(/\/Subtype \/Image/g) ?? []).length;
    if (imageCount !== expectImages) {
      throw new Error(`图像 XObject 数量不符：期望 ${expectImages}，实际 ${imageCount}`);
    }
  }

  return { pageCount, size };
};

const files = readdirSync(samplesDir).filter(name => name.endsWith('.dxf')).sort();
if (files.length === 0) {
  console.error('未找到夹具文件：samples/dxf/*.dxf');
  process.exit(1);
}

let failed = 0;
const rows = [];

for (const name of files) {
  const text = readFileSync(join(samplesDir, name), 'utf8');
  try {
    const data = await parseDxf(text, undefined, { yieldIntervalMs: 0 });

    // PNG
    const png = createFakeCanvas(800, 600);
    const blob = await exportPng(data, { width: 800, height: 600, createCanvas: () => png.canvas });
    const drawn = png.counter.stroke + png.counter.fill + png.counter.fillText + png.counter.strokeText;
    if (!blob || blob.type !== 'image/png' || blob.size === 0) throw new Error('exportPng 返回的 Blob 无效');
    if (drawn === 0) throw new Error('渲染未产生任何绘制调用（stroke/fill/text 全为 0）');

    // PDF：单页 A4
    const pdfCanvas = createFakeCanvas(100, 100);
    const pdfBytes = await exportPdfBytes(data, {
      paperSize: 'A4',
      orientation: 'landscape',
      dpi: 72,
      createCanvas: (w, h) => {
        pdfCanvas.canvas.width = w;
        pdfCanvas.canvas.height = h;
        return pdfCanvas.canvas;
      },
    });
    validatePdfStructure(pdfBytes, { expectPages: 1, expectImages: 1 });

    // SVG：结构校验（矢量导出不依赖 Canvas，直接可用）
    const svg = exportSvg(data, { width: 800, height: 600 });
    if (!svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')) {
      throw new Error('SVG 缺少正确的根元素');
    }
    if (!svg.trimEnd().endsWith('</svg>')) throw new Error('SVG 未正确闭合');
    if (/NaN|undefined|Infinity/.test(svg)) throw new Error('SVG 含非法数值（NaN/undefined/Infinity）');
    if (!/<path /.test(svg) && !/<text /.test(svg)) {
      throw new Error('SVG 未包含任何图元（path/text）');
    }
    if (/transform="matrix\([^"]*[^-\d.\s][^"]*\)"/.test(svg)) {
      throw new Error('SVG matrix 变换含非数值');
    }

    // PDF：多页（模型 + 已有布局各一页）
    const layoutNames = (data.layouts ?? []).map(layout => layout.name);
    if (layoutNames.length > 1) {
      const multi = await exportPdfBytes(data, {
        paperSize: [100, 100],
        dpi: 36,
        layouts: layoutNames,
        createCanvas: () => createFakeCanvas(64, 64).canvas,
      });
      validatePdfStructure(multi, { expectPages: layoutNames.length, expectImages: layoutNames.length });
    }

    rows.push({
      name,
      stroke: png.counter.stroke,
      fill: png.counter.fill,
      text: png.counter.fillText + png.counter.strokeText,
      pngSize: blob.size,
      pdfSize: pdfBytes.length,
      svgSize: svg.length,
    });
  } catch (error) {
    failed++;
    console.error(`✘ ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const pad = (value, width) => String(value).padEnd(width);
console.log(`${pad('夹具', 22)}${pad('stroke', 8)}${pad('fill', 6)}${pad('text', 6)}${pad('png', 9)}${pad('pdf', 9)}svg`);
for (const row of rows) {
  console.log(
    `${pad(row.name, 22)}${pad(row.stroke, 8)}${pad(row.fill, 6)}${pad(row.text, 6)}`
    + `${pad(`${row.pngSize}B`, 9)}${pad(`${row.pdfSize}B`, 9)}${row.svgSize}B`,
  );
}

// PDF 尺寸断言：A4 横向页面应为 841.89 × 595.28 pt。
const sizeCheck = createFakeCanvas(1, 1);
const a4Landscape = await exportPdfBytes(
  await parseDxf(readFileSync(join(samplesDir, 'line-circle.dxf'), 'utf8'), undefined, { yieldIntervalMs: 0 }),
  { paperSize: 'A4', orientation: 'landscape', dpi: 36, createCanvas: () => sizeCheck.canvas },
);
const mediaBox = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(new TextDecoder('latin1').decode(a4Landscape));
if (!mediaBox) {
  console.error('✘ 未能读取 MediaBox');
  failed++;
} else {
  const [width, height] = [Number(mediaBox[1]), Number(mediaBox[2])];
  const ok = Math.abs(width - 841.89) < 0.02 && Math.abs(height - 595.28) < 0.02;
  console.log(`\nA4 横向 MediaBox = ${width} × ${height} pt（期望 841.89 × 595.28）${ok ? '✔' : '✘'}`);
  if (!ok) failed++;
}

// ---- 矢量 PDF（M7）----
const validateVectorPdf = (bytes, { expectPages }) => {
  const structure = validatePdfStructure(bytes, { expectPages });
  const text = new TextDecoder('latin1').decode(bytes);

  // 内容流校验：底色矩形（re f）必须存在；线/圆夹具还应有路径操作符
  const rectFills = (text.match(/\d(?:\.\d+)? re f/g) ?? []).length;
  if (rectFills < expectPages) throw new Error(`矢量内容流缺少底色矩形（仅 ${rectFills} 处）`);
  const moveToOps = (text.match(/\d\.\d+ m\n/g) ?? []).length;
  const curveOps = (text.match(/\d\.\d+ c\n/g) ?? []).length;

  // 矢量 PDF 的 SMask（文字 alpha 图层）：找到 /SMask N 0 R 的对象，解压验证
  const smaskRefs = [...text.matchAll(/\/SMask (\d+) 0 R/g)].map(m => Number(m[1]));
  const xrefPos = Number(/startxref\s+(\d+)/.exec(text.slice(text.lastIndexOf('trailer')))[1]);
  const lines = text.slice(xrefPos).split('\n');
  const offsets = new Map();
  for (let i = 1; i < lines.length - 3; i++) {
    const entry = (lines[2 + i] ?? '').trim();
    const match = /^(\d{10}) (\d{5}) n$/.exec(entry);
    if (match) offsets.set(i, Number(match[1]));
  }

  let smaskChecked = 0;
  for (const objectNumber of smaskRefs) {
    const offset = offsets.get(objectNumber);
    if (!offset) throw new Error(`SMask 对象 ${objectNumber} 不在 xref 中`);
    const objectText = text.slice(offset, offset + 400);
    const widthMatch = /\/Width (\d+)/.exec(objectText);
    const heightMatch = /\/Height (\d+)/.exec(objectText);
    const lengthMatch = /\/Length (\d+)/.exec(objectText);
    if (!widthMatch || !heightMatch || !lengthMatch) throw new Error(`SMask ${objectNumber} 缺少尺寸/长度`);
    const declared = Number(lengthMatch[1]);
    const pixels = Number(widthMatch[1]) * Number(heightMatch[1]);

    const streamStart = text.indexOf('stream\n', offset) + 'stream\n'.length;
    const payload = bytes.subarray(streamStart, streamStart + declared);

    let decoded;
    try {
      decoded = inflateSync(Buffer.from(payload));
    } catch {
      continue; // 未压缩流跳过解压验证
    }
    if (decoded.length !== pixels) {
      throw new Error(`SMask ${objectNumber} 解压长度 ${decoded.length} ≠ 宽×高 ${pixels}`);
    }
    smaskChecked++;
  }

  return { ...structure, smaskChecked, moveToOps, curveOps };
};

let vectorStats;
try {
  // line-circle 含直线与整圆（贝塞尔化后应有 m/c 操作符）
  const sampleData = await parseDxf(
    readFileSync(join(samplesDir, 'line-circle.dxf'), 'utf8'),
    undefined,
    { yieldIntervalMs: 0 },
  );

  const vectorBytes = await exportPdfVectorBytes(sampleData, {
    paperSize: 'A4',
    orientation: 'portrait',
    textRasterScale: 2,
    createCanvas: () => createFakeCanvas(64, 64).canvas,
  });
  vectorStats = validateVectorPdf(vectorBytes, { expectPages: 1 });
  if (vectorStats.moveToOps < 2 || vectorStats.curveOps < 4) {
    throw new Error(
      `矢量几何不符：move=${vectorStats.moveToOps}（期望≥2），curve=${vectorStats.curveOps}（期望≥4，整圆=8 段贝塞尔）`,
    );
  }
  console.log(
    `\n矢量 PDF：页数 ${vectorStats.pageCount}，move ${vectorStats.moveToOps} / curve ${vectorStats.curveOps}，SMask 校验 ${vectorStats.smaskChecked} 处 ✔`,
  );
} catch (error) {
  failed++;
  console.error(`✘ 矢量 PDF: ${error instanceof Error ? error.message : String(error)}`);
}

console.log(`共 ${files.length} 个夹具，失败 ${failed} 项。`);
process.exit(failed === 0 ? 0 : 1);
