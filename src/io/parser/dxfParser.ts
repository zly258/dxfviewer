import {
  DxfData,
  DxfLayer,
  DxfBlock,
  DxfStyle,
  DxfLineType,
  DxfHeader,
  AnyEntity,
  EntityType,
  DxfLayout,
  DxfImageDef,
  ParseDxfOptions,
} from '@/types';
import { DxfParserState, parsePoint } from './parserState';
import { parseTable, parseBlock, parseLayoutObject, parseImageDefObject } from './sectionParser';
import { parseEntityDispatcher } from './entityParser';
import { createAbortError } from '@/utils/abortError';
import { offsetEntity } from '@/core/geometry/offset';
import { calculateExtents, calculatePaperLayoutExtents, getEntityExtents, precomputeBlockExtents } from '@/core/geometry/extents';
import {
  CAD_DEFAULT_LAYER_COLOR,
  CAD_DEFAULT_LAYER_NAME,
  CAD_DEFAULT_TEXT_STYLE,
} from '@/config/cadConstants';
import { DEFAULT_TEXT_STYLE, EXTENTS_CONFIG } from '@/config/viewerConfig';

const MODEL_LAYOUT_NAME = 'Model';

/**
 * 归一化 INSERT 的 ATTRIB 坐标到世界空间。
 *
 * DXF 规范里 ATTRIB 的插入点是世界坐标，但部分导出器（实测图签块）把它
 * 写成「块局部坐标」——直接渲染会落到数千万单位之外，把图纸范围撑爆，
 * 表现为 fit 后必须放到极大才能看到图形、文字全跑到空白区。
 *
 * 判定：分别求「恒等」与「块变换」两个候选，取更靠近 INSERT 插入点的那个
 * （属性必然依附于其块实例）。数据层统一修正后，渲染 / 范围 / 搜索定位
 * 三处口径一致，不再各自打补丁。
 */
const normalizeInsertAttributes = (
  entities: AnyEntity[],
  blocks: Record<string, DxfBlock>,
): void => {
  const normalizeOne = (ent: AnyEntity): void => {
    if (ent.type !== EntityType.INSERT) return;
    const insert = ent as unknown as {
      blockName?: string;
      position?: { x: number; y: number };
      scale?: { x: number; y: number };
      rotation?: number;
      attributes?: AnyEntity[];
    };
    const attrs = insert.attributes;
    if (!attrs || attrs.length === 0) return;
    const block = insert.blockName ? blocks[insert.blockName] : undefined;
    const base = block?.basePoint;
    if (!base || !insert.position) return;

    const sx = insert.scale?.x ?? 1;
    const sy = insert.scale?.y ?? 1;
    const rotDeg = insert.rotation ?? 0;
    const rot = rotDeg * Math.PI / 180;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const ox = insert.position.x, oy = insert.position.y;

    for (const attr of attrs) {
      const text = attr as unknown as {
        position?: { x: number; y: number };
        height?: number;
        rotation?: number;
        extents?: unknown;
      };
      if (!text.position) continue;
      const dx = (text.position.x - base.x) * sx;
      const dy = (text.position.y - base.y) * sy;
      const moved = { x: ox + dx * cos - dy * sin, y: oy + dx * sin + dy * cos };
      const distRaw = Math.hypot(text.position.x - ox, text.position.y - oy);
      const distMoved = Math.hypot(moved.x - ox, moved.y - oy);
      if (distMoved >= distRaw) continue; // 已是世界坐标：保持恒等

      text.position = moved;
      text.height = (text.height || 0) * Math.max(Math.abs(sx), Math.abs(sy), 1e-9);
      text.rotation = (text.rotation || 0) + rotDeg;
      delete text.extents; // 位置变了，让范围重新计算
    }
  };

  entities.forEach(normalizeOne);
  // 块内嵌套 INSERT 同样处理（块实体在 BLOCKS 段解析）。
  Object.values(blocks).forEach(block => block.entities.forEach(normalizeOne));
};

/**
 * 确保 DXF 文件结构有效，并包含基本的段和实体标记。
 */
export const ensureDxfStructure = (dxfString: string) => {
  const text = dxfString.replace(/^\uFEFF/, '');
  const hasSection = /(?:^|\r?\n)\s*0\s*\r?\n\s*SECTION\s*(?:\r?\n|$)/i.test(text);
  const hasEntities = /(?:^|\r?\n)\s*2\s*\r?\n\s*ENTITIES\s*(?:\r?\n|$)/i.test(text);

  if (!hasSection || !hasEntities) {
    throw new Error('未找到 SECTION 或 ENTITIES 段，可能不是有效 DXF 文件或编码识别错误');
  }
};

/**
 * 检测 DXF 文件是否疑似被截断（未正常写完）。
 *
 * 实测：部分工程图纸在导出/拷贝过程中被截断，文件尾部停在某个实体的
 * 组码中间，既没有 `EOF` 也没有收尾的 `ENDSEC`。这类文件若照常解析，
 * 解析器会「安静地」只得到极少实体（如 1 个），用户在画布上看到的是一张
 * **纯白无内容**的图 —— 完全看不出是文件有问题还是渲染坏了。
 *
 * 这里只做「疑似」判定（缺少 EOF 标记），最终是否拒绝打开由调用方结合
 * 解析结果决定：个别导出器会省略 EOF，只要还能解析出足量实体就不算问题。
 *
 * @returns 疑似截断的原因描述；文件看起来完整时返回 null。
 */
export const detectTruncatedDxf = (dxfString: string): string | null => {
  const text = dxfString.replace(/^\uFEFF/, '').trimEnd();
  if (!text) return '文件内容为空';

  // 完整文件必须以「0 / EOF」组码对结束。
  const hasEof = /(?:^|\r?\n)\s*0\s*\r?\n\s*EOF\s*$/i.test(text);
  if (hasEof) return null;

  // 末尾停在某个实体的类型行上、后面没有任何组码 → 实体被拦腰截断。
  const lastZero = text.lastIndexOf('\n0\n');
  const tail = lastZero >= 0 ? text.slice(lastZero + 3) : '';
  const incompleteTail = /(?:^|\r?\n)\s*[A-Za-z_][A-Za-z0-9_]*\s*$/.test(tail)
    && !/(?:^|\r?\n)\s*\d+\s*(?:\r?\n|$)/.test(tail);

  return incompleteTail
    ? '文件在导出/拷贝过程中被截断（末尾实体不完整，缺少 EOF 标记）'
    : '文件不完整（缺少 EOF 标记，可能已被截断）';
};

/**
 * 判断布局名称是否表示模型空间。
 */
const isModelLayoutName = (name?: string): boolean => {
  if (!name) return true;
  const value = name.trim().toUpperCase();
  return value === MODEL_LAYOUT_NAME.toUpperCase() || value === '*MODEL_SPACE' || value === 'MODEL_SPACE';
};

/**
 * 规范化布局名称，避免模型空间别名导致重复标签。
 */
const normalizeLayoutName = (name?: string, fallbackPaperName = 'Layout1'): string => {
  if (isModelLayoutName(name)) return MODEL_LAYOUT_NAME;
  const trimmed = (name || '').trim();
  return trimmed || fallbackPaperName;
};

/**
 * 创建空布局记录。
 */
const createLayout = (name: string, partial?: Partial<DxfLayout>): DxfLayout => {
  const normalizedName = normalizeLayoutName(name);
  return {
    id: partial?.id || normalizedName,
    name: normalizedName,
    displayName: partial?.displayName || normalizedName,
    isModel: isModelLayoutName(normalizedName),
    entities: [],
    tabOrder: partial?.tabOrder,
    blockName: partial?.blockName,
    blockRecordHandle: partial?.blockRecordHandle,
    paperMin: partial?.paperMin,
    paperMax: partial?.paperMax,
  };
};

/**
 * 根据纸张空间块名称推断布局标签。
 */
const getPaperLayoutByBlockName = (blockName: string, layouts: DxfLayout[]): DxfLayout | undefined => {
  const paperLayouts = layouts
    .filter(layout => !layout.isModel)
    .sort((a, b) => (a.tabOrder ?? Number.MAX_SAFE_INTEGER) - (b.tabOrder ?? Number.MAX_SAFE_INTEGER));

  if (paperLayouts.length === 0) return undefined;
  const upperName = blockName.trim().toUpperCase();
  if (!upperName.startsWith('*PAPER_SPACE')) return undefined;

  const suffix = upperName.replace('*PAPER_SPACE', '');
  const suffixIndex = suffix === '' ? 0 : Number.parseInt(suffix, 10) + 1;
  if (Number.isFinite(suffixIndex) && paperLayouts[suffixIndex]) return paperLayouts[suffixIndex];
  return paperLayouts[0];
};

/**
 * 根据实体通用组码、布局名和块记录归属判断实体所属空间。
 */
const getEntityLayoutName = (
  entity: AnyEntity,
  layouts: DxfLayout[],
  blockHandleMap: Record<string, string>,
): string => {
  if (entity.layoutName) return normalizeLayoutName(entity.layoutName);

  const ownerBlockName = entity.ownerHandle ? blockHandleMap[entity.ownerHandle] : undefined;
  if (ownerBlockName) {
    if (isModelLayoutName(ownerBlockName)) return MODEL_LAYOUT_NAME;
    const paperLayout = getPaperLayoutByBlockName(ownerBlockName, layouts);
    if (paperLayout) return paperLayout.name;
  }

  if (!entity.inPaperSpace) return MODEL_LAYOUT_NAME;
  const firstPaperLayout = layouts.find(layout => !layout.isModel);
  return firstPaperLayout?.name || 'Layout1';
};

/**
 * 将布局元数据和实体集合合并为可切换的空间列表。
 */
const buildLayouts = (
  allEntities: AnyEntity[],
  layoutRecords: DxfLayout[],
  blocks: Record<string, DxfBlock>,
  styles: Record<string, DxfStyle>,
  blockHandleMap: Record<string, string>,
): DxfLayout[] => {
  const layoutMap = new Map<string, DxfLayout>();
  layoutMap.set(MODEL_LAYOUT_NAME, createLayout(MODEL_LAYOUT_NAME, { displayName: 'Model', tabOrder: -1 }));

  layoutRecords.forEach(record => {
    const normalizedName = normalizeLayoutName(record.name);
    const existing = layoutMap.get(normalizedName);
    const next = createLayout(normalizedName, {
      ...record,
      displayName: record.displayName || normalizedName,
    });
    layoutMap.set(normalizedName, { ...(existing || next), ...next, entities: existing?.entities || [] });
  });

  allEntities.forEach(entity => {
    const layoutName = getEntityLayoutName(entity, Array.from(layoutMap.values()), blockHandleMap);
    if (!layoutMap.has(layoutName)) {
      layoutMap.set(layoutName, createLayout(layoutName, { tabOrder: layoutMap.size }));
    }
    const layout = layoutMap.get(layoutName)!;
    entity.layoutName = layout.name;
    layout.entities.push(entity);
  });

  // 图纸空间：R2000 起图纸空间实体存放于 *Paper_Space 块（ENTITIES 段只有模型空间）。
  // 按 LAYOUT 对象的 blockRecordHandle 关联到对应布局；关联不上时按名称顺序兜底，
  // 把未使用的纸张块分配给尚无实体的布局。有"外形"（实体）的布局才会进入切换栏。
  const paperBlocks = Object.values(blocks).filter(b => b.isPaperSpace && b.entities.length > 0);
  const usedPaperBlocks = new Set<string>();
  const attachPaperBlock = (layout: DxfLayout, paperBlock: DxfBlock) => {
    paperBlock.entities.forEach(entity => {
      entity.layoutName = layout.name;
      layout.entities.push(entity);
    });
    usedPaperBlocks.add(paperBlock.name);
  };
  layoutRecords.forEach(record => {
    if (isModelLayoutName(record.name)) return;
    const layout = layoutMap.get(normalizeLayoutName(record.name));
    if (!layout || layout.entities.length > 0) return;
    const blockName = record.blockRecordHandle ? blockHandleMap[record.blockRecordHandle] : undefined;
    const paperBlock = blockName ? blocks[blockName] : undefined;
    if (paperBlock?.isPaperSpace && paperBlock.entities.length > 0 && !usedPaperBlocks.has(paperBlock.name)) {
      attachPaperBlock(layout, paperBlock);
    }
  });
  let fallbackIndex = 0;
  for (const layout of layoutMap.values()) {
    if (fallbackIndex >= paperBlocks.length) break;
    if (layout.isModel || layout.entities.length > 0) continue;
    const paperBlock = paperBlocks[fallbackIndex++];
    if (!usedPaperBlocks.has(paperBlock.name)) attachPaperBlock(layout, paperBlock);
  }

  // 兜底：ENTITIES 段为空时回退 *Model_Space 块（部分导出器把实体只写进块段）。
  const modelLayoutForFallback = layoutMap.get(MODEL_LAYOUT_NAME);
  if (modelLayoutForFallback && modelLayoutForFallback.entities.length === 0) {
    const modelBlock = Object.values(blocks).find(b => b.isModelSpace && b.entities.length > 0);
    if (modelBlock) {
      modelBlock.entities.forEach(entity => {
        entity.layoutName = MODEL_LAYOUT_NAME;
        modelLayoutForFallback.entities.push(entity);
      });
    }
  }

  const layouts = Array.from(layoutMap.values()).map(layout => ({
    ...layout,
    extents: layout.isModel
      ? calculateExtents(layout.entities, blocks, styles)
      : calculatePaperLayoutExtents(layout.entities, blocks, styles),
  }));

  layouts.sort((a, b) => {
    if (a.isModel && !b.isModel) return -1;
    if (!a.isModel && b.isModel) return 1;
    const orderA = a.tabOrder ?? Number.MAX_SAFE_INTEGER;
    const orderB = b.tabOrder ?? Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });

  return layouts;
};

/**
 * 计算用于数值稳定的全局偏移量。优先使用模型空间，避免纸张空间影响模型空间坐标稳定性。
 */
const calculateStableOffset = (
  allEntities: AnyEntity[],
  blocks: Record<string, DxfBlock>,
  styles: Record<string, DxfStyle>,
): { x: number, y: number } => {
  const modelEntities = allEntities.filter(entity => isModelLayoutName(entity.layoutName) && !entity.inPaperSpace);
  const sourceEntities = modelEntities.length > 0 ? modelEntities : allEntities;
  const centersX: number[] = [];
  const centersY: number[] = [];
  const isValid = (value: number) => isFinite(value) && Math.abs(value) < EXTENTS_CONFIG.maxFiniteExtent;

  sourceEntities.forEach(entity => {
    if (entity.visible === false || entity.type === EntityType.ATTDEF || entity.type === EntityType.ATTRIB) return;
    const extents = getEntityExtents(entity, blocks, styles);
    if (!extents) return;
    // 挂到实体上：offsetEntity 会同步平移 ent.extents，
    // buildLayouts 的 calculateExtents 即可复用，省去第二次全量范围计算。
    entity.extents = extents;
    const centerX = (extents.min.x + extents.max.x) / 2;
    const centerY = (extents.min.y + extents.max.y) / 2;
    if (isValid(centerX) && isValid(centerY)) {
      centersX.push(centerX);
      centersY.push(centerY);
    }
  });

  if (centersX.length === 0) {
    const extents = calculateExtents(sourceEntities, blocks, styles);
    return { x: extents.center.x, y: extents.center.y };
  }

  centersX.sort((a, b) => a - b);
  centersY.sort((a, b) => a - b);
  const mid = Math.floor(centersX.length / 2);
  const x = centersX.length % 2 === 0 ? (centersX[mid - 1] + centersX[mid]) / 2 : centersX[mid];
  const y = centersY.length % 2 === 0 ? (centersY[mid - 1] + centersY[mid]) / 2 : centersY[mid];
  return { x, y };
};

/**
 * DXF 文件解析核心主函数。
 */
const getNow = (): number => typeof performance !== 'undefined' ? performance.now() : Date.now();

export const parseDxf = async (
  dxfString: string,
  onProgress?: (percent: number) => void,
  options: ParseDxfOptions = {},
): Promise<DxfData> => {
  ensureDxfStructure(dxfString);
  // 疑似截断检测：文件末尾缺 EOF 时先记下，解析完再结合实体数判断。
  // （个别导出器会省略 EOF，但内容完整 —— 不能因此拒绝打开。）
  const truncatedHint = detectTruncatedDxf(dxfString);
  const state = new DxfParserState(dxfString);
  const allEntities: AnyEntity[] = [];
  const layers: Record<string, DxfLayer> = {};
  const blocks: Record<string, DxfBlock> = {};
  const styles: Record<string, DxfStyle> = {};
  const lineTypes: Record<string, DxfLineType> = {};
  const blockHandleMap: Record<string, string> = {};
  const layoutRecords: DxfLayout[] = [];
  const imageDefs: Record<string, DxfImageDef> = {};
  let header: DxfHeader | undefined;

  layers[CAD_DEFAULT_LAYER_NAME] = { name: CAD_DEFAULT_LAYER_NAME, color: CAD_DEFAULT_LAYER_COLOR, isVisible: true };
  styles[CAD_DEFAULT_TEXT_STYLE] = DEFAULT_TEXT_STYLE;
  lineTypes.CONTINUOUS = { name: 'CONTINUOUS', pattern: [], totalLength: 0 };

  const estimatedTotalLines = dxfString.length / 15;
  const yieldIntervalMs = Math.max(0, options.yieldIntervalMs ?? 16);
  const progressIntervalMs = Math.max(0, options.progressIntervalMs ?? 50);
  let currentSection = '';
  let linesProcessed = 0;
  let lastProgress = -1;
  let lastProgressAt = getNow();
  let lastYieldAt = lastProgressAt;

  while (state.hasNext) {
    if (options.signal?.aborted) throw createAbortError('DXF parsing was cancelled');

    if (state.linesRead > linesProcessed + 500) {
      linesProcessed = state.linesRead;
      const percent = Math.min(99, Math.round((state.linesRead / estimatedTotalLines) * 100));
      const now = getNow();
      if (onProgress && percent !== lastProgress && (percent - lastProgress >= 1 || now - lastProgressAt >= progressIntervalMs)) {
        lastProgress = percent;
        lastProgressAt = now;
        onProgress(percent);
      }
      if (yieldIntervalMs > 0 && now - lastYieldAt >= yieldIntervalMs) {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        lastYieldAt = getNow();
      }
    }

    const group = state.next();
    if (!group) break;

    if (group.code === 0 && group.value === 'SECTION') {
      const next = state.next();
      if (next?.code === 2) currentSection = next.value;
      continue;
    }

    if (group.code === 0 && group.value === 'ENDSEC') {
      currentSection = '';
      continue;
    }

    if (currentSection === 'HEADER') {
      if (!header) header = { extMin: { x: 0, y: 0 }, extMax: { x: 0, y: 0 }, insUnits: 0, ltScale: 1.0, celtscale: 1.0 };
      if (group.code === 9) {
        const value = group.value;
        if (value === '$EXTMIN') header.extMin = parsePoint(state);
        else if (value === '$EXTMAX') header.extMax = parsePoint(state);
        else if (value === '$INSUNITS') {
          const next = state.next();
          if (next && next.code === 70) header.insUnits = parseInt(next.value, 10);
        } else if (value === '$LTSCALE') {
          const next = state.next();
          if (next && next.code === 40) header.ltScale = parseFloat(next.value);
        } else if (value === '$CELTSCALE') {
          const next = state.next();
          if (next && next.code === 40) header.celtscale = parseFloat(next.value);
        }
      }
    } else if (currentSection === 'TABLES') {
      if (group.code === 0 && group.value === 'TABLE') parseTable(state, layers, styles, lineTypes, blockHandleMap);
    } else if (currentSection === 'BLOCKS') {
      if (group.code === 0 && group.value === 'BLOCK') {
        const block = parseBlock(state, blockHandleMap, options.preserveRaw);
        if (block) {
          blocks[block.name] = block;
          if (block.handle) blockHandleMap[block.handle] = block.name;
        }
      }
    } else if (currentSection === 'ENTITIES') {
      if (group.code === 0) {
        if (group.value === 'SEQEND') continue;
        const entity = parseEntityDispatcher(group.value, state, blockHandleMap, options.preserveRaw);
        if (entity) allEntities.push(entity);
      }
    } else if (currentSection === 'OBJECTS') {
      if (group.code === 0 && group.value === 'LAYOUT') {
        const layout = parseLayoutObject(state);
        if (layout) layoutRecords.push(layout);
      } else if (group.code === 0 && group.value === 'IMAGEDEF') {
        const imageDef = parseImageDefObject(state);
        if (imageDef) imageDefs[imageDef.handle] = imageDef;
      }
    }
  }

  if (options.signal?.aborted) throw createAbortError('DXF parsing was cancelled');
  if (onProgress) onProgress(100);

  precomputeBlockExtents(blocks, styles);

  // ATTRIB 局部坐标归一化：必须在 IMAGE 修正之后、范围与偏移计算之前，
  // 让「渲染 / 图纸范围 / 搜索定位」三处口径完全一致。
  normalizeInsertAttributes(allEntities, blocks);

  allEntities.forEach(entity => {
    if (entity.type !== EntityType.IMAGE || !entity.imageRef) return;
    const imageDef = imageDefs[entity.imageRef];
    if (!imageDef) return;
    if (imageDef.filePath) entity.imagePath = imageDef.filePath;
    if ((!entity.imageSize.x || !entity.imageSize.y) && imageDef.imageSize) {
      entity.imageSize = imageDef.imageSize;
    }
  });

  const offset = calculateStableOffset(allEntities, blocks, styles);

  allEntities.forEach(entity => offsetEntity(entity, offset));

  Object.values(blocks).forEach(block => {
    block.basePoint.x -= offset.x;
    block.basePoint.y -= offset.y;
    block.entities.forEach(entity => offsetEntity(entity, offset));
  });

  precomputeBlockExtents(blocks, styles);

  // 疑似截断的文件：若解析出的实体极少（相对文件体量不成比例），说明内容
  // 真的缺失了。此时明确报错，避免用户在画布上只看到一张白图。
  // 判据：文件很大（> 256 KB）却只解析出寥寥数个实体 —— 只可能是被截断。
  if (truncatedHint && dxfString.length > 256 * 1024 && allEntities.length < 32) {
    throw new Error(`DXF 文件不完整：${truncatedHint}。请重新导出或拷贝该图纸后再打开。`);
  }

  const layouts = buildLayouts(allEntities, layoutRecords, blocks, styles, blockHandleMap);
  const modelLayout = layouts.find(layout => layout.isModel) || layouts[0] || createLayout(MODEL_LAYOUT_NAME);
  const entities = modelLayout.entities;
  const extents = modelLayout.extents || calculateExtents(entities, blocks, styles);

  return {
    header,
    entities,
    allEntities,
    layouts,
    activeLayoutName: modelLayout.name,
    layers,
    blocks,
    styles,
    lineTypes,
    imageDefs,
    offset,
    extents,
  };
};
