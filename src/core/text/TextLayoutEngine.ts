import { DxfStyle, DxfText, EntityType } from '../../types';
import { TEXT_RENDER_CONFIG } from '../../shared/config/viewerConfig';
import {
  cleanCadText,
  cleanMText,
  estimateCadTextLayout,
  getEffectiveTextHeight,
  getEffectiveTextWidthFactor,
  getCadFontWidthCompensation,
  getMTextCanvasAlignFromEntity,
  getMTextLocalTopOffset,
  getTextGenerationScale,
  getTextHorizontalCanvasAlign,
  getTextVerticalCanvasBaseline,
  splitCadFormattedLines,
  CadFormattedTextLine,
} from '../../features/dxf-viewer/utils/textUtils';
import { resolveCadTextFontProfile } from '../../features/dxf-viewer/services/fontService';

export interface CadTextLayoutInput {
  entity: DxfText;
  styles?: Record<string, DxfStyle>;
  context: CanvasRenderingContext2D;
  worldToScreenScale: number;
  noWrap?: boolean;
}

export interface CadTextLineLayout {
  text: string;
  width: number;
  formatted?: CadFormattedTextLine;
  x: number;
  y: number;
}

export interface CadTextLayoutResult {
  isMText: boolean;
  plainText: string;
  effectiveHeight: number;
  screenHeight: number;
  visualScreenHeight: number;
  widthFactor: number;
  horizontalScale: number;
  generationScale: { x: number; y: number };
  align: CanvasTextAlign;
  baseline: CanvasTextBaseline;
  blockWidth: number;
  blockHeight: number;
  boxLeft: number;
  boxTop: number;
  lineHeight: number;
  lines: CadTextLineLayout[];
}

const getTextHeightCorrectionFactor = (entity: DxfText, styles?: Record<string, DxfStyle>): number => {
  const profile = resolveCadTextFontProfile(entity.styleName, styles, entity.value);
  return profile === 'trueType' || profile === 'cjk'
    ? TEXT_RENDER_CONFIG.trueTypeFontHeightFactor
    : TEXT_RENDER_CONFIG.shxFontHeightFactor;
};

const wrapTextByCanvasWidth = (context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] => {
  if (!text) return [''];
  const result: string[] = [];
  text.split('\n').forEach(sourceLine => {
    if (!sourceLine) {
      result.push('');
      return;
    }
    let current = '';
    for (const char of sourceLine) {
      const test = current + char;
      if (current && context.measureText(test).width > maxWidth) {
        result.push(current);
        current = char;
      } else {
        current = test;
      }
    }
    result.push(current);
  });
  return result;
};

const measureCanvasText = (context: CanvasRenderingContext2D, value: string): number => {
  if (!value) return 0;
  const metrics = context.measureText(value);
  const actual = Math.abs((metrics.actualBoundingBoxRight || 0) - (metrics.actualBoundingBoxLeft || 0));
  return Math.max(metrics.width || 0, actual || 0);
};

export const buildCadTextLayout = ({
  entity,
  styles,
  context,
  worldToScreenScale,
  noWrap = false,
}: CadTextLayoutInput): CadTextLayoutResult | null => {
  const isMText = entity.type === EntityType.MTEXT;
  const plainText = isMText ? cleanMText(entity.value) : cleanCadText(entity.value);
  if (!plainText) return null;

  const effectiveHeight = getEffectiveTextHeight(entity, styles);
  const screenHeight = effectiveHeight * worldToScreenScale;
  const visualScreenHeight = screenHeight * getTextHeightCorrectionFactor(entity, styles);
  const widthFactor = getEffectiveTextWidthFactor(entity, styles);
  const horizontalScale = widthFactor * getCadFontWidthCompensation(entity, styles);
  const generationScale = getTextGenerationScale(entity);

  if (!isMText) {
    const align = getTextHorizontalCanvasAlign(entity.hAlign);
    const baseline = getTextVerticalCanvasBaseline(entity.vAlign, entity.hAlign);
    const measuredWidth = measureCanvasText(context, plainText);
    return {
      isMText,
      plainText,
      effectiveHeight,
      screenHeight,
      visualScreenHeight,
      widthFactor,
      horizontalScale,
      generationScale,
      align,
      baseline,
      blockWidth: measuredWidth,
      blockHeight: visualScreenHeight,
      boxLeft: 0,
      boxTop: 0,
      lineHeight: visualScreenHeight,
      lines: [{ text: plainText, width: measuredWidth, x: 0, y: 0 }],
    };
  }

  const formattedLines = splitCadFormattedLines(entity.value || '');
  const maxWidth = entity.width && entity.width > 0
    ? entity.width * worldToScreenScale / Math.max(TEXT_RENDER_CONFIG.minimumWidthFactor, Math.abs(horizontalScale))
    : 0;
  const useFormattedLines = noWrap || maxWidth <= 0;
  const sourceLines = useFormattedLines
    ? (formattedLines.length > 0 ? formattedLines.map(line => line.plainText) : plainText.split('\n'))
    : wrapTextByCanvasWidth(context, plainText, maxWidth);

  const lineSpacingRaw = (entity as any).lineSpacingFactor;
  const lineSpacingFactor = Number.isFinite(lineSpacingRaw) ? lineSpacingRaw : 1;
  const lineHeight = visualScreenHeight * TEXT_RENDER_CONFIG.mtextDefaultLineSpacingFactor * lineSpacingFactor;
  const lineWidths = sourceLines.map(line => measureCanvasText(context, line));
  const maxLineWidth = Math.max(...lineWidths, 0);

  const declaredWidth = maxWidth > 0 ? maxWidth : 0;
  const actualWidthRaw = Number((entity as any).actualWidth) > 0
    ? Number((entity as any).actualWidth) * worldToScreenScale / Math.max(TEXT_RENDER_CONFIG.minimumWidthFactor, Math.abs(horizontalScale))
    : 0;
  const maxTrustedActualWidth = Math.max(maxLineWidth, declaredWidth, 1) * TEXT_RENDER_CONFIG.mtextActualWidthTrustFactor;
  const actualWidth = actualWidthRaw > 0 && actualWidthRaw <= maxTrustedActualWidth ? actualWidthRaw : 0;

  const estimatedLayout = estimateCadTextLayout(entity, styles);
  const estimatedWidth = estimatedLayout.blockWidth * worldToScreenScale / Math.max(TEXT_RENDER_CONFIG.minimumWidthFactor, Math.abs(horizontalScale));
  const blockWidth = Math.max(maxLineWidth, declaredWidth, actualWidth, estimatedWidth * TEXT_RENDER_CONFIG.mtextLineWidthMeasurePaddingFactor);
  const measuredHeight = sourceLines.length > 0 ? (sourceLines.length - 1) * lineHeight + visualScreenHeight : visualScreenHeight;
  const declaredHeight = Number((entity as any).boxHeight) > 0 ? Number((entity as any).boxHeight) * worldToScreenScale : 0;
  const blockHeight = Math.max(measuredHeight, declaredHeight);

  const attachmentPoint = entity.attachmentPoint || 1;
  const align = getMTextCanvasAlignFromEntity(entity);
  const boxLeft = [2, 5, 8].includes(attachmentPoint) ? -blockWidth / 2 : ([3, 6, 9].includes(attachmentPoint) ? -blockWidth : 0);
  const boxTop = getMTextLocalTopOffset(attachmentPoint, blockHeight);
  const lineX = align === 'center' ? boxLeft + blockWidth / 2 : (align === 'right' ? boxLeft + blockWidth : boxLeft);

  const lines: CadTextLineLayout[] = sourceLines.map((line, index) => ({
    text: line,
    width: lineWidths[index] || 0,
    formatted: useFormattedLines ? formattedLines[index] : undefined,
    x: lineX,
    y: boxTop + index * lineHeight,
  }));

  return {
    isMText,
    plainText,
    effectiveHeight,
    screenHeight,
    visualScreenHeight,
    widthFactor,
    horizontalScale,
    generationScale,
    align,
    baseline: 'top',
    blockWidth,
    blockHeight,
    boxLeft,
    boxTop,
    lineHeight,
    lines,
  };
};
