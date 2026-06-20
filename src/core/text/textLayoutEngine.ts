import { DxfStyle, DxfText, EntityType } from '@/types';
import { TEXT_RENDER_CONFIG } from '@/config/viewerConfig';
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
} from '@/utils/textUtils';
import { resolveCadTextFontProfile } from '@/renderer/services/fontService';
import { getTextShxFontNames, measureShxTextRunSync } from '@/renderer/services/shxFontService';

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
  align: CanvasTextAlign;
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

const CJK_WRAP_FORBIDDEN_START = new Set('，。；：！？、）】》〉」』”’%,.;:!?)]}');

const clampNumber = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
};

const splitWrapUnits = (sourceLine: string): string[] => {
  const units: string[] = [];
  let latinBuffer = '';
  const flushLatin = () => {
    if (latinBuffer) {
      units.push(latinBuffer);
      latinBuffer = '';
    }
  };

  for (const char of Array.from(sourceLine)) {
    if (/^[A-Za-z0-9_+\-./]+$/.test(char)) {
      latinBuffer += char;
    } else if (char === ' ') {
      latinBuffer += char;
      flushLatin();
    } else {
      flushLatin();
      units.push(char);
    }
  }
  flushLatin();
  return units;
};

const wrapLongUnit = (measureWidth: (value: string) => number, unit: string, maxWidth: number): string[] => {
  const chars = Array.from(unit);
  if (chars.length <= 1 || measureWidth(unit) <= maxWidth) return [unit];
  const result: string[] = [];
  let current = '';
  chars.forEach(char => {
    const test = current + char;
    if (current && measureWidth(test) > maxWidth) {
      result.push(current);
      current = char;
    } else {
      current = test;
    }
  });
  if (current) result.push(current);
  return result;
};

const wrapTextByMeasuredWidth = (measureWidth: (value: string) => number, text: string, maxWidth: number): string[] => {
  if (!text) return [''];
  if (maxWidth <= 0) return text.split('\n');

  const result: string[] = [];
  text.split('\n').forEach(sourceLine => {
    if (!sourceLine) {
      result.push('');
      return;
    }

    let current = '';
    for (const rawUnit of splitWrapUnits(sourceLine)) {
      const units = wrapLongUnit(measureWidth, rawUnit, maxWidth);
      for (const unit of units) {
        const test = current + unit;
        if (current && measureWidth(test) > maxWidth) {
          if (CJK_WRAP_FORBIDDEN_START.has(unit.charAt(0)) && current.length > 1) {
            result.push(current.slice(0, -1));
            current = current.slice(-1) + unit;
          } else {
            result.push(current.trimEnd());
            current = unit.trimStart();
          }
        } else {
          current = test;
        }
      }
    }
    result.push(current.trimEnd());
  });
  return result;
};

const measureCanvasText = (context: CanvasRenderingContext2D, value: string): number => {
  if (!value) return 0;
  const metrics = context.measureText(value);
  const actual = Math.abs((metrics.actualBoundingBoxRight || 0) - (metrics.actualBoundingBoxLeft || 0));
  return Math.max(metrics.width || 0, actual || 0);
};

const getMeasuredTextBoxHeight = (textHeight: number, isMText: boolean): number => {
  return isMText
    ? textHeight
    : textHeight * TEXT_RENDER_CONFIG.mtextMinimumLineHeightFactor;
};

const getMTextLineHeight = (visualScreenHeight: number, lineSpacingFactor: number): number => {
  const rawLineHeight = visualScreenHeight * TEXT_RENDER_CONFIG.mtextDefaultLineSpacingFactor * lineSpacingFactor;
  const minLineHeight = visualScreenHeight * TEXT_RENDER_CONFIG.mtextMinimumLineHeightFactor;
  return Math.max(rawLineHeight, minLineHeight);
};

const measureCadText = (
  context: CanvasRenderingContext2D,
  value: string,
  shxFontNames: string[],
  shxSize: number,
): number => {
  const fallbackWidth = (char: string) => measureCanvasText(context, char);
  const shxMeasure = measureShxTextRunSync(value, shxFontNames, shxSize, fallbackWidth);
  return shxMeasure?.width ?? measureCanvasText(context, value);
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
  const shxFontNames = getTextShxFontNames(entity, styles);
  const measureWidth = (value: string) => measureCadText(context, value, shxFontNames, visualScreenHeight);

  if (!isMText) {
    const align = getTextHorizontalCanvasAlign(entity.hAlign);
    const baseline = getTextVerticalCanvasBaseline(entity.vAlign, entity.hAlign);
    const measuredWidth = measureWidth(plainText);
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
      blockHeight: getMeasuredTextBoxHeight(visualScreenHeight, false),
      boxLeft: 0,
      boxTop: 0,
      lineHeight: getMeasuredTextBoxHeight(visualScreenHeight, false),
      lines: [{ text: plainText, width: measuredWidth, x: 0, y: 0, align }],
    };
  }

  const formattedLines = splitCadFormattedLines(entity.value || '');
  const declaredMTextWidth = entity.width && entity.width > 0 ? entity.width * worldToScreenScale : 0;
  const maxWidth = declaredMTextWidth > 0
    ? declaredMTextWidth / Math.max(TEXT_RENDER_CONFIG.minimumWidthFactor, Math.abs(horizontalScale))
    : 0;
  const useFormattedLines = noWrap || maxWidth <= 0;
  const sourceLines = useFormattedLines
    ? (formattedLines.length > 0 ? formattedLines.map(line => line.plainText) : plainText.split('\n'))
    : wrapTextByMeasuredWidth(measureWidth, plainText, maxWidth * TEXT_RENDER_CONFIG.mtextDeclaredWidthToleranceFactor);

  const lineSpacingRaw = Number((entity as any).lineSpacingFactor);
  const lineSpacingFactor = clampNumber(Number.isFinite(lineSpacingRaw) && lineSpacingRaw > 0 ? lineSpacingRaw : 1, TEXT_RENDER_CONFIG.mtextLineSpacingMinFactor, TEXT_RENDER_CONFIG.mtextLineSpacingMaxFactor);
  const lineHeight = getMTextLineHeight(visualScreenHeight, lineSpacingFactor);
  const lineWidths = sourceLines.map(line => measureWidth(line));
  const maxLineWidth = Math.max(...lineWidths, 0);

  const declaredWidth = maxWidth > 0 ? maxWidth : 0;
  const actualWidthRaw = Number((entity as any).actualWidth) > 0
    ? Number((entity as any).actualWidth) * worldToScreenScale / Math.max(TEXT_RENDER_CONFIG.minimumWidthFactor, Math.abs(horizontalScale))
    : 0;
  const maxTrustedActualWidth = Math.max(maxLineWidth, declaredWidth, 1) * TEXT_RENDER_CONFIG.mtextActualWidthTrustFactor;
  const actualWidth = actualWidthRaw > 0 && actualWidthRaw <= maxTrustedActualWidth ? actualWidthRaw : 0;

  const estimatedLayout = estimateCadTextLayout(entity, styles);
  const estimatedWidth = estimatedLayout.blockWidth * worldToScreenScale / Math.max(TEXT_RENDER_CONFIG.minimumWidthFactor, Math.abs(horizontalScale));
  const measuredWidthWithPadding = maxLineWidth * TEXT_RENDER_CONFIG.mtextLineWidthMeasurePaddingFactor;
  const blockWidth = declaredWidth > 0
    ? declaredWidth
    : Math.max(measuredWidthWithPadding, actualWidth, estimatedWidth * TEXT_RENDER_CONFIG.mtextLineWidthMeasurePaddingFactor);
  const measuredHeight = sourceLines.length > 0 ? (sourceLines.length - 1) * lineHeight + visualScreenHeight : visualScreenHeight;
  const declaredHeight = Number((entity as any).boxHeight) > 0 ? Number((entity as any).boxHeight) * worldToScreenScale : 0;
  const blockHeight = Math.max(measuredHeight, declaredHeight);

  const attachmentPoint = entity.attachmentPoint || 1;
  const align = getMTextCanvasAlignFromEntity(entity);
  const boxLeft = [2, 5, 8].includes(attachmentPoint) ? -blockWidth / 2 : ([3, 6, 9].includes(attachmentPoint) ? -blockWidth : 0);
  const boxTop = getMTextLocalTopOffset(attachmentPoint, blockHeight);
  const getLineX = (lineAlign: CanvasTextAlign) => {
    if (lineAlign === 'center') return boxLeft + blockWidth / 2;
    if (lineAlign === 'right' || lineAlign === 'end') return boxLeft + blockWidth;
    return boxLeft;
  };

  const lines: CadTextLineLayout[] = sourceLines.map((line, index) => {
    const formatted = useFormattedLines ? formattedLines[index] : undefined;
    const lineAlign = formatted?.align || align;
    return {
      text: line,
      width: lineWidths[index] || 0,
      formatted,
      x: getLineX(lineAlign),
      y: boxTop + index * lineHeight,
      align: lineAlign,
    };
  });

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
