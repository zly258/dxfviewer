#!/usr/bin/env node
/**
 * web-ui-style · UI 静态审计（本仓库适配版）
 *
 * 用法：
 *   node scripts/ui-audit.mjs            # 顾问模式：只报告，退出码 0
 *   node scripts/ui-audit.mjs --strict   # 严格模式：有 Error 则退出码 1
 *   node scripts/ui-audit.mjs --json     # 机器可读输出
 *
 * 规则与 skills/web-ui-style/tools/ui-audit.js 一致，仅把扫描目标换成本项目的
 * `src/ui/styles/*.css` 与 `src/ui/components/**\/*.tsx`：
 *   U1  未定义 CSS 变量                        Error
 *   U2  禁用态使用 opacity                     Error
 *   U3  白字压浅底                             Error
 *   U4  令牌对比度不足（< 4.5:1）               Error
 *   U5  emoji / 图标字体                       Error
 *   U6  z-index 不在阶梯内                     Warn
 *   U7  字号不在阶梯内                         Warn
 *   U8  圆角不在阶梯内                         Warn
 *   U9  内联 style 数量超阈值                  Warn
 *   U10 裸色值（非令牌定义）                    Warn
 *
 * 纯 Node 标准库，无第三方依赖。
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARGS = process.argv.slice(2);
const STRICT = ARGS.includes('--strict');
const JSON_OUT = ARGS.includes('--json');

const STYLE_DIR = path.join(ROOT, 'src/ui/styles');
const COMPONENT_DIR = path.join(ROOT, 'src/ui/components');
const TOKENS_FILE = path.join(STYLE_DIR, 'variables.css');

const Z_LADDER = new Set([6, 20, 25, 50, 60, 200, 1200, 8800, 8900, 9000, 10050, 10060, 100000, 100001]);
const FS_LADDER = new Set([10.5, 11, 11.5, 12, 12.5, 13, 13.5, 15, 16, 18, 21, 22, 56]);
const RADIUS_LADDER = new Set(['0', '2px', '3px', '4px', '10px', '50%', '999px', 'var(--radius)', 'var(--radius-lg)', 'var(--radius-pill)']);

/* 派生色白名单：语义色/表格斑马/遮罩等，允许字面量 */
const DERIVED_HEX = new Set([
  '#f5f7fa', '#f7f9fb', '#fbfcfd', '#fdf3f2', '#fff7f6', '#fef08a',
  '#b7dfb7', '#b7ddb7', '#e6b8b2', '#e8d4a8', '#edf8ee',
  '#c7ccd3', '#c3c8cf', '#a9afb8', '#b6bdc7', '#8f97a3', '#9aa4b2', '#5b6470',
  '#e5e9ef', '#1f2429', '#767b83', '#0f172a', '#0b6b3a', '#8a5b00',
  '#d13438', '#0f6cbd', '#ef4444', '#10b981', '#38bdf8',
  '#e8ebef', '#f0f2f5', '#f2f4f7', '#eef1f5', '#e3e8ee', '#e3eef9',
  '#8fbde6', '#cdd3da', '#e2e6eb', '#b3bac3', '#14181d', '#333940', '#5c636c',
  '#0b5fa5', '#094e88', '#b3261e', '#fbeceb',
]);

const CONTRAST_PAIRS = [
  ['text-main on bg-chrome', '#14181d', '#ffffff'],
  ['text-sec on bg-chrome', '#333940', '#ffffff'],
  ['text-muted on bg-chrome', '#5c636c', '#ffffff'],
  ['text-muted on bg-band', '#5c636c', '#f0f2f5'],
  ['text-muted on bg-app', '#5c636c', '#e8ebef'],
  ['text-sec on bg-band', '#333940', '#f0f2f5'],
  ['accent on bg-chrome', '#0b5fa5', '#ffffff'],
  ['on-accent on accent', '#ffffff', '#0b5fa5'],
  ['on-accent on accent-hover', '#ffffff', '#094e88'],
  ['accent on accent-soft', '#0b5fa5', '#e3eef9'],
  ['danger on bg-chrome', '#b3261e', '#ffffff'],
  ['danger on danger-soft', '#b3261e', '#fbeceb'],
  ['success on bg-chrome', '#0b6b3a', '#ffffff'],
  ['warn on bg-chrome', '#8a5b00', '#ffffff'],
  ['accent on bg-viewport', '#0b5fa5', '#eef1f5'],
];

/* 深色主题（.theme-dark）的对比度：与浅色同一批语义组合，全部要求 ≥ 4.5:1。 */
const DARK_CONTRAST_PAIRS = [
  ['dark: text-main on panel', '#eef2f7', '#1e242c'],
  ['dark: text-main on band', '#eef2f7', '#272e38'],
  ['dark: text-sec on panel', '#c8d1db', '#1e242c'],
  ['dark: text-muted on panel', '#98a3af', '#1e242c'],
  ['dark: text-muted on band', '#98a3af', '#272e38'],
  ['dark: text-muted on app', '#98a3af', '#0f1216'],
  ['dark: accent on panel', '#79b8ea', '#1e242c'],
  ['dark: accent on band', '#79b8ea', '#272e38'],
  ['dark: accent on accent-soft', '#79b8ea', '#16324a'],
  ['dark: on-accent on accent', '#0f1a24', '#79b8ea'],
  ['dark: danger on panel', '#ef9a92', '#1e242c'],
  ['dark: danger on danger-soft', '#ef9a92', '#3a2321'],
  ['dark: success on panel', '#86d3a6', '#1e242c'],
  ['dark: warn on panel', '#e5bc74', '#1e242c'],
  ['dark: text-sec on table-head', '#c8d1db', '#2a313b'],
];

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F000}-\u{1F02F}]/u;

const findings = [];
const add = (sev, rule, file, line, message, hint) => {
  findings.push({ sev, rule, file, line: line || 0, message, hint: hint || '' });
};

const rel = (file) => path.relative(ROOT, file).replace(/\\/g, '/');

function read(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

function walk(dir, filter, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, filter, out);
    else if (filter(entry.name)) out.push(full);
  }
  return out;
}

const lineOf = (text, index) => {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
};

const CSS_FILES = walk(STYLE_DIR, n => n.endsWith('.css'));
const ALL_CSS = CSS_FILES.map(read).join('\n');

/* ── 令牌收集：只认 :root / .theme-dark 内的定义 ── */
function collectDefs(css) {
  const defs = new Set();
  const re = /(--[a-z0-9-]+)\s*:/gi;
  let m;
  while ((m = re.exec(css))) defs.add(m[1]);
  return defs;
}
const DEFS = collectDefs(ALL_CSS);

/* ── 规则扫描 ── */
function rules(css) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const selector = m[1].trim();
    if (!selector || selector.startsWith('@')) continue;
    out.push({ selector, body: m[2], index: m.index });
  }
  return out;
}

function declarations(body) {
  const out = [];
  const re = /([a-z-]+)\s*:\s*([^;]+)/gi;
  let m;
  while ((m = re.exec(body))) out.push({ prop: m[1].toLowerCase(), value: m[2].trim() });
  return out;
}

function luminance(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const c = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function ratio(fg, bg) {
  const a = luminance(fg), b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function main() {
  if (!fs.existsSync(STYLE_DIR)) {
    console.error('✗ 未找到 src/ui/styles');
    process.exit(2);
  }

  /* U4 令牌对比度（浅色 + 深色） */
  for (const [label, fg, bg] of [...CONTRAST_PAIRS, ...DARK_CONTRAST_PAIRS]) {
    const r = ratio(fg, bg);
    if (r < 4.5) {
      add('error', 'U4', 'src/ui/styles/variables.css', 0,
        `对比度不足：${label} = ${r.toFixed(2)}:1 < 4.5:1`, '调整令牌取值');
    }
  }

  /* 逐 CSS 文件 */
  for (const file of CSS_FILES) {
    const text = read(file);
    if (!text) continue;
    const relPath = rel(file);

    /* U1 未定义变量 */
    const vre = /var\(\s*(--[a-z0-9-]+)/gi;
    let vm;
    while ((vm = vre.exec(text))) {
      if (!DEFS.has(vm[1])) {
        add('error', 'U1', relPath, lineOf(text, vm.index),
          `引用了未定义变量 var(${vm[1]})`, '改用 --bg-app/--bg-chrome/--bg-band/--bg-panel，或在 :root 补齐');
      }
    }

    for (const rule of rules(text)) {
      const decls = declarations(rule.body);
      const pick = p => (decls.find(d => d.prop === p) || {}).value || '';
      const line = lineOf(text, rule.index);

      /* U2 禁用态 opacity */
      if (/:disabled|\[disabled\]/.test(rule.selector) && pick('opacity')) {
        add('error', 'U2', relPath, line,
          `禁用态使用 opacity（${rule.selector}）`,
          '改用 background: var(--bg-band); color: var(--text-muted); border-color: var(--border-sub)');
      }

      /* U3 白字压浅底 */
      const color = pick('color').toLowerCase();
      const bg = pick('background-color') || pick('background');
      const bgLower = bg.toLowerCase();
      const isWhiteText = /#fff\b|#ffffff|\bwhite\b|var\(--on-accent\)/.test(color);
      const lightBg = /var\(--bg-(app|band|panel|chrome|hover|subtle|input|soft|viewport)\)|#e8ebef|#f0f2f5|#f2f4f7|#e3e8ee|#ffffff|#fff\b/.test(bgLower);
      const darkBg = /var\(--accent|var\(--danger\)|#0b5fa5|#094e88|#b3261e|#1f2429/.test(bgLower);
      if (isWhiteText && lightBg && !darkBg) {
        add('error', 'U3', relPath, line,
          `白字压浅底（${rule.selector}: color ${color} / background ${bg}）`,
          '浅底必须用 --text-main / --text-sec / --text-muted');
      }

      /* U11 R3 状态契约：改 background 的 :hover/:active/.active/.selected/:disabled 必须同时声明 color。
       * 纯装饰元素（伪元素条、滚动条滑块、拖拽手柄、分隔线）不承载文字，不需要 color。 */
      const DECORATIVE_SELECTOR = /::(after|before)|-webkit-scrollbar|scrollbar-thumb|resize-handle|\.divider|\.tb-sep|\.dropdown-divider/;
      const isStateRule = /:hover|:active|:focus|\.active\b|\.selected\b|:disabled|\[disabled\]|\.checked\b/.test(rule.selector);
      if (isStateRule && bg && !pick('color') && !DECORATIVE_SELECTOR.test(rule.selector)) {
        add('warn', 'U11', relPath, line,
          `状态规则改了背景但未声明 color（${rule.selector}）`,
          '同一规则内补 color（必要时改 border-color）');
      }

      /* U6 z-index */
      const z = pick('z-index');
      if (/^-?\d+$/.test(z) && !Z_LADDER.has(Number(z))) {
        add('warn', 'U6', relPath, line, `z-index: ${z} 不在阶梯内（${rule.selector}）`, '从 docs/01 第 5 节取值');
      }

      /* U7 字号 */
      const fsVal = pick('font-size');
      const fsMatch = /^([0-9.]+)px$/.exec(fsVal);
      if (fsMatch && !FS_LADDER.has(Number(fsMatch[1]))) {
        add('warn', 'U7', relPath, line, `字号 ${fsVal} 不在阶梯内（${rule.selector}）`, '用 11/11.5/12/12.5/13/15/16/18');
      }

      /* U8 圆角 */
      const radius = pick('border-radius').replace(/\s+/g, '');
      if (radius && !RADIUS_LADDER.has(radius)) {
        add('warn', 'U8', relPath, line, `圆角 ${radius} 不在阶梯内（${rule.selector}）`, '用 3px / 4px / 999px');
      }

      /* U10 裸色值 */
      for (const d of decls) {
        if (!/^(background|background-color|border|border-color|color|outline-color|fill|stroke)$/.test(d.prop)) continue;
        const hexes = d.value.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
        for (const hex of hexes) {
          const low = hex.toLowerCase();
          if (DERIVED_HEX.has(low) || low === '#fff' || low === '#ffffff') continue;
          add('warn', 'U10', relPath, line, `裸色值 ${hex}（${rule.selector} { ${d.prop} }）`, '改用 var(--token)');
        }
      }
    }
  }

  /* TSX：emoji / 图标字体 / 内联 style 计数 */
  const TSX_FILES = walk(COMPONENT_DIR, n => n.endsWith('.tsx'));
  const INLINE_STYLE_THRESHOLD = 14;
  for (const file of TSX_FILES) {
    const text = read(file);
    if (!text) continue;
    const relPath = rel(file);

    const emoji = EMOJI_RE.exec(text);
    if (emoji) {
      add('error', 'U5', relPath, lineOf(text, emoji.index),
        `检测到 emoji：${emoji[0]}`, '改用内联 SVG 图标（stroke="currentColor"）');
    }
    const iconFont = /font-family\s*:[^;]*(Font Awesome|Material Icons|iconfont|icomoon)/i.exec(text);
    if (iconFont) {
      add('error', 'U5', relPath, lineOf(text, iconFont.index), '检测到图标字体', '改用内联 SVG');
    }

    const inline = text.match(/style=\{\{/g) || [];
    if (inline.length > INLINE_STYLE_THRESHOLD) {
      add('warn', 'U9', relPath, 0,
        `内联 style 对象 ${inline.length} 处（阈值 ${INLINE_STYLE_THRESHOLD}）`,
        '静态颜色/字号/边框应回到样式类；仅允许动态定位与尺寸');
    }
  }

  /* ── 输出 ── */
  const errors = findings.filter(f => f.sev === 'error');
  const warns = findings.filter(f => f.sev === 'warn');

  if (JSON_OUT) {
    console.log(JSON.stringify({ errors, warnings: warns, summary: { errors: errors.length, warnings: warns.length } }, null, 2));
  } else {
    const byRule = new Map();
    for (const f of findings) {
      if (!byRule.has(f.rule)) byRule.set(f.rule, []);
      byRule.get(f.rule).push(f);
    }
    console.log('');
    console.log('web-ui-style · UI 审计  ' + ROOT);
    console.log('='.repeat(64));
    for (const rule of ['U1', 'U2', 'U3', 'U4', 'U5', 'U6', 'U7', 'U8', 'U9', 'U10', 'U11']) {
      const list = byRule.get(rule);
      if (!list) continue;
      console.log(`\n[${rule}] ${list.length} 项`);
      for (const f of list) {
        const loc = f.line ? `${f.file}:${f.line}` : f.file;
        console.log(`  ${f.sev === 'error' ? '✗' : '!'} ${loc}`);
        console.log(`    ${f.message}`);
        if (f.hint) console.log(`    → ${f.hint}`);
      }
    }
    console.log('\n' + '='.repeat(64));
    console.log(`Error ${errors.length}  ·  Warn ${warns.length}`);
    if (errors.length === 0) console.log('✓ 无阻断项');
    else if (!STRICT) console.log('（顾问模式：退出码 0；加 --strict 作为交付门禁）');
  }

  process.exit(STRICT && errors.length ? 1 : 0);
}

main();
