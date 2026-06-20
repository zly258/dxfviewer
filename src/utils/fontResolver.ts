import { AnyEntity, DxfText, DxfStyle, EntityType } from '@/types';
import { CAD_DEFAULT_TEXT_STYLE, CAD_DEFAULT_TEXT_HEIGHT } from '@/config/cadConstants';
import { TEXT_RENDER_CONFIG } from '@/config/viewerConfig';
import { getStyleFontFamily, FONT_STACKS, mapCadFontToWebFont, resolveCadTextFontProfile } from '@/renderer/services/fontService';

/**
 * 获取用于 Canvas 绘制的 font 样式字符串
 */
export const getCanvasFont = (ent: AnyEntity, styles: Record<string, DxfStyle> | undefined): string => {
    const textEnt = (ent.type === EntityType.TEXT || ent.type === EntityType.MTEXT || ent.type === EntityType.ATTRIB || ent.type === EntityType.ATTDEF) ? (ent as DxfText) : null;
    
    // 高度优先级：1. 内联覆盖(MTEXT), 2. 实体高度, 3. 样式高度, 4. 默认值 2.5
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
    
    const profile = resolveCadTextFontProfile(textEnt?.styleName, styles, textEnt?.value);
    let isTrueType = profile === 'trueType' || profile === 'cjk';

    // 检查 MTEXT 内联高度覆盖 \H...;
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

        // MTEXT 内容可能包含复杂的格式化，如 {\fArial|b1|i1|c0|p34;Text}
        // 1. 检查 MTEXT 值中的显式字体覆盖
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
                isTrueType = true; // 内联 \f 字体通常是 TrueType

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

    // CAD 文字高度更接近可见字高，Canvas font-size 是 em 框高度，需要按字体类型做高度换算。
    const scaleFactor = isTrueType ? TEXT_RENDER_CONFIG.trueTypeFontHeightFactor : TEXT_RENDER_CONFIG.shxFontHeightFactor;
    const correctedHeight = height * scaleFactor; 

    return `${fontStyle} ${fontWeight} ${correctedHeight}px ${fontFamily}`;
};
