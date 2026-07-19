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
import { sampleSplinePoints } from '@/core/geometry/curveSampling';
import {
    composePointTransform,
    createBlockPointTransform,
    createDimensionPointTransform,
    isDimensionBlockLocal,
    PointTransform,
    transformExtentsByPointTransform,
} from '@/core/geometry/transform';

// 导入图元具体的 Canvas 绘制函数
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
} from '@/renderer/entities/geometryRenderer';
import { drawTextEntity } from '@/renderer/entities/textRenderer';
import { drawInsertOrTable, drawDimension } from '@/renderer/entities/blockRenderer';
import { 
  drawHatch, 
  drawSolid, 
  drawLeader, 
  drawMLeader, 
  drawImage, 
  drawWipeout, 
  drawTolerance 
} from '@/renderer/entities/annotationRenderer';
import { SceneIndex } from '@/renderer/services/sceneIndex';

const SELECTION_COLOR = SELECTION_CONFIG.selectionBorderColor;

/**
 * 将 DXF 图纸中所有可绘制图元绘制到画布上。
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
    hiddenLayers: Set<string> = new Set(),
    sceneIndex?: SceneIndex,
) => {
    // 使用画布主题背景色填充整个 Canvas
    ctx.fillStyle = CANVAS_THEME_COLORS[theme];
    ctx.fillRect(0, 0, width, height);

    // 计算当前可见区域包围盒范围，用于顶层视口剔除 (Culling)
    const safeZoom = Math.max(Math.abs(viewPort.zoom), Number.MIN_VALUE);
    const vMinX = viewPort.targetX - width / 2 / safeZoom;
    const vMaxX = viewPort.targetX + width / 2 / safeZoom;
    const vMinY = viewPort.targetY - height / 2 / safeZoom;
    const vMaxY = viewPort.targetY + height / 2 / safeZoom;

    // 构造视图坐标转换矩阵
    const transform: RenderTransform = {
        project: (p: Point2D) => ({
            x: (p.x - viewPort.targetX) * viewPort.zoom + width / 2,
            y: -(p.y - viewPort.targetY) * viewPort.zoom + height / 2,
        }),
        scale: viewPort.zoom,
        rotation: 0,
    };

    // 建立实体 Handle 映射表用于解析引线关联信息
    const entityByHandle = sceneIndex?.entityByHandle || new Map<string, AnyEntity>();
    if (!sceneIndex) {
        entities.forEach(entity => {
            if (entity.handle) entityByHandle.set(entity.handle, entity);
        });
    }

    /**
     * 渲染单个 DXF 图元的核心调度器
     */
    const drawEntity = (
        ent: AnyEntity, 
        transform: RenderTransform, 
        parentLayerName?: string, 
        parentColor?: string, 
        parentSelected: boolean = false, 
        depth: number = 0, 
        noMTextWrap: boolean = false
    ) => {
        if (ent.visible === false || depth > SELECTION_CONFIG.maxNestedEntityDepth) return;

        // 可见区域裁剪剔除
        if (depth === 0 && ent.extents) {
            if (ent.extents.max.x < vMinX || ent.extents.min.x > vMaxX ||
                ent.extents.max.y < vMinY || ent.extents.min.y > vMaxY) {
                return;
            }
        }

        const layerName = (ent.layer === '0' && parentLayerName) ? parentLayerName : ent.layer;
        if (hiddenLayers && hiddenLayers.has(layerName)) return;
        const layer = layers[layerName];
        if (layer && layer.isVisible === false) return;

        const isSelected = selectedIds.has(ent.id) || parentSelected;
        const color = isSelected ? SELECTION_COLOR : resolveEntityColor(ent, layer, parentColor, drawingColorMode, theme);
        
        ctx.strokeStyle = color;
        ctx.fillStyle = color;

        // 解析 CAD 线宽、线型属性并应用到画布绘图上下文。
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
                drawViewport(ctx, ent, transform);
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

    // 遍历图纸中的顶级实体进行依次渲染绘制
    const visibleCandidates = sceneIndex?.query({
        min: { x: vMinX, y: vMinY },
        max: { x: vMaxX, y: vMaxY },
    }) || entities;
    visibleCandidates.forEach(ent => drawEntity(ent, transform, undefined, undefined, false, 0, false));
};

/**
 * 计算点到线段的距离
 */
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

/**
 * 屏幕点拾取测试
 */
export const hitTest = (
    x: number, 
    y: number, 
    threshold: number, 
    entities: AnyEntity[], 
    blocks: Record<string, DxfBlock>, 
    layers: Record<string, DxfLayer>, 
    _styles: Record<string, DxfStyle>,
    splineSamples?: ReadonlyMap<string, Point2D[]>,
): string | null => {
    /**
     * 递归检查单个实体，返回到该实体的最短几何距离
     */
    const checkEntityDistance = (ent: AnyEntity, tx?: PointTransform, depth: number = 0): number => {
        if (ent.visible === false || depth > SELECTION_CONFIG.maxNestedEntityDepth) return Infinity;

        const layer = layers[ent.layer];
        if (layer && layer.isVisible === false) return Infinity;

        const p = tx ? tx : (pt: Point2D) => pt;

        const isTextEntity = [EntityType.TEXT, EntityType.MTEXT, EntityType.ATTRIB, EntityType.ATTDEF].includes(ent.type);
        // 文字拾取容差与几何体保持一致（原 2.0 会让文字包围盒过度扩张，抢夺附近几何体的点击）。
        const effectiveThreshold = isTextEntity ? (threshold * SELECTION_CONFIG.textHitToleranceFactor) : threshold;

        let minDist = Infinity;

        // 使用预计算的包围盒进行初步碰撞检测
        if (ent.extents) {
            let { min, max } = ent.extents;

            if (tx) {
                const transformed = transformExtentsByPointTransform({ min, max }, tx);
                if (!transformed) return Infinity;
                min = transformed.min;
                max = transformed.max;
            }

            const margin = effectiveThreshold * 1.2;
            const insideBox = x >= min.x - margin && x <= max.x + margin &&
                              y >= min.y - margin && y <= max.y + margin;

            if (!insideBox) return Infinity;

            if (isTextEntity) {
                // 文字按"到包围盒的真实距离"判定：落在盒内距离为 0，否则取到最近边的距离。
                // 关键修复：原来盒内直接返回 0，会让旁边文字抢走本应选中几何体的点击。
                // 现在盒内追加一个惩罚分，使点击正好落在几何体上时（几何体距离≈0）优先选中几何体。
                const dx = Math.max(min.x - x, 0, x - max.x);
                const dy = Math.max(min.y - y, 0, y - max.y);
                const inside = dx === 0 && dy === 0;
                const bboxDist = inside ? 0 : Math.hypot(dx, dy);
                const penalized = bboxDist + (inside ? effectiveThreshold * SELECTION_CONFIG.textHitInsidePenaltyFactor : 0);
                return penalized < effectiveThreshold ? penalized : Infinity;
            }

            // 面类实体（如填充）落在包围盒内即视为命中
            if (ent.type === EntityType.HATCH) return 0;
        }

        // 精确几何算法做详细碰撞计算
        if (ent.type === EntityType.LINE) {
            const s = p(ent.start), e = p(ent.end);
            minDist = distanceToLine(x, y, s.x, s.y, e.x, e.y);
        } else if (ent.type === EntityType.RAY) {
            const s = p(ent.basePoint);
            const e = {
                x: s.x + ent.direction.x * SELECTION_CONFIG.infiniteLineHitTestLength,
                y: s.y + ent.direction.y * SELECTION_CONFIG.infiniteLineHitTestLength,
            };
            minDist = distanceToLine(x, y, s.x, s.y, e.x, e.y);
        } else if (ent.type === EntityType.XLINE) {
            const s = p(ent.basePoint);
            const p1 = {
                x: s.x - ent.direction.x * SELECTION_CONFIG.infiniteLineHitTestLength,
                y: s.y - ent.direction.y * SELECTION_CONFIG.infiniteLineHitTestLength,
            };
            const p2 = {
                x: s.x + ent.direction.x * SELECTION_CONFIG.infiniteLineHitTestLength,
                y: s.y + ent.direction.y * SELECTION_CONFIG.infiniteLineHitTestLength,
            };
            minDist = distanceToLine(x, y, p1.x, p1.y, p2.x, p2.y);
        } else if (ent.type === EntityType.CIRCLE) {
            const c = p(ent.center);
            const d = Math.sqrt(Math.pow(x - c.x, 2) + Math.pow(y - c.y, 2));
            minDist = Math.abs(d - ent.radius);
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
                
                if (s > e ? (angle >= s || angle <= e) : (angle >= s && angle <= e)) {
                    minDist = Math.abs(d - ent.radius);
                }
            }
        } else if (ent.type === EntityType.LWPOLYLINE || ent.type === EntityType.POLYLINE) {
            const isFlipped = (ent.extrusion?.z || 1) < 0;
            for (let j = 0; j < (ent.closed ? ent.points.length : ent.points.length - 1); j++) {
                const p1 = p(ent.points[j]);
                const p2 = p(ent.points[(j + 1) % ent.points.length]);
                const bulge = ent.bulges ? (ent.bulges[j] || 0) : 0;
                
                if (Math.abs(bulge) < 1e-6) {
                    minDist = Math.min(minDist, distanceToLine(x, y, p1.x, p1.y, p2.x, p2.y));
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
                                const temp = s;
                                s = e;
                                e = temp;
                            }
                            
                            if (s > e ? (angle >= s || angle <= e) : (angle >= s && angle <= e)) {
                                minDist = Math.min(minDist, Math.abs(d - radius));
                            }
                        }
                    } else {
                        minDist = Math.min(minDist, Math.sqrt((x - p1.x)**2 + (y - p1.y)**2));
                    }
                }
            }
        } else if (ent.type === EntityType.SPLINE) {
             const points = splineSamples?.get(ent.id) || sampleSplinePoints(
                ent.controlPoints || [],
                ent.degree || 3,
                ent.knots,
                ent.weights,
                SELECTION_CONFIG.splineHitTestSegments,
             );
             for (let j = 0; j < points.length - 1; j++) {
                const p1 = p(points[j]), p2 = p(points[j+1]);
                minDist = Math.min(minDist, distanceToLine(x, y, p1.x, p1.y, p2.x, p2.y));
            }
        } else if (ent.type === EntityType.POINT) {
            const pos = p(ent.position);
            minDist = Math.sqrt(Math.pow(x - pos.x, 2) + Math.pow(y - pos.y, 2));
        } else if (ent.type === EntityType.LEADER) {
            for (let j = 0; j < ent.points.length - 1; j++) {
                const p1 = p(ent.points[j]), p2 = p(ent.points[j+1]);
                minDist = Math.min(minDist, distanceToLine(x, y, p1.x, p1.y, p2.x, p2.y));
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
            
            const distFromEllipse = Math.abs(Math.sqrt(normDist) - 1) * Math.min(rx, ry);
            if (distFromEllipse < effectiveThreshold) {
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
                if (s > e ? (param >= s || param <= e) : (param >= s && param <= e)) {
                    minDist = distFromEllipse;
                }
            }
        } else if (ent.type === EntityType.INSERT || ent.type === EntityType.ACAD_TABLE) {
            const block = blocks[ent.blockName];
            if (block) {
                const scale = ent.scale || { x: 1, y: 1, z: 1 };
                const newTx = composePointTransform(
                    createBlockPointTransform(block, ent.position, scale, ent.rotation || 0),
                    tx,
                );
                
                for (const child of block.entities) {
                    const d = checkEntityDistance(child, newTx, depth + 1);
                    if (d < minDist) minDist = d;
                }
                if ((ent as any).attributes) {
                    for (const attr of (ent as any).attributes) {
                        const d = checkEntityDistance(attr, undefined, depth + 1);
                        if (d < minDist) minDist = d;
                    }
                }
            }
        } else if (ent.type === EntityType.DIMENSION) {
            const block = blocks[ent.blockName];
            if (block) {
                const dp = (ent as any).definitionPoint || { x: 0, y: 0 };
                const newTx = composePointTransform(
                    createDimensionPointTransform(block, dp, isDimensionBlockLocal(block, dp, 5)),
                    tx,
                );

                for (const child of block.entities) {
                    const d = checkEntityDistance(child, newTx, depth + 1);
                    if (d < minDist) minDist = d;
                }
            }
        }

        return minDist < effectiveThreshold ? minDist : Infinity;
    };

    let bestId: string | null = null;
    let bestDist = Infinity;

    // 优先匹配 Dimension
    for (const ent of entities) {
        if (ent.type === EntityType.DIMENSION) {
            const d = checkEntityDistance(ent);
            if (d < bestDist) {
                bestDist = d;
                bestId = ent.id;
            }
        }
    }

    if (bestId) return bestId;

    // 匹配其他实体
    for (let i = entities.length - 1; i >= 0; i--) {
        const ent = entities[i];
        if (ent.type !== EntityType.DIMENSION) {
            const d = checkEntityDistance(ent);
            if (d < bestDist) {
                bestDist = d;
                bestId = ent.id;
            }
        }
    }

    return bestId;
};


/**
 * 矩形框选测试
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
    
    const checkEntityBox = (ent: AnyEntity, tx?: PointTransform, depth: number = 0): boolean => {
        if (ent.visible === false || depth > SELECTION_CONFIG.maxNestedEntityDepth) return isCrossing ? false : true;
        const layer = layers[ent.layer];
        if (layer && layer.isVisible === false) return isCrossing ? false : true;

        const ext = ent.extents ? (tx ? transformExtentsByPointTransform(ent.extents, tx) : ent.extents) : null;
        if (ext) {
            if (isCrossing) {
                if (!overlaps(ext)) return false;
            } else {
                if (!contained(ext)) return false;
            }
        } else if (ent.type === EntityType.POINT && ent.position) {
            const p = tx ? tx(ent.position) : ent.position;
            const inside = p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
            return inside;
        }

        if (ent.type === EntityType.INSERT || ent.type === EntityType.ACAD_TABLE) {
            const block = blocks[ent.blockName];
            if (!block) return ext ? (isCrossing ? overlaps(ext) : contained(ext)) : false;
            const scale = (ent as any).scale || { x: 1, y: 1, z: 1 };
            const baseTx = composePointTransform(
                createBlockPointTransform(block, (ent as any).position, scale, (ent as any).rotation || 0),
                tx,
            );
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
            const baseTx = composePointTransform(
                createDimensionPointTransform(block, dp, isDimensionBlockLocal(block, dp, 5)),
                tx,
            );

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
