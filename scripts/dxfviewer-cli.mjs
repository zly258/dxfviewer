#!/usr/bin/env node
/**
 * DXF 转换 CLI（M9）。
 *
 * 用法：
 *   dxfviewer convert <input.dxf> <output> [选项]
 *
 * 按输出扩展名分派：
 *   .svg        矢量 SVG（零依赖，纯 TS）
 *   .pdf        矢量 PDF（几何矢量；文字图层需 Canvas，Node 无则自动省略）
 *   .png        栅格 PNG（需注入 canvas 实现，Node 默认不可用，报错并给出建议）
 *   .dxf/.dxb   DXF 写出（AC1015 默认，--r12 降级；--raw 保真回放）
 *
 * 通用选项：
 *   --width N --height N   输出尺寸（SVG/PNG 像素、PDF 用 A 系纸张时忽略）
 *   --paper A4|A3|...      PDF/SVG 纸张（默认 A4 横向由内容决定）
 *   --landscape            横向
 *   --margin MM            页边距（PDF，默认 10）
 *   --background COLOR     背景色（默认 white；transparent/null=透明）
 *   --layout NAME          布局名（默认 Model）
 *   --padding N            内容内边距（默认 24，PDF 默认 0）
 *   --r12                  DXF 输出降级为 AC1009
 *   --raw                  DXF 输出保真回放
 *   --out-dir DIR          批量模式：输入为目录时输出目录
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
// CLI 从包根的 dist 运行；优先相对包根解析，失败再用裸导入
const importLocal = async (path) => {
  try {
    return await import(new URL(path, import.meta.url).href);
  } catch {
    return await import(`@zhangly1403/dxfviewer/${path.replace('../dist/', '').replace('.js', '')}`);
  }
};

const parser = await importLocal('../dist/parser.js');
const render = await importLocal('../dist/render.js');
const exporter = await importLocal('../dist/export.js');
const writerMod = await importLocal('../dist/writer.js');
const parseDxf = parser.parseDxf;

const parseArgs = (argv) => {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i++;
    }
  }
  return { positional, flags };
};

const USAGE = `dxfviewer convert <input.dxf> <output.(svg|pdf|dxf)> [选项]

选项：
  --width N --height N   输出尺寸（像素）
  --paper A4|A3|A2|A1|A0  PDF 纸张（默认按内容适配）
  --landscape            横向
  --margin MM            PDF 页边距（默认 10）
  --background COLOR     背景色，默认 white；传 transparent 透明
  --layout NAME          布局名，默认 Model
  --padding N            内容内边距，默认 24（PDF 为 0）
  --r12                  DXF 输出降级 AC1009
  --raw                  DXF 输出保真回放（需输入经 preserveRaw 解析，CLI 自动启用）
  --list-layouts         仅列出输入文件的布局`;

const die = (message) => {
  console.error(`错误：${message}`);
  console.error(`\n${USAGE}`);
  process.exit(1);
};

const collectInputs = (input) => {
  const stat = statSync(input);
  if (stat.isFile()) return [input];
  if (stat.isDirectory()) {
    return readdirSync(input)
      .filter(name => name.toLowerCase().endsWith('.dxf'))
      .sort()
      .map(name => join(input, name));
  }
  throw new Error(`输入不存在：${input}`);
};

const toPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const backgroundOf = (flags) => {
  const raw = String(flags.background ?? 'white').toLowerCase();
  if (raw === 'transparent' || raw === 'null' || raw === 'none') return null;
  return raw;
};

const main = async () => {
  const { positional, flags } = parseArgs(process.argv.slice(2));

  if (flags.help || flags.h) {
    console.log(USAGE);
    return;
  }
  if (positional.length < 2) die('缺少参数：<input.dxf> <output>');

  const [inputArg, outputArg] = positional;
  const input = isAbsolute(inputArg) ? inputArg : resolve(process.cwd(), inputArg);
  const output = isAbsolute(outputArg) ? outputArg : resolve(process.cwd(), outputArg);

  const inputs = collectInputs(input);
  const batch = inputs.length > 1;
  mkdirSync(dirname(output), { recursive: true });
  if (batch) mkdirSync(output, { recursive: true });

  const parseOptions = { yieldIntervalMs: 0, preserveRaw: flags.raw === true };
  const layoutName = typeof flags.layout === 'string' && flags.layout ? flags.layout : undefined;

  // 批量模式的目标扩展名：取 --format 或输出路径的扩展名；目录输出时必须二者其一
  const batchExt = typeof flags.format === 'string' && flags.format.startsWith('.')
    ? flags.format.toLowerCase()
    : extname(output).toLowerCase();

  for (const file of inputs) {
    const baseName = file.replace(/\\/g, '/').split('/').pop().replace(/\.dxf$/i, '');
    const target = batch ? join(output, `${baseName}${batchExt}`) : output;
    const ext = extname(target).toLowerCase() || batchExt;
    const data = await parseDxf(readFileSync(file, 'utf8'), undefined, parseOptions);

    if (flags['list-layouts']) {
      console.log(`${file}: ${data.layouts.map(l => l.name).join(', ') || '(无布局)'}`);
      continue;
    }

    try {
      if (ext === '.svg') {
        const width = toPositiveInt(flags.width, 1920);
        const height = toPositiveInt(flags.height, 1080);
        const svg = exporter.exportSvg(data, {
          width,
          height,
          layout: layoutName,
          background: backgroundOf(flags) ?? null,
          padding: toPositiveInt(flags.padding, 24),
        });
        writeFileSync(target, svg, 'utf8');
      } else if (ext === '.pdf') {
        const bytes = await exporter.exportPdfVectorBytes(data, {
          paperSize: typeof flags.paper === 'string' ? flags.paper : [297, 210].map(Number),
          orientation: flags.landscape === true ? 'landscape' : 'portrait',
          marginMm: Number.parseFloat(flags.margin ?? '10') || 10,
          layout: layoutName,
          background: backgroundOf(flags),
          title: baseName,
        });
        writeFileSync(target, bytes);
      } else if (ext === '.dxf' || ext === '.dxb') {
        const writer = await import(new URL('../dist/writer.js', import.meta.url).href)
          .catch(() => import('@zhangly1403/dxfviewer/writer'));
        const { content } = writer.writeDxf(data, {
          version: flags.r12 === true ? 'AC1009' : 'AC1015',
          preserveRaw: flags.raw === true,
        });
        writeFileSync(target, content, 'utf8');
      } else if (ext === '.png') {
        die('PNG 导出需要浏览器 Canvas 实现；请改用 --svg 或 --pdf，或在浏览器端调用 exportPng');
      } else {
        die(`不支持的输出格式：${ext}（支持 .svg / .pdf / .dxf）`);
      }
    } catch (error) {
      die(`${file} → ${target}: ${error instanceof Error ? error.message : String(error)}`);
    }

    console.log(`✔ ${file} → ${target}`);
  }
};

main().catch(error => die(error instanceof Error ? error.message : String(error)));
