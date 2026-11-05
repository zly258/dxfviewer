import { AnyEntity, EntityType } from '@/types';
import { DxfParserState, applyCommonGroup } from './parserState';
import { consumeEntityGroups } from './groupValue';

/**
 * REGION 依赖 ACIS 几何数据。当前先保留实体元数据，避免未知实体丢失。
 */
export const parseRegionMetadata = (state: DxfParserState, common: any): AnyEntity => {
  const entity: any = { ...common, type: EntityType.REGION };
  consumeEntityGroups(state, (code, value) => applyCommonGroup(entity, code, value));
  return entity;
};

/**
 * 3DSOLID/BODY/SURFACE 同属 ACIS 数据。保留基础 DXF 元数据，不尝试解析实体内核。
 */
export const parseAcisMetadataEntity = (
  state: DxfParserState,
  common: any,
  type: EntityType.SOLID3D | EntityType.BODY | EntityType.SURFACE,
): AnyEntity => {
  const entity: any = { ...common, type };
  consumeEntityGroups(state, (code, value) => applyCommonGroup(entity, code, value));
  return entity;
};
