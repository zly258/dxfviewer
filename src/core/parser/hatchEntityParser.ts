import { DxfHatch, EntityType, HatchEdge, HatchLoop } from '@/types';
import { DxfParserState, applyCommonGroup, readPoint, readVal } from './parserState';
import { getOcsToWcsMatrix, applyOcs, getWcsRotation } from '@/core/geometry/ocs';
import { sampleSplinePoints } from '@/core/geometry/curveSampling';
import { ENTITY_SAMPLING_CONFIG } from '@/config/parserConfig';

const degreesToRadians = (value: number): number => value * Math.PI / 180;

export const parseHatch = (state: DxfParserState, common: any): DxfHatch => {
    const entity: any = {
        ...common,
        type: EntityType.HATCH,
        patternName: 'SOLID',
        solid: false,
        loops: [],
        scale: 1,
        angle: 0
    };
    let currentLoop: HatchLoop | null = null;
    let edgesToRead = 0;
    let polylineVerticesToRead = 0;
    let polylineVerticesRead = 0;
    let elevation = 0;
    while (state.hasNext) {
        const next = state.peek();
        if (!next || next.code === 0) break;
        const g = state.next()!;
        applyCommonGroup(entity, g.code, g.value);

        if (g.code === 30) elevation = parseFloat(g.value);
        if (g.code === 2) entity.patternName = g.value;
        if (g.code === 70) entity.solid = (parseInt(g.value) & 1) === 1;
        if (g.code === 41) entity.scale = parseFloat(g.value);
        if (g.code === 52) entity.angle = parseFloat(g.value);

        if (g.code === 92) {
            if (currentLoop) entity.loops.push(currentLoop);
            const type = parseInt(g.value);
            currentLoop = { type, edges: [], isPolyline: (type & 2) === 2, points: [], bulges: [] };
            edgesToRead = 0;
            polylineVerticesToRead = 0;
            polylineVerticesRead = 0;
        }
        if (currentLoop) {
            if (currentLoop.isPolyline) {
                if (g.code === 93) polylineVerticesToRead = parseInt(g.value, 10);
                const shouldReadVertex = polylineVerticesToRead === 0 || polylineVerticesRead < polylineVerticesToRead;
                if (shouldReadVertex && g.code === 10) { currentLoop.points!.push({ x: parseFloat(g.value), y: 0 }); currentLoop.bulges!.push(0); }
                if (shouldReadVertex && g.code === 20 && currentLoop.points!.length > 0) {
                    currentLoop.points![currentLoop.points!.length - 1].y = parseFloat(g.value);
                    polylineVerticesRead++;
                }
                if ((shouldReadVertex || polylineVerticesRead === polylineVerticesToRead) && g.code === 42 && currentLoop.bulges!.length > 0) {
                    currentLoop.bulges![currentLoop.bulges!.length - 1] = parseFloat(g.value);
                }
            } else {
                if (g.code === 93) edgesToRead = parseInt(g.value);
                if (g.code === 72 && edgesToRead > 0) {
                    const edgeType = parseInt(g.value);
                    const edge: HatchEdge = { type: 'LINE' };
                    if (edgeType === 1) {
                        edge.type = 'LINE';
                        const p1 = readPoint(state, 10, 20); const p2 = readPoint(state, 11, 21);
                        if(p1) edge.start = p1; if(p2) edge.end = p2;
                    } else if (edgeType === 2) {
                        edge.type = 'ARC';
                        const center = readPoint(state, 10, 20);
                        const radius = readVal(state, 40); const startAng = readVal(state, 50); const endAng = readVal(state, 51); const ccw = readVal(state, 73);
                        if(center) edge.center = center; if(radius !== null) edge.radius = radius;
                        if(startAng !== null) edge.startAngle = startAng; if(endAng !== null) edge.endAngle = endAng;
                        if(ccw !== null) edge.ccw = ccw === 1;

                        if (edge.center && edge.radius !== undefined && edge.startAngle !== undefined && edge.endAngle !== undefined) {
                            const sRad = degreesToRadians(edge.startAngle);
                            const eRad = degreesToRadians(edge.endAngle);
                            edge.start = { x: edge.center.x + edge.radius * Math.cos(sRad), y: edge.center.y + edge.radius * Math.sin(sRad) };
                            edge.end = { x: edge.center.x + edge.radius * Math.cos(eRad), y: edge.center.y + edge.radius * Math.sin(eRad) };
                        }
                    } else if (edgeType === 3) {
                        edge.type = 'ELLIPSE';
                         const center = readPoint(state, 10, 20); const maj = readPoint(state, 11, 21);
                         const ratio = readVal(state, 40); const startAng = readVal(state, 50); const endAng = readVal(state, 51); const ccw = readVal(state, 73);
                         if(center) edge.center = center; if(maj) edge.majorAxis = maj;
                         if(ratio) edge.ratio = ratio;
                         if(startAng !== null) edge.startAngle = degreesToRadians(startAng);
                         if(endAng !== null) edge.endAngle = degreesToRadians(endAng);
                         if(ccw !== null) edge.ccw = ccw === 1;

                         if (edge.center && edge.majorAxis && edge.ratio !== undefined) {
                             const sRad = edge.startAngle || 0;
                             const eRad = edge.endAngle ?? Math.PI * 2;
                             const calcEllipsePt = (angle: number) => {
                                 const cos = Math.cos(angle);
                                 const sin = Math.sin(angle);
                                 const minX = -edge.majorAxis!.y * edge.ratio!;
                                 const minY = edge.majorAxis!.x * edge.ratio!;
                                 return {
                                     x: edge.center!.x + edge.majorAxis!.x * cos + minX * sin,
                                     y: edge.center!.y + edge.majorAxis!.y * cos + minY * sin
                                 };
                             };
                             edge.start = calcEllipsePt(sRad);
                             edge.end = calcEllipsePt(eRad);
                         }
                    } else if (edgeType === 4) {
                         edge.type = 'SPLINE'; edge.controlPoints = []; edge.knots = []; edge.weights = [];
                         const degree = readVal(state, 94); if(degree) edge.degree = degree;
                         const rational = readVal(state, 73);
                         readVal(state, 74);
                         const nKnots = readVal(state, 95);
                         const nControl = readVal(state, 96);
                         for(let k=0; k<(nKnots||0); k++) { const kn = readVal(state, 40); if(kn!==null) edge.knots!.push(kn); }
                         for(let c=0; c<(nControl||0); c++) {
                             const pt = readPoint(state, 10, 20); if(pt) edge.controlPoints!.push(pt);
                             if (rational) { const w = readVal(state, 42); if(w!==null) edge.weights!.push(w); }
                         }
                         if (edge.controlPoints.length > 0) {
                             edge.calculatedPoints = sampleSplinePoints(
                                edge.controlPoints,
                                edge.degree || 3,
                                edge.knots,
                                edge.weights,
                                ENTITY_SAMPLING_CONFIG.hatchSplineSegments,
                             );
                         }
                    }
                    currentLoop.edges.push(edge);
                    edgesToRead--;
                }
            }
        }
    }
    if (entity.patternName === 'SOLID') entity.solid = true;
    if (currentLoop) entity.loops.push(currentLoop);
    const ocs = getOcsToWcsMatrix(entity.extrusion.x, entity.extrusion.y, entity.extrusion.z);
    const transform = (x: number, y: number) => applyOcs({x, y}, ocs, elevation);
    if (ocs) {
        const det2D = ocs.Ax.x * ocs.Ay.y - ocs.Ax.y * ocs.Ay.x;
        entity.isFlipped = det2D < 0;

        entity.loops.forEach((loop: HatchLoop) => {
             if (loop.points) loop.points = loop.points.map(p => transform(p.x, p.y));
             if (loop.edges) loop.edges.forEach(edge => {
                 if (edge.start) edge.start = transform(edge.start.x, edge.start.y);
                 if (edge.end) edge.end = transform(edge.end.x, edge.end.y);
                 if (edge.center) edge.center = transform(edge.center.x, edge.center.y);
                 if (edge.type === 'ARC' && edge.startAngle !== undefined && edge.endAngle !== undefined) {
                     edge.startAngle = getWcsRotation(edge.startAngle, ocs);
                     edge.endAngle = getWcsRotation(edge.endAngle, ocs);
                 }
                 if (edge.type === 'ELLIPSE' && edge.majorAxis) {
                     const tx = edge.majorAxis.x * ocs.Ax.x + edge.majorAxis.y * ocs.Ay.x;
                     const ty = edge.majorAxis.x * ocs.Ax.y + edge.majorAxis.y * ocs.Ay.y;
                     edge.majorAxis = { x: tx, y: ty };
                 }
                 if (edge.controlPoints) edge.controlPoints = edge.controlPoints.map(p => transform(p.x, p.y));
                 if (edge.calculatedPoints) edge.calculatedPoints = edge.calculatedPoints.map(p => transform(p.x, p.y));
             });
        });
    }
    return entity;
};
