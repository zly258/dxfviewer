import type { RenderContext } from '@/renderer/context';
import { DxfText, DxfStyle, CanvasTheme, Point2D, EntityType } from '@/types';
import { CANVAS_THEME_COLORS, TEXT_RENDER_CONFIG } from '@/config/viewerConfig';
import { CAD_BY_LAYER_COLOR } from '@/config/cadConstants';
import {
    getCadTextAnchorPosition,
    getEffectiveTextHeight,
    splitCadFormattedText,
} from '@/utils/textUtils';
import { getCanvasFont } from '@/utils/fontResolver';
import { getAutoCadColor } from '@/utils/colorUtils';
import { getMeasuredTextWidthCached, getTextLayoutCached } from '@/renderer/services/renderCache';
import { buildCadTextLayout, CadTextLayoutResult } from '@/core/text/textLayoutEngine';

export interface RenderTransform {
    project: (p: Point2D) => Point2D;
    scale: number;
    rotation: number;
}

/** 测量 Canvas 文本宽度，优先使用实际包围盒宽度（结果经全局缓存去重）。 */
export const getMeasuredTextWidth = (ctx: RenderContext, value: string): number =>
    getMeasuredTextWidthCached(ctx, value);

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
    ctx: RenderContext,
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
    ctx: RenderContext,
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

/**
 * 按布局结果绘制文字。
 * `k` 为布局几何到当前帧像素的缩放因子：
 * - 缓存路径：参考字高布局 → k = 屏幕字高 / 参考字高；
 * - 直接路径：屏幕字高布局 → k = 1（与引入缓存前的行为逐像素一致）。
 */
const drawTextLayout = (
    ctx: RenderContext,
    ent: DxfText,
    theme: CanvasTheme,
    layout: CadTextLayoutResult,
    k: number,
    screenScale: number,
    hAlign: number,
) => {
    if (layout.isMText) {
        ctx.scale(layout.horizontalScale * layout.generationScale.x, layout.generationScale.y);
        ctx.textAlign = layout.align;
        ctx.textBaseline = layout.baseline;

        if (ent.bgFill) {
            ctx.save();
            ctx.fillStyle = (ent.bgColor !== undefined && ent.bgColor !== CAD_BY_LAYER_COLOR)
                ? getAutoCadColor(ent.bgColor)
                : CANVAS_THEME_COLORS[theme];
            const bgPadding = layout.visualScreenHeight * k * TEXT_RENDER_CONFIG.mtextBackgroundPaddingFactor;
            ctx.fillRect(
                layout.boxLeft * k - bgPadding,
                layout.boxTop * k - bgPadding,
                layout.blockWidth * k + bgPadding * 2,
                layout.blockHeight * k + bgPadding * 2,
            );
            ctx.restore();
        }

        layout.lines.forEach(line => {
            const baselineY = line.y * k + layout.ascent * k;
            if (line.formatted) {
                drawFormattedSegmentsLine(ctx, line.formatted.segments, line.formatted.plainText, line.x * k, baselineY, line.align, 'alphabetic', layout.visualScreenHeight * k);
            } else {
                drawFormattedTextLine(ctx, line.text, line.text, line.x * k, baselineY, line.align, 'alphabetic', layout.visualScreenHeight * k);
            }
        });
    } else if ((hAlign === 3 || hAlign === 5) && ent.secondPosition) {
        const dx = ent.secondPosition.x - ent.position.x;
        const dy = ent.secondPosition.y - ent.position.y;
        const targetWidth = Math.hypot(dx, dy) * screenScale;
        const measuredWidth = Math.max(layout.blockWidth * k, TEXT_RENDER_CONFIG.minimumMeasuredTextWidth);
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
        const baselineY = getCadSingleLineBaselineY(ent, hAlign, layout.ascent * k, layout.descent * k);
        drawFormattedTextLine(ctx, ent.value || layout.plainText, layout.plainText, 0, baselineY, 'left', ctx.textBaseline, layout.visualScreenHeight * k);
    } else {
        let align = layout.align;
        if (layout.generationScale.x < 0) {
            if (align === 'left') align = 'right';
            else if (align === 'right') align = 'left';
        }
        ctx.scale(layout.horizontalScale * layout.generationScale.x, layout.generationScale.y);
        ctx.textAlign = align;
        ctx.textBaseline = 'alphabetic';
        const baselineY = getCadSingleLineBaselineY(ent, hAlign, layout.ascent * k, layout.descent * k);
        drawFormattedTextLine(ctx, ent.value || layout.plainText, layout.plainText, 0, baselineY, align, ctx.textBaseline, layout.visualScreenHeight * k);
    }
};

/**
 * 直接布局路径（缓存未命中时的回退）：与引入布局缓存前完全一致——
 * 以屏幕字号设置字体、按当前视图缩放构建布局并绘制。
 */
const drawTextEntityDirect = (
    ctx: RenderContext,
    ent: DxfText,
    styles: Record<string, DxfStyle>,
    theme: CanvasTheme,
    noMTextWrap: boolean,
    screenScale: number,
    screenTextHeight: number,
) => {
    const originalHeight = ent.height;
    ent.height = screenTextHeight;
    ctx.font = getCanvasFont(ent, styles);
    ent.height = originalHeight;

    const layout = buildCadTextLayout({
        entity: ent,
        styles,
        context: ctx,
        worldToScreenScale: screenScale,
        noWrap: noMTextWrap,
    });
    if (!layout) return;

    drawTextLayout(ctx, ent, theme, layout, 1, screenScale, ent.hAlign || 0);
};

/** 绘制文本实体（TEXT、MTEXT、ATTRIB、ATTDEF）。 */
export const drawTextEntity = (
    ctx: RenderContext,
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

    // 布局获取：优先命中缓存（命中时零 measureText，参考字高布局按
    // scaleFactor 线性映射到当前帧）；返回 null 时（如含 \H 内联字高覆盖的
    // MTEXT，其缩放行为无法用单一因子复刻）回退到直接布局路径，
    // 与引入缓存前的行为保持一致。
    const cachedLayout = getTextLayoutCached(ctx, ent, styles, screenTextHeight, noMTextWrap);
    if (cachedLayout) {
        const { layout, scaleFactor } = cachedLayout;

        // 实际绘制使用屏幕字号字体（fillText 依赖 ctx.font）；
        // 布局缓存内部使用的参考字体已通过 save/restore 隔离，不会泄漏到这里。
        const originalHeight = ent.height;
        ent.height = screenTextHeight;
        ctx.font = getCanvasFont(ent, styles);
        ent.height = originalHeight;

        drawTextLayout(ctx, ent, theme, layout, scaleFactor, screenScale, hAlign);
    } else {
        drawTextEntityDirect(ctx, ent, styles, theme, noMTextWrap, screenScale, screenTextHeight);
    }

    ctx.restore();
};
