/**
 * 渲染路径专用缓存。
 *
 * 原理：Canvas 2D 是立即模式——每帧平移/缩放都会对所有可见实体重新执行
 * `measureText` 和文字布局计算，而 `measureText` 恰好是 Canvas 2D 中最昂贵的
 * 调用之一。工程图纸中文字/标注实体常占 30% 以上，万级实体图纸每帧成千上万
 * 次 `measureText` 是掉帧的主要根源。
 *
 * 缓存分两级：
 * - 字符串测量缓存：同一 `font` 下相同字符串的测量宽度必然相同（Canvas 文本
 *   测量是确定性纯函数），跨帧、跨实体复用。
 * - 文字布局缓存：`buildCadTextLayout` 的全部几何输出（行宽、行位置、ascent、
 *   descent、blockWidth/blockHeight）均随字号线性缩放——测量宽度与字号成正比，
 *   换行判定两侧（行宽与 maxWidth）同步缩放，判定结果不变。因此在固定参考字号
 *   下布局一次，绘制时对几何输出做线性缩放，即可实现跨缩放帧的完整命中。
 *   只有首次绘制时才真正访问 Canvas。
 */

import { DxfStyle, DxfText, EntityType } from '@/types';
import {
    buildCadTextLayout,
    CadTextLayoutResult,
} from '@/core/text/textLayoutEngine';
import { getEffectiveTextHeight } from '@/utils/textUtils';
import { getCanvasFont } from '@/utils/fontResolver';

/** 缓存上限：超出后整体清空。按图纸切换时由调用方显式清空，平时很难触顶。 */
const MAX_MEASURE_CACHE_ENTRIES = 200_000;
const MAX_LAYOUT_CACHE_ENTRIES = 30_000;

/**
 * 字符串测量宽度缓存（按 font 分桶）。
 * 文字绘制与布局中大量的 `ctx.measureText` 在同一字体下重复度极高
 * （图纸中大量相同的标注文字、序号、轴号），命中时完全跳过 Canvas。
 */
const measureCache = new Map<string, Map<string, number>>();

export const getMeasuredTextWidthCached = (
    ctx: CanvasRenderingContext2D,
    value: string,
): number => {
    if (!value) return 0;
    const font = ctx.font;
    let bucket = measureCache.get(font);
    if (!bucket) {
        bucket = new Map();
        measureCache.set(font, bucket);
    }
    const cached = bucket.get(value);
    if (cached !== undefined) return cached;

    // 未命中：与 textRenderer.getMeasuredTextWidth 保持完全一致的测量口径。
    const metrics = ctx.measureText(value);
    const bboxWidth = Math.abs((metrics.actualBoundingBoxRight || 0) - (metrics.actualBoundingBoxLeft || 0));
    const width = Math.max(metrics.width || 0, bboxWidth || 0);

    // 简单防膨胀：超限整体清空。真实图纸的测量组合远低于该上限。
    if (bucket.size >= MAX_MEASURE_CACHE_ENTRIES) {
        measureCache.clear();
        const fresh = new Map<string, number>();
        measureCache.set(font, fresh);
        fresh.set(value, width);
        return width;
    }
    bucket.set(value, width);
    return width;
};

export const clearMeasureCache = (): void => {
    measureCache.clear();
};

/**
 * 布局缓存键：实体 id + 影响布局结果的全部输入。
 * - value：文字内容（含格式码，\H/\W/\f 内联覆盖均由此派生）
 * - styles：样式表对象标识（字体/字高/宽度因子的来源）
 * - w：MTEXT 声明宽度（决定换行）
 * - nw：noWrap 模式（blockRenderer 嵌套绘制时禁用换行）
 * 注意：布局输出已按参考字号归一化，缩放值不参与缓存键，
 * 因此平移/缩放过程中同一文字的布局计算完全命中。
 */
interface LayoutCacheKeyParts {
    id: string;
    value: string;
    styles: Record<string, DxfStyle> | undefined;
    width: number;
    noWrap: boolean;
}

const layoutCache = new Map<string, CachedTextLayout>();

interface CachedTextLayout {
    /** 参考字号下构建的布局。 */
    reference: CadTextLayoutResult;
    /** 参考布局对应的有效世界字高（含 \H 内联覆盖的放大效果）。 */
    referenceEffectiveHeight: number;
}

const buildLayoutCacheKey = (parts: LayoutCacheKeyParts): string => {
    // 样式表以键数量参与哈希：图纸内样式表不可变（加载后只读引用），
    // 切换图纸时缓存整体清空，因此对象身份稳定。
    const stylesRef = parts.styles ? Object.keys(parts.styles).length : 0;
    return `${parts.id}\u0000${parts.value}\u0000${stylesRef}\u0000${parts.width}\u0000${parts.noWrap ? 1 : 0}`;
};

/**
 * 参考字高（世界单位）：布局统一在该字高下构建。
 * 足够大以避免亚像素测量抖动，又不会造成数值精度问题。
 */
const REFERENCE_LAYOUT_HEIGHT = 100;

/**
 * 获取文字布局：优先命中缓存；未命中时在固定参考字高下构建一次。
 *
 * 缩放映射：调用方传入 `screenTextHeight`（= 有效字高 × 当前视图缩放，
 * 与 textRenderer 现有计算一致），返回 `scaleFactor`，布局的全部像素几何
 * （screenHeight/visualScreenHeight/blockWidth/blockHeight/boxLeft/boxTop/
 * lineHeight/ascent/descent/lines[].x/lines[].y/lines[].width）乘以它即为
 * 当前帧的真实值；非几何字段（align/baseline/horizontalScale/
 * generationScale/plainText/formatted 段）原样使用。
 *
 * 正确性关键：MTEXT 的 width/boxHeight/actualWidth 是世界单位，不随字高
 * 缩放。构建参考布局时将三者按 effRef/effOrig 同步归一化，使"字高比例"与
 * "世界宽度比例"收敛为同一个 scaleFactor，换行决策才能与真实帧完全一致。
 * Canvas 文本测量相对字号严格线性，因此该映射是精确等价而非近似。
 */
export const getTextLayoutCached = (
    ctx: CanvasRenderingContext2D,
    entity: DxfText,
    styles: Record<string, DxfStyle>,
    screenTextHeight: number,
    noWrap: boolean,
): { layout: CadTextLayoutResult; scaleFactor: number } | null => {
    const isMText = entity.type === EntityType.MTEXT;

    // 含 \H 内联字高覆盖的 MTEXT 不走缓存：旧渲染路径对 \H 存在"双重应用"
    // （getEffectiveTextHeight 与 getCanvasFont 各解析一次），宽度与高度随
    // 缩放的比例不一致，无法用单一 scaleFactor 复刻。此类实体回退到
    // textRenderer 的直接布局路径，保证渲染结果与引入缓存前逐像素一致。
    if (isMText && /\\[Hh][^;]+;/.test(entity.value || '')) return null;

    const effOrig = getEffectiveTextHeight(entity, styles);
    const key = buildLayoutCacheKey({
        id: entity.id,
        value: entity.value,
        styles,
        width: isMText ? (entity.width || 0) : 0,
        noWrap,
    });

    const cached = layoutCache.get(key);
    if (cached) {
        return { layout: cached.reference, scaleFactor: screenTextHeight / cached.referenceEffectiveHeight };
    }

    // 未命中：以参考字高构建布局。构建期间临时改写实体字高与世界单位字段，
    // 完成后立即恢复；ctx.save/restore 恢复参考字体设置，不影响调用方的
    // 屏幕字号字体。
    const originalHeight = entity.height;
    entity.height = REFERENCE_LAYOUT_HEIGHT;
    const effRef = getEffectiveTextHeight(entity, styles);
    const norm = effOrig > 0 ? effRef / effOrig : 1;

    const originalWidth = entity.width;
    const mtextExtras = entity as any;
    const originalBoxHeight = mtextExtras.boxHeight as number | undefined;
    const originalActualWidth = mtextExtras.actualWidth as number | undefined;
    if (isMText) {
        if (originalWidth) entity.width = originalWidth * norm;
        if (originalBoxHeight) mtextExtras.boxHeight = originalBoxHeight * norm;
        if (originalActualWidth) mtextExtras.actualWidth = originalActualWidth * norm;
    }

    ctx.save();
    ctx.font = getCanvasFont(entity, styles);
    const reference = buildCadTextLayout({
        entity,
        styles,
        context: ctx,
        worldToScreenScale: 1,
        noWrap,
    });
    ctx.restore();

    entity.height = originalHeight;
    if (isMText) {
        if (originalWidth) entity.width = originalWidth;
        if (originalBoxHeight) mtextExtras.boxHeight = originalBoxHeight;
        if (originalActualWidth) mtextExtras.actualWidth = originalActualWidth;
    }
    if (!reference) return null;

    if (layoutCache.size >= MAX_LAYOUT_CACHE_ENTRIES) {
        layoutCache.clear();
    }
    layoutCache.set(key, { reference, referenceEffectiveHeight: effRef });

    return { layout: reference, scaleFactor: screenTextHeight / effRef };
};

export const clearTextLayoutCache = (): void => {
    layoutCache.clear();
};

/** 图纸切换 / 大量实体替换时统一清空（由 DxfViewer 在应用加载结果时调用）。 */
export const clearAllRenderCaches = (): void => {
    measureCache.clear();
    layoutCache.clear();
};

/** 缓存统计（诊断用）。 */
export const getRenderCacheStats = () => ({
    measureEntries: measureCache.size,
    layoutEntries: layoutCache.size,
});
