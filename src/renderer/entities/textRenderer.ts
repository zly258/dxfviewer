import { DxfText, DxfStyle, CanvasTheme, Point2D, EntityType } from '@/types';
import { CANVAS_THEME_COLORS, TEXT_RENDER_CONFIG } from '@/config/viewerConfig';
import { CAD_BY_LAYER_COLOR } from '@/config/cadConstants';
import {
    getCadTextAnchorPosition,
    getEffectiveTextHeight,
    splitCadFormattedText,
} from '@/utils/textUtils';
import { buildCadTextLayout } from '@/core/text/textLayoutEngine';
import { getCanvasFont } from '@/utils/fontResolver';
import { getAutoCadColor } from '@/utils/colorUtils';

export interface RenderTransform {
    project: (p: Point2D) => Point2D;
    scale: number;
    rotation: number;
}

/** 测量 Canvas 文本宽度，优先使用实际包围盒宽度。 */
export const getMeasuredTextWidth = (ctx: CanvasRenderingContext2D, value: string): number => {
    if (!value) return 0;
    const metrics = ctx.measureText(value);
    const bboxWidth = Math.abs((metrics.actualBoundingBoxRight || 0) - (metrics.actualBoundingBoxLeft || 0));
    return Math.max(metrics.width || 0, bboxWidth || 0);
};

/** 获取下划线相对基准线的偏移。 */
const getUnderlineOffset = (baseline: CanvasTextBaseline, textHeightPixels: number): number => {
    if (baseline === 'top' || baseline === 'hanging') {
        return textHeightPixels * TEXT_RENDER_CONFIG.underlineTopBaselineFactor;
    }
    if (baseline === 'middle') {
        return textHeightPixels * TEXT_RENDER_CONFIG.underlineMiddleBaselineFactor;
    }
    return textHeightPixels * TEXT_RENDER_CONFIG.underlineAlphabeticBaselineFactor;
};

/** 绘制富文本格式段。SHX 样式已映射为浏览器字体，不再依赖真实 SHX 字形文件。 */
const drawFormattedSegmentsLine = (
    ctx: CanvasRenderingContext2D,
    segments: ReturnType<typeof splitCadFormattedText>,
    fallbackText: string,
    xOffset: number,
    y: number,
    align: CanvasTextAlign,
    baseline: CanvasTextBaseline,
    textHeightPixels: number,
) => {
    const fallbackSegments = [{ text: fallbackText, bold: false, italic: false, underline: false, color: undefined }];
    const drawSegments = (segments.length > 0 ? segments : fallbackSegments).filter(segment => segment.text.length > 0);
    if (drawSegments.length === 0) return;

    const segmentWidths = drawSegments.map(segment => getMeasuredTextWidth(ctx, segment.text));
    const totalWidth = segmentWidths.reduce((sum, width) => sum + width, 0);

    let x = xOffset;
    if (align === 'center') x -= totalWidth / 2;
    else if (align === 'right') x -= totalWidth;

    drawSegments.forEach((segment, index) => {
        ctx.save();
        // 分段绘制已经手动计算了左/中/右对齐后的起点。
        // 这里必须使用 left，否则 Canvas 自身的 center/right 会再次偏移，
        // 在移除真实 SHX 描边后会导致 MTEXT、ATTRIB 等文字整体向左错位。
        ctx.textAlign = 'left';
        ctx.textBaseline = baseline;
        if (segment.bold) ctx.font = ctx.font.replace('normal', 'bold').replace('lighter', 'bold');
        if (segment.italic && !ctx.font.startsWith('italic ')) ctx.font = `italic ${ctx.font}`;
        if (segment.color !== undefined) ctx.fillStyle = getAutoCadColor(segment.color);

        ctx.fillText(segment.text, x, y);

        if (segment.underline) {
            ctx.beginPath();
            const underlineY = y + getUnderlineOffset(baseline, textHeightPixels);
            ctx.moveTo(x, underlineY);
            ctx.lineTo(x + segmentWidths[index], underlineY);
            ctx.stroke();
        }

        ctx.restore();
        x += segmentWidths[index];
    });
};

/** 绘制富文本格式单行文本。 */
const drawFormattedTextLine = (
    ctx: CanvasRenderingContext2D,
    rawText: string,
    fallbackText: string,
    xOffset: number,
    y: number,
    align: CanvasTextAlign,
    baseline: CanvasTextBaseline,
    textHeightPixels: number,
) => {
    drawFormattedSegmentsLine(
        ctx,
        splitCadFormattedText(rawText),
        fallbackText,
        xOffset,
        y,
        align,
        baseline,
        textHeightPixels,
    );
};

const getCadSingleLineBaselineY = (
    ent: DxfText,
    hAlign: number,
    ascent: number,
    descent: number,
): number => {
    const vAlign = ent.vAlign || 0;
    if (vAlign === 3) return ascent;
    if (vAlign === 2 || hAlign === 4) return (ascent - descent) / 2;
    if (vAlign === 1) return -descent;
    return 0;
};

/** 绘制文本实体（TEXT、MTEXT、ATTRIB、ATTDEF）。 */
export const drawTextEntity = (
    ctx: CanvasRenderingContext2D,
    ent: DxfText,
    transform: RenderTransform,
    styles: Record<string, DxfStyle>,
    theme: CanvasTheme,
    color: string,
    noMTextWrap: boolean,
) => {
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;

    const isMText = ent.type === EntityType.MTEXT;
    const hAlign = ent.hAlign || 0;
    const effectiveHeight = getEffectiveTextHeight(ent, styles);
    const screenScale = Math.abs(transform.scale);
    const screenTextHeight = effectiveHeight * screenScale;

    // 极端缩小时不再绘制填充占位块，避免远距离视图中出现错位黑块。
    // 这里按真实缩放结果跳过不可见文字，因此不会产生固定像素大小的“假文字”。
    if (!Number.isFinite(screenTextHeight) || screenTextHeight < TEXT_RENDER_CONFIG.minimumTextRenderPixelHeight) {
        ctx.restore();
        return;
    }

    const position = getCadTextAnchorPosition(ent);
    const screenPosition = transform.project(position);
    ctx.translate(screenPosition.x, screenPosition.y);

    const alignedTextAngle = (!isMText && (hAlign === 3 || hAlign === 5) && ent.secondPosition)
        ? Math.atan2(ent.secondPosition.y - ent.position.y, ent.secondPosition.x - ent.position.x)
        : ((ent.rotation || 0) * Math.PI / 180);
    const totalRotation = alignedTextAngle + transform.rotation;
    if (totalRotation !== 0) ctx.rotate(-totalRotation);

    const originalHeight = ent.height;
    ent.height = effectiveHeight * screenScale;
    ctx.font = getCanvasFont(ent, styles);
    ent.height = originalHeight;

    const layout = buildCadTextLayout({
        entity: ent,
        styles,
        context: ctx,
        worldToScreenScale: screenScale,
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
            ctx.fillRect(
                layout.boxLeft - bgPadding,
                layout.boxTop - bgPadding,
                layout.blockWidth + bgPadding * 2,
                layout.blockHeight + bgPadding * 2,
            );
            ctx.restore();
        }

        layout.lines.forEach(line => {
            const baselineY = line.y + layout.ascent;
            if (line.formatted) {
                drawFormattedSegmentsLine(ctx, line.formatted.segments, line.formatted.plainText, line.x, baselineY, line.align, 'alphabetic', layout.visualScreenHeight);
            } else {
                drawFormattedTextLine(ctx, line.text, line.text, line.x, baselineY, line.align, 'alphabetic', layout.visualScreenHeight);
            }
        });
    } else if ((hAlign === 3 || hAlign === 5) && ent.secondPosition) {
        const dx = ent.secondPosition.x - ent.position.x;
        const dy = ent.secondPosition.y - ent.position.y;
        const targetWidth = Math.hypot(dx, dy) * screenScale;
        const measuredWidth = Math.max(layout.blockWidth, TEXT_RENDER_CONFIG.minimumMeasuredTextWidth);
        if (targetWidth > 0 && measuredWidth > 0) {
            const rawScale = targetWidth / measuredWidth;
            const scale = Math.min(
                Math.max(rawScale, TEXT_RENDER_CONFIG.minimumTextFitScale),
                TEXT_RENDER_CONFIG.maximumTextFitScale,
            );
            ctx.scale(scale, hAlign === 3 ? scale : 1);
        }
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        const baselineY = getCadSingleLineBaselineY(ent, hAlign, layout.ascent, layout.descent);
        drawFormattedTextLine(ctx, ent.value || layout.plainText, layout.plainText, 0, baselineY, 'left', ctx.textBaseline, layout.visualScreenHeight);
    } else {
        let align = layout.align;
        if (layout.generationScale.x < 0) {
            if (align === 'left') align = 'right';
            else if (align === 'right') align = 'left';
        }
        ctx.scale(layout.horizontalScale * layout.generationScale.x, layout.generationScale.y);
        ctx.textAlign = align;
        ctx.textBaseline = 'alphabetic';
        const baselineY = getCadSingleLineBaselineY(ent, hAlign, layout.ascent, layout.descent);
        drawFormattedTextLine(ctx, ent.value || layout.plainText, layout.plainText, 0, baselineY, align, ctx.textBaseline, layout.visualScreenHeight);
    }

    ctx.restore();
};
