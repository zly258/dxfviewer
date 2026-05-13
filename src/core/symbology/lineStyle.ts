import { DxfEntity, DxfLayer, DxfLineType } from '../../types';
import { LINE_RENDER_CONFIG } from '../../shared/config/viewerConfig';

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
  dashPattern: number[];
}

const normalizeName = (name?: string): string => (name || '').trim().toUpperCase();

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

export const resolveCadStrokeStyle = (input: CadStrokeStyleInput): CadStrokeStyle => {
  const lineweight = resolveLineweightCode(input.entity, input.layer, input.parentLineweight);
  const lineWidth = toScreenLineWidth(lineweight, input.isSelected);

  const lineTypeName = resolveLineTypeName(input.entity, input.layer, input.parentLineType);
  const lineType = resolveLineType(lineTypeName, input.lineTypes);
  if (!lineType || !lineType.pattern || lineType.pattern.length === 0) {
    return { lineWidth, dashPattern: [] };
  }

  const entityScale = Number.isFinite(input.entity.lineTypeScale || NaN) ? (input.entity.lineTypeScale || 1) : 1;
  const patternScale = Math.abs(input.globalLineTypeScale * entityScale * input.viewScale);
  const totalPatternPixels = (lineType.totalLength || lineType.pattern.reduce((sum, value) => sum + Math.abs(value), 0)) * patternScale;

  if (!Number.isFinite(totalPatternPixels) || totalPatternPixels < LINE_RENDER_CONFIG.minimumDashPatternPixels) {
    return { lineWidth, dashPattern: [] };
  }

  return {
    lineWidth,
    dashPattern: normalizeDashPattern(lineType.pattern, patternScale),
  };
};
