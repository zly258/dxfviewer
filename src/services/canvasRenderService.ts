import { AnyEntity, EntityType, DxfLayer, DxfBlock, DxfStyle, Point2D, DxfInsert, HatchLoop, DxfText, DxfLineType, ViewPort } from '../types';
import { DEFAULT_COLOR } from '../constants';
import { getAutoCadColor, AUTO_CAD_COLORS, trueColorToHex } from '../utils/colorUtils';
import { getBSplinePoints } from './dxfService';
import { getStyleFontFamily, FONT_STACKS, mapCadFontToWebFont } from './fontService';

const SELECTION_COLOR = '#0078d4'; 

const getColor = (ent: AnyEntity, layer: DxfLayer | undefined, parentColor: string | undefined, theme: 'black' | 'white'): string => {
    if (ent.trueColor !== undefined) return trueColorToHex(ent.trueColor);
    const entColor = ent.color;
    if (entColor === 0 && parentColor) return parentColor; // ByBlock
    if (entColor === 256 || entColor === undefined) { // ByLayer
        if (layer?.trueColor !== undefined) return trueColorToHex(layer.trueColor);
        return layer ? getAutoCadColor(layer.color, theme) : (theme === 'black' ? '#FFFFFF' : '#000000');
    }
    return getAutoCadColor(entColor, theme);
};

const getCanvasFont = (ent: AnyEntity, styles: Record<string, DxfStyle> | undefined): string => {
    const textEnt = (ent.type === EntityType.TEXT || ent.type === EntityType.MTEXT || ent.type === EntityType.ATTRIB || ent.type === EntityType.ATTDEF) ? (ent as DxfText) : null;
    let height = textEnt ? (textEnt.height || 2.5) : 2.5;
    
    // Height priority: 1. Inline override, 2. Entity height, 3. Style height, 4. Default 2.5
    const styleName = textEnt?.styleName || 'STANDARD';
    const style = styles?.[styleName] || styles?.[styleName.toUpperCase()];
    if (height <= 0) {
        height = style?.height || 2.5;
    }

    let fontFamily = getStyleFontFamily(styleName, styles);
    let fontWeight = 'normal';
    let fontStyle = 'normal';
    
    // Better TrueType detection: 
    // 1. Style font name ends in .ttf/.otf
    // 2. It's one of the standard web fonts
    const styleFontLower = (style?.fontFileName || "").toLowerCase();
    let isTrueType = styleFontLower.endsWith('.ttf') || styleFontLower.endsWith('.otf') || 
                     styleFontLower.includes('simsun') || styleFontLower.includes('simhei') || 
                     styleFontLower.includes('arial') || styleFontLower.includes('msyh');

    // Check for MTEXT inline height override \H...;
    if (ent.type === EntityType.MTEXT) {
        const hMatch = ent.value.match(/\\H([^;]+);/);
        if (hMatch && hMatch[1]) {
            const hVal = parseFloat(hMatch[1]);
            if (!isNaN(hVal)) {
                if (hMatch[1].endsWith('x')) {
                    height *= hVal;
                } else {
                    height = hVal;
                }
            }
        }

        // MTEXT content can have complex formatting like {\fArial|b1|i1|c0|p34;Text}
        // 1. Check for explicit font overrides in MTEXT value
        // \fFontName|...; or \fFontName;
        // Using a non-greedy match to avoid capturing multiple formatting blocks
        const fMatch = ent.value.match(/\\f([^;|]+)(?:\|([^;]*))?;/);
        if (fMatch && fMatch[1]) {
            const inlineFont = fMatch[1].replace(/\"/g, '').trim();
            const inlineParams = fMatch[2] || '';
            
            if (inlineParams) {
                const parts = inlineParams.split('|');
                parts.forEach(part => {
                    if (part.startsWith('b') && part.length > 1) {
                        fontWeight = part.substring(1) === '1' ? 'bold' : 'normal';
                    } else if (part.startsWith('i') && part.length > 1) {
                        fontStyle = part.substring(1) === '1' ? 'italic' : 'normal';
                    }
                });
            }

            if (inlineFont) {
                const inlineFontLower = inlineFont.toLowerCase();
                isTrueType = true; // Inline \f fonts are usually TrueType

                if (inlineFontLower.includes('仿宋') || inlineFontLower.includes('fangsong') || inlineFontLower === 'fs') {
                    fontFamily = FONT_STACKS.FANGSONG;
                } else if (inlineFontLower.includes('宋体') || inlineFontLower.includes('simsun') || inlineFontLower.includes('song')) {
                    fontFamily = FONT_STACKS.FANGSONG; // Remap SimSun to FangSong even in \f overrides
                } else if (inlineFontLower.includes('黑体') || inlineFontLower.includes('simhei') || inlineFontLower.includes('hei')) {
                    fontFamily = FONT_STACKS.HEI;
                } else if (inlineFontLower.includes('楷体') || inlineFontLower.includes('simkai') || inlineFontLower.includes('kai')) {
                    fontFamily = FONT_STACKS.KAI;
                } else if (inlineFontLower.includes('yahei')) {
                    fontFamily = FONT_STACKS.HEI;
                } else if (inlineFontLower === 'arial') {
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

    // Adjust height based on font type
    // SHX fonts (mapped) usually need a larger multiplier than TrueType fonts
    const scaleFactor = isTrueType ? 1.15 : 1.43;
    const correctedHeight = height * scaleFactor; 

    return `${fontStyle} ${fontWeight} ${correctedHeight}px ${fontFamily}`;
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

interface RenderTransform {
    project: (p: Point2D) => Point2D;
    scale: number; // Cumulative scale factor to screen pixels
}

const drawHatchLoop = (ctx: CanvasRenderingContext2D, loop: HatchLoop, transform: RenderTransform) => {
    const { project, scale } = transform;
    if (loop.isPolyline && loop.points && loop.points.length > 0) {
        const points = loop.points;
        const bulges = loop.bulges || [];
        const start = project(points[0]);
        ctx.moveTo(start.x, start.y);
        for (let i = 0; i < points.length; i++) {
            const p1 = points[i];
            const p2 = points[(i + 1) % points.length];
            const bulge = bulges[i] || 0;
            const sP2 = project(p2);
            if (Math.abs(bulge) < 1e-6) {
                ctx.lineTo(sP2.x, sP2.y);
            } else {
                const theta = 4 * Math.atan(bulge);
                const dist = Math.sqrt((p2.x - p1.x)**2 + (p2.y - p1.y)**2);
                if (dist > 1e-9) {
                    const radius = Math.abs(dist / (2 * Math.sin(theta / 2)));
                    const a = (p2.x - p1.x) / 2;
                    const b = (p2.y - p1.y) / 2;
                    const h = (dist / 2) * (1 / bulge - bulge) / 2;
                    const cx = p1.x + a - h * (p2.y - p1.y) / dist;
                    const cy = p1.y + b + h * (p2.x - p1.x) / dist;
                    
                    const startAngle = Math.atan2(p1.y - cy, p1.x - cx);
                    const endAngle = Math.atan2(p2.y - cy, p2.x - cx);
                    
                    const sCenter = project({ x: cx, y: cy });
                    const sRadius = radius * scale;
                    
                    // Note: In screen space, we use project which already handles Y-flip
                    // But arc() still needs a direction. 
                    // If CAD is CCW, and Y is flipped, it becomes CW in screen.
                    const ccw = bulge < 0; // Reversed because of Y-flip
                    ctx.arc(sCenter.x, sCenter.y, sRadius, -startAngle, -endAngle, ccw); 
                } else {
                    ctx.lineTo(sP2.x, sP2.y);
                }
            }
        }
    } else if (loop.edges && loop.edges.length > 0) {
        loop.edges.forEach((edge, i) => {
            if (i === 0 && edge.start) {
                const start = project(edge.start);
                ctx.moveTo(start.x, start.y);
            } else if (edge.start) {
                const start = project(edge.start);
                ctx.lineTo(start.x, start.y); 
            }

            if (edge.type === 'LINE' && edge.end) {
                const end = project(edge.end);
                ctx.lineTo(end.x, end.y);
            } else if (edge.type === 'ARC' && edge.center && edge.radius) {
                const start = (edge.startAngle || 0) * Math.PI / 180;
                const end = (edge.endAngle || 0) * Math.PI / 180;
                const sCenter = project(edge.center);
                const sRadius = edge.radius * scale;
                const isCcw = edge.ccw === undefined ? true : edge.ccw; 
                ctx.arc(sCenter.x, sCenter.y, sRadius, -start, -end, !isCcw); 
            } else if (edge.type === 'ELLIPSE' && edge.center && edge.majorAxis) {
                const majX = edge.majorAxis.x;
                const majY = edge.majorAxis.y;
                const rX = Math.sqrt(majX*majX + majY*majY);
                const rY = rX * (edge.ratio || 1);
                const rotation = Math.atan2(majY, majX);
                const start = edge.startAngle || 0;
                const end = edge.endAngle || 2*Math.PI;
                const sCenter = project(edge.center);
                const isCcw = edge.ccw === undefined ? true : edge.ccw;
                ctx.ellipse(sCenter.x, sCenter.y, rX * scale, rY * scale, -rotation, start, end, !isCcw);
            } else if (edge.type === 'SPLINE' && (edge.calculatedPoints || edge.controlPoints)) {
                 const points = edge.calculatedPoints || getBSplinePoints(edge.controlPoints!, edge.degree || 3, edge.knots, edge.weights, 20);
                 points.forEach(p => {
                     const sp = project(p);
                     ctx.lineTo(sp.x, sp.y);
                 });
            }
        });
    }
    ctx.closePath();
}

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
            const theta = 4 * Math.atan(bulge);
            const dist = Math.sqrt((p2.x - p1.x)**2 + (p2.y - p1.y)**2);
            if (dist > 1e-9) {
                const radius = Math.abs(dist / (2 * Math.sin(theta / 2)));
                const a = (p2.x - p1.x) / 2;
                const b = (p2.y - p1.y) / 2;
                const h = (dist / 2) * (1 / bulge - bulge) / 2;
                const cx = p1.x + a - h * (p2.y - p1.y) / dist;
                const cy = p1.y + b + h * (p2.x - p1.x) / dist;
                
                const startAngle = Math.atan2(p1.y - cy, p1.x - cx);
                const endAngle = Math.atan2(p2.y - cy, p2.x - cx);
                
                const sCenter = project({ x: cx, y: cy });
                const sRadius = radius * scale;
                const ccw = bulge < 0; // Reversed because of Y-flip
                ctx.arc(sCenter.x, sCenter.y, sRadius, -startAngle, -endAngle, ccw);
            } else {
                ctx.lineTo(sP2.x, sP2.y);
            }
        }
    }
    if (closed) ctx.closePath();
};

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
    theme: 'black' | 'white'
) => {
    // Clear canvas with background color
    ctx.fillStyle = theme === 'black' ? '#212121' : '#FFFFFF';
    ctx.fillRect(0, 0, width, height);

    const safeZoom = isNaN(viewPort.zoom) || viewPort.zoom === 0 ? 1 : viewPort.zoom;
    const safeTargetX = isNaN(viewPort.targetX) ? 0 : viewPort.targetX;
    const safeTargetY = isNaN(viewPort.targetY) ? 0 : viewPort.targetY;

    const transform: RenderTransform = {
        project: (p: Point2D) => ({
            x: (p.x - safeTargetX) * safeZoom + width / 2,
            y: height / 2 - (p.y - safeTargetY) * safeZoom
        }),
        scale: safeZoom
    };

    // Calculate viewport bounds in world coordinates for culling
    const worldLeft = (0 - width / 2) / safeZoom + safeTargetX;
    const worldRight = (width - width / 2) / safeZoom + safeTargetX;
    const worldTop = (0 - height / 2) / (-safeZoom) + safeTargetY;
    const worldBottom = (height - height / 2) / (-safeZoom) + safeTargetY;

    const vMinX = Math.min(worldLeft, worldRight);
    const vMaxX = Math.max(worldLeft, worldRight);
    const vMinY = Math.min(worldTop, worldBottom);
    const vMaxY = Math.max(worldTop, worldBottom);

    const drawEntity = (ent: AnyEntity, transform: RenderTransform, parentLayerName?: string, parentColor?: string, parentSelected: boolean = false, depth: number = 0) => {
        if (ent.visible === false || depth > 20) return;

        // Culling: check if entity extents overlap viewport
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
        const color = isSelected ? SELECTION_COLOR : getColor(ent, layer, parentColor, theme);
        
        ctx.strokeStyle = color;
        ctx.fillStyle = color;

        // Calculate lineweight
        let lw = ent.lineweight;
        if (lw === undefined || lw === -1) { // ByLayer
            lw = layer?.lineweight !== undefined ? layer.lineweight : -3; 
        }
        if (lw === -3 || lw === -2) lw = 25; // Default 0.25mm

        let baseLw = lw > 0 ? (lw / 25) : 0.8;
        if (baseLw > 2.0) baseLw = 2.0; 
        if (baseLw < 0.5) baseLw = 0.5;
        
        const screenLw = isSelected ? (baseLw + 1.5) : baseLw;
        
        // Since we are now in screen space, lineWidth is just screenLw
        let lineWidth = screenLw;

        // If entity has constant world-space width (Polylines), use it scaled
        if ((ent as any).constantWidth !== undefined && (ent as any).constantWidth > 0) {
            lineWidth = (ent as any).constantWidth * Math.abs(transform.scale);
        }
        
        // Limit maximum screen width to avoid "giant lines"
        const maxScreenPixels = isSelected ? 8 : 4; 
        ctx.lineWidth = Math.min(lineWidth, maxScreenPixels);
        
        // Ensure minimum visibility of 0.5 pixels on screen
        if (ctx.lineWidth < 0.5) ctx.lineWidth = 0.5;

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Apply line dash pattern
        const lineTypeName = (ent.lineType === 'ByLayer' && layer) ? layer.lineType : ent.lineType;
        if (lineTypeName && lineTypeName.toUpperCase() !== 'CONTINUOUS' && lineTypeName.toUpperCase() !== 'BYLAYER' && lineTypeName.toUpperCase() !== 'BYBLOCK') {
            const ltype = lineTypes[lineTypeName] || lineTypes[lineTypeName.toUpperCase()];
            if (ltype && ltype.pattern && ltype.pattern.length > 0) {
                const entityScale = ent.lineTypeScale || 1.0;
                // Pattern scale: LTSCALE * entityScale * transform.scale
                let patternScale = ltScale * entityScale * Math.abs(transform.scale);

                // Optimization: if pattern is too small to see, don't dash
                const totalPatternPixels = ltype.totalLength * patternScale;
                if (totalPatternPixels < 2.0) {
                    ctx.setLineDash([]);
                } else {
                    const dashPattern = ltype.pattern.map(p => Math.abs(p) * patternScale);
                    ctx.setLineDash(dashPattern);
                }
            } else {
                ctx.setLineDash([]);
            }
        } else {
            ctx.setLineDash([]);
        }

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
                // Direction needs to be adjusted for Y-flip
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
                // Y is flipped in screen space, so we negate angles and swap CCW
                ctx.arc(c.x, c.y, ent.radius * transform.scale, -startRad, -endRad, isCcw);
                ctx.stroke();
                break;
            }
            case EntityType.ELLIPSE: {
                const c = transform.project(ent.center);
                const rx = Math.sqrt(ent.majorAxis.x ** 2 + ent.majorAxis.y ** 2) * transform.scale;
                const ry = rx * ent.ratio;
                const rotation = Math.atan2(ent.majorAxis.y, ent.majorAxis.x);
                const isFlipped = (ent.extrusion?.z || 1) < 0;
                
                ctx.beginPath();
                // Y is flipped in screen space, negate rotation and flip param direction
                ctx.ellipse(c.x, c.y, rx, ry, -rotation, ent.startParam || 0, ent.endParam || (Math.PI * 2), !isFlipped);
                ctx.stroke();
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
            case EntityType.SPLINE: {
                const splinePoints = ent.calculatedPoints || getBSplinePoints(ent.controlPoints, ent.degree, ent.knots, ent.weights);
                if (splinePoints.length > 1) {
                    ctx.beginPath();
                    const start = transform.project(splinePoints[0]);
                    ctx.moveTo(start.x, start.y);
                    for(let i=1; i<splinePoints.length; i++) {
                        const p = transform.project(splinePoints[i]);
                        ctx.lineTo(p.x, p.y);
                    }
                    ctx.stroke();
                }
                break;
            }
            case EntityType.TEXT:
            case EntityType.MTEXT: {
                const text = cleanTextContent(ent.value);
                if (!text) break;
                
                let widthFactor = 1;
                const style = styles[ent.styleName || 'STANDARD'];
                const isMText = ent.type === EntityType.MTEXT;
                if (isMText) {
                    const matches = ent.value.match(/\\W(\d+(\.\d+)?);/);
                    if (matches && matches[1]) {
                        widthFactor = parseFloat(matches[1]);
                    } else {
                        widthFactor = style?.widthFactor || 1;
                    }
                } else {
                    widthFactor = (ent.widthFactor !== undefined && ent.widthFactor !== 0) ? ent.widthFactor : (style?.widthFactor || 1);
                }

                ctx.save();
                
                const hAlign = ent.hAlign || 0;
                const vAlign = ent.vAlign || 0;
                const pos = (!isMText && (hAlign !== 0 || vAlign !== 0) && ent.secondPosition) ? ent.secondPosition : ent.position;
                
                const sPos = transform.project(pos);
                ctx.translate(sPos.x, sPos.y);
                
                if (ent.rotation) {
                    // Y-flip means rotation direction is negated
                    ctx.rotate(-ent.rotation * Math.PI / 180);
                }
                
                // Scale text height to pixels
                const textHeightPixels = ent.height * transform.scale;
                const scaleY = 1.0; 
                ctx.scale(widthFactor, scaleY); 
                
                // Update font height for the canvas font
                const originalHeight = ent.height;
                ent.height = textHeightPixels;
                ctx.font = getCanvasFont(ent, styles);
                ent.height = originalHeight; // Restore for next use
                
                let align: CanvasTextAlign = 'left';
                let baseline: CanvasTextBaseline = 'alphabetic';
                let dy = 0;

                if (isMText) {
                    const wrapW = (ent.width || 0) * transform.scale;
                    const lines = wrapText(ctx, text, wrapW);
                    const lineHeight = textHeightPixels * 1.67; 
                    const totalHeight = lines.length * lineHeight;
                    const ap = ent.attachmentPoint || 1;
                    
                    if ([2, 5, 8].includes(ap)) align = 'center';
                    else if ([3, 6, 9].includes(ap)) align = 'right';
                    
                    if ([1, 2, 3].includes(ap)) dy = 0; 
                    if ([4, 5, 6].includes(ap)) dy = -totalHeight / 2; 
                    if ([7, 8, 9].includes(ap)) dy = -totalHeight; 
                    
                    baseline = 'top'; 
                    ctx.textAlign = align;
                    ctx.textBaseline = baseline;
                    
                    lines.forEach((line, i) => {
                        ctx.fillText(line, 0, dy + i * lineHeight);
                    });
                } else {
                    if (hAlign === 1 || hAlign === 4) align = 'center';
                    else if (hAlign === 2) align = 'right';
                    else if (hAlign === 3) align = 'left';
                    else if (hAlign === 5) align = 'center';

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
            }
            case EntityType.ACAD_TABLE:
            case EntityType.INSERT: {
                const block = blocks[ent.blockName];
                if (!block) break;

                const scale = ent.scale || { x: 1, y: 1, z: 1 };
                const rotation = (ent.rotation || 0) * Math.PI / 180;
                const cosR = Math.cos(rotation);
                const sinR = Math.sin(rotation);
                
                // Create nested transform
                const nestedTransform: RenderTransform = {
                    project: (p: Point2D) => {
                        // 1. Apply block internal translation (relative to block base point)
                        const px = p.x - block.basePoint.x;
                        const py = p.y - block.basePoint.y;
                        
                        // 2. Apply scale
                        const sx = px * scale.x;
                        const sy = py * scale.y;
                        
                        // 3. Apply rotation
                        const rx = sx * cosR - sy * sinR;
                        const ry = sx * sinR + sy * cosR;
                        
                        // 4. Translate to insert position
                        const tx = rx + ent.position.x;
                        const ty = ry + ent.position.y;
                        
                        // 5. Apply parent project
                        return transform.project({ x: tx, y: ty });
                    },
                    scale: transform.scale * Math.abs(scale.x) // Simplified scale for nested lineweights
                };

                const layerName = (ent.layer === '0' && parentLayerName) ? parentLayerName : ent.layer;
                block.entities.forEach(child => drawEntity(child, nestedTransform, layerName, color, isSelected, depth + 1));
                if ((ent as any).attributes) {
                    (ent as any).attributes.forEach((attr: AnyEntity) => drawEntity(attr, nestedTransform, layerName, color, isSelected, depth + 1));
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
                if (block) {
                    const layerName = (ent.layer === '0' && parentLayerName) ? parentLayerName : ent.layer;
                    // Dimensions are essentially INSERTS of their block with identity transform
                    const nestedTransform: RenderTransform = {
                        project: (p: Point2D) => transform.project(p),
                        scale: transform.scale
                    };
                    block.entities.forEach(child => drawEntity(child, nestedTransform, layerName, color, isSelected, depth + 1));
                }
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
                
                if (ent.hasHookLine) {
                     const last = pts[pts.length-1];
                     const prev = pts[pts.length-2];
                     const dx = last.x - prev.x;
                     const hookLen = 2.5; 
                     const dir = dx >= 0 ? 1 : -1;
                     const sp = transform.project({ x: last.x + dir * hookLen, y: last.y });
                     ctx.lineTo(sp.x, sp.y);
                }
                ctx.stroke();

                if (ent.arrowHeadFlag === 1) {
                    const p1 = transform.project(pts[0]);
                    const p2 = transform.project(pts[1]);
                    const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
                    const s = 2.5 * transform.scale; 
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

    entities.forEach(ent => drawEntity(ent, transform, undefined, undefined, false, 0));
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
    // Map of block names to dimension entities that use them
    const blockToDimensionMap = new Map<string, string>();
    entities.forEach(ent => {
        if (ent.type === EntityType.DIMENSION && ent.blockName) {
            blockToDimensionMap.set(ent.blockName, ent.id);
        }
    });

    const checkEntity = (ent: AnyEntity, tx?: (p: Point2D) => Point2D, depth: number = 0): boolean => {
        if (ent.visible === false || depth > 20) return false;

        const layer = layers[ent.layer];
        if (layer && layer.isVisible === false) return false;

        const p = tx ? tx : (pt: Point2D) => pt;
        
        // Use a larger threshold for text and small points to make them easier to select
        const isTextEntity = [EntityType.TEXT, EntityType.MTEXT, EntityType.ATTRIB, EntityType.ATTDEF].includes(ent.type);
        const effectiveThreshold = isTextEntity ? (threshold * 1.5) : threshold;

        // Bounding Box Selection Optimization
        // If entity has precomputed extents, use them for the primary hit test
        if (ent.extents) {
            const { min, max } = ent.extents;
            // Add a small buffer (threshold) to the bounding box
            const insideBox = x >= min.x - effectiveThreshold && x <= max.x + effectiveThreshold && 
                             y >= min.y - effectiveThreshold && y <= max.y + effectiveThreshold;
            
            if (!insideBox) return false;

            // For Text, MText, and Blocks, bounding box hit is sufficient and preferred
            const isContainerOrText = [
                EntityType.TEXT, 
                EntityType.MTEXT, 
                EntityType.INSERT, 
                EntityType.DIMENSION,
                EntityType.HATCH,
                EntityType.ACAD_TABLE
            ].includes(ent.type);

            if (isContainerOrText) return true;
        }

        // Geometric precise checks for other entities (or if no extents)
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
                            
                            // Normalize angles to [0, 2PI)
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
                                // For CW, swap start/end to use CCW logic
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
             const points = getBSplinePoints(ent.controlPoints, ent.degree, ent.knots, ent.weights, 20);
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
        } else if (ent.type === EntityType.INSERT) {
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
        }
        return false;
    };

    // First check dimensions to allow selecting them as a whole
    for (const ent of entities) {
        if (ent.type === EntityType.DIMENSION) {
            if (checkEntity(ent)) return ent.id;
        }
    }

    // Then check other entities
    for (let i = entities.length - 1; i >= 0; i--) {
        const ent = entities[i];
        if (ent.type !== EntityType.DIMENSION && checkEntity(ent)) return ent.id;
    }
    return null;
};

export const hitTestBox = (box: {x1:number, y1:number, x2:number, y2:number}, entities: AnyEntity[], layers: Record<string, DxfLayer>, blocks: Record<string, DxfBlock> = {}): Set<string> => {
    const results = new Set<string>();
    const minX = Math.min(box.x1, box.x2), maxX = Math.max(box.x1, box.x2);
    const minY = Math.min(box.y1, box.y2), maxY = Math.max(box.y1, box.y2);

    entities.forEach(ent => {
        const layer = layers[ent.layer];
        if (layer && layer.isVisible === false) return;

        if (ent.extents) {
            const { min, max } = ent.extents;
            // A simple overlap check between the selection box and the entity extents
            const overlap = !(max.x < minX || min.x > maxX || max.y < minY || min.y > maxY);
            if (overlap) {
                results.add(ent.id);
            }
        } else {
            // Fallback for entities without extents
            if (ent.type === EntityType.POINT && ent.position) {
                if (ent.position.x >= minX && ent.position.x <= maxX && ent.position.y >= minY && ent.position.y <= maxY) {
                    results.add(ent.id);
                }
            }
        }
    });

    return results;
};