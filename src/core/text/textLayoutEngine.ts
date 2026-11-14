import type { VectorContext } from '@/render/vector/context';
import { DxfStyle, DxfText, EntityType } from '@/types';
import { TEXT_RENDER_CONFIG } from '@/config/viewerConfig';
import { measureCadTextRun, measureCadTextVertical } from '@/render/text/canvasTextRun';
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

export interface CadTextLayoutInput {
  entity: DxfText;
  styles?: Record<string, DxfStyle>;
  context: VectorContext;
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
  ascent: number;
  descent: number;
  lines: CadTextLineLayout[];
}

/** 行距不再二次放大。墨迹高度由 getCanvasFont 的 em 换算负责。 */
const getTextHeightCorrectionFactor = (_entity: DxfText, _styles?: Record<string, DxfStyle>): number => {
  // 字号已经在 getCanvasFont 里按中文/西文换成 em。这里再乘 1.14 或 1.39
  // 会把行距和列宽再放大一截，中文块比英文块更高。
  return 1;
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

export const wrapTextByMeasuredWidth = (measureWidth: (value: string) => number, text: string, maxWidth: number): string[] => {
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
        // 纯空格单元：并入当前行占位（CAD 空格是实义占位，不构成断行点；
        // 否则连续空格会产生空行、把后续文字推到远处——实测表头"名      称"
        // 的"称"被 4 个空行顶出视野）。
        if (unit.trim() === '') {
          current += unit;
          continue;
        }
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

const measureCanvasText = (context: VectorContext, value: string): number =>
  measureCadTextRun(context, value);

const measureCanvasTextVerticalMetrics = (
  context: VectorContext,
  sampleText: string,
  fallbackHeight: number,
): { ascent: number; descent: number } => {
  const outline = measureCadTextVertical(context, sampleText || 'Mg');
  if (outline) return outline;

  const metrics = context.measureText(sampleText || 'Mg');
  const measuredAscent = metrics.actualBoundingBoxAscent || metrics.fontBoundingBoxAscent || 0;
  const measuredDescent = metrics.actualBoundingBoxDescent || metrics.fontBoundingBoxDescent || 0;
  const measuredTotal = measuredAscent + measuredDescent;

  if (measuredTotal > 0) {
    const scale = fallbackHeight > 0 ? fallbackHeight / measuredTotal : 1;
    return {
      ascent: measuredAscent * scale,
      descent: measuredDescent * scale,
    };
  }

  return {
    ascent: fallbackHeight * TEXT_RENDER_CONFIG.alphabeticBaselineOffsetFactor,
    descent: fallbackHeight * (1 - TEXT_RENDER_CONFIG.alphabeticBaselineOffsetFactor),
  };
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

const measureCadText = (context: VectorContext, value: string): number => {
  return measureCanvasText(context, value);
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
  const measureWidth = (value: string) => measureCadText(context, value);
  const verticalMetrics = measureCanvasTextVerticalMetrics(context, plainText, visualScreenHeight);

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
      ascent: verticalMetrics.ascent,
      descent: verticalMetrics.descent,
      lines: [{ text: plainText, width: measuredWidth, x: 0, y: 0, align }],
    };
  }

  const formattedLines = splitCadFormattedLines(entity.value || '');
  const declaredMTextWidth = entity.width && entity.width > 0 ? entity.width * worldToScreenScale : 0;
  // 修正 MTEXT 声明宽度折行逻辑：AutoCAD 声明宽度即为内容区域边界。
  // 此前错误地将声明宽度再除以水平因子，导致判定边界偏大，从而过早触发换行。
  const maxWidth = declaredMTextWidth > screenHeight * 0.5 ? declaredMTextWidth : 0;
  const useFormattedLines = noWrap || maxWidth <= 0;
  const sourceLines = useFormattedLines
    ? (formattedLines.length > 0 ? formattedLines.map(line => line.plainText) : plainText.split('\n'))
    : wrapTextByMeasuredWidth(measureWidth, plainText, maxWidth * TEXT_RENDER_CONFIG.mtextDeclaredWidthToleranceFactor);

  const lineSpacingRaw = Number((entity as any).lineSpacingFactor);
  const lineSpacingFactor = clampNumber(Number.isFinite(lineSpacingRaw) && lineSpacingRaw > 0 ? lineSpacingRaw : 1, TEXT_RENDER_CONFIG.mtextLineSpacingMinFactor, TEXT_RENDER_CONFIG.mtextLineSpacingMaxFactor);
  const lineSpacingStyle = Number((entity as any).lineSpacingStyle) || 1;
  // DXF 组码 73 行距样式：1=At Least（行内字符边界高于设定行距时顶开）、
  // 2=Exact（不顶开）。AutoCAD 语义（About Line Spacing Within Multiline
  // Text）：单倍行距 = 1.66×字高；倍数（组码 44）乘在其上。
  // "字符边界高度" = 字体真实 ascent+descent（含音标/下行字母），
  // 用 measureCanvasTextVerticalMetrics 的实测边界（按字高归一）。
  // 行距基准用「CAD 字高」（cap height）而不是 em 换算后的视觉高度：
  // AutoCAD 单倍行距 = 1.66 × 字高，用 em 高度会让行距放大 1.14~1.39 倍
  // （实测多行文字"高度超出/行间距过大"）。
  const baseLineHeight = getMTextLineHeight(screenHeight, lineSpacingFactor);
  const charExtent = verticalMetrics.ascent + verticalMetrics.descent;
  const lineHeight = lineSpacingStyle === 2
    ? baseLineHeight
    : Math.max(baseLineHeight, charExtent);
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
  const measuredHeight = sourceLines.length > 0 ? (sourceLines.length - 1) * lineHeight + screenHeight : screenHeight;
  const declaredHeight = Number((entity as any).boxHeight) > 0 ? Number((entity as any).boxHeight) * worldToScreenScale : 0;
  const blockHeight = Math.max(measuredHeight, declaredHeight);

  const attachmentPoint = entity.attachmentPoint || 1;
  const align = getMTextCanvasAlignFromEntity(entity);
  const boxLeft = [2, 5, 8].includes(attachmentPoint) ? -blockWidth / 2 : ([3, 6, 9].includes(attachmentPoint) ? -blockWidth : 0);
  const boxTop = getMTextLocalTopOffset(attachmentPoint, blockHeight);
  // X 偏移：左附着点从 boxLeft 开始，居中从 boxLeft+blockWidth/2，右对齐从 boxLeft+blockWidth
  // 注意：当无宽度约束时 blockWidth = 最大测量行宽，此时 boxLeft 计算正确
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
    ascent: verticalMetrics.ascent,
    descent: verticalMetrics.descent,
    lines,
  };
};



