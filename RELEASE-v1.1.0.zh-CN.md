## 主要更新

### 渲染精度

- **颜色现在与 AutoCAD 完全一致。** 顶点色改为在线性 sRGB 工作空间中写入（three.js 将 `BufferAttribute` 颜色视为线性空间，而 CAD/ACI 颜色为 sRGB），此前所有中间色都会偏亮一档。
- 示例应用启用 sRGB 输出并关闭 ACES 色调映射（ACES 会让鲜艳的 ACI 颜色明显褪色）。
- **法线焊接改用绝对公差**（0.01 mm），相邻面始终能够焊接，大模型不再出现面与面之间的裂缝。
- 合批几何体现在会计算包围盒与包围球，视锥剔除生效，首帧不再卡顿。

### 三维实体解析

- **ACIS SAT 解码对齐 ezdxf 的 XOR-159 规则**，补上了 `0x5E` 填充字符跳过逻辑，否则 `body/lump/shell/...` 关键字匹配会失败。
- **ACIS SAB 布尔值按记录上下文解析**（sense 与 single/double 区分），不再一律把 `TRUE` 当作 `reversed` —— 旧逻辑会反转实体的环向，从而导致着色法线错误。
- ACIS 曲面按角度跨度自适应细分，网格密度更高；bulge 圆弧每 90° 至少一段（下限 6 段），整圆基准 128 段，消除可见棱面。
- 曲线细分预算可配置（`curveSegments`、`minCurveSegments`、`maxCurveSegments`）。

### 精度不再随图纸规模变化

- **曲线细分预算不再随图纸规模缩减。** 此前 15000 实体以上的图纸只使用 75% 的细分，导致大图纸恰好在用户放大的位置出现明显棱面。现在所有图纸统一使用同一预算。
- 嵌套的三维实体与顶层实体使用相同的细分密度。
- **文字图集分辨率恒定**（96 px，新增 `textAtlasPx` 选项）；文字较多的图纸通过增加图集页数承载，而不是降低字形分辨率。
- NURBS 采样随控制点数量自适应（上限 1024 段）；ACIS 曲面网格密度提升（锥面 / 环面 / 球面 / 样条），曲面实体更加平滑。

### 选中高亮

- **选中的三维实体新增加色高亮叠加层**，依据选中的拾取 id 重建，因此实体本身被清晰标记，而不再只有一个包围框。
- 三维视图中，实体表面优先于其自身的线框边，点击实体即选中实体。

### 测试

- 新增 `scripts/test-renderer.mjs`，覆盖色彩空间、ACIS 解码、细分、焊接与高亮行为，并包含「细分密度不得依赖图纸规模」的回归断言。
- 新增 `scripts/bench-real.mjs`，可在命令行解析真实工程图纸。

---

## 升级说明

库现在要求宿主应用以 sRGB 输出渲染：

```js
renderer.outputColorSpace = THREE.SRGBColorSpace; // 或 renderer.outputEncoding = THREE.sRGBEncoding
renderer.toneMapping = THREE.NoToneMapping;         // CAD 颜色请勿使用 ACES
```

如果宿主应用本来就以 sRGB 渲染，只需升级到新版本即可 —— 库自身会写入线性颜色。

完整变更记录请查看 `v1.1.0` 的提交列表。

---

English notes are available in: [RELEASE-v1.1.0.md](./RELEASE-v1.1.0.md)
