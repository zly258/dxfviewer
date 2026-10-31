/**
 * LEADER 引线写出器。
 *
 * 与解析器（annotationEntityParser.parseLeader）捕获的组码对称：
 * 71 箭头标记、72 路径类型、75 钩线标记、10/20/30 顶点。
 *
 * 不写 340（注释句柄）：写出器一律重新分配句柄，直接回写源句柄会产生
 * 悬空引用；注释文字本身作为独立 MTEXT 实体写出，几何不受影响。
 * preserveRaw 保真模式下 340 随 raw 快照原样回放。
 */
import { DxfLeader } from '@/types';
import { WriterState } from '../writerState';
import { writeEntityCommon } from '../groupWriter';
import { applyOffsetToPoint } from '../offsets';

export const writeLeader = (state: WriterState, ent: DxfLeader, ownerHandle: string): void => {
  writeEntityCommon(state, 'LEADER', 'AcDbLeader', ent, ownerHandle);
  state.writeGroup(71, ent.arrowHeadFlag ?? 1);
  state.writeGroup(72, ent.pathType ?? 0);
  if (ent.hasHookLine) {
    state.writeGroup(75, 1);
  }
  for (const point of ent.points) {
    const p = applyOffsetToPoint(point, state.offset);
    state.writeGroup(10, p.x);
    state.writeGroup(20, p.y);
    state.writeGroup(30, 0);
  }
};
