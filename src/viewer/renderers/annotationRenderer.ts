import { 
  DxfHatch, 
  DxfLeader, 
  DxfMLeader, 
  DxfImage, 
  DxfWipeout, 
  DxfTolerance, 
  DxfText, 
  Point2D, 
  CanvasTheme, 
  AnyEntity, 
  EntityType, 
  DxfStyle 
} from '../../types';
import { 
  LEADER_RENDER_CONFIG, 
  CANVAS_THEME_COLORS 
} from '../../shared/config/viewerConfig';
import { 
  CAD_DEFAULT_TEXT_HEIGHT, 
  CAD_BY_LAYER_COLOR 
} from '../../shared/constants/cadConstants';
import { sampleHatchLoop } from '../../core/geometry/curveSampling';
import { 
  getMLeaderTerminalPoint, 
  getMLeaderTextPosition, 
  getMLeaderTextAttachment 
} from '../../core/entity/mleaderUtils';
import { drawPolyline } from './geometryRenderer';

export interface RenderTransform {
    project: (p: Point2D) => Point2D;
    scale: number;
    rotation: number;
}

/**
 * 绘制箭头
 */
export const drawArrowHead = (ctx: CanvasRenderingContext2D, tip: Point2D, next: Point2D, transform: RenderTransform, sizeWorld?: number) => {
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

/**
 * 绘制填充环路
 */
const drawHatchLoop = (ctx: CanvasRenderingContext2D, loop: any, transform: RenderTransform) => {
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
 * 创建非实心填充剖面线图案
 */
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

/**
 * 绘制图案/实心填充 (HATCH)
 */
export const drawHatch = (ctx: CanvasRenderingContext2D, ent: DxfHatch, transform: RenderTransform, color: string) => {
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
};

/**
 * 绘制二维实心/三维面图元 (SOLID / 3DFACE)
 */
export const drawSolid = (ctx: CanvasRenderingContext2D, ent: AnyEntity, transform: RenderTransform, type: string) => {
    const pts = (ent as any).points as Point2D[];
    if (!pts || pts.length < 3) return;
    
    if (type === 'SOLID' || type === 'TRACE') {
        ctx.beginPath();
        const p0 = transform.project(pts[0]);
        ctx.moveTo(p0.x, p0.y);
        for (let i = 1; i < pts.length; i++) {
            const p = transform.project(pts[i]);
            ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    } else {
        const flags = (ent as any).edgeFlags || 0;
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
};

/**
 * 绘制引线 (LEADER)
 */
export const drawLeader = (
    ctx: CanvasRenderingContext2D,
    ent: DxfLeader,
    transform: RenderTransform,
    color: string,
    entityByHandle: Map<string, AnyEntity>
) => {
    if (ent.points.length < 2) return;
    ctx.beginPath();
    const pts = ent.points;
    const p0 = transform.project(pts[0]);
    ctx.moveTo(p0.x, p0.y);
    pts.slice(1).forEach(p => {
        const sp = transform.project(p);
        ctx.lineTo(sp.x, sp.y);
    });
    
    if (ent.hasHookLine) {
         const last = pts[pts.length - 1];
         const prev = pts[pts.length - 2];
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

    if (ent.arrowHeadFlag === 1) {
        ctx.fillStyle = color;
        drawArrowHead(ctx, pts[0], pts[1], transform);
    }
};

/**
 * 绘制多重引线 (MLEADER)
 */
export const drawMLeader = (
    ctx: CanvasRenderingContext2D,
    ent: DxfMLeader,
    transform: RenderTransform,
    color: string,
    layerName: string,
    isSelected: boolean,
    depth: number,
    drawTextCallback: (
        textEntity: DxfText,
        transform: RenderTransform,
        layerName: string,
        color: string,
        isSelected: boolean,
        depth: number
    ) => void
) => {
    const leaderLines = (ent.leaderLines || []).filter((line: Point2D[]) => line.length > 1);
    if (leaderLines.length === 0 && !ent.text) return;

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
        drawArrowHead(ctx, line[0], line[1], transform, ent.arrowSize);
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
        drawTextCallback(textEntity, transform, layerName, color, isSelected, depth + 1);
    }
};

/**
 * 绘制图像占位框 (IMAGE)
 */
export const drawImage = (ctx: CanvasRenderingContext2D, ent: DxfImage, transform: RenderTransform) => {
    const scale = transform.scale;
    const w = ent.imageSize.x;
    const h = ent.imageSize.y;
    
    ctx.save();
    const p = transform.project(ent.position);
    ctx.translate(p.x, p.y);
    const uLen = Math.hypot(ent.uVector?.x || 1, ent.uVector?.y || 0);
    const angle = Math.atan2(ent.uVector?.y || 0, ent.uVector?.x || 1);
    ctx.rotate(-angle + transform.rotation);
    
    const widthPixels = w * uLen * scale;
    const heightPixels = h * Math.hypot(ent.vVector?.x || 0, ent.vVector?.y || 1) * scale;
    
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(0, 0, widthPixels, -heightPixels);
    
    ctx.fillStyle = ctx.strokeStyle;
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`IMAGE: ${ent.imagePath || ent.handle || ''}`, widthPixels / 2, -heightPixels / 2);
    ctx.restore();
};

/**
 * 绘制遮罩区域 (WIPEOUT)
 */
export const drawWipeout = (ctx: CanvasRenderingContext2D, ent: DxfWipeout, transform: RenderTransform, theme: CanvasTheme) => {
    if (ent.points.length < 3) return;
    ctx.save();
    ctx.fillStyle = CANVAS_THEME_COLORS[theme];
    ctx.beginPath();
    const start = transform.project(ent.points[0]);
    ctx.moveTo(start.x, start.y);
    for (let i = 1; i < ent.points.length; i++) {
        const p = transform.project(ent.points[i]);
        ctx.lineTo(p.x, p.y);
    }
    if (ent.closed) ctx.closePath();
    ctx.fill();
    ctx.restore();
};

/**
 * 绘制几何形位公差文本框 (TOLERANCE)
 */
export const drawTolerance = (ctx: CanvasRenderingContext2D, ent: DxfTolerance, transform: RenderTransform, color: string) => {
    ctx.save();
    const p = transform.project(ent.position);
    ctx.translate(p.x, p.y);
    
    const text = ent.text || '';
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    
    ctx.font = `${Math.max(10, CAD_DEFAULT_TEXT_HEIGHT * transform.scale)}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    
    const textWidth = ctx.measureText(text).width;
    const textHeight = Math.max(10, CAD_DEFAULT_TEXT_HEIGHT * transform.scale);
    const padding = 4;
    
    ctx.lineWidth = 1;
    ctx.strokeRect(0, -textHeight / 2 - padding, textWidth + padding * 2, textHeight + padding * 2);
    ctx.fillText(text, padding, 0);
    ctx.restore();
};
