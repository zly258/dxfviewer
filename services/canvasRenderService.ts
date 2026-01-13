import { AnyEntity, EntityType, DxfLayer, DxfBlock, DxfStyle, Point2D, DxfInsert, HatchLoop } from '../types';
import { AUTO_CAD_COLORS, DEFAULT_COLOR, getAutoCadColor } from '../constants';
import { getBSplinePoints } from './dxfService';

const SELECTION_COLOR = '#0078d4'; 

const getColor = (entColor: number | undefined, layer: DxfLayer | undefined, parentColor: string | undefined): string => {
    if (entColor === 0 && parentColor) return parentColor; // ByBlock
    if (entColor === 256 || entColor === undefined) { // ByLayer
        return layer ? getAutoCadColor(layer.color) : DEFAULT_COLOR;
    }
    return getAutoCadColor(entColor);
};

const mapCadFontToWebFont = (fontFileName: string): string => {
    if (!fontFileName) return 'Arial, sans-serif';
    const f = fontFileName.toLowerCase();
    
    // Chinese / CJK fonts
    if (f.includes('gb') || f.includes('hz') || f.includes('big') || f.includes('sim') || f.includes('song') || f.includes('kai') || f.includes('hei') || f.includes('fang')) {
        return '"Microsoft YaHei", "微软雅黑", "SimSun", "宋体", "STSong", "SimKai", "SimHei", sans-serif';
    }
    // Technical / AutoCAD specific fonts (usually mapped to monospace or technical sans-serif)
    if (f.includes('txt') || f.includes('mono') || f.includes('iso') || f.includes('simplex') || f.includes('romans') || f.includes('scripts') || f.includes('italic')) {
        return '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
    }
    // Serif / Roman
    if ((f.includes('times') || f.includes('roman')) && !f.includes('romans')) {
        return '"Times New Roman", Times, serif';
    }
    // Arial / Helvetica / Swiss
    if (f.includes('arial') || f.includes('helvetica') || f.includes('swiss')) {
        return 'Arial, Helvetica, sans-serif';
    }
    
    // If it's a TTF/OTF path, try to extract the font name
    const lastSlash = Math.max(f.lastIndexOf('/'), f.lastIndexOf('\\'));
    if (lastSlash !== -1) {
        let name = f.substring(lastSlash + 1).replace(/\.(ttf|otf|shx)$/i, '');
        if (name) {
            // Capitalize first letter of each word for better font matching
            name = name.split(/[\s-_]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            return `"${name}", Arial, sans-serif`;
        }
    }

    return 'Arial, sans-serif';
}

const getCanvasFont = (styleName: string | undefined, styles: Record<string, DxfStyle> | undefined, height: number): string => {
    // DXF Height is Cap Height. CSS is Em Height.
    // Factor ~1.43 converts Cap Height to approx correct CSS px size for Arial-like fonts.
    const correctedHeight = height * 1.43; 
    let fontFamily = '"Microsoft YaHei", "SimSun", Arial, sans-serif';
    
    if (styleName && styles && styles[styleName]) {
        const style = styles[styleName];
        if (style.fontFileName) {
            fontFamily = mapCadFontToWebFont(style.fontFileName);
        } else if (style.name) {
            // Sometimes style name itself is a font name
            fontFamily = `"${style.name}", ${fontFamily}`;
        }
    }
    return `${correctedHeight}px ${fontFamily}`;
};

const cleanTextContent = (text: string): string => {
    if (!text) return "";
    return text
        .replace(/\\P/g, '\n')
        .replace(/\\\{/g, '')
        .replace(/\\\}/g, '')
        .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))) // Unicode \U+XXXX
        .replace(/\\S([^^]+)\^([^;]+);/g, '$1/$2') // Stacked Text \S...^...; -> .../...
        .replace(/\\[A-Z][^;]*;/gi, '') 
        .replace(/\{|\}/g, '')
        .replace(/%%[cC]/g, 'Ø')
        .replace(/%%[dD]/g, '°')
        .replace(/%%[pP]/g, '±')
        .trim();
};

const wrapText = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] => {
    if (!maxWidth || maxWidth <= 0) return text.split('\n');
    const paragraphs = text.split('\n');
    const lines: string[] = [];
    paragraphs.forEach(paragraph => {
        const words = paragraph.split(' ');
        let currentLine = words[0] || '';
        for (let i = 1; i < words.length; i++) {
            const word = words[i];
            const width = ctx.measureText(currentLine + " " + word).width;
            if (width < maxWidth) {
                currentLine += " " + word;
            } else {
                lines.push(currentLine);
                currentLine = word;
            }
        }
        lines.push(currentLine);
    });
    return lines;
};

// Create a simple diagonal line pattern for hatches
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

const drawHatchLoop = (ctx: CanvasRenderingContext2D, loop: HatchLoop) => {
    if (loop.isPolyline && loop.points && loop.points.length > 0) {
        const points = loop.points;
        const bulges = loop.bulges || [];
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 0; i < points.length; i++) {
            const p1 = points[i];
            const p2 = points[(i + 1) % points.length];
            const bulge = bulges[i] || 0;
            if (Math.abs(bulge) < 1e-6) {
                ctx.lineTo(p2.x, p2.y);
            } else {
                const theta = 4 * Math.atan(bulge);
                const dist = Math.sqrt((p2.x - p1.x)**2 + (p2.y - p1.y)**2);
                if (dist > 1e-9) {
                    const radius = Math.abs(dist / (2 * Math.sin(theta / 2)));
                    const chordAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
                    const angleOffset = (Math.PI - Math.abs(theta)) / 2 * (bulge > 0 ? -1 : 1);
                    const centerAngle = chordAngle + angleOffset + (bulge > 0 ? -Math.PI/2 : Math.PI/2);
                    
                    const alpha = Math.atan2(p2.y - p1.y, p2.x - p1.x);
                    const cx = (p1.x + p2.x)/2 - (p2.y - p1.y)/2 * (1/Math.tan(2*Math.atan(bulge)));
                    const cy = (p1.y + p2.y)/2 + (p2.x - p1.x)/2 * (1/Math.tan(2*Math.atan(bulge)));
                    
                    const startAngle = Math.atan2(p1.y - cy, p1.x - cx);
                    const endAngle = Math.atan2(p2.y - cy, p2.x - cx);
                    const ccw = bulge > 0;
                    ctx.arc(cx, cy, radius, startAngle, endAngle, !ccw); 
                } else {
                    ctx.lineTo(p2.x, p2.y);
                }
            }
        }
    } else if (loop.edges && loop.edges.length > 0) {
        loop.edges.forEach((edge, i) => {
            if (i === 0 && edge.start) ctx.moveTo(edge.start.x, edge.start.y);
            else if (edge.start) ctx.lineTo(edge.start.x, edge.start.y); 

            if (edge.type === 'LINE' && edge.end) {
                ctx.lineTo(edge.end.x, edge.end.y);
            } else if (edge.type === 'ARC' && edge.center && edge.radius) {
                const start = (edge.startAngle || 0) * Math.PI / 180;
                let end = (edge.endAngle || 0) * Math.PI / 180;
                const ccw = edge.ccw === undefined ? true : edge.ccw; 
                ctx.arc(edge.center.x, edge.center.y, edge.radius, start, end, !ccw); 
            } else if (edge.type === 'ELLIPSE' && edge.center && edge.majorAxis) {
                const majX = edge.majorAxis.x;
                const majY = edge.majorAxis.y;
                const rX = Math.sqrt(majX*majX + majY*majY);
                const rY = rX * (edge.ratio || 1);
                const rotation = Math.atan2(majY, majX);
                const start = edge.startAngle || 0;
                const end = edge.endAngle || 2*Math.PI;
                const ccw = edge.ccw === undefined ? true : edge.ccw;
                ctx.ellipse(edge.center.x, edge.center.y, rX, rY, rotation, start, end, !ccw);
            } else if (edge.type === 'SPLINE' && (edge.calculatedPoints || edge.controlPoints)) {
                 const points = edge.calculatedPoints || getBSplinePoints(edge.controlPoints!, edge.degree || 3, edge.knots, edge.weights, 20);
                 points.forEach(p => ctx.lineTo(p.x, p.y));
            }
        });
    }
    ctx.closePath();
}

export const renderEntitiesToCanvas = (
    ctx: CanvasRenderingContext2D,
    entities: AnyEntity[],
    layers: Record<string, DxfLayer>,
    blocks: Record<string, DxfBlock>,
    styles: Record<string, DxfStyle>,
    viewPort: { x: number, y: number, zoom: number },
    selectedIds: Set<string>,
    width: number,
    height: number
) => {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0); 
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();

    ctx.save();
    ctx.translate(viewPort.x, viewPort.y);
    ctx.scale(viewPort.zoom, -viewPort.zoom);

    // Calculate viewport bounds in world coordinates for culling
    const xMin = -viewPort.x / viewPort.zoom;
    const xMax = (width - viewPort.x) / viewPort.zoom;
    const yMin = (viewPort.y - height) / viewPort.zoom;
    const yMax = viewPort.y / viewPort.zoom;

    const drawEntity = (ent: AnyEntity, parentLayerName?: string, parentColor?: string, currentScale: number = viewPort.zoom, parentSelected: boolean = false, depth: number = 0) => {
        if (ent.visible === false || depth > 20) return;

        // Skip entities that are too small to be visible (LOD)
        // For example, if an entity's size is less than 0.5 pixels on screen, skip it.
        const pixelThreshold = 0.5 / viewPort.zoom;

        const layerName = (ent.layer === '0' && parentLayerName) ? parentLayerName : ent.layer;
        const layer = layers[layerName];
        if (layer && layer.isVisible === false) return;

        const isSelected = selectedIds.has(ent.id) || parentSelected;
        const color = isSelected ? SELECTION_COLOR : getColor(ent.color, layer, parentColor);
        
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = (isSelected ? 2 : 1) / Math.abs(currentScale);

        switch (ent.type) {
            case EntityType.LINE:
                if (depth === 0 && !isSelected && (
                    Math.max(ent.start.x, ent.end.x) < xMin ||
                    Math.min(ent.start.x, ent.end.x) > xMax ||
                    Math.max(ent.start.y, ent.end.y) < yMin ||
                    Math.min(ent.start.y, ent.end.y) > yMax
                )) return;
                ctx.beginPath();
                ctx.moveTo(ent.start.x, ent.start.y);
                ctx.lineTo(ent.end.x, ent.end.y);
                ctx.stroke();
                break;
            case EntityType.RAY: {
                // Approximate culling: check if base point is within a huge distance from viewport
                if (depth === 0 && !isSelected && (ent.basePoint.x < xMin - 1000000 || ent.basePoint.x > xMax + 1000000)) return;
                const farPoint = {
                    x: ent.basePoint.x + ent.direction.x * 1000000,
                    y: ent.basePoint.y + ent.direction.y * 1000000
                };
                ctx.beginPath();
                ctx.moveTo(ent.basePoint.x, ent.basePoint.y);
                ctx.lineTo(farPoint.x, farPoint.y);
                ctx.stroke();
                break;
            }
            case EntityType.XLINE: {
                if (depth === 0 && !isSelected && (ent.basePoint.x < xMin - 1000000 || ent.basePoint.x > xMax + 1000000)) return;
                const p1 = {
                    x: ent.basePoint.x - ent.direction.x * 1000000,
                    y: ent.basePoint.y - ent.direction.y * 1000000
                };
                const p2 = {
                    x: ent.basePoint.x + ent.direction.x * 1000000,
                    y: ent.basePoint.y + ent.direction.y * 1000000
                };
                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.stroke();
                break;
            }
            case EntityType.POINT:
                if (depth === 0 && !isSelected && (ent.position.x < xMin || ent.position.x > xMax || ent.position.y < yMin || ent.position.y > yMax)) return;
                ctx.beginPath();
                ctx.arc(ent.position.x, ent.position.y, 2/viewPort.zoom, 0, 2*Math.PI);
                ctx.fill();
                break;
            case EntityType.CIRCLE:
                if (!isSelected && (ent.radius < pixelThreshold)) return;
                if (depth === 0 && !isSelected && (
                    ent.center.x + ent.radius < xMin ||
                    ent.center.x - ent.radius > xMax ||
                    ent.center.y + ent.radius < yMin ||
                    ent.center.y - ent.radius > yMax
                )) return;
                ctx.beginPath();
                ctx.arc(ent.center.x, ent.center.y, ent.radius, 0, 2 * Math.PI);
                ctx.stroke();
                break;
            case EntityType.ARC: {
                if (!isSelected && (ent.radius < pixelThreshold)) return;
                if (depth === 0 && !isSelected && (
                    ent.center.x + ent.radius < xMin ||
                    ent.center.x - ent.radius > xMax ||
                    ent.center.y + ent.radius < yMin ||
                    ent.center.y - ent.radius > yMax
                )) return;
                const startRad = ent.startAngle * Math.PI / 180;
                const endRad = ent.endAngle * Math.PI / 180;
                ctx.beginPath();
                ctx.arc(ent.center.x, ent.center.y, ent.radius, startRad, endRad, false);
                ctx.stroke();
                break;
            }
            case EntityType.LWPOLYLINE:
            case EntityType.POLYLINE:
                if (ent.points.length > 1) {
                    // Simple culling for Polyline using bounding box
                    if (depth === 0 && !isSelected) {
                        let pMinX = Infinity, pMaxX = -Infinity, pMinY = Infinity, pMaxY = -Infinity;
                        for (const p of ent.points) {
                            if (p.x < pMinX) pMinX = p.x; if (p.x > pMaxX) pMaxX = p.x;
                            if (p.y < pMinY) pMinY = p.y; if (p.y > pMaxY) pMaxY = p.y;
                        }
                        if (pMaxX < xMin || pMinX > xMax || pMaxY < yMin || pMinY > yMax) return;
                        if (pMaxX - pMinX < pixelThreshold && pMaxY - pMinY < pixelThreshold) return;
                    }

                    ctx.beginPath();
                    ctx.moveTo(ent.points[0].x, ent.points[0].y);
                    ent.points.forEach(p => ctx.lineTo(p.x, p.y));
                    if (ent.closed) ctx.closePath();
                    ctx.stroke();
                }
                break;
            case EntityType.SPLINE:
                const splinePoints = ent.calculatedPoints || getBSplinePoints(ent.controlPoints, ent.degree, ent.knots, ent.weights);
                if (splinePoints.length > 1) {
                    if (depth === 0 && !isSelected) {
                        let pMinX = Infinity, pMaxX = -Infinity, pMinY = Infinity, pMaxY = -Infinity;
                        for (const p of splinePoints) {
                            if (p.x < pMinX) pMinX = p.x; if (p.x > pMaxX) pMaxX = p.x;
                            if (p.y < pMinY) pMinY = p.y; if (p.y > pMaxY) pMaxY = p.y;
                        }
                        if (pMaxX < xMin || pMinX > xMax || pMaxY < yMin || pMinY > yMax) return;
                        if (pMaxX - pMinX < pixelThreshold && pMaxY - pMinY < pixelThreshold) return;
                    }

                    ctx.beginPath();
                    ctx.moveTo(splinePoints[0].x, splinePoints[0].y);
                    for(let i=1; i<splinePoints.length; i++) ctx.lineTo(splinePoints[i].x, splinePoints[i].y);
                    ctx.stroke();
                }
                break;
            case EntityType.TEXT:
            case EntityType.MTEXT:
                const text = cleanTextContent(ent.value);
                if (!text) break;
                
                // Culling for text (simplified). Skip culling if inside a block (depth > 0)
                // because ent.position is in local coordinates.
                if (depth === 0 && !isSelected && (ent.position.x < xMin - 500 || ent.position.x > xMax + 500 || ent.position.y < yMin - 500 || ent.position.y > yMax + 500)) return;

                ctx.save();
                
                const hAlign = ent.hAlign || 0;
                const vAlign = ent.vAlign || 0;
                // For TEXT: if alignment is set, use secondPosition.
                const isMText = ent.type === EntityType.MTEXT;
                const pos = (!isMText && (hAlign !== 0 || vAlign !== 0) && ent.secondPosition) ? ent.secondPosition : ent.position;
                
                ctx.translate(pos.x, pos.y);
                if (ent.rotation) ctx.rotate(ent.rotation * Math.PI / 180);
                
                let widthFactor = 1;
                const style = styles[ent.styleName || 'STANDARD'];
                if (isMText) widthFactor = style?.widthFactor || 1;
                else widthFactor = (ent.widthFactor && ent.widthFactor > 0) ? ent.widthFactor : (style?.widthFactor || 1);
                
                ctx.scale(widthFactor, -1); 
                
                ctx.font = getCanvasFont(ent.styleName, styles, ent.height);
                
                let align: CanvasTextAlign = 'left';
                let baseline: CanvasTextBaseline = 'alphabetic';
                let dy = 0;

                if (isMText) {
                    const wrapW = ent.width || 0;
                    const lines = wrapText(ctx, text, wrapW);
                    const lineHeight = ent.height * 1.67; 
                    const totalHeight = lines.length * lineHeight;
                    const ap = ent.attachmentPoint || 1;
                    
                    if ([2, 5, 8].includes(ap)) align = 'center';
                    else if ([3, 6, 9].includes(ap)) align = 'right';
                    
                    if ([1, 2, 3].includes(ap)) dy = 0; // Top
                    if ([4, 5, 6].includes(ap)) dy = -totalHeight / 2; // Middle
                    if ([7, 8, 9].includes(ap)) dy = -totalHeight; // Bottom
                    
                    baseline = 'top'; 
                    ctx.textAlign = align;
                    ctx.textBaseline = baseline;
                    
                    lines.forEach((line, i) => {
                        ctx.fillText(line, 0, dy + i * lineHeight);
                    });
                } else {
                    // Standard TEXT
                    if (hAlign === 1 || hAlign === 4) align = 'center'; // Center, Middle
                    else if (hAlign === 2) align = 'right'; // Right
                    else if (hAlign === 3) align = 'left'; // Aligned
                    else if (hAlign === 5) align = 'center'; // Fit

                    // Vertical Alignment
                    if (vAlign === 1) baseline = 'bottom';
                    else if (vAlign === 2) baseline = 'middle'; 
                    else if (vAlign === 3) baseline = 'top';
                    else baseline = 'alphabetic';

                    ctx.textAlign = align;
                    ctx.textBaseline = baseline;
                    ctx.fillText(text, 0, 0);
                }
                ctx.restore();
                break;
            case EntityType.INSERT:
                const block = blocks[ent.blockName];
                if (block) {
                    ctx.save();
                    ctx.translate(ent.position.x, ent.position.y);
                    ctx.rotate(ent.rotation * Math.PI / 180);
                    ctx.scale(ent.scale.x, ent.scale.y);
                    ctx.translate(-block.basePoint.x, -block.basePoint.y);
                    block.entities.forEach(child => drawEntity(child, layerName, color, currentScale * ent.scale.x, isSelected, depth + 1));
                    ctx.restore();
                    if (ent.attributes) {
                        ent.attributes.forEach(attr => drawEntity(attr, layerName, color, currentScale, isSelected, depth + 1));
                    }
                }
                break;
            case EntityType.HATCH:
                ctx.save();
                ctx.beginPath();
                ent.loops.forEach(loop => drawHatchLoop(ctx, loop));
                ctx.closePath();
                
                if (ent.solid) {
                    ctx.fillStyle = color;
                    ctx.fill('evenodd');
                } else {
                    // Pattern fill for non-solid hatches
                    const pattern = createHatchPattern(ctx, color);
                    if (pattern) {
                        ctx.fillStyle = pattern;
                        ctx.fill('evenodd');
                    }
                    ctx.stroke();
                }
                ctx.restore();
                break;
            case EntityType.DIMENSION: {
                const block = blocks[ent.blockName];
                if (block) {
                    block.entities.forEach(child => {
                        let childEnt = child;
                        // Propagate Dimension color to its block components (Text, Arrows, etc)
                        // if they are ByLayer (256) or ByBlock (0).
                        if (child.color === undefined || child.color === 256 || child.color === 0) {
                             childEnt = { ...child, color: 0 }; 
                        }
                        drawEntity(childEnt, layerName, color, currentScale, isSelected, depth + 1);
                    });
                } else {
                     if (ent.text || ent.measurement) {
                         const txt = ent.text || ent.measurement?.toFixed(2);
                         const tempText: any = {
                             id: 'temp', type: EntityType.TEXT, layer: ent.layer, color: ent.color,
                             position: ent.textMidPoint || ent.definitionPoint,
                             height: 2.5,
                             value: txt,
                             rotation: 0,
                             visible: true,
                             hAlign: 1, vAlign: 2 
                         };
                         drawEntity(tempText, layerName, color, currentScale, isSelected, depth + 1);
                     }
                }
                break;
            }
            case EntityType.SOLID:
            case EntityType.THREEDFACE: {
                if (ent.points.length < 3) break;
                
                // Culling for SOLID/3DFACE
                if (depth === 0 && !isSelected) {
                    let pMinX = Infinity, pMaxX = -Infinity, pMinY = Infinity, pMaxY = -Infinity;
                    for (const p of ent.points) {
                        if (p.x < pMinX) pMinX = p.x; if (p.x > pMaxX) pMaxX = p.x;
                        if (p.y < pMinY) pMinY = p.y; if (p.y > pMaxY) pMaxY = p.y;
                    }
                    if (pMaxX < xMin || pMinX > xMax || pMaxY < yMin || pMinY > yMax) return;
                }

                if (ent.type === EntityType.SOLID) {
                    ctx.beginPath();
                    ctx.moveTo(ent.points[0].x, ent.points[0].y);
                    for (let i = 1; i < ent.points.length; i++) {
                        ctx.lineTo(ent.points[i].x, ent.points[i].y);
                    }
                    ctx.closePath();
                    ctx.fill();
                    ctx.stroke();
                } else {
                    // 3DFACE: Handle invisible edges
                    const flags = ent.edgeFlags || 0;
                    const pts = ent.points;
                    
                    ctx.beginPath();
                    for (let i = 0; i < pts.length; i++) {
                        const p1 = pts[i];
                        const p2 = pts[(i + 1) % pts.length];
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
            case EntityType.LEADER: {
                if (ent.points.length < 2) break;
                ctx.beginPath();
                const pts = ent.points;
                ctx.moveTo(pts[0].x, pts[0].y);
                pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
                
                if (ent.hasHookLine) {
                     const last = pts[pts.length-1];
                     const prev = pts[pts.length-2];
                     const dx = last.x - prev.x;
                     const hookLen = 2.5; 
                     const dir = dx >= 0 ? 1 : -1;
                     ctx.lineTo(last.x + dir * hookLen, last.y);
                }
                ctx.stroke();

                if (ent.arrowHeadFlag === 1) {
                    const p1 = pts[0];
                    const p2 = pts[1];
                    const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
                    const s = 2.5; 
                    const a1 = ang + Math.PI/6; 
                    const a2 = ang - Math.PI/6;
                    ctx.beginPath();
                    ctx.moveTo(p1.x, p1.y);
                    ctx.lineTo(p1.x + Math.cos(a1)*s, p1.y + Math.sin(a1)*s);
                    ctx.lineTo(p1.x + Math.cos(a2)*s, p1.y + Math.sin(a2)*s);
                    ctx.closePath();
                    ctx.fillStyle = color;
                    ctx.fill();
                }
                break;
            }
        }
    };

    entities.forEach(ent => drawEntity(ent));
    ctx.restore();
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
    const checkEntity = (ent: AnyEntity, tx?: (p: Point2D) => Point2D, depth: number = 0): boolean => {
        if (depth > 20) return false;
        const p = tx ? tx : (pt: Point2D) => pt;
        
        if (ent.type === EntityType.LINE) {
            const s = p(ent.start), e = p(ent.end);
            return distanceToLine(x, y, s.x, s.y, e.x, e.y) < threshold;
        } else if (ent.type === EntityType.RAY) {
            const s = p(ent.basePoint);
            const e = { x: s.x + ent.direction.x * 1000000, y: s.y + ent.direction.y * 1000000 };
            return distanceToLine(x, y, s.x, s.y, e.x, e.y) < threshold;
        } else if (ent.type === EntityType.XLINE) {
            const s = p(ent.basePoint);
            const p1 = { x: s.x - ent.direction.x * 1000000, y: s.y - ent.direction.y * 1000000 };
            const p2 = { x: s.x + ent.direction.x * 1000000, y: s.y + ent.direction.y * 1000000 };
            return distanceToLine(x, y, p1.x, p1.y, p2.x, p2.y) < threshold;
        } else if (ent.type === EntityType.CIRCLE) {
            const c = p(ent.center);
            const d = Math.sqrt(Math.pow(x - c.x, 2) + Math.pow(y - c.y, 2));
            return Math.abs(d - ent.radius) < threshold;
        } else if (ent.type === EntityType.ARC) {
            const c = p(ent.center);
            const d = Math.sqrt(Math.pow(x - c.x, 2) + Math.pow(y - c.y, 2));
            if (Math.abs(d - ent.radius) < threshold) {
                let angle = Math.atan2(y - c.y, x - c.x) * 180 / Math.PI;
                if (angle < 0) angle += 360;
                const start = ent.startAngle, end = ent.endAngle;
                return start > end ? (angle >= start || angle <= end) : (angle >= start && angle <= end);
            }
        } else if (ent.type === EntityType.LWPOLYLINE || ent.type === EntityType.POLYLINE) {
            for (let j = 0; j < ent.points.length - 1; j++) {
                const p1 = p(ent.points[j]), p2 = p(ent.points[j+1]);
                if (distanceToLine(x, y, p1.x, p1.y, p2.x, p2.y) < threshold) return true;
            }
            if (ent.closed && ent.points.length > 2) {
                const p1 = p(ent.points[ent.points.length-1]), p2 = p(ent.points[0]);
                if (distanceToLine(x, y, p1.x, p1.y, p2.x, p2.y) < threshold) return true;
            }
        } else if (ent.type === EntityType.SPLINE) {
             const points = getBSplinePoints(ent.controlPoints, ent.degree, ent.knots, ent.weights, 20); // Low res for hit test
             for (let j = 0; j < points.length - 1; j++) {
                const p1 = p(points[j]), p2 = p(points[j+1]);
                if (distanceToLine(x, y, p1.x, p1.y, p2.x, p2.y) < threshold) return true;
            }
        } else if (ent.type === EntityType.POINT) {
            const pos = p(ent.position);
            return Math.sqrt(Math.pow(x - pos.x, 2) + Math.pow(y - pos.y, 2)) < threshold;
        } else if (ent.type === EntityType.TEXT || ent.type === EntityType.MTEXT || ent.type === EntityType.ATTRIB || ent.type === EntityType.ATTDEF) {
            const pos = p(ent.position);
            const text = cleanTextContent(ent.value);
            if (!text) return false;

            const height = ent.height || 10;
            const style = styles[ent.styleName || 'STANDARD'];
            const widthFactor = (ent.widthFactor && ent.widthFactor > 0) ? ent.widthFactor : (style?.widthFactor || 1);
            
            // Heuristic for width calculation
            const charCount = text.length;
            const approxWidth = height * 0.7 * charCount * widthFactor;
            
            const rad = (ent.rotation || 0) * Math.PI / 180;
            const cos = Math.cos(rad), sin = Math.sin(rad);
            
            // Alignment offsets (simplified)
            let dx = 0, dy = 0;
            const isMText = ent.type === EntityType.MTEXT;
            if (isMText) {
                const ap = ent.attachmentPoint || 1;
                if ([2, 5, 8].includes(ap)) dx = -approxWidth / 2;
                else if ([3, 6, 9].includes(ap)) dx = -approxWidth;
                
                if ([4, 5, 6].includes(ap)) dy = -height / 2;
                else if ([7, 8, 9].includes(ap)) dy = -height;
            } else {
                const hAlign = ent.hAlign || 0;
                const vAlign = ent.vAlign || 0;
                if (hAlign === 1 || hAlign === 4) dx = -approxWidth / 2;
                else if (hAlign === 2) dx = -approxWidth;
                
                if (vAlign === 1) dy = 0; // Baseline is bottom
                else if (vAlign === 2) dy = -height / 2;
                else if (vAlign === 3) dy = -height;
            }

            // Transform mouse point back to text local space
            const lx = x - pos.x;
            const ly = y - pos.y;
            const localX = lx * cos + ly * sin;
            const localY = -lx * sin + ly * cos;

            // Check if within bounds with some padding
            const pad = threshold;
            return localX >= dx - pad && localX <= dx + approxWidth + pad &&
                   localY >= dy - pad && localY <= dy + height + pad;
        } else if (ent.type === EntityType.LEADER) {
            for (let j = 0; j < ent.points.length - 1; j++) {
                const p1 = p(ent.points[j]), p2 = p(ent.points[j+1]);
                if (distanceToLine(x, y, p1.x, p1.y, p2.x, p2.y) < threshold) return true;
            }
        } else if (ent.type === EntityType.ELLIPSE) {
            const c = p(ent.center);
            const rx = Math.sqrt(ent.majorAxis.x ** 2 + ent.majorAxis.y ** 2);
            const ry = rx * ent.ratio;
            // Simple bounding box check for ellipse hit test
            if (Math.abs(x - c.x) > rx + threshold || Math.abs(y - c.y) > ry + threshold) return false;
            
            // More accurate: transform point to ellipse local space and check distance
            const dx = x - c.x;
            const dy = y - c.y;
            const angle = Math.atan2(ent.majorAxis.y, ent.majorAxis.x);
            const cos = Math.cos(-angle), sin = Math.sin(-angle);
            const localX = dx * cos - dy * sin;
            const localY = dx * sin + dy * cos;
            const normDist = (localX * localX) / (rx * rx) + (localY * localY) / (ry * ry);
            return Math.abs(Math.sqrt(normDist) - 1) < threshold / Math.min(rx, ry);
        } else if (ent.type === EntityType.SOLID || ent.type === EntityType.THREEDFACE) {
            for (let j = 0; j < ent.points.length; j++) {
                const p1 = p(ent.points[j]), p2 = p(ent.points[(j + 1) % ent.points.length]);
                if (distanceToLine(x, y, p1.x, p1.y, p2.x, p2.y) < threshold) return true;
            }
        } else if (ent.type === EntityType.INSERT) {
            const block = blocks[ent.blockName];
            if (block) {
                const rad = ent.rotation * Math.PI / 180;
                const cos = Math.cos(rad), sin = Math.sin(rad);
                const blockTransform = (pt: Point2D) => {
                    const bx = (pt.x - block.basePoint.x) * ent.scale.x;
                    const by = (pt.y - block.basePoint.y) * ent.scale.y;
                    const rx = bx * cos - by * sin;
                    const ry = bx * sin + by * cos;
                    return p({ x: rx + ent.position.x, y: ry + ent.position.y });
                };
                return block.entities.some(child => checkEntity(child, blockTransform, depth + 1));
            }
        } else if (ent.type === EntityType.HATCH) {
            return false;
        } else if (ent.type === EntityType.DIMENSION) {
             const block = blocks[ent.blockName];
             if (block) {
                 return block.entities.some(child => checkEntity(child, p, depth + 1));
             }
        }
        return false;
    };

    for (let i = entities.length - 1; i >= 0; i--) {
        if (checkEntity(entities[i])) return entities[i].id;
    }
    return null;
};

export const hitTestBox = (box: {x1:number, y1:number, x2:number, y2:number}, entities: AnyEntity[], layers: Record<string, DxfLayer>): Set<string> => {
    const results = new Set<string>();
    const minX = Math.min(box.x1, box.x2), maxX = Math.max(box.x1, box.x2);
    const minY = Math.min(box.y1, box.y2), maxY = Math.max(box.y1, box.y2);

    entities.forEach(ent => {
        let inBox = false;
        if (ent.type === EntityType.POINT) {
            inBox = ent.position.x >= minX && ent.position.x <= maxX && ent.position.y >= minY && ent.position.y <= maxY;
        } else if (ent.type === EntityType.LINE) {
            inBox = (ent.start.x >= minX && ent.start.x <= maxX && ent.start.y >= minY && ent.start.y <= maxY) ||
                    (ent.end.x >= minX && ent.end.x <= maxX && ent.end.y >= minY && ent.end.y <= maxY);
        } else if (ent.type === EntityType.RAY || ent.type === EntityType.XLINE) {
            inBox = ent.basePoint.x >= minX && ent.basePoint.x <= maxX && ent.basePoint.y >= minY && ent.basePoint.y <= maxY;
        } else if (ent.type === EntityType.CIRCLE || ent.type === EntityType.ARC) {
            inBox = ent.center.x >= minX && ent.center.x <= maxX && ent.center.y >= minY && ent.center.y <= maxY;
        } else if (ent.type === EntityType.LWPOLYLINE || ent.type === EntityType.POLYLINE) {
            inBox = ent.points.some(p => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY);
        } else if (ent.type === EntityType.LEADER) {
            inBox = ent.points.some(p => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY);
        } else if (ent.type === EntityType.ELLIPSE) {
            inBox = ent.center.x >= minX && ent.center.x <= maxX && ent.center.y >= minY && ent.center.y <= maxY;
        } else if (ent.type === EntityType.SOLID || ent.type === EntityType.THREEDFACE) {
            inBox = ent.points.some(p => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY);
        } else if (ent.type === EntityType.SPLINE && ent.controlPoints) {
            inBox = ent.controlPoints.some(p => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY);
        } else if (ent.type === EntityType.TEXT || ent.type === EntityType.MTEXT || ent.type === EntityType.ATTRIB || ent.type === EntityType.ATTDEF || ent.type === EntityType.INSERT) {
            inBox = ent.position.x >= minX && ent.position.x <= maxX && ent.position.y >= minY && ent.position.y <= maxY;
        } else if (ent.type === EntityType.DIMENSION) {
            const p = ent.textMidPoint || ent.definitionPoint;
            inBox = p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
        }
        if (inBox) results.add(ent.id);
    });
    return results;
};