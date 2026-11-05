/**
 * BLOCKS 段写出器。
 *
 * AC1015 结构：BLOCK（含 330 指向 BLOCK_RECORD、AcDbBlockBegin 子类）→ 子实体 → ENDBLK。
 * AC1009 (R12)：无句柄、无子类标记，实体归属由所在块隐式确定。
 *
 * 约定：*Model_Space 块写出为空块（模型空间实体统一放在 ENTITIES 段），
 * *Paper_Space 块承载该布局的图纸空间实体——这是 AutoCAD 的标准组织方式。
 */
import { AnyEntity, Point2D } from '@/types';
import { WriterState } from './writerState';
import type { WriterContext } from './dxfWriter';
import { writeEntitiesList } from './entitiesWriter';
import { isAnonymousBlock } from './tablesWriter';
import { applyOffsetToPoint } from './offsets';

export interface BlockContent {
  name: string;
  basePoint: Point2D;
  entities: AnyEntity[];
}

const writeBlockBegin = (
  state: WriterState,
  ctx: WriterContext,
  block: BlockContent,
): void => {
  const recordHandle = ctx.blockRecordHandles.get(block.name) ?? '';

  state.writeGroup(0, 'BLOCK');
  state.writeHandle(ctx.blockObjectHandles.get(block.name));
  state.writeOwner(recordHandle);
  state.writeSubclass('AcDbEntity');
  state.writeGroup(8, '0');
  state.writeSubclass('AcDbBlockBegin');
  state.writeGroup(2, block.name);
  state.writeGroup(70, isAnonymousBlock(block.name) ? 1 : 0);

  const base = applyOffsetToPoint(block.basePoint, state.offset);
  state.writeGroup(10, base.x);
  state.writeGroup(20, base.y);
  state.writeGroup(30, 0);
  // 3 / 1：块名与外部参照路径，非参照块两者同块名 / 空串
  state.writeGroup(3, block.name);
  state.writeGroup(1, '');
};

const writeBlockEnd = (
  state: WriterState,
  ctx: WriterContext,
  block: BlockContent,
): void => {
  const recordHandle = ctx.blockRecordHandles.get(block.name) ?? '';

  state.writeGroup(0, 'ENDBLK');
  state.writeHandle(ctx.endBlkHandles.get(block.name));
  state.writeOwner(recordHandle);
  state.writeSubclass('AcDbEntity');
  state.writeGroup(8, '0');
  state.writeSubclass('AcDbBlockEnd');
};

/**
 * 写出 BLOCKS 段。
 *
 * @param blocks 需写出的块列表（顺序：*Model_Space、用户/匿名块、*Paper_Space 系列）
 */
export const writeBlocksSection = (
  state: WriterState,
  ctx: WriterContext,
  blocks: BlockContent[],
): void => {
  state.writeGroup(0, 'SECTION');
  state.writeGroup(2, 'BLOCKS');

  for (const block of blocks) {
    const recordHandle = ctx.blockRecordHandles.get(block.name) ?? '';
    // 图纸空间块内的实体带上 410 布局名，解析端据此归位（比按块名后缀索引推断可靠）
    state.currentLayoutName = resolveLayoutName(ctx, block.name);
    writeBlockBegin(state, ctx, block);

    // R12 无句柄体系，实体归属由块本身决定；AC1015 用块记录句柄作为 owner。
    const ownerHandle = state.isR12() ? '' : recordHandle;
    writeEntitiesList(state, block.entities, ownerHandle);

    writeBlockEnd(state, ctx, block);
  }

  state.currentLayoutName = null;

  state.writeGroup(0, 'ENDSEC');
};

/** 反查纸张空间块对应的布局名；非纸张空间块返回 null。 */
const resolveLayoutName = (ctx: WriterContext, blockName: string): string | null => {
  for (const [layoutName, name] of ctx.paperBlockNames) {
    if (name === blockName) return layoutName;
  }
  return null;
};
