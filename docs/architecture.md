# 架构说明（Canvas 2D 单引擎）

> 本项目只保留 **Canvas 2D** 一个渲染引擎：交互查看、预览、PNG 导出全部走同一套
> 场景输入与绘制函数，不再包含 WebGL / Three.js 依赖。

## 分层

```
src/
├── ui/                  React 组件层（查看器 / 预览 / 面板 / 工具条）
├── io/                  输入输出层
│   ├── parser/          DXF 解析（ASCII / 二进制、段解析、实体解析）
│   ├── writer/          DXF 写出（重建式 + preserveRaw 保真模式）
│   ├── dxf/             组码表
│   └── loader/          解析 Worker + useDxfLoader + Worker 工厂
├── render/              渲染层
│   ├── engine.ts        InteractiveRenderEngine 接口（场景输入 / 渲染 / 统计）
│   ├── canvas/          Canvas 2D 引擎（批渲染 + Path2D 缓存 + LOD 剔除）
│   ├── picking/         CPU 拾取（扁平 BVH、命中测试、Worker 建索引）
│   ├── text/            字体解析 / 逐字符度量 / SHX 轮廓 / 布局缓存
│   ├── vector/          矢量场景写入器（SVG / PDF 导出后端）
│   └── viewportFitting.ts  取景适配（交互与导出共用同一套数学）
├── core/                领域算法：几何、曲线采样、文字布局、范围计算
├── export/              导出：PNG（Canvas 栅格）、SVG / PDF（矢量）
├── config/              常量与查看器配置（渲染 / 文字 / 交互 / 缩放 / LOD）
├── types/               公共数据模型
└── utils/               颜色、线型、字体、搜索、文字工具
```

## 渲染管线

1. **场景输入**：`EngineSceneOptions`（实体、图层、块、样式、线型、主题、可见性）
   由 `ViewerCanvas` / `DxfPreview` / `rasterExporter` 统一构造。
2. **索引**：实体集合先建扁平 BVH（`render/picking`），用于视口剔除与拾取；
   大图纸在 Worker 中异步建索引。
3. **绘制**：`canvasRenderService` 按「同色同线型」合批，逐实体调用图元绘制函数
   （几何、填充、文字、标注、块递归）。
4. **文字**：`render/vector/entities/textRenderer` 统一处理 TEXT / MTEXT / ATTRIB，
   逐字符换算 em（中英文墨迹等高），MTEXT 按声明列宽折行。
5. **导出**：PNG 走同一 `CanvasRenderEngine` 输出到离屏画布；SVG / PDF 走
   `render/vector/sceneWriter` 的矢量写入器。

## 性能要点

- 解析：逐行零分配扫描 + Worker 解析。
- 交互：视口剔除、亚像素实体 LOD 剔除、文字按字高剔除、Path2D 批缓存。
- 交互期间只做快速重绘，停止交互后一次性精确重绘。

## 文字保真

- 支持 AutoCAD 转义码（`%%c` / `%%d` / `%%p` / `%%u` / `\U+XXXX`）与 TSSD 扩展码。
- MTEXT：自动折行、9 种附着点、行间距倍数、内联宽度因子 `\W…;`、堆叠分数 `\S3/4;`。
- 字体：系统字体优先；样式为 SHX（`*.shx`）时中文按 AutoCAD 比例横向收窄；
  宿主也可注册真实 `.shx` 轮廓字体以获得更精确的字形。
