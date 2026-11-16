import { AnyEntity, DxfHelix, DxfMLine, DxfPolyline, DxfSpline, EntityType, Point2D } from '@/types';
import { DxfParserState, applyCommonGroupFrom } from './parserState';
import { getOcsToWcsMatrix, applyOcs, getWcsRotation } from '@/core/geometry/ocs';
import { parsePolyfaceMesh } from './meshEntityParser';
import { sampleSplinePoints } from '@/core/geometry/curveSampling';

export const parseLine = (state: DxfParserState, common: any): AnyEntity => {
    const entity: any = { ...common, type: EntityType.LINE, start: {x:0, y:0}, end: {x:0, y:0} };
    let sz = 0;
    let ez = 0;
    while(state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroupFrom(entity, g);
        switch(g.code) {
            case 10: entity.start.x = g.float; break;
            case 20: entity.start.y = g.float; break;
            case 30: sz = g.float; break;
            case 11: entity.end.x = g.float; break;
            case 21: entity.end.y = g.float; break;
            case 31: ez = g.float; break;
        }
    }
    // 三维直线：仅保留 z（3D 直线顶点通常已是 WCS，避免改动 2D 图元坐标）。
    if (sz) entity.start.z = sz;
    if (ez) entity.end.z = ez;
    return entity;
};

export const parseCircle = (state: DxfParserState, common: any): AnyEntity => {
    const entity: any = { ...common, type: EntityType.CIRCLE, center: {x:0, y:0}, radius: 0 };
    let z = 0;
    while(state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroupFrom(entity, g);
        switch(g.code) {
            case 10: entity.center.x = g.float; break;
            case 20: entity.center.y = g.float; break;
            case 30: z = g.float; break;
            case 40: entity.radius = g.float; break;
        }
    }
    const ocs = getOcsToWcsMatrix(entity.extrusion.x, entity.extrusion.y, entity.extrusion.z);
    entity.center = applyOcs(entity.center, ocs, z);
    return entity;
};

export const parseArc = (state: DxfParserState, common: any): AnyEntity => {
    const entity: any = { ...common, type: EntityType.ARC, center: {x:0, y:0}, radius: 0, startAngle: 0, endAngle: 0 };
    let z = 0;
    while(state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroupFrom(entity, g);
        switch(g.code) {
            case 10: entity.center.x = g.float; break;
            case 20: entity.center.y = g.float; break;
            case 30: z = g.float; break;
            case 40: entity.radius = g.float; break;
            case 50: entity.startAngle = g.float; break;
            case 51: entity.endAngle = g.float; break;
        }
    }
    const ocs = getOcsToWcsMatrix(entity.extrusion.x, entity.extrusion.y, entity.extrusion.z);
    entity.center = applyOcs(entity.center, ocs, z);
    if (ocs) {
        const det2D = ocs.Ax.x * ocs.Ay.y - ocs.Ax.y * ocs.Ay.x;
        entity.isCounterClockwise = det2D >= 0;
        entity.startAngle = getWcsRotation(entity.startAngle, ocs);
        entity.endAngle = getWcsRotation(entity.endAngle, ocs);
    }
    return entity;
};

export const parseLwPolyline = (state: DxfParserState, common: any): DxfPolyline => {
    const points: Point2D[] = [];
    const bulges: number[] = [];
    let closed = false;
    let elevation = 0;
    let currX: number | null = null;
    let currY: number | null = null;
    let currBulge = 0;

    const flushVertex = () => {
        if (currX !== null && currY !== null) {
            points.push({x: currX, y: currY});
            bulges.push(currBulge);
            currX = null; currY = null; currBulge = 0;
        }
    };

    while(state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroupFrom(common, g);
        switch(g.code) {
            case 38: elevation = g.float; break;
            case 70: closed = ((g.float | 0) & 1) === 1; break;
            case 43: common.constantWidth = g.float; break;
            case 10: flushVertex(); currX = g.float; break;
            case 20: currY = g.float; break;
            case 42: currBulge = g.float; break;
        }
    }
    flushVertex();

    const ocs = getOcsToWcsMatrix(common.extrusion.x, common.extrusion.y, common.extrusion.z);
    if (ocs) {
        const det2D = ocs.Ax.x * ocs.Ay.y - ocs.Ax.y * ocs.Ay.x;
        const mirror = det2D < 0;
        for(let i=0; i<points.length; i++) {
            points[i] = applyOcs(points[i], ocs, elevation);
            if (mirror && bulges[i] !== 0) {
                bulges[i] = -bulges[i];
            }
        }
    }
    // 带标高（38）的轻量多段线补上 z，供三维渲染使用。
    if (elevation) {
        for (let i = 0; i < points.length; i++) (points[i] as any).z = elevation;
    }
    return { ...common, type: EntityType.LWPOLYLINE, points, bulges, closed };
};
export const parsePolyline = (state: DxfParserState, common: any): DxfPolyline => {
    let closed = false;
    let is3DPolyline = false;
    let isPolyfaceMesh = false;
    let elevation = 0;
    while(state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroupFrom(common, g);
        if (g.code === 70) {
             const flags = (g.float | 0);
             closed = (flags & 1) === 1;
             is3DPolyline = (flags & 8) === 8;
             // bit 6 (64) = 多面网格（PFACE），三维模型的常见载体。
             isPolyfaceMesh = (flags & 64) === 64;
        }
        if (g.code === 40 || g.code === 41) common.constantWidth = g.float;
        if (g.code === 30) elevation = g.float;
    }

    // 多面网格：交给网格解析器（真实三维面片）。
    if (isPolyfaceMesh) return parsePolyfaceMesh(state, common) as unknown as DxfPolyline;

    const points: Point2D[] = [];
    const bulges: number[] = [];
    while(state.hasNext) {
        const p = state.peek();
        if (!p) break;
        if (p.code === 0) {
            if (p.value === 'SEQEND') { state.next(); break; }
            if (p.value === 'VERTEX') {
                state.next();
                let x=0, y=0, z=0, b=0, valid = false;
                while(state.hasNext) {
                    const vp = state.peek();
                    if (!vp || vp.code === 0) break;
                    const vg = state.next()!;
                    if (vg.code === 10) { x = vg.float; valid = true; }
                    if (vg.code === 20) y = vg.float;
                    if (vg.code === 30) z = vg.float;
                    if (vg.code === 42) b = vg.float;
                }
                if (valid) {
                    const pt: any = { x, y };
                    if (z) pt.z = z;
                    points.push(pt);
                    bulges.push(b);
                }
                continue;
            }
            break;
        }
        state.next();
    }

    const ocs = getOcsToWcsMatrix(common.extrusion.x, common.extrusion.y, common.extrusion.z);
    if (ocs && !is3DPolyline) {
        const det2D = ocs.Ax.x * ocs.Ay.y - ocs.Ax.y * ocs.Ay.x;
        const mirror = det2D < 0;
        for(let i=0; i<points.length; i++) {
            points[i] = applyOcs(points[i], ocs, elevation);
            if (mirror && bulges[i] !== 0) {
                bulges[i] = -bulges[i];
            }
        }
    }
    // 2D 多段线若有标高（38），补上 z；3D 多段线各顶点 z 已在上面保留。
    if (!is3DPolyline && elevation) {
        for (let i = 0; i < points.length; i++) (points[i] as any).z = elevation;
    }
    return { ...common, type: EntityType.POLYLINE, points, bulges, closed };
};

export const parseSpline = (state: DxfParserState, common: any): DxfSpline => {
    const entity: any = {
        ...common,
        type: EntityType.SPLINE,
        controlPoints: [],
        fitPoints: [],
        knots: [],
        weights: [],
        degree: 3,
        flags: 0
    };
    while(state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroupFrom(entity, g);
        switch(g.code) {
            case 70: entity.flags = (g.float | 0); break;
            case 71: entity.degree = (g.float | 0); break;
            case 40: entity.knots.push(g.float); break;
            case 41: entity.weights.push(g.float); break;
            case 10: entity.controlPoints.push({x: g.float, y: 0}); break;
            case 20: if (entity.controlPoints.length > 0) entity.controlPoints[entity.controlPoints.length-1].y = g.float; break;
            case 30: if (entity.controlPoints.length > 0) (entity.controlPoints[entity.controlPoints.length-1] as any).z = g.float; break;
            case 11: entity.fitPoints.push({x: g.float, y: 0}); break;
            case 21: if (entity.fitPoints.length > 0) entity.fitPoints[entity.fitPoints.length-1].y = g.float; break;
            case 31: if (entity.fitPoints.length > 0) (entity.fitPoints[entity.fitPoints.length-1] as any).z = g.float; break;
        }
    }

    if (entity.controlPoints.length > 0) {
        entity.calculatedPoints = sampleSplinePoints(entity.controlPoints, entity.degree, entity.knots, entity.weights);
    }
    return entity;
};

export const parseEllipse = (state: DxfParserState, common: any): AnyEntity => {
    const entity: any = {
        ...common,
        type: EntityType.ELLIPSE,
        center: {x:0, y:0},
        majorAxis: {x:0, y:0},
        ratio: 1, startParam: 0, endParam: Math.PI*2
    };
    while(state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroupFrom(entity, g);
        switch(g.code) {
            case 10: entity.center.x = g.float; break;
            case 20: entity.center.y = g.float; break;
            case 11: entity.majorAxis.x = g.float; break;
            case 21: entity.majorAxis.y = g.float; break;
            case 40: entity.ratio = g.float; break;
            case 41: entity.startParam = g.float; break;
            case 42: entity.endParam = g.float; break;
        }
    }
    return entity;
};

export const parsePointEntity = (state: DxfParserState, common: any): AnyEntity => {
    const entity: any = { ...common, type: EntityType.POINT, position: {x:0, y:0} };
    while(state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroupFrom(entity, g);
        if (g.code === 10) entity.position.x = g.float;
        if (g.code === 20) entity.position.y = g.float;
    }
    return entity;
};

export const parseRayXLine = (state: DxfParserState, common: any, type: string): AnyEntity => {
    const entity: any = {
        ...common,
        type: type === 'RAY' ? EntityType.RAY : EntityType.XLINE,
        basePoint: {x:0, y:0},
        direction: {x:1, y:0}
    };
    let z1 = 0, z2 = 0;
    while(state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroupFrom(entity, g);
        switch(g.code) {
            case 10: entity.basePoint.x = g.float; break;
            case 20: entity.basePoint.y = g.float; break;
            case 30: z1 = g.float; break;
            case 11: entity.direction.x = g.float; break;
            case 21: entity.direction.y = g.float; break;
            case 31: z2 = g.float; break;
        }
    }
    const ocs = getOcsToWcsMatrix(entity.extrusion.x, entity.extrusion.y, entity.extrusion.z);
    entity.basePoint = applyOcs(entity.basePoint, ocs, z1);
    if (ocs) {
        const d = { x: entity.direction.x, y: entity.direction.y };
        entity.direction = applyOcs(d, ocs, z2);
        const len = Math.sqrt(entity.direction.x * entity.direction.x + entity.direction.y * entity.direction.y);
        if (len > 0) {
            entity.direction.x /= len;
            entity.direction.y /= len;
        }
    }
    return entity;
};

export const parseShape = (state: DxfParserState, common: any): AnyEntity => {
    const entity: any = {
        ...common,
        type: EntityType.SHAPE,
        position: { x: 0, y: 0 },
        name: '',
        size: 1,
        rotation: 0,
        xScale: 1,
        oblique: 0,
    };
    let z = 0;
    while (state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroupFrom(entity, g);
        switch (g.code) {
            case 2: entity.name = g.value; break;
            case 10: entity.position.x = g.float; break;
            case 20: entity.position.y = g.float; break;
            case 30: z = g.float; break;
            case 40: entity.size = g.float; break;
            case 41: entity.xScale = g.float; break;
            case 50: entity.rotation = g.float; break;
            case 51: entity.oblique = g.float; break;
        }
    }
    const ocs = getOcsToWcsMatrix(entity.extrusion.x, entity.extrusion.y, entity.extrusion.z);
    entity.position = applyOcs(entity.position, ocs, z);
    entity.rotation = getWcsRotation(entity.rotation || 0, ocs);
    return entity;
};

export const parseMLine = (state: DxfParserState, common: any): DxfMLine => {
    const entity: DxfMLine = {
        ...common,
        type: EntityType.MLINE,
        vertices: [],
        closed: false,
    };
    let pendingX: number | null = null;
    while (state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroupFrom(entity, g);
        switch (g.code) {
            case 70:
                entity.closed = (parseInt(g.value, 10) & 1) !== 0;
                break;
            case 11:
                pendingX = g.float;
                break;
            case 21:
                if (pendingX !== null) {
                    entity.vertices.push({ x: pendingX, y: g.float });
                    pendingX = null;
                }
                break;
        }
    }
    return entity;
};

export const parseSolid = (state: DxfParserState, common: any, type: string): AnyEntity => {
    const entity: any = { ...common, type: type === '3DFACE' ? EntityType.THREEDFACE : EntityType.SOLID, points: [] };
    const pts: ({x:number, y:number, z:number} | null)[] = [null, null, null, null];

    while(state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroupFrom(entity, g);
        switch(g.code) {
            case 10: if (!pts[0]) pts[0] = {x:0, y:0, z:0}; pts[0].x = g.float; break;
            case 20: if (!pts[0]) pts[0] = {x:0, y:0, z:0}; pts[0].y = g.float; break;
            case 30: if (!pts[0]) pts[0] = {x:0, y:0, z:0}; pts[0].z = g.float; break;
            case 11: if (!pts[1]) pts[1] = {x:0, y:0, z:0}; pts[1].x = g.float; break;
            case 21: if (!pts[1]) pts[1] = {x:0, y:0, z:0}; pts[1].y = g.float; break;
            case 31: if (!pts[1]) pts[1] = {x:0, y:0, z:0}; pts[1].z = g.float; break;
            case 12: if (!pts[2]) pts[2] = {x:0, y:0, z:0}; pts[2].x = g.float; break;
            case 22: if (!pts[2]) pts[2] = {x:0, y:0, z:0}; pts[2].y = g.float; break;
            case 32: if (!pts[2]) pts[2] = {x:0, y:0, z:0}; pts[2].z = g.float; break;
            case 13: if (!pts[3]) pts[3] = {x:0, y:0, z:0}; pts[3].x = g.float; break;
            case 23: if (!pts[3]) pts[3] = {x:0, y:0, z:0}; pts[3].y = g.float; break;
            case 33: if (!pts[3]) pts[3] = {x:0, y:0, z:0}; pts[3].z = g.float; break;
            case 70: if (type === '3DFACE') entity.edgeFlags = (g.float | 0); break;
        }
    }

    if (!pts[0]) pts[0] = {x:0, y:0, z:0};
    if (!pts[1]) pts[1] = {x:0, y:0, z:0};
    if (!pts[2]) pts[2] = {x:0, y:0, z:0};
    if (!pts[3]) pts[3] = { ...pts[2] };

    const ocs = getOcsToWcsMatrix(entity.extrusion.x, entity.extrusion.y, entity.extrusion.z);
    const transformed = (type === 'SOLID' || type === 'TRACE')
        ? pts.map(p => applyOcs(p!, ocs, p!.z))
        : pts.map(p => ({ x: p!.x, y: p!.y }));

    if (type === 'SOLID' || type === 'TRACE') {
         entity.points = [transformed[0], transformed[1], transformed[3], transformed[2]];
    } else {
         entity.points = [transformed[0], transformed[1], transformed[2], transformed[3]];
    }

    return entity;
};

export const parseHelix = (state: DxfParserState, common: any): DxfHelix => {
    const entity: DxfHelix = {
        ...common,
        type: EntityType.HELIX,
        axisVector: { x: 0, y: 0, z: 1 },
        startPoint: { x: 0, y: 0, z: 0 },
        radius: 1,
        turns: 1,
        pitch: 1,
        handedness: 1
    };
    let zStart = 0;
    while (state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroupFrom(entity, g);
        switch (g.code) {
            case 10: entity.startPoint.x = g.float; break;
            case 20: entity.startPoint.y = g.float; break;
            case 30: zStart = g.float; break;
            case 11: entity.axisVector.x = g.float; break;
            case 21: entity.axisVector.y = g.float; break;
            case 31: entity.axisVector.z = g.float; break;
            case 40: entity.radius = g.float; break;
            case 41: entity.turns = g.float; break;
            case 42: entity.pitch = g.float; break;
            case 71: entity.handedness = parseInt(g.value, 10); break;
        }
    }
    entity.startPoint.z = zStart;
    return entity;
};

export const parseViewport = (state: DxfParserState, common: any): AnyEntity => {
    const entity: any = {
        ...common,
        type: EntityType.VIEWPORT,
        center: { x: 0, y: 0 },
        width: 0,
        height: 0,
        viewCenter: { x: 0, y: 0 },
        viewHeight: 0,
        twistAngle: 0,
        viewportId: 0,
        status: 0,
    };
    let z = 0;
    while (state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroupFrom(entity, g);
        switch (g.code) {
            case 10: entity.center.x = g.float; break;
            case 20: entity.center.y = g.float; break;
            case 30: z = g.float; break;
            case 40: entity.width = g.float; break;
            case 41: entity.height = g.float; break;
            case 12: entity.viewCenter.x = g.float; break;
            case 22: entity.viewCenter.y = g.float; break;
            case 45: entity.viewHeight = g.float; break;
            case 51: entity.twistAngle = g.float; break;
            case 68: entity.status = parseInt(g.value, 10); break;
            case 69: entity.viewportId = parseInt(g.value, 10); break;
        }
    }
    const ocs = getOcsToWcsMatrix(entity.extrusion.x, entity.extrusion.y, entity.extrusion.z);
    entity.center = applyOcs(entity.center, ocs, z);
    return entity;
};
