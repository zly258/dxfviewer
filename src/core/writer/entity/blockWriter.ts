/**
 * 块引用写出器（INSERT + ATTRIB + SEQEND）。
 */
import { DxfInsert } from '@/types';
import { WriterState } from '../writerState';
import { writeEntityCommon } from '../groupWriter';
import { applyOffsetToPoint } from '../offsets';
import { writeText } from './textWriter';

export const writeInsert = (state: WriterState, ent: DxfInsert, ownerHandle: string): void => {
  writeEntityCommon(state, 'INSERT', 'AcDbBlockReference', ent, ownerHandle);

  state.writeGroup(2, ent.blockName || '');

  const pos = applyOffsetToPoint(ent.position, state.offset);
  state.writeGroup(10, pos.x);
  state.writeGroup(20, pos.y);
  state.writeGroup(30, 0);

  const sx = ent.scale?.x ?? 1;
  const sy = ent.scale?.y ?? 1;
  const sz = ent.scale?.z ?? 1;
  if (sx !== 1) state.writeGroup(41, sx);
  if (sy !== 1) state.writeGroup(42, sy);
  if (sz !== 1) state.writeGroup(43, sz);

  if (ent.rotation !== undefined && ent.rotation !== 0) {
    state.writeGroup(50, ent.rotation);
  }

  if (ent.colCount && ent.colCount > 1) state.writeGroup(70, ent.colCount);
  if (ent.rowCount && ent.rowCount > 1) state.writeGroup(71, ent.rowCount);
  if (ent.colSpacing !== undefined && ent.colSpacing !== 0) state.writeGroup(44, ent.colSpacing);
  if (ent.rowSpacing !== undefined && ent.rowSpacing !== 0) state.writeGroup(45, ent.rowSpacing);

  const attributes = ent.attributes || [];
  if (attributes.length > 0) {
    state.writeGroup(66, 1); // 存在后续属性

    for (const attr of attributes) {
      writeText(state, attr, ownerHandle, 'ATTRIB');
    }

    // SEQEND 结束符
    state.writeGroup(0, 'SEQEND');
    state.writeHandle();
    state.writeOwner(ownerHandle);
    state.writeSubclass('AcDbEntity');
    state.writeGroup(8, ent.layer || '0');
  }
};
