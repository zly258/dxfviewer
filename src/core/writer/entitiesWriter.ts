/**
 * 实体写出分发器。
 */
import { AnyEntity, EntityType, RawGroupPair } from '@/types';
import { WriterState } from './writerState';
import {
  writeArc,
  writeCircle,
  writeEllipse,
  writeLine,
  writeLwPolyline,
  writePoint,
  writePolylineLegacy,
  writeRayXLine,
  writeShape,
  writeSpline,
} from './entity/basicWriter';
import { writeMText, writeText } from './entity/textWriter';
import { write3DFace, writeHatch, writeSolid } from './entity/fillWriter';
import { writeInsert } from './entity/blockWriter';
import { writeDimension } from './entity/dimensionWriter';
import { writeLeader } from './entity/leaderWriter';

/**
 * 保真回放：实体带 raw 组码快照时原样输出。
 *
 * - 组码 0（类型行）与源文件一致；
 * - 句柄（5）重新分配、归属（330）重写为当前 owner——保证句柄唯一与结构正确；
 * - 坐标类组码不做逆平移：raw 快照记录的是解析前源文件文本，坐标本就是绝对值
 *   （解析器的 offset 平移只作用于建模字段，raw 回放天然绕开）；
 * - 其余组码（100 子类、102 扩展、1000+ XDATA 等）逐行原样回放。
 *
 * R12 模式下 raw 含句柄体系组码，直接跳过回放走重建路径（降级语义优先）。
 */
const replayRawEntity = (
  state: WriterState,
  raw: readonly RawGroupPair[],
  ownerHandle: string,
): void => {
  for (let i = 0; i < raw.length; i++) {
    const { code, value } = raw[i];
    if (code === 5) {
      state.writeGroup(5, state.allocHandle());
      continue;
    }
    if (code === 330) {
      if (ownerHandle) state.writeGroup(330, ownerHandle);
      continue;
    }
    if (code === 102) {
      // {ACAD_REACTORS}/{ACAD_XDICTIONARY} 块：整体原样回放（直到 }）
      state.writeGroup(102, value);
      i++;
      while (i < raw.length) {
        const inner = raw[i];
        state.writeGroup(inner.code, inner.value);
        if (inner.code === 102 && inner.value === '}') break;
        i++;
      }
      continue;
    }
    state.writeGroup(code, value);
  }
};

export const writeEntity = (state: WriterState, ent: AnyEntity, ownerHandle: string): void => {
  if (state.preserveRaw && !state.isR12() && ent.raw && ent.raw.length > 0) {
    replayRawEntity(state, ent.raw, ownerHandle);
    return;
  }

  switch (ent.type) {
    case EntityType.LINE:
      writeLine(state, ent, ownerHandle);
      break;
    case EntityType.POINT:
      writePoint(state, ent, ownerHandle);
      break;
    case EntityType.CIRCLE:
      writeCircle(state, ent, ownerHandle);
      break;
    case EntityType.ARC:
      writeArc(state, ent, ownerHandle);
      break;
    case EntityType.LWPOLYLINE:
      writeLwPolyline(state, ent, ownerHandle);
      break;
    case EntityType.POLYLINE:
      writePolylineLegacy(state, ent, ownerHandle);
      break;
    case EntityType.ELLIPSE:
      writeEllipse(state, ent, ownerHandle);
      break;
    case EntityType.SPLINE:
      writeSpline(state, ent, ownerHandle);
      break;
    case EntityType.TEXT:
    case EntityType.ATTRIB:
    case EntityType.ATTDEF:
      writeText(state, ent, ownerHandle, ent.type as any);
      break;
    case EntityType.MTEXT:
      writeMText(state, ent, ownerHandle);
      break;
    case EntityType.SOLID:
      writeSolid(state, ent, ownerHandle);
      break;
    case EntityType.THREEDFACE:
      write3DFace(state, ent, ownerHandle);
      break;
    case EntityType.HATCH:
      writeHatch(state, ent, ownerHandle);
      break;
    case EntityType.INSERT:
      writeInsert(state, ent, ownerHandle);
      break;
    case EntityType.DIMENSION:
      writeDimension(state, ent, ownerHandle);
      break;
    case EntityType.RAY:
    case EntityType.XLINE:
      writeRayXLine(state, ent, ownerHandle);
      break;
    case EntityType.LEADER:
      writeLeader(state, ent, ownerHandle);
      break;
    case EntityType.SHAPE:
      writeShape(state, ent, ownerHandle);
      break;
    default:
      state.addSkipped((ent as any).type || 'UNKNOWN', '写出器暂未覆盖该实体类型', ent.id);
      break;
  }
};

/**
 * 批量写出实体列表。
 */
export const writeEntitiesList = (
  state: WriterState,
  entities: AnyEntity[],
  ownerHandle: string,
): void => {
  for (const ent of entities) {
    writeEntity(state, ent, ownerHandle);
  }
};
