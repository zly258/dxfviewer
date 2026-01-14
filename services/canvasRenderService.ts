import { AnyEntity, EntityType, DxfLayer, DxfBlock, DxfStyle, Point2D, DxfInsert, HatchLoop, DxfText, DxfLineType } from '../types';
import { AUTO_CAD_COLORS, DEFAULT_COLOR, getAutoCadColor } from '../constants';
import { getBSplinePoints } from './dxfService';
import { getStyleFontFamily, FONT_STACKS, mapCadFontToWebFont } from './fontService';

const SELECTION_COLOR = '#0078d4'; 

const getColor = (entColor: number | undefined, layer: DxfLayer | undefined, parentColor: string | undefined): string => {
    if (entColor === 0 && parentColor) return parentColor; // ByBlock
    if (entColor === 256 || entColor === undefined) { // ByLayer
        return layer ? getAutoCadColor(layer.color) : DEFAULT_COLOR;
    }
    return getAutoCadColor(entColor);
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

const drawHatchLoop = (ctx: CanvasRenderingContext2D, loop: HatchLoop, ox: number, oy: number, isFlipped: boolean = false) => {
    if (loop.isPolyline && loop.points && loop.points.length > 0) {
        const points = loop.points;
        const bulges = loop.bulges || [];
        ctx.moveTo(points[0].x - ox, points[0].y - oy);
        for (let i = 0; i < points.length; i++) {
            const p1 = points[i];
            const p2 = points[(i + 1) % points.length];
            const bulge = bulges[i] || 0;
            if (Math.abs(bulge) < 1e-6) {
                ctx.lineTo(p2.x - ox, p2.y - oy);
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
                    
                    let ccw = bulge > 0;
                    if (isFlipped) ccw = !ccw;
                    
                    ctx.arc(cx - ox, cy - oy, radius, startAngle, endAngle, !ccw); 
                } else {
                    ctx.lineTo(p2.x - ox, p2.y - oy);
                }
            }
        }
    } else if (loop.edges && loop.edges.length > 0) {
        loop.edges.forEach((edge, i) => {
            if (i === 0 && edge.start) ctx.moveTo(edge.start.x - ox, edge.start.y - oy);
            else if (edge.start) ctx.lineTo(edge.start.x - ox, edge.start.y - oy); 

            if (edge.type === 'LINE' && edge.end) {
                ctx.lineTo(edge.end.x - ox, edge.end.y - oy);
            } else if (edge.type === 'ARC' && edge.center && edge.radius) {
                const start = (edge.startAngle || 0) * Math.PI / 180;
                let end = (edge.endAngle || 0) * Math.PI / 180;
                let ccw = edge.ccw === undefined ? true : edge.ccw; 
                if (isFlipped) ccw = !ccw;
                ctx.arc(edge.center.x - ox, edge.center.y - oy, edge.radius, start, end, !ccw); 
            } else if (edge.type === 'ELLIPSE' && edge.center && edge.majorAxis) {
                const majX = edge.majorAxis.x;
                const majY = edge.majorAxis.y;
                const rX = Math.sqrt(majX*majX + majY*majY);
                const rY = rX * (edge.ratio || 1);
                const rotation = Math.atan2(majY, majX);
                const start = edge.startAngle || 0;
                const end = edge.endAngle || 2*Math.PI;
                let ccw = edge.ccw === undefined ? true : edge.ccw;
                if (isFlipped) ccw = !ccw;
                ctx.ellipse(edge.center.x - ox, edge.center.y - oy, rX, rY, rotation, start, end, !ccw);
            } else if (edge.type === 'SPLINE' && (edge.calculatedPoints || edge.controlPoints)) {
                 const points = edge.calculatedPoints || getBSplinePoints(edge.controlPoints!, edge.degree || 3, edge.knots, edge.weights, 20);
                 points.forEach(p => ctx.lineTo(p.x - ox, p.y - oy));
            }
        });
    }
    ctx.closePath();
}

const drawPolyline = (ctx: CanvasRenderingContext2D, points: Point2D[], bulges: number[] | undefined, closed: boolean, ox: number, oy: number, isFlipped: boolean = false) => {
    if (points.length < 1) return;
    ctx.moveTo(points[0].x - ox, points[0].y - oy);
    for (let i = 0; i < (closed ? points.length : points.length - 1); i++) {
        const p1 = points[i];
        const p2 = points[(i + 1) % points.length];
        const bulge = bulges ? (bulges[i] || 0) : 0;
        
        if (Math.abs(bulge) < 1e-6) {
            ctx.lineTo(p2.x - ox, p2.y - oy);
        } else {
            const theta = 4 * Math.atan(bulge);
            const dist = Math.sqrt((p2.x - p1.x)**2 + (p2.y - p1.y)**2);
            if (dist > 1e-9) {
                const radius = Math.abs(dist / (2 * Math.sin(theta / 2)));
                // Center calculation for bulge arc
                const a = (p2.x - p1.x) / 2;
                const b = (p2.y - p1.y) / 2;
                const h = (dist / 2) * (1 / bulge - bulge) / 2;
                const cx = p1.x + a - h * (p2.y - p1.y) / dist;
                const cy = p1.y + b + h * (p2.x - p1.x) / dist;
                
                const startAngle = Math.atan2(p1.y - cy, p1.x - cx);
                const endAngle = Math.atan2(p2.y - cy, p2.x - cx);
                
                let ccw = bulge > 0;
                if (isFlipped) ccw = !ccw;
                
                ctx.arc(cx - ox, cy - oy, radius, startAngle, endAngle, !ccw);
            } else {
                ctx.lineTo(p2.x - ox, p2.y - oy);
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
    viewPort: { x: number, y: number, zoom: number },
    selectedIds: Set<string>,
    width: number,
    height: number,
    offset: Point2D
) => {
    // Clear canvas - use absolute coordinates to avoid precision issues
    ctx.clearRect(0, 0, width * window.devicePixelRatio || 1, height * window.devicePixelRatio || 1);

    ctx.save();
    ctx.translate(viewPort.x, viewPort.y);
    ctx.scale(viewPort.zoom, -viewPort.zoom);
    // Apply offset to maintain precision with large coordinates
    ctx.translate(-(offset.x || 0), -(offset.y || 0));

    const drawEntity = (ent: AnyEntity, parentLayerName?: string, parentColor?: string, currentScale: number = viewPort.zoom, parentSelected: boolean = false, depth: number = 0, ox: number = offset.x, oy: number = offset.y) => {
        if (ent.visible === false || depth > 20) return;

        const layerName = (ent.layer === '0' && parentLayerName) ? parentLayerName : ent.layer;
        const layer = layers[layerName];
        if (layer && layer.isVisible === false) return;

        const isSelected = selectedIds.has(ent.id) || parentSelected;

        const color = isSelected ? SELECTION_COLOR : getColor(ent.color, layer, parentColor);
        
        ctx.strokeStyle = color;
        ctx.fillStyle = color;

    // Calculate lineweight
    // DXF lineweight is in hundredths of mm. e.g. 25 = 0.25mm.
    // Standard default is usually 25 (0.25mm).
    let lw = ent.lineweight;
    if (lw === undefined || lw === -1) { // ByLayer
        lw = layer?.lineweight !== undefined ? layer.lineweight : -3; // Default
    }
    if (lw === -3) lw = 25; // Default 0.25mm
    if (lw === -2) lw = 25; // ByBlock -> treat as default for now

    // Convert mm to screen pixels.
    // A simple heuristic: 0.25mm -> 1.0 pixel, 0.50mm -> 2.0 pixels, etc.
    // Lineweight in DXF is fixed-width on screen/paper, not world units.
    const lwInPixels = lw > 0 ? (lw / 25) : 0.5; // 0.5 for hairline/0

    // Clamp lineweight to prevent rendering artifacts with extreme zoom levels
    const safeScale = Math.max(Math.min(Math.abs(currentScale), 1e12), 1e-12);
    const lineWidth = (isSelected ? (lwInPixels + 1) : lwInPixels) / safeScale;
    ctx.lineWidth = Math.max(Math.min(lineWidth, 1000), 0.1);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

        // Apply line dash pattern
        const lineTypeName = (ent.lineType === 'ByLayer' && layer) ? layer.lineType : ent.lineType;
        if (lineTypeName && lineTypeName.toUpperCase() !== 'CONTINUOUS' && lineTypeName.toUpperCase() !== 'BYLAYER' && lineTypeName.toUpperCase() !== 'BYBLOCK') {
            const ltype = lineTypes[lineTypeName] || lineTypes[lineTypeName.toUpperCase()];
            if (ltype && ltype.pattern && ltype.pattern.length > 0) {
                // Scale pattern by LTSCALE and entity's lineTypeScale
                const entityScale = ent.lineTypeScale || 1.0;
                let scale = ltScale * entityScale;

                // Enhanced visibility optimization: ensure the pattern is clearly visible at all zoom levels
                // Use adaptive minimum based on zoom level to maintain consistent visibility
                const minDashPixels = 4.0; // Minimum dash segment in pixels
                const minGapPixels = 2.0;  // Minimum gap segment in pixels
                const patternScreenSize = ltype.totalLength * scale * Math.abs(viewPort.zoom);

                // Find the smallest positive dash or gap segment in the pattern
                const minSegment = ltype.pattern.reduce((min, p) => {
                    const absP = Math.abs(p);
                    return absP > 0 && absP < min ? absP : min;
                }, Infinity);

                if (minSegment !== Infinity && minSegment > 0) {
                    const minSegmentScreen = minSegment * scale * Math.abs(viewPort.zoom);
                    // Calculate required scale boost to make smallest segment visible
                    const minRequired = Math.min(minDashPixels, minGapPixels);
                    if (minSegmentScreen < minRequired) {
                        scale *= (minRequired / minSegmentScreen);
                    }
                }

                const dashPattern = ltype.pattern.map(p => Math.abs(p) * scale);
                ctx.setLineDash(dashPattern);
            } else {
                ctx.setLineDash([]);
            }
        } else {
            ctx.setLineDash([]);
        }

        switch (ent.type) {
            case EntityType.LINE:
                ctx.beginPath();
                ctx.moveTo(ent.start.x - ox, ent.start.y - oy);
                ctx.lineTo(ent.end.x - ox, ent.end.y - oy);
                ctx.stroke();
                break;
            case EntityType.RAY: {
                const farPoint = {
                    x: ent.basePoint.x + ent.direction.x * 1000000,
                    y: ent.basePoint.y + ent.direction.y * 1000000
                };
                ctx.beginPath();
                ctx.moveTo(ent.basePoint.x - ox, ent.basePoint.y - oy);
                ctx.lineTo(farPoint.x - ox, farPoint.y - oy);
                ctx.stroke();
                break;
            }
            case EntityType.XLINE: {
                const p1 = {
                    x: ent.basePoint.x - ent.direction.x * 1000000,
                    y: ent.basePoint.y - ent.direction.y * 1000000
                };
                const p2 = {
                    x: ent.basePoint.x + ent.direction.x * 1000000,
                    y: ent.basePoint.y + ent.direction.y * 1000000
                };
                ctx.beginPath();
                ctx.moveTo(p1.x - ox, p1.y - oy);
                ctx.lineTo(p2.x - ox, p2.y - oy);
                ctx.stroke();
                break;
            }
            case EntityType.POINT:
                ctx.beginPath();
                ctx.arc(ent.position.x - ox, ent.position.y - oy, 2/viewPort.zoom, 0, 2*Math.PI);
                ctx.fill();
                break;
            case EntityType.CIRCLE:
                ctx.beginPath();
                ctx.arc(ent.center.x - ox, ent.center.y - oy, ent.radius, 0, 2 * Math.PI);
                ctx.stroke();
                break;
            case EntityType.ARC: {
                const isCcw = ent.isCounterClockwise !== false;
                let startRad = (ent.startAngle || 0) * Math.PI / 180;
                let endRad = (ent.endAngle || 0) * Math.PI / 180;
                
                ctx.beginPath();
                ctx.arc(ent.center.x - ox, ent.center.y - oy, ent.radius, startRad, endRad, !isCcw);
                ctx.stroke();
                break;
            }
            case EntityType.ELLIPSE: {
                const rx = Math.sqrt(ent.majorAxis.x ** 2 + ent.majorAxis.y ** 2);
                const ry = rx * ent.ratio;
                const rotation = Math.atan2(ent.majorAxis.y, ent.majorAxis.x);
                const isFlipped = (ent.extrusion?.z || 1) < 0;
                
                ctx.beginPath();
                ctx.ellipse(ent.center.x - ox, ent.center.y - oy, rx, ry, rotation, ent.startParam || 0, ent.endParam || (Math.PI * 2), isFlipped);
                ctx.stroke();
                break;
            }
            case EntityType.LWPOLYLINE:
            case EntityType.POLYLINE:
                if (ent.points.length > 1) {
                    ctx.beginPath();
                    drawPolyline(ctx, ent.points, ent.bulges, ent.closed, ox, oy, (ent.extrusion?.z || 1) < 0);
                    ctx.stroke();
                }
                break;
            case EntityType.SPLINE:
                const splinePoints = ent.calculatedPoints || getBSplinePoints(ent.controlPoints, ent.degree, ent.knots, ent.weights);
                if (splinePoints.length > 1) {
                    ctx.beginPath();
                    ctx.moveTo(splinePoints[0].x - ox, splinePoints[0].y - oy);
                    for(let i=1; i<splinePoints.length; i++) ctx.lineTo(splinePoints[i].x - ox, splinePoints[i].y - oy);
                    ctx.stroke();
                }
                break;
            case EntityType.TEXT:
            case EntityType.MTEXT:
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
                // For TEXT: if alignment is set, use secondPosition.
                const pos = (!isMText && (hAlign !== 0 || vAlign !== 0) && ent.secondPosition) ? ent.secondPosition : ent.position;
                
                ctx.translate(pos.x - ox, pos.y - oy);
                if (ent.rotation) ctx.rotate(ent.rotation * Math.PI / 180);
                
                ctx.scale(widthFactor, -1); 
                
                ctx.font = getCanvasFont(ent, styles);
                
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
            case EntityType.ACAD_TABLE:
            case EntityType.INSERT: {
                const block = blocks[ent.blockName];
                if (!block) break;

                const scale = ent.scale || { x: 1, y: 1, z: 1 };
                const blockScale = Math.abs(scale.x * currentScale);

                ctx.save();
                ctx.translate(ent.position.x - ox, ent.position.y - oy);
                
                if (ent.type === EntityType.ACAD_TABLE && (ent as any).direction) {
                    const dir = (ent as any).direction;
                    if (dir.x !== 0 || dir.y !== 0) {
                        ctx.rotate(Math.atan2(dir.y, dir.x));
                    }
                } else if (ent.rotation) {
                    ctx.rotate(ent.rotation * Math.PI / 180);
                }

                if (ent.scale) ctx.scale(ent.scale.x, ent.scale.y);
                ctx.translate(-block.basePoint.x, -block.basePoint.y);

                const layerName = (ent.layer === '0' && parentLayerName) ? parentLayerName : ent.layer;
                // Important: for children, ox/oy are 0 because we already translated to ent.position - ox/oy
                block.entities.forEach(child => drawEntity(child, layerName, color, blockScale, isSelected, depth + 1, 0, 0));

                // Draw attributes if any
                if ((ent as any).attributes) {
                    (ent as any).attributes.forEach((attr: AnyEntity) => drawEntity(attr, layerName, color, blockScale, isSelected, depth + 1, 0, 0));
                }

                ctx.restore();
                break;
            }
            case EntityType.HATCH: {
                ctx.save();
                ctx.beginPath();
                ent.loops.forEach(loop => drawHatchLoop(ctx, loop, ox, oy, ent.isFlipped || false));
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
            }
            case EntityType.DIMENSION: {
                const block = blocks[ent.blockName];
                if (block) {
                    const layerName = (ent.layer === '0' && parentLayerName) ? parentLayerName : ent.layer;
                    block.entities.forEach(child => {
                        let childEnt = child;
                        // Propagate Dimension color to its block components (Text, Arrows, etc)
                        // if they are ByLayer (256) or ByBlock (0).
                        if (child.color === undefined || child.color === 256 || child.color === 0) {
                             childEnt = { ...child, color: 0 }; 
                        }
                        // Use ox/oy for top-level dimension block entities
                        drawEntity(childEnt, layerName, color, currentScale, isSelected, depth + 1, ox, oy);
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
                         const layerName = (ent.layer === '0' && parentLayerName) ? parentLayerName : ent.layer;
                         drawEntity(tempText, layerName, color, currentScale, isSelected, depth + 1, ox, oy);
                     }
                }
                break;
            }
            case EntityType.SOLID:
            case EntityType.THREEDFACE: {
                if (ent.points.length < 3) break;
                
                if (ent.type === EntityType.SOLID) {
                    ctx.beginPath();
                    ctx.moveTo(ent.points[0].x - ox, ent.points[0].y - oy);
                    for (let i = 1; i < ent.points.length; i++) {
                        ctx.lineTo(ent.points[i].x - ox, ent.points[i].y - oy);
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
                            ctx.moveTo(p1.x - ox, p1.y - oy);
                            ctx.lineTo(p2.x - ox, p2.y - oy);
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
                ctx.moveTo(pts[0].x - ox, pts[0].y - oy);
                pts.slice(1).forEach(p => ctx.lineTo(p.x - ox, p.y - oy));
                
                if (ent.hasHookLine) {
                     const last = pts[pts.length-1];
                     const prev = pts[pts.length-2];
                     const dx = last.x - prev.x;
                     const hookLen = 2.5; 
                     const dir = dx >= 0 ? 1 : -1;
                     ctx.lineTo(last.x + dir * hookLen - ox, last.y - oy);
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
                    ctx.moveTo(p1.x - ox, p1.y - oy);
                    ctx.lineTo(p1.x + Math.cos(a1)*s - ox, p1.y + Math.sin(a1)*s - oy);
                    ctx.lineTo(p1.x + Math.cos(a2)*s - ox, p1.y + Math.sin(a2)*s - oy);
                    ctx.closePath();
                    ctx.fillStyle = color;
                    ctx.fill();
                }
                break;
            }
        }
    };

    entities.forEach(ent => drawEntity(ent, undefined, undefined, viewPort.zoom, false, 0, offset.x, offset.y));
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