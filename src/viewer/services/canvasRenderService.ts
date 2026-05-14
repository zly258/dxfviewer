import { AnyEntity, EntityType, DxfLayer, DxfBlock, DxfStyle, Point2D, DxfInsert, HatchLoop, DxfText, DxfLineType, ViewPort } from '../../types';
import { CANVAS_THEME_COLORS, SELECTION_CONFIG, TEXT_RENDER_CONFIG, LEADER_RENDER_CONFIG, TABLE_EXTENTS_CONFIG, LINE_RENDER_CONFIG } from '../../shared/config/viewerConfig';
import { CAD_BY_BLOCK_COLOR, CAD_BY_LAYER_COLOR, CAD_DEFAULT_TEXT_HEIGHT, CAD_DEFAULT_TEXT_STYLE } from '../../shared/constants/cadConstants';
import { CanvasTheme, DrawingColorMode } from '../../shared/types/ui';
import { getAutoCadColor, AUTO_CAD_COLORS } from '../utils/colorUtils';
import { resolveEntityColor } from '../utils/entityColor';
import { sampleBulgeSegment } from '../../core/geometry/bulge';
import { sampleEllipsePoints, sampleHatchLoop, sampleSplinePoints } from '../../core/geometry/curveSampling';
import { resolveCadStrokeStyle } from '../../core/symbology/lineStyle';
import { getStyleFontFamily, FONT_STACKS, mapCadFontToWebFont, resolveCadTextFontProfile } from './fontService';
import { cleanCadText, cleanMText, estimateCadTextLayout, getCadTextAnchorPosition, getEffectiveTextHeight, splitCadFormattedText } from '../utils/textUtils';
import { buildCadTextLayout } from '../../core/text/TextLayoutEngine';

const SELECTION_COLOR = SELECTION_CONFIG.color;


const isPlaceholderAttributeText = (ent: DxfText): boolean => {
    if (ent.type !== EntityType.ATTRIB && ent.type !== EntityType.ATTDEF) return false;
    const tolerance = TEXT_RENDER_CONFIG.placeholderAttributeCoordinateTolerance;
    const isAtDefaultOrigin = Math.abs(ent.position?.x || 0) <= tolerance && Math.abs(ent.position?.y || 0) <= tolerance;
    const hasSuspiciousHeight = (ent.height || 0) >= TEXT_RENDER_CONFIG.placeholderAttributeHeightThreshold;
    return isAtDefaultOrigin && hasSuspiciousHeight;
};



/**
 * 获取画布字体样式
 */
const getCanvasFont = (ent: AnyEntity, styles: Record<string, DxfStyle> | undefined): string => {
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
        // \fFontName|...; 或 \fFontName; 甚至在某些优化情况下没有分号
        // 使用非贪婪匹配以避免捕获多个格式化块
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
                    fontFamily = FONT_STACKS.SONG
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

/**
 * 文本换行处理（支持中英文混合）
 */
const getMeasuredTextWidth = (ctx: CanvasRenderingContext2D, value: string): number => {
    if (!value) return 0;
    const metrics = ctx.measureText(value);
    const bboxWidth = Math.abs((metrics.actualBoundingBoxRight || 0) - (metrics.actualBoundingBoxLeft || 0));
    return Math.max(metrics.width, bboxWidth);
};

const wrapText = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] => {
    if (!maxWidth || maxWidth <= 0) return text.split('\n');
    const paragraphs = text.split('\n');
    const lines: string[] = [];
    
    paragraphs.forEach(paragraph => {
        if (!paragraph) {
            lines.push("");
            return;
        }

        let currentLine = "";
        
        // 逐字符遍历以支持中文换行
        for (let i = 0; i < paragraph.length; i++) {
            const char = paragraph[i];
            const testLine = currentLine + char;
            const width = getMeasuredTextWidth(ctx, testLine);
            
            if (width > maxWidth && currentLine.length > 0) {
                lines.push(currentLine);
                currentLine = char;
            } else {
                currentLine = testLine;
            }
        }
        lines.push(currentLine);
    });
    return lines;
};

// 为填充创建简单的对角线图案
const createHatchPattern = (ctx: CanvasRenderingContext2D, color: string) => {
    const canvas = document.createElement('canvas');
    canvas.width = 10;
    canvas.height = 10;
    const pCtx = canvas.getContext('2d');
    if (pCtx) {
        pCtx.strokeStyle = color;
        pCtx.lineWidth = 1;
        pCtx.beginPath();
        pCtx.moveTo(0, 10);
        pCtx.lineTo(10, 0);
        pCtx.stroke();
    }
    return ctx.createPattern(canvas, 'repeat');
};

interface RenderTransform {
    project: (p: Point2D) => Point2D;
    scale: number; // 到屏幕像素的累积缩放因子
    rotation: number; // 弧度单位的累积旋转
}

/**
 * 绘制填充环
 */
const drawHatchLoop = (ctx: CanvasRenderingContext2D, loop: HatchLoop, transform: RenderTransform) => {
    const points = sampleHatchLoop(loop);
    if (points.length === 0) return;
    const start = transform.project(points[0]);
    ctx.moveTo(start.x, start.y);
    for (let index = 1; index < points.length; index++) {
        const point = transform.project(points[index]);
        ctx.lineTo(point.x, point.y);
    }
    ctx.closePath();
};

/**
 * 绘制多段线
 */
const drawPolyline = (ctx: CanvasRenderingContext2D, points: Point2D[], bulges: number[] | undefined, closed: boolean, transform: RenderTransform) => {
    if (points.length < 1) return;
    const { project, scale } = transform;
    const start = project(points[0]);
    ctx.moveTo(start.x, start.y);
    for (let i = 0; i < (closed ? points.length : points.length - 1); i++) {
        const p1 = points[i];
        const p2 = points[(i + 1) % points.length];
        const bulge = bulges ? (bulges[i] || 0) : 0;
        const sP2 = project(p2);
        
        if (Math.abs(bulge) < 1e-6) {
            ctx.lineTo(sP2.x, sP2.y);
        } else {
            const arcPoints = sampleBulgeSegment(p1, p2, bulge);
            for (let index = 1; index < arcPoints.length; index++) {
                const point = project(arcPoints[index]);
                ctx.lineTo(point.x, point.y);
            }
        }
    }
    if (closed) ctx.closePath();
};

/**
 * 将实体渲染到 Canvas
 */
export const renderEntitiesToCanvas = (
    ctx: CanvasRenderingContext2D,
    entities: AnyEntity[],
    layers: Record<string, DxfLayer>,
    blocks: Record<string, DxfBlock>,
    styles: Record<string, DxfStyle>,
    lineTypes: Record<string, DxfLineType>,
    ltScale: number,
    viewPort: ViewPort,
    selectedIds: Set<string>,
    width: number,
    height: number,
    theme: CanvasTheme,
    drawingColorMode: DrawingColorMode = 'original',
    overlayExtents?: { min: Point2D, max: Point2D } | null
) => {
    // 使用背景颜色清除画布
    ctx.fillStyle = CANVAS_THEME_COLORS[theme];
    ctx.fillRect(0, 0, width, height);

    const safeZoom = isNaN(viewPort.zoom) || viewPort.zoom === 0 ? 1 : viewPort.zoom;
    const safeTargetX = isNaN(viewPort.targetX) ? 0 : viewPort.targetX;
    const safeTargetY = isNaN(viewPort.targetY) ? 0 : viewPort.targetY;

    const transform: RenderTransform = {
        project: (p: Point2D) => ({
            x: (p.x - safeTargetX) * safeZoom + width / 2,
            y: height / 2 - (p.y - safeTargetY) * safeZoom
        }),
        scale: safeZoom,
        rotation: 0
    };

    // 计算世界坐标系中的视口边界，用于剔除 (Culling)
    const worldLeft = (0 - width / 2) / safeZoom + safeTargetX;
    const worldRight = (width - width / 2) / safeZoom + safeTargetX;
    const worldTop = (0 - height / 2) / (-safeZoom) + safeTargetY;
    const worldBottom = (height - height / 2) / (-safeZoom) + safeTargetY;

    const vMinX = Math.min(worldLeft, worldRight);
    const vMaxX = Math.max(worldLeft, worldRight);
    const vMinY = Math.min(worldTop, worldBottom);
    const vMaxY = Math.max(worldTop, worldBottom);

    const entityByHandle = new Map<string, AnyEntity>();
    entities.forEach(entity => {
        if (entity.handle) entityByHandle.set(entity.handle, entity);
    });


    const normalizeMLeaderVector = (vector: Point2D | undefined, fallbackSign: number): Point2D => {
        if (vector && Number.isFinite(vector.x) && Number.isFinite(vector.y)) {
            const length = Math.hypot(vector.x, vector.y);
            if (length > 1e-9) return { x: vector.x / length, y: vector.y / length };
        }
        return { x: fallbackSign >= 0 ? 1 : -1, y: 0 };
    };

    const getMLeaderTerminalPoint = (ent: any): Point2D | null => {
        const line = (ent.leaderLines || []).find((items: Point2D[]) => items.length > 0);
        if (!line) return ent.textPosition || null;
        const last = line[line.length - 1];
        if (!ent.enableDogleg) return last;
        const prev = line.length > 1 ? line[line.length - 2] : null;
        const fallbackSign = ent.textPosition ? (ent.textPosition.x >= last.x ? 1 : -1) : (prev && last.x < prev.x ? -1 : 1);
        const direction = normalizeMLeaderVector(ent.doglegVector, fallbackSign);
        const length = Math.max(0, ent.doglegLength || LEADER_RENDER_CONFIG.defaultMLeaderDoglegLength);
        return { x: last.x + direction.x * length, y: last.y + direction.y * length };
    };

    const getMLeaderTextPosition = (ent: any): Point2D | null => {
        if (ent.textPosition) return ent.textPosition;
        const terminal = getMLeaderTerminalPoint(ent);
        if (!terminal) return null;
        const direction = normalizeMLeaderVector(ent.doglegVector, 1);
        return {
            x: terminal.x + direction.x * LEADER_RENDER_CONFIG.mleaderTextGapFactor,
            y: terminal.y + direction.y * LEADER_RENDER_CONFIG.mleaderTextGapFactor,
        };
    };

    const getMLeaderTextAttachment = (ent: any, textPosition: Point2D): number => {
        if (ent.textAttachment && ent.textAttachment >= 1 && ent.textAttachment <= 9) return ent.textAttachment;
        const terminal = getMLeaderTerminalPoint(ent);
        if (!terminal) return 4;
        return textPosition.x >= terminal.x ? 4 : 6;
    };

    const drawArrowHead = (tip: Point2D, next: Point2D, sizeWorld?: number) => {
        const p1 = transform.project(tip);
        const p2 = transform.project(next);
        const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
        const size = Math.max(LEADER_RENDER_CONFIG.arrowSizeFactor * transform.scale, (sizeWorld || 0) * transform.scale);
        const a1 = angle + LEADER_RENDER_CONFIG.arrowHalfAngleRadians;
        const a2 = angle - LEADER_RENDER_CONFIG.arrowHalfAngleRadians;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p1.x + Math.cos(a1) * size, p1.y + Math.sin(a1) * size);
        ctx.lineTo(p1.x + Math.cos(a2) * size, p1.y + Math.sin(a2) * size);
        ctx.closePath();
        ctx.fill();
    };

    const getUnderlineOffset = (baseline: CanvasTextBaseline, textHeightPixels: number) => {
        if (baseline === 'top' || baseline === 'hanging') {
            return textHeightPixels * TEXT_RENDER_CONFIG.underlineTopBaselineFactor;
        }
        if (baseline === 'middle') {
            return textHeightPixels * TEXT_RENDER_CONFIG.underlineMiddleBaselineFactor;
        }
        return textHeightPixels * TEXT_RENDER_CONFIG.underlineAlphabeticBaselineFactor;
    };

    const measureTextWidth = (value: string) => getMeasuredTextWidth(ctx, value);

    const drawFormattedSegmentsLine = (segments: ReturnType<typeof splitCadFormattedText>, fallbackText: string, xOffset: number, y: number, align: CanvasTextAlign, baseline: CanvasTextBaseline, textHeightPixels: number) => {
        const fallbackSegments = fallbackText ? [{ text: fallbackText, underline: false }] : [];
        const drawSegments = (segments.length > 0 ? segments : fallbackSegments).filter(segment => segment.text.length > 0);
        if (drawSegments.length === 0) return;

        const segmentWidths = drawSegments.map(segment => measureTextWidth(segment.text));
        const totalWidth = segmentWidths.reduce((sum, width) => sum + width, 0);
        let x = xOffset;
        if (align === 'center') x -= totalWidth / 2;
        else if (align === 'right' || align === 'end') x -= totalWidth;

        const previousLineWidth = ctx.lineWidth;
        const previousAlign = ctx.textAlign;
        const previousBaseline = ctx.textBaseline;
        ctx.textAlign = 'left';
        ctx.textBaseline = baseline;
        ctx.lineWidth = Math.max(previousLineWidth, textHeightPixels * TEXT_RENDER_CONFIG.underlineLineWidthFactor);

        drawSegments.forEach((segment, index) => {
            const segmentWidth = segmentWidths[index];
            ctx.fillText(segment.text, x, y);
            if (segment.underline) {
                const underlineY = y + getUnderlineOffset(baseline, textHeightPixels);
                ctx.beginPath();
                ctx.moveTo(x, underlineY);
                ctx.lineTo(x + segmentWidth, underlineY);
                ctx.stroke();
            }
            x += segmentWidth;
        });

        ctx.textAlign = previousAlign;
        ctx.textBaseline = previousBaseline;
        ctx.lineWidth = previousLineWidth;
    };

    const drawFormattedTextLine = (rawText: string, fallbackText: string, xOffset: number, y: number, align: CanvasTextAlign, baseline: CanvasTextBaseline, textHeightPixels: number) => {
        drawFormattedSegmentsLine(splitCadFormattedText(rawText), fallbackText, xOffset, y, align, baseline, textHeightPixels);
    };

    const drawEntity = (ent: AnyEntity, transform: RenderTransform, parentLayerName?: string, parentColor?: string, parentSelected: boolean = false, depth: number = 0, noMTextWrap: boolean = false) => {
        if (ent.visible === false || depth > 20) return;

        // 剔除 (Culling)：检查实体范围是否与视口重叠
        // 递归深度为 0 表示顶层实体，通常只有顶层实体具有预计算的包围盒
        if (depth === 0 && ent.extents) {
            if (ent.extents.max.x < vMinX || ent.extents.min.x > vMaxX ||
                ent.extents.max.y < vMinY || ent.extents.min.y > vMaxY) {
                return;
            }
        }

        const layerName = (ent.layer === '0' && parentLayerName) ? parentLayerName : ent.layer;
        const layer = layers[layerName];
        if (layer && layer.isVisible === false) return;

        const isSelected = selectedIds.has(ent.id) || parentSelected;
        const color = isSelected ? SELECTION_COLOR : resolveEntityColor(ent, layer, parentColor, drawingColorMode, theme);
        
        ctx.strokeStyle = color;
        ctx.fillStyle = color;

        let strokeStyle = resolveCadStrokeStyle({
            entity: ent,
            layer,
            parentLineType: undefined,
            parentLineweight: undefined,
            lineTypes,
            globalLineTypeScale: ltScale,
            viewScale: Math.abs(transform.scale),
            isSelected,
        });

        if ((ent as any).constantWidth !== undefined && (ent as any).constantWidth > 0) {
            const maxScreenPixels = isSelected ? LINE_RENDER_CONFIG.selectedMaximumScreenLineWidth : LINE_RENDER_CONFIG.maximumScreenLineWidth;
            strokeStyle = {
                ...strokeStyle,
                lineWidth: Math.max(
                    LINE_RENDER_CONFIG.minimumScreenLineWidth,
                    Math.min((ent as any).constantWidth * Math.abs(transform.scale), maxScreenPixels),
                ),
            };
        }

        ctx.lineWidth = strokeStyle.lineWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.setLineDash(strokeStyle.dashPattern);

        switch (ent.type) {
            case EntityType.LINE: {
                const s = transform.project(ent.start);
                const e = transform.project(ent.end);
                ctx.beginPath();
                ctx.moveTo(s.x, s.y);
                ctx.lineTo(e.x, e.y);
                ctx.stroke();
                break;
            }
            case EntityType.RAY: {
                const diag = Math.sqrt(Math.pow(width, 2) + Math.pow(height, 2));
                const infiniteDist = diag * 2; 
                
                const s = transform.project(ent.basePoint);
                // 射线方向需要根据 Y 轴翻转进行调整
                const farPoint = {
                    x: s.x + ent.direction.x * infiniteDist,
                    y: s.y - ent.direction.y * infiniteDist
                };
                ctx.beginPath();
                ctx.moveTo(s.x, s.y);
                ctx.lineTo(farPoint.x, farPoint.y);
                ctx.stroke();
                break;
            }
            case EntityType.XLINE: {
                const diag = Math.sqrt(Math.pow(width, 2) + Math.pow(height, 2));
                const infiniteDist = diag * 2;

                const s = transform.project(ent.basePoint);
                // 构造两个远点以实现无限延伸的效果
                const p1 = {
                    x: s.x - ent.direction.x * infiniteDist,
                    y: s.y + ent.direction.y * infiniteDist
                };
                const p2 = {
                    x: s.x + ent.direction.x * infiniteDist,
                    y: s.y - ent.direction.y * infiniteDist
                };
                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.stroke();
                break;
            }
            case EntityType.POINT: {
                const p = transform.project(ent.position);
                ctx.beginPath();
                ctx.arc(p.x, p.y, 2, 0, 2*Math.PI);
                ctx.fill();
                break;
            }
            case EntityType.CIRCLE: {
                const c = transform.project(ent.center);
                ctx.beginPath();
                ctx.arc(c.x, c.y, ent.radius * transform.scale, 0, 2 * Math.PI);
                ctx.stroke();
                break;
            }
            case EntityType.ARC: {
                const c = transform.project(ent.center);
                const isCcw = ent.isCounterClockwise !== false;
                let startRad = (ent.startAngle || 0) * Math.PI / 180;
                let endRad = (ent.endAngle || 0) * Math.PI / 180;
                
                ctx.beginPath();
                // 屏幕空间 Y 轴翻转，因此我们需要取反角度并交换逆时针方向
                ctx.arc(c.x, c.y, ent.radius * transform.scale, -startRad, -endRad, isCcw);
                ctx.stroke();
                break;
            }
            case EntityType.ELLIPSE: {
                const ellipsePoints = sampleEllipsePoints(
                    ent.center,
                    ent.majorAxis,
                    ent.ratio,
                    ent.startParam,
                    ent.endParam,
                    (ent.extrusion?.z || 1) >= 0,
                );
                if (ellipsePoints.length > 1) {
                    ctx.beginPath();
                    const start = transform.project(ellipsePoints[0]);
                    ctx.moveTo(start.x, start.y);
                    for (let index = 1; index < ellipsePoints.length; index++) {
                        const point = transform.project(ellipsePoints[index]);
                        ctx.lineTo(point.x, point.y);
                    }
                    ctx.stroke();
                }
                break;
            }
            case EntityType.LWPOLYLINE:
            case EntityType.POLYLINE:
                if (ent.points.length > 1) {
                    ctx.beginPath();
                    drawPolyline(ctx, ent.points, ent.bulges, ent.closed, transform);
                    ctx.stroke();
                }
                break;
            case EntityType.MLINE:
                if (ent.vertices.length > 1) {
                    ctx.beginPath();
                    ent.vertices.forEach((point, index) => {
                        const screenPoint = transform.project(point);
                        if (index === 0) ctx.moveTo(screenPoint.x, screenPoint.y);
                        else ctx.lineTo(screenPoint.x, screenPoint.y);
                    });
                    if (ent.closed) ctx.closePath();
                    ctx.stroke();
                }
                break;
            case EntityType.SPLINE: {
                const splinePoints = ent.calculatedPoints && ent.calculatedPoints.length > 0
                    ? ent.calculatedPoints
                    : ent.fitPoints && ent.fitPoints.length > 1
                        ? ent.fitPoints
                        : sampleSplinePoints(ent.controlPoints || [], ent.degree || 3, ent.knots, ent.weights);
                if (splinePoints.length > 1) {
                    ctx.beginPath();
                    const start = transform.project(splinePoints[0]);
                    ctx.moveTo(start.x, start.y);
                    for (let i = 1; i < splinePoints.length; i++) {
                        const point = transform.project(splinePoints[i]);
                        ctx.lineTo(point.x, point.y);
                    }
                    ctx.stroke();
                }
                break;
            }
            case EntityType.TEXT:
            case EntityType.MTEXT:
            case EntityType.ATTRIB:
            case EntityType.ATTDEF: {
                if (isPlaceholderAttributeText(ent)) break;

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

                const originalHeight = ent.height;
                ent.height = getEffectiveTextHeight(ent, styles) * transform.scale;
                ctx.font = getCanvasFont(ent, styles);
                ent.height = originalHeight;

                const layout = buildCadTextLayout({
                    entity: ent,
                    styles,
                    context: ctx,
                    worldToScreenScale: transform.scale,
                    noWrap: noMTextWrap,
                });
                if (!layout) {
                    ctx.restore();
                    break;
                }

                if (layout.visualScreenHeight < TEXT_RENDER_CONFIG.tinyTextPixelHeight && !isSelected) {
                    ctx.scale(layout.horizontalScale * layout.generationScale.x, layout.generationScale.y);
                    if (layout.isMText) {
                        ctx.fillRect(layout.boxLeft, layout.boxTop, Math.max(layout.blockWidth, layout.visualScreenHeight), Math.max(layout.blockHeight, layout.visualScreenHeight));
                    } else {
                        const width = Math.max(layout.blockWidth, layout.visualScreenHeight);
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
                    break;
                }

                if (layout.isMText) {
                    ctx.scale(layout.horizontalScale * layout.generationScale.x, layout.generationScale.y);
                    ctx.textAlign = layout.align;
                    ctx.textBaseline = layout.baseline;

                    if ((ent as any).bgFill) {
                        ctx.save();
                        ctx.fillStyle = ((ent as any).bgColor !== undefined && (ent as any).bgColor !== CAD_BY_LAYER_COLOR)
                            ? getAutoCadColor((ent as any).bgColor)
                            : CANVAS_THEME_COLORS[theme];
                        const bgPadding = layout.visualScreenHeight * TEXT_RENDER_CONFIG.mtextBackgroundPaddingFactor;
                        ctx.fillRect(layout.boxLeft - bgPadding, layout.boxTop - bgPadding, layout.blockWidth + bgPadding * 2, layout.blockHeight + bgPadding * 2);
                        ctx.restore();
                    }

                    layout.lines.forEach(line => {
                        if (line.formatted) {
                            drawFormattedSegmentsLine(line.formatted.segments, line.formatted.plainText, line.x, line.y, line.align, layout.baseline, layout.visualScreenHeight);
                        } else {
                            drawFormattedTextLine(line.text, line.text, line.x, line.y, line.align, layout.baseline, layout.visualScreenHeight);
                        }
                    });
                } else if ((hAlign === 3 || hAlign === 5) && ent.secondPosition) {
                    const dx = ent.secondPosition.x - ent.position.x;
                    const dy = ent.secondPosition.y - ent.position.y;
                    const targetWidth = Math.hypot(dx, dy) * transform.scale;
                    const measuredWidth = Math.max(layout.blockWidth, TEXT_RENDER_CONFIG.minimumMeasuredTextWidth);
                    if (targetWidth > 0 && measuredWidth > 0) {
                        const scale = targetWidth / measuredWidth;
                        ctx.scale(scale, hAlign === 3 ? scale : 1);
                    }
                    drawFormattedTextLine(ent.value || layout.plainText, layout.plainText, 0, 0, 'left', layout.baseline, layout.visualScreenHeight);
                } else {
                    let align = layout.align;
                    if (layout.generationScale.x < 0) {
                        if (align === 'left') align = 'right';
                        else if (align === 'right') align = 'left';
                    }
                    ctx.scale(layout.horizontalScale * layout.generationScale.x, layout.generationScale.y);
                    drawFormattedTextLine(ent.value || layout.plainText, layout.plainText, 0, 0, align, layout.baseline, layout.visualScreenHeight);
                }

                ctx.restore();
                break;
            }
            case EntityType.ACAD_TABLE:
            case EntityType.INSERT: {
                let block = blocks[ent.blockName];
                
                // 表格优先使用匿名块渲染；块缺失或为空时回退到网格和单元格文字绘制。

                const tableHasTextContent = ent.type === EntityType.ACAD_TABLE
                    && Array.isArray((ent as any).cells)
                    && (ent as any).cells.some((cell: unknown) => cleanMText(String(cell || '')).trim().length > 0);
                const shouldDrawTableFallback = ent.type === EntityType.ACAD_TABLE
                    && tableHasTextContent
                    && (!block || !block.entities || block.entities.length === 0);

                if (!block || shouldDrawTableFallback) {
                        if (ent.type === EntityType.ACAD_TABLE) {
                            if (!shouldDrawTableFallback) break;
                            const table = ent as any;
                const rowCount = Math.max(1, Math.min(TABLE_EXTENTS_CONFIG.maxFallbackRows, Math.floor(table.rowCount || 1)));
                const colCount = Math.max(1, Math.min(TABLE_EXTENTS_CONFIG.maxFallbackColumns, Math.floor(table.columnCount || 1)));
                const rowHeights = Array.isArray(table.rowHeights) ? table.rowHeights.slice(0, rowCount) : [];
                const colWidths = Array.isArray(table.colWidths) ? table.colWidths.slice(0, colCount) : [];
                const defaultRowH = Math.max(table.rowSpacing || TABLE_EXTENTS_CONFIG.defaultRowHeight, TABLE_EXTENTS_CONFIG.minRowHeight);
                const defaultColW = Math.max(table.columnSpacing || TABLE_EXTENTS_CONFIG.defaultColumnWidth, TABLE_EXTENTS_CONFIG.minColumnWidth);

                const scale = ent.scale || { x: 1, y: 1, z: 1 };
                
                ctx.save();
                const sPos = transform.project(ent.position);
                ctx.translate(sPos.x, sPos.y);
                const rotation = (table.rotation || 0) * Math.PI / 180;
                ctx.rotate(-rotation);
                
                ctx.beginPath();
                
                const sScale = transform.scale;
                
                // 计算行位置累计数组
                const rowY: number[] = [0];
                let currentY = 0;
                for (let i = 0; i < rowCount; i++) {
                    const h = (rowHeights[i] !== undefined ? rowHeights[i] : defaultRowH) * scale.y;
                    currentY -= Math.max(h, TEXT_RENDER_CONFIG.minimumTableCellSize);
                    rowY.push(currentY);
                }
                
                // 计算列位置累计数组
                const colX: number[] = [0];
                let currentX = 0;
                for (let j = 0; j < colCount; j++) {
                    const w = (colWidths[j] !== undefined ? colWidths[j] : defaultColW) * scale.x;
                    currentX += Math.max(w, TEXT_RENDER_CONFIG.minimumTableCellSize);
                    colX.push(currentX);
                }
                
                const totalWidth = colX[colCount];
                const totalHeight = -rowY[rowCount];
                const tableAspectRatio = totalWidth > 0 && totalHeight > 0 ? Math.max(totalWidth / totalHeight, totalHeight / totalWidth) : Infinity;
                if (totalWidth > TABLE_EXTENTS_CONFIG.maxFallbackTotalWidth
                    || totalHeight > TABLE_EXTENTS_CONFIG.maxFallbackTotalHeight
                    || tableAspectRatio > TABLE_EXTENTS_CONFIG.maxFallbackAspectRatio) {
                    ctx.restore();
                    break;
                }

                // 绘制横线
                for (let i = 0; i <= rowCount; i++) {
                    const y = rowY[i] * sScale;
                    ctx.moveTo(0, y);
                    ctx.lineTo(totalWidth * sScale, y);
                }
                // 绘制竖线
                for (let j = 0; j <= colCount; j++) {
                    const x = colX[j] * sScale;
                    ctx.moveTo(x, 0);
                    ctx.lineTo(x, rowY[rowCount] * sScale);
                }
                ctx.stroke();

                // 绘制单元格文字内容
                if (table.cells && table.cells.length > 0) {
                    ctx.fillStyle = color;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    
                    table.cells.forEach((cell: string, idx: number) => {
                        const r = Math.floor(idx / colCount);
                        const c = idx % colCount;
                        if (r < rowCount && c < colCount) {
                            const cleanedCell = cleanMText(cell);
                            
                            // 获取当前单元格的尺寸和中心点
                            const yTop = rowY[r];
                            const yBottom = rowY[r+1];
                            const xLeft = colX[c];
                            const xRight = colX[c+1];
                            
                            const cellH = Math.abs(yTop - yBottom);
                            const cellW = Math.abs(xRight - xLeft);
                            
                            const tx = (xLeft + cellW / 2) * sScale;
                            const tyCenter = (yTop + yBottom) / 2 * sScale;

                            const fontSize = (cellH * TEXT_RENDER_CONFIG.tableTextHeightFactor) * sScale;
                            ctx.font = `${fontSize}px sans-serif`;

                            const marginX = (cellW * TEXT_RENDER_CONFIG.tableTextHorizontalPaddingFactor) * sScale;
                            ctx.fillText(cleanedCell, tx, tyCenter, (cellW * sScale) - 2 * marginX);
                        }
                    });
                }
                ctx.restore();
                        }
                    break;
                }

                const scale = ent.scale || { x: 1, y: 1, z: 1 };
                const rotation = (ent.rotation || 0) * Math.PI / 180;
                const cosR = Math.cos(rotation);
                const sinR = Math.sin(rotation);
                
                // 为块内部实体创建嵌套变换对象
                const nestedTransform: RenderTransform = {
                    project: (p: Point2D) => {
                        // 1. 应用块内部坐标偏移（相对于块基点 basePoint）
                        const px = p.x - block.basePoint.x;
                        const py = p.y - block.basePoint.y;
                        
                        // 2. 应用缩放 (Scaling)
                        const sx = px * scale.x;
                        const sy = py * scale.y;
                        
                        // 3. 应用旋转 (Rotation)
                        // 对于 ACAD_TABLE，如果存在 Direction 向量，旋转已经由 Direction 决定
                        // 如果我们在解析时将 Direction 转换为了 rotation 属性，这里直接使用 rotation 即可
                        const rx = sx * cosR - sy * sinR;
                        const ry = sx * sinR + sy * cosR;
                        
                        // 4. 平移到块插入位置 (Insertion point)
                        const tx = rx + ent.position.x;
                        const ty = ry + ent.position.y;
                        
                        // 5. 应用顶层投影转换
                        return transform.project({ x: tx, y: ty });
                    },
                    scale: transform.scale * Math.abs(scale.x), // 简化处理：使用 X 轴缩放比例作为线宽缩放参考
                    rotation: transform.rotation + rotation
                };

                // 特殊处理 ACAD_TABLE 的变换
                // ACAD_TABLE 与 INSERT 在这里共享同一套块插入变换；
                // 如果表格块缺失/为空，前面的兜底自绘会负责渲染。

                const layerName = (ent.layer === '0' && parentLayerName) ? parentLayerName : ent.layer;
                // 递归绘制块中的所有实体
                const childNoWrap = noMTextWrap || ent.type === EntityType.ACAD_TABLE;
                block.entities.forEach(child => {
                    // 对于 INSERT 来说，内部定义的 ATTDEF（属性定义）只是模板，
                    // 原生软件中插入的块不显示 ATTDEF，而是显示其对应的独立 ATTRIB，因此在这里过滤掉以防止重叠。
                    if (child.type === EntityType.ATTDEF) return;
                    drawEntity(child, nestedTransform, layerName, color, isSelected, depth + 1, childNoWrap)
                });
                
                // 处理块中的属性 (ATTRIB)
                if ((ent as any).attributes) {
                    (ent as any).attributes.forEach((attr: AnyEntity) => {
                        const attrText = attr as DxfText;
                        // 过滤属性显示：只显示有值的，空的或等于标签的默认值不显示
                        const val = attrText.value ? attrText.value.trim() : '';
                        if (!val) return;
                        if (attrText.tag && val === attrText.tag) return;
                        
                        drawEntity(attr, transform, layerName, color, isSelected, depth + 1, childNoWrap);
                    });
                }
                break;
            }
            case EntityType.HATCH: {
                ctx.save();
                ctx.beginPath();
                ent.loops.forEach(loop => drawHatchLoop(ctx, loop, transform));
                ctx.closePath();
                
                if (ent.solid) {
                    ctx.fillStyle = color;
                    ctx.fill('evenodd');
                } else {
                    // 对于非实心填充，使用图案进行填充
                    const pattern = createHatchPattern(ctx, color);
                    if (pattern) {
                        ctx.fillStyle = pattern;
                        ctx.fill('evenodd');
                    }
                    ctx.stroke();
                }
                ctx.restore();
                break;
            }
            case EntityType.DIMENSION: {
                const block = blocks[ent.blockName];
                const layerName = (ent.layer === '0' && parentLayerName) ? parentLayerName : ent.layer;

                if (!block || !block.entities || block.entities.length === 0) {
                    const p1 = ent.linearP1 || ent.arcP1;
                    const p2 = ent.linearP2 || ent.arcP2;
                    if (p1 && p2) {
                        const sp1 = transform.project(p1);
                        const sp2 = transform.project(p2);
                        ctx.beginPath();
                        ctx.moveTo(sp1.x, sp1.y);
                        ctx.lineTo(sp2.x, sp2.y);
                        if (ent.definitionPoint) {
                            const dp = transform.project(ent.definitionPoint);
                            ctx.moveTo(sp1.x, sp1.y);
                            ctx.lineTo(dp.x, dp.y);
                            ctx.moveTo(sp2.x, sp2.y);
                            ctx.lineTo(dp.x, dp.y);
                        }
                        ctx.stroke();
                    }

                    const label = ent.text && ent.text !== '<>'
                        ? cleanCadText(ent.text)
                        : (Number.isFinite(ent.measurement) && ent.measurement !== 0 ? String(Math.round(ent.measurement * 1000) / 1000) : '');
                    if (label && ent.textMidPoint) {
                        const tp = transform.project(ent.textMidPoint);
                        ctx.save();
                        ctx.font = `${Math.max(10, CAD_DEFAULT_TEXT_HEIGHT * transform.scale)}px sans-serif`;
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillStyle = color;
                        ctx.fillText(label, tp.x, tp.y);
                        ctx.restore();
                    }
                    break;
                }

                const dp = ent.definitionPoint;
                let treatAsLocal = false;
                if (block.extents) {
                    const bw = block.extents.max.x - block.extents.min.x;
                    const bh = block.extents.max.y - block.extents.min.y;
                    const size = Math.max(Math.abs(bw), Math.abs(bh), 1);
                    const bc = { x: (block.extents.min.x + block.extents.max.x) / 2, y: (block.extents.min.y + block.extents.max.y) / 2 };
                    const dist = Math.hypot(bc.x - dp.x, bc.y - dp.y);
                    treatAsLocal = dist > size * 5;
                }

                const nestedTransform: RenderTransform = treatAsLocal
                    ? {
                        project: (p: Point2D) => {
                            const px = p.x - block.basePoint.x;
                            const py = p.y - block.basePoint.y;
                            return transform.project({ x: dp.x + px, y: dp.y + py });
                        },
                        scale: transform.scale,
                        rotation: transform.rotation
                    }
                    : {
                        project: (p: Point2D) => transform.project(p),
                        scale: transform.scale,
                        rotation: transform.rotation
                    };

                block.entities.forEach(child => drawEntity(child, nestedTransform, layerName, color, isSelected, depth + 1, noMTextWrap));
                break;
            }
            case EntityType.SOLID:
            case EntityType.THREEDFACE: {
                if (ent.points.length < 3) break;
                
                if (ent.type === EntityType.SOLID) {
                    ctx.beginPath();
                    const p0 = transform.project(ent.points[0]);
                    ctx.moveTo(p0.x, p0.y);
                    for (let i = 1; i < ent.points.length; i++) {
                        const p = transform.project(ent.points[i]);
                        ctx.lineTo(p.x, p.y);
                    }
                    ctx.closePath();
                    ctx.fill();
                    ctx.stroke();
                } else {
                    const flags = ent.edgeFlags || 0;
                    const pts = ent.points;
                    
                    ctx.beginPath();
                    for (let i = 0; i < pts.length; i++) {
                        const p1 = transform.project(pts[i]);
                        const p2 = transform.project(pts[(i + 1) % pts.length]);
                        const isVisible = (flags & (1 << i)) === 0;
                        
                        if (isVisible) {
                            ctx.moveTo(p1.x, p1.y);
                            ctx.lineTo(p2.x, p2.y);
                        }
                    }
                    ctx.stroke();
                }
                break;
            }
            case EntityType.MLEADER: {
                const leaderLines = (ent.leaderLines || []).filter((line: Point2D[]) => line.length > 1);
                if (leaderLines.length === 0 && !ent.text) break;

                leaderLines.forEach((line: Point2D[]) => {
                    ctx.beginPath();
                    line.forEach((point, index) => {
                        const screenPoint = transform.project(point);
                        if (index === 0) ctx.moveTo(screenPoint.x, screenPoint.y);
                        else ctx.lineTo(screenPoint.x, screenPoint.y);
                    });
                    if (ent.enableDogleg !== false) {
                        const terminal = getMLeaderTerminalPoint(ent);
                        if (terminal) {
                            const screenPoint = transform.project(terminal);
                            ctx.lineTo(screenPoint.x, screenPoint.y);
                        }
                    }
                    ctx.stroke();
                    drawArrowHead(line[0], line[1], ent.arrowSize);
                });

                const textPosition = getMLeaderTextPosition(ent);
                if (ent.text && textPosition) {
                    const textEntity: DxfText = {
                        ...ent,
                        id: `${ent.id}_text`,
                        type: EntityType.MTEXT,
                        position: textPosition,
                        value: ent.text,
                        height: ent.textHeight || LEADER_RENDER_CONFIG.defaultMLeaderTextHeight,
                        width: ent.textWidth || LEADER_RENDER_CONFIG.defaultMLeaderTextWidth,
                        attachmentPoint: getMLeaderTextAttachment(ent, textPosition),
                        styleName: ent.textStyleName,
                    };
                    drawEntity(textEntity, transform, layerName, color, isSelected, depth + 1, true);
                }
                break;
            }
            case EntityType.LEADER: {
                if (ent.points.length < 2) break;
                ctx.beginPath();
                const pts = ent.points;
                const p0 = transform.project(pts[0]);
                ctx.moveTo(p0.x, p0.y);
                pts.slice(1).forEach(p => {
                    const sp = transform.project(p);
                    ctx.lineTo(sp.x, sp.y);
                });
                
                // 绘制引线末端的折线 (Hook line)
                if (ent.hasHookLine) {
                     const last = pts[pts.length-1];
                     const prev = pts[pts.length-2];
                     const dx = last.x - prev.x;
                     let hookLen = LEADER_RENDER_CONFIG.defaultHookLength;
                     let dir = dx >= 0 ? 1 : -1;
                     const annotation = ent.annotationHandle ? entityByHandle.get(ent.annotationHandle) : undefined;
                     if (annotation?.extents) {
                         const annotationCenterX = (annotation.extents.min.x + annotation.extents.max.x) / 2;
                         dir = annotationCenterX >= last.x ? 1 : -1;
                         const targetX = dir > 0 ? annotation.extents.min.x : annotation.extents.max.x;
                         const gap = Math.abs(targetX - last.x);
                         hookLen = Math.max(0, gap - LEADER_RENDER_CONFIG.leaderAnnotationTextGapFactor);
                     }
                     
                     const sp = transform.project({ x: last.x + dir * hookLen, y: last.y });
                     ctx.lineTo(sp.x, sp.y);
                }
                ctx.stroke();

                // 绘制箭头 (Arrowhead)
                if (ent.arrowHeadFlag === 1) {
                    ctx.fillStyle = color;
                    drawArrowHead(pts[0], pts[1]);
                }
                break;
            }
        }
    };

    entities.forEach(ent => drawEntity(ent, transform, undefined, undefined, false, 0, false));

    if (overlayExtents) {
        const corners = [
            { x: overlayExtents.min.x, y: overlayExtents.min.y },
            { x: overlayExtents.max.x, y: overlayExtents.min.y },
            { x: overlayExtents.max.x, y: overlayExtents.max.y },
            { x: overlayExtents.min.x, y: overlayExtents.max.y }
        ].map(p => transform.project(p));

        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = theme === 'white' ? '#1e40af' : '#60a5fa';
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        ctx.lineTo(corners[1].x, corners[1].y);
        ctx.lineTo(corners[2].x, corners[2].y);
        ctx.lineTo(corners[3].x, corners[3].y);
        ctx.closePath();
        ctx.stroke();

        const cx = (overlayExtents.min.x + overlayExtents.max.x) / 2;
        const cy = (overlayExtents.min.y + overlayExtents.max.y) / 2;
        const c = transform.project({ x: cx, y: cy });
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(c.x - 6, c.y);
        ctx.lineTo(c.x + 6, c.y);
        ctx.moveTo(c.x, c.y - 6);
        ctx.lineTo(c.x, c.y + 6);
        ctx.stroke();
        ctx.restore();
    }
};

const distanceToLine = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
    const A = px - x1;
    const B = py - y1;
    const C = x2 - x1;
    const D = y2 - y1;
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;
    if (lenSq !== 0) param = dot / lenSq;
    let xx, yy;
    if (param < 0) {
        xx = x1;
        yy = y1;
    } else if (param > 1) {
        xx = x2;
        yy = y2;
    } else {
        xx = x1 + param * C;
        yy = y1 + param * D;
    }
    const dx = px - xx;
    const dy = py - yy;
    return Math.sqrt(dx * dx + dy * dy);
};

export const hitTest = (x: number, y: number, threshold: number, entities: AnyEntity[], blocks: Record<string, DxfBlock>, layers: Record<string, DxfLayer>, styles: Record<string, DxfStyle>): string | null => {
    // 块名称到使用它们的标注实体的映射，用于优先选择标注
    const blockToDimensionMap = new Map<string, string>();
    entities.forEach(ent => {
        if (ent.type === EntityType.DIMENSION && ent.blockName) {
            blockToDimensionMap.set(ent.blockName, ent.id);
        }
    });

    /**
     * 递归检查单个实体是否被点击
     */
    const checkEntity = (ent: AnyEntity, tx?: (p: Point2D) => Point2D, depth: number = 0): boolean => {
        if (ent.visible === false || depth > 20) return false;

        const layer = layers[ent.layer];
        if (layer && layer.isVisible === false) return false;

        const p = tx ? tx : (pt: Point2D) => pt;
        
        // 文字判定优化：增加额外的容差范围，解决点选偏差问题
        const isTextEntity = [EntityType.TEXT, EntityType.MTEXT, EntityType.ATTRIB, EntityType.ATTDEF].includes(ent.type);
        // 对于文字，使用文字选择阈值系数，使其更易选中
        const effectiveThreshold = isTextEntity ? (threshold * SELECTION_CONFIG.textThresholdMultiplier) : threshold;

        // 包围盒选择优化
        // 如果实体有预计算的包围盒，将其用于初步点击测试
        if (ent.extents) {
            let { min, max } = ent.extents;
            
            // 修复包围盒变换逻辑：
            // 如果存在变换（tx），我们需要将包围盒的四个角点都进行变换，然后计算变换后的 AABB
            // 注意：min 和 max 只是 AABB 的两个角点，不足以代表旋转后的矩形
            if (tx) {
                const corners = [
                    p({ x: min.x, y: min.y }),
                    p({ x: max.x, y: min.y }),
                    p({ x: max.x, y: max.y }),
                    p({ x: min.x, y: max.y })
                ];
                let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
                corners.forEach(c => {
                    if (c.x < bMinX) bMinX = c.x; if (c.x > bMaxX) bMaxX = c.x;
                    if (c.y < bMinY) bMinY = c.y; if (c.y > bMaxY) bMaxY = c.y;
                });
                min = { x: bMinX, y: bMinY };
                max = { x: bMaxX, y: bMaxY };
            }

            // 为包围盒增加较大的点击判定边距 (有效阈值的 1.2 倍)，确保边缘也能轻松点中
            const margin = effectiveThreshold * 1.2;
            const insideBox = x >= min.x - margin && x <= max.x + margin && 
                             y >= min.y - margin && y <= max.y + margin;
            
            if (!insideBox) return false;

            // 对于某些复杂的容器型实体或文字，包围盒点击测试已经足够且体验更好
            const isContainerOrText = [
                EntityType.TEXT, 
                EntityType.MTEXT, 
                EntityType.ATTRIB, 
                EntityType.ATTDEF,
                EntityType.HATCH
            ].includes(ent.type);

            if (isContainerOrText) return true;
        }

        // 其他实体的几何精确检查（或者没有包围盒的情况）
        if (ent.type === EntityType.LINE) {
            const s = p(ent.start), e = p(ent.end);
            return distanceToLine(x, y, s.x, s.y, e.x, e.y) < effectiveThreshold;
        } else if (ent.type === EntityType.RAY) {
            const s = p(ent.basePoint);
            const e = { x: s.x + ent.direction.x * 1000000, y: s.y + ent.direction.y * 1000000 };
            return distanceToLine(x, y, s.x, s.y, e.x, e.y) < effectiveThreshold;
        } else if (ent.type === EntityType.XLINE) {
            const s = p(ent.basePoint);
            const p1 = { x: s.x - ent.direction.x * 1000000, y: s.y - ent.direction.y * 1000000 };
            const p2 = { x: s.x + ent.direction.x * 1000000, y: s.y + ent.direction.y * 1000000 };
            return distanceToLine(x, y, p1.x, p1.y, p2.x, p2.y) < effectiveThreshold;
        } else if (ent.type === EntityType.CIRCLE) {
            const c = p(ent.center);
            const d = Math.sqrt(Math.pow(x - c.x, 2) + Math.pow(y - c.y, 2));
            return Math.abs(d - ent.radius) < effectiveThreshold;
        } else if (ent.type === EntityType.ARC) {
            const c = p(ent.center);
            const d = Math.sqrt(Math.pow(x - c.x, 2) + Math.pow(y - c.y, 2));
            if (Math.abs(d - ent.radius) < effectiveThreshold) {
                let angle = Math.atan2(y - c.y, x - c.x) * 180 / Math.PI;
                while (angle < 0) angle += 360;
                while (angle >= 360) angle -= 360;
                
                const isCcw = ent.isCounterClockwise !== false;
                let s = ent.startAngle;
                let e = ent.endAngle;
                while (s < 0) s += 360;
                while (s >= 360) s -= 360;
                while (e < 0) e += 360;
                while (e >= 360) e -= 360;

                if (!isCcw) {
                    const temp = s;
                    s = e;
                    e = temp;
                }
                
                return s > e ? (angle >= s || angle <= e) : (angle >= s && angle <= e);
            }
        } else if (ent.type === EntityType.LWPOLYLINE || ent.type === EntityType.POLYLINE) {
            const isFlipped = (ent.extrusion?.z || 1) < 0;
            for (let j = 0; j < (ent.closed ? ent.points.length : ent.points.length - 1); j++) {
                const p1 = p(ent.points[j]);
                const p2 = p(ent.points[(j + 1) % ent.points.length]);
                const bulge = ent.bulges ? (ent.bulges[j] || 0) : 0;
                
                if (Math.abs(bulge) < 1e-6) {
                    if (distanceToLine(x, y, p1.x, p1.y, p2.x, p2.y) < effectiveThreshold) return true;
                } else {
                    const dist = Math.sqrt((p2.x - p1.x)**2 + (p2.y - p1.y)**2);
                    if (dist > 1e-9) {
                        const theta = 4 * Math.atan(bulge);
                        const radius = Math.abs(dist / (2 * Math.sin(theta / 2)));
                        const cx = (p1.x + p2.x)/2 - (p2.y - p1.y)/2 * (1/Math.tan(2*Math.atan(bulge)));
                        const cy = (p1.y + p2.y)/2 + (p2.x - p1.x)/2 * (1/Math.tan(2*Math.atan(bulge)));
                        
                        const d = Math.sqrt(Math.pow(x - cx, 2) + Math.pow(y - cy, 2));
                        if (Math.abs(d - radius) < effectiveThreshold) {
                            let angle = Math.atan2(y - cy, x - cx);
                            let s = Math.atan2(p1.y - cy, p1.x - cx);
                            let e = Math.atan2(p2.y - cy, p2.x - cx);
                            
                            // 将角度规范化到 [0, 2PI)
                            const normalize = (a: number) => {
                                while (a < 0) a += Math.PI * 2;
                                while (a >= Math.PI * 2) a -= Math.PI * 2;
                                return a;
                            };
                            
                            angle = normalize(angle);
                            s = normalize(s);
                            e = normalize(e);
                            
                            let ccw = bulge > 0;
                            if (isFlipped) ccw = !ccw;
                            
                            if (!ccw) {
                                // 对于顺时针，交换起点/终点以使用逆时针逻辑
                                const temp = s;
                                s = e;
                                e = temp;
                            }
                            
                            if (s > e ? (angle >= s || angle <= e) : (angle >= s && angle <= e)) return true;
                        }
                    } else {
                        if (Math.sqrt((x - p1.x)**2 + (y - p1.y)**2) < effectiveThreshold) return true;
                    }
                }
            }
        } else if (ent.type === EntityType.SPLINE) {
             const points = sampleSplinePoints(ent.controlPoints || [], ent.degree || 3, ent.knots, ent.weights, 20);
             for (let j = 0; j < points.length - 1; j++) {
                const p1 = p(points[j]), p2 = p(points[j+1]);
                if (distanceToLine(x, y, p1.x, p1.y, p2.x, p2.y) < effectiveThreshold) return true;
            }
        } else if (ent.type === EntityType.POINT) {
            const pos = p(ent.position);
            return Math.sqrt(Math.pow(x - pos.x, 2) + Math.pow(y - pos.y, 2)) < effectiveThreshold;
        } else if (ent.type === EntityType.LEADER) {
            for (let j = 0; j < ent.points.length - 1; j++) {
                const p1 = p(ent.points[j]), p2 = p(ent.points[j+1]);
                if (distanceToLine(x, y, p1.x, p1.y, p2.x, p2.y) < effectiveThreshold) return true;
            }
        } else if (ent.type === EntityType.ELLIPSE) {
            const c = p(ent.center);
            const rx = Math.sqrt(ent.majorAxis.x ** 2 + ent.majorAxis.y ** 2);
            const ry = rx * ent.ratio;
            const isFlipped = (ent.extrusion?.z || 1) < 0;
            
            const dx = x - c.x;
            const dy = y - c.y;
            const angle = Math.atan2(ent.majorAxis.y, ent.majorAxis.x);
            const cos = Math.cos(-angle), sin = Math.sin(-angle);
            const localX = dx * cos - dy * sin;
            const localY = dx * sin + dy * cos;
            const normDist = (localX * localX) / (rx * rx) + (localY * localY) / (ry * ry);
            
            if (Math.abs(Math.sqrt(normDist) - 1) < effectiveThreshold / Math.min(rx, ry)) {
                let param = Math.atan2(localY / ry, localX / rx);
                while (param < 0) param += Math.PI * 2;
                while (param >= Math.PI * 2) param -= Math.PI * 2;
                
                let s = ent.startParam || 0;
                let e = ent.endParam || (Math.PI * 2);
                if (isFlipped) {
                    const temp = s;
                    s = e;
                    e = temp;
                }
                return s > e ? (param >= s || param <= e) : (param >= s && param <= e);
            }
        } else if (ent.type === EntityType.INSERT || ent.type === EntityType.ACAD_TABLE) {
            const block = blocks[ent.blockName];
            if (!block) return false;
            
            const scale = ent.scale || { x: 1, y: 1, z: 1 };
            const rotation = (ent.rotation || 0) * Math.PI / 180;
            const cos = Math.cos(rotation), sin = Math.sin(rotation);
            
            const tx = (pt: Point2D) => {
                const bx = pt.x - block.basePoint.x;
                const by = pt.y - block.basePoint.y;
                const sx = bx * scale.x;
                const sy = by * scale.y;
                return {
                    x: ent.position.x + sx * cos - sy * sin,
                    y: ent.position.y + sx * sin + sy * cos
                };
            };
            
            for (const child of block.entities) {
                if (checkEntity(child, tx, depth + 1)) return true;
            }
            if ((ent as any).attributes) {
                for (const attr of (ent as any).attributes) {
                    if (checkEntity(attr, undefined, depth + 1)) return true;
                }
            }
        } else if (ent.type === EntityType.DIMENSION) {
            const block = blocks[ent.blockName];
            if (!block) return false;

            const dp = (ent as any).definitionPoint || { x: 0, y: 0 };
            let treatAsLocal = false;
            if (block.extents) {
                const bw = block.extents.max.x - block.extents.min.x;
                const bh = block.extents.max.y - block.extents.min.y;
                const size = Math.max(Math.abs(bw), Math.abs(bh), 1);
                const bc = { x: (block.extents.min.x + block.extents.max.x) / 2, y: (block.extents.min.y + block.extents.max.y) / 2 };
                const dist = Math.hypot(bc.x - dp.x, bc.y - dp.y);
                treatAsLocal = dist > size * 5;
            }

            const tx = treatAsLocal
                ? (pt: Point2D) => ({ x: dp.x + (pt.x - block.basePoint.x), y: dp.y + (pt.y - block.basePoint.y) })
                : (pt: Point2D) => pt;

            for (const child of block.entities) {
                if (checkEntity(child, tx, depth + 1)) return true;
            }
        }
        return false;
    };

        // 首先检查标注 (Dimension)，以便将其作为一个整体进行选择，而不是选中其中的线或文字
    for (const ent of entities) {
        if (ent.type === EntityType.DIMENSION) {
            if (checkEntity(ent)) return ent.id;
        }
    }

    // 然后逆序检查其他实体（后绘制的实体通常在顶层，更容易被点中）
    for (let i = entities.length - 1; i >= 0; i--) {
        const ent = entities[i];
        if (ent.type !== EntityType.DIMENSION && checkEntity(ent)) return ent.id;
    }
    return null;
};

/**
 * 矩形框选测试
 * @param box 选择框范围
 * @param isCrossing 是否为交叉选择模式（true: 交叉选择/绿色框，选中相交或包含的; false: 窗口选择/蓝色框，仅选中完全包含的）
 */
export const hitTestBox = (
    box: {x1:number, y1:number, x2:number, y2:number}, 
    entities: AnyEntity[], 
    layers: Record<string, DxfLayer>, 
    blocks: Record<string, DxfBlock> = {},
    isCrossing: boolean = false
): Set<string> => {
    const results = new Set<string>();
    const minX = Math.min(box.x1, box.x2), maxX = Math.max(box.x1, box.x2);
    const minY = Math.min(box.y1, box.y2), maxY = Math.max(box.y1, box.y2);

    const overlaps = (ext: { min: Point2D, max: Point2D }) => !(ext.max.x < minX || ext.min.x > maxX || ext.max.y < minY || ext.min.y > maxY);
    const contained = (ext: { min: Point2D, max: Point2D }) => ext.min.x >= minX && ext.max.x <= maxX && ext.min.y >= minY && ext.max.y <= maxY;
    const transformExtents = (ext: { min: Point2D, max: Point2D }, tx: (p: Point2D) => Point2D) => {
        const corners = [
            tx({ x: ext.min.x, y: ext.min.y }),
            tx({ x: ext.max.x, y: ext.min.y }),
            tx({ x: ext.max.x, y: ext.max.y }),
            tx({ x: ext.min.x, y: ext.max.y })
        ];
        let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
        corners.forEach(c => {
            if (c.x < bMinX) bMinX = c.x; if (c.x > bMaxX) bMaxX = c.x;
            if (c.y < bMinY) bMinY = c.y; if (c.y > bMaxY) bMaxY = c.y;
        });
        return { min: { x: bMinX, y: bMinY }, max: { x: bMaxX, y: bMaxY } };
    };

    const checkEntityBox = (ent: AnyEntity, tx?: (p: Point2D) => Point2D, depth: number = 0): boolean => {
        if (ent.visible === false || depth > 20) return isCrossing ? false : true;
        const layer = layers[ent.layer];
        if (layer && layer.isVisible === false) return isCrossing ? false : true;

        const ext = ent.extents ? (tx ? transformExtents(ent.extents, tx) : ent.extents) : null;
        if (ext) {
            if (isCrossing) {
                if (!overlaps(ext)) return false;
            } else {
                if (!contained(ext)) return false;
            }
        } else if (ent.type === EntityType.POINT && ent.position) {
            const p = tx ? tx(ent.position) : ent.position;
            const inside = p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
            return isCrossing ? inside : inside;
        }

        if (ent.type === EntityType.INSERT || ent.type === EntityType.ACAD_TABLE) {
            const block = blocks[ent.blockName];
            if (!block) return ext ? (isCrossing ? overlaps(ext) : contained(ext)) : false;
            const scale = (ent as any).scale || { x: 1, y: 1, z: 1 };
            const rotation = ((ent as any).rotation || 0) * Math.PI / 180;
            const cos = Math.cos(rotation), sin = Math.sin(rotation);
            const baseTx = (pt: Point2D) => {
                const bx = pt.x - block.basePoint.x;
                const by = pt.y - block.basePoint.y;
                const sx = bx * scale.x;
                const sy = by * scale.y;
                const world = { x: (ent as any).position.x + sx * cos - sy * sin, y: (ent as any).position.y + sx * sin + sy * cos };
                return tx ? tx(world) : world;
            };
            if (isCrossing) {
                for (const child of block.entities) {
                    if (checkEntityBox(child, baseTx, depth + 1)) return true;
                }
                if ((ent as any).attributes) {
                    for (const attr of (ent as any).attributes) {
                        if (checkEntityBox(attr, tx, depth + 1)) return true;
                    }
                }
                return false;
            }
            for (const child of block.entities) {
                if (!checkEntityBox(child, baseTx, depth + 1)) return false;
            }
            if ((ent as any).attributes) {
                for (const attr of (ent as any).attributes) {
                    if (!checkEntityBox(attr, tx, depth + 1)) return false;
                }
            }
            return true;
        }

        if (ent.type === EntityType.DIMENSION) {
            const block = blocks[ent.blockName];
            if (!block) return ext ? (isCrossing ? overlaps(ext) : contained(ext)) : false;
            const dp = (ent as any).definitionPoint || { x: 0, y: 0 };
            let treatAsLocal = false;
            if (block.extents) {
                const bw = block.extents.max.x - block.extents.min.x;
                const bh = block.extents.max.y - block.extents.min.y;
                const size = Math.max(Math.abs(bw), Math.abs(bh), 1);
                const bc = { x: (block.extents.min.x + block.extents.max.x) / 2, y: (block.extents.min.y + block.extents.max.y) / 2 };
                const dist = Math.hypot(bc.x - dp.x, bc.y - dp.y);
                treatAsLocal = dist > size * 5;
            }
            const baseTx = treatAsLocal
                ? (pt: Point2D) => {
                    const world = { x: dp.x + (pt.x - block.basePoint.x), y: dp.y + (pt.y - block.basePoint.y) };
                    return tx ? tx(world) : world;
                }
                : (pt: Point2D) => (tx ? tx(pt) : pt);

            if (isCrossing) {
                for (const child of block.entities) {
                    if (checkEntityBox(child, baseTx, depth + 1)) return true;
                }
                return false;
            }
            for (const child of block.entities) {
                if (!checkEntityBox(child, baseTx, depth + 1)) return false;
            }
            return true;
        }

        return ext ? (isCrossing ? overlaps(ext) : contained(ext)) : false;
    };

    entities.forEach(ent => {
        if (checkEntityBox(ent)) results.add(ent.id);
    });
    return results;
};
