import { AnyEntity, DxfText, DxfStyle, EntityType } from '@/types';
import { CAD_DEFAULT_TEXT_STYLE, CAD_DEFAULT_TEXT_HEIGHT } from '@/config/cadConstants';
import { TEXT_RENDER_CONFIG } from '@/config/viewerConfig';
import { getStyleFontFamily, FONT_STACKS, mapCadFontToWebFont } from '@/render/text/fontService';

/**
 * 获取用于画布绘制的字体样式字符串。
 */
export const getCanvasFont = (ent: AnyEntity, styles: Record<string, DxfStyle> | undefined): string => {
    const textEnt = (ent.type === EntityType.TEXT || ent.type === EntityType.MTEXT || ent.type === EntityType.ATTRIB || ent.type === EntityType.ATTDEF) ? (ent as DxfText) : null;
    
    // 高度优先级：1. 多行文字内联覆盖，2. 实体高度，3. 样式高度，4. 默认值 2.5。
    const styleName = textEnt?.styleName || CAD_DEFAULT_TEXT_STYLE;
    const style = styles?.[styleName] || styles?.[styleName.toUpperCase()];
    
    // 初始高度：实体高度，如果为0则使用样式高度
    let height = textEnt?.height ?? 0;
    if (height === 0 && style?.height) {
        height = style.height;
    }

    let fontFamily = getStyleFontFamily(styleName, styles);
    let fontWeight = 'normal';
    let fontStyle = 'normal';
    

    // 检查多行文字内联高度覆盖 \H...;。
    if (ent.type === EntityType.MTEXT) {
        const hMatch = ent.value.match(/\\H([^;]+);/);
        if (hMatch && hMatch[1]) {
            const hVal = parseFloat(hMatch[1]);
            if (!isNaN(hVal)) {
                if (hMatch[1].endsWith('x')) {
                    // 乘数：如果当前高度为0，使用样式高度或默认值作为基准
                    if (height === 0) {
                        height = style?.height || CAD_DEFAULT_TEXT_HEIGHT;
                    }
                    height *= hVal;
                } else {
                    // 绝对值：直接设置高度
                    height = hVal;
                }
            }
        }

        // 多行文字内容可能包含复杂格式，例如 {\fArial|b1|i1|c0|p34;Text}。
        // 1. 检查多行文字内容中的显式字体覆盖。
        const fMatch = ent.value.match(/\\[fF]([^;|]+)(?:\|([^;]*))?(?:;|$)/);
        if (fMatch && fMatch[1]) {
            const inlineFont = fMatch[1].replace(/\"/g, '').trim();
            const inlineParams = fMatch[2] || '';
            
            if (inlineParams) {
                const parts = inlineParams.split('|');
                parts.forEach(part => {
                    const partLower = part.toLowerCase();
                    if (partLower.startsWith('b') && part.length > 1) {
                        fontWeight = part.substring(1) === '1' ? 'bold' : 'normal';
                    } else if (partLower.startsWith('i') && part.length > 1) {
                        fontStyle = part.substring(1) === '1' ? 'italic' : 'normal';
                    }
                });
            }

            if (inlineFont) {
                const inlineFontLower = inlineFont.toLowerCase();

                if (inlineFontLower.includes('仿宋') || inlineFontLower.includes('fangsong') || inlineFontLower === 'fs') {
                    fontFamily = FONT_STACKS.FANGSONG;
                } else if (inlineFontLower.includes('宋体') || inlineFontLower.includes('simsun') || inlineFontLower.includes('song')) {
                    fontFamily = FONT_STACKS.SONG;
                } else if (inlineFontLower.includes('黑体') || inlineFontLower.includes('simhei') || inlineFontLower.includes('hei')) {
                    fontFamily = FONT_STACKS.HEI;
                } else if (inlineFontLower.includes('楷体') || inlineFontLower.includes('simkai') || inlineFontLower.includes('kai')) {
                    fontFamily = FONT_STACKS.KAI;
                } else if (inlineFontLower.includes('yahei') || inlineFontLower.includes('微软雅黑')) {
                    fontFamily = FONT_STACKS.HEI;
                } else if (inlineFontLower === 'arial' || inlineFontLower.includes('arial')) {
                    fontFamily = 'Arial, Helvetica, sans-serif';
                } else if (styles && (styles[inlineFont] || styles[inlineFont.toUpperCase()])) {
                    const matchedStyle = (styles[inlineFont] || styles[inlineFont.toUpperCase()]);
                    fontFamily = getStyleFontFamily(matchedStyle.name, styles);
                } else {
                    fontFamily = mapCadFontToWebFont(inlineFont);
                }
            }
        }
    }

    // CAD 文字高度是「大写字高」语义，画布 font-size 是 em 尺寸，需要换算：
    // - 含中文：中文墨迹约 0.88em → 1.14；
    // - 纯西文：capHeight ≈ 0.72em → 1.39。
    // Canvas 始终使用系统字体（SHX 也映射为系统字体），不再按 SHX 的 1.0
    // 处理，否则 SHX 样式文字只有 0.7 倍字高（实测"有的偏小"）。
    const hasCjk = /[\u2e80-\u9fff\uf900-\ufaff]/.test(textEnt?.value || '');
    const scaleFactor = hasCjk
        ? TEXT_RENDER_CONFIG.cjkFontHeightFactor
        : TEXT_RENDER_CONFIG.trueTypeFontHeightFactor;
    const correctedHeight = Math.max(TEXT_RENDER_CONFIG.minimumCanvasFontPixelHeight, height * scaleFactor);

    return `${fontStyle} ${fontWeight} ${correctedHeight}px ${fontFamily}`;
};



