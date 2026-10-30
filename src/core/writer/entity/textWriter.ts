/**
 * 文字图元写出器（TEXT / MTEXT）。
 *
 * 覆盖：TEXT, MTEXT, ATTRIB, ATTDEF。
 * 支持多行文字长串分块（group 3 + group 1）、对齐点与 R12 降级。
 */
import { DxfText, EntityType } from '@/types';
import { WriterState } from '../writerState';
import { writeEntityCommon } from '../groupWriter';
import { applyOffsetToPoint } from '../offsets';

const MTEXT_CHUNK_SIZE = 250;

/**
 * TEXT 单行文字
 */
export const writeText = (
  state: WriterState,
  ent: DxfText,
  ownerHandle: string,
  entityTypeName: 'TEXT' | 'ATTRIB' | 'ATTDEF' = 'TEXT',
): void => {
  const subclass = entityTypeName === 'ATTRIB'
    ? 'AcDbAttribute'
    : entityTypeName === 'ATTDEF'
      ? 'AcDbAttributeDefinition'
      : 'AcDbText';

  writeEntityCommon(state, entityTypeName, subclass, ent, ownerHandle);

  const pos = applyOffsetToPoint(ent.position, state.offset);
  state.writeGroup(10, pos.x);
  state.writeGroup(20, pos.y);
  state.writeGroup(30, 0);

  state.writeGroup(40, ent.height || 2.5);
  state.writeGroup(1, ent.value || '');

  if (ent.rotation !== undefined && ent.rotation !== 0) {
    state.writeGroup(50, ent.rotation);
  }
  if (ent.widthFactor !== undefined && ent.widthFactor > 0 && ent.widthFactor !== 1) {
    state.writeGroup(41, ent.widthFactor);
  }
  if (ent.styleName) {
    state.writeGroup(7, ent.styleName);
  }
  if (ent.textGenerationFlags) {
    state.writeGroup(71, ent.textGenerationFlags);
  }
  if (ent.hAlign) {
    state.writeGroup(72, ent.hAlign);
  }

  // ATTRIB / ATTDEF 标签名
  if (ent.tag && (entityTypeName === 'ATTRIB' || entityTypeName === 'ATTDEF')) {
    state.writeGroup(2, ent.tag);
  }
  if (ent.flags !== undefined && entityTypeName === 'ATTDEF') {
    state.writeGroup(70, ent.flags);
  }

  if (ent.secondPosition) {
    const p2 = applyOffsetToPoint(ent.secondPosition, state.offset);
    state.writeGroup(11, p2.x);
    state.writeGroup(21, p2.y);
    state.writeGroup(31, 0);
  }

  if (ent.vAlign && !state.isR12()) {
    state.writeSubclass('AcDbText');
    state.writeGroup(73, ent.vAlign);
  } else if (ent.vAlign && state.isR12()) {
    state.writeGroup(73, ent.vAlign);
  }
};

/**
 * MTEXT 多行文字（R12 模式下自动降级为单行 TEXT）
 */
export const writeMText = (state: WriterState, ent: DxfText, ownerHandle: string): void => {
  if (state.isR12()) {
    state.addSkipped('MTEXT', 'R12 (AC1009) 不支持 MTEXT 实体，已降级为单行 TEXT', ent.id);
    const flattened = (ent.value || '').replace(/\\P/gi, ' ');
    writeText(state, { ...ent, type: EntityType.TEXT, value: flattened }, ownerHandle, 'TEXT');
    return;
  }

  writeEntityCommon(state, 'MTEXT', 'AcDbMText', ent, ownerHandle);

  const pos = applyOffsetToPoint(ent.position, state.offset);
  state.writeGroup(10, pos.x);
  state.writeGroup(20, pos.y);
  state.writeGroup(30, 0);

  state.writeGroup(40, ent.height || 2.5);
  state.writeGroup(41, ent.width || 0);
  state.writeGroup(71, ent.attachmentPoint ?? 1);
  state.writeGroup(72, ent.drawingDirection ?? 1);

  // 长文本拆分：group 3 承载前导 250 字符分块，group 1 承载末尾分块
  const text = ent.value || '';
  let cursor = 0;
  while (text.length - cursor > MTEXT_CHUNK_SIZE) {
    state.writeGroup(3, text.slice(cursor, cursor + MTEXT_CHUNK_SIZE));
    cursor += MTEXT_CHUNK_SIZE;
  }
  state.writeGroup(1, text.slice(cursor));

  if (ent.styleName) {
    state.writeGroup(7, ent.styleName);
  }
  if (ent.rotation !== undefined && ent.rotation !== 0) {
    state.writeGroup(50, ent.rotation);
  }
  if (ent.lineSpacingStyle !== undefined) {
    state.writeGroup(73, ent.lineSpacingStyle);
  }
  if ((ent as any).lineSpacingFactor !== undefined) {
    state.writeGroup(44, (ent as any).lineSpacingFactor);
  }
  if (ent.bgFill) {
    state.writeGroup(90, 1);
  }
};
