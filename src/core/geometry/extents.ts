import { AnyEntity, DxfBlock, DxfStyle, DxfText, DxfTable, EntityType, Point2D } from '@/types';
import { EXTENTS_CONFIG, TABLE_EXTENTS_CONFIG, LEADER_RENDER_CONFIG, TEXT_RENDER_CONFIG } from '@/config/viewerConfig';
import { CAD_DEFAULT_TEXT_HEIGHT } from '@/config/cadConstants';
import { sampleBulgeSegment } from './bulge';
import { sampleEllipsePoints, sampleHatchLoop, sampleSplinePoints } from './curveSampling';
import { getCadTextExtents, pointsToExtents, cleanMText } from '@/utils/textUtils';
import {
    isPlaceholderAttributeText,
    isTextLikeEntity,
    isGuideEntity,
    isDefpointsLayer,
    hasDrawableBlockGeometry,
    isPrimaryGeometryEntity,
    isTableWithDrawableBlock,
    isBlockInsertWithDrawableExtents,
} from '@/utils/entityClassify';
import { getMLeaderTerminalPoint, getMLeaderTextPosition, getMLeaderTextAttachment } from '@/utils/mleaderUtils';

// ─── 包围盒更新器 ────────────────────────────────────────────────────

/** 创建一个累积式包围盒更新器，用于逐步收集坐标并计算最终 AABB。 */
export const createBoundsUpdater = () => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    /** 添加一个坐标点到包围盒 */
    const update = (x: number, y: number) => {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        if (Math.abs(x) > EXTENTS_CONFIG.maxFiniteCoordinate || Math.abs(y) > EXTENTS_CONFIG.maxFiniteCoordinate) return;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
    };

    /** 合并已有的包围盒范围 */
    const updateExtents = (extents: { min: Point2D; max: Point2D } | null) => {
        if (!extents) return;
        update(extents.min.x, extents.min.y);
        update(extents.max.x, extents.max.y);
    };

    /** 返回最终的包围盒，无有效数据时返回 null */
    const finish = (): { min: Point2D; max: Point2D } | null => {
        if (minX === Infinity || minY === Infinity || maxX === -Infinity || maxY === -Infinity) return null;
        return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
    };

    return { update, updateExtents, finish };
};

// ─── 坐标变换辅助函数 ───────────────────────────────────────────────

/** 对点进行缩放+旋转+平移变换（用于块插入的坐标计算）。 */
export const transformPoint = (point: Point2D, position: Point2D, scale: { x: number; y: number; z?: number }, rotationDegrees: number): Point2D => {
    const rotation = rotationDegrees * Math.PI / 180;
    const sx = point.x * scale.x;
    const sy = point.y * scale.y;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    return {
        x: position.x + sx * cos - sy * sin,
        y: position.y + sx * sin + sy * cos,
    };
};

/** 将块的包围盒四角变换到世界坐标系后，计算新的轴对齐包围盒。 */
export const transformExtentsCorners = (
    extents: { min: Point2D; max: Point2D },
    basePoint: Point2D,
    position: Point2D,
    scale: { x: number; y: number; z?: number },
    rotationDegrees: number,
): { min: Point2D; max: Point2D } | null => {
    return pointsToExtents([
        { x: extents.min.x - basePoint.x, y: extents.min.y - basePoint.y },
        { x: extents.max.x - basePoint.x, y: extents.min.y - basePoint.y },
        { x: extents.min.x - basePoint.x, y: extents.max.y - basePoint.y },
        { x: extents.max.x - basePoint.x, y: extents.max.y - basePoint.y },
    ].map(point => transformPoint(point, position, scale, rotationDegrees)));
};

// ─── 弧段极值计算 ─────────────────────────────────────────────────

/** 判断角度 a 是否在给定弧段的角度范围内。 */
const isAngleBetween = (a: number, start: number, end: number, ccw: boolean): boolean => {
    const norm = (v: number) => {
        let t = v;
        while (t < 0) t += Math.PI * 2;
        while (t >= Math.PI * 2) t -= Math.PI * 2;
        return t;
    };
    const A = norm(a);
    const S = norm(start);
    const E = norm(end);
    if (ccw) return S > E ? (A >= S || A <= E) : (A >= S && A <= E);
    return S > E ? (A <= S && A >= E) : (A <= S && A >= E);
};

/** 更新弧段在四个象限极值点处的包围盒。 */
const updateArcExtrema = (update: (x: number, y: number) => void, cx: number, cy: number, r: number, start: number, end: number, ccw: boolean) => {
    const pts = [
        { a: 0, x: cx + r, y: cy },
        { a: Math.PI / 2, x: cx, y: cy + r },
        { a: Math.PI, x: cx - r, y: cy },
        { a: Math.PI * 1.5, x: cx, y: cy - r },
    ];
    pts.forEach(p => {
        if (isAngleBetween(p.a, start, end, ccw)) update(p.x, p.y);
    });
};

/** 通过采样凸度弧段来更新包围盒。 */
const updateBulgeSegmentExtents = (update: (x: number, y: number) => void, p1: Point2D, p2: Point2D, bulge: number, isFlipped: boolean) => {
    const effectiveBulge = isFlipped ? -bulge : bulge;
    sampleBulgeSegment(p1, p2, effectiveBulge).forEach(point => update(point.x, point.y));
};

// ─── 表格辅助函数 ────────────────────────────────────────────────

/** 限制表格行/列数在合理范围内。 */
const clampTableCount = (value: unknown, fallback: number, maxCount: number): number => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 1) return fallback;
    return Math.max(1, Math.min(maxCount, Math.floor(n)));
};

/** 规范化表格的行高/列宽数组，确保数量与行列数一致。 */
const normalizeTableDimensionArray = (
    values: number[] | undefined,
    count: number,
    fallback: number,
    minValue: number,
    maxValue: number,
): number[] => {
    const source = Array.isArray(values) ? values : [];
    const valid = source.filter(value => Number.isFinite(value) && value >= minValue && value <= maxValue);
    if (valid.length === count) return valid.slice(0, count);
    if (valid.length > 0 && valid.length < count) {
        const result = valid.slice();
        while (result.length < count) result.push(fallback);
        return result;
    }
    return new Array(count).fill(fallback);
};

/** 规范化 ACAD_TABLE 的行列几何参数（行数/列数/行高/列宽）。 */
export const normalizeAcadTableGeometry = (table: DxfTable): void => {
    const explicitColumns = clampTableCount(table.columnCount, 1, TABLE_EXTENTS_CONFIG.maxFallbackColumns);
    const cellCount = table.cells?.length || 0;
    table.columnCount = explicitColumns;
    table.rowCount = cellCount > 0
        ? clampTableCount(Math.ceil(cellCount / explicitColumns), 1, TABLE_EXTENTS_CONFIG.maxFallbackRows)
        : clampTableCount(table.rowCount, 1, TABLE_EXTENTS_CONFIG.maxFallbackRows);

    const rowSpacing = Number(table.rowSpacing);
    const columnSpacing = Number(table.columnSpacing);
    table.rowSpacing = Number.isFinite(rowSpacing) && rowSpacing >= TABLE_EXTENTS_CONFIG.minRowHeight && rowSpacing <= TABLE_EXTENTS_CONFIG.maxRowHeight
        ? rowSpacing
        : TABLE_EXTENTS_CONFIG.defaultRowHeight;
    table.columnSpacing = Number.isFinite(columnSpacing) && columnSpacing >= TABLE_EXTENTS_CONFIG.minColumnWidth && columnSpacing <= TABLE_EXTENTS_CONFIG.maxColumnWidth
        ? columnSpacing
        : TABLE_EXTENTS_CONFIG.defaultColumnWidth;

    table.rowHeights = normalizeTableDimensionArray(
        table.rowHeights, table.rowCount, table.rowSpacing,
        TABLE_EXTENTS_CONFIG.minRowHeight, TABLE_EXTENTS_CONFIG.maxRowHeight,
    );
    table.colWidths = normalizeTableDimensionArray(
        table.colWidths, table.columnCount, table.columnSpacing,
        TABLE_EXTENTS_CONFIG.minColumnWidth, TABLE_EXTENTS_CONFIG.maxColumnWidth,
    );
};

/** 判断表格是否包含可显示的文字内容。 */
const hasTableTextContent = (table: DxfTable): boolean => {
    return Array.isArray(table.cells) && table.cells.some(cell => cleanMText(String(cell || '')).trim().length > 0);
};

/** 获取表格的兜底渲染几何参数（宽度/高度/行列数），用于无块定义时的表格绘制。 */
const getTableFallbackGeometry = (table: DxfTable): { width: number; height: number; rowCount: number; colCount: number } | null => {
    normalizeAcadTableGeometry(table);
    const rowCount = clampTableCount(table.rowCount, 1, TABLE_EXTENTS_CONFIG.maxFallbackRows);
    const colCount = clampTableCount(table.columnCount, 1, TABLE_EXTENTS_CONFIG.maxFallbackColumns);
    const rowHeights = normalizeTableDimensionArray(table.rowHeights, rowCount, table.rowSpacing || TABLE_EXTENTS_CONFIG.defaultRowHeight, TABLE_EXTENTS_CONFIG.minRowHeight, TABLE_EXTENTS_CONFIG.maxRowHeight);
    const colWidths = normalizeTableDimensionArray(table.colWidths, colCount, table.columnSpacing || TABLE_EXTENTS_CONFIG.defaultColumnWidth, TABLE_EXTENTS_CONFIG.minColumnWidth, TABLE_EXTENTS_CONFIG.maxColumnWidth);
    const width = colWidths.reduce((sum, value) => sum + Math.abs(value), 0);
    const height = rowHeights.reduce((sum, value) => sum + Math.abs(value), 0);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    if (width > TABLE_EXTENTS_CONFIG.maxFallbackTotalWidth || height > TABLE_EXTENTS_CONFIG.maxFallbackTotalHeight) return null;
    const aspectRatio = Math.max(width / height, height / width);
    if (aspectRatio > TABLE_EXTENTS_CONFIG.maxFallbackAspectRatio) return null;
    return { width, height, rowCount, colCount };
};

/** 计算表格的兜底范围（在块缺失或为空时使用）。 */
const getTableFallbackExtents = (table: DxfTable): { min: Point2D; max: Point2D } | null => {
    if (!hasTableTextContent(table)) return null;
    const geometry = getTableFallbackGeometry(table);
    if (!geometry) return null;
    const scale = table.scale || { x: 1, y: 1, z: 1 };
    const rotation = table.rotation || 0;
    return pointsToExtents([
        { x: 0, y: 0 },
        { x: geometry.width, y: 0 },
        { x: 0, y: -geometry.height },
        { x: geometry.width, y: -geometry.height },
    ].map(point => transformPoint(point, table.position, scale, rotation)));
};

// ─── 标注块范围计算 ──────────────────────────────────────────────

/** 获取标注实体关联块的范围（处理局部坐标系偏移）。 */
const getDimensionBlockExtents = (ent: AnyEntity, blocks: Record<string, DxfBlock>): { min: Point2D; max: Point2D } | null => {
    if (ent.type !== EntityType.DIMENSION || !ent.blockName) return null;
    const block = blocks[ent.blockName];
    if (!block?.extents) return null;

    const definitionPoint = ent.definitionPoint;
    const blockWidth = block.extents.max.x - block.extents.min.x;
    const blockHeight = block.extents.max.y - block.extents.min.y;
    const blockSize = Math.max(Math.abs(blockWidth), Math.abs(blockHeight), 1);
    const blockCenter = {
        x: (block.extents.min.x + block.extents.max.x) / 2,
        y: (block.extents.min.y + block.extents.max.y) / 2,
    };
    // 判断标注块是否使用局部坐标系（块中心与定义点距离很远）
    const distance = Math.hypot(blockCenter.x - definitionPoint.x, blockCenter.y - definitionPoint.y);
    const isLocalBlock = distance > blockSize * EXTENTS_CONFIG.dimensionLocalBlockDistanceFactor;

    if (!isLocalBlock) return block.extents;

    // 使用局部坐标系时，将块范围平移到定义点附近
    return transformExtentsCorners(block.extents, block.basePoint, definitionPoint, { x: 1, y: 1, z: 1 }, 0);
};

// ─── 单个实体范围计算 ────────────────────────────────────────────

/** 计算单个实体的轴对齐包围盒（AABB）。 */
export const getEntityExtents = (
    ent: AnyEntity,
    blocks: Record<string, DxfBlock>,
    styles?: Record<string, DxfStyle>,
): { min: Point2D; max: Point2D } | null => {
    if (ent.visible === false || ent.type === EntityType.ATTDEF || isPlaceholderAttributeText(ent)) return null;

    const bounds = createBoundsUpdater();

    switch (ent.type) {
        case EntityType.LINE:
            bounds.update(ent.start.x, ent.start.y);
            bounds.update(ent.end.x, ent.end.y);
            break;
        case EntityType.RAY:
        case EntityType.XLINE: {
            // 无限线使用有限的引导长度来计算范围
            const length = EXTENTS_CONFIG.infiniteGuideLength;
            const dirLen = Math.hypot(ent.direction.x, ent.direction.y) || 1;
            const ux = ent.direction.x / dirLen;
            const uy = ent.direction.y / dirLen;
            if (ent.type === EntityType.RAY) {
                bounds.update(ent.basePoint.x, ent.basePoint.y);
                bounds.update(ent.basePoint.x + ux * length, ent.basePoint.y + uy * length);
            } else {
                bounds.update(ent.basePoint.x - ux * length, ent.basePoint.y - uy * length);
                bounds.update(ent.basePoint.x + ux * length, ent.basePoint.y + uy * length);
            }
            break;
        }
        case EntityType.CIRCLE:
            if (Number.isFinite(ent.radius) && ent.radius >= 0) {
                bounds.update(ent.center.x - ent.radius, ent.center.y - ent.radius);
                bounds.update(ent.center.x + ent.radius, ent.center.y + ent.radius);
            }
            break;
        case EntityType.ARC: {
            if (!Number.isFinite(ent.radius) || ent.radius < 0) break;
            const startAngle = ent.startAngle * Math.PI / 180;
            const endAngle = ent.endAngle * Math.PI / 180;
            const start = { x: ent.center.x + ent.radius * Math.cos(startAngle), y: ent.center.y + ent.radius * Math.sin(startAngle) };
            const end = { x: ent.center.x + ent.radius * Math.cos(endAngle), y: ent.center.y + ent.radius * Math.sin(endAngle) };
            bounds.update(start.x, start.y);
            bounds.update(end.x, end.y);
            // 检查弧段是否经过象限极值点
            updateArcExtrema(bounds.update, ent.center.x, ent.center.y, ent.radius, startAngle, endAngle, ent.isCounterClockwise ?? true);
            break;
        }
        case EntityType.LWPOLYLINE:
        case EntityType.POLYLINE:
        case EntityType.MLINE: {
            const points = ent.type === EntityType.MLINE ? ent.vertices : ent.points;
            if (!points || points.length === 0) break;
            if (ent.type === EntityType.MLINE) {
                points.forEach(point => bounds.update(point.x, point.y));
                break;
            }
            // 多段线需要考虑凸度弧段的极值
            const isFlipped = (ent.extrusion?.z || 1) < 0;
            const segmentCount = ent.closed ? points.length : Math.max(0, points.length - 1);
            for (let i = 0; i < segmentCount; i++) {
                const p1 = points[i];
                const p2 = points[(i + 1) % points.length];
                const bulge = ent.bulges?.[i] || 0;
                updateBulgeSegmentExtents(bounds.update, p1, p2, bulge, isFlipped);
            }
            points.forEach(point => bounds.update(point.x, point.y));
            break;
        }
        case EntityType.POINT:
            bounds.update(ent.position.x, ent.position.y);
            break;
        case EntityType.TEXT:
        case EntityType.MTEXT:
        case EntityType.ATTRIB:
            bounds.updateExtents(getCadTextExtents(ent, styles));
            break;
        case EntityType.ELLIPSE: {
            // 通过采样椭圆来计算范围
            const points = sampleEllipsePoints(ent.center, ent.majorAxis, ent.ratio, ent.startParam, ent.endParam, true);
            if (points.length === 0) bounds.update(ent.center.x, ent.center.y);
            points.forEach(point => bounds.update(point.x, point.y));
            break;
        }
        case EntityType.SPLINE: {
            // 样条曲线优先使用预计算点，否则通过采样生成
            const points = ent.calculatedPoints && ent.calculatedPoints.length > 0
                ? ent.calculatedPoints
                : ent.fitPoints && ent.fitPoints.length > 1
                    ? ent.fitPoints
                    : sampleSplinePoints(ent.controlPoints || [], ent.degree || 3, ent.knots, ent.weights);
            points.forEach(point => bounds.update(point.x, point.y));
            break;
        }
        case EntityType.SOLID:
        case EntityType.THREEDFACE:
            ent.points.forEach(point => bounds.update(point.x, point.y));
            break;
        case EntityType.HATCH:
            // 采样所有填充环的点来计算范围
            ent.loops.forEach(loop => sampleHatchLoop(loop).forEach(point => bounds.update(point.x, point.y)));
            break;
        case EntityType.INSERT: {
            const block = blocks[ent.blockName];
            const insertExtents: { min: Point2D; max: Point2D }[] = [];
            if (!block?.extents) {
                bounds.update(ent.position.x, ent.position.y);
            } else {
                // 处理阵列插入（行列重复）
                const rowCount = Math.max(1, ent.rowCount || 1);
                const colCount = Math.max(1, ent.colCount || 1);
                for (let row = 0; row < rowCount; row++) {
                    for (let col = 0; col < colCount; col++) {
                        const position = {
                            x: ent.position.x + col * (ent.colSpacing || 0),
                            y: ent.position.y + row * (ent.rowSpacing || 0),
                        };
                        const transformed = transformExtentsCorners(block.extents, block.basePoint, position, ent.scale || { x: 1, y: 1, z: 1 }, ent.rotation || 0);
                        if (transformed) {
                            insertExtents.push(transformed);
                            bounds.updateExtents(transformed);
                        }
                    }
                }
            }
            // 处理块属性文字的范围
            ent.attributes?.forEach(attribute => {
                if (isPlaceholderAttributeText(attribute)) return;
                const text = cleanMText(String((attribute as DxfText).value || '')).trim();
                if (text.length === 0) return;
                const attrExtents = getCadTextExtents(attribute as DxfText, styles);
                if (!attrExtents) return;
                // 仅在属性文字靠近块几何范围时才纳入计算
                if (insertExtents.length === 0 || insertExtents.some(item => isAnnotationExtentsNearGeometry(attrExtents, item))) {
                    bounds.updateExtents(attrExtents);
                }
            });
            break;
        }
        case EntityType.ACAD_TABLE: {
            const block = blocks[ent.blockName];
            if (hasDrawableBlockGeometry(block) && block?.extents) {
                bounds.updateExtents(transformExtentsCorners(block.extents, block.basePoint, ent.position, ent.scale || { x: 1, y: 1, z: 1 }, ent.rotation || 0));
            } else {
                // 块缺失或为空时使用兜底范围
                bounds.updateExtents(getTableFallbackExtents(ent));
            }
            break;
        }
        case EntityType.DIMENSION: {
            const blockExtents = getDimensionBlockExtents(ent, blocks);
            if (blockExtents) {
                bounds.updateExtents(blockExtents);
                break;
            }
            // 无块定义时使用标注的关键点
            bounds.update(ent.definitionPoint.x, ent.definitionPoint.y);
            if (ent.textMidPoint) bounds.update(ent.textMidPoint.x, ent.textMidPoint.y);
            if (ent.linearP1) bounds.update(ent.linearP1.x, ent.linearP1.y);
            if (ent.linearP2) bounds.update(ent.linearP2.x, ent.linearP2.y);
            if (ent.arcP1) bounds.update(ent.arcP1.x, ent.arcP1.y);
            if (ent.arcP2) bounds.update(ent.arcP2.x, ent.arcP2.y);
            break;
        }
        case EntityType.LEADER:
            ent.points.forEach(point => bounds.update(point.x, point.y));
            break;
        case EntityType.MLEADER:
            // 引线点
            ent.leaderLines.forEach(line => line.forEach(point => bounds.update(point.x, point.y)));
            {
                // 文字范围
                const textPosition = getMLeaderTextPosition(ent);
                if (ent.text && textPosition) {
                    bounds.updateExtents(getCadTextExtents({
                        ...ent,
                        type: EntityType.MTEXT,
                        position: textPosition,
                        value: ent.text,
                        height: ent.textHeight || LEADER_RENDER_CONFIG.defaultMLeaderTextHeight,
                        width: ent.textWidth || LEADER_RENDER_CONFIG.defaultMLeaderTextWidth,
                        attachmentPoint: getMLeaderTextAttachment(ent, textPosition),
                        styleName: ent.textStyleName,
                    } as DxfText, styles));
                }
            }
            break;
        default:
            break;
    }

    return bounds.finish();
};

// ─── 块范围预计算 ────────────────────────────────────────────────

/** 预计算所有块定义的包围盒（递归处理嵌套块）。 */
export const precomputeBlockExtents = (blocks: Record<string, DxfBlock>, styles?: Record<string, DxfStyle>): void => {
    const visited = new Set<string>();
    const computing = new Set<string>();

    const compute = (name: string) => {
        if (visited.has(name) || computing.has(name)) return;
        const block = blocks[name];
        if (!block) return;

        computing.add(name);

        // 确保子块先被计算
        block.entities.forEach(ent => {
            if ((ent.type === EntityType.INSERT || ent.type === EntityType.ACAD_TABLE || ent.type === EntityType.DIMENSION) && ent.blockName) {
                compute(ent.blockName);
            }
        });

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        block.entities.forEach(ent => {
            if (ent.visible === false) return;
            // 属性定义和表格在块范围计算中不考虑
            if (ent.type === EntityType.ATTDEF || ent.type === EntityType.ATTRIB) return;
            if (ent.type === EntityType.ACAD_TABLE) return;
            const ext = getEntityExtents(ent, blocks, styles);
            if (ext) {
                ent.extents = ext;
                const isValid = (v: number) => isFinite(v) && Math.abs(v) < EXTENTS_CONFIG.maxFiniteExtent;
                if (isValid(ext.min.x) && ext.min.x < minX) minX = ext.min.x;
                if (isValid(ext.max.x) && ext.max.x > maxX) maxX = ext.max.x;
                if (isValid(ext.min.y) && ext.min.y < minY) minY = ext.min.y;
                if (isValid(ext.max.y) && ext.max.y > maxY) maxY = ext.max.y;
            }
        });

        if (minX !== Infinity && minY !== Infinity && maxX !== -Infinity && maxY !== -Infinity) {
            block.extents = { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
        }

        computing.delete(name);
        visited.add(name);
    };

    Object.keys(blocks).forEach(compute);
};

// ─── 图纸范围计算 ────────────────────────────────────────────────

/** 判断实体集合中是否存在非点几何实体（用于决定是否忽略孤立点）。 */
const hasNonPointGeometryForExtents = (entities: AnyEntity[], blocks: Record<string, DxfBlock>): boolean => {
    return entities.some(ent => {
        if (ent.visible === false || ent.type === EntityType.ATTDEF) return false;
        if (isDefpointsLayer(ent.layer)) return false;
        return isPrimaryGeometryEntity(ent, blocks);
    });
};

/** 判断实体是否应纳入图纸范围计算。 */
const shouldUseEntityForDrawingExtents = (ent: AnyEntity, hasPrimaryGeometry: boolean, blocks: Record<string, DxfBlock>): boolean => {
    if (ent.visible === false || ent.type === EntityType.ATTDEF) return false;
    if (isDefpointsLayer(ent.layer)) return false;
    if (EXTENTS_CONFIG.ignoreGuideLinesInDrawingExtents && isGuideEntity(ent)) return false;
    if (!EXTENTS_CONFIG.includePointsInDrawingExtents && ent.type === EntityType.POINT && hasPrimaryGeometry) return false;
    if (ent.type === EntityType.ACAD_TABLE && !isTableWithDrawableBlock(ent, blocks)) return false;
    if (ent.type === EntityType.INSERT && !isBlockInsertWithDrawableExtents(ent, blocks)) return false;
    return true;
};

/** 验证包围盒是否有效（值有限且尺寸大于最小阈值）。 */
const isValidExtents = (ext: { min: Point2D; max: Point2D }): boolean => {
    const values = [ext.min.x, ext.min.y, ext.max.x, ext.max.y];
    if (!values.every(value => Number.isFinite(value) && Math.abs(value) < EXTENTS_CONFIG.maxFiniteExtent)) return false;
    const width = Math.abs(ext.max.x - ext.min.x);
    const height = Math.abs(ext.max.y - ext.min.y);
    return width >= EXTENTS_CONFIG.minDrawableEntityExtent || height >= EXTENTS_CONFIG.minDrawableEntityExtent;
};

/** 合并多个包围盒为一个总范围。 */
const mergeExtentsList = (items: { min: Point2D; max: Point2D }[]): { center: Point2D; width: number; height: number; min: Point2D; max: Point2D } => {
    if (items.length === 0) {
        return { center: { x: 0, y: 0 }, width: 0, height: 0, min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    items.forEach(ext => {
        minX = Math.min(minX, ext.min.x);
        minY = Math.min(minY, ext.min.y);
        maxX = Math.max(maxX, ext.max.x);
        maxY = Math.max(maxY, ext.max.y);
    });
    const width = maxX - minX;
    const height = maxY - minY;
    return {
        center: { x: minX + width / 2, y: minY + height / 2 },
        width: isFinite(width) ? width : 0,
        height: isFinite(height) ? height : 0,
        min: { x: minX, y: minY },
        max: { x: maxX, y: maxY },
    };
};

/** 判断注释实体的范围是否靠近主几何体范围（防止远离主体的文字拉大显示范围）。 */
const isAnnotationExtentsNearGeometry = (annotationExtents: { min: Point2D; max: Point2D }, geometryExtents: { min: Point2D; max: Point2D }): boolean => {
    const geometryWidth = Math.abs(geometryExtents.max.x - geometryExtents.min.x);
    const geometryHeight = Math.abs(geometryExtents.max.y - geometryExtents.min.y);
    const padding = Math.max(
        EXTENTS_CONFIG.annotationNearGeometryMinimumPadding,
        geometryWidth * EXTENTS_CONFIG.annotationNearGeometryFactor,
        geometryHeight * EXTENTS_CONFIG.annotationNearGeometryFactor,
    );
    return annotationExtents.max.x >= geometryExtents.min.x - padding
        && annotationExtents.min.x <= geometryExtents.max.x + padding
        && annotationExtents.max.y >= geometryExtents.min.y - padding
        && annotationExtents.min.y <= geometryExtents.max.y + padding;
};

/** 获取数组的中位数。 */
const getMedian = (values: number[]): number => {
    if (values.length === 0) return 0;
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (sorted.length === 0) return 0;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

/** 计算包围盒的度量指标（宽度、高度、对角线、宽高比、中心点）。 */
const getExtentsMetrics = (ext: { min: Point2D; max: Point2D }) => {
    const width = Math.abs(ext.max.x - ext.min.x);
    const height = Math.abs(ext.max.y - ext.min.y);
    return {
        width, height,
        diagonal: Math.hypot(width, height),
        aspectRatio: width > 0 && height > 0 ? Math.max(width / height, height / width) : 1,
        center: { x: (ext.min.x + ext.max.x) / 2, y: (ext.min.y + ext.max.y) / 2 },
    };
};

/**
 * 过滤离群实体的包围盒：
 * - 距离中位数中心过远的实体
 * - 宽高比异常且尺寸过大的实体（如无限长的引导线）
 */
const filterOutlierExtents = (items: { min: Point2D; max: Point2D }[]): { min: Point2D; max: Point2D }[] => {
    if (items.length < EXTENTS_CONFIG.outlierFilterMinEntityCount) return items;
    const metrics = items.map(getExtentsMetrics);
    const medianX = getMedian(metrics.map(item => item.center.x));
    const medianY = getMedian(metrics.map(item => item.center.y));
    const distances = metrics.map(item => Math.hypot(item.center.x - medianX, item.center.y - medianY));
    const medianDistance = getMedian(distances);
    const distanceMad = getMedian(distances.map(distance => Math.abs(distance - medianDistance)));
    const medianDiagonal = Math.max(getMedian(metrics.map(item => item.diagonal)), EXTENTS_CONFIG.minDrawableEntityExtent);
    const distanceLimit = Math.max(
        medianDistance + distanceMad * EXTENTS_CONFIG.outlierCenterMadMultiplier,
        medianDiagonal * EXTENTS_CONFIG.outlierSizeMedianMultiplier,
    );

    const filtered = items.filter((_item, index) => {
        const metric = metrics[index];
        const distance = distances[index];
        const isFarAway = distance > distanceLimit;
        const isHugeSkinnyBox = metric.aspectRatio > EXTENTS_CONFIG.outlierAspectRatioLimit
            && metric.diagonal > medianDiagonal * EXTENTS_CONFIG.outlierSizeMedianMultiplier;
        return !isFarAway && !isHugeSkinnyBox;
    });
    return filtered.length > 0 ? filtered : items;
};

/**
 * 计算图纸范围：将实体分为主几何、注释、后备三类，
 * 过滤离群值后合并近距离注释，得到稳定的显示范围。
 */
export const calculateExtents = (entities: AnyEntity[], blocks: Record<string, DxfBlock>, styles?: Record<string, DxfStyle>): { center: Point2D; width: number; height: number; min: Point2D; max: Point2D } => {
    const primaryExtents: { min: Point2D; max: Point2D }[] = [];
    const annotationExtents: { min: Point2D; max: Point2D }[] = [];
    const fallbackExtents: { min: Point2D; max: Point2D }[] = [];
    const hasPrimaryGeometry = hasNonPointGeometryForExtents(entities, blocks);

    entities.forEach(ent => {
        if (!shouldUseEntityForDrawingExtents(ent, hasPrimaryGeometry, blocks)) return;
        const ext = getEntityExtents(ent, blocks, styles);
        if (!ext || !isValidExtents(ext)) return;
        ent.extents = ext;

        if (isPrimaryGeometryEntity(ent, blocks)) primaryExtents.push(ext);
        else if (isTextLikeEntity(ent)) annotationExtents.push(ext);
        else fallbackExtents.push(ext);
    });

    if (primaryExtents.length === 0) {
        return mergeExtentsList(filterOutlierExtents([...fallbackExtents, ...annotationExtents]));
    }

    const stablePrimaryExtents = filterOutlierExtents(primaryExtents);
    const primaryBounds = mergeExtentsList(stablePrimaryExtents);
    const nearbyAnnotations = annotationExtents.filter(ext => isAnnotationExtentsNearGeometry(ext, primaryBounds));
    const nearbyFallback = fallbackExtents.filter(ext => isAnnotationExtentsNearGeometry(ext, primaryBounds));
    return mergeExtentsList(filterOutlierExtents([...stablePrimaryExtents, ...nearbyFallback, ...nearbyAnnotations]));
};

/**
 * 智能图纸范围计算：在实体数量较多时使用统计方法过滤极端离群值，
 * 通过中位数绝对偏差（MAD）和百分位数来确定"主体部分"。
 */
export const calculateSmartExtents = (entities: AnyEntity[], blocks: Record<string, DxfBlock>, styles?: Record<string, DxfStyle>): { center: Point2D; width: number; height: number; min: Point2D; max: Point2D } => {
    const validExtents: { min: Point2D; max: Point2D; center: Point2D }[] = [];

    const hasOtherGeometry = hasNonPointGeometryForExtents(entities, blocks);
    entities.forEach(ent => {
        if (!shouldUseEntityForDrawingExtents(ent, hasOtherGeometry, blocks)) return;
        const ext = getEntityExtents(ent, blocks, styles);
        if (ext) {
            const isValid = (v: number) => isFinite(v) && Math.abs(v) < EXTENTS_CONFIG.maxFiniteExtent;
            if (isValid(ext.min.x) && isValid(ext.max.x) && isValid(ext.min.y) && isValid(ext.max.y)) {
                validExtents.push({
                    min: ext.min, max: ext.max,
                    center: { x: (ext.min.x + ext.max.x) / 2, y: (ext.min.y + ext.max.y) / 2 },
                });
                ent.extents = ext;
            }
        }
    });

    if (validExtents.length === 0) {
        return { center: { x: 0, y: 0 }, width: 0, height: 0, min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
    }

    if (validExtents.length <= 2) {
        return calculateExtents(entities, blocks, styles);
    }

    // 完整包围盒
    let fullMinX = Infinity, fullMinY = Infinity, fullMaxX = -Infinity, fullMaxY = -Infinity;
    validExtents.forEach(ext => {
        fullMinX = Math.min(fullMinX, ext.min.x);
        fullMaxX = Math.max(fullMaxX, ext.max.x);
        fullMinY = Math.min(fullMinY, ext.min.y);
        fullMaxY = Math.max(fullMaxY, ext.max.y);
    });

    // 基于统计方法过滤离群值
    const centersX = validExtents.map(e => e.center.x).sort((a, b) => a - b);
    const centersY = validExtents.map(e => e.center.y).sort((a, b) => a - b);

    const n = centersX.length;
    const medianX = n % 2 === 0 ? (centersX[n / 2 - 1] + centersX[n / 2]) / 2 : centersX[Math.floor(n / 2)];
    const medianY = n % 2 === 0 ? (centersY[n / 2 - 1] + centersY[n / 2]) / 2 : centersY[Math.floor(n / 2)];

    const distToMedian = validExtents
        .map(e => Math.hypot(e.center.x - medianX, e.center.y - medianY))
        .sort((a, b) => a - b);
    const medDist = distToMedian.length % 2 === 0
        ? (distToMedian[distToMedian.length / 2 - 1] + distToMedian[distToMedian.length / 2]) / 2
        : distToMedian[Math.floor(distToMedian.length / 2)];
    const absDev = distToMedian.map(d => Math.abs(d - medDist)).sort((a, b) => a - b);
    const mad = absDev.length % 2 === 0
        ? (absDev[absDev.length / 2 - 1] + absDev[absDev.length / 2]) / 2
        : absDev[Math.floor(absDev.length / 2)];
    const distThreshold = mad > 0 ? (medDist + mad * 8) : (medDist * 3 + 1);

    // 根据实体数量调整修剪百分比
    const trim = n < 40 ? 0.15 : 0.05;
    const lowIdx = Math.max(0, Math.floor(n * trim));
    const highIdx = Math.min(n - 1, Math.ceil(n * (1 - trim)) - 1);

    const p5X = centersX[lowIdx];
    const p95X = centersX[highIdx];
    const p5Y = centersY[lowIdx];
    const p95Y = centersY[highIdx];

    const pWidth = p95X - p5X;
    const pHeight = p95Y - p5Y;
    const fWidth = fullMaxX - fullMinX;
    const fHeight = fullMaxY - fullMinY;

    let finalMinX = fullMinX, finalMaxX = fullMaxX, finalMinY = fullMinY, finalMaxY = fullMaxY;

    // 使用 MAD 阈值进行稳健估计
    const robust = (() => {
        let rMinX = Infinity, rMinY = Infinity, rMaxX = -Infinity, rMaxY = -Infinity;
        validExtents.forEach(ext => {
            const d = Math.hypot(ext.center.x - medianX, ext.center.y - medianY);
            if (d <= distThreshold) {
                rMinX = Math.min(rMinX, ext.min.x);
                rMaxX = Math.max(rMaxX, ext.max.x);
                rMinY = Math.min(rMinY, ext.min.y);
                rMaxY = Math.max(rMaxY, ext.max.y);
            }
        });
        if (rMinX === Infinity) return null;
        return { minX: rMinX, maxX: rMaxX, minY: rMinY, maxY: rMaxY };
    })();

    if (robust) {
        const rWidth = robust.maxX - robust.minX;
        const rHeight = robust.maxY - robust.minY;
        if ((isFinite(rWidth) && rWidth > 0 && fWidth > rWidth * CAD_DEFAULT_TEXT_HEIGHT) ||
            (isFinite(rHeight) && rHeight > 0 && fHeight > rHeight * CAD_DEFAULT_TEXT_HEIGHT)) {
            finalMinX = robust.minX;
            finalMaxX = robust.maxX;
            finalMinY = robust.minY;
            finalMaxY = robust.maxY;
        }
    }

    // 如果完整范围显著大于百分位范围，则专注于"主体部分"
    if (fWidth > pWidth * 10 || fHeight > pHeight * 10) {
        // 过滤掉不在 p5-p95 框内合理距离范围内的实体
        const marginX = Math.max(pWidth * 0.5, fWidth * 0.01);
        const marginY = Math.max(pHeight * 0.5, fHeight * 0.01);

        finalMinX = Infinity; finalMaxX = -Infinity;
        finalMinY = Infinity; finalMaxY = -Infinity;

        validExtents.forEach(ext => {
            // 如果实体距离核心区域较近，则将其包含在拟合计算中
            if (ext.center.x >= p5X - marginX && ext.center.x <= p95X + marginX &&
                ext.center.y >= p5Y - marginY && ext.center.y <= p95Y + marginY) {
                finalMinX = Math.min(finalMinX, ext.min.x);
                finalMaxX = Math.max(finalMaxX, ext.max.x);
                finalMinY = Math.min(finalMinY, ext.min.y);
                finalMaxY = Math.max(finalMaxY, ext.max.y);
            }
        });

        // 安全机制：如果过滤后没有任何内容，则恢复为完整范围
        if (finalMinX === Infinity) {
            finalMinX = fullMinX; finalMaxX = fullMaxX;
            finalMinY = fullMinY; finalMaxY = fullMaxY;
        }
    }

    const width = finalMaxX - finalMinX;
    const height = finalMaxY - finalMinY;

    return {
        center: { x: finalMinX + width / 2, y: finalMinY + height / 2 },
        width, height,
        min: { x: finalMinX, y: finalMinY },
        max: { x: finalMaxX, y: finalMaxY },
    };
};
