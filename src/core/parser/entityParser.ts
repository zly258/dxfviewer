import { AnyEntity, EntityType, RawGroupPair } from '@/types';
import { DxfParserState, parseCommon } from './parserState';
import { consumeEntityGroups } from './groupValue';
import { formatGroupCode } from '@/core/dxf/groupCodes';
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
 *
 * @param preserveRaw 保真模式：先快照实体全部组码（到下一个 0 组码为止），
 * 再对快照解析；快照挂到 `entity.raw` 供写出器回放（含 XDATA、子类标记等）。
 * 注意：实体解析器本身会消费直到下一个 0 组码的全部内容，所以快照必须在解析前做。
 */
export const parseEntityDispatcher = (
    type: string,
    state: DxfParserState,
    blockHandleMap?: Record<string, string>,
    preserveRaw = false,
): AnyEntity | null => {
    const common = parseCommon(state);

    if (!preserveRaw) {
        const parser = ENTITY_PARSERS[type];
        return parser
            ? parser(state, common, blockHandleMap, type)
            : (consumeEntityGroups(state), null);
    }

    // 快照：读出直到下一个 0 组码（实体边界）的全部组码对
    const raw: RawGroupPair[] = [];
    while (state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        raw.push({ code: g.code, value: g.value });
    }

    // 对快照重建一个独立解析状态（解析器按文本读取；值行保留原始文本）
    const snapshotText = raw
        .map(pair => `${formatGroupCode(pair.code)}\n${pair.value}\n`)
        .join('');
    const snapshotState = new DxfParserState(snapshotText);
    const parser = ENTITY_PARSERS[type];
    const entity = parser
        ? parser(snapshotState, common, blockHandleMap, type)
        : null;

    if (entity) entity.raw = [{ code: 0, value: type }, ...raw];
    return entity;
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
