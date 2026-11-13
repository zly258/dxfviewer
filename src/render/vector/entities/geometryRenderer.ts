import type { VectorContext } from '@/render/vector/context';
import {
  Point2D,
  AnyEntity,
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
    ctx: VectorContext, 
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
export const drawLine = (ctx: VectorContext, ent: DxfLine, transform: RenderTransform) => {
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
export const drawRay = (ctx: VectorContext, ent: DxfRay, transform: RenderTransform, width: number, height: number) => {
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
export const drawXLine = (ctx: VectorContext, ent: DxfXLine, transform: RenderTransform, width: number, height: number) => {
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
export const drawPoint = (ctx: VectorContext, ent: DxfPoint, transform: RenderTransform) => {
    const p = transform.project(ent.position);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2, 0, 2 * Math.PI);
    ctx.fill();
};

/**
 * 绘制圆形
 */
export const drawCircle = (ctx: VectorContext, ent: DxfCircle, transform: RenderTransform) => {
    const c = transform.project(ent.center);
    ctx.beginPath();
    ctx.arc(c.x, c.y, ent.radius * transform.scale, 0, 2 * Math.PI);
    ctx.stroke();
};

/**
 * 绘制圆弧
 */
export const drawArc = (ctx: VectorContext, ent: DxfArc, transform: RenderTransform) => {
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
export const drawEllipse = (ctx: VectorContext, ent: DxfEllipse, transform: RenderTransform) => {
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
export const drawMLine = (ctx: VectorContext, ent: DxfMLine, transform: RenderTransform) => {
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
export const drawSpline = (ctx: VectorContext, ent: DxfSpline, transform: RenderTransform, cachedPoints?: Point2D[]) => {
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
export const drawHelix = (ctx: VectorContext, ent: DxfHelix, transform: RenderTransform) => {
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
 * 视口投影上下文：纸张空间视口需要引用模型空间实体做投影绘制。
 */
export interface ViewportDrawContext {
    /** 模型空间实体（当前布局为纸张空间时提供）。 */
    modelEntities?: AnyEntity[];
    /** 是否绘制视口边框（图纸视口 / 不打印图层为 false）。 */
    drawBorder?: boolean;
    /** 实体绘制回调（复用主渲染调度器，保证实体渲染一致）。 */
    drawEntity: (
        ent: AnyEntity,
        transform: RenderTransform,
        parentLayerName?: string,
        parentColor?: string,
        parentSelected?: boolean,
        depth?: number,
        noMTextWrap?: boolean,
    ) => void;
}

/**
 * 绘制纸张空间视口：在裁剪矩形内投影模型空间内容。
 *
 * 模型 → 纸张 的映射：paper = center + (model - viewCenter) × scale，
 * 其中 scale = height(纸张) / viewHeight(模型)。
 *
 * 视口边框（与 WebGL bakeViewport 同一判据）：
 * - 纸张空间自带的「图纸视口」（viewportId / status = 1）AutoCAD 不显示边框，
 *   它常常覆盖整张纸，画出来是一条横贯全图的巨大矩形 → 一律不画；
 * - 其余真实视口的边框按图层「可打印」标志决定：Defpoints / `*-NPLT`
 *   这类不打印图层不画，与打印结果、与 WebGL 引擎保持一致。
 */
export const drawViewport = (
    ctx: VectorContext,
    ent: DxfViewport,
    transform: RenderTransform,
    context: ViewportDrawContext,
) => {
    const halfWidth = Math.abs(ent.width || 0) / 2;
    const halfHeight = Math.abs(ent.height || 0) / 2;
    if (halfWidth <= 0 || halfHeight <= 0) return;

    if (context.drawBorder) {
        ctx.save();
        ctx.beginPath();
        [
            { x: ent.center.x - halfWidth, y: ent.center.y - halfHeight },
            { x: ent.center.x + halfWidth, y: ent.center.y - halfHeight },
            { x: ent.center.x + halfWidth, y: ent.center.y + halfHeight },
            { x: ent.center.x - halfWidth, y: ent.center.y + halfHeight },
        ].forEach((corner, index) => {
            const point = transform.project(corner);
            if (index === 0) ctx.moveTo(point.x, point.y);
            else ctx.lineTo(point.x, point.y);
        });
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
    }

    const modelEntities = context.modelEntities;
    if (!modelEntities || modelEntities.length === 0 || !ent.viewCenter || !ent.viewHeight || ent.viewHeight <= 0) {
        // 无模型内容可投影：上面可能已经画过边框
        return;
    }

    // 模型 → 纸张 的缩放比例：paper 全高 / model 全高（viewHeight 为模型可视全高）
    const scale = ent.height / ent.viewHeight;
    const viewCenter = ent.viewCenter;
    // 视口在模型空间中的可视窗口（用于实体级剔除）
    const modelHalfWidth = halfWidth / scale;
    const window = {
        minX: viewCenter.x - modelHalfWidth,
        maxX: viewCenter.x + modelHalfWidth,
        minY: viewCenter.y - ent.viewHeight / 2,
        maxY: viewCenter.y + ent.viewHeight / 2,
    };

    ctx.save();
    ctx.beginPath();
    [
        { x: ent.center.x - halfWidth, y: ent.center.y - halfHeight },
        { x: ent.center.x + halfWidth, y: ent.center.y - halfHeight },
        { x: ent.center.x + halfWidth, y: ent.center.y + halfHeight },
        { x: ent.center.x - halfWidth, y: ent.center.y + halfHeight },
    ].forEach((corner, index) => {
        const point = transform.project(corner);
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
    ctx.clip();

    const viewportTransform: RenderTransform = {
        project: (p: Point2D) => transform.project({
            x: ent.center.x + (p.x - viewCenter.x) * scale,
            y: ent.center.y + (p.y - viewCenter.y) * scale,
        }),
        scale: transform.scale * scale,
        rotation: transform.rotation,
    };

    for (const modelEntity of modelEntities) {
        if (modelEntity.visible === false) continue;
        const ext = modelEntity.extents;
        if (ext && (ext.max.x < window.minX || ext.min.x > window.maxX ||
            ext.max.y < window.minY || ext.min.y > window.maxY)) continue;
        context.drawEntity(modelEntity, viewportTransform, undefined, undefined, false, 1, false);
    }

    ctx.restore();
};

/**
 * SHAPE 渲染：不绘制。
 *
 * SHAPE 引用 .shx 形状字体字形，本库不加载 .shx，无法还原真实字形；
 * 此前绘制的「+」占位符在真实图纸中会成为杂散标记（SHAPE 常残留于
 * 主图之外的符号库坐标），故改为静默跳过。实体仍参与解析/属性/拾取数据，
 * 仅不做视觉输出。
 */
export const drawShape = (_ctx: VectorContext, _ent: DxfShape, _transform: RenderTransform) => {
    // no-op：见上方说明
};


