import { AnyEntity, DxfBlock, DxfText, EntityType } from '@/types';
import { TEXT_RENDER_CONFIG } from '@/config/viewerConfig';

/** 判断 ATTRIB/ATTDEF 是否为占位符属性文字（位于原点且高度异常大）。 */
export const isPlaceholderAttributeText = (entity: AnyEntity): boolean => {
    if (entity.type !== EntityType.ATTRIB && entity.type !== EntityType.ATTDEF) return false;
    const ent = entity as DxfText;
    const tolerance = TEXT_RENDER_CONFIG.placeholderAttributeCoordinateTolerance;
    const isAtDefaultOrigin = Math.abs(ent.position?.x || 0) <= tolerance && Math.abs(ent.position?.y || 0) <= tolerance;
    const hasSuspiciousHeight = (ent.height || 0) >= TEXT_RENDER_CONFIG.placeholderAttributeHeightThreshold;
    return isAtDefaultOrigin && hasSuspiciousHeight;
};

/** 判断实体是否为文字类型（TEXT、MTEXT、ATTRIB、ATTDEF）。 */
export const isTextLikeEntity = (ent: AnyEntity): boolean => (
    ent.type === EntityType.TEXT
    || ent.type === EntityType.MTEXT
    || ent.type === EntityType.ATTRIB
    || ent.type === EntityType.ATTDEF
);

/** 判断实体是否为无限引导线（RAY 或 XLINE）。 */
export const isGuideEntity = (ent: AnyEntity): boolean =>
    ent.type === EntityType.RAY || ent.type === EntityType.XLINE;

/** 判断图层名称是否为特殊的 "Defpoints" 图层。 */
export const isDefpointsLayer = (layerName?: string): boolean =>
    (layerName || '').toLowerCase() === 'defpoints';

/** 判断块内实体是否为可绘制的几何图元（排除文字、点、引导线、表格）。 */
export const isDrawableBlockEntity = (entity: AnyEntity): boolean => {
    if (entity.visible === false) return false;
    if (isTextLikeEntity(entity)) return false;
    if (entity.type === EntityType.POINT || isGuideEntity(entity)) return false;
    if (entity.type === EntityType.ACAD_TABLE) return false;
    return true;
};

/** 判断块定义中是否包含可绘制的几何实体。 */
export const hasDrawableBlockGeometry = (block?: DxfBlock): boolean => {
    return !!block && Array.isArray(block.entities) && block.entities.some(isDrawableBlockEntity);
};

/** 判断实体是否为用于范围计算的"主要"几何实体。 */
export const isPrimaryGeometryEntity = (ent: AnyEntity, blocks?: Record<string, DxfBlock>): boolean => {
    if (isTextLikeEntity(ent)) return false;
    if (ent.type === EntityType.POINT) return false;
    if (isGuideEntity(ent)) return false;
    if (ent.type === EntityType.ACAD_TABLE) {
        return blocks ? isTableWithDrawableBlock(ent, blocks) : false;
    }
    if (ent.type === EntityType.INSERT && blocks && !isBlockInsertWithDrawableExtents(ent, blocks)) return false;
    return true;
};

/** 判断 TABLE 实体是否引用了包含可绘制几何的块。 */
export const isTableWithDrawableBlock = (ent: AnyEntity, blocks: Record<string, DxfBlock>): boolean => {
    if (ent.type !== EntityType.ACAD_TABLE || !ent.blockName) return false;
    return hasDrawableBlockGeometry(blocks[ent.blockName]);
};

/** 判断 INSERT 实体是否引用了具有有效范围和可绘制几何的块。 */
export const isBlockInsertWithDrawableExtents = (ent: AnyEntity, blocks: Record<string, DxfBlock>): boolean => {
    if (ent.type !== EntityType.INSERT || !ent.blockName) return true;
    const block = blocks[ent.blockName];
    return !!block?.extents && hasDrawableBlockGeometry(block);
};
