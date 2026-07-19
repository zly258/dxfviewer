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
import { offsetEntity } from '@/core/geometry/offset';
import { calculateExtents, getEntityExtents, precomputeBlockExtents } from '@/core/geometry/extents';
import {
  CAD_DEFAULT_LAYER_COLOR,
  CAD_DEFAULT_LAYER_NAME,
  CAD_DEFAULT_TEXT_STYLE,
} from '@/config/cadConstants';
import { DEFAULT_TEXT_STYLE, EXTENTS_CONFIG } from '@/config/viewerConfig';

const MODEL_LAYOUT_NAME = 'Model';

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

  const layouts = Array.from(layoutMap.values()).map(layout => ({
    ...layout,
    extents: calculateExtents(layout.entities, blocks, styles),
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
const createAbortError = (): Error => {
  const error = new Error('DXF parsing was cancelled');
  error.name = 'AbortError';
  return error;
};

const getNow = (): number => typeof performance !== 'undefined' ? performance.now() : Date.now();

export const parseDxf = async (
  dxfString: string,
  onProgress?: (percent: number) => void,
  options: ParseDxfOptions = {},
): Promise<DxfData> => {
  ensureDxfStructure(dxfString);
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
    if (options.signal?.aborted) throw createAbortError();

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
        const block = parseBlock(state, blockHandleMap);
        if (block) {
          blocks[block.name] = block;
          if (block.handle) blockHandleMap[block.handle] = block.name;
        }
      }
    } else if (currentSection === 'ENTITIES') {
      if (group.code === 0) {
        if (group.value === 'SEQEND') continue;
        const entity = parseEntityDispatcher(group.value, state, blockHandleMap);
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

  if (options.signal?.aborted) throw createAbortError();
  if (onProgress) onProgress(100);

  precomputeBlockExtents(blocks, styles);

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
