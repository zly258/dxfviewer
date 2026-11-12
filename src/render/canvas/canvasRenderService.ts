/**
 * Canvas 2D 场景遍历器（交互渲染引擎的绘制核心）。
 *
 * 与 WebGL 引擎共用场景输入语义（EngineSceneOptions）与图元绘制函数
 * （render/vector/entities，CanvasRenderingContext2D 结构上满足 VectorContext）。
 * 性能机制：
 * - 同样式连续段批渲染（颜色|虚线|线宽分组，组内一次 stroke）；
 * - 视口包围盒剔除 + LOD 剔除（投影不足 1px 的实体跳过）；
 * - 世界坐标 Path2D 缓存（pathCache，交互快速路径）。
 */

import type { VectorContext } from '../vector/context';
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
  LINE_RENDER_CONFIG,
  LOD_RENDER_CONFIG
} from '@/config/viewerConfig';
import { resolveEntityColor } from '@/utils/entityColor';
import { resolveCadStrokeStyle } from '@/utils/lineStyle';

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
} from '../vector/entities/geometryRenderer';
import { drawTextEntity } from '../vector/entities/textRenderer';
import { drawInsertOrTable, drawDimension } from '../vector/entities/blockRenderer';
import {
  drawHatch,
  drawSolid,
  drawLeader,
  drawMLeader,
  drawImage,
  drawWipeout,
  drawTolerance
} from '../vector/entities/annotationRenderer';
import type { SceneIndex } from '@/render/picking/sceneIndex';

const SELECTION_COLOR = SELECTION_CONFIG.selectionBorderColor;

/** 可批渲染的简单几何类型（纯描边、无填充、无嵌套变换）。 */
const BATCHABLE_PATH_TYPES: ReadonlySet<string> = new Set([
  EntityType.LINE, EntityType.LWPOLYLINE, EntityType.POLYLINE,
  EntityType.CIRCLE, EntityType.ARC,
]);

/** Canvas 状态去重追踪器：相邻实体共享样式时跳过重复赋值。 */
class CanvasStateTracker {
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

export interface CanvasSceneOptions {
    ctx: VectorContext;
    entities: AnyEntity[];
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
    hiddenEntityIds?: ReadonlySet<string>;
    isolatedEntityIds?: ReadonlySet<string> | null;
    selectedIds?: Set<string>;
    sceneIndex?: SceneIndex;
    background?: string | null;
    /** 是否启用 LOD 剔除（导出关闭）。 */
    lodCulling?: boolean;
    lineWidthScale?: number;
    /** Path2D 缓存已覆盖的实体 id：其简单几何已按样式组批量 stroke。 */
    pathCacheCovered?: Set<string>;
    /**
     * 纯文字模式：只绘制 TEXT / MTEXT / ATTRIB / ATTDEF，并跳过背景填充。
     * 用于 WebGL 引擎的文字覆盖层（几何走 GPU，文字走浏览器原生文本引擎）。
     */
    textOnly?: boolean;
}

/** 文字类实体集合（textOnly 模式与文字 LOD 共用）。 */
export const TEXT_ENTITY_TYPES: ReadonlySet<EntityType> = new Set([
    EntityType.TEXT,
    EntityType.MTEXT,
    EntityType.ATTRIB,
    EntityType.ATTDEF,
]);

/**
 * 创建可分块续绘的渲染会话。
 */
export const createCanvasRenderSession = ({
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
    lodCulling = true,
    lineWidthScale = 1,
    pathCacheCovered,
    textOnly = false,
}: CanvasSceneOptions): CanvasRenderSession => {
    if (!textOnly && background !== null) {
        ctx.fillStyle = background ?? CANVAS_THEME_COLORS[theme];
        ctx.fillRect(0, 0, width, height);
    }

    const stateTracker = new CanvasStateTracker(ctx);
    stateTracker.reset();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const safeZoom = Math.max(Math.abs(viewPort.zoom), Number.MIN_VALUE);
    const vMinX = viewPort.targetX - width / 2 / safeZoom;
    const vMaxX = viewPort.targetX + width / 2 / safeZoom;
    const vMinY = viewPort.targetY - height / 2 / safeZoom;
    const vMaxY = viewPort.targetY + height / 2 / safeZoom;
    /** 实体级 LOD 仅对超大图纸启用（常规图纸不丢任何几何）。 */
    const lodActive = entities.length >= LOD_RENDER_CONFIG.minimumEntityCountForLod;

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

    // ── 同样式连续段批渲染状态 ──
    const batchState: { key: string | null; pending: boolean } = { key: null, pending: false };
    const appendBatchGeometry = (ctx: VectorContext, ent: AnyEntity, transform: RenderTransform): void => {
        switch (ent.type) {
            case EntityType.LINE: {
                const s = transform.project(ent.start);
                const e = transform.project(ent.end);
                ctx.moveTo(s.x, s.y);
                ctx.lineTo(e.x, e.y);
                break;
            }
            case EntityType.LWPOLYLINE:
            case EntityType.POLYLINE:
                if (ent.points.length > 1) {
                    drawPolyline(ctx, ent.points, ent.bulges, ent.closed, transform);
                }
                break;
            case EntityType.CIRCLE: {
                const c = transform.project(ent.center);
                const r = ent.radius * transform.scale;
                ctx.moveTo(c.x + r, c.y);
                ctx.arc(c.x, c.y, r, 0, 2 * Math.PI);
                break;
            }
            case EntityType.ARC: {
                const c = transform.project(ent.center);
                const r = ent.radius * transform.scale;
                const isCcw = ent.isCounterClockwise !== false;
                const startRad = (ent.startAngle || 0) * Math.PI / 180;
                const endRad = (ent.endAngle || 0) * Math.PI / 180;
                ctx.moveTo(c.x + r * Math.cos(-startRad), c.y + r * Math.sin(-startRad));
                ctx.arc(c.x, c.y, r, -startRad, -endRad, isCcw);
                break;
            }
        }
    };
    const flushBatch = (ctx: VectorContext): void => {
        if (batchState.pending) {
            ctx.stroke();
            batchState.pending = false;
        }
        batchState.key = null;
    };

    const drawEntity = (
        ent: AnyEntity,
        transform: RenderTransform,
        parentLayerName?: string,
        parentColor?: string,
        parentSelected: boolean = false,
        depth: number = 0,
        noMTextWrap: boolean = false
    ) => {
        if (textOnly && !TEXT_ENTITY_TYPES.has(ent.type)) return;

        const isTopLevelHidden = depth === 0 && (hiddenEntityIds.has(ent.id) || (isolatedEntityIds && !isolatedEntityIds.has(ent.id)));
        if (ent.visible === false || isTopLevelHidden || depth > SELECTION_CONFIG.maxNestedEntityDepth) return;

        // Path2D 缓存覆盖的简单几何已批量 stroke（选中实体例外：高亮重绘需独立描边）。
        if (pathCacheCovered && depth === 0 && !selectedIds.has(ent.id)
            && BATCHABLE_PATH_TYPES.has(ent.type)) {
            return;
        }

        // 可见区域裁剪剔除
        if (depth === 0 && ent.extents) {
            if (ent.extents.max.x < vMinX || ent.extents.min.x > vMaxX ||
                ent.extents.max.y < vMinY || ent.extents.min.y > vMaxY) {
                return;
            }
        }

        const isSelected = selectedIds.has(ent.id) || parentSelected;
        // 实体级 LOD：只对超大图纸生效（见 LOD_RENDER_CONFIG 说明）。
        // 常规图纸一律完整绘制——轮廓常由大量短线段拼成，逐段按"不足 1 像素"
        // 剔除会让整条轮廓在远景下消失。
        const lodThresholdPx = LOD_RENDER_CONFIG.minimumEntityScreenSizePixels;
        if (lodCulling && lodActive && lodThresholdPx > 0 && depth === 0 && ent.extents && !isSelected) {
            const sx = (ent.extents.max.x - ent.extents.min.x) * viewPort.zoom;
            const sy = (ent.extents.max.y - ent.extents.min.y) * viewPort.zoom;
            if (sx < lodThresholdPx && sy < lodThresholdPx) {
                return;
            }
        }

        const layerName = (ent.layer === '0' && parentLayerName) ? parentLayerName : ent.layer;
        if (hiddenLayers && hiddenLayers.has(layerName)) return;
        const layer = layers[layerName];
        if (layer && layer.isVisible === false) return;

        const color = isSelected ? SELECTION_COLOR : resolveEntityColor(ent, layer, parentColor, drawingColorMode, theme);

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

        const batchable = !isSelected && lineWidthScale === 1
            && BATCHABLE_PATH_TYPES.has(ent.type);
        const batchKey = batchable
            ? `${color}\u0000${strokeStyle.dashPattern.join(',')}\u0000${strokeStyle.lineWidth}`
            : null;
        if (batchKey !== null && batchKey === batchState.key) {
            appendBatchGeometry(ctx, ent, transform);
            return;
        }

        // 顺序约束（切勿交换）：先用**上一批**的 ctx 状态冲刷待描边几何，再设置
        // 本实体的颜色/线宽/虚线。旧实现先 setStrokeStyle(color) 再 flushBatch，
        // 结果是本实体的样式被描到上一批几何上 —— 整张图纸颜色整体错位一个实体
        // （实测浅色主题下轮廓变红、孔变青、中心线变黑）。
        flushBatch(ctx);
        stateTracker.setStrokeStyle(color);
        stateTracker.setFillStyle(color);
        batchState.key = batchKey;

        stateTracker.setLineWidth(strokeStyle.lineWidth);
        stateTracker.setLineDash(strokeStyle.dashPattern);

        switch (ent.type) {
            case EntityType.LINE:
                if (batchKey !== null) {
                    ctx.beginPath();
                    appendBatchGeometry(ctx, ent, transform);
                    batchState.pending = true;
                } else {
                    drawLine(ctx, ent, transform);
                }
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
                if (batchKey !== null) {
                    ctx.beginPath();
                    appendBatchGeometry(ctx, ent, transform);
                    batchState.pending = true;
                } else {
                    drawCircle(ctx, ent, transform);
                }
                break;
            case EntityType.ARC:
                if (batchKey !== null) {
                    ctx.beginPath();
                    appendBatchGeometry(ctx, ent, transform);
                    batchState.pending = true;
                } else {
                    drawArc(ctx, ent, transform);
                }
                break;
            case EntityType.ELLIPSE:
                drawEllipse(ctx, ent, transform);
                break;
            case EntityType.LWPOLYLINE:
            case EntityType.POLYLINE:
                if (ent.points.length > 1) {
                    if (batchKey !== null) {
                        ctx.beginPath();
                        appendBatchGeometry(ctx, ent, transform);
                        batchState.pending = true;
                    } else {
                        ctx.beginPath();
                        drawPolyline(ctx, ent.points, ent.bulges, ent.closed, transform);
                        ctx.stroke();
                    }
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
            flushBatch(ctx);
            return index >= candidates.length;
        },
    };
};

export interface CanvasRenderSession {
    readonly done: boolean;
    drawChunk(budgetMs: number): boolean;
}

/** 同步一次性渲染全部实体。 */
export const renderEntitiesToCanvas = (options: CanvasSceneOptions): void => {
    const session = createCanvasRenderSession(options);
    while (!session.drawChunk(Number.POSITIVE_INFINITY)) {
        // 同步跑完
    }
};





