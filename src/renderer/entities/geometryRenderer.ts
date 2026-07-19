import { 
  Point2D, 
  DxfLine, 
  DxfRay, 
  DxfXLine, 
  DxfPoint, 
  DxfCircle, 
  DxfArc, 
  DxfEllipse, 
  DxfMLine, 
  DxfSpline, 
  DxfHelix,
  DxfViewport,
  DxfShape 
} from '@/types';
import { sampleEllipsePoints, sampleSplinePoints } from '@/core/geometry/curveSampling';
import { sampleBulgeSegment } from '@/core/geometry/bulge';

export interface RenderTransform {
    project: (p: Point2D) => Point2D;
    scale: number;
    rotation: number;
}

/**
 * 绘制多段线
 */
export const drawPolyline = (
    ctx: CanvasRenderingContext2D, 
    points: Point2D[], 
    bulges: number[] | undefined, 
    closed: boolean, 
    transform: RenderTransform
) => {
    if (points.length < 1) return;
    const { project } = transform;
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
 * 绘制普通直线
 */
export const drawLine = (ctx: CanvasRenderingContext2D, ent: DxfLine, transform: RenderTransform) => {
    const s = transform.project(ent.start);
    const e = transform.project(ent.end);
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(e.x, e.y);
    ctx.stroke();
};

/**
 * 绘制射线
 */
export const drawRay = (ctx: CanvasRenderingContext2D, ent: DxfRay, transform: RenderTransform, width: number, height: number) => {
    const diag = Math.sqrt(Math.pow(width, 2) + Math.pow(height, 2));
    const infiniteDist = diag * 2; 
    
    const s = transform.project(ent.basePoint);
    const farPoint = {
        x: s.x + ent.direction.x * infiniteDist,
        y: s.y - ent.direction.y * infiniteDist
    };
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(farPoint.x, farPoint.y);
    ctx.stroke();
};

/**
 * 绘制构造线（双向无限延伸线）
 */
export const drawXLine = (ctx: CanvasRenderingContext2D, ent: DxfXLine, transform: RenderTransform, width: number, height: number) => {
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
};

/**
 * 绘制点图元
 */
export const drawPoint = (ctx: CanvasRenderingContext2D, ent: DxfPoint, transform: RenderTransform) => {
    const p = transform.project(ent.position);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2, 0, 2 * Math.PI);
    ctx.fill();
};

/**
 * 绘制圆形
 */
export const drawCircle = (ctx: CanvasRenderingContext2D, ent: DxfCircle, transform: RenderTransform) => {
    const c = transform.project(ent.center);
    ctx.beginPath();
    ctx.arc(c.x, c.y, ent.radius * transform.scale, 0, 2 * Math.PI);
    ctx.stroke();
};

/**
 * 绘制圆弧
 */
export const drawArc = (ctx: CanvasRenderingContext2D, ent: DxfArc, transform: RenderTransform) => {
    const c = transform.project(ent.center);
    const isCcw = ent.isCounterClockwise !== false;
    const startRad = (ent.startAngle || 0) * Math.PI / 180;
    const endRad = (ent.endAngle || 0) * Math.PI / 180;
    
    ctx.beginPath();
    // 屏幕空间 Y 轴翻转，因此我们需要角度取反并传入顺/逆时针方向标志
    ctx.arc(c.x, c.y, ent.radius * transform.scale, -startRad, -endRad, isCcw);
    ctx.stroke();
};

/**
 * 绘制椭圆弧
 */
export const drawEllipse = (ctx: CanvasRenderingContext2D, ent: DxfEllipse, transform: RenderTransform) => {
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
};

/**
 * 绘制多线 (MLINE)
 */
export const drawMLine = (ctx: CanvasRenderingContext2D, ent: DxfMLine, transform: RenderTransform) => {
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
};

/**
 * 绘制样条曲线 (SPLINE)
 */
export const drawSpline = (ctx: CanvasRenderingContext2D, ent: DxfSpline, transform: RenderTransform, cachedPoints?: Point2D[]) => {
    const splinePoints = cachedPoints && cachedPoints.length > 0
        ? cachedPoints
        : ent.calculatedPoints && ent.calculatedPoints.length > 0
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
};

/**
 * 绘制螺旋线 (HELIX)
 */
export const drawHelix = (ctx: CanvasRenderingContext2D, ent: DxfHelix, transform: RenderTransform) => {
    const N = ent.turns || 1;
    const P = ent.pitch || 1;
    const R = ent.radius || 1;
    const H = ent.handedness === 0 ? -1 : 1;
    
    const ax = ent.axisVector.x;
    const ay = ent.axisVector.y;
    const az = ent.axisVector.z;
    const len = Math.sqrt(ax * ax + ay * ay + az * az);
    if (len < 1e-6) return;
    const Nx = ax / len;
    const Ny = ay / len;
    const Nz = az / len;

    let Ux: number, Uy: number, Uz: number;
    if (Math.abs(Nx) < 1/64 && Math.abs(Ny) < 1/64) {
        Ux = Nz; Uy = 0; Uz = -Nx;
    } else {
        Ux = -Ny; Uy = Nx; Uz = 0;
    }
    const lenU = Math.sqrt(Ux * Ux + Uy * Uy + Uz * Uz);
    Ux /= lenU; Uy /= lenU; Uz /= lenU;

    const Vx = Ny * Uz - Nz * Uy;
    const Vy = Nz * Ux - Nx * Uz;
    const Vz = Nx * Uy - Ny * Ux;
    const lenV = Math.sqrt(Vx * Vx + Vy * Vy + Vz * Vz);
    const Vxn = Vx / lenV;
    const Vyn = Vy / lenV;

    const segmentsPerTurn = 32;
    const totalSteps = Math.ceil(N * segmentsPerTurn);
    
    ctx.beginPath();
    for (let i = 0; i <= totalSteps; i++) {
        const t = (i / totalSteps) * N * 2 * Math.PI;
        const angle = t * H;
        const zOffset = (t / (2 * Math.PI)) * P;
        
        const px = ent.startPoint.x + Ux * R * Math.cos(angle) + Vxn * R * Math.sin(angle) + Nx * zOffset;
        const py = ent.startPoint.y + Uy * R * Math.cos(angle) + Vyn * R * Math.sin(angle) + Ny * zOffset;
        
        const sp = transform.project({ x: px, y: py });
        if (i === 0) ctx.moveTo(sp.x, sp.y);
        else ctx.lineTo(sp.x, sp.y);
    }
    ctx.stroke();
};


/**
 * 绘制纸张空间视口边框。
 */
export const drawViewport = (ctx: CanvasRenderingContext2D, ent: DxfViewport, transform: RenderTransform) => {
    const halfWidth = Math.abs(ent.width || 0) / 2;
    const halfHeight = Math.abs(ent.height || 0) / 2;
    if (halfWidth <= 0 || halfHeight <= 0) return;
    const corners = [
        { x: ent.center.x - halfWidth, y: ent.center.y - halfHeight },
        { x: ent.center.x + halfWidth, y: ent.center.y - halfHeight },
        { x: ent.center.x + halfWidth, y: ent.center.y + halfHeight },
        { x: ent.center.x - halfWidth, y: ent.center.y + halfHeight },
    ];
    ctx.beginPath();
    corners.forEach((corner, index) => {
        const point = transform.project(corner);
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
    ctx.stroke();
};

/**
 * 绘制 SHAPE 占位符。
 */
export const drawShape = (ctx: CanvasRenderingContext2D, ent: DxfShape, transform: RenderTransform) => {
    const point = transform.project(ent.position);
    const size = Math.max(4, Math.min(14, Math.abs(ent.size || 1) * Math.abs(transform.scale)));
    ctx.beginPath();
    ctx.moveTo(point.x - size, point.y);
    ctx.lineTo(point.x + size, point.y);
    ctx.moveTo(point.x, point.y - size);
    ctx.lineTo(point.x, point.y + size);
    ctx.stroke();

    if (ent.name && size > 5) {
        ctx.save();
        ctx.font = '11px sans-serif';
        ctx.textBaseline = 'bottom';
        ctx.fillText(ent.name, point.x + size + 3, point.y - size - 2);
        ctx.restore();
    }
};
