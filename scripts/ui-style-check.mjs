#!/usr/bin/env node
/**
 * web-ui-style · 浏览器实测（尺寸阶梯 / 三栏骨架 / 移动端 / 深色主题）
 *
 * 用法：
 *   node scripts/ui-style-check.mjs                     # 需先启动示例 dev server
 *   DXFVIEWER_URL=http://localhost:3001 node scripts/ui-style-check.mjs
 *   node scripts/ui-style-check.mjs --update-screenshots
 *
 * 校验 web-ui-style 的硬性尺寸契约：
 *   顶栏 42 / 工具条行 32 / 底栏 30 / 控件 26（小号 22）/ 树行 26 / 页签 26
 *   左栏 ≤ 320（clamp 上限）/ 右栏 ≤ 440（clamp 上限）/ 正文 12.5 / 表格与树 12
 * 另校验：深色主题令牌生效、移动端工具条按钮 32px、无控制台错误。
 *
 * 依赖 playwright-core（devDependency），无该依赖时跳过并以 0 退出。
 */
'use strict';

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = process.env.DXFVIEWER_URL || 'http://localhost:3001';
const UPDATE_SHOTS = process.argv.includes('--update-screenshots');
const SHOT_DIR = path.join(ROOT, 'artifacts', 'ui-style');
const SAMPLE = path.join(ROOT, 'samples', 'special-symbols-full-test.dxf');

const failures = [];
const check = (label, actual, expected) => {
  const ok = typeof expected === 'function' ? expected(actual) : actual === expected;
  if (!ok) failures.push(`${label}: 实际 ${JSON.stringify(actual)}，期望 ${typeof expected === 'function' ? expected.toString() : JSON.stringify(expected)}`);
  console.log(`${ok ? '✓' : '✗'} ${label} = ${JSON.stringify(actual)}`);
};

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.log('· 未安装 playwright-core，跳过浏览器实测');
  process.exit(0);
}

/** 读取页面元素几何：选择器 → 取第一个可见元素。 */
const measure = async (page, spec) =>
  page.evaluate((spec) => {
    const out = {};
    for (const [key, selector] of Object.entries(spec)) {
      const el = Array.from(document.querySelectorAll(selector))
        .find(node => node.getBoundingClientRect().width > 0 || node.getBoundingClientRect().height > 0);
      if (!el) { out[key] = null; continue; }
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      out[key] = {
        w: Math.round(rect.width),
        h: Math.round(rect.height),
        fontSize: style.fontSize,
        visibility: style.visibility,
      };
    }
    return out;
  }, spec);

const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

// 统计文件读取次数：每次 DXF 解析会读一次文件（FileReader），
// 用来断言「切换/右键文件标签不重复解析（不刷新重载）」。
await page.addInitScript(() => {
  window.__fileReads = 0;
  const original = FileReader.prototype.readAsArrayBuffer;
  FileReader.prototype.readAsArrayBuffer = function patchedRead(...args) {
    window.__fileReads += 1;
    return original.apply(this, args);
  };
});

const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() !== 'error') return;
  const text = msg.text();
  // 资源 404 由 failedResources 精确校验（示例工程无 favicon 属预期）。
  if (/favicon/.test(text) || /Failed to load resource/.test(text)) return;
  consoleErrors.push(text);
});
/** JS 运行时异常：必须为 0。 */
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error && error.message ? error.message : error)));
/** 记录非 favicon 的资源 404，便于定位（示例工程无图标文件属预期）。 */
const failedResources = [];
page.on('response', (response) => {
  if (response.status() >= 400 && !/favicon/.test(response.url())) {
    failedResources.push(`${response.status()} ${response.url()}`);
  }
});

try {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
} catch (error) {
  console.log(`· 无法访问 ${BASE_URL}（${error.message}），跳过浏览器实测`);
  await browser.close();
  process.exit(0);
}

await page.waitForTimeout(800);

/* ── 1. 桌面三栏骨架与尺寸阶梯 ── */
const desktop = await measure(page, {
  header: '.app-header',
  toolbarRow: '.ui-toolbar-row',
  footer: '.app-footer',
  leftPanel: '.side-panel-shell .side-panel-frame',
  panelHead: '.layer-panel-header',
  searchBox: '.layer-search-box',
  canvas: '.canvas-container',
  iconBtn: '.toolbar .toolbar-button',
  headerBtn: '.app-header .tb-icon-btn',
  body: 'body',
});

check('顶栏高度 = 42', desktop.header?.h, 42);
check('工具条行高度 = 32', desktop.toolbarRow?.h, 32);
check('底栏高度 = 30', desktop.footer?.h, 30);
check('面板头 = 32（工具条行/页签行）', desktop.panelHead?.h, 32);
check('搜索框 = 26', desktop.searchBox?.h, 26);
check('工具条图标按钮 = 24', desktop.iconBtn?.h, 24);
check('顶栏图标按钮 = 24', desktop.headerBtn?.h, 24);
check('左栏宽 ≤ 320', desktop.leftPanel?.w, (v) => v > 0 && v <= 320);
check('正文 12.5px', desktop.body?.fontSize, '12.5px');

/* 全部工具条/顶栏按钮必须是纯图标：无文字节点、含 SVG */
const pureIconButtons = await page.evaluate(() => {
  const buttons = [
    ...document.querySelectorAll('.toolbar .toolbar-button'),
    ...document.querySelectorAll('.app-header .tb-icon-btn'),
  ];
  return {
    total: buttons.length,
    withText: buttons.filter(b => (b.textContent || '').trim().length > 0).length,
    withSvg: buttons.filter(b => b.querySelector('svg')).length,
    labelled: buttons.filter(b => (b.getAttribute('title') || b.getAttribute('aria-label') || '').trim().length > 0).length,
    iconSize: (() => {
      const svg = document.querySelector('.toolbar .toolbar-button svg');
      return svg ? Math.round(svg.getBoundingClientRect().width) : null;
    })(),
  };
});
check('按钮全部为纯图标（无文字）', pureIconButtons.withText, 0);
check('每个按钮都含 SVG 图标', pureIconButtons.withSvg, pureIconButtons.total);
check('每个按钮都有 title/aria-label', pureIconButtons.labelled, pureIconButtons.total);
check('图标尺寸 16px', pureIconButtons.iconSize, 16);

await page.setInputFiles('.toolbar .hidden-file-input', SAMPLE).catch(() => {});
await page.waitForTimeout(2200);

const tree = await measure(page, {
  treeRow: '.layer-row',
  entityRow: '.entity-row',
  tab: '.tab-item',
  fontTree: '.tree-row',
});
if (tree.treeRow) {
  check('树行 = 26', tree.treeRow?.h, 26);
  check('构件行 = 26', tree.entityRow?.h, 26);
  check('文件页签 = 26', tree.tab?.h, 26);
  check('树行字号 12px', tree.fontTree?.fontSize, '12px');
} else {
  console.log('· 未找到 sample DXF（*.dxf 不入库），跳过分区树/页签实测');
}

if (UPDATE_SHOTS) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, 'desktop.png') });
}

/* ── 1.5 回归：切换 / 右键文件标签不得重复解析（不刷新重载） ── */
const readsBeforeSwitch = await page.evaluate(() => window.__fileReads || 0);
const tabCount = await page.evaluate(() => Array.from(document.querySelectorAll('.tab-item')).length);
const secondSample = path.join(ROOT, 'samples', 'stress-20k.dxf');
if (tabCount === 1 && fs.existsSync(secondSample)) {
  // 打开第二个文件形成多标签页
  await page.setInputFiles('.toolbar .hidden-file-input', secondSample).catch(() => {});
  await page.waitForTimeout(4000);
}
const readsAfterOpen = await page.evaluate(() => window.__fileReads || 0);

// 切换标签：连续点两个标签
await page.evaluate(() => {
  const tabs = Array.from(document.querySelectorAll('.tab-item')).filter(t => t.getBoundingClientRect().width > 0);
  tabs[0]?.click();
});
await page.waitForTimeout(500);
await page.evaluate(() => {
  const tabs = Array.from(document.querySelectorAll('.tab-item')).filter(t => t.getBoundingClientRect().width > 0);
  tabs[tabs.length - 1]?.click();
});
await page.waitForTimeout(500);

// 右键当前标签（应只弹菜单，不重载）
await page.evaluate(() => {
  const tabs = Array.from(document.querySelectorAll('.tab-item')).filter(t => t.getBoundingClientRect().width > 0);
  const target = tabs[tabs.length - 1];
  if (!target) return;
  const rect = target.getBoundingClientRect();
  target.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: Math.round(rect.left + rect.width / 2),
    clientY: Math.round(rect.top + rect.height / 2),
  }));
});
await page.waitForTimeout(600);
const contextMenuOpen = await page.evaluate(() => !!document.querySelector('.tab-context-menu'));
await page.evaluate(() => document.body.click());
await page.waitForTimeout(300);

const readsAfterSwitch = await page.evaluate(() => window.__fileReads || 0);
check('打开新文件触发一次解析', readsAfterOpen > readsBeforeSwitch, true);
check('切换文件标签不重复解析（不刷新重载）', readsAfterSwitch, readsAfterOpen);
check('右键文件标签弹出菜单', contextMenuOpen, true);
check('右键文件标签不重复解析（不刷新重载）', await page.evaluate(() => window.__fileReads || 0), readsAfterOpen);

/* ── 2. 深色主题令牌生效 ── */
await page.evaluate(() => {
  const viewBtn = document.querySelector('.toolbar button[aria-label="视图"]');
  viewBtn?.click();
});
await page.waitForTimeout(200);
await page.evaluate(() => {
  const item = Array.from(document.querySelectorAll('.dropdown-item'))
    .find(b => b.textContent.includes('深色主题'));
  item?.click();
});
await page.waitForTimeout(500);

const dark = await page.evaluate(() => {
  const container = document.querySelector('.app-container');
  const footer = document.querySelector('.app-footer');
  return {
    hasClass: container?.classList.contains('theme-dark') || false,
    footerBg: footer ? getComputedStyle(footer).backgroundColor : '',
    footerColor: footer ? getComputedStyle(footer).color : '',
  };
});
check('深色主题类生效', dark.hasClass, true);
check('深色底栏底色为深色', dark.footerBg, (v) => /^rgb\((\d+), (\d+), (\d+)\)$/.test(v) && Number(v.match(/^rgb\((\d+)/)[1]) < 90);

/* 深色层次与对比度：验证「暗色模式显示不明显」已优化 */
const darkContrast = await page.evaluate(() => {
  const parse = (value) => (value.match(/\d+/g) || []).slice(0, 3).map(Number);
  const luminance = (rgb) => rgb
    .map(v => v / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => {
    const x = luminance(a);
    const y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const css = (sel, prop) => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el).getPropertyValue(prop) : 'rgb(0, 0, 0)';
  };
  const panel = parse(css('.layer-panel', 'background-color'));
  const band = parse(css('.ui-toolbar-row', 'background-color'));
  const app = parse(css('.app-container', 'background-color'));
  const textMain = parse(css('.layer-row', 'color'));
  const textMuted = parse(css('.app-footer', 'color'));
  const border = parse(css('.layer-panel-header', 'border-bottom-color'));
  const sum = (rgb) => rgb.reduce((a, v) => a + v, 0);
  return {
    textMainPanel: Number(ratio(textMain, panel).toFixed(2)),
    textMutedBand: Number(ratio(textMuted, band).toFixed(2)),
    bandVsPanel: Math.abs(sum(band) - sum(panel)),
    appVsPanel: Math.abs(sum(app) - sum(panel)),
    borderVsPanel: Math.abs(sum(border) - sum(panel)),
  };
});
check('深色正文对比度 ≥ 4.5', darkContrast.textMainPanel, (v) => v >= 4.5);
check('深色次要文字对比度 ≥ 4.5', darkContrast.textMutedBand, (v) => v >= 4.5);
check('深色工具条带与面板亮度可区分', darkContrast.bandVsPanel, (v) => v >= 15);
check('深色页面底与面板亮度可区分', darkContrast.appVsPanel, (v) => v >= 15);
check('深色分隔线可见', darkContrast.borderVsPanel, (v) => v >= 10);

if (UPDATE_SHOTS) {
  await page.screenshot({ path: path.join(SHOT_DIR, 'desktop-dark.png') });
}

// 切回浅色
await page.evaluate(() => {
  const viewBtn = document.querySelector('.toolbar button[aria-label="视图"]');
  viewBtn?.click();
});
await page.waitForTimeout(200);
await page.evaluate(() => {
  const item = Array.from(document.querySelectorAll('.dropdown-item'))
    .find(b => b.textContent.includes('浅色主题'));
  item?.click();
});
await page.waitForTimeout(400);

/* ── 3. 移动端（≤768px）：工具条按钮 32px、视口浮层不遮挡 ── */
await page.setViewportSize({ width: 700, height: 900 });
await page.waitForTimeout(700);

const mobile = await page.evaluate(() => {
  const container = document.querySelector('.app-container');
  const btn = document.querySelector('.mobile-tool-button');
  const chip = document.querySelector('.mobile-coord-chip');
  const canvas = document.querySelector('.canvas-container');
  const visibleTabs = Array.from(document.querySelectorAll('.tab-item'))
    .filter(t => t.getBoundingClientRect().width > 0).length;
  return {
    isMobile: container?.classList.contains('is-mobile') ?? false,
    toolBtn: btn ? Math.round(btn.getBoundingClientRect().height) : null,
    chipVisible: chip ? getComputedStyle(chip).display !== 'none' : false,
    canvasWidth: canvas ? Math.round(canvas.getBoundingClientRect().width) : null,
    visibleTabs,
  };
});
check('移动端类生效', mobile.isMobile, true);
check('移动端工具按钮 = 32', mobile.toolBtn, 32);
check('坐标浮层显示', mobile.chipVisible, true);
check('视口未被撑破', mobile.canvasWidth, (v) => v !== null && v > 0 && v <= 700);
check('移动端保留文件标签条', mobile.visibleTabs, (v) => v >= 1);

if (UPDATE_SHOTS) {
  await page.screenshot({ path: path.join(SHOT_DIR, 'mobile.png') });
}

/* ── 4. 功能回归：侧栏拖拽、图层显隐、画布右键菜单 ── */
// 回到桌面尺寸：移动端不渲染左右侧栏，也就没有拖拽手柄。
await page.setViewportSize({ width: 1600, height: 900 });
await page.waitForTimeout(700);

/**
 * 多标签时每个标签各有一套侧栏，必须只取「可见的那个 viewer」的手柄
 * （隐藏标签用 visibility:hidden，布局仍在，不能用 getBoundingClientRect 判断）。
 */
const findVisibleHandle = () => page.evaluate(() => {
  const handles = Array.from(document.querySelectorAll('.panel-resize-handle-right'));
  const handle = handles.find((el) => {
    const host = el.closest('.tab-viewer-host');
    return !host || getComputedStyle(host).visibility !== 'hidden';
  });
  if (!handle) return null;
  const host = handle.closest('.tab-viewer-host') || document;
  const frame = host.querySelector('.side-panel-frame');
  const rect = handle.getBoundingClientRect();
  return {
    x: Math.round(rect.x + rect.width / 2),
    y: Math.round(rect.y + 120),
    width: frame ? Math.round(frame.getBoundingClientRect().width) : null,
  };
});

const resizeHandle = await findVisibleHandle();
if (resizeHandle && resizeHandle.width !== null) {
  const before = resizeHandle.width;
  await page.mouse.move(resizeHandle.x, resizeHandle.y);
  await page.mouse.down();
  await page.mouse.move(resizeHandle.x - 200, resizeHandle.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const after = (await findVisibleHandle())?.width;
  check('拖拽后左栏宽度被钳制在 250', after, 250);
  check('拖拽确实改变了宽度', after < before, true);
} else {
  console.log('· 未找到侧栏拖拽手柄，跳过');
}

const layerToggle = await page.evaluate(() => {
  const hosts = Array.from(document.querySelectorAll('.tab-viewer-host'));
  const scope = hosts.find(h => getComputedStyle(h).visibility !== 'hidden') || document;
  const toggle = scope.querySelector('.layer-visibility-toggle');
  if (!toggle) return null;
  toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return true;
});
if (layerToggle) {
  await page.waitForTimeout(250);
  const hidden = await page.evaluate(() => {
    const hosts = Array.from(document.querySelectorAll('.tab-viewer-host'));
    const scope = hosts.find(h => getComputedStyle(h).visibility !== 'hidden') || document;
    return !!scope.querySelector('.layer-row.layer-hidden');
  });
  check('图层显隐切换生效', hidden, true);
} else {
  console.log('· 未找到图层可见性开关，跳过');
}

const contextMenu = await page.evaluate(() => {
  const hosts = Array.from(document.querySelectorAll('.tab-viewer-host'));
  const scope = hosts.find(h => getComputedStyle(h).visibility !== 'hidden') || document;
  const canvas = scope.querySelector('.canvas-container');
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  canvas.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true,
    clientX: Math.round(rect.left + rect.width / 2),
    clientY: Math.round(rect.top + rect.height / 2),
  }));
  return true;
});
if (contextMenu) {
  await page.waitForTimeout(250);
  const menu = await page.evaluate(() => {
    const el = document.querySelector('.canvas-context-menu');
    if (!el) return null;
    const style = getComputedStyle(el);
    return { items: el.querySelectorAll('button').length, zIndex: style.zIndex, radius: style.borderRadius };
  });
  check('画布右键菜单出现', menu?.items, 4);
  check('右键菜单 z-index 取自阶梯（200）', menu?.zIndex, '200');
  check('右键菜单圆角 4px', menu?.radius, '4px');
} else {
  console.log('· 未找到画布容器，跳过右键菜单');
}

/* ── 5. 控制台无错误（favicon 404 除外） ── */
check('无失败资源请求', failedResources, (v) => v.length === 0);
if (failedResources.length) failedResources.forEach(r => console.log(`    ${r}`));
check('无 JS 运行时异常', pageErrors, (v) => v.length === 0);
if (pageErrors.length) pageErrors.forEach(e => console.log(`    ${e}`));
check('控制台无错误', consoleErrors, (v) => v.length === 0);
if (consoleErrors.length) consoleErrors.forEach(e => console.log(`    ${e}`));

await browser.close();

console.log('');
if (failures.length) {
  console.log(`✗ ${failures.length} 项不符合 web-ui-style 尺寸契约`);
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
}
console.log('✓ 全部尺寸/骨架/主题/移动端契约通过');
