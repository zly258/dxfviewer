/**
 * DXF 写出主流程。
 *
 * 两遍式：
 * 1. 分配遍：为表、表记录、块记录、布局对象、块定义预先分配句柄，建立交叉引用映射
 *    （BLOCK_RECORD ↔ LAYOUT ↔ BLOCK 之间互相引用，必须先知道对方句柄）。
 * 2. 写出遍：HEADER → TABLES → BLOCKS → ENTITIES → OBJECTS → EOF。
 *
 * HEADER 需要 $HANDSEED（本次写出的句柄总数上界），只能在分配遍结束后才知道，
 * 因此 HEADER 最后写入独立缓冲，再拼接到正文之前。
 */
import { AnyEntity, DxfData, DxfLayout, Point2D } from '@/types';
import {
  DxfVersion,
  SkippedEntity,
  WriteDxfOptions,
  WriterState,
} from './writerState';
import { writeHeaderSection } from './headerWriter';
import { writeTablesSection } from './tablesWriter';
import { BlockContent, writeBlocksSection } from './blocksWriter';
import { writeEntitiesList } from './entitiesWriter';
import { writeObjectsSection } from './objectsWriter';

const MODEL_BLOCK_NAME = '*Model_Space';
const PAPER_BLOCK_NAME = '*Paper_Space';

export interface TableHandles {
  vport: string;
  ltype: string;
  layer: string;
  style: string;
  dimstyle: string;
  appid: string;
  blockRecord: string;
}

export interface WriterContext {
  tableHandles: TableHandles;
  vportActiveHandle: string;
  ltypeHandles: Map<string, string>;
  layerHandles: Map<string, string>;
  styleHandles: Map<string, string>;
  dimStyleStandardHandle: string;
  appIdAcadHandle: string;
  /** 块名 → BLOCK_RECORD 句柄（顺序即写出顺序） */
  blockRecordHandles: Map<string, string>;
  /** 块名 → LAYOUT 句柄（仅模型/图纸空间块） */
  blockLayoutHandles: Map<string, string>;
  /** 块名 → BLOCK 对象句柄 */
  blockObjectHandles: Map<string, string>;
  /** 块名 → ENDBLK 对象句柄 */
  endBlkHandles: Map<string, string>;
  rootDictHandle: string;
  groupDictHandle: string;
  layoutDictHandle: string;
  /** 布局名 → LAYOUT 对象句柄 */
  layoutObjectHandles: Map<string, string>;
  /** 布局名 → 纸张空间块名 */
  paperBlockNames: Map<string, string>;
}

export interface WriteDxfResult {
  content: string;
  skipped: SkippedEntity[];
  version: DxfVersion;
}

const BUILTIN_LTYPE_NAMES = ['ByBlock', 'ByLayer', 'CONTINUOUS'];

const isModelSpaceBlock = (name: string): boolean => name.toUpperCase() === '*MODEL_SPACE';
const isPaperSpaceBlock = (name: string): boolean => name.toUpperCase().startsWith('*PAPER_SPACE');

/**
 * 解析纸张空间块的命名（AutoCAD 约定：*Paper_Space、*Paper_Space1、*Paper_Space2…）。
 */
const resolvePaperBlockNames = (
  paperLayouts: DxfLayout[],
): Map<string, string> => {
  const mapping = new Map<string, string>();
  let paperIndex = 0;

  for (const layout of paperLayouts) {
    const name = paperIndex === 0 ? PAPER_BLOCK_NAME : `${PAPER_BLOCK_NAME}${paperIndex}`;
    paperIndex++;
    mapping.set(layout.name, name);
  }
  return mapping;
};

/**
 * 第一遍：分配句柄与登记引用关系。
 */
const allocateHandles = (state: WriterState, data: DxfData): WriterContext => {
  const ctx: WriterContext = {
    tableHandles: {
      vport: state.allocHandle(),
      ltype: state.allocHandle(),
      layer: state.allocHandle(),
      style: state.allocHandle(),
      dimstyle: state.allocHandle(),
      appid: state.allocHandle(),
      blockRecord: state.allocHandle(),
    },
    vportActiveHandle: state.allocHandle(),
    ltypeHandles: new Map(),
    layerHandles: new Map(),
    styleHandles: new Map(),
    dimStyleStandardHandle: state.allocHandle(),
    appIdAcadHandle: state.allocHandle(),
    blockRecordHandles: new Map(),
    blockLayoutHandles: new Map(),
    blockObjectHandles: new Map(),
    endBlkHandles: new Map(),
    rootDictHandle: state.allocHandle(),
    groupDictHandle: state.allocHandle(),
    layoutDictHandle: state.allocHandle(),
    layoutObjectHandles: new Map(),
    paperBlockNames: new Map(),
  };

  // 线型记录
  const ltypeNames = [
    ...BUILTIN_LTYPE_NAMES,
    ...Object.keys(data.lineTypes || {}).filter(name => !BUILTIN_LTYPE_NAMES.includes(name)),
  ];
  ltypeNames.forEach(name => ctx.ltypeHandles.set(name, state.allocHandle()));

  // 图层记录
  const layerNames = Object.keys(data.layers || {});
  if (!layerNames.includes('0')) layerNames.unshift('0');
  layerNames.forEach(name => ctx.layerHandles.set(name, state.allocHandle()));

  // 文字样式记录
  const styleNames = Object.keys(data.styles || {});
  if (!styleNames.some(name => name.toUpperCase() === 'STANDARD')) styleNames.unshift('STANDARD');
  styleNames.forEach(name => ctx.styleHandles.set(name, state.allocHandle()));

  // 布局与纸张空间块命名
  const layouts = data.layouts ?? [];
  const paperLayouts = layouts.filter(layout => !layout.isModel);
  ctx.paperBlockNames = resolvePaperBlockNames(paperLayouts);

  // 块记录：模型空间 → 用户/匿名块 → 纸张空间
  const userBlockNames = Object.keys(data.blocks || {}).filter(
    name => !isModelSpaceBlock(name) && !isPaperSpaceBlock(name),
  );

  const blockRecordOrder = [MODEL_BLOCK_NAME, ...userBlockNames, ...ctx.paperBlockNames.values()];
  for (const name of blockRecordOrder) {
    ctx.blockRecordHandles.set(name, state.allocHandle());
  }

  // 布局对象（AC1015）
  for (const layout of layouts) {
    const handle = state.allocHandle();
    ctx.layoutObjectHandles.set(layout.name, handle);
  }

  // BLOCK_RECORD ↔ LAYOUT 双向引用
  for (const layout of layouts) {
    const layoutHandle = ctx.layoutObjectHandles.get(layout.name);
    if (!layoutHandle) continue;
    const blockName = layout.isModel ? MODEL_BLOCK_NAME : ctx.paperBlockNames.get(layout.name);
    if (blockName) ctx.blockLayoutHandles.set(blockName, layoutHandle);
  }

  // 块定义与结束块句柄
  for (const name of blockRecordOrder) {
    ctx.blockObjectHandles.set(name, state.allocHandle());
    ctx.endBlkHandles.set(name, state.allocHandle());
  }

  return ctx;
};

/**
 * 收集要写入 BLOCKS 段的块内容。
 */
const buildBlockContents = (
  data: DxfData,
  ctx: WriterContext,
  paperLayouts: DxfLayout[],
): BlockContent[] => {
  const blocks: BlockContent[] = [];

  // 1. 模型空间块：实体统一写进 ENTITIES 段，块本身留空。
  blocks.push({ name: MODEL_BLOCK_NAME, basePoint: { x: 0, y: 0 }, entities: [] });

  // 2. 用户块与匿名块（含标注匿名块 *D*）
  for (const [name, block] of Object.entries(data.blocks || {})) {
    if (isModelSpaceBlock(name) || isPaperSpaceBlock(name)) continue;
    blocks.push({
      name,
      basePoint: block.basePoint || { x: 0, y: 0 },
      entities: block.entities || [],
    });
  }

  // 3. 纸张空间块：承载各布局的图纸空间实体
  for (const layout of paperLayouts) {
    const blockName = ctx.paperBlockNames.get(layout.name);
    if (!blockName) continue;

    const entities: AnyEntity[] = [...(layout.entities || [])];
    // 源文件若把图纸空间实体放在块里（非标准），一并带上避免丢内容
    for (const [sourceName, block] of Object.entries(data.blocks || {})) {
      if (sourceName.toUpperCase() !== blockName.toUpperCase()) continue;
      if (block.entities?.length) entities.push(...block.entities);
    }

    blocks.push({ name: blockName, basePoint: { x: 0, y: 0 }, entities });
  }

  return blocks;
};

/**
 * 写出 ENTITIES 段（模型空间实体）。
 */
const writeEntitiesSection = (
  state: WriterState,
  entities: AnyEntity[],
  ownerHandle: string,
): void => {
  state.writeGroup(0, 'SECTION');
  state.writeGroup(2, 'ENTITIES');
  state.currentLayoutName = 'Model';
  writeEntitiesList(state, entities, ownerHandle);
  state.currentLayoutName = null;
  state.writeGroup(0, 'ENDSEC');
};

/**
 * 将 DxfData 写回 DXF 文本（重建式写出）。
 */
export const writeDxf = (data: DxfData, options: WriteDxfOptions = {}): WriteDxfResult => {
  const state = new WriterState(options, data.offset);
  const ctx = allocateHandles(state, data);

  const layouts = data.layouts ?? [];
  const paperLayouts = layouts.filter(layout => !layout.isModel);

  // 模型空间实体：优先用 data.entities（模型布局实体），退回 allEntities
  const modelEntities: AnyEntity[] = data.entities?.length
    ? data.entities
    : (data.allEntities ?? []).filter(entity => !entity.inPaperSpace);

  // 若源文件把模型空间实体放在 *Model_Space 块内，一并写出
  for (const [name, block] of Object.entries(data.blocks || {})) {
    if (!isModelSpaceBlock(name)) continue;
    if (block.entities?.length) modelEntities.push(...block.entities);
  }

  writeTablesSection(state, data, ctx);

  const blocks = buildBlockContents(data, ctx, state.isR12() ? [] : paperLayouts);
  writeBlocksSection(state, ctx, blocks);

  writeEntitiesSection(state, modelEntities, ctx.blockRecordHandles.get(MODEL_BLOCK_NAME) ?? '');

  writeObjectsSection(state, ctx, data);

  if (state.isR12() && paperLayouts.length > 0) {
    state.addSkipped(
      'LAYOUT',
      `R12 (AC1009) 无布局概念，已跳过 ${paperLayouts.length} 个图纸空间布局`,
    );
  }

  // HEADER 最后写：$HANDSEED 依赖分配遍的最终计数
  const headerState = new WriterState(options, data.offset);
  writeHeaderSection(headerState, data, state.getHandseed());

  const content = `${headerState.toString()}${state.toString()}${'  0\nEOF\n'}`;

  return {
    content,
    skipped: state.skipped,
    version: state.version,
  };
};

/**
 * 写出为 Blob（浏览器下载用）。
 */
export const writeDxfBlob = (data: DxfData, options: WriteDxfOptions = {}): Blob => {
  const result = writeDxf(data, options);
  return new Blob([result.content], { type: 'application/dxf' });
};

/** 便捷类型：实体平移量。 */
export type { Point2D as WriterPoint };
