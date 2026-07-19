import { AnyEntity, DxfBlock, DxfText, EntityType } from '@/types';
import { cleanCadText } from '@/utils/textUtils';

export interface TextSearchMatch {
  id: string;
  entity: AnyEntity;
  text: string;
  preview: string;
}

export interface EntityTextSearchEntry {
  id: string;
  entity: AnyEntity;
  text: string;
  normalizedText: string;
  preview: string;
}

const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim();

const cleanTextValue = (value?: string): string => normalizeText(cleanCadText(value || ''));

const collectTextFromBlock = (blockName: string, blocks: Record<string, DxfBlock>, depth = 0): string[] => {
  if (depth > 8) return [];
  const block = blocks[blockName];
  if (!block) return [];
  return block.entities.flatMap(entity => getEntityTextValues(entity, blocks, depth + 1));
};

/** 提取实体中可用于图纸文字搜索的纯文本。 */
export const getEntityTextValues = (entity: AnyEntity, blocks: Record<string, DxfBlock> = {}, depth = 0): string[] => {
  switch (entity.type) {
    case EntityType.TEXT:
    case EntityType.MTEXT:
    case EntityType.ATTRIB:
    case EntityType.ATTDEF:
      return [cleanTextValue((entity as DxfText).value), cleanTextValue((entity as DxfText).tag)].filter(Boolean);
    case EntityType.MLEADER:
      return [cleanTextValue(entity.text)].filter(Boolean);
    case EntityType.DIMENSION:
      return [cleanTextValue(entity.text), entity.measurement !== undefined ? String(entity.measurement) : ''].filter(Boolean);
    case EntityType.ACAD_TABLE:
      return [cleanTextValue(entity.cells?.join(' '))].filter(Boolean);
    case EntityType.TOLERANCE:
      return [cleanTextValue(entity.text)].filter(Boolean);
    case EntityType.INSERT:
      return [
        ...(entity.attributes || []).flatMap(attribute => getEntityTextValues(attribute, blocks, depth + 1)),
        ...collectTextFromBlock(entity.blockName, blocks, depth),
      ].filter(Boolean);
    default:
      return [];
  }
};

export const getEntitySearchText = (entity: AnyEntity, blocks: Record<string, DxfBlock> = {}): string => {
  return normalizeText(Array.from(new Set(getEntityTextValues(entity, blocks))).join(' '));
};

export const searchEntitiesByText = (entities: AnyEntity[], blocks: Record<string, DxfBlock>, query: string): TextSearchMatch[] => {
  return searchEntityTextIndex(buildEntityTextSearchIndex(entities, blocks), query);
};

/** 文档加载后生成一次搜索索引，避免每次键入都递归清洗块和文字。 */
export const buildEntityTextSearchIndex = (entities: AnyEntity[], blocks: Record<string, DxfBlock>): EntityTextSearchEntry[] => {
  const blockTextCache = new Map<string, string[]>();
  const resolvingBlocks = new Set<string>();

  const resolveBlockText = (blockName: string, depth = 0): string[] => {
    if (depth > 8 || resolvingBlocks.has(blockName)) return [];
    const cached = blockTextCache.get(blockName);
    if (cached) return cached;
    const block = blocks[blockName];
    if (!block) return [];
    resolvingBlocks.add(blockName);
    const values = block.entities.flatMap(entity => resolveEntityText(entity, depth + 1));
    resolvingBlocks.delete(blockName);
    blockTextCache.set(blockName, values);
    return values;
  };

  const resolveEntityText = (entity: AnyEntity, depth = 0): string[] => {
    switch (entity.type) {
      case EntityType.TEXT:
      case EntityType.MTEXT:
      case EntityType.ATTRIB:
      case EntityType.ATTDEF:
        return [cleanTextValue((entity as DxfText).value), cleanTextValue((entity as DxfText).tag)].filter(Boolean);
      case EntityType.MLEADER:
        return [cleanTextValue(entity.text)].filter(Boolean);
      case EntityType.DIMENSION:
        return [cleanTextValue(entity.text), entity.measurement !== undefined ? String(entity.measurement) : ''].filter(Boolean);
      case EntityType.ACAD_TABLE:
        return [cleanTextValue(entity.cells?.join(' '))].filter(Boolean);
      case EntityType.TOLERANCE:
        return [cleanTextValue(entity.text)].filter(Boolean);
      case EntityType.INSERT:
        return [
          ...(entity.attributes || []).flatMap(attribute => resolveEntityText(attribute, depth + 1)),
          ...resolveBlockText(entity.blockName, depth),
        ].filter(Boolean);
      default:
        return [];
    }
  };

  return entities.flatMap(entity => {
    const text = normalizeText(Array.from(new Set(resolveEntityText(entity))).join(' '));
    if (!text) return [];
    return [{
      id: entity.id,
      entity,
      text,
      normalizedText: text.toLocaleLowerCase(),
      preview: text.length > 120 ? `${text.slice(0, 117)}...` : text,
    }];
  });
};

export const searchEntityTextIndex = (index: EntityTextSearchEntry[], query: string): TextSearchMatch[] => {
  const keyword = normalizeText(query).toLocaleLowerCase();
  if (!keyword) return [];

  return index.flatMap(entry => {
    if (!entry.normalizedText.includes(keyword)) return [];
    return [{
      id: entry.id,
      entity: entry.entity,
      text: entry.text,
      preview: entry.preview,
    }];
  });
};
