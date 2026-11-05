/**
 * OBJECTS 段写出器。
 *
 * 最小可用集合：根词典 + ACAD_GROUP 词典 + ACAD_LAYOUT 词典 + 每个布局一个 LAYOUT 对象。
 * LAYOUT 通过 331 指向 BLOCK_RECORD，BLOCK_RECORD 通过 340 指回 LAYOUT——
 * 这条双向链是 AutoCAD 显示「模型/布局」标签页的依据。
 *
 * R12 无 OBJECTS 段与布局概念，直接跳过。
 */
import { DxfData, DxfLayout } from '@/types';
import { WriterState } from './writerState';
import type { WriterContext } from './dxfWriter';
import { applyOffsetToX, applyOffsetToY } from './offsets';

const writeRootDictionary = (state: WriterState, ctx: WriterContext): void => {
  state.writeGroup(0, 'DICTIONARY');
  state.writeHandle(ctx.rootDictHandle);
  state.writeGroup(330, '0');
  state.writeSubclass('AcDbDictionary');
  state.writeGroup(281, 1);
  state.writeGroup(3, 'ACAD_GROUP');
  state.writeGroup(350, ctx.groupDictHandle);
  state.writeGroup(3, 'ACAD_LAYOUT');
  state.writeGroup(350, ctx.layoutDictHandle);
};

const writeLayoutDictionaryHeader = (
  state: WriterState,
  handle: string,
  ctx: WriterContext,
  entries: Array<[string, string]>,
): void => {
  state.writeGroup(0, 'DICTIONARY');
  state.writeHandle(handle);
  state.writeOwner(ctx.rootDictHandle);
  state.writeSubclass('AcDbDictionary');
  state.writeGroup(281, 1);
  for (const [name, entryHandle] of entries) {
    state.writeGroup(3, name);
    state.writeGroup(350, entryHandle);
  }
};

const writeLayoutObject = (
  state: WriterState,
  ctx: WriterContext,
  data: DxfData,
  layout: DxfLayout,
  handle: string,
): void => {
  const paperMin = layout.paperMin;
  const paperMax = layout.paperMax;
  const extents = layout.extents ?? data.extents;

  const minX = paperMin ? applyOffsetToX(paperMin.x, state.offset) : (extents ? applyOffsetToX(extents.min.x, state.offset) : 0);
  const minY = paperMin ? applyOffsetToY(paperMin.y, state.offset) : (extents ? applyOffsetToY(extents.min.y, state.offset) : 0);
  const maxX = paperMax ? applyOffsetToX(paperMax.x, state.offset) : (extents ? applyOffsetToX(extents.max.x, state.offset) : 420);
  const maxY = paperMax ? applyOffsetToY(paperMax.y, state.offset) : (extents ? applyOffsetToY(extents.max.y, state.offset) : 297);

  state.writeGroup(0, 'LAYOUT');
  state.writeHandle(handle);
  state.writeOwner(ctx.layoutDictHandle);

  // AcDbPlotSettings：全部取默认值（不写组码即为默认）
  state.writeSubclass('AcDbPlotSettings');

  state.writeSubclass('AcDbLayout');
  state.writeGroup(1, layout.name);
  state.writeGroup(70, layout.isModel ? 1 : 0);
  state.writeGroup(71, layout.tabOrder ?? (layout.isModel ? 0 : 1));
  state.writeGroup(10, minX);
  state.writeGroup(20, minY);
  state.writeGroup(11, maxX);
  state.writeGroup(21, maxY);
  state.writeGroup(12, 0);
  state.writeGroup(22, 0);
  state.writeGroup(23, 0);
  state.writeGroup(14, minX);
  state.writeGroup(24, minY);
  state.writeGroup(15, maxX);
  state.writeGroup(25, maxY);
  state.writeGroup(17, minX);
  state.writeGroup(27, minY);
  state.writeGroup(18, maxX);
  state.writeGroup(28, maxY);
  state.writeGroup(32, 1);
  state.writeGroup(331, ctx.blockRecordHandles.get(layoutBlockName(ctx, layout)) ?? '');
};

/** 布局对应的块名（*Model_Space 或 *Paper_Space 系列）。 */
export const layoutBlockName = (ctx: WriterContext, layout: DxfLayout): string => {
  if (layout.isModel) return '*Model_Space';
  const mapped = ctx.paperBlockNames.get(layout.name);
  return mapped ?? '*Paper_Space';
};

export const writeObjectsSection = (
  state: WriterState,
  ctx: WriterContext,
  data: DxfData,
): void => {
  if (state.isR12()) return;

  state.writeGroup(0, 'SECTION');
  state.writeGroup(2, 'OBJECTS');

  writeRootDictionary(state, ctx);

  // ACAD_GROUP：空词典（无人造编组）
  writeLayoutDictionaryHeader(state, ctx.groupDictHandle, ctx, []);

  // ACAD_LAYOUT：每个布局一条 350 引用
  const layoutEntries: Array<[string, string]> = (data.layouts ?? [])
    .map(layout => [layout.name, ctx.layoutObjectHandles.get(layout.name) ?? ''] as [string, string])
    .filter(([, handle]) => Boolean(handle));
  writeLayoutDictionaryHeader(state, ctx.layoutDictHandle, ctx, layoutEntries);

  for (const layout of data.layouts ?? []) {
    const handle = ctx.layoutObjectHandles.get(layout.name);
    if (!handle) continue;
    writeLayoutObject(state, ctx, data, layout, handle);
  }

  state.writeGroup(0, 'ENDSEC');
};
