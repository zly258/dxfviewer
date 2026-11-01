import { AnyEntity, DxfInsert, DxfTable, EntityType } from '@/types';
import { normalizeAcadTableGeometry } from '@/core/geometry/extents';
import { getOcsToWcsMatrix, applyOcs, getWcsRotation } from '@/core/geometry/ocs';
import { DxfParserState, applyCommonGroupFrom, parseCommon } from './parserState';
import { parseText } from './textEntityParser';

export const parseInsert = (state: DxfParserState, common: any): DxfInsert => {
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
        applyCommonGroupFrom(entity, g);
        switch(g.code) {
            case 2: entity.blockName = g.value; break;
            case 10: entity.position.x = g.float; break;
            case 20: entity.position.y = g.float; break;
            case 30: z = g.float; break;
            case 41: entity.scale.x = g.float; break;
            case 42: entity.scale.y = g.float; break;
            case 43: entity.scale.z = g.float; break;
            case 50: entity.rotation = g.float; break;
            case 70: entity.colCount = (g.float | 0); break;
            case 71: entity.rowCount = (g.float | 0); break;
            case 44: entity.colSpacing = g.float; break;
            case 45: entity.rowSpacing = g.float; break;
            case 66: hasAttribs = (g.float | 0) === 1; break;
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

export const parseDimension = (state: DxfParserState, common: any): AnyEntity => {
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
        applyCommonGroupFrom(entity, g);
        switch(g.code) {
            case 2: entity.blockName = g.value; break;
            case 10: entity.definitionPoint.x = g.float; break;
            case 20: entity.definitionPoint.y = g.float; break;
            case 30: z1 = g.float; break;
            case 11: entity.textMidPoint.x = g.float; break;
            case 21: entity.textMidPoint.y = g.float; break;
            case 31: z2 = g.float; break;
            case 13: if (!entity.linearP1) entity.linearP1 = {x:0, y:0}; entity.linearP1.x = g.float; break;
            case 23: if (!entity.linearP1) entity.linearP1 = {x:0, y:0}; entity.linearP1.y = g.float; break;
            case 33: z3 = g.float; break;
            case 14: if (!entity.linearP2) entity.linearP2 = {x:0, y:0}; entity.linearP2.x = g.float; break;
            case 24: if (!entity.linearP2) entity.linearP2 = {x:0, y:0}; entity.linearP2.y = g.float; break;
            case 34: z4 = g.float; break;
            case 15: if (!entity.arcP1) entity.arcP1 = {x:0, y:0}; entity.arcP1.x = g.float; break;
            case 25: if (!entity.arcP1) entity.arcP1 = {x:0, y:0}; entity.arcP1.y = g.float; break;
            case 35: z5 = g.float; break;
            case 16: if (!entity.arcP2) entity.arcP2 = {x:0, y:0}; entity.arcP2.x = g.float; break;
            case 26: if (!entity.arcP2) entity.arcP2 = {x:0, y:0}; entity.arcP2.y = g.float; break;
            case 36: z6 = g.float; break;
            case 70: entity.dimType = (g.float | 0); break;
            case 1: entity.text = g.value; break;
            case 42: entity.measurement = g.float; break;
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

export const parseAcadTable = (state: DxfParserState, common: any, blockHandleMap?: Record<string, string>): DxfTable | null => {
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
        applyCommonGroupFrom(entity, g);
        switch(g.code) {
            case 100: subclass = g.value; break;
            case 2: entity.blockName = g.value; break;
            case 10: entity.position.x = g.float; break;
            case 20: entity.position.y = g.float; break;
            case 30: z = g.float; break;
            case 50: entity.rotation = g.float; break;
            case 342: blockHandle = g.value; break;
            case 11: direction.x = g.float; break;
            case 21: direction.y = g.float; break;
            case 31: direction.z = g.float; break;
            case 41:
                if (subclass === 'AcDbBlockReference') entity.scale!.x = g.float;
                break;
            case 42:
                if (subclass === 'AcDbBlockReference') entity.scale!.y = g.float;
                break;
            case 43:
                if (subclass === 'AcDbBlockReference') entity.scale!.z = g.float;
                break;
            case 91: entity.rowCount = (g.float | 0); break;
            case 92: entity.columnCount = (g.float | 0); break;
            case 141: {
                const rowHeight = g.float;
                entity.rowSpacing = rowHeight;
                entity.rowHeights?.push(rowHeight);
                break;
            }
            case 142: {
                const columnWidth = g.float;
                entity.columnSpacing = columnWidth;
                entity.colWidths?.push(columnWidth);
                break;
            }
            case 44: entity.columnSpacing = g.float; break;
            case 45: entity.rowSpacing = g.float; break;
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
