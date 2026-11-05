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
│   ├── text/              #   SHX 形字体 / 字形图集 / 字体服务
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
  预期差异：SHX 文字（WebGL=描边字形 / Canvas=系统字体近似）、
  HATCH 图案（WebGL=解析着色 / Canvas=45° 平铺近似）、
  大图交互（WebGL=GPU 批处理 / Canvas=Path2D 批缓存 + LOD 剔除）。
> 交互渲染 100% WebGL2；SVG / PDF 矢量导出走 `render/vector` 场景写入器；
> PNG 栅格导出复用 WebGL 引擎（离屏渲染 + readPixels）。

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
  5. 选中叠加：覆盖色重绘选中实体的索引段
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

## 2. 文字渲染（SDF：文字转图形，GPU 原生）

**主方案**：字形 → 有向距离场（SDF）→ GPU 四边形。这与
tiny-sdf / troika-three-text / msdfgen 等开源库同源——把「字形轮廓」
编码成到最近边缘的距离，着色器用屏幕空间导数自适应还原边缘，
因此放大到任意倍数都保持锐利，不再依赖超大位图尺寸。

链路（ender/text/）：

1. glyphAtlas 以 RASTER_PX = 128 光栅化字形（浏览器系统字体，
   中文/CJK 天然支持，**无需打包任何字体文件**）；
2. **逐字形单元**计算距离场（sdf.ts，3×3 chamfer 双遍扫描）：
   必须按单个字形算，整页一次算会让相邻字形墨迹侵入留白区，
   导致边缘污染（实测「翼缘」显示成「翼且」）；
3. 距离场写入 R8 页 → 上传为 TEXTURE_2D_ARRAY（页号 = layer，
   顶点属性 _page），避免多页时采样到页 0 的同 UV 位置；
4. 片元着色器：smoothstep(0.5 - w, 0.5 + w, d)，w = fwidth(d) * 0.75
   —— 任意缩放下边缘恒为约 1px 抗锯齿；
5. 字形缩放按 GlyphAtlas.getCapRatio() 实测的大写高度比换算
   （CAD 字高 = 大写字高，系统字体 em ≈ 1.39×；中文按墨迹高 ≈ 0.88em）。

文字 LOD：逐绘制指令按自身字高判定（ChunkDrawOp.textHeight），
屏幕高度 < 3px 跳过——避免「一行极小字把整块文字拖成不显示」。

**备选方案**：TEXT_RENDER_MODE = 'overlay' 时，GL 场景跳过文字
（skipText），改由透明 Canvas 覆盖层用浏览器原生文本引擎绘制
（CanvasRenderEngine({ textOnly: true })，与 Canvas 引擎逐像素同源）。
两种模式的文字度量规则完全一致；导出（PNG/PDF/SVG）跟随当前模式。

| 项 | 规则 |
|---|---|
| 字高换算 | 纯西文 em 系数 **1.39**；含中文 **1.14** |
| 中文宽度补偿 | cjkRenderWidthFactor = 0.88（全角步进回到 1.0×字高） |
| MTEXT 行距 | 1.66 × 字高（cap height），非 em 视觉高度 |
| SDF 半宽 | GLYPH_SDF_SPREAD = 6（同时作为字形留白，防采样串页） |
## 3. 填充渲染

- **实心**（HATCH solid / SOLID / 3DFACE / WIPEOUT）：耳切三角化，
  内孔用「最右顶点射线桥接」合并后统一耳切；
- **图案**（ANSI31 等）：包围盒两三角形 + 片元解析着色
  （单向线/双向线/点阵三族），间距随缩放变化由 uniform 驱动；
  屏幕间距过密时按比例退化为半透明底色。

## 4. 纸张空间视口

VIEWPORT 实体烘焙时把模型空间实体按
`paper = viewportCenter + (model − viewCenter) × (height / viewHeight)`
投影进纸张分块网格，投影几何记录视口世界矩形（`clipRectId`）；
绘制期经 scissor 剪裁，保证内容不溢出视口边框。

## 5. 块引用与属性（ATTRIB）语义

- **块展开**：INSERT/DIMENSION/ACAD_TABLE 按块定义展开；块内子实体经
  `xformEntity` 应用块变换后重走烘焙路径（深度上限 12）；
- **DIMENSION 局部坐标**：`isDimensionBlockLocal` 判定块内容是否为局部坐标——
  局部 → `world = definitionPoint + (p − basePoint)`，否则恒等映射
  （与 AutoCAD/旧渲染器一致）；
- **ATTRIB（块属性文字）**：DXF 中 ATTRIB 携带**绝对**坐标/字高/旋转，
  以恒等变换渲染，**不做块缩放**（旧实现双重缩放导致文字放大 20~30 倍的
  "乱码圆圈"缺陷即源于此）；占位值（value === tag）与空值跳过；
- **ATTDEF**：属性模板定义，不是可见几何，块展开时跳过。

## 6. 选中高亮

构建期为每个实体记录其线段索引范围（`chunk.entityRanges`）。
选中集变化时把这些索引拷贝进一个覆盖索引缓冲，以覆盖色
（`u_overrideColor`）重绘——不触碰静态几何，重建成本与选中数成正比。

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






