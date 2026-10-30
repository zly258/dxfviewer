/**
 * 标注图元写出器（DIMENSION）。
 */
import { DxfDimension } from '@/types';
import { WriterState } from '../writerState';
import { writeEntityCommon } from '../groupWriter';
import { applyOffsetToPoint } from '../offsets';

export const writeDimension = (state: WriterState, ent: DxfDimension, ownerHandle: string): void => {
  // DIMENSION 自身只携带定义点，可见几何全在匿名 *D 块里；
  // 无块引用时 CAD 打开后看不到任何东西，宁可跳过并明确报告。
  if (!ent.blockName) {
    state.addSkipped('DIMENSION', '无关联几何块（组码 2），无法重建可见标注几何', ent.id);
    return;
  }

  writeEntityCommon(state, 'DIMENSION', 'AcDbDimension', ent, ownerHandle);
  state.writeGroup(2, ent.blockName);

  const defPt = applyOffsetToPoint(ent.definitionPoint, state.offset);
  state.writeGroup(10, defPt.x);
  state.writeGroup(20, defPt.y);
  state.writeGroup(30, 0);

  const textPt = applyOffsetToPoint(ent.textMidPoint, state.offset);
  state.writeGroup(11, textPt.x);
  state.writeGroup(21, textPt.y);
  state.writeGroup(31, 0);

  state.writeGroup(70, ent.dimType ?? 0);

  if (ent.text) {
    state.writeGroup(1, ent.text);
  }
  if (ent.styleName) {
    state.writeGroup(3, ent.styleName);
  }
  if (ent.measurement !== undefined) {
    state.writeGroup(42, ent.measurement);
  }

  if (ent.linearP1 && ent.linearP2) {
    state.writeSubclass('AcDbAlignedDimension');
    const p1 = applyOffsetToPoint(ent.linearP1, state.offset);
    const p2 = applyOffsetToPoint(ent.linearP2, state.offset);
    state.writeGroup(13, p1.x);
    state.writeGroup(23, p1.y);
    state.writeGroup(33, 0);
    state.writeGroup(14, p2.x);
    state.writeGroup(24, p2.y);
    state.writeGroup(34, 0);
  } else if (ent.arcP1 && ent.arcP2) {
    state.writeSubclass('AcDb2LineAngularDimension');
    const p1 = applyOffsetToPoint(ent.arcP1, state.offset);
    const p2 = applyOffsetToPoint(ent.arcP2, state.offset);
    state.writeGroup(15, p1.x);
    state.writeGroup(25, p1.y);
    state.writeGroup(35, 0);
    state.writeGroup(16, p2.x);
    state.writeGroup(26, p2.y);
    state.writeGroup(36, 0);
  }
};
