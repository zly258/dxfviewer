import { AnyEntity, DxfBlock, DxfText, EntityType } from '@/types';
import { cleanCadText } from '@/utils/textUtils';

export interface TextSearchMatch {
  id: string;
  entity: AnyEntity;
  text: string;
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
  const keyword = normalizeText(query).toLocaleLowerCase();
  if (!keyword) return [];

  return entities.flatMap(entity => {
    const text = getEntitySearchText(entity, blocks);
    if (!text || !text.toLocaleLowerCase().includes(keyword)) return [];
    return [{
      id: entity.id,
      entity,
      text,
      preview: text.length > 120 ? `${text.slice(0, 117)}...` : text,
    }];
  });
};
