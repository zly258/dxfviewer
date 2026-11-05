import { DxfText, EntityType, Point2D } from '@/types';
import { CAD_DEFAULT_TEXT_STYLE } from '@/config/cadConstants';
import { PARSER_LIMITS } from '@/config/parserConfig';
import { getOcsToWcsMatrix, applyOcs, getWcsRotation } from '@/core/geometry/ocs';
import { DxfParserState, applyCommonGroupFrom } from './parserState';

export const parseText = (state: DxfParserState, common: any, type: EntityType): DxfText => {
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
    // MTEXT 的 "Embedded Object" 专有数据段（组码 101 之后）：其中含有
    // 与正文同号的 10/20/11/21 组码（方向向量、包围盒等），若继续解析
    // 会覆盖真实的插入点——实测导致中心线标注全部堆到原点附近呈乱码堆。
    // 该段是 AutoCAD 内部缓存，跳过直到实体结束。
    let skipEmbeddedObject = false;

    while (state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        if (g.code === 101) { skipEmbeddedObject = true; continue; }
        if (skipEmbeddedObject) continue;
        applyCommonGroupFrom(entity, g);
        switch (g.code) {
            case 1: valueParts.push(g.value); break;
            case 3: valueParts.push(g.value); break;
            case 10: entity.position.x = g.float; break;
            case 20: entity.position.y = g.float; break;
            case 30: z = g.float; break;
            case 40: entity.height = g.float; break;
            case 50: entity.rotation = g.float; break;
            case 41:
                if (type === EntityType.MTEXT) entity.width = g.float;
                else entity.widthFactor = g.float;
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
                    direction.x = g.float;
                } else {
                    if (!secondPos) secondPos = { x: 0, y: 0 };
                    secondPos.x = g.float;
                }
                break;
            case 21:
                if (type === EntityType.MTEXT) {
                    if (!direction) direction = { x: 0, y: 0 };
                    direction.y = g.float;
                } else {
                    if (!secondPos) secondPos = { x: 0, y: 0 };
                    secondPos.y = g.float;
                }
                break;
            case 31: z2 = g.float; break;
            case 71:
                if (type === EntityType.MTEXT) entity.attachmentPoint = parseInt(g.value, 10);
                else entity.textGenerationFlags = parseInt(g.value, 10);
                break;
            case 42: if (type === EntityType.MTEXT) entity.actualWidth = g.float; break;
            case 43: entity.boxHeight = g.float; break;
            case 44: if (type === EntityType.MTEXT) entity.lineSpacingFactor = g.float; break;
            case 2: if (type === EntityType.ATTDEF || type === EntityType.ATTRIB) entity.tag = g.value; break;
            case 70: if (type === EntityType.ATTDEF) entity.flags = parseInt(g.value, 10); break;
            case 63: if (type === EntityType.MTEXT) entity.bgColor = (g.float | 0); break;
            case 90:
                if (type === EntityType.MTEXT) {
                    const mask = (g.float | 0);
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
        const tooFar = (p: Point2D) => !isFinite(p.x) || !isFinite(p.y)
            || Math.abs(p.x) > PARSER_LIMITS.maximumCoordinateMagnitude
            || Math.abs(p.y) > PARSER_LIMITS.maximumCoordinateMagnitude;
        if (
            tooFar(entity.position)
            || (entity.secondPosition && tooFar(entity.secondPosition))
            || (isFinite(entity.height) && Math.abs(entity.height) > PARSER_LIMITS.maximumAttribTextHeight)
        ) {
            entity.visible = false;
        }
    }

    if (ocs) {
        const det2D = ocs.Ax.x * ocs.Ay.y - ocs.Ax.y * ocs.Ay.x;
        if (det2D < 0) entity.widthFactor = -(entity.widthFactor || 1);
    }

    return entity;
};
