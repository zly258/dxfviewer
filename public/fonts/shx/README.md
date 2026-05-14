# SHX 字体目录

将 AutoCAD SHX 字体文件放到本目录，例如：

- simplex.shx
- txt.shx
- romans.shx
- hztxt.shx

程序会根据 DXF 文字样式中的 `fontFileName`、`bigFontFileName` 自动尝试加载同名 SHX 文件。

不需要额外维护字体清单。字体不存在或解析失败时，会自动回退到系统字体，不影响图纸打开。
