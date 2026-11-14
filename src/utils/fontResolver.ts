import { AnyEntity, DxfText, DxfStyle, EntityType } from '@/types';
import { CAD_DEFAULT_TEXT_STYLE, CAD_DEFAULT_TEXT_HEIGHT } from '@/config/cadConstants';
import { TEXT_RENDER_CONFIG } from '@/config/viewerConfig';
import { getStyleFontFamily, FONT_STACKS, mapCadFontToWebFont } from '@/render/text/fontService';
import { canvasFontScaleFactor } from '@/render/text/fontMetrics';

/**
 * 获取用于画布绘制的字体样式字符串。
 *
 * `options.ignoreInlineHeight`：调用方已经用 `getEffectiveTextHeight` 解析过
 * 内联字高（`\H`）时置 true —— 否则 `\H` 会被再乘一次（"双重应用"），
 * 含 `{\H0.7x;...}` 的注释/标注会小 30% 且整体下沉，与 WebGL 轮廓文字不一致。
 */
export const getCanvasFont = (
    ent: AnyEntity,
    styles: Record<string, DxfStyle> | undefined,
    options?: { ignoreInlineHeight?: boolean },
): string => {
    const textEnt = (ent.type === EntityType.TEXT || ent.type === EntityType.MTEXT || ent.type === EntityType.ATTRIB || ent.type === EntityType.ATTDEF) ? (ent as DxfText) : null;
    
    // 高度优先级：1. 多行文字内联覆盖，2. 实体高度，3. 样式高度，4. 默认值 2.5。
    const styleName = textEnt?.styleName || CAD_DEFAULT_TEXT_STYLE;
    const style = styles?.[styleName] || styles?.[styleName.toUpperCase()];
    
    // 初始高度：实体高度，如果为0则使用样式高度
    let height = textEnt?.height ?? 0;
    if (height === 0 && style?.height) {
        height = style.height;
    }

    // 形字体（.shx / 大字体）不直接绘制，按字体名换成系统字体栈。
    let fontFamily = getStyleFontFamily(styleName, styles);
    let fontWeight = 'normal';
    let fontStyle = 'normal';

    // 检查多行文字内联高度覆盖 \H...;。
    if (ent.type === EntityType.MTEXT && !options?.ignoreInlineHeight) {
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

    // px 写 CAD 字高。中文和英文的 em 在绘制时按字符分开换算，避免整段一个字号。
    const correctedHeight = Math.max(
        TEXT_RENDER_CONFIG.minimumCanvasFontPixelHeight,
        height * canvasFontScaleFactor(),
    );

    return `${fontStyle} ${fontWeight} ${correctedHeight}px ${fontFamily}`;
};



