import { DxfStyle } from '../types';

/**
 * 针对 CAD 显示优化的字体栈
 */
export const FONT_STACKS = {
    CHINESE: '"FangSong", "仿宋", "STFangsong", "SimSun", "宋体", "Microsoft YaHei", "微软雅黑", sans-serif',
    SONG: '"FangSong", "仿宋", "STFangsong", "SimSun", "宋体", serif',
    HEI: '"SimHei", "黑体", "Microsoft YaHei", "微软雅黑", sans-serif',
    KAI: '"SimKai", "楷体", "STKaiti", serif',
    FANGSONG: '"FangSong", "仿宋", "STFangsong", "SimSun", "宋体", serif',
    SANS_SERIF: 'Arial, Helvetica, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
    SERIF: '"Times New Roman", Times, serif',
    MONOSPACE: '"Cascadia Code", "Consolas", "Courier New", monospace',
};

/**
 * 将 CAD 字体文件名映射到 Web 兼容的字体系列。
 * 处理 SHX、TTF 和 OTF 文件。
 */
export const mapCadFontToWebFont = (fontFileName: string | undefined, bigFontFileName?: string | undefined): string => {
    const f = (fontFileName || "").toLowerCase();
    const bf = (bigFontFileName || "").toLowerCase();
    
    let result = FONT_STACKS.CHINESE; // 许多 CAD 图纸的默认值

    // 1. 直接检查常见的中文字体
    const combined = (f + "|" + bf).toLowerCase();
    
    if (combined.includes('tssd') || combined.includes('wcad') || combined.includes('fs') || combined.includes('fang') || combined.includes('simsun') || combined.includes('song')) {
        // TSSD、WCAD 和 Simsun/Song 都映射到仿宋以获得更好的质量
        result = FONT_STACKS.FANGSONG;
    } else if (combined.includes('hztxt') || combined.includes('hz') || combined.includes('gb') || combined.includes('ext')) {
        result = FONT_STACKS.FANGSONG; // 即使对于常见的中文 SHX 回退也首选仿宋
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
        // 检查任一字体文件是否以更通用的方式建议中文/CJK 支持
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
            // 如果可能，从路径中提取名称
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

    console.log(`[FontService] mapCadFontToWebFont: f="${fontFileName}", bf="${bigFontFileName}" -> result="${result}"`);
    return result;
};

/**
 * 解析给定样式的字体系列，同时考虑字体和字体。
 */
export const getStyleFontFamily = (styleName: string | undefined, styles: Record<string, DxfStyle> | undefined): string => {
    const fallback = FONT_STACKS.CHINESE; // 为了安全起见，默认使用支持中文的字体栈
    
    let effectiveStyleName = styleName || 'STANDARD';
    if (!styles || (!styles[effectiveStyleName] && !styles[effectiveStyleName.toUpperCase()])) {
        effectiveStyleName = 'STANDARD';
    }
    
    if (!styles || !styles[effectiveStyleName]) {
        // 如果甚至缺少 STANDARD，尝试寻找任何可能是默认样式的样式
        const firstStyle = styles ? Object.values(styles)[0] : null;
        if (firstStyle) {
             return getStyleFontFamily(firstStyle.name, styles);
        }
        return fallback;
    }
    
    const style = styles[effectiveStyleName] || styles[effectiveStyleName.toUpperCase()];
    let result = fallback;
    
    // 1. 首先尝试映射字体文件名（最准确）
    if (style.fontFileName || style.bigFontFileName) {
        result = mapCadFontToWebFont(style.fontFileName, style.bigFontFileName);
        
        // 如果结果是通用字体，但样式名称建议使用特定的中文字体，
        // 则优先使用样式名称
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
        // 2. 如果未指定字体文件，则尝试样式名称本身
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
        } else if (style.name !== 'STANDARD' && style.name !== 'Annotative') {
            result = `"${style.name}", ${fallback}`;
        }
    }

    console.log(`[FontService] getStyleFontFamily: styleName="${styleName}", fontFile="${style.fontFileName}", bigFontFile="${style.bigFontFileName}", result="${result}"`);
    return result;
};
