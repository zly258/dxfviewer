import { CAD_DEFAULT_TEXT_STYLE } from '@/config/cadConstants';
import { DxfStyle } from '@/types';

/** CAD 字体回退栈，优先保证中文工程图可读性。 */
export const FONT_STACKS = {
    CHINESE: '"FangSong", "仿宋", "STFangsong", "SimSun", "宋体", "Microsoft YaHei", "微软雅黑", sans-serif',
    SONG: '"SimSun", "宋体", "STSong", "FangSong", "仿宋", serif',
    HEI: '"Microsoft YaHei", "微软雅黑", "SimHei", "黑体", sans-serif',
    KAI: '"SimKai", "楷体", "STKaiti", serif',
    FANGSONG: '"FangSong", "仿宋", "STFangsong", "SimSun", "宋体", serif',
    SANS_SERIF: '"Inter", "Roboto", "Segoe UI", "Arial", Helvetica, sans-serif',
    SERIF: '"Times New Roman", Times, serif',
    MONOSPACE: '"Cascadia Code", "Consolas", "Courier New", monospace',
};

export type CadTextFontProfile = 'trueType' | 'shx' | 'engineeringShx' | 'cjk';

const normalizeFontToken = (value?: string): string => (value || '').toLowerCase();

export const resolveCadTextFontProfile = (
    styleName: string | undefined,
    styles: Record<string, DxfStyle> | undefined,
    rawText?: string,
): CadTextFontProfile => {
    const effectiveStyleName = styleName || CAD_DEFAULT_TEXT_STYLE;
    const style = styles?.[effectiveStyleName] || styles?.[effectiveStyleName.toUpperCase()];
    const fontName = normalizeFontToken(style?.fontFileName);
    const bigFontName = normalizeFontToken(style?.bigFontFileName);
    const styleNameLower = normalizeFontToken(style?.name || effectiveStyleName);
    const inlineFont = normalizeFontToken(rawText?.match(/\\[fF]([^;|]+)/)?.[1]);
    const combined = `${fontName}|${bigFontName}|${styleNameLower}|${inlineFont}`;
    const hasCjkContent = /[\u2e80-\u9fff\uf900-\ufaff]/.test(rawText || '');

    const hasShxFont = combined.includes('.shx') || combined.includes('tssd') || combined.includes('hztxt') || combined.includes('wcad') || combined.includes('simplex') || combined.includes('romans') || combined.includes('txt') || combined.includes('hz');
    const hasSystemFont = combined.includes('.ttf') || combined.includes('.otf') || combined.includes('arial') || combined.includes('simsun') || combined.includes('simhei') || combined.includes('yahei') || combined.includes('微软雅黑');

    // 样式中带形文件或大字体时，优先按形文件处理；不能因为文本里有中文就提前归类为系统中文字体。
    if (hasShxFont) {
        return (combined.includes('hztxt') || combined.includes('tssd') || combined.includes('wcad') || combined.includes('gbcbig') || combined.includes('hz'))
            ? 'engineeringShx'
            : 'shx';
    }

    if (hasSystemFont || combined.includes('fang') || combined.includes('仿宋')) {
        return hasCjkContent ? 'cjk' : 'trueType';
    }

    return hasCjkContent ? 'cjk' : 'trueType';
};

/** 将 CAD 字体文件名映射为浏览器可用字体。 */
export const mapCadFontToWebFont = (fontFileName: string | undefined, bigFontFileName?: string | undefined): string => {
    const f = (fontFileName || "").toLowerCase();
    const bf = (bigFontFileName || "").toLowerCase();
    
    let result = FONT_STACKS.CHINESE;

    // 优先根据字体文件名识别常见工程字体。
    const combined = (f + "|" + bf).toLowerCase();
    
    if (combined.includes('hztxt') || combined.includes('hz') || combined.includes('gb') || combined.includes('ext')) {
        result = FONT_STACKS.CHINESE;
    } else if (combined.includes('shx') || combined.includes('tssd') || combined.includes('wcad') || combined.includes('fs') || combined.includes('fang')) {
        result = FONT_STACKS.FANGSONG;
    } else if (combined.includes('txt') || combined.includes('simplex') || combined.includes('romans') || combined.includes('tssdeng') || combined.includes('wcadeng')) {
        result = FONT_STACKS.SANS_SERIF;
    } else if (combined.includes('simhei') || combined.includes('hei')) {
        result = FONT_STACKS.HEI;
    } else if (combined.includes('simkai') || combined.includes('kai')) {
        result = FONT_STACKS.KAI;
    } else if (combined.includes('msyh') || combined.includes('yahei')) {
        result = FONT_STACKS.HEI;
    } else if (combined.includes('arial')) {
        result = 'Arial, Helvetica, sans-serif';
    } else if (combined.includes('times') || combined.includes('roman')) {
        if (combined.includes('romans')) result = FONT_STACKS.SANS_SERIF;
        else result = FONT_STACKS.SERIF;
    } else if (combined.includes('txt') || combined.includes('mono') || combined.includes('iso') || combined.includes('simplex')) {
        result = FONT_STACKS.SANS_SERIF;
    } else {
        // 无明确字体时，根据文件名特征判断是否需要中文字体。
        const isChinese = (str: string) => {
            return str.includes('big') || 
                   str.includes('chines') ||
                   str.includes('shx_chs') ||
                   str.includes('st64') || 
                   str.includes('china');
        };

        if (isChinese(f) || isChinese(bf)) {
            result = FONT_STACKS.CHINESE;
        } else {
            // 保留真字体文件名，便于命中系统已安装字体。
            const extractName = (path: string) => {
                const lastSlash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
                let name = path.substring(lastSlash + 1).replace(/\.(ttf|otf|shx)$/i, '');
                if (name) {
                    name = name.split('.')[0].split('-')[0];
                    return name.split(/[\s-_]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                }
                return null;
            };

            const extractedName = extractName(f);
            if (extractedName && extractedName.length > 1) {
                result = `"${extractedName}", ${FONT_STACKS.SANS_SERIF}`;
            } else {
                result = FONT_STACKS.SANS_SERIF;
            }
        }
    }

    return result;
};

/** 根据 DXF 样式表解析文字绘制字体。 */
export const getStyleFontFamily = (styleName: string | undefined, styles: Record<string, DxfStyle> | undefined): string => {
    const fallback = FONT_STACKS.CHINESE;
    
    let effectiveStyleName = styleName || CAD_DEFAULT_TEXT_STYLE;
    if (!styles || (!styles[effectiveStyleName] && !styles[effectiveStyleName.toUpperCase()])) {
        effectiveStyleName = CAD_DEFAULT_TEXT_STYLE;
    }
    
    if (!styles || !styles[effectiveStyleName]) {
        // STYLE 表不完整时，使用第一个可用样式兜底。
        const firstStyle = styles ? Object.values(styles)[0] : null;
        if (firstStyle) {
             return getStyleFontFamily(firstStyle.name, styles);
        }
        return fallback;
    }
    
    const style = styles[effectiveStyleName] || styles[effectiveStyleName.toUpperCase()];
    let result = fallback;
    
    // 字体文件名优先级高于样式名。
    if (style.fontFileName || style.bigFontFileName) {
        result = mapCadFontToWebFont(style.fontFileName, style.bigFontFileName);
        
        // 通用字体结果允许再用样式名细化中文字体。
        const isGeneric = result === FONT_STACKS.SANS_SERIF || result === FONT_STACKS.CHINESE || result === FONT_STACKS.SONG;
        
        if (isGeneric) {
            const sn = style.name.toLowerCase();
            if (sn.includes('仿宋') || sn.includes('fangsong') || sn === 'fs') {
                result = FONT_STACKS.FANGSONG;
            } else if (sn.includes('黑体') || sn.includes('simhei') || sn.includes('hei')) {
                result = FONT_STACKS.HEI;
            } else if (sn.includes('楷体') || sn.includes('simkai') || sn.includes('kai')) {
                result = FONT_STACKS.KAI;
            } else if (sn.includes('宋体') || sn.includes('simsun') || sn.includes('song')) {
                result = FONT_STACKS.SONG;
            }
        }
    } else if (style.name) {
        // 无字体文件名时，用样式名推断。
        const sn = style.name.toLowerCase();
        if (sn.includes('仿宋') || sn.includes('fangsong') || sn === 'fs') {
            result = FONT_STACKS.FANGSONG;
        } else if (sn.includes('宋体') || sn.includes('simsun') || sn.includes('song')) {
            result = FONT_STACKS.SONG;
        } else if (sn.includes('黑体') || sn.includes('simhei') || sn.includes('hei')) {
            result = FONT_STACKS.HEI;
        } else if (sn.includes('楷体') || sn.includes('simkai') || sn.includes('kai')) {
            result = FONT_STACKS.KAI;
        } else if (sn.includes('微软雅黑') || sn.includes('yahei')) {
            result = FONT_STACKS.HEI;
        } else if (sn.includes('arial')) {
            result = 'Arial, Helvetica, sans-serif';
        } else if (/[\u4e00-\u9fa5]/.test(style.name)) {
            result = FONT_STACKS.CHINESE;
        } else if (style.name !== CAD_DEFAULT_TEXT_STYLE && style.name !== 'Annotative') {
            result = `"${style.name}", ${fallback}`;
        }
    }

    return result;
};
