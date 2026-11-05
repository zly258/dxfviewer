# 渲染架构（双引擎）

> v2.1：项目按 **ui / io / render** 三层组织；交互渲染提供 **WebGL 与 Canvas 2D
> 两个可切换引擎**（同一 `InteractiveRenderEngine` 接口，运行时切换对比）；
> 矢量导出（SVG/PDF）走 `render/vector` 场景写入器；PNG 栅格导出复用 WebGL。

## 0. 目录结构

```
src/
├── ui/                    # 界面层（React）
│   ├── components/        #   查看器/面板/工具栏
│   ├── hooks/             #   视图状态（视口历史/图层可见性/响应式）
│   ├── i18n.ts            #   多语言
│   └── styles/            #   设计令牌与组件样式（WPF 风格）
├── io/                    # 输入输出层
│   ├── parser/            #   DXF 解析（ASCII/二进制）
│   ├── writer/            #   DXF 写出
│   ├── dxf/               #   组码表
│   └── loader/            #   解析 Worker + useDxfLoader + worker 工厂
├── render/                # 渲染层（引擎无关接口 + 双实现 + 共享设施）
│   ├── engine.ts          #   InteractiveRenderEngine 接口（切换契约）
│   ├── webgl/             #   WebGL2 引擎（分块 GPU 场景）
│   ├── canvas/            #   Canvas 2D 引擎（Path2D 批缓存 + LOD）
│   ├── scene/             #   实体 → 分块 GPU 网格（WebGL 专用）
│   ├── picking/           #   CPU 拾取（BVH/命中测试，引擎无关）
│   ├── text/              #   轮廓字体三角化 / 多字体回退 / 字符图集 / 字体服务
│   ├── vector/            #   矢量场景写入器（SVG/PDF 导出后端）
│   └── viewportFitting.ts #   适配取景（交互与导出共用）
├── core/                  # 领域算法（几何/曲线采样/文字布局/范围计算）
├── export/                # 导出（取景 + PNG/WebGL 栅格 + SVG/PDF 矢量）
├── config/ types/ utils/  # 配置 / 数据模型 / 工具
└── index.ts parser.ts writer.ts render.ts export.ts   # 公共子入口
```

## 0.1 引擎切换

- 契约：`render/engine.ts` 的 `InteractiveRenderEngine`
  （`setScene / render / setTheme / dispose / stats` + `kind`）；
- 实现：`webgl/renderEngine.RenderEngine`（kind='webgl'）、
  `canvas/CanvasRenderEngine.CanvasRenderEngine`（kind='canvas'）；
- 切换入口：查看器「视图」菜单 → 渲染引擎（设置持久化于 localStorage）；
  切换时重建引擎实例并重放当前场景（视口/选中状态天然保持）；
  canvas 元素带 `key={engineKind}` 强制重建（同一 canvas 元素不能同时持有
  WebGL 与 2D 上下文）；
- 两引擎语义对齐：同一场景输入、同一拾取（CPU BVH）、同一图层/可见性模型；
  - 纯几何文字三角化：WebGL 采用 opentype.js + earcut 轮廓几何渲染，放大无模糊；
  - 特殊符号转义：统一支持 AutoCAD 及 TSSD 扩展编码（%%144说明、%%130-138钢筋级别、%%140-141上标、%%142-143下标、%%146-147圈号、%%c/d/p等）；
  - 复杂排版体系：支持 MTEXT 自动列宽折行、全部 9 种附着点原生基准偏移、首行基线沉降、组码 44 行间距倍数、Fit（hAlign=5）两点精确自适应拉伸与 Aligned（hAlign=3）等比缩放；
  - 大图交互：WebGL=分块 GPU 批处理 / Canvas=Path2D 批缓存 + LOD 剔除。

## 1. 帧渲染管线

```
setScene()                    ← 低频：实体/图层/样式/可见性/主题变化
  buildScene()                ← 实体烘焙为分块网格（唯一 CPU 重活）
  uploadChunkToGpu()          ← 分块 VBO/IBO/VAO 上传

render(viewPort)              ← 每帧：平移缩放零几何重建
  1. 清屏（主题色 / 导出白底 / 透明底）
  2. 网格背景（可选，全屏三角形 + 解析着色）
  3. 视口剔除：分块包围盒 ∩ 视口（其余分块整块跳过）
  4. 按 chunk.drawOps 构建顺序绘制（程序切换 + 可选 scissor）：
     fill（实心/图案）→ line（按虚线分组）→ glyph（图集）→ point
  5. 选中叠加：覆盖色重绘选中实体的索引段与填充多边形（#00A8FF）
```

### 性能关键点

| 机制 | 说明 |
|---|---|
| 分块网格 | 实体按包围盒烘焙进 ≤32×32 空间分块；每帧只画可见分块 |
| 批量绘制 | 分块内同样式几何合并为一个 drawOp；5000 实体图纸每帧 ~30 draw calls |
| 零重建交互 | 平移/缩放只更新 uniform 矩阵，rAF 脏标记出帧，交互全程 60fps |
| 分块局部坐标 | 顶点 = 世界坐标 − 分块原点，32 位浮点下大坐标图纸无精度损失 |
| 顶点展开线宽 | 线条在顶点着色器做屏幕空间展开（miter 法线），线宽=屏幕像素语义 |
| 解析图案填充 | 剖面线在片元着色器按世界坐标解析生成，任意缩放无摩尔纹 |

### 虚线（线型）模型

- 线型节距在**模型空间**（与 DXF 线型定义一致），顶点携带累计弧长；
- 片元着色器按 `arcLen × pxPerModel` 取模判开/关；
- 屏幕节距 < 2.5px 时自动退化为实线（与 CAD 远景表现一致，避免摩尔纹）；
- 构建期按 `dashIdx` 记录索引段（`chunk.lineDashRanges`），绘制按组设置 uniform。

## 2. 文字渲染（几何三角化：opentype.js + earcut，GPU 原生）

**设计**：字形轮廓（TrueType / OpenType）通过 `opentype.js` 提取其贝塞尔曲线，
经过自适应细分为光滑多边形环，经过包含树分类（分离外环与内孔）后由 `earcut`
三角化为纯几何多边形网格（`fill` 缓冲）。

**技术优势**：
1. **纯几何多边形渲染**：没有任何位图、图集尺寸或距离场精度的上限，任意放大边缘均为数学精确的硬表面边缘；
2. **多字体回退机制（Fallback）**：主字体默认使用工程标准仿宋体（`simfang.ttf`），当遇到主字体未收录的特种符号（如 `Ø`, `²`, `³`, `ₐ`, `ₑ`）时，自动回退到后备字体（`arial.ttf`）提取字形并等比缩放步进，100% 杜绝缺字或非法控制字符占位；
3. **字形几何缓存**：所有字形在初次遇到时三角化一次并缓存（`glyphCache`），重复文字实例仅需进行仿射矩阵变换，十万级文字构建速度平稳；
4. **完整 AutoCAD / TSSD 排版规则**：
   - 提取并应用内联宽度因子 `\W...;` 与样式 `widthFactor`；
   - 严格应用 MTEXT 组码 44 的 `lineSpacingFactor`（如 0.9 倍紧凑行距）与单倍基准（1.66 倍）；
   - 支持全部 9 种 `attachmentPoint` 原生基准与首行基线沉降，消除文本越界溢出边框；
   - 完整解码 TSSD 特殊转义（`%%144` 标题控制符清洗、`%%130-138` 钢筋等级符号、`%%140-141` 上标、`%%142-143` 下标、`%%146-147` 圈号等）；
   - 支持单行文字 Fit（`hAlign=5`）两点精确自适应拉伸与 Aligned（`hAlign=3`）等比缩放；
   - 支持单行文字垂直对齐（基线、底对齐、居中、顶对齐）。

文字 LOD：逐绘制指令按自身字高判定（`ChunkDrawOp.textHeight`），屏幕高度 < 3px 跳过——避免「一行极小字把整块文字拖成不显示」。

## 3. 填充渲染

- **实心（HATCH solid / SOLID / 3DFACE / WIPEOUT）**：
  - 接入 `sampleHatchLoop` 全面支持包含 LINE、ARC、ELLIPSE、SPLINE（及 `calculatedPoints`）的复杂曲线边界；
  - 引入**轮廓包含树（Contour Inclusion Tree）**自动识别独立外环（Multi-Island）与嵌套孔洞（`classifyHatchIslands`），支持包含多个独立子图元或字符的复合填充（如 `WISDRI` 标志图形与文字）；
  - 耳切三角化，内孔桥接或 earcut 统一处理；
- **图案（ANSI31 等）**：包围盒两三角形 + 片元解析着色
  （单向线/双向线/点阵三族），间距随缩放变化由 uniform 驱动；
  屏幕间距过密时按比例退化为半透明底色。

## 4. 纸张空间视口

VIEWPORT 实体烘焙时把模型空间实体按
`paper = viewportCenter + (model − viewCenter) × (height / viewHeight)`
投影进纸张分块网格，投影几何记录视口世界矩形（`clipRectId`）；
绘制期经 scissor 剪裁，保证内容不溢出视口边框。

## 5. 块引用与属性（ATTRIB）语义

- **块展开**：INSERT/DIMENSION/ACAD_TABLE 按块定义展开；块内子实体经
  `xformEntity` 应用块变换后重走烘焙路径（深度上限 12），包括嵌套 `INSERT`（如标题栏内部的 Logo 标志）；
- **尺寸与宽度缩放**：在块展开阶段，不仅对实体的坐标和 `height` 乘以块缩放比，对 MTEXT `width`、`boxHeight`、`actualWidth` 和 `secondPosition` 同步进行等比缩放，彻底杜绝单字成柱的纵向折行缺陷；
- **DIMENSION 局部坐标**：`isDimensionBlockLocal` 判定块内容是否为局部坐标——
  局部 → `world = definitionPoint + (p − basePoint)`，否则恒等映射
  （与 AutoCAD/旧渲染器一致）；
- **ATTRIB（块属性文字）**：在解析阶段经 `normalizeInsertAttributes` 统一对齐到世界坐标系，渲染、范围与搜索三处口径一致；
- **ATTDEF**：属性模板定义，不是可见几何，块展开时跳过。

## 6. 全图元点击高亮

构建期维护调用栈（`entityIdStack`），为顶层实体及其嵌套块内容全量记录其几何范围（`chunk.entityRanges`）：
- 线段（`line`）：索引缓冲记录与重新绘制；
- 填充（`fill`，包括尺寸标注箭头、实心多边形、纯几何轮廓文字三角形）：顶点数组记录，着色器使用 `u_overrideColor` 覆盖高亮色；
- 图集字形（`glyph`）与点（`point`）：同步支持覆盖色高亮。
选中集变化时，同时渲染高亮线段与高亮填充多边形，点击文字、尺寸标注或复合图块时瞬间以 `#00A8FF` 亮蓝色整体点亮。

## 7. 导出

- **PNG**：`export/rasterExporter.ts`——离屏 canvas 建 WebGL2 上下文，
  RenderEngine 渲染（白底/透明底/显式视口）→ readPixels → 2D 画布 → Blob。
  线宽按输出尺寸自动补偿（`lineWidthScale`）；需要 WebGL2 支持；
- **SVG**：`svgExporter` → `renderVectorScene` + `SvgVectorContext`（纯矢量，Node 可用）；
- **PDF（矢量）**：`pdf/vectorExporter` → `renderVectorScene` + `PdfVectorContext`，
  几何全部矢量，文字经 2D 光栅化为透明图层叠加（浏览器字体轮廓不可得的
  零依赖方案）；
- 三种格式共用 `export/sceneView.ts` 的取景与留白，输出一致。

## 8. 约定

- 新增实体类型：在 `sceneBuilder.bakeEntity` 加 case，几何写入统一走
  `writePolyline / writeSolidPolygon / writeGlyphQuads / writePoints`；
- 新增着色器：`shaders.ts` 定义源码与属性通道布局（`*_ATTRS`），
  `glDevice.createProgram` 编译，`renderEngine` 挂 program；
- 着色器禁止使用 GLSL ES 3.00 之外的内置函数（无 `log10`，用 `log2` 换算）；
- GL 状态约定：VAO 绑定全局唯一（`RenderEngine.boundVao` 跟踪），
  ELEMENT_ARRAY_BUFFER 属于 VAO 状态——替换后必须还原。
