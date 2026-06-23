# DXF Viewer

基于 React 和 HTML5 Canvas 的 DXF 文件查看组件。项目提供核心查看器、完整多 Tab 工作区和独立示例工程，适合嵌入业务系统或发布在线预览。

在线预览地址：

```text
https://zly258.github.io/dxfviewer/
```

## 功能

- 模型空间与图纸空间解析：完整保留 `Model` 和任意数量的 `Layout`；桌面端底部只显示有实体的图纸空间，移动端在视图设置面板中切换，空图纸空间不可切换。
- 多 Tab 工作区：`DxfWorkspace` 提供桌面端多文件查看能力，`DxfViewer` 可单独嵌入业务系统。
- 移动端适配：小屏下使用全屏画布和统一右侧工具栏，打开文件、搜索、视图历史、充满视图、图层面板、属性面板、视图设置、关于全部集中在右侧；图纸空间切换也放入视图设置面板，不再使用底部抽屉或底部空间切换条。
- 工具栏与视图历史：桌面端顶部使用简化的纯 SVG 图标工具栏，不显示文字按钮；支持打开、上一个视图、下一个视图、充满视图、搜索、视图设置和关于，并通过分隔符区分功能组。
- 主题跟随系统：支持系统、浅色主题、深色主题三种 UI 主题；图纸颜色支持原色和黑白模式，主题、语言、黑白模式统一放在视图设置菜单中。
- 常用实体渲染：支持线、射线、构造线、点、圆、圆弧、椭圆、多段线、样条、填充、文字、多行文字、属性、块参照、标注、引线、多重引线、表格、图片、遮罩、视口、形文件占位等。
- 图层和属性面板：支持图层面板显示控制、实体选择、属性面板查看；图层显隐只触发重绘，不会自动执行充满视图。
- 右键临时显示控制：画布右键菜单始终可打开；未选择实体时可执行全部显示，选择实体后可执行隐藏选中、隔离选中、关闭图层；移动端长按也会打开同一菜单，菜单位置自动约束在画布可见区域内。
- 图纸文字搜索：搜索图标点击后显示搜索面板，面板可关闭；支持在当前模型空间或当前图纸空间搜索 TEXT、MTEXT、属性、标注、多重引线、表格、公差和块参照内文字，并可定位到匹配实体；匹配文本使用内缩式轻量高亮，避免覆盖过大。
- 大坐标偏移：解析后自动计算稳定偏移，降低大坐标图纸在 Canvas 中的渲染误差。
- SHX 字体名兼容：不依赖真实 `.shx` 字体文件，解析 STYLE 和 MTEXT 内联字体后映射到系统字体栈渲染。
- CAD 文字对齐：恢复早期稳定的 `TEXT`、`ATTRIB`、`ATTDEF`、`MTEXT` 水平/垂直对齐逻辑；非 MTEXT 文字按 72/73 解析水平和垂直对齐，FIT/ALIGNED 继续使用第二对齐点。

## 安装

```bash
npm install @zhangly1403/dxfviewer
```

React 和 React DOM 为 peer dependencies，宿主项目需要自行安装：

```bash
npm install react react-dom
```

## 引入样式

```ts
import '@zhangly1403/dxfviewer/style.css';
```

## 使用核心查看器

```tsx
import { DxfViewer } from '@zhangly1403/dxfviewer';
import '@zhangly1403/dxfviewer/style.css';

export default function Page() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <DxfViewer initFile="/demo.dxf" fileName="demo.dxf" />
    </div>
  );
}
```

## 使用多 Tab 工作区

```tsx
import { DxfWorkspace } from '@zhangly1403/dxfviewer';
import '@zhangly1403/dxfviewer/style.css';

export default function App() {
  return <DxfWorkspace />;
}
```

## API

### 导出项

| 名称 | 说明 |
| --- | --- |
| `DxfViewer` | 核心 DXF 查看组件，适合嵌入业务系统。 |
| `DxfWorkspace` | 带多 Tab、菜单栏、文件打开能力的完整工作区。 |
| `parseDxf` | DXF 文本解析函数，返回图层、块、实体、布局等结构化数据。 |
| `DxfViewerProps` | `DxfViewer` 属性类型。 |
| `DxfWorkspaceProps` | `DxfWorkspace` 属性类型。 |
| `DxfTabSource` | 多 Tab 初始文件来源类型。 |

为兼容旧版本，原有公开导出仍然保留；新代码建议使用上表中的名称。

### DxfViewerProps

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `initFile` | `string \| File` | - | 初始 DXF 文件，可以是 URL 或 `File`。 |
| `fileName` | `string` | - | 文件名显示。 |
| `showOpenMenu` | `boolean` | `true` | 是否显示打开文件入口。 |
| `tabStrip` | `React.ReactNode` | - | 外部多 Tab 容器传入的标签栏区域。 |
| `onError` | `(err: Error) => void` | - | 加载、解码、解析错误回调。 |
| `onLoad` | `(data: DxfData) => void` | - | 解析完成回调。 |
| `onOpenFiles` | `(files: File[]) => void` | - | 外层接管文件打开时使用。 |
| `onOpenFailed` | `(message: string) => void` | - | 文件打开失败回调。 |
| `defaultLanguage` | `'zh' \| 'en'` | `'zh'` | 默认语言。 |
| `lang` | `'zh' \| 'en'` | - | 受控语言。 |
| `onLanguageChange` | `(lang) => void` | - | 语言变化回调。 |
| `uiTheme` | `'system' \| 'light' \| 'dark'` | `'system'` | 受控 UI 主题。 |
| `onUiThemeChange` | `(theme) => void` | - | UI 主题变化回调。 |
| `drawingColorMode` | `'original' \| 'monochrome'` | `'original'` | 图纸颜色模式。 |
| `onDrawingColorModeChange` | `(mode) => void` | - | 图纸颜色模式变化回调。 |

### DxfWorkspaceProps

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `editor` | `boolean` | `true` | 是否显示文件打开、关闭标签等编辑入口。 |
| `initialFiles` | `DxfTabSource[]` | `[]` | 初始打开的 DXF 文件列表。 |

## 开发

```bash
npm ci
npm run typecheck
npm run build
```

启动示例工程：

```bash
npm run dev
```

构建示例工程：

```bash
npm run build:example
```

构建库和示例工程：

```bash
npm run build:all
```

## 项目结构

```text
src/
  components/
    viewer/                DXF 查看器、图层面板、属性面板、工具栏和移动端控制
    workspace/             多 Tab 工作区与 Tab 状态逻辑
  config/                  常量、主题和文案配置
  core/
    geometry/              几何采样、包围盒、偏移和 OCS 转换
    parser/                DXF 解析状态机、段解析和实体解析
    text/                  CAD 文本布局
  renderer/
    entities/              各类实体的 Canvas 绘制逻辑
    services/              渲染服务和字体服务
  styles/                  统一样式
  types/                   公共类型定义
  utils/                   颜色、线型、字体、文本搜索和实体辅助函数
```

## 构建输出

构建后输出到 `dist/`：

```text
dist/
  dxfviewer.js
  style.css
  index.d.ts
  chunks/
```

`dist/` 为发布产物，源码开发以 `src/` 为准。

## 代码整理原则

- 组件文件按业务边界划分，避免一个小控件一个文件的过度拆分。
- 查看器反馈类组件集中在 `ViewerFeedback.tsx`，状态栏与空间切换集中在 `ViewerStatus.tsx`，Tab 类型与状态逻辑集中在 `DxfTabs.ts`。
- 命名优先表达业务含义，例如 `LayerPanel`、`ViewerToolbar`、`viewerUiSettings`，避免使用临时或泛化命名。
- 注释用于解释 DXF 语义、坐标转换、渲染补偿和交互边界，统一使用中文。

## 说明

- 当前项目只提供 DXF 查看、解析和渲染能力，不承诺 DXF 写出、编辑、捕捉绘制等 CAD 编辑能力。当前空间没有可显示实体时不再弹出提示，避免关闭图层或临时隐藏后干扰操作。
- 组件不引入第三方 UI 库，界面样式由 `src/styles/index.css` 统一维护；移动端只保留右侧工具栏和右侧面板，不再保留旧底部抽屉样式。
- 文本渲染不再加载 SHX 字形文件，缺少字体文件时也不会出现异步重绘错位。Loading 使用轻量居中卡片和细进度条，不遮挡过多界面。消息提示采用紧凑弹窗样式，操作按钮统一放在右下角。
- 文字对齐恢复早期稳定逻辑：非 MTEXT 文字统一按 72/73 组码解析水平和垂直对齐，不再额外叠加 74 优先或 \Q 段落对齐扩展。
- 视图历史在平移或缩放停留约 900ms 后记录，最多保留 50 条；执行上一个/下一个视图时不会重复入栈。
- 隐藏选中和隔离选中属于实体级临时显示状态；关闭图层属于图层级显示状态；全部显示会同时清空这些临时状态。右键选中新实体时，菜单会使用本次右键命中的实体作为操作对象，避免选择状态异步造成操作失效；右键空白处也会显示菜单。
- `dxfviewer-example` 为真实示例工作区，构建和发布脚本保持保留。
- 源码和 README 统一使用 UTF-8 with BOM 编码。
