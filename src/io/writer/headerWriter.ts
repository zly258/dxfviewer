/**
 * HEADER 段写出器。
 *
 * $HANDSEED 必须等于本次写出分配的句柄总数上界，而句柄在写出过程中才分配完，
 * 因此由调用方在最后传入（dxfWriter 用独立缓冲回填 HEADER）。
 */
import { DxfData } from '@/types';
import { WriterState } from './writerState';
import { applyOffsetToX, applyOffsetToY } from './offsets';

/**
 * 默认文字样式名：$TEXTSTYLE 必须与 STYLE 表中的某个记录名完全一致，
 * 否则 CAD 会回退到内建默认值（大小写不一致也算不一致）。
 */
const pickStandardStyleName = (data: DxfData): string => {
  const names = Object.keys(data.styles || {});
  const matched = names.find(name => name.toUpperCase() === 'STANDARD');
  return matched ?? names[0] ?? 'Standard';
};

export const writeHeaderSection = (
  state: WriterState,
  data: DxfData,
  handseed: string,
): void => {
  state.writeGroup(0, 'SECTION');
  state.writeGroup(2, 'HEADER');

  state.writeGroup(9, '$ACADVER');
  state.writeGroup(1, state.version);

  if (!state.isR12()) {
    state.writeGroup(9, '$HANDSEED');
    state.writeGroup(5, handseed);
  }

  if (!state.isR12()) {
    state.writeGroup(9, '$INSUNITS');
    state.writeGroup(70, data.header?.insUnits ?? 4); // 4 = mm
  }

  // 计算或重构 EXTMIN / EXTMAX（布局范围已含平移，需加回 offset 还原绝对坐标）
  const ext = data.extents ?? data.layouts?.[0]?.extents;
  const minX = ext
    ? applyOffsetToX(ext.min.x, state.offset)
    : (data.header?.extMin ? applyOffsetToX(data.header.extMin.x, state.offset) : 0);
  const minY = ext
    ? applyOffsetToY(ext.min.y, state.offset)
    : (data.header?.extMin ? applyOffsetToY(data.header.extMin.y, state.offset) : 0);
  const maxX = ext
    ? applyOffsetToX(ext.max.x, state.offset)
    : (data.header?.extMax ? applyOffsetToX(data.header.extMax.x, state.offset) : 100);
  const maxY = ext
    ? applyOffsetToY(ext.max.y, state.offset)
    : (data.header?.extMax ? applyOffsetToY(data.header.extMax.y, state.offset) : 100);

  state.writeGroup(9, '$EXTMIN');
  state.writeGroup(10, minX);
  state.writeGroup(20, minY);
  state.writeGroup(30, 0);

  state.writeGroup(9, '$EXTMAX');
  state.writeGroup(10, maxX);
  state.writeGroup(20, maxY);
  state.writeGroup(30, 0);

  state.writeGroup(9, '$LIMMIN');
  state.writeGroup(10, minX);
  state.writeGroup(20, minY);

  state.writeGroup(9, '$LIMMAX');
  state.writeGroup(10, maxX);
  state.writeGroup(20, maxY);

  state.writeGroup(9, '$LTSCALE');
  state.writeGroup(40, data.header?.ltScale ?? 1.0);

  state.writeGroup(9, '$CELTSCALE');
  state.writeGroup(40, data.header?.celtscale ?? 1.0);

  // 当前图层 / 文字样式 / 标注样式：CAD 打开时若无这些变量会回退到默认，显式写出更稳。
  state.writeGroup(9, '$CLAYER');
  state.writeGroup(8, '0');

  state.writeGroup(9, '$TEXTSTYLE');
  state.writeGroup(7, pickStandardStyleName(data));

  if (!state.isR12()) {
    state.writeGroup(9, '$DIMSTYLE');
    state.writeGroup(7, 'Standard');

    state.writeGroup(9, '$MEASUREMENT');
    state.writeGroup(70, 1); // 1 = 公制 (Metric)
  }

  state.writeGroup(0, 'ENDSEC');
};
