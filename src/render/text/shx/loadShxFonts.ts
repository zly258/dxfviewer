/**
 * 从 fonts 目录加载 SHX。
 *
 * 把字体放进站点的 `/fonts/`（示例工程是 `dxfviewer-example/public/fonts/`）。
 * 文件名与 DXF 样式里的字体名一致即可，例如 `hztxt.shx`、`tssdeng.shx`。
 * 没有对应文件时，西文用内置单线字，汉字用系统字体放进同样大小的方格。
 */
import { parseShxFont } from './shxParser';
import { registerParsedShxFont } from './strokeFontRegistry';

/** 常见工程字体。目录里有同名文件就会注册，没有就跳过。 */
export const SHX_FONT_FILES = [
  'hztxt.shx',
  'tssdeng.shx',
  'tssdeng2.shx',
  'tssdchn.shx',
  'gbcbig.shx',
  'hzsmcad.shx',
  'simplex.shx',
  'txt.shx',
  'romans.shx',
  'wcad.shx',
];

export const loadShxFontUrl = async (url: string, fileName: string): Promise<boolean> => {
  try {
    const response = await fetch(url);
    if (!response.ok) return false;
    const font = parseShxFont(await response.arrayBuffer());
    if (font.glyphs.size < 1) return false;
    registerParsedShxFont(fileName, font);
    return true;
  } catch {
    return false;
  }
};

/** 依次尝试 `/fonts/文件名`。返回成功注册的个数。 */
export const loadBundledShxFonts = async (): Promise<number> => {
  let loaded = 0;
  for (const name of SHX_FONT_FILES) {
    const ok = await loadShxFontUrl(`/fonts/${name}`, name)
      || await loadShxFontUrl(`fonts/${name}`, name);
    if (ok) loaded++;
  }
  return loaded;
};
