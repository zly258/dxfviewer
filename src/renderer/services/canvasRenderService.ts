import { 
  AnyEntity, 
  EntityType, 
  DxfLayer, 
  DxfBlock, 
  DxfStyle, 
  DxfLineType,
  Point2D, 
  DxfText, 
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
import { sampleSplinePoints, sampleEllipsePoints } from '@/core/geometry/curveSampling';
import { cleanMText } from '@/utils/textUtils';

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
  drawHelix 
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

const SELECTION_COLOR = SELECTION_CONFIG.selectionBorderColor;

/**
 * 将 DXF 图纸中所有的可绘制图元绘制到 Canvas 画布上
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
    overlayExtents?: { min: Point2D, max: Point2D } | null,
    hiddenLayers: Set<string> = new Set()
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

    // 开启 SHX 字体调试分析
    const shxDebugEnabled = typeof window !== 'undefined' && window.localStorage?.getItem('dxfviewer.shxDebug') === '1';
    const shxDebugStats = { glyphs: 0, fallbacks: 0, runs: 0 };

    // 建立实体 Handle 映射表用于解析引线关联信息
    const entityByHandle = new Map<string, AnyEntity>();
    entities.forEach(entity => {
        if (entity.handle) entityByHandle.set(entity.handle, entity);
    });

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
        if (ent.visible === false || depth > 20) return;

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

        // 解析 CAD 线宽、线型属性并应用到 Canvas 绘图上下文
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
                drawSpline(ctx, ent, transform);
                break;
            case EntityType.HELIX:
                drawHelix(ctx, ent, transform);
                break;
            case EntityType.TEXT:
            case EntityType.MTEXT:
            case EntityType.ATTRIB:
            case EntityType.ATTDEF:
                drawTextEntity(ctx, ent, transform, styles, theme, color, isSelected, noMTextWrap, shxDebugEnabled, shxDebugStats);
                break;
            case EntityType.INSERT:
            case EntityType.ACAD_TABLE:
                drawInsertOrTable(ctx, ent, transform, blocks, theme, color, isSelected, layerName, depth, noMTextWrap, drawEntity);
                break;
            case EntityType.DIMENSION:
                drawDimension(ctx, ent, transform, blocks, theme, color, isSelected, layerName, depth, noMTextWrap, drawEntity);
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
                drawMLeader(ctx, ent, transform, color, layerName, isSelected, depth, (textEntity, trans, lName, col, sel, d) => {
                    drawTextEntity(ctx, textEntity, trans, styles, theme, col, sel, true, shxDebugEnabled, shxDebugStats);
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
    entities.forEach(ent => drawEntity(ent, transform, undefined, undefined, false, 0, false));

    // 绘制套图叠合图纸范围的虚线外边框（若配置存在）
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

    // 绘制 SHX 字体性能与命中信息
    if (shxDebugEnabled) {
        ctx.save();
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = theme === 'white' ? '#166534' : '#86efac';
        ctx.fillText(`SHX glyph: ${shxDebugStats.glyphs}, fallback: ${shxDebugStats.fallbacks}, runs: ${shxDebugStats.runs}`, 8, 8);
        ctx.restore();
    }
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
    _styles: Record<string, DxfStyle>
): string | null => {
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
        
        const isTextEntity = [EntityType.TEXT, EntityType.MTEXT, EntityType.ATTRIB, EntityType.ATTDEF].includes(ent.type);
        const effectiveThreshold = isTextEntity ? (threshold * 2.0) : threshold;

        // 使用预计算的包围盒进行初步碰撞检测
        if (ent.extents) {
            let { min, max } = ent.extents;
            
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

            const margin = effectiveThreshold * 1.2;
            const insideBox = x >= min.x - margin && x <= max.x + margin && 
                              y >= min.y - margin && y <= max.y + margin;
            
            if (!insideBox) return false;

            const isContainerOrText = [
                EntityType.TEXT, 
                EntityType.MTEXT, 
                EntityType.ATTRIB, 
                EntityType.ATTDEF,
                EntityType.HATCH
            ].includes(ent.type);

            if (isContainerOrText) return true;
        }

        // 精确几何算法做详细碰撞计算
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
                const distance = Math.hypot(bc.x - dp.x, bc.y - dp.y);
                treatAsLocal = distance > size * 5;
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

    // 优先匹配 Dimension
    for (const ent of entities) {
        if (ent.type === EntityType.DIMENSION) {
            if (checkEntity(ent)) return ent.id;
        }
    }

    // 倒序匹配以选择最上方的实体
    for (let i = entities.length - 1; i >= 0; i--) {
        const ent = entities[i];
        if (ent.type !== EntityType.DIMENSION && checkEntity(ent)) return ent.id;
    }
    return null;
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
            return inside;
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
                const distance = Math.hypot(bc.x - dp.x, bc.y - dp.y);
                treatAsLocal = distance > size * 5;
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
