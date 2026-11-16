---
name: cad-viewer-ui
description: >-
  做或改 CAD / DXF / 技术图纸 Web 查看器 UI 时用：含完整 HTML 骨架、CSS
  模板、胶囊/分段/下拉/抽屉/浮层/加载/状态栏组件，以及 MD3 对齐与 AutoCAD 手势配套约定。
---
# CAD Viewer UI（详细布局 + HTML/CSS 模板）

精简 Material Design 风格的 CAD / DXF 查看器 UI 规范。新建或改版时：**先套本技能的 HTML/CSS 模板，再接业务逻辑**；颜色与文案可换，骨架与组件约定尽量不动。

依赖假设：Tailwind CDN 或同等 utility（示例类名按 Tailwind 3）；图标用内联 SVG。

---

## 1. 何时用

- 「顶栏工具 + 左图层 + 中央画布 + 右属性 + 底状态」五区查看器
- 需要统一胶囊按钮、分段切换、毛玻璃下拉、细滚动条、加载卡、框选 overlay
- 要图标与文字垂直居中、短标签 + 底栏手势提示

---

## 2. 设计令牌

| 令牌 | 值 |
|------|-----|
| 页面底 | `#F8FAFC` / `bg-slate-50` |
| 表面 | `#FFFFFF` |
| 主文字 | `#1E293B` / `text-slate-800` |
| 强调文字 | `text-slate-900` |
| 次文字 | `text-slate-500`–`600` |
| 边框 | `border-slate-200`；分隔用 `border-slate-100` |
| 主色 | `#2563EB` / `blue-600`（主按钮、窗口选、进度） |
| 交叉选 | `#10B981` 实/虚线 + 约 14% 透明底 |
| 顶栏高 | `h-11`（44px） |
| 底栏高 | `h-6`（24px） |
| 左抽屉宽 | `w-56`（224px） |
| 右抽屉宽 | `w-72`（288px） |
| 字号 | 工具/面板 `text-xs`；底栏/chip `text-[11px]` |
| 字体 | `Nunito` + `Noto Sans SC` + 系统中文回退 |
| 圆角 | 胶囊 `rounded-full`；菜单/卡 `rounded-2xl`；菜单项 `rounded-xl` |

Flex 铁律：可伸缩轴上的子项必须带 `min-h-0` 或 `min-w-0`。

---

## 3. 完整 CSS 模板（`<style>`）

复制到 `<head>`，可与 Tailwind 并存：

```html
<style>
  *, *::before, *::after {
    cursor: default !important;
    font-family: 'Nunito', 'Noto Sans SC', -apple-system, BlinkMacSystemFont,
      "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;
  }
  body {
    background-color: #F8FAFC;
    color: #1E293B;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  .mono {
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em;
  }
  /* 输入框恢复文本光标 */
  input, textarea, [contenteditable="true"] {
    cursor: text !important;
  }

  /* MD3 细滚动条 */
  * {
    scrollbar-width: thin;
    scrollbar-color: rgba(148, 163, 184, 0.5) transparent;
  }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; margin: 4px; }
  ::-webkit-scrollbar-thumb {
    background-color: rgba(148, 163, 184, 0.48);
    border-radius: 9999px;
    border: 1.5px solid transparent;
    background-clip: padding-box;
  }
  ::-webkit-scrollbar-thumb:hover {
    background-color: rgba(100, 116, 139, 0.8);
  }
  ::-webkit-scrollbar-corner { background: transparent; }

  /* MD3 滑块 */
  input[type="range"].md-slider {
    -webkit-appearance: none;
    appearance: none;
    height: 4px;
    border-radius: 9999px;
    background: #E2E8F0;
    outline: none;
  }
  input[type="range"].md-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 9999px;
    background: #2563EB;
    box-shadow: 0 1px 3px rgba(37, 99, 235, 0.35);
    transition: transform 0.12s ease, box-shadow 0.12s ease;
  }
  input[type="range"].md-slider::-webkit-slider-thumb:hover {
    transform: scale(1.12);
    box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.15);
  }

  /* 框选 overlay 基类（颜色由 JS 按窗口/交叉切换） */
  #selectionBoxOverlay {
    box-sizing: border-box;
  }
</style>
```

字体链接示例：

```html
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700&family=Noto+Sans+SC:wght@400;500;600&display=swap" rel="stylesheet">
```

---

## 4. 完整 HTML 骨架模板

```html
<body class="h-screen w-screen overflow-hidden flex flex-col select-none bg-slate-50 text-slate-800">

  <!-- ===== 顶栏 ===== -->
  <header class="h-11 bg-white border-b border-slate-200 px-3 flex items-center justify-between shrink-0 z-30 relative gap-2">
    <!-- 左：开关 + 品牌 + 文件名 -->
    <div class="flex items-center gap-2 min-w-0">
      <button type="button" class="inline-flex items-center justify-center leading-none p-1.5 rounded-full hover:bg-slate-100 text-slate-600 transition shrink-0" title="图层">
        <svg class="w-4 h-4 block shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16"/>
        </svg>
      </button>
      <span class="font-semibold text-xs tracking-tight text-slate-900 shrink-0 leading-none">CAD Viewer</span>
      <span class="text-slate-300 shrink-0">/</span>
      <span class="text-xs font-medium text-slate-600 mono truncate max-w-[140px] sm:max-w-[220px]" title="drawing.dxf">drawing.dxf</span>
    </div>

    <!-- 中：视图分段（不要点选/框选切换） -->
    <div class="flex items-center gap-2 shrink-0">
      <div class="hidden sm:inline-flex items-center bg-slate-100 p-0.5 rounded-full">
        <button type="button" class="inline-flex items-center justify-center leading-none px-2.5 py-1 rounded-full text-xs font-medium bg-white text-slate-900 shadow-xs transition">2D</button>
        <button type="button" class="inline-flex items-center justify-center leading-none px-2.5 py-1 rounded-full text-xs font-medium text-slate-600 hover:text-slate-900 transition">3D</button>
        <button type="button" class="inline-flex items-center justify-center leading-none px-2.5 py-1 rounded-full text-xs font-medium text-slate-600 hover:text-slate-900 transition">适应</button>
      </div>
    </div>

    <!-- 右：工具胶囊 -->
    <div class="flex items-center gap-1.5 shrink-0">
      <!-- 搜索胶囊 -->
      <button type="button" class="inline-flex items-center leading-none px-2.5 py-1 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium transition gap-1">
        <svg class="w-3.5 h-3.5 text-slate-500 block shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-4.35-4.35m0 0A7.5 7.5 0 103.5 10.5a7.5 7.5 0 0013.15 6.15z"/>
        </svg>
        <span class="leading-none">搜索</span>
      </button>

      <!-- 主题下拉 -->
      <div class="relative">
        <button type="button" class="inline-flex items-center leading-none px-3 py-1 rounded-full bg-slate-100 hover:bg-slate-200/80 text-slate-700 text-xs font-medium transition gap-1.5">
          <span class="w-2 h-2 rounded-full bg-white border border-slate-400 shrink-0 block"></span>
          <span class="leading-none">白底</span>
          <svg class="w-3 h-3 text-slate-500 block shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>
          </svg>
        </button>
        <div class="hidden absolute right-0 mt-1.5 w-32 bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-2xl shadow-xl p-1 z-50">
          <button type="button" class="w-full px-2.5 py-1.5 rounded-xl text-left text-xs font-medium bg-blue-50 text-blue-600 transition flex items-center justify-between">
            <span class="inline-flex items-center gap-2 leading-none">
              <span class="w-2.5 h-2.5 rounded-full bg-white border border-slate-300 block shrink-0"></span>
              <span>白底</span>
            </span>
            <span class="text-[11px]">✓</span>
          </button>
          <button type="button" class="w-full px-2.5 py-1.5 rounded-xl text-left text-xs font-medium text-slate-700 hover:bg-slate-100 transition flex items-center justify-between mt-0.5">
            <span class="inline-flex items-center gap-2 leading-none">
              <span class="w-2.5 h-2.5 rounded-full bg-slate-900 border border-slate-700 block shrink-0"></span>
              <span>黑底</span>
            </span>
          </button>
        </div>
      </div>

      <!-- 主操作 -->
      <label class="inline-flex items-center leading-none px-3 py-1 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition cursor-pointer">
        打开 DXF
        <input type="file" accept=".dxf" class="hidden" />
      </label>
    </div>

    <!-- 顶栏细进度条 -->
    <div class="hidden absolute bottom-0 left-0 right-0 h-0.5 bg-slate-100 overflow-hidden">
      <div class="h-full bg-blue-600 transition-all duration-75" style="width:0%"></div>
    </div>
  </header>

  <!-- Toast -->
  <div class="fixed bottom-10 left-1/2 -translate-x-1/2 z-50 hidden px-4 py-1.5 rounded-full bg-slate-900/90 text-white text-xs font-medium shadow-md">
    已加载
  </div>

  <!-- ===== 主工作区 ===== -->
  <main class="flex-1 flex min-h-0 relative overflow-hidden">

    <!-- 左抽屉：图层 -->
    <aside class="w-56 bg-white border-r border-slate-200 flex flex-col min-h-0 shrink-0">
      <div class="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
        <span class="text-xs font-semibold text-slate-700">图层 (<span class="mono">0</span>)</span>
        <div class="flex items-center gap-2">
          <button type="button" class="text-xs text-blue-600 hover:underline font-medium">全显</button>
          <button type="button" class="text-xs text-slate-400 hover:text-slate-600">全隐</button>
        </div>
      </div>
      <div class="px-2.5 py-1.5 border-b border-slate-100 bg-slate-50/50">
        <input type="text" placeholder="检索图层..." class="w-full pl-2.5 pr-6 py-1 bg-white border border-slate-200 rounded-md text-xs text-slate-700 placeholder-slate-400 focus:outline-none focus:border-blue-500 transition" />
      </div>
      <div class="flex-1 overflow-y-auto p-1.5 space-y-0.5"><!-- 图层行 --></div>
    </aside>

    <!-- 中央：画布 + 浮层 + 底栏 -->
    <section class="flex-1 relative flex flex-col min-w-0 min-h-0 bg-white">
      <div id="viewport" class="flex-1 w-full h-full relative overflow-hidden"><!-- WebGL canvas --></div>

      <!-- 框选 overlay -->
      <div id="selectionBoxOverlay" class="hidden absolute pointer-events-none z-20" style="left:0;top:0;width:0;height:0;"></div>

      <!-- 搜索浮层 -->
      <div class="hidden absolute top-3 right-3 z-30 w-80 bg-white/95 backdrop-blur border border-slate-200 rounded-2xl shadow-xl flex flex-col overflow-hidden">
        <div class="px-3 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
          <span class="text-xs font-semibold text-slate-800">文件与图元模糊检索</span>
          <div class="flex items-center gap-2">
            <span class="mono text-[11px] text-slate-400">0 / 0</span>
            <button type="button" class="text-slate-400 hover:text-slate-700 text-xs px-1">✕</button>
          </div>
        </div>
        <div class="p-2.5 border-b border-slate-100 space-y-2">
          <input type="text" placeholder="模糊检索..." class="w-full pl-2.5 pr-14 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:bg-white focus:outline-none focus:border-blue-500 transition" />
          <div class="flex items-center gap-1 text-[11px]">
            <button type="button" class="px-2 py-0.5 rounded-md bg-blue-50 text-blue-600 font-medium">全部</button>
            <button type="button" class="px-2 py-0.5 rounded-md text-slate-600 hover:bg-slate-100">文本</button>
            <button type="button" class="px-2 py-0.5 rounded-md text-slate-600 hover:bg-slate-100">属性/块</button>
            <button type="button" class="px-2 py-0.5 rounded-md text-slate-600 hover:bg-slate-100">标注</button>
          </div>
        </div>
        <div class="max-h-64 overflow-y-auto p-1.5 space-y-0.5"><!-- 结果行 --></div>
      </div>

      <!-- 加载卡 -->
      <div class="hidden absolute inset-0 z-30 bg-white/60 backdrop-blur-[2px] flex items-center justify-center">
        <div class="bg-white border border-slate-200 rounded-2xl px-5 py-4 shadow-lg w-72">
          <div class="flex items-center justify-between text-xs font-medium text-slate-700 mb-2">
            <span>正在读取文件...</span>
            <span class="mono text-blue-600">0%</span>
          </div>
          <div class="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden mb-1.5">
            <div class="h-full bg-blue-600 rounded-full transition-all duration-75" style="width:0%"></div>
          </div>
          <div class="text-[11px] text-slate-400 mono truncate">准备解析</div>
        </div>
      </div>

      <footer class="h-6 bg-white border-t border-slate-200 px-3 flex items-center justify-between text-[11px] text-slate-500 shrink-0">
        <div class="flex items-center gap-3 truncate">
          <span class="mono">X: 0.00  Y: 0.00</span>
          <span class="text-slate-400">未选择</span>
          <span>0 图元</span>
        </div>
        <div class="text-slate-400 hidden md:block truncate">
          单击点选 · 拖拽框选 · 滚轮缩放 · 右键/中键平移
        </div>
      </footer>
    </section>

    <!-- 右抽屉：仅当前选择属性 -->
    <aside class="w-72 bg-white border-l border-slate-200 flex flex-col min-h-0 shrink-0">
      <div class="px-3 py-2 border-b border-slate-100 flex items-center justify-between shrink-0">
        <span class="text-xs font-semibold text-slate-800 truncate">对象属性</span>
        <div class="flex items-center gap-1.5 shrink-0">
          <button type="button" class="px-2 py-0.5 rounded bg-blue-50 hover:bg-blue-100 text-blue-600 text-[11px] font-medium transition">定位</button>
          <button type="button" class="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 text-[11px] transition">清除</button>
        </div>
      </div>
      <div class="flex-1 overflow-y-auto p-2.5 space-y-2.5 text-xs"><!-- 属性块 --></div>
    </aside>
  </main>
</body>
```

---

## 5. 组件类名速查（可单独粘贴）

### 5.1 图标+文字胶囊（必守垂直居中）

```html
<button type="button"
  class="inline-flex items-center leading-none px-2.5 py-1 rounded-full
         bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium transition gap-1">
  <svg class="w-3.5 h-3.5 text-slate-500 block shrink-0" ...></svg>
  <span class="leading-none">搜索</span>
</button>
```

纯图标：`inline-flex items-center justify-center leading-none p-1.5 rounded-full ...` + SVG `block shrink-0`。

主色胶囊：同上，但 `bg-blue-600 hover:bg-blue-700 text-white`（无灰底）。

### 5.2 分段切换

```html
<div class="inline-flex items-center bg-slate-100 p-0.5 rounded-full">
  <button class="inline-flex items-center justify-center leading-none px-2.5 py-1 rounded-full text-xs font-medium bg-white text-slate-900 shadow-xs">选中</button>
  <button class="inline-flex items-center justify-center leading-none px-2.5 py-1 rounded-full text-xs font-medium text-slate-600 hover:text-slate-900">未选</button>
</div>
```

### 5.3 下拉菜单壳

```html
<div class="relative">
  <button class="inline-flex items-center leading-none px-3 py-1 rounded-full bg-slate-100 ... gap-1.5">...</button>
  <div class="absolute right-0 mt-1.5 w-32 bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-2xl shadow-xl p-1 z-50">
    <button class="w-full px-2.5 py-1.5 rounded-xl text-left text-xs font-medium ... flex items-center justify-between">...</button>
  </div>
</div>
```

### 5.4 图层列表行

```html
<label class="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-slate-50 text-xs text-slate-700 cursor-pointer">
  <input type="checkbox" class="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
  <span class="w-2 h-2 rounded-full shrink-0" style="background:#2563EB"></span>
  <span class="truncate flex-1 mono">LAYER_NAME</span>
</label>
```

### 5.5 属性卡

```html
<section class="rounded-xl border border-slate-100 bg-slate-50/60 p-2.5 space-y-1.5">
  <div class="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">常规</div>
  <div class="flex justify-between gap-2"><span class="text-slate-500">类型</span><span class="mono text-slate-800">LINE</span></div>
  <div class="flex justify-between gap-2"><span class="text-slate-500">图层</span><span class="mono text-slate-800">0</span></div>
</section>
```

### 5.6 框选 overlay 样式（JS 写入）

窗口选（左→右）：

```js
overlay.style.border = '1.5px solid #2563EB';
overlay.style.backgroundColor = 'rgba(37, 99, 235, 0.12)';
```

交叉选（右→左）：

```js
overlay.style.border = '1.5px dashed #10B981';
overlay.style.backgroundColor = 'rgba(16, 185, 129, 0.14)';
```

始终：`pointer-events-none`；框选过程中**不要**禁用整棵 OrbitControls（滚轮必须可用）。

---

## 6. 布局树（对照用）

```
body.h-screen.flex.flex-col
├── header.h-11          左 | 中 | 右
├── toast.fixed
└── main.flex-1.flex.min-h-0
    ├── aside.w-56       图层
    ├── section.flex-1.flex.flex-col.min-w-0
    │   ├── #viewport.flex-1.relative
    │   ├── #selectionBoxOverlay
    │   ├── 搜索浮层.absolute
    │   ├── 加载遮罩.absolute.inset-0
    │   └── footer.h-6
    └── aside.w-72       仅选中对象属性
```

---

## 7. 交互与文案配套

- 手势已 AutoCAD 化时：**隐藏**点选/框选模式切换
- 底栏提示固定句式：`单击点选 · 拖拽框选 · 滚轮缩放 · 右键/中键平移`
- 顶栏只用短词：搜索、打开、适应、定位、清除、全显、全隐
- 右栏禁止塞图层树或全局设置

---

## 8. 落地步骤

1. 粘贴 §3 CSS + 字体链接 + Tailwind
2. 粘贴 §4 HTML 骨架，改品牌名与 id
3. 所有新按钮按 §5.1 写 `inline-flex items-center leading-none` + SVG `block shrink-0`
4. 接画布；框选用 §5.6；加载/Toast 只切 `hidden`
5. 跑 §9 检查清单

---

## 9. 检查清单

1. 五区齐全；flex 子项有 `min-h-0`/`min-w-0`
2. 图标+文字胶囊垂直居中（无「字偏上/图标偏下」）
3. 分段/下拉/主按钮视觉一致
4. 右栏只服务当前选择
5. 底栏提示与真实手势一致
6. 框选时滚轮仍可缩放
7. 输入框可选中文字（未误伤于全局 `select-none` / cursor 规则）

---

## 10. 反模式

- 左键既平移又框选且无拖拽阈值
- 框选时 `controls.enabled = false` 导致滚轮失效
- 顶栏长句；属性抽屉塞全局配置
- 只用 `flex` 不做 `items-center` / `leading-none` / SVG `block`
- 用 `h-full` 嵌套却漏 `min-h-0` 导致列表无法滚动
