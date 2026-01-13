import { DxfStyle } from '../types';

/**
 * Optimized font stacks for CAD display
 */
export const FONT_STACKS = {
    SONG: '"SimSun", "宋体", "STSong", serif',
    HEI: '"SimHei", "黑体", "STHeiti", sans-serif',
    KAI: '"SimKai", "楷体", "STKaiti", serif',
    FANGSONG: '"FangSong", "仿宋", "STFangsong", serif',
    YAHEI: '"Microsoft YaHei", "微软雅黑", sans-serif',
    CHINESE: '"Microsoft YaHei", "微软雅黑", "SimSun", "宋体", "STSong", "SimKai", "SimHei", "FangSong", "Arial", sans-serif',
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
    if (f.includes('simsun') || f.includes('song') || bf.includes('hztxt') || bf.includes('gb')) {
        result = FONT_STACKS.SONG;
    } else if (f.includes('simhei') || f.includes('hei')) {
        result = FONT_STACKS.HEI;
    } else if (f.includes('simkai') || f.includes('kai')) {
        result = FONT_STACKS.KAI;
    } else if (f.includes('fangsong') || f.includes('fang')) {
        result = FONT_STACKS.FANGSONG;
    } else if (f.includes('msyh') || f.includes('yahei')) {
        result = FONT_STACKS.YAHEI;
    } else if (f.includes('arial')) {
        result = 'Arial, Helvetica, sans-serif';
    } else if (f.includes('times') || f.includes('roman')) {
        if (f.includes('romans')) result = FONT_STACKS.SANS_SERIF;
        else result = FONT_STACKS.SERIF;
    } else if (f.includes('txt') || f.includes('mono') || f.includes('iso') || f.includes('simplex')) {
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
    
    if (!styleName || !styles || !styles[styleName]) {
        console.log(`[FontService] getStyleFontFamily: styleName="${styleName}" not found, using fallback`);
        return fallback;
    }
    
    const style = styles[styleName];
    let result = fallback;
    
    // 1. Try mapping font file names
    if (style.fontFileName || style.bigFontFileName) {
        result = mapCadFontToWebFont(style.fontFileName, style.bigFontFileName);
    } else if (style.name && style.name !== 'STANDARD' && style.name !== 'Annotative') {
        // 2. Try style name itself if it looks like a font name
        // If style name contains "宋体" or similar, use Chinese stack
        if (/[\u4e00-\u9fa5]/.test(style.name)) {
            result = FONT_STACKS.CHINESE;
        } else {
            result = `"${style.name}", ${fallback}`;
        }
    }

    console.log(`[FontService] getStyleFontFamily: styleName="${styleName}", fontFile="${style.fontFileName}", bigFontFile="${style.bigFontFileName}", result="${result}"`);
    return result;
};
