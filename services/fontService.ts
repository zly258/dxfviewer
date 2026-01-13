import { DxfStyle } from '../types';

/**
 * Optimized font stacks for CAD display
 */
export const FONT_STACKS = {
    CHINESE: '"Microsoft YaHei", "微软雅黑", SimSun, "宋体", STSong, SimKai, SimHei, FangSong, sans-serif',
    SONG: 'SimSun, "宋体", STSong, serif',
    HEI: 'SimHei, "黑体", "Microsoft YaHei", "微软雅黑", sans-serif',
    KAI: 'SimKai, "楷体", STKaiti, serif',
    FANGSONG: 'FangSong, "仿宋", STFangsong, serif',
    SANS_SERIF: '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    SERIF: '"Times New Roman", Times, serif',
    MONOSPACE: '"Cascadia Code", "Consolas", "Courier New", monospace',
};

/**
 * Maps CAD font file names to Web-compatible font families.
 * Handles SHX, TTF, and OTF files.
 */
export const mapCadFontToWebFont = (fontFileName: string | undefined, bigFontFileName?: string | undefined): string => {
    const f = (fontFileName || "").toLowerCase();
    const bf = (bigFontFileName || "").toLowerCase();
    
    let result = FONT_STACKS.CHINESE; // Default for many CAD drawings

    // 1. Direct checks for common Chinese fonts
    const combined = (f + "|" + bf).toLowerCase();
    
    if (combined.includes('tssd') || combined.includes('wcad') || combined.includes('fs') || combined.includes('fang')) {
        // TSSD and WCAD fonts often use FangSong or are used in contexts where FangSong is expected
        result = FONT_STACKS.FANGSONG;
    } else if (combined.includes('hztxt') || combined.includes('hz') || combined.includes('gb') || combined.includes('ext')) {
        result = FONT_STACKS.SONG;
    } else if (combined.includes('txt') || combined.includes('simplex') || combined.includes('romans') || combined.includes('tssdeng') || combined.includes('wcadeng')) {
        result = FONT_STACKS.SANS_SERIF;
    } else if (combined.includes('simsun') || combined.includes('song')) {
        result = FONT_STACKS.SONG;
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
        // Check if either font file suggests Chinese/CJK support in a more general way
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
            // Extract name from path if possible
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
 * Resolves the font family for a given style, considering both font and big font.
 */
export const getStyleFontFamily = (styleName: string | undefined, styles: Record<string, DxfStyle> | undefined): string => {
    const fallback = FONT_STACKS.CHINESE; // Default to Chinese-capable stack for safety
    
    let effectiveStyleName = styleName || 'STANDARD';
    if (!styles || (!styles[effectiveStyleName] && !styles[effectiveStyleName.toUpperCase()])) {
        effectiveStyleName = 'STANDARD';
    }
    
    if (!styles || !styles[effectiveStyleName]) {
        // If even STANDARD is missing, try to find ANY style that might be a default
        const firstStyle = styles ? Object.values(styles)[0] : null;
        if (firstStyle) {
             return getStyleFontFamily(firstStyle.name, styles);
        }
        return fallback;
    }
    
    const style = styles[effectiveStyleName] || styles[effectiveStyleName.toUpperCase()];
    let result = fallback;
    
    // 1. Try mapping font file names first (most accurate)
    if (style.fontFileName || style.bigFontFileName) {
        result = mapCadFontToWebFont(style.fontFileName, style.bigFontFileName);
        
        // If the result is a generic font but the style name suggests a specific Chinese font, 
        // give the style name preference
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
        // 2. Try style name itself if no font files are specified
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
