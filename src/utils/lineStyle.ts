import { DxfEntity, DxfLayer, DxfLineType } from '@/types';
import { LINE_RENDER_CONFIG } from '@/config/viewerConfig';

export interface CadStrokeStyleInput {
  entity: DxfEntity;
  layer?: DxfLayer;
  parentLineType?: string;
  parentLineweight?: number;
  lineTypes: Record<string, DxfLineType>;
  globalLineTypeScale: number;
  viewScale: number;
  isSelected: boolean;
}

export interface CadStrokeStyle {
  lineWidth: number;
  /** 虚线各段长度（无符号；Canvas setLineDash / 矢量导出语义，按顺序实-空交替）。 */
  dashPattern: number[];
  /**
   * 带符号的虚线各段长度：正值 = 实线段，负值 = 空白段。
   * WebGL 虚线着色器要自己判开/关（按弧长取模），只有长度而没有符号
   * 会让每一段都判为"实线"——整条线永远显示为实线。
   */
  signedDashPattern: number[];
}

/**
 * 名称规范化缓存：resolveCadStrokeStyle 每实体每帧调用 normalizeName，
 * trim + toUpperCase 的字符串分配在十万级实体下可观。不同名称总量有限
 * （图层/线型名），缓存封顶即可覆盖。
 */
const NORMALIZED_NAME_CACHE_LIMIT = 4096;
const normalizedNameCache = new Map<string, string>();

const normalizeName = (name?: string): string => {
  const raw = name || '';
  const cached = normalizedNameCache.get(raw);
  if (cached !== undefined) return cached;
  const normalized = raw.trim().toUpperCase();
  if (normalizedNameCache.size < NORMALIZED_NAME_CACHE_LIMIT) {
    normalizedNameCache.set(raw, normalized);
  }
  return normalized;
};

const resolveLineweightCode = (entity: DxfEntity, layer?: DxfLayer, parentLineweight?: number): number => {
  let lineweight = entity.lineweight;

  if (lineweight === undefined || lineweight === LINE_RENDER_CONFIG.byLayerLineweight) {
    lineweight = layer?.lineweight;
  }

  if (lineweight === LINE_RENDER_CONFIG.byBlockLineweight) {
    lineweight = parentLineweight;
  }

  if (lineweight === undefined || lineweight === LINE_RENDER_CONFIG.defaultLineweightCode) {
    lineweight = LINE_RENDER_CONFIG.defaultLineweight;
  }

  return lineweight;
};

const resolveLineTypeName = (entity: DxfEntity, layer?: DxfLayer, parentLineType?: string): string => {
  const entityLineType = normalizeName(entity.lineType || 'BYLAYER');

  if (!entityLineType || entityLineType === 'BYLAYER') {
    return normalizeName(layer?.lineType || 'CONTINUOUS');
  }

  if (entityLineType === 'BYBLOCK') {
    return normalizeName(parentLineType || layer?.lineType || 'CONTINUOUS');
  }

  return entityLineType;
};

const resolveLineType = (name: string, lineTypes: Record<string, DxfLineType>): DxfLineType | undefined => {
  if (!name || name === 'CONTINUOUS') return undefined;
  return lineTypes[name] || lineTypes[name.toUpperCase()] || Object.values(lineTypes).find(item => normalizeName(item.name) === name);
};

const toScreenLineWidth = (lineweightCode: number, isSelected: boolean): number => {
  const modelWidth = lineweightCode > 0
    ? lineweightCode / LINE_RENDER_CONFIG.cadLineweightToPixelFactor
    : LINE_RENDER_CONFIG.minimumScreenLineWidth;

  const boostedWidth = isSelected ? modelWidth + LINE_RENDER_CONFIG.selectedLineWidthBoost : modelWidth;
  const maximumWidth = isSelected ? LINE_RENDER_CONFIG.selectedMaximumScreenLineWidth : LINE_RENDER_CONFIG.maximumScreenLineWidth;
  return Math.max(LINE_RENDER_CONFIG.minimumScreenLineWidth, Math.min(boostedWidth, maximumWidth));
};

const normalizeDashPattern = (pattern: number[], scale: number): number[] => {
  const result: number[] = [];

  for (const rawValue of pattern) {
    const absoluteValue = Math.abs(rawValue * scale);
    if (absoluteValue <= 0) {
      result.push(LINE_RENDER_CONFIG.dotDashPixelLength);
    } else {
      result.push(Math.max(LINE_RENDER_CONFIG.minimumDashSegmentPixels, absoluteValue));
    }
  }

  if (result.length % 2 === 1) {
    result.push(...result);
  }

  return result;
};

/**
 * 由无符号段长还原「实-空交替」的带符号段长（首段为实线）。
 *
 * DXF 线型定义本身就是实/空交替（正数为划线、负数为空白），
 * normalizeDashPattern 只保留了长度、丢了符号；奇偶交替是唯一可靠的还原方式，
 * 且 normalizeDashPattern 对奇数段做了整段复制，奇偶性始终正确。
 */
const toSignedDashPattern = (dashPattern: number[]): number[] =>
  dashPattern.map((value, index) => (index % 2 === 0 ? value : -value));

export const resolveCadStrokeStyle = (input: CadStrokeStyleInput): CadStrokeStyle => {
  const lineweight = resolveLineweightCode(input.entity, input.layer, input.parentLineweight);
  const lineWidth = toScreenLineWidth(lineweight, input.isSelected);

  const lineTypeName = resolveLineTypeName(input.entity, input.layer, input.parentLineType);
  const lineType = resolveLineType(lineTypeName, input.lineTypes);
  if (!lineType || !lineType.pattern || lineType.pattern.length === 0) {
    return { lineWidth, dashPattern: [], signedDashPattern: [] };
  }

  const entityScale = Number.isFinite(input.entity.lineTypeScale || NaN) ? (input.entity.lineTypeScale || 1) : 1;
  const patternScale = Math.abs(input.globalLineTypeScale * entityScale * input.viewScale);
  const totalPatternPixels = (lineType.totalLength || lineType.pattern.reduce((sum, value) => sum + Math.abs(value), 0)) * patternScale;

  if (!Number.isFinite(totalPatternPixels) || totalPatternPixels < LINE_RENDER_CONFIG.minimumDashPatternPixels) {
    return { lineWidth, dashPattern: [], signedDashPattern: [] };
  }

  const dashPattern = normalizeDashPattern(lineType.pattern, patternScale);
  return {
    lineWidth,
    dashPattern,
    signedDashPattern: toSignedDashPattern(dashPattern),
  };
};
