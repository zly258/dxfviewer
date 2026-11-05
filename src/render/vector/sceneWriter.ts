/**
 * 矢量场景写入器：遍历 DXF 实体，向「矢量绘制上下文」输出绘制指令。
 *
 * 这是 SVG / PDF 矢量导出的唯一场景遍历实现。`VectorContext` 与
 * CanvasRenderingContext2D 结构兼容（历史设计），SVG 后端把指令序列化为
 * <path>/<text>，PDF 后端输出内容流算子——两者都不经过任何 Canvas 光栅化。
 *
 * 注意：交互渲染已全部由 WebGL 引擎（`render/webgl`）承担；本模块只服务
 * 矢量导出，不要在这里加交互特性（LOD/快照/拾取等）。
 */

import type { VectorContext } from './context';
import {
  AnyEntity,
  EntityType,
  DxfLayer,
  DxfBlock,
  DxfStyle,
  DxfLineType,
  Point2D,
  ViewPort,
  CanvasTheme,
  DrawingColorMode
} from '@/types';
import {
  CANVAS_THEME_COLORS,
  SELECTION_CONFIG,
  LINE_RENDER_CONFIG
} from '@/config/viewerConfig';
import { resolveEntityColor } from '@/utils/entityColor';
import { resolveCadStrokeStyle } from '@/utils/lineStyle';

// 导入图元具体的矢量绘制函数
import {
  RenderTransform,
  drawLine,
  drawRay,
  drawXLine,
  drawPoint,
  drawCircle,
  drawArc,
  drawEllipse,
  drawPolyline,
  drawMLine,
  drawSpline,
  drawHelix,
  drawViewport,
  drawShape
} from './entities/geometryRenderer';
import { drawTextEntity } from './entities/textRenderer';
import { drawInsertOrTable, drawDimension } from './entities/blockRenderer';
import {
  drawHatch,
  drawSolid,
  drawLeader,
  drawMLeader,
  drawImage,
  drawWipeout,
  drawTolerance
} from './entities/annotationRenderer';
import { SceneIndex } from '@/render/picking/sceneIndex';

const SELECTION_COLOR = SELECTION_CONFIG.selectionBorderColor;

/** Canvas 状态去重追踪器：相邻实体共享样式时跳过重复赋值（SVG 输出更紧凑）。 */
class VectorStateTracker {
    private strokeStyleValue: string | null = null;
    private fillStyleValue: string | null = null;
    private lineWidthValue = -1;
    private dashSignature: string | null = null;

    constructor(private readonly ctx: VectorContext) {}

    reset(): void {
        this.strokeStyleValue = null;
        this.fillStyleValue = null;
        this.lineWidthValue = -1;
        this.dashSignature = null;
    }

    setStrokeStyle(value: string): void {
        if (this.strokeStyleValue !== value) {
            this.ctx.strokeStyle = value;
            this.strokeStyleValue = value;
        }
    }

    setFillStyle(value: string): void {
        if (this.fillStyleValue !== value) {
            this.ctx.fillStyle = value;
            this.fillStyleValue = value;
        }
    }

    setLineWidth(value: number): void {
        if (this.lineWidthValue !== value) {
            this.ctx.lineWidth = value;
            this.lineWidthValue = value;
        }
    }

    setLineDash(pattern: number[]): void {
        const signature = pattern.length === 0 ? '' : pattern.join(',');
        if (this.dashSignature !== signature) {
            this.ctx.setLineDash(pattern);
            this.dashSignature = signature;
        }
    }
}

/** 矢量写出参数。 */
export interface VectorSceneOptions {
    ctx: VectorContext;
    entities: AnyEntity[];
    /** 模型空间实体：渲染纸张空间布局时供视口投影使用（当前布局为模型空间时不传）。 */
    modelEntities?: AnyEntity[];
    layers: Record<string, DxfLayer>;
    blocks: Record<string, DxfBlock>;
    styles: Record<string, DxfStyle>;
    lineTypes: Record<string, DxfLineType>;
    ltScale: number;
    viewPort: ViewPort;
    width: number;
    height: number;
    theme: CanvasTheme;
    drawingColorMode?: DrawingColorMode;
    hiddenLayers?: Set<string>;
    /** 被用户临时隐藏的顶层实体 ID。 */
    hiddenEntityIds?: ReadonlySet<string>;
    /** 非空时，仅渲染集合内的顶层实体（隔离模式）。 */
    isolatedEntityIds?: ReadonlySet<string> | null;
    selectedIds?: Set<string>;
    sceneIndex?: SceneIndex;
    /**
     * 背景色覆盖：
     * - 省略/undefined：按主题色填充
     * - 显式字符串：用该颜色填充
     * - null：不填充（调用方自行绘制背景）
     */
    background?: string | null;
    /**
     * 线宽补偿系数：导出画布大于 1280 基准时按比例放大线宽，
     * 保证高分辨率输出里细线视觉粗细一致。
     */
    lineWidthScale?: number;
}

/**
 * 创建可分块续写的写出会话（矢量导出为同步一次性写完，会话仅为复用遍历逻辑）。
 */
export const createVectorRenderSession = ({
    ctx,
    entities,
    layers,
    blocks,
    styles,
    lineTypes,
    ltScale,
    viewPort,
    width,
    height,
    theme,
    drawingColorMode = 'original',
    hiddenLayers = new Set<string>(),
    hiddenEntityIds = new Set<string>(),
    isolatedEntityIds = null,
    selectedIds = new Set<string>(),
    sceneIndex,
    modelEntities,
    background,
    lineWidthScale = 1,
}: VectorSceneOptions): VectorRenderSession => {
    if (background !== null) {
        ctx.fillStyle = background ?? CANVAS_THEME_COLORS[theme];
        ctx.fillRect(0, 0, width, height);
    }

    const stateTracker = new VectorStateTracker(ctx);
    stateTracker.reset();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const safeZoom = Math.max(Math.abs(viewPort.zoom), Number.MIN_VALUE);
    const vMinX = viewPort.targetX - width / 2 / safeZoom;
    const vMaxX = viewPort.targetX + width / 2 / safeZoom;
    const vMinY = viewPort.targetY - height / 2 / safeZoom;
    const vMaxY = viewPort.targetY + height / 2 / safeZoom;

    const transform: RenderTransform = {
        project: (p: Point2D) => ({
            x: (p.x - viewPort.targetX) * viewPort.zoom + width / 2,
            y: -(p.y - viewPort.targetY) * viewPort.zoom + height / 2,
        }),
        scale: viewPort.zoom,
        rotation: 0,
    };

    const entityByHandle = sceneIndex?.entityByHandle || new Map<string, AnyEntity>();
    if (!sceneIndex) {
        entities.forEach(entity => {
            if (entity.handle) entityByHandle.set(entity.handle, entity);
        });
    }

    const viewportModelEntities = modelEntities && modelEntities !== entities ? modelEntities : undefined;

    const drawEntity = (
        ent: AnyEntity,
        transform: RenderTransform,
        parentLayerName?: string,
        parentColor?: string,
        parentSelected: boolean = false,
        depth: number = 0,
        noMTextWrap: boolean = false
    ) => {
        const isTopLevelHidden = depth === 0
            && (hiddenEntityIds.has(ent.id) || (isolatedEntityIds && !isolatedEntityIds.has(ent.id)));
        if (ent.visible === false || isTopLevelHidden || depth > SELECTION_CONFIG.maxNestedEntityDepth) return;

        // 可见区域裁剪剔除
        if (depth === 0 && ent.extents) {
            if (ent.extents.max.x < vMinX || ent.extents.min.x > vMaxX ||
                ent.extents.max.y < vMinY || ent.extents.min.y > vMaxY) {
                return;
            }
        }

        const isSelected = selectedIds.has(ent.id) || parentSelected;
        const layerName = (ent.layer === '0' && parentLayerName) ? parentLayerName : ent.layer;
        if (hiddenLayers && hiddenLayers.has(layerName)) return;
        const layer = layers[layerName];
        if (layer && layer.isVisible === false) return;

        const color = isSelected ? SELECTION_COLOR : resolveEntityColor(ent, layer, parentColor, drawingColorMode, theme);

        stateTracker.setStrokeStyle(color);
        stateTracker.setFillStyle(color);

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

        if (lineWidthScale !== 1) {
            strokeStyle = {
                ...strokeStyle,
                lineWidth: strokeStyle.lineWidth * lineWidthScale,
            };
        }

        stateTracker.setLineWidth(strokeStyle.lineWidth);
        stateTracker.setLineDash(strokeStyle.dashPattern);

        switch (ent.type) {
            case EntityType.LINE:
                drawLine(ctx, ent, transform);
                break;
            case EntityType.RAY:
                drawRay(ctx, ent, transform, width, height);
                break;
            case EntityType.XLINE:
                drawXLine(ctx, ent, transform, width, height);
                break;
            case EntityType.POINT:
                drawPoint(ctx, ent, transform);
                break;
            case EntityType.CIRCLE:
                drawCircle(ctx, ent, transform);
                break;
            case EntityType.ARC:
                drawArc(ctx, ent, transform);
                break;
            case EntityType.ELLIPSE:
                drawEllipse(ctx, ent, transform);
                break;
            case EntityType.LWPOLYLINE:
            case EntityType.POLYLINE:
                if (ent.points.length > 1) {
                    ctx.beginPath();
                    drawPolyline(ctx, ent.points, ent.bulges, ent.closed, transform);
                    ctx.stroke();
                }
                break;
            case EntityType.MLINE:
                drawMLine(ctx, ent, transform);
                break;
            case EntityType.SPLINE:
                drawSpline(ctx, ent, transform, sceneIndex?.splineSamples.get(ent.id));
                break;
            case EntityType.HELIX:
                drawHelix(ctx, ent, transform);
                break;
            case EntityType.VIEWPORT:
                drawViewport(ctx, ent, transform, { modelEntities: viewportModelEntities, drawEntity });
                break;
            case EntityType.SHAPE:
                drawShape(ctx, ent, transform);
                break;
            case EntityType.TEXT:
            case EntityType.MTEXT:
            case EntityType.ATTRIB:
            case EntityType.ATTDEF:
                drawTextEntity(ctx, ent, transform, styles, theme, color, noMTextWrap);
                break;
            case EntityType.INSERT:
            case EntityType.ACAD_TABLE:
                drawInsertOrTable(ctx, ent, transform, blocks, color, isSelected, layerName, depth, noMTextWrap, drawEntity);
                break;
            case EntityType.DIMENSION:
                drawDimension(ctx, ent, transform, blocks, color, isSelected, layerName, depth, noMTextWrap, drawEntity);
                break;
            case EntityType.HATCH:
                drawHatch(ctx, ent, transform, color);
                break;
            case EntityType.SOLID:
            case EntityType.THREEDFACE:
                drawSolid(ctx, ent, transform, ent.type === EntityType.THREEDFACE ? '3DFACE' : 'SOLID');
                break;
            case EntityType.LEADER:
                drawLeader(ctx, ent, transform, color, entityByHandle);
                break;
            case EntityType.MLEADER:
                drawMLeader(ctx, ent, transform, color, layerName, isSelected, depth, (textEntity, trans, _layerName, col, _sel) => {
                    drawTextEntity(ctx, textEntity, trans, styles, theme, col, true);
                });
                break;
            case EntityType.IMAGE:
                drawImage(ctx, ent, transform);
                break;
            case EntityType.WIPEOUT:
                drawWipeout(ctx, ent, transform, theme);
                break;
            case EntityType.TOLERANCE:
                drawTolerance(ctx, ent, transform, color);
                break;
            default:
                break;
        }
    };

    const candidates = sceneIndex?.query({
        min: { x: vMinX, y: vMinY },
        max: { x: vMaxX, y: vMaxY },
    }) || entities;
    let index = 0;
    return {
        get done() { return index >= candidates.length; },
        drawChunk(budgetMs: number): boolean {
            const start = performance.now();
            while (index < candidates.length) {
                drawEntity(candidates[index], transform, undefined, undefined, false, 0, false);
                index++;
                if (performance.now() - start >= budgetMs) break;
            }
            return index >= candidates.length;
        },
    };
};

export interface VectorRenderSession {
    readonly done: boolean;
    drawChunk(budgetMs: number): boolean;
}

/**
 * 同步一次性写出全部实体（矢量导出入口）。
 */
export const renderVectorScene = (options: VectorSceneOptions): void => {
    const session = createVectorRenderSession(options);
    while (!session.drawChunk(Number.POSITIVE_INFINITY)) {
        // 同步跑完
    }
};



