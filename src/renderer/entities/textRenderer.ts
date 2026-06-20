import { DxfText, DxfStyle, CanvasTheme, Point2D, EntityType } from '@/types';
import { 
  TEXT_RENDER_CONFIG, 
  CANVAS_THEME_COLORS 
} from '@/config/viewerConfig';
import { 
  CAD_DEFAULT_TEXT_STYLE, 
  CAD_DEFAULT_TEXT_HEIGHT, 
  CAD_BY_LAYER_COLOR 
} from '@/config/cadConstants';
import { 
  cleanCadText, 
  cleanMText, 
  getCadTextAnchorPosition, 
  getEffectiveTextHeight, 
  splitCadFormattedText 
} from '@/utils/textUtils';
import { buildCadTextLayout } from '@/core/text/textLayoutEngine';
import { getCanvasFont } from '@/utils/fontResolver';
import { getAutoCadColor } from '@/utils/colorUtils';
import { 
  getTextShxFontNames, 
  measureShxTextRunSync, 
  getShxGlyphProfileSync 
} from '@/renderer/services/shxFontService';
import { resolveCadTextFontProfile } from '@/renderer/services/fontService';

export interface RenderTransform {
    project: (p: Point2D) => Point2D;
    scale: number;
    rotation: number;
}

/**
 * 测量在 Canvas 中的基本文本宽度（包围盒宽度）
 */
export const getMeasuredTextWidth = (ctx: CanvasRenderingContext2D, value: string): number => {
    if (!value) return 0;
    const metrics = ctx.measureText(value);
    const bboxWidth = Math.abs((metrics.actualBoundingBoxRight || 0) - (metrics.actualBoundingBoxLeft || 0));
    return Math.max(metrics.width, bboxWidth);
};

/**
 * 获取下划线偏置像素距离
 */
const getUnderlineOffset = (baseline: CanvasTextBaseline, textHeightPixels: number) => {
    if (baseline === 'top' || baseline === 'hanging') {
        return textHeightPixels * TEXT_RENDER_CONFIG.underlineTopBaselineFactor;
    }
    if (baseline === 'middle') {
        return textHeightPixels * TEXT_RENDER_CONFIG.underlineMiddleBaselineFactor;
    }
    return textHeightPixels * TEXT_RENDER_CONFIG.underlineAlphabeticBaselineFactor;
};

/**
 * 测量包含 SHX 的文本渲染宽度
 */
const measureTextWidth = (ctx: CanvasRenderingContext2D, value: string, shxFontNames: string[] = [], textHeightPixels: number = 0) => {
    const fallbackWidth = (char: string) => getMeasuredTextWidth(ctx, char);
    const shxMeasure = textHeightPixels > 0 ? measureShxTextRunSync(value, shxFontNames, textHeightPixels, fallbackWidth) : null;
    return shxMeasure?.width ?? getMeasuredTextWidth(ctx, value);
};

/**
 * 计算 SHX 行基准线的 Y 坐标偏移
 */
const getShxRunBaselineOriginY = (
    baseline: CanvasTextBaseline,
    textHeightPixels: number,
    y: number,
    ascent: number,
    descent: number,
): number => {
    const safeAscent = Math.max(ascent, textHeightPixels * 0.82);
    const safeDescent = Math.max(descent, textHeightPixels * 0.12);
    if (baseline === 'top' || baseline === 'hanging') return y + safeAscent;
    if (baseline === 'middle') return y + (safeAscent - safeDescent) / 2;
    if (baseline === 'bottom' || baseline === 'ideographic') return y - safeDescent;
    return y;
};

/**
 * 收集当前文本对应的 SHX 字形数据
 */
const collectShxGlyphs = (text: string, textHeightPixels: number, shxFontNames: string[]) => {
    let ascent = 0;
    let descent = 0;
    const glyphs = Array.from(text).map(char => {
        if (char === '\r' || char === '\n' || char === ' ' || char === '\t') {
            return { char, profile: null };
        }
        const code = char.codePointAt(0) || char.charCodeAt(0);
        const profile = getShxGlyphProfileSync(shxFontNames, code, textHeightPixels);
        if (profile) {
            ascent = Math.max(ascent, profile.bbox.maxY);
            descent = Math.max(descent, -profile.bbox.minY);
        }
        return { char, profile };
    });

    return { glyphs, ascent, descent };
};

/**
 * 获取 SHX 单个字形缩放尺寸
 */
const getShxGlyphSize = (textHeightPixels: number) => textHeightPixels * Math.min(
    TEXT_RENDER_CONFIG.shxGlyphSizeMaxFactor,
    Math.max(TEXT_RENDER_CONFIG.shxGlyphSizeMinFactor, TEXT_RENDER_CONFIG.shxGlyphSizeFactor),
);

/**
 * 绘制 SHX 字体调试边框
 */
const drawShxDebugMarker = (
    ctx: CanvasRenderingContext2D,
    shxDebugEnabled: boolean,
    x: number,
    y: number,
    width: number,
    textHeightPixels: number,
    glyphCount: number,
    fallbackCount: number
) => {
    if (!shxDebugEnabled) return;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = glyphCount > 0 ? '#22c55e' : '#ef4444';
    ctx.setLineDash([2, 2]);
    ctx.strokeRect(x, y - textHeightPixels, Math.max(width, 2), textHeightPixels);
    ctx.setLineDash([]);
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = glyphCount > 0 ? '#22c55e' : '#ef4444';
    ctx.fillText(`SHX ${glyphCount}/${glyphCount + fallbackCount}`, x, y - textHeightPixels - 2);
    ctx.restore();
};

/**
 * 绘制单行带有 SHX 字体的文本
 */
const drawShxText = (
    ctx: CanvasRenderingContext2D,
    shxDebugEnabled: boolean,
    text: string,
    x: number,
    y: number,
    baseline: CanvasTextBaseline,
    textHeightPixels: number,
    shxFontNames: string[],
    shxDebugStats: { glyphs: number; fallbacks: number; runs: number }
) => {
    let cursorX = x;
    let glyphCount = 0;
    let fallbackCount = 0;
    const { glyphs, ascent, descent } = collectShxGlyphs(text, textHeightPixels, shxFontNames);
    const baseY = getShxRunBaselineOriginY(baseline, textHeightPixels, y, ascent, descent);
    const previousLineWidth = ctx.lineWidth;
    ctx.lineWidth = Math.max(previousLineWidth, textHeightPixels * TEXT_RENDER_CONFIG.underlineLineWidthFactor);

    for (const { char, profile } of glyphs) {
        if (char === '\r' || char === '\n') continue;
        if (char === ' ' || char === '\t') {
            cursorX += getShxGlyphSize(textHeightPixels) * TEXT_RENDER_CONFIG.spaceCharacterWidthFactor;
            continue;
        }

        if (!profile || profile.polylines.length === 0) {
            ctx.fillText(char, cursorX, y);
            cursorX += getMeasuredTextWidth(ctx, char);
            fallbackCount++;
            continue;
        }

        ctx.beginPath();
        profile.polylines.forEach(polyline => {
            if (polyline.length === 0) return;
            ctx.moveTo(cursorX + polyline[0].x, baseY - polyline[0].y);
            for (let index = 1; index < polyline.length; index++) {
                ctx.lineTo(cursorX + polyline[index].x, baseY - polyline[index].y);
            }
        });
        ctx.stroke();
        cursorX += profile.advanceWidth;
        glyphCount++;
    }

    ctx.lineWidth = previousLineWidth;
    drawShxDebugMarker(ctx, shxDebugEnabled, x, baseY, cursorX - x, textHeightPixels, glyphCount, fallbackCount);

    shxDebugStats.glyphs += glyphCount;
    shxDebugStats.fallbacks += fallbackCount;
    shxDebugStats.runs++;
};

/**
 * 绘制富文本格式段文本
 */
const drawFormattedSegmentsLine = (
    ctx: CanvasRenderingContext2D,
    shxDebugEnabled: boolean,
    shxDebugStats: { glyphs: number; fallbacks: number; runs: number },
    segments: ReturnType<typeof splitCadFormattedText>,
    fallbackText: string,
    xOffset: number,
    y: number,
    align: CanvasTextAlign,
    baseline: CanvasTextBaseline,
    textHeightPixels: number,
    shxFontNames: string[] = []
) => {
    const fallbackSegments = [{ text: fallbackText, bold: false, italic: false, underline: false, color: undefined }];
    const drawSegments = (segments.length > 0 ? segments : fallbackSegments).filter(segment => segment.text.length > 0);
    if (drawSegments.length === 0) return;

    const segmentWidths = drawSegments.map(segment => measureTextWidth(ctx, segment.text, shxFontNames, textHeightPixels));
    const totalWidth = segmentWidths.reduce((sum, w) => sum + w, 0);

    let startX = xOffset;
    if (align === 'center') startX = xOffset - totalWidth / 2;
    else if (align === 'right') startX = xOffset - totalWidth;

    let x = startX;
    drawSegments.forEach((segment, index) => {
        ctx.save();
        if (segment.bold) ctx.font = ctx.font.replace('normal', 'bold').replace('lighter', 'bold');
        if (segment.italic) ctx.font = 'italic ' + ctx.font;
        if (segment.color !== undefined) ctx.fillStyle = getAutoCadColor(segment.color);

        drawShxText(ctx, shxDebugEnabled, segment.text, x, y, baseline, textHeightPixels, shxFontNames, shxDebugStats);

        if (segment.underline) {
            ctx.beginPath();
            const yOffset = getUnderlineOffset(baseline, textHeightPixels);
            ctx.moveTo(x, y + yOffset);
            ctx.lineTo(x + segmentWidths[index], y + yOffset);
            ctx.stroke();
        }
        ctx.restore();
        x += segmentWidths[index];
    });
};

/**
 * 绘制富文本格式单行文本
 */
const drawFormattedTextLine = (
    ctx: CanvasRenderingContext2D,
    shxDebugEnabled: boolean,
    shxDebugStats: { glyphs: number; fallbacks: number; runs: number },
    rawText: string,
    fallbackText: string,
    xOffset: number,
    y: number,
    align: CanvasTextAlign,
    baseline: CanvasTextBaseline,
    textHeightPixels: number,
    shxFontNames: string[] = []
) => {
    drawFormattedSegmentsLine(
        ctx,
        shxDebugEnabled,
        shxDebugStats,
        splitCadFormattedText(rawText),
        fallbackText,
        xOffset,
        y,
        align,
        baseline,
        textHeightPixels,
        shxFontNames
    );
};

/**
 * 绘制文本实体 (TEXT/MTEXT/ATTRIB/ATTDEF)
 */
export const drawTextEntity = (
    ctx: CanvasRenderingContext2D,
    ent: DxfText,
    transform: RenderTransform,
    styles: Record<string, DxfStyle>,
    theme: CanvasTheme,
    color: string,
    isSelected: boolean,
    noMTextWrap: boolean,
    shxDebugEnabled: boolean,
    shxDebugStats: { glyphs: number; fallbacks: number; runs: number }
) => {
    ctx.save();
    const isMText = ent.type === EntityType.MTEXT;
    const position = getCadTextAnchorPosition(ent);
    const screenPosition = transform.project(position);
    ctx.translate(screenPosition.x, screenPosition.y);

    const hAlign = ent.hAlign || 0;
    const alignedTextAngle = (!isMText && (hAlign === 3 || hAlign === 5) && ent.secondPosition)
        ? Math.atan2(ent.secondPosition.y - ent.position.y, ent.secondPosition.x - ent.position.x)
        : ((ent.rotation || 0) * Math.PI / 180);
    const totalRotation = alignedTextAngle + transform.rotation;
    if (totalRotation !== 0) ctx.rotate(-totalRotation);

    const profile = resolveCadTextFontProfile(ent.styleName, styles, ent.value);
    const fontScaleFactor = (profile === 'trueType' || profile === 'cjk') ? TEXT_RENDER_CONFIG.trueTypeFontHeightFactor : TEXT_RENDER_CONFIG.shxFontHeightFactor;

    const effectiveHeight = getEffectiveTextHeight(ent, styles);
    const actualVisualScreenHeight = effectiveHeight * transform.scale * fontScaleFactor;

    // 极端缩放或异常数据下高度可能退化为非有限值，直接跳过绘制避免污染画布。
    if (!Number.isFinite(actualVisualScreenHeight) || actualVisualScreenHeight <= 0) {
        ctx.restore();
        return;
    }

    if (actualVisualScreenHeight < TEXT_RENDER_CONFIG.tinyTextPixelHeight && !isSelected) {
        const layout = buildCadTextLayout({
            entity: ent,
            styles,
            context: ctx,
            worldToScreenScale: transform.scale,
            noWrap: noMTextWrap,
        });
        if (!layout || !Number.isFinite(layout.visualScreenHeight) || layout.visualScreenHeight <= 0) {
            ctx.restore();
            return;
        }
        // 占位矩形用视觉高度作为最小尺寸保证可见，同时钳制最大宽高比，
        // 避免布局在亚像素测量下产生超长或错位矩形。
        const placeholderHeight = layout.visualScreenHeight;
        const maxAllowedWidth = placeholderHeight * TEXT_RENDER_CONFIG.tinyTextPlaceholderMaxAspect;
        const clampWidth = (w: number) => {
            if (!Number.isFinite(w) || w <= 0) return placeholderHeight;
            return Math.min(Math.max(w, placeholderHeight), maxAllowedWidth);
        };
        ctx.scale(layout.horizontalScale * layout.generationScale.x, layout.generationScale.y);
        if (layout.isMText) {
            const width = clampWidth(Math.max(layout.blockWidth, layout.visualScreenHeight));
            ctx.fillRect(layout.boxLeft, layout.boxTop, width, Math.max(layout.blockHeight, layout.visualScreenHeight));
        } else {
            const width = clampWidth(Math.max(layout.blockWidth, layout.visualScreenHeight));
            let x = 0;
            if (layout.align === 'center') x = -width / 2;
            else if (layout.align === 'right') x = -width;
            let y = -layout.visualScreenHeight * TEXT_RENDER_CONFIG.alphabeticBaselineOffsetFactor;
            if (layout.baseline === 'top') y = 0;
            else if (layout.baseline === 'middle') y = -layout.visualScreenHeight / 2;
            else if (layout.baseline === 'bottom') y = -layout.visualScreenHeight;
            ctx.fillRect(x, y, width, layout.visualScreenHeight);
        }
        ctx.restore();
        return;
    }

    const originalHeight = ent.height;
    ent.height = effectiveHeight * transform.scale / fontScaleFactor; // Set to screen height
    ctx.font = getCanvasFont(ent, styles);
    ent.height = originalHeight;

    const shxFontNames = getTextShxFontNames(ent, styles);

    const layout = buildCadTextLayout({
        entity: ent,
        styles,
        context: ctx,
        worldToScreenScale: transform.scale,
        noWrap: noMTextWrap,
    });
    
    if (!layout) {
        ctx.restore();
        return;
    }

    if (layout.isMText) {
        ctx.scale(layout.horizontalScale * layout.generationScale.x, layout.generationScale.y);
        ctx.textAlign = layout.align;
        ctx.textBaseline = layout.baseline;

        if (ent.bgFill) {
            ctx.save();
            ctx.fillStyle = (ent.bgColor !== undefined && ent.bgColor !== CAD_BY_LAYER_COLOR)
                ? getAutoCadColor(ent.bgColor)
                : CANVAS_THEME_COLORS[theme];
            const bgPadding = layout.visualScreenHeight * TEXT_RENDER_CONFIG.mtextBackgroundPaddingFactor;
            ctx.fillRect(layout.boxLeft - bgPadding, layout.boxTop - bgPadding, layout.blockWidth + bgPadding * 2, layout.blockHeight + bgPadding * 2);
            ctx.restore();
        }

        layout.lines.forEach(line => {
            if (line.formatted) {
                drawFormattedSegmentsLine(ctx, shxDebugEnabled, shxDebugStats, line.formatted.segments, line.formatted.plainText, line.x, line.y, line.align, layout.baseline, layout.visualScreenHeight, shxFontNames);
            } else {
                drawFormattedTextLine(ctx, shxDebugEnabled, shxDebugStats, line.text, line.text, line.x, line.y, line.align, layout.baseline, layout.visualScreenHeight, shxFontNames);
            }
        });
    } else if ((hAlign === 3 || hAlign === 5) && ent.secondPosition) {
        const dx = ent.secondPosition.x - ent.position.x;
        const dy = ent.secondPosition.y - ent.position.y;
        const targetWidth = Math.hypot(dx, dy) * transform.scale;
        const measuredWidth = Math.max(layout.blockWidth, TEXT_RENDER_CONFIG.minimumMeasuredTextWidth);
        if (targetWidth > 0 && measuredWidth > 0) {
            // 测量宽度在亚像素字号下可能严重偏小，导致 targetWidth/measuredWidth 爆炸性放大，
            // 文字被拉成"巨长"。这里对缩放比例做钳制，保证视觉上仍贴合目标宽度方向但不会失控。
            const rawScale = targetWidth / measuredWidth;
            const scale = Math.min(
                Math.max(rawScale, TEXT_RENDER_CONFIG.minimumTextFitScale),
                TEXT_RENDER_CONFIG.maximumTextFitScale,
            );
            ctx.scale(scale, hAlign === 3 ? scale : 1);
        }
        drawFormattedTextLine(ctx, shxDebugEnabled, shxDebugStats, ent.value || layout.plainText, layout.plainText, 0, 0, 'left', layout.baseline, layout.visualScreenHeight, shxFontNames);
    } else {
        let align = layout.align;
        if (layout.generationScale.x < 0) {
            if (align === 'left') align = 'right';
            else if (align === 'right') align = 'left';
        }
        ctx.scale(layout.horizontalScale * layout.generationScale.x, layout.generationScale.y);
        drawFormattedTextLine(ctx, shxDebugEnabled, shxDebugStats, ent.value || layout.plainText, layout.plainText, 0, 0, align, layout.baseline, layout.visualScreenHeight, shxFontNames);
    }

    ctx.restore();
};
