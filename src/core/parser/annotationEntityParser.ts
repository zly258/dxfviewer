import { DxfImage, DxfLeader, DxfMLeader, DxfTolerance, DxfWipeout, EntityType, Point2D } from '@/types';
import { LEADER_RENDER_CONFIG } from '@/config/viewerConfig';
import { PARSER_LIMITS } from '@/config/parserConfig';
import { getOcsToWcsMatrix, applyOcs } from '@/core/geometry/ocs';
import { DxfParserState, applyCommonGroup } from './parserState';
import { isFiniteNumberInRange, parseFiniteNumber } from './groupValue';

export const parseLeader = (state: DxfParserState, common: any): DxfLeader => {
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

export const parseMLeader = (state: DxfParserState, common: any): DxfMLeader => {
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
                    const v = parseFiniteNumber(g.value);
                    if (isFiniteNumberInRange(v, 0, PARSER_LIMITS.maximumMLeaderTextHeight)) entity.textHeight = v;
                }
                break;
            case 41:
                {
                    const v = parseFiniteNumber(g.value);
                    if (isFiniteNumberInRange(v, 0, PARSER_LIMITS.maximumMLeaderDoglegLength, true)) entity.doglegLength = v;
                }
                break;
            case 42:
                {
                    const v = parseFiniteNumber(g.value);
                    if (isFiniteNumberInRange(v, 0, PARSER_LIMITS.maximumMLeaderArrowSize, true)) entity.arrowSize = v;
                }
                break;
            case 43:
                {
                    const v = parseFiniteNumber(g.value);
                    if (isFiniteNumberInRange(v, 0, PARSER_LIMITS.maximumMLeaderTextWidth)) entity.textWidth = v;
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

export const parseImage = (state: DxfParserState, common: any): DxfImage => {
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

export const parseWipeout = (state: DxfParserState, common: any): DxfWipeout => {
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

export const parseTolerance = (state: DxfParserState, common: any): DxfTolerance => {
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
