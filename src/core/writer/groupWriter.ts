/**
 * 实体公共组码写出器。
 *
 * 统一处理：0 类型、5 句柄、330 归属、100 AcDbEntity、8 图层、6 线型、
 * 62 颜色、420 真彩色、370 线宽、48 线型比例、60 隐藏标记、67 纸张空间标记、410 布局名。
 *
 * 句柄策略：一律重新分配，不复用源文件句柄。源句柄可能与本次分配结果冲突
 * （例如源文件用 1A0，而分配器也走到 1A0），复用会造成句柄重复。
 */
import { DxfEntity } from '@/types';
import { WriterState } from './writerState';

export const writeEntityCommon = (
  state: WriterState,
  type: string,
  subclass: string,
  entity: Partial<DxfEntity>,
  ownerHandle: string,
): void => {
  state.writeGroup(0, type);
  state.writeHandle();
  state.writeOwner(ownerHandle);
  state.writeSubclass('AcDbEntity');

  state.writeGroup(8, entity.layer || '0');

  if (entity.lineType && entity.lineType.toUpperCase() !== 'BYLAYER') {
    state.writeGroup(6, entity.lineType);
  }

  if (entity.lineTypeScale !== undefined && entity.lineTypeScale !== 1) {
    state.writeGroup(48, entity.lineTypeScale);
  }

  if (entity.color !== undefined && entity.color !== null && !Number.isNaN(entity.color)) {
    // 不可见实体按 DXF 惯例写成负颜色
    const color = entity.visible === false ? -Math.abs(entity.color) : entity.color;
    state.writeGroup(62, color);
  }

  if (entity.trueColor !== undefined && !state.isR12()) {
    state.writeGroup(420, entity.trueColor);
  }

  if (entity.lineweight !== undefined && !state.isR12()) {
    state.writeGroup(370, entity.lineweight);
  }

  if (entity.transparency !== undefined && !state.isR12()) {
    state.writeGroup(440, entity.transparency);
  }

  if (entity.visible === false && !state.isR12()) {
    state.writeGroup(60, 1);
  }

  if (entity.inPaperSpace) {
    state.writeGroup(67, 1);
  }

  if (state.currentLayoutName && !state.isR12()) {
    state.writeGroup(410, state.currentLayoutName);
  }

  if (subclass) {
    state.writeSubclass(subclass);
  }
};
