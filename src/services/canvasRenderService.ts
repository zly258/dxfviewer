import { AnyEntity, EntityType, DxfLayer, DxfBlock, DxfStyle, Point2D, DxfInsert, HatchLoop, DxfText, DxfLineType, ViewPort } from '../types';
import { DEFAULT_COLOR } from '../constants';
import { getAutoCadColor, AUTO_CAD_COLORS, trueColorToHex } from '../utils/colorUtils';
import { getBSplinePoints, cleanMText } from './dxfService';
import { getStyleFontFamily, FONT_STACKS, mapCadFontToWebFont } from './fontService';

const SELECTION_COLOR = '#0078d4'; // 选中颜色

/**
 * 获取实体颜色
 */
const getColor = (ent: AnyEntity, layer: DxfLayer | undefined, parentColor: string | undefined, theme: 'black' | 'white' | 'gray'): string => {
    if (ent.trueColor !== undefined) return trueColorToHex(ent.trueColor);
    const entColor = ent.color;
    if (entColor === 0 && parentColor) return parentColor; // 随块 (ByBlock)
    if (entColor === 256 || entColor === undefined) { // 随层 (ByLayer)
        if (layer?.trueColor !== undefined) return trueColorToHex(layer.trueColor);
        const bgIsDark = theme === 'black' || theme === 'gray';
        return layer ? getAutoCadColor(layer.color, theme) : (bgIsDark ? '#FFFFFF' : '#000000');
    }
    return getAutoCadColor(entColor, theme);
};

/**
 * 获取画布字体样式
 */
const getCanvasFont = (ent: AnyEntity, styles: Record<string, DxfStyle> | undefined): string => {
    const textEnt = (ent.type === EntityType.TEXT || ent.type === EntityType.MTEXT || ent.type === EntityType.ATTRIB || ent.type === EntityType.ATTDEF) ? (ent as DxfText) : null;
    let height = textEnt ? (textEnt.height || 2.5) : 2.5;
    
    // 高度优先级：1. 内联覆盖, 2. 实体高度, 3. 样式高度, 4. 默认值 2.5
    const styleName = textEnt?.styleName || 'STANDARD';
    const style = styles?.[styleName] || styles?.[styleName.toUpperCase()];
    if (height <= 0) {
        height = style?.height || 2.5;
    }

    let fontFamily = getStyleFontFamily(styleName, styles);
    let fontWeight = 'normal';
    let fontStyle = 'normal';
    
    // 更好的 TrueType 字体检测：
    // 1. 样式字体名称以 .ttf/.otf 结尾
    // 2. 它是标准网页字体之一
    const styleFontLower = (style?.fontFileName || "").toLowerCase();
    let isTrueType = styleFontLower.endsWith('.ttf') || styleFontLower.endsWith('.otf') || 
                     styleFontLower.includes('simsun') || styleFontLower.includes('simhei') || 
                     styleFontLower.includes('arial') || styleFontLower.includes('msyh');

    // 检查 MTEXT 内联高度覆盖 \H...;
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
                    fontFamily = FONT_STACKS.FANGSONG; // 即使在 \f 覆盖中也将 SimSun 映射到 FangSong
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

    // 根据字体类型调整高度
    // SHX 字体（已映射）通常比 TrueType 字体需要更大的乘数
    // 调整：优化缩放比例以解决文字间距偏大的问题，SHX 映射字体从 1.1 降至 1.05
    const scaleFactor = isTrueType ? 1.0 : 1.05;
    const correctedHeight = height * scaleFactor; 

    return `${fontStyle} ${fontWeight} ${correctedHeight}px ${fontFamily}`;
};

/**
 * 清理文本内容，移除 MText 格式化代码
 */
const cleanTextContent = (text: string): string => {
    if (!text) return "";
    return text
        .replace(/\\P/g, '\n')
        .replace(/\\\{/g, '')
        .replace(/\\\}/g, '')
        .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))) // Unicode \U+XXXX
        .replace(/\\S([^^]+)\^([^;]+);/g, '$1/$2') // 堆叠文字 \S...^...; -> .../...
        .replace(/\\[A-Z][^;\\}]*(?:;|(?=[\\}]|$))/gi, '') // 安全地处理带或不带分号的代码
        .replace(/\{|\}/g, '')
        .replace(/%%[cC]/g, 'Ø')
        .replace(/%%[dD]/g, '°')
        .replace(/%%[pP]/g, '±')
        .trim();
};

/**
 * 文本换行处理（支持中英文混合）
 */
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
            const width = ctx.measureText(testLine).width;
            
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
                    
                    // 注意：在屏幕空间中，我们使用 project，它已经处理了 Y 轴翻转
                    // 但 arc() 仍然需要一个方向。
                    // 如果 CAD 是逆时针 (CCW)，且 Y 轴翻转，则在屏幕上变为顺时针 (CW)。
                    const ccw = bulge < 0; // 因为 Y 轴翻转而反转
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
                // 注意：isCcw 标志似乎与我们期望的方向相反
                // 当 ccw=false 时，在 CAD 中实际上是顺时针，但我们翻转了 Y 轴
                // 所以我们可能需要根据翻转情况取反
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
                const ccw = bulge < 0; // 因为 Y 轴翻转而反转
                ctx.arc(sCenter.x, sCenter.y, sRadius, -startAngle, -endAngle, ccw);
            } else {
                ctx.lineTo(sP2.x, sP2.y);
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
    theme: 'black' | 'white' | 'gray'
) => {
    // 使用背景颜色清除画布
    if (theme === 'white') ctx.fillStyle = '#FFFFFF';
    else if (theme === 'gray') ctx.fillStyle = '#808080';
    else ctx.fillStyle = '#212121';
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

    const drawEntity = (ent: AnyEntity, transform: RenderTransform, parentLayerName?: string, parentColor?: string, parentSelected: boolean = false, depth: number = 0) => {
        if (ent.visible === false || depth > 20) return;

        // 剔除 (Culling)：检查实体范围是否与视口重叠
        // depth === 0 表示顶层实体，通常只有顶层实体具有预计算的包围盒
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

        // 计算线宽 (Lineweight)
        let lw = ent.lineweight;
        if (lw === undefined || lw === -1) { // 随层 (ByLayer)
            lw = layer?.lineweight !== undefined ? layer.lineweight : -3; 
        }
        if (lw === -3 || lw === -2) lw = 25; // 默认 0.25mm

        // 将 CAD 线宽单位 (1/100 mm) 转换为屏幕像素
        let baseLw = lw > 0 ? (lw / 25) : 0.8;
        if (baseLw > 2.0) baseLw = 2.0; 
        if (baseLw < 0.5) baseLw = 0.5;
        
        const screenLw = isSelected ? (baseLw + 1.5) : baseLw;
        
        // 如果是在屏幕空间渲染，lineWidth 即为 screenLw
        let lineWidth = screenLw;

        // 如果实体具有恒定的世界空间宽度（如带宽度的多段线），则使用缩放后的宽度
        if ((ent as any).constantWidth !== undefined && (ent as any).constantWidth > 0) {
            lineWidth = (ent as any).constantWidth * Math.abs(transform.scale);
        }
        
        // 限制最大屏幕像素宽度，避免在高缩放比例下出现“巨大的线”
        const maxScreenPixels = isSelected ? 8 : 4; 
        ctx.lineWidth = Math.min(lineWidth, maxScreenPixels);
        
        // 确保在屏幕上至少有 0.5 像素的可见度
        if (ctx.lineWidth < 0.5) ctx.lineWidth = 0.5;

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // 应用线型 (Linetype) 虚线图案
        const lineTypeName = (ent.lineType === 'ByLayer' && layer) ? layer.lineType : ent.lineType;
        if (lineTypeName && lineTypeName.toUpperCase() !== 'CONTINUOUS' && lineTypeName.toUpperCase() !== 'BYLAYER' && lineTypeName.toUpperCase() !== 'BYBLOCK') {
            const ltype = lineTypes[lineTypeName] || lineTypes[lineTypeName.toUpperCase()];
            if (ltype && ltype.pattern && ltype.pattern.length > 0) {
                const entityScale = ent.lineTypeScale || 1.0;
                // 虚线图案缩放：全局 LTSCALE * 实体比例 * 当前变换比例
                let patternScale = ltScale * entityScale * Math.abs(transform.scale);

                // 优化：如果缩放后的图案太小以至于无法辨认，则不使用虚线，直接画实线
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
                const c = transform.project(ent.center);
                const rx = Math.sqrt(ent.majorAxis.x ** 2 + ent.majorAxis.y ** 2) * transform.scale;
                const ry = rx * ent.ratio;
                const rotation = Math.atan2(ent.majorAxis.y, ent.majorAxis.x);
                const isFlipped = (ent.extrusion?.z || 1) < 0;
                
                ctx.beginPath();
                // 屏幕空间 Y 轴翻转，取反旋转并翻转参数方向
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
                
                // 如果有预解析的宽度因子则使用它，否则尝试解析它
                if (ent.widthFactor !== undefined && ent.widthFactor !== 0) {
                    widthFactor = ent.widthFactor;
                } else if (isMText) {
                    const matches = ent.value.match(/\\[Ww](\d+(\.\d+)?)(?:;|$)/);
                    if (matches && matches[1]) {
                        widthFactor = parseFloat(matches[1]);
                    } else {
                        widthFactor = style?.widthFactor || 1;
                    }
                } else {
                    widthFactor = style?.widthFactor || 1;
                }

                ctx.save();
                
                const hAlign = ent.hAlign || 0;
                const vAlign = ent.vAlign || 0;
                const pos = (!isMText && (hAlign !== 0 || vAlign !== 0) && ent.secondPosition) ? ent.secondPosition : ent.position;
                
                const sPos = transform.project(pos);
                ctx.translate(sPos.x, sPos.y);
                
                const totalRotation = ((ent.rotation || 0) * Math.PI / 180) + transform.rotation;
                if (totalRotation !== 0) {
                    // Y轴翻转意味着旋转方向取反
                    ctx.rotate(-totalRotation);
                }
                
                // 将文本高度缩放到像素
                const textHeightPixels = ent.height * transform.scale;
                const scaleY = 1.0; 
                ctx.scale(widthFactor, scaleY); 
                
                // 为画布字体更新字体高度
                const originalHeight = ent.height;
                ent.height = textHeightPixels;
                ctx.font = getCanvasFont(ent, styles);
                ent.height = originalHeight; // 恢复以供下次使用
                
                let align: CanvasTextAlign = 'left';
                let baseline: CanvasTextBaseline = 'alphabetic';
                let dy = 0;

                if (isMText) {
                    const wrapW = (ent.width || 0) * transform.scale;
                    const lines = wrapText(ctx, text, wrapW);
                    // 调整：行高倍数优化，使其更符合 CAD 渲染效果
                    const lineHeight = textHeightPixels * 1.2; 
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
                    // 普通文本对齐逻辑优化
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
                let block = blocks[ent.blockName];
                
                // 如果未设置或找不到 blockName，则为 ACAD_TABLE 提供兜底处理
                if (ent.type === EntityType.ACAD_TABLE && !block) {
                    // 尝试查找以 *T 开头且可能相关的块
                    // （这是一种 hack 手法，但表格的匿名块通常以 *T 开头）
                    if (!ent.blockName) {
                        // 如果没有 blockName，除了单元格内容兜底外，目前无法做更多处理
                    }
                }

                if (!block) {
                        // 绘制表格绘制兜底：如果找不到对应的块定义，则尝试手动绘制网格
                        if (ent.type === EntityType.ACAD_TABLE) {
                            const table = ent as any;
                            const rowCount = table.rowCount || 1;
                            const colCount = table.columnCount || 1;
                            const rowSpacing = table.rowSpacing || 10;
                            const colSpacing = table.columnSpacing || 50;
                            const scale = table.scale || { x: 1, y: 1, z: 1 };
                            
                            ctx.save();
                            const sPos = transform.project(ent.position);
                            ctx.translate(sPos.x, sPos.y);
                            const rotation = (table.rotation || 0) * Math.PI / 180;
                            ctx.rotate(-rotation);
                            
                            // 绘制表格外边框和内部网格
                            ctx.beginPath();
                            const totalWidth = colCount * colSpacing * scale.x;
                            const totalHeight = rowCount * rowSpacing * scale.y;
                            
                            const sScale = transform.scale;
                            
                            // 绘制横线 (水平线)
                            for (let i = 0; i <= rowCount; i++) {
                                const y = -i * rowSpacing * scale.y * sScale;
                                ctx.moveTo(0, y);
                                ctx.lineTo(totalWidth * sScale, y);
                            }
                            // 绘制竖线 (垂直线)
                            for (let j = 0; j <= colCount; j++) {
                                const x = j * colSpacing * scale.x * sScale;
                                ctx.moveTo(x, 0);
                                ctx.lineTo(x, -totalHeight * sScale);
                            }
                            ctx.stroke();

                            // 绘制单元格文字内容
                            if (table.cells && table.cells.length > 0) {
                                ctx.fillStyle = color;
                                const fontSize = (rowSpacing * scale.y * 0.6) * sScale;
                                ctx.font = `${fontSize}px sans-serif`;
                                ctx.textAlign = 'center';
                                ctx.textBaseline = 'middle';
                                
                                table.cells.forEach((cell: string, i: number) => {
                                    const r = Math.floor(i / colCount);
                                    const c = i % colCount;
                                    if (r < rowCount && c < colCount) {
                                        const cleanedCell = cleanMText(cell);
                                        const tx = (c + 0.5) * colSpacing * scale.x * sScale;
                                        const ty = -(r + 0.5) * rowSpacing * scale.y * sScale;
                                        ctx.fillText(cleanedCell, tx, ty);
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

                const layerName = (ent.layer === '0' && parentLayerName) ? parentLayerName : ent.layer;
                // 递归绘制块中的所有实体
                block.entities.forEach(child => drawEntity(child, nestedTransform, layerName, color, isSelected, depth + 1));
                
                // 处理块中的属性 (ATTRIB)
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
                if (block) {
                    const layerName = (ent.layer === '0' && parentLayerName) ? parentLayerName : ent.layer;
                    // 标注 (Dimension) 本质上是将其对应的匿名块在恒等变换下插入
                    // 但有时标注块的 basePoint 可能不为 (0,0)，需要处理偏移
                    // 此外，如果标注有明确的 definitionPoint，它有时被用作块的插入点
                    const nestedTransform: RenderTransform = {
                        project: (p: Point2D) => {
                            // 标注块内容通常已经是世界坐标，但需要减去其基点偏移
                            // 如果 basePoint 为 (0,0)，则 px = p.x
                            const px = p.x - block.basePoint.x;
                            const py = p.y - block.basePoint.y;
                            
                            // 大多数标注块是直接使用 WCS 坐标定义的，插入点为 (0,0)
                            // 但有些特殊情况下，我们需要考虑 ent.definitionPoint 或其他位置
                            return transform.project({ x: px, y: py });
                        },
                        scale: transform.scale,
                        rotation: transform.rotation
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
                
                // 绘制引线末端的折线 (Hook line)
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

                // 绘制箭头 (Arrowhead)
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
        // 对于文字，判定范围增加到 2.5 倍，使其更易选中
        const effectiveThreshold = isTextEntity ? (threshold * 2.5) : threshold;

        // 包围盒选择优化
        // 如果实体有预计算的包围盒，将其用于初步点击测试
        if (ent.extents) {
            let { min, max } = ent.extents;
            
            // 如果存在变换（即在块内部），我们需要将包围盒转换到世界坐标系
            if (tx) {
                const corners = [
                    p({ x: min.x, y: min.y }),
                    p({ x: max.x, y: min.y }),
                    p({ x: min.x, y: max.y }),
                    p({ x: max.x, y: max.y })
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
                EntityType.INSERT, 
                EntityType.DIMENSION,
                EntityType.HATCH,
                EntityType.ACAD_TABLE
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
        } else if (ent.type === EntityType.DIMENSION) {
            const block = blocks[ent.blockName];
            if (!block) return false;
            const tx = (pt: Point2D) => ({
                x: pt.x - block.basePoint.x,
                y: pt.y - block.basePoint.y
            });
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
 */
export const hitTestBox = (box: {x1:number, y1:number, x2:number, y2:number}, entities: AnyEntity[], layers: Record<string, DxfLayer>, blocks: Record<string, DxfBlock> = {}): Set<string> => {
    const results = new Set<string>();
    const minX = Math.min(box.x1, box.x2), maxX = Math.max(box.x1, box.x2);
    const minY = Math.min(box.y1, box.y2), maxY = Math.max(box.y1, box.y2);

    entities.forEach(ent => {
        const layer = layers[ent.layer];
        if (layer && layer.isVisible === false) return;

        if (ent.extents) {
            const { min, max } = ent.extents;
            // 检查实体的包围盒是否与选择框相交
            const overlap = !(max.x < minX || min.x > maxX || max.y < minY || min.y > maxY);
            if (overlap) {
                results.add(ent.id);
            }
        } else {
            // 对于没有预计算包围盒的实体的兜底逻辑（如单纯的点）
            if (ent.type === EntityType.POINT && ent.position) {
                if (ent.position.x >= minX && ent.position.x <= maxX && ent.position.y >= minY && ent.position.y <= maxY) {
                    results.add(ent.id);
                }
            }
        }
    });
    return results;
};