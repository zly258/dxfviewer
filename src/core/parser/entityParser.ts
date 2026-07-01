import { AnyEntity, EntityType } from '@/types';
import { DxfParserState, parseCommon } from './parserState';
import { consumeEntityGroups } from './groupValue';
import { parseAcisMetadataEntity, parseRegionMetadata } from './metadataEntityParser';
import { parseHatch } from './hatchEntityParser';
import { parseText } from './textEntityParser';
import { parseAcadTable, parseDimension, parseInsert } from './blockEntityParser';
import { parseImage, parseLeader, parseMLeader, parseTolerance, parseWipeout } from './annotationEntityParser';
import {
    parseArc,
    parseCircle,
    parseEllipse,
    parseHelix,
    parseLine,
    parseLwPolyline,
    parseMLine,
    parsePointEntity,
    parsePolyline,
    parseRayXLine,
    parseShape,
    parseSolid,
    parseSpline,
    parseViewport,
} from './geometryEntityParser';

type EntityParser = (
    state: DxfParserState,
    common: any,
    blockHandleMap: Record<string, string> | undefined,
    rawType: string,
) => AnyEntity | null;

/**
 * 实体解析分发器，根据实体类型分发到注册表中的解析函数。
 */
export const parseEntityDispatcher = (type: string, state: DxfParserState, blockHandleMap?: Record<string, string>): AnyEntity | null => {
    const common = parseCommon(state);
    const parser = ENTITY_PARSERS[type];
    if (parser) return parser(state, common, blockHandleMap, type);

    // 消耗所有组码直到下一个实体（代码 0），安全地跳过未知实体。
    consumeEntityGroups(state);
    return null;
};

const ENTITY_PARSERS: Record<string, EntityParser> = {
    LINE: (state, common) => parseLine(state, common),
    CIRCLE: (state, common) => parseCircle(state, common),
    ARC: (state, common) => parseArc(state, common),
    LWPOLYLINE: (state, common) => parseLwPolyline(state, common),
    POLYLINE: (state, common) => parsePolyline(state, common),
    INSERT: (state, common) => parseInsert(state, common),
    TEXT: (state, common) => parseText(state, common, EntityType.TEXT),
    MTEXT: (state, common) => parseText(state, common, EntityType.MTEXT),
    ATTDEF: (state, common) => parseText(state, common, EntityType.ATTDEF),
    ATTRIB: (state, common) => parseText(state, common, EntityType.ATTRIB),
    POINT: (state, common) => parsePointEntity(state, common),
    SOLID: (state, common, _blockHandleMap, rawType) => parseSolid(state, common, rawType),
    TRACE: (state, common, _blockHandleMap, rawType) => parseSolid(state, common, rawType),
    '3DFACE': (state, common, _blockHandleMap, rawType) => parseSolid(state, common, rawType),
    SPLINE: (state, common) => parseSpline(state, common),
    ELLIPSE: (state, common) => parseEllipse(state, common),
    HATCH: (state, common) => parseHatch(state, common),
    DIMENSION: (state, common) => parseDimension(state, common),
    LEADER: (state, common) => parseLeader(state, common),
    MLEADER: (state, common) => parseMLeader(state, common),
    MULTILEADER: (state, common) => parseMLeader(state, common),
    MLINE: (state, common) => parseMLine(state, common),
    ACAD_TABLE: (state, common, blockHandleMap) => parseAcadTable(state, common, blockHandleMap),
    RAY: (state, common, _blockHandleMap, rawType) => parseRayXLine(state, common, rawType),
    XLINE: (state, common, _blockHandleMap, rawType) => parseRayXLine(state, common, rawType),
    IMAGE: (state, common) => parseImage(state, common),
    WIPEOUT: (state, common) => parseWipeout(state, common),
    HELIX: (state, common) => parseHelix(state, common),
    TOLERANCE: (state, common) => parseTolerance(state, common),
    VIEWPORT: (state, common) => parseViewport(state, common),
    SHAPE: (state, common) => parseShape(state, common),
    '3DSOLID': (state, common) => parseAcisMetadataEntity(state, common, EntityType.SOLID3D),
    BODY: (state, common) => parseAcisMetadataEntity(state, common, EntityType.BODY),
    SURFACE: (state, common) => parseAcisMetadataEntity(state, common, EntityType.SURFACE),
    REGION: (state, common) => parseRegionMetadata(state, common),
};
