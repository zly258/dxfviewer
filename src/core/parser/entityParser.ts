import { 
  EntityType, 
  AnyEntity, 
  Point2D, 
  DxfText, 
  DxfPolyline, 
  DxfSpline,
  DxfInsert, 
  DxfLeader, 
  DxfMLeader, 
  DxfMLine, 
  DxfTable, 
  DxfHatch, 
  HatchLoop, 
  HatchEdge, 
  DxfImage, 
  DxfWipeout, 
  DxfHelix, 
  DxfTolerance 
} from '@/types';
import { 
  DxfParserState, 
  readVal, 
  readPoint, 
  parseCommon, 
  applyCommonGroup 
} from './parserState';
import { getOcsToWcsMatrix, applyOcs, getWcsRotation } from '@/core/geometry/ocs';
import { sampleSplinePoints } from '@/core/geometry/curveSampling';
import { normalizeAcadTableGeometry } from '@/core/geometry/extents';
import { CAD_DEFAULT_TEXT_STYLE } from '@/config/cadConstants';
import { LEADER_RENDER_CONFIG } from '@/config/viewerConfig';

/**
 * 样条曲线预计算点转换函数
 */
export const getBSplinePoints = (controlPoints: Point2D[], degree: number = 3, knots?: number[], weights?: number[], segments?: number): Point2D[] => {
    return sampleSplinePoints(controlPoints, degree, knots, weights, segments);
};

/**
 * 实体解析分发器，根据实体类型分发到对应的解析函数
 */
export const parseEntityDispatcher = (type: string, state: DxfParserState, blockHandleMap?: Record<string, string>): AnyEntity | null => {
    const common = parseCommon(state);
    switch (type) {
        case 'LINE': return parseLine(state, common);
        case 'CIRCLE': return parseCircle(state, common);
        case 'ARC': return parseArc(state, common);
        case 'LWPOLYLINE': return parseLwPolyline(state, common);
        case 'POLYLINE': return parsePolyline(state, common);
        case 'INSERT': return parseInsert(state, common);
        case 'TEXT': return parseText(state, common, EntityType.TEXT);
        case 'MTEXT': return parseText(state, common, EntityType.MTEXT);
        case 'ATTDEF': return parseText(state, common, EntityType.ATTDEF);
        case 'ATTRIB': return parseText(state, common, EntityType.ATTRIB);
        case 'POINT': return parsePointEntity(state, common);
        case 'SOLID': case 'TRACE': case '3DFACE': return parseSolid(state, common, type);
        case 'SPLINE': return parseSpline(state, common);
        case 'ELLIPSE': return parseEllipse(state, common);
        case 'HATCH': return parseHatch(state, common);
        case 'DIMENSION': return parseDimension(state, common);
        case 'LEADER': return parseLeader(state, common);
        case 'MLEADER':
        case 'MULTILEADER': return parseMLeader(state, common);
        case 'MLINE': return parseMLine(state, common);
        case 'ACAD_TABLE': return parseAcadTable(state, common, blockHandleMap);
        case 'RAY':
        case 'XLINE':
            return parseRayXLine(state, common, type);
        case 'IMAGE': return parseImage(state, common);
        case 'WIPEOUT': return parseWipeout(state, common);
        case 'HELIX': return parseHelix(state, common);
        case 'TOLERANCE': return parseTolerance(state, common);
        case 'VIEWPORT': return parseViewport(state, common);
        case 'SHAPE': return parseShape(state, common);
        case '3DSOLID': return parse3DSolidOrBodyOrSurface(state, common, EntityType.SOLID3D);
        case 'BODY': return parse3DSolidOrBodyOrSurface(state, common, EntityType.BODY);
        case 'SURFACE': return parse3DSolidOrBodyOrSurface(state, common, EntityType.SURFACE);
        default: 
            // 消耗所有组码直到下一个实体（代码 0），安全地跳过未知实体
            while (state.hasNext) {
                const p = state.peek();
                if (!p || p.code === 0) break;
                state.next();
            }
            return null;
    }
};

const parseLine = (state: DxfParserState, common: any): AnyEntity => {
    const entity: any = { ...common, type: EntityType.LINE, start: {x:0, y:0}, end: {x:0, y:0} };
    while(state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroup(entity, g.code, g.value);
        switch(g.code) {
            case 10: entity.start.x = parseFloat(g.value); break;
            case 20: entity.start.y = parseFloat(g.value); break;
            case 11: entity.end.x = parseFloat(g.value); break;
            case 21: entity.end.y = parseFloat(g.value); break;
        }
    }
    return entity;
};

const parseCircle = (state: DxfParserState, common: any): AnyEntity => {
    const entity: any = { ...common, type: EntityType.CIRCLE, center: {x:0, y:0}, radius: 0 };
    let z = 0;
    while(state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroup(entity, g.code, g.value);
        switch(g.code) {
            case 10: entity.center.x = parseFloat(g.value); break;
            case 20: entity.center.y = parseFloat(g.value); break;
            case 30: z = parseFloat(g.value); break;
            case 40: entity.radius = parseFloat(g.value); break;
        }
    }
    const ocs = getOcsToWcsMatrix(entity.extrusion.x, entity.extrusion.y, entity.extrusion.z);
    entity.center = applyOcs(entity.center, ocs, z);
    return entity;
};

const parseArc = (state: DxfParserState, common: any): AnyEntity => {
    const entity: any = { ...common, type: EntityType.ARC, center: {x:0, y:0}, radius: 0, startAngle: 0, endAngle: 0 };
    let z = 0;
    while(state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroup(entity, g.code, g.value);
        switch(g.code) {
            case 10: entity.center.x = parseFloat(g.value); break;
            case 20: entity.center.y = parseFloat(g.value); break;
            case 30: z = parseFloat(g.value); break;
            case 40: entity.radius = parseFloat(g.value); break;
            case 50: entity.startAngle = parseFloat(g.value); break;
            case 51: entity.endAngle = parseFloat(g.value); break;
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

const parseLwPolyline = (state: DxfParserState, common: any): DxfPolyline => {
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
        applyCommonGroup(common, g.code, g.value);
        switch(g.code) {
            case 38: elevation = parseFloat(g.value); break;
            case 70: closed = (parseInt(g.value) & 1) === 1; break;
            case 43: common.constantWidth = parseFloat(g.value); break;
            case 10: flushVertex(); currX = parseFloat(g.value); break;
            case 20: currY = parseFloat(g.value); break;
            case 42: currBulge = parseFloat(g.value); break;
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
    return { ...common, type: EntityType.LWPOLYLINE, points, bulges, closed };
};

const parsePolyline = (state: DxfParserState, common: any): DxfPolyline => {
    let closed = false;
    let is3DPolyline = false;
    let elevation = 0;
    while(state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroup(common, g.code, g.value);
        if (g.code === 70) {
             const flags = parseInt(g.value);
             closed = (flags & 1) === 1;
             is3DPolyline = (flags & 8) === 8;
        }
        if (g.code === 40 || g.code === 41) common.constantWidth = parseFloat(g.value);
        if (g.code === 30) elevation = parseFloat(g.value);
    }

    const points: Point2D[] = [];
    const bulges: number[] = [];
    while(state.hasNext) {
        const p = state.peek();
        if (!p) break;
        if (p.code === 0) {
            if (p.value === 'SEQEND') { state.next(); break; }
            if (p.value === 'VERTEX') {
                state.next();
                let x=0, y=0, b=0, valid = false;
                while(state.hasNext) {
                    const vp = state.peek();
                    if (!vp || vp.code === 0) break;
                    const vg = state.next()!;
                    if (vg.code === 10) { x = parseFloat(vg.value); valid = true; }
                    if (vg.code === 20) y = parseFloat(vg.value);
                    if (vg.code === 42) b = parseFloat(vg.value);
                }
                if (valid) {
                    points.push({x, y});
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
    return { ...common, type: EntityType.POLYLINE, points, bulges, closed };
};

const parseInsert = (state: DxfParserState, common: any): DxfInsert => {
    const entity: any = { 
        ...common, 
        type: EntityType.INSERT, 
        blockName: '', 
        position: {x:0, y:0}, 
        scale: {x:1, y:1, z:1}, 
        rotation: 0,
        rowCount: 1, colCount: 1, rowSpacing: 0, colSpacing: 0
    };
    let z = 0;
    let hasAttribs = false;

    while(state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroup(entity, g.code, g.value);
        switch(g.code) {
            case 2: entity.blockName = g.value; break;
            case 10: entity.position.x = parseFloat(g.value); break;
            case 20: entity.position.y = parseFloat(g.value); break;
            case 30: z = parseFloat(g.value); break;
            case 41: entity.scale.x = parseFloat(g.value); break;
            case 42: entity.scale.y = parseFloat(g.value); break;
            case 43: entity.scale.z = parseFloat(g.value); break;
            case 50: entity.rotation = parseFloat(g.value); break;
            case 70: entity.colCount = parseInt(g.value); break;
            case 71: entity.rowCount = parseInt(g.value); break;
            case 44: entity.colSpacing = parseFloat(g.value); break;
            case 45: entity.rowSpacing = parseFloat(g.value); break;
            case 66: hasAttribs = parseInt(g.value) === 1; break;
        }
    }

    const ocs = getOcsToWcsMatrix(entity.extrusion.x, entity.extrusion.y, entity.extrusion.z);
    entity.position = applyOcs(entity.position, ocs, z);
    entity.rotation = getWcsRotation(entity.rotation, ocs);

    if (ocs) {
        const det2D = ocs.Ax.x * ocs.Ay.y - ocs.Ax.y * ocs.Ay.x;
        if (det2D < 0) {
            entity.scale.x = -entity.scale.x;
        }
    }

    entity.attributes = [];
    while(state.hasNext) {
        const p = state.peek();
        if (!p) break;
        if (p.code === 0) {
            if (p.value === 'SEQEND') { state.next(); break; }
            if (p.value === 'ATTRIB') {
                state.next();
                const attribCommon = parseCommon(state);
                const attrib = parseText(state, attribCommon, EntityType.ATTRIB);
                entity.attributes.push(attrib);
                continue;
            }
            break;
        }
        state.next();
    }
    if (entity.attributes.length === 0 && !hasAttribs) {
        delete entity.attributes;
    }
    return entity;
};

const parseText = (state: DxfParserState, common: any, type: EntityType): DxfText => {
    const entity: any = {
        ...common,
        type,
        position: { x: 0, y: 0 },
        height: 0,
        value: '',
        rotation: 0,
        widthFactor: 0,
        hAlign: 0,
        vAlign: 0,
    };

    let z = 0;
    let z2 = 0;
    const valueParts: string[] = [];
    let secondPos: Point2D | undefined;
    let direction: Point2D | undefined;

    while (state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroup(entity, g.code, g.value);
        switch (g.code) {
            case 1: valueParts.push(g.value); break;
            case 3: valueParts.push(g.value); break;
            case 10: entity.position.x = parseFloat(g.value); break;
            case 20: entity.position.y = parseFloat(g.value); break;
            case 30: z = parseFloat(g.value); break;
            case 40: entity.height = parseFloat(g.value); break;
            case 50: entity.rotation = parseFloat(g.value); break;
            case 41:
                if (type === EntityType.MTEXT) entity.width = parseFloat(g.value);
                else entity.widthFactor = parseFloat(g.value);
                break;
            case 72:
                if (type === EntityType.MTEXT) entity.drawingDirection = parseInt(g.value, 10);
                else entity.hAlign = parseInt(g.value, 10);
                break;
            case 73:
                if (type === EntityType.MTEXT) entity.lineSpacingStyle = parseInt(g.value, 10);
                else entity.vAlign = parseInt(g.value, 10);
                break;
            case 11:
                if (type === EntityType.MTEXT) {
                    if (!direction) direction = { x: 0, y: 0 };
                    direction.x = parseFloat(g.value);
                } else {
                    if (!secondPos) secondPos = { x: 0, y: 0 };
                    secondPos.x = parseFloat(g.value);
                }
                break;
            case 21:
                if (type === EntityType.MTEXT) {
                    if (!direction) direction = { x: 0, y: 0 };
                    direction.y = parseFloat(g.value);
                } else {
                    if (!secondPos) secondPos = { x: 0, y: 0 };
                    secondPos.y = parseFloat(g.value);
                }
                break;
            case 31: z2 = parseFloat(g.value); break;
            case 71:
                if (type === EntityType.MTEXT) entity.attachmentPoint = parseInt(g.value, 10);
                else entity.textGenerationFlags = parseInt(g.value, 10);
                break;
            case 42: if (type === EntityType.MTEXT) entity.actualWidth = parseFloat(g.value); break;
            case 43: entity.boxHeight = parseFloat(g.value); break;
            case 44: if (type === EntityType.MTEXT) entity.lineSpacingFactor = parseFloat(g.value); break;
            case 2: if (type === EntityType.ATTDEF || type === EntityType.ATTRIB) entity.tag = g.value; break;
            case 70: if (type === EntityType.ATTDEF) entity.flags = parseInt(g.value, 10); break;
            case 63: if (type === EntityType.MTEXT) entity.bgColor = parseInt(g.value); break;
            case 90:
                if (type === EntityType.MTEXT) {
                    const mask = parseInt(g.value);
                    entity.bgFill = (mask & 1) === 1 || (mask & 2) === 2;
                }
                break;
            case 7: entity.styleName = g.value; break;
        }
    }

    entity.value = valueParts.join('');
    if (type === EntityType.MTEXT) {
        const matches = entity.value.match(/\\[Ww](\d+(\.\d+)?)(?:;|$)/);
        if (matches?.[1]) entity.widthFactor = parseFloat(matches[1]);
    }

    if (!entity.styleName) entity.styleName = CAD_DEFAULT_TEXT_STYLE;
    if (!entity.height) entity.height = 0;
    if (!entity.widthFactor) entity.widthFactor = 0;

    const ocs = getOcsToWcsMatrix(entity.extrusion.x, entity.extrusion.y, entity.extrusion.z);
    if (type === EntityType.MTEXT) {
        entity.position = applyOcs(entity.position, ocs, z);
        if (direction && (Math.abs(direction.x) > 1e-6 || Math.abs(direction.y) > 1e-6)) {
            if (ocs) {
                const wcsDirection = {
                    x: direction.x * ocs.Ax.x + direction.y * ocs.Ay.x,
                    y: direction.x * ocs.Ax.y + direction.y * ocs.Ay.y,
                };
                entity.rotation = Math.atan2(wcsDirection.y, wcsDirection.x) * 180 / Math.PI;
            } else {
                entity.rotation = Math.atan2(direction.y, direction.x) * 180 / Math.PI;
            }
        } else {
            entity.rotation = getWcsRotation(entity.rotation, ocs);
        }
    } else {
        entity.position = applyOcs(entity.position, ocs, z);
        if (secondPos) entity.secondPosition = applyOcs(secondPos, ocs, z2);
        entity.rotation = getWcsRotation(entity.rotation, ocs);
    }

    if (type === EntityType.ATTRIB) {
        const tooFar = (p: Point2D) => !isFinite(p.x) || !isFinite(p.y) || Math.abs(p.x) > 1e9 || Math.abs(p.y) > 1e9;
        if (tooFar(entity.position) || (entity.secondPosition && tooFar(entity.secondPosition)) || (isFinite(entity.height) && Math.abs(entity.height) > 1e6)) {
            entity.visible = false;
        }
    }

    if (ocs) {
        const det2D = ocs.Ax.x * ocs.Ay.y - ocs.Ax.y * ocs.Ay.x;
        if (det2D < 0) entity.widthFactor = -(entity.widthFactor || 1);
    }

    return entity;
};

const parseSpline = (state: DxfParserState, common: any): DxfSpline => {
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
        applyCommonGroup(entity, g.code, g.value);
        switch(g.code) {
            case 70: entity.flags = parseInt(g.value); break;
            case 71: entity.degree = parseInt(g.value); break;
            case 40: entity.knots.push(parseFloat(g.value)); break;
            case 41: entity.weights.push(parseFloat(g.value)); break;
            case 10: entity.controlPoints.push({x: parseFloat(g.value), y: 0}); break; 
            case 20: if (entity.controlPoints.length > 0) entity.controlPoints[entity.controlPoints.length-1].y = parseFloat(g.value); break;
            case 30: if (entity.controlPoints.length > 0) (entity.controlPoints[entity.controlPoints.length-1] as any).z = parseFloat(g.value); break;
            case 11: entity.fitPoints.push({x: parseFloat(g.value), y: 0}); break;
            case 21: if (entity.fitPoints.length > 0) entity.fitPoints[entity.fitPoints.length-1].y = parseFloat(g.value); break;
            case 31: if (entity.fitPoints.length > 0) (entity.fitPoints[entity.fitPoints.length-1] as any).z = parseFloat(g.value); break;
        }
    }
    
    if (entity.controlPoints.length > 0) {
        entity.calculatedPoints = getBSplinePoints(entity.controlPoints, entity.degree, entity.knots, entity.weights);
    }
    return entity;
};

const parseEllipse = (state: DxfParserState, common: any): AnyEntity => {
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
        applyCommonGroup(entity, g.code, g.value);
        switch(g.code) {
            case 10: entity.center.x = parseFloat(g.value); break;
            case 20: entity.center.y = parseFloat(g.value); break;
            case 11: entity.majorAxis.x = parseFloat(g.value); break;
            case 21: entity.majorAxis.y = parseFloat(g.value); break;
            case 40: entity.ratio = parseFloat(g.value); break;
            case 41: entity.startParam = parseFloat(g.value); break;
            case 42: entity.endParam = parseFloat(g.value); break;
        }
    }
    return entity;
};

const parseDimension = (state: DxfParserState, common: any): AnyEntity => {
    const entity: any = { 
        ...common, 
        type: EntityType.DIMENSION, 
        blockName: '', 
        definitionPoint: {x:0, y:0}, 
        textMidPoint: {x:0, y:0}, 
        linearP1: {x:0, y:0},
        linearP2: {x:0, y:0},
        arcP1: {x:0, y:0},
        arcP2: {x:0, y:0},
        dimType: 0, 
        text: '', 
        measurement: 0 
    };
    let z1=0, z2=0, z3=0, z4=0, z5=0, z6=0;
    while(state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroup(entity, g.code, g.value);
        switch(g.code) {
            case 2: entity.blockName = g.value; break;
            case 10: entity.definitionPoint.x = parseFloat(g.value); break;
            case 20: entity.definitionPoint.y = parseFloat(g.value); break;
            case 30: z1 = parseFloat(g.value); break;
            case 11: entity.textMidPoint.x = parseFloat(g.value); break;
            case 21: entity.textMidPoint.y = parseFloat(g.value); break;
            case 31: z2 = parseFloat(g.value); break;
            case 13: if (!entity.linearP1) entity.linearP1 = {x:0, y:0}; entity.linearP1.x = parseFloat(g.value); break;
            case 23: if (!entity.linearP1) entity.linearP1 = {x:0, y:0}; entity.linearP1.y = parseFloat(g.value); break;
            case 33: z3 = parseFloat(g.value); break;
            case 14: if (!entity.linearP2) entity.linearP2 = {x:0, y:0}; entity.linearP2.x = parseFloat(g.value); break;
            case 24: if (!entity.linearP2) entity.linearP2 = {x:0, y:0}; entity.linearP2.y = parseFloat(g.value); break;
            case 34: z4 = parseFloat(g.value); break;
            case 15: if (!entity.arcP1) entity.arcP1 = {x:0, y:0}; entity.arcP1.x = parseFloat(g.value); break;
            case 25: if (!entity.arcP1) entity.arcP1 = {x:0, y:0}; entity.arcP1.y = parseFloat(g.value); break;
            case 35: z5 = parseFloat(g.value); break;
            case 16: if (!entity.arcP2) entity.arcP2 = {x:0, y:0}; entity.arcP2.x = parseFloat(g.value); break;
            case 26: if (!entity.arcP2) entity.arcP2 = {x:0, y:0}; entity.arcP2.y = parseFloat(g.value); break;
            case 36: z6 = parseFloat(g.value); break;
            case 70: entity.dimType = parseInt(g.value); break;
            case 1: entity.text = g.value; break;
            case 42: entity.measurement = parseFloat(g.value); break;
            case 3: entity.styleName = g.value; break;
        }
    }
    const ocs = getOcsToWcsMatrix(entity.extrusion.x, entity.extrusion.y, entity.extrusion.z);
    entity.definitionPoint = applyOcs(entity.definitionPoint, ocs, z1);
    entity.textMidPoint = applyOcs(entity.textMidPoint, ocs, z2);
    if (entity.linearP1) entity.linearP1 = applyOcs(entity.linearP1, ocs, z3);
    if (entity.linearP2) entity.linearP2 = applyOcs(entity.linearP2, ocs, z4);
    if (entity.arcP1) entity.arcP1 = applyOcs(entity.arcP1, ocs, z5);
    if (entity.arcP2) entity.arcP2 = applyOcs(entity.arcP2, ocs, z6);
    return entity;
};

const parseHatch = (state: DxfParserState, common: any): DxfHatch => {
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
        }
        if (currentLoop) {
            if (currentLoop.isPolyline) {
                if (g.code === 10) { currentLoop.points!.push({ x: parseFloat(g.value), y: 0 }); currentLoop.bulges!.push(0); }
                if (g.code === 20 && currentLoop.points!.length > 0) currentLoop.points![currentLoop.points!.length - 1].y = parseFloat(g.value);
                if (g.code === 42 && currentLoop.bulges!.length > 0) currentLoop.bulges![currentLoop.bulges!.length - 1] = parseFloat(g.value);
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
                            const sRad = edge.startAngle * Math.PI / 180;
                            const eRad = edge.endAngle * Math.PI / 180;
                            edge.start = { x: edge.center.x + edge.radius * Math.cos(sRad), y: edge.center.y + edge.radius * Math.sin(sRad) };
                            edge.end = { x: edge.center.x + edge.radius * Math.cos(eRad), y: edge.center.y + edge.radius * Math.sin(eRad) };
                        }
                    } else if (edgeType === 3) {
                        edge.type = 'ELLIPSE';
                         const center = readPoint(state, 10, 20); const maj = readPoint(state, 11, 21);
                         const ratio = readVal(state, 40); const startAng = readVal(state, 50); const endAng = readVal(state, 51); const ccw = readVal(state, 73);
                         if(center) edge.center = center; if(maj) edge.majorAxis = maj;
                         if(ratio) edge.ratio = ratio; if(startAng) edge.startAngle = startAng; if(endAng) edge.endAngle = endAng;
                         if(ccw !== null) edge.ccw = ccw === 1;

                         if (edge.center && edge.majorAxis && edge.ratio !== undefined) {
                             const sRad = (edge.startAngle || 0) * Math.PI / 180;
                             const eRad = (edge.endAngle || 360) * Math.PI / 180;
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
                             edge.calculatedPoints = getBSplinePoints(edge.controlPoints, edge.degree || 3, edge.knots, edge.weights, 20);
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

const parseLeader = (state: DxfParserState, common: any): DxfLeader => {
    const entity: any = { 
        ...common, 
        type: EntityType.LEADER, 
        points: [],
        arrowHeadFlag: 1, 
        pathType: 0,
        hasHookLine: false
    };
    let currX: number | null = null;
    while(state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroup(entity, g.code, g.value);
        switch(g.code) {
            case 71: entity.arrowHeadFlag = parseInt(g.value); break;
            case 72: entity.pathType = parseInt(g.value); break;
            case 75: entity.hasHookLine = parseInt(g.value) !== 0; break;
            case 340: entity.annotationHandle = g.value; break;
            case 10: currX = parseFloat(g.value); break;
            case 20: if (currX !== null) { entity.points.push({x: currX, y: parseFloat(g.value)}); currX = null; } break;
        }
    }
    const ocs = getOcsToWcsMatrix(entity.extrusion.x, entity.extrusion.y, entity.extrusion.z);
    if (ocs) {
        for(let i=0; i<entity.points.length; i++) {
             entity.points[i] = applyOcs(entity.points[i], ocs);
        }
    }
    return entity;
};

const parseMLeader = (state: DxfParserState, common: any): DxfMLeader => {
    const entity: DxfMLeader = {
        ...common,
        type: EntityType.MLEADER,
        leaderLines: [],
        text: '',
        textHeight: LEADER_RENDER_CONFIG.defaultMLeaderTextHeight,
        textWidth: LEADER_RENDER_CONFIG.defaultMLeaderTextWidth,
        arrowSize: 0,
        doglegLength: LEADER_RENDER_CONFIG.defaultMLeaderDoglegLength,
        enableLanding: true,
        enableDogleg: true,
        contentType: 0,
    };

    let activeLine: Point2D[] | null = null;
    let pendingX: number | null = null;
    let pendingDoglegX: number | null = null;
    const fallbackPoints: Point2D[] = [];
    let outsidePointIndex = 0;

    while (state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroup(entity, g.code, g.value);

        const valueUpper = String(g.value || '').toUpperCase();
        if (g.code === 302 && valueUpper.includes('LEADER')) {
            activeLine = [];
            entity.leaderLines.push(activeLine);
            pendingX = null;
            pendingDoglegX = null;
            continue;
        }
        if (g.code === 303 && activeLine) {
            if (activeLine.length === 0) entity.leaderLines.pop();
            activeLine = null;
            pendingX = null;
            pendingDoglegX = null;
            continue;
        }

        switch (g.code) {
            case 10:
                pendingX = parseFloat(g.value);
                break;
            case 20:
                if (pendingX !== null) {
                    const point = { x: pendingX, y: parseFloat(g.value) };
                    if (activeLine) activeLine.push(point);
                    else {
                        fallbackPoints.push(point);
                        if (outsidePointIndex === 0) entity.textPosition = point;
                        outsidePointIndex++;
                    }
                    pendingX = null;
                }
                break;
            case 11:
                pendingDoglegX = parseFloat(g.value);
                break;
            case 21:
                if (pendingDoglegX !== null) {
                    entity.doglegVector = { x: pendingDoglegX, y: parseFloat(g.value) };
                    pendingDoglegX = null;
                }
                break;
            case 173:
                entity.textLeftAttachment = parseInt(g.value, 10);
                break;
            case 95:
                entity.textRightAttachment = parseInt(g.value, 10);
                break;
            case 175:
                entity.textAlignment = parseInt(g.value, 10);
                break;
            case 179:
                entity.textAttachment = parseInt(g.value, 10);
                break;
            case 304:
            case 305:
                entity.text = entity.text ? `${entity.text}\\P${g.value}` : g.value;
                break;
            case 40:
                {
                    const v = parseFloat(g.value);
                    if (Number.isFinite(v) && v > 0 && v < 100000) entity.textHeight = v;
                }
                break;
            case 41:
                {
                    const v = parseFloat(g.value);
                    if (Number.isFinite(v) && v >= 0 && v < 100000) entity.doglegLength = v;
                }
                break;
            case 42:
                {
                    const v = parseFloat(g.value);
                    if (Number.isFinite(v) && v >= 0 && v < 100000) entity.arrowSize = v;
                }
                break;
            case 43:
                {
                    const v = parseFloat(g.value);
                    if (Number.isFinite(v) && v > 0 && v < 1000000) entity.textWidth = v;
                }
                break;
            case 172:
                entity.contentType = parseInt(g.value, 10);
                break;
            case 290:
                entity.enableLanding = parseInt(g.value, 10) !== 0;
                break;
            case 291:
                entity.enableDogleg = parseInt(g.value, 10) !== 0;
                break;
        }
    }

    if (entity.leaderLines.length === 0 && fallbackPoints.length >= 2) {
        entity.leaderLines.push(fallbackPoints);
    }

    return entity;
};

const parseMLine = (state: DxfParserState, common: any): DxfMLine => {
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
        applyCommonGroup(entity, g.code, g.value);
        switch (g.code) {
            case 70:
                entity.closed = (parseInt(g.value, 10) & 1) !== 0;
                break;
            case 11:
                pendingX = parseFloat(g.value);
                break;
            case 21:
                if (pendingX !== null) {
                    entity.vertices.push({ x: pendingX, y: parseFloat(g.value) });
                    pendingX = null;
                }
                break;
        }
    }
    return entity;
};

const parseSolid = (state: DxfParserState, common: any, type: string): AnyEntity => {
    const entity: any = { ...common, type: type === '3DFACE' ? EntityType.THREEDFACE : EntityType.SOLID, points: [] };
    const pts: ({x:number, y:number, z:number} | null)[] = [null, null, null, null];
    
    while(state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroup(entity, g.code, g.value);
        switch(g.code) {
            case 10: if (!pts[0]) pts[0] = {x:0, y:0, z:0}; pts[0].x = parseFloat(g.value); break;
            case 20: if (!pts[0]) pts[0] = {x:0, y:0, z:0}; pts[0].y = parseFloat(g.value); break;
            case 30: if (!pts[0]) pts[0] = {x:0, y:0, z:0}; pts[0].z = parseFloat(g.value); break;
            case 11: if (!pts[1]) pts[1] = {x:0, y:0, z:0}; pts[1].x = parseFloat(g.value); break;
            case 21: if (!pts[1]) pts[1] = {x:0, y:0, z:0}; pts[1].y = parseFloat(g.value); break;
            case 31: if (!pts[1]) pts[1] = {x:0, y:0, z:0}; pts[1].z = parseFloat(g.value); break;
            case 12: if (!pts[2]) pts[2] = {x:0, y:0, z:0}; pts[2].x = parseFloat(g.value); break;
            case 22: if (!pts[2]) pts[2] = {x:0, y:0, z:0}; pts[2].y = parseFloat(g.value); break;
            case 32: if (!pts[2]) pts[2] = {x:0, y:0, z:0}; pts[2].z = parseFloat(g.value); break;
            case 13: if (!pts[3]) pts[3] = {x:0, y:0, z:0}; pts[3].x = parseFloat(g.value); break;
            case 23: if (!pts[3]) pts[3] = {x:0, y:0, z:0}; pts[3].y = parseFloat(g.value); break;
            case 33: if (!pts[3]) pts[3] = {x:0, y:0, z:0}; pts[3].z = parseFloat(g.value); break;
            case 70: if (type === '3DFACE') entity.edgeFlags = parseInt(g.value); break;
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

const parsePointEntity = (state: DxfParserState, common: any): AnyEntity => {
    const entity: any = { ...common, type: EntityType.POINT, position: {x:0, y:0} };
    while(state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroup(entity, g.code, g.value);
        if (g.code === 10) entity.position.x = parseFloat(g.value);
        if (g.code === 20) entity.position.y = parseFloat(g.value);
    }
    return entity;
};

const parseAcadTable = (state: DxfParserState, common: any, blockHandleMap?: Record<string, string>): DxfTable | null => {
    const entity: DxfTable = { 
        ...common, 
        type: EntityType.ACAD_TABLE, 
        blockName: '', 
        position: {x:0, y:0},
        scale: {x:1, y:1, z:1},
        rotation: 0,
        rowHeights: [],
        colWidths: []
    };
    
    let z = 0;
    let blockHandle = '';
    let direction = {x: 1, y: 0, z: 0};
    let subclass = '';

    while(state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroup(entity, g.code, g.value);
        switch(g.code) {
            case 100: subclass = g.value; break;
            case 2: entity.blockName = g.value; break; 
            case 10: entity.position.x = parseFloat(g.value); break;
            case 20: entity.position.y = parseFloat(g.value); break;
            case 30: z = parseFloat(g.value); break;
            case 50: entity.rotation = parseFloat(g.value); break;
            case 342: blockHandle = g.value; break; 
            case 11: direction.x = parseFloat(g.value); break; 
            case 21: direction.y = parseFloat(g.value); break; 
            case 31: direction.z = parseFloat(g.value); break;
            case 41:
                if (subclass === 'AcDbBlockReference') entity.scale!.x = parseFloat(g.value);
                break;
            case 42:
                if (subclass === 'AcDbBlockReference') entity.scale!.y = parseFloat(g.value);
                break;
            case 43:
                if (subclass === 'AcDbBlockReference') entity.scale!.z = parseFloat(g.value);
                break;
            case 91: entity.rowCount = parseInt(g.value); break;
            case 92: entity.columnCount = parseInt(g.value); break;
            case 141: {
                const rowHeight = parseFloat(g.value);
                entity.rowSpacing = rowHeight;
                entity.rowHeights?.push(rowHeight);
                break;
            }
            case 142: {
                const columnWidth = parseFloat(g.value);
                entity.columnSpacing = columnWidth;
                entity.colWidths?.push(columnWidth);
                break;
            }
            case 44: entity.columnSpacing = parseFloat(g.value); break;
            case 45: entity.rowSpacing = parseFloat(g.value); break;
            case 1: 
                if (!entity.cells) entity.cells = [];
                entity.cells.push(g.value);
                break;
        }
    }

    if (direction.x !== 1 || direction.y !== 0 || direction.z !== 0) {
        (entity as any).direction = direction;
        if (!entity.rotation) {
            entity.rotation = Math.atan2(direction.y, direction.x) * 180 / Math.PI;
        }
    }

    if (!entity.blockName && blockHandle && blockHandleMap) {
        entity.blockName = blockHandleMap[blockHandle] || '';
    }

    normalizeAcadTableGeometry(entity);

    const ocs = getOcsToWcsMatrix(entity.extrusion!.x, entity.extrusion!.y, entity.extrusion!.z);
    entity.position = applyOcs(entity.position, ocs, z);
    if (entity.rotation) {
        entity.rotation = getWcsRotation(entity.rotation, ocs);
    }

    return entity;
};

const parseRayXLine = (state: DxfParserState, common: any, type: string): AnyEntity => {
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
        applyCommonGroup(entity, g.code, g.value);
        switch(g.code) {
            case 10: entity.basePoint.x = parseFloat(g.value); break;
            case 20: entity.basePoint.y = parseFloat(g.value); break;
            case 30: z1 = parseFloat(g.value); break;
            case 11: entity.direction.x = parseFloat(g.value); break;
            case 21: entity.direction.y = parseFloat(g.value); break;
            case 31: z2 = parseFloat(g.value); break;
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

/**
 * 解析 IMAGE 实体
 */
const parseImage = (state: DxfParserState, common: any): DxfImage => {
    const entity: DxfImage = {
        ...common,
        type: EntityType.IMAGE,
        position: { x: 0, y: 0, z: 0 },
        imageSize: { x: 0, y: 0 },
        uVector: { x: 1, y: 0, z: 0 },
        vVector: { x: 0, y: 1, z: 0 },
        brightness: 50,
        contrast: 50,
        fade: 0
    };
    let z = 0;
    while (state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroup(entity, g.code, g.value);
        switch (g.code) {
            case 10: entity.position.x = parseFloat(g.value); break;
            case 20: entity.position.y = parseFloat(g.value); break;
            case 30: z = parseFloat(g.value); break;
            case 11: entity.uVector!.x = parseFloat(g.value); break;
            case 21: entity.uVector!.y = parseFloat(g.value); break;
            case 31: entity.uVector!.z = parseFloat(g.value); break;
            case 12: entity.vVector!.x = parseFloat(g.value); break;
            case 22: entity.vVector!.y = parseFloat(g.value); break;
            case 32: entity.vVector!.z = parseFloat(g.value); break;
            case 13: entity.imageSize.x = parseFloat(g.value); break;
            case 23: entity.imageSize.y = parseFloat(g.value); break;
            case 340: entity.imageRef = g.value; break;
            case 281: entity.brightness = parseInt(g.value, 10); break;
            case 282: entity.contrast = parseInt(g.value, 10); break;
            case 283: entity.fade = parseInt(g.value, 10); break;
        }
    }
    entity.position.z = z;
    const ocs = getOcsToWcsMatrix(entity.extrusion!.x, entity.extrusion!.y, entity.extrusion!.z);
    const pos2D = applyOcs({ x: entity.position.x, y: entity.position.y }, ocs, z);
    entity.position = { x: pos2D.x, y: pos2D.y, z };
    return entity;
};

/**
 * 解析 WIPEOUT 实体
 */
const parseWipeout = (state: DxfParserState, common: any): DxfWipeout => {
    const entity: DxfWipeout = {
        ...common,
        type: EntityType.WIPEOUT,
        points: [],
        closed: true
    };
    let currX: number | null = null;
    while (state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroup(entity, g.code, g.value);
        switch (g.code) {
            case 10: currX = parseFloat(g.value); break;
            case 20: if (currX !== null) { entity.points.push({ x: currX, y: parseFloat(g.value) }); currX = null; } break;
            case 70: entity.closed = (parseInt(g.value, 10) & 1) === 1; break;
        }
    }
    const ocs = getOcsToWcsMatrix(entity.extrusion!.x, entity.extrusion!.y, entity.extrusion!.z);
    if (ocs) {
        entity.points = entity.points.map(p => applyOcs(p, ocs));
    }
    return entity;
};

/**
 * 解析 HELIX 实体
 */
const parseHelix = (state: DxfParserState, common: any): DxfHelix => {
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
        applyCommonGroup(entity, g.code, g.value);
        switch (g.code) {
            case 10: entity.startPoint.x = parseFloat(g.value); break;
            case 20: entity.startPoint.y = parseFloat(g.value); break;
            case 30: zStart = parseFloat(g.value); break;
            case 11: entity.axisVector.x = parseFloat(g.value); break;
            case 21: entity.axisVector.y = parseFloat(g.value); break;
            case 31: entity.axisVector.z = parseFloat(g.value); break;
            case 40: entity.radius = parseFloat(g.value); break;
            case 41: entity.turns = parseFloat(g.value); break;
            case 42: entity.pitch = parseFloat(g.value); break;
            case 71: entity.handedness = parseInt(g.value, 10); break;
        }
    }
    entity.startPoint.z = zStart;
    return entity;
};

/**
 * 解析 TOLERANCE 实体
 */
const parseTolerance = (state: DxfParserState, common: any): DxfTolerance => {
    const entity: DxfTolerance = {
        ...common,
        type: EntityType.TOLERANCE,
        position: { x: 0, y: 0, z: 0 },
        text: '',
        direction: { x: 1, y: 0, z: 0 }
    };
    let z = 0;
    while (state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroup(entity, g.code, g.value);
        switch (g.code) {
            case 1: entity.text = g.value; break;
            case 10: entity.position.x = parseFloat(g.value); break;
            case 20: entity.position.y = parseFloat(g.value); break;
            case 30: z = parseFloat(g.value); break;
            case 11: entity.direction!.x = parseFloat(g.value); break;
            case 21: entity.direction!.y = parseFloat(g.value); break;
            case 31: entity.direction!.z = parseFloat(g.value); break;
        }
    }
    entity.position.z = z;
    const ocs = getOcsToWcsMatrix(entity.extrusion!.x, entity.extrusion!.y, entity.extrusion!.z);
    const pos2D = applyOcs({ x: entity.position.x, y: entity.position.y }, ocs, z);
    entity.position = { x: pos2D.x, y: pos2D.y, z };
    return entity;
};

/**
 * 跳过不支持的三维实体，记录骨架
 */
const parse3DSolidOrBodyOrSurface = (state: DxfParserState, common: any, type: EntityType): AnyEntity | null => {
    while (state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        state.next();
    }
    return {
        ...common,
        type
    } as any;
};


/**
 * 解析 VIEWPORT 实体。
 * 纸张空间中常见的 VIEWPORT 作为矩形视口边框保留，用于布局空间预览和选择。
 */
const parseViewport = (state: DxfParserState, common: any): AnyEntity => {
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
        applyCommonGroup(entity, g.code, g.value);
        switch (g.code) {
            case 10: entity.center.x = parseFloat(g.value); break;
            case 20: entity.center.y = parseFloat(g.value); break;
            case 30: z = parseFloat(g.value); break;
            case 40: entity.height = parseFloat(g.value); break;
            case 41: entity.width = parseFloat(g.value); break;
            case 12: entity.viewCenter.x = parseFloat(g.value); break;
            case 22: entity.viewCenter.y = parseFloat(g.value); break;
            case 45: entity.viewHeight = parseFloat(g.value); break;
            case 51: entity.twistAngle = parseFloat(g.value); break;
            case 68: entity.status = parseInt(g.value, 10); break;
            case 69: entity.viewportId = parseInt(g.value, 10); break;
        }
    }
    const ocs = getOcsToWcsMatrix(entity.extrusion.x, entity.extrusion.y, entity.extrusion.z);
    entity.center = applyOcs(entity.center, ocs, z);
    return entity;
};

/**
 * 解析 SHAPE 实体。
 * SHAPE 依赖外部形文件，当前先保留名称、插入点、尺寸和旋转角度，并以轻量占位方式渲染。
 */
const parseShape = (state: DxfParserState, common: any): AnyEntity => {
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
        applyCommonGroup(entity, g.code, g.value);
        switch (g.code) {
            case 2: entity.name = g.value; break;
            case 10: entity.position.x = parseFloat(g.value); break;
            case 20: entity.position.y = parseFloat(g.value); break;
            case 30: z = parseFloat(g.value); break;
            case 40: entity.size = parseFloat(g.value); break;
            case 41: entity.xScale = parseFloat(g.value); break;
            case 50: entity.rotation = parseFloat(g.value); break;
            case 51: entity.oblique = parseFloat(g.value); break;
        }
    }
    const ocs = getOcsToWcsMatrix(entity.extrusion.x, entity.extrusion.y, entity.extrusion.z);
    entity.position = applyOcs(entity.position, ocs, z);
    entity.rotation = getWcsRotation(entity.rotation || 0, ocs);
    return entity;
};
