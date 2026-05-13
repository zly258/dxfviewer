import { TEXT_RENDER_CONFIG } from '../../../shared/config/viewerConfig';
import { CAD_DEFAULT_TEXT_HEIGHT, CAD_DEFAULT_TEXT_STYLE } from '../../../shared/constants/cadConstants';
import { DxfStyle, DxfText, EntityType, Point2D } from '../../../types';
import { resolveCadTextFontProfile } from '../services/fontService';

const TEMP_BACKSLASH = '\x01';
const TEMP_LEFT_BRACE = '\x02';
const TEMP_RIGHT_BRACE = '\x03';

const decodeUnicodeEscape = (_: string, hex: string) => String.fromCharCode(parseInt(hex, 16));

const isCjk = (char: string) => /[\u2e80-\u9fff\uf900-\ufaff]/.test(char);
const isDigit = (char: string) => /[0-9]/.test(char);
const isLatin = (char: string) => /[A-Za-z]/.test(char);
const isSpace = (char: string) => /\s/.test(char);
const isPunctuation = (char: string) => /[.,;:!?，。；：！？、'"`~^_\-+=|/\\()[\]{}<>《》【】（）]/.test(char);

export function cleanMText(text: string): string {
  if (!text) return '';

  let result = text;
  result = result.replace(/\\\\/g, TEMP_BACKSLASH);
  result = result.replace(/\\\{/g, TEMP_LEFT_BRACE);
  result = result.replace(/\\\}/g, TEMP_RIGHT_BRACE);

  result = result.replace(/\\U\+([0-9A-Fa-f]{4})/g, decodeUnicodeEscape);
  result = result.replace(/%%[cC]/g, 'Ø');
  result = result.replace(/%%[dD]/g, '°');
  result = result.replace(/%%[pP]/g, '±');
  result = result.replace(/\\[Pp]/g, '\n');
  result = result.replace(/\\[Ss]([^;]*)[#^/]([^;]*);/g, '$1/$2');

  result = result.replace(/\\[Ff][^;]*;/g, '');
  result = result.replace(/\\[HhWwTtQqCcAa][^;]*;/g, '');
  result = result.replace(/\\[A-Za-z][^;]*;/g, '');
  result = result.replace(/\\[LlOoKk]/g, '');
  result = result.replace(/\\~/g, ' ');
  result = result.replace(/[{}]/g, '');

  result = result.replace(new RegExp(TEMP_BACKSLASH, 'g'), '\\');
  result = result.replace(new RegExp(TEMP_LEFT_BRACE, 'g'), '{');
  result = result.replace(new RegExp(TEMP_RIGHT_BRACE, 'g'), '}');

  return result.replace(/\r\n?/g, '\n');
}

export function cleanCadText(text: string): string {
  if (!text) return '';
  return cleanMText(text);
}

export function getStyleForText(ent: DxfText, styles?: Record<string, DxfStyle>): DxfStyle | undefined {
  if (!styles) return undefined;
  const styleName = ent.styleName || CAD_DEFAULT_TEXT_STYLE;
  return styles[styleName] || styles[styleName.toUpperCase()];
}

export function getEffectiveTextHeight(ent: DxfText, styles?: Record<string, DxfStyle>): number {
  const style = getStyleForText(ent, styles);
  let height = Number(ent.height) || 0;
  if (height <= 0 && style?.height) height = style.height;
  if (height <= 0) height = CAD_DEFAULT_TEXT_HEIGHT;

  if (ent.type === EntityType.MTEXT) {
    const hMatch = ent.value?.match(/\\[Hh]([^;]+);/);
    if (hMatch?.[1]) {
      const raw = hMatch[1].trim();
      const value = parseFloat(raw);
      if (Number.isFinite(value) && value > 0) {
        height = raw.toLowerCase().endsWith('x') ? height * value : value;
      }
    }
  }

  return height;
}

export function getEffectiveTextWidthFactor(ent: DxfText, styles?: Record<string, DxfStyle>): number {
  const style = getStyleForText(ent, styles);
  let factor = Number(ent.widthFactor) || 0;

  if (ent.type === EntityType.MTEXT) {
    const wMatch = ent.value?.match(/\\[Ww]([^;]+);?/);
    const parsed = wMatch?.[1] ? parseFloat(wMatch[1]) : NaN;
    if (Number.isFinite(parsed) && parsed !== 0) factor = parsed;
  }

  if (!factor) factor = style?.widthFactor || 1;
  if (Math.abs(factor) < TEXT_RENDER_CONFIG.minimumWidthFactor) {
    return factor >= 0 ? TEXT_RENDER_CONFIG.minimumWidthFactor : -TEXT_RENDER_CONFIG.minimumWidthFactor;
  }
  return factor;
}


export function getCadFontWidthCompensation(ent: DxfText, styles?: Record<string, DxfStyle>): number {
  const profile = resolveCadTextFontProfile(ent.styleName, styles, ent.value);
  switch (profile) {
    case 'cjk':
      return TEXT_RENDER_CONFIG.cjkRenderWidthFactor;
    case 'engineeringShx':
      return TEXT_RENDER_CONFIG.engineeringShxRenderWidthFactor;
    case 'shx':
      return TEXT_RENDER_CONFIG.shxRenderWidthFactor;
    case 'trueType':
    default:
      return TEXT_RENDER_CONFIG.trueTypeRenderWidthFactor;
  }
}

export function getCadTextExtentsWidthCompensation(ent: DxfText, styles?: Record<string, DxfStyle>): number {
  const profile = resolveCadTextFontProfile(ent.styleName, styles, ent.value);
  switch (profile) {
    case 'engineeringShx':
      return TEXT_RENDER_CONFIG.extentsEngineeringShxWidthCompensation;
    case 'shx':
      return TEXT_RENDER_CONFIG.extentsShxWidthCompensation;
    case 'cjk':
    case 'trueType':
    default:
      return TEXT_RENDER_CONFIG.extentsTrueTypeWidthCompensation;
  }
}

export function estimateCadLineWidth(line: string, textHeight: number, widthFactor: number): number {
  let units = 0;
  for (const char of line) {
    if (isCjk(char)) units += TEXT_RENDER_CONFIG.cjkCharacterWidthFactor;
    else if (isDigit(char)) units += TEXT_RENDER_CONFIG.digitCharacterWidthFactor;
    else if (isLatin(char)) units += TEXT_RENDER_CONFIG.latinCharacterWidthFactor;
    else if (isSpace(char)) units += TEXT_RENDER_CONFIG.spaceCharacterWidthFactor;
    else if (isPunctuation(char)) units += TEXT_RENDER_CONFIG.punctuationCharacterWidthFactor;
    else units += TEXT_RENDER_CONFIG.averageCharacterWidthFactor;
  }
  const padded = units * (1 + TEXT_RENDER_CONFIG.textWidthPaddingFactor);
  return Math.max(0, padded * textHeight * Math.abs(widthFactor));
}

export function getTextHorizontalCanvasAlign(hAlign?: number): CanvasTextAlign {
  switch (hAlign || 0) {
    case 1:
    case 4:
      return 'center';
    case 2:
      return 'right';
    default:
      return 'left';
  }
}

export function getTextVerticalCanvasBaseline(vAlign?: number, hAlign?: number): CanvasTextBaseline {
  if (hAlign === 4 && !vAlign) return 'middle';
  switch (vAlign || 0) {
    case 1:
      return 'bottom';
    case 2:
      return 'middle';
    case 3:
      return 'top';
    default:
      return 'alphabetic';
  }
}

export function getMTextCanvasAlign(attachmentPoint?: number): CanvasTextAlign {
  const ap = attachmentPoint || 1;
  if ([2, 5, 8].includes(ap)) return 'center';
  if ([3, 6, 9].includes(ap)) return 'right';
  return 'left';
}


export function getInlineMTextParagraphAlign(rawText?: string): CanvasTextAlign | null {
  if (!rawText) return null;
  const paragraphMatch = rawText.match(/\\[Pp][^;]*q([lcrj])/);
  const directMatch = rawText.match(/q([lcrj])/);
  const code = (paragraphMatch?.[1] || directMatch?.[1] || '').toLowerCase();
  if (code === 'c') return 'center';
  if (code === 'r') return 'right';
  if (code === 'l' || code === 'j') return 'left';
  return null;
}

export function getMTextCanvasAlignFromEntity(ent: DxfText): CanvasTextAlign {
  const inlineAlign = getInlineMTextParagraphAlign(ent.value);
  if (inlineAlign) return inlineAlign;
  return getMTextCanvasAlign(ent.attachmentPoint);
}

export function getTextGenerationScale(ent: DxfText): { x: number; y: number } {
  const flags = ent.textGenerationFlags || 0;
  return {
    x: (flags & 2) !== 0 ? -1 : 1,
    y: (flags & 4) !== 0 ? -1 : 1,
  };
}

export function getMTextLocalTopOffset(attachmentPoint: number | undefined, blockHeight: number): number {
  const ap = attachmentPoint || 1;
  if ([4, 5, 6].includes(ap)) return -blockHeight / 2;
  if ([7, 8, 9].includes(ap)) return -blockHeight;
  return 0;
}


export interface CadFormattedTextSegment {
  text: string;
  underline: boolean;
}

export function splitCadFormattedText(rawText: string): CadFormattedTextSegment[] {
  const segments: CadFormattedTextSegment[] = [];
  let underline = false;
  let buffer = '';

  const flush = () => {
    if (!buffer) return;
    segments.push({ text: cleanCadText(buffer), underline });
    buffer = '';
  };

  for (let index = 0; index < rawText.length; index++) {
    const char = rawText[index];
    if (char !== '\\') {
      buffer += char;
      continue;
    }

    const next = rawText[index + 1];
    if (next === 'L' || next === 'l') {
      flush();
      underline = next === 'L';
      index++;
      continue;
    }
    if (next === 'P' || next === 'p') {
      buffer += '\\P';
      index++;
      continue;
    }
    buffer += char;
  }

  flush();
  return segments.length > 0 ? segments.filter(segment => segment.text.length > 0) : [{ text: cleanCadText(rawText), underline: false }];
}


export interface CadFormattedTextLine {
  segments: CadFormattedTextSegment[];
  plainText: string;
}

const flushFormattedBuffer = (lines: CadFormattedTextLine[], segments: CadFormattedTextSegment[], bufferState: { value: string }, underline: boolean) => {
  if (!bufferState.value) return;
  const text = cleanCadText(bufferState.value);
  if (text) segments.push({ text, underline });
  bufferState.value = '';
};

const pushFormattedLine = (lines: CadFormattedTextLine[], segments: CadFormattedTextSegment[]) => {
  const filtered = segments.filter(segment => segment.text.length > 0);
  const plainText = filtered.map(segment => segment.text).join('');
  lines.push({ segments: filtered, plainText });
};

export function splitCadFormattedLines(rawText: string): CadFormattedTextLine[] {
  if (!rawText) return [];

  const lines: CadFormattedTextLine[] = [];
  let segments: CadFormattedTextSegment[] = [];
  const buffer = { value: '' };
  let underline = false;

  const flush = () => flushFormattedBuffer(lines, segments, buffer, underline);
  const newLine = () => {
    flush();
    pushFormattedLine(lines, segments);
    segments = [];
  };

  for (let index = 0; index < rawText.length; index++) {
    const char = rawText[index];
    if (char !== '\\') {
      buffer.value += char;
      continue;
    }

    const next = rawText[index + 1];
    if (next === 'L' || next === 'l') {
      flush();
      underline = next === 'L';
      index++;
      continue;
    }
    if (next === 'P' || next === 'p') {
      index++;
      newLine();
      continue;
    }
    if (next === '~') {
      buffer.value += ' ';
      index++;
      continue;
    }
    if (next === 'U' && rawText[index + 2] === '+') {
      const hex = rawText.slice(index + 3, index + 7);
      if (/^[0-9A-Fa-f]{4}$/.test(hex)) {
        buffer.value += String.fromCharCode(parseInt(hex, 16));
        index += 6;
        continue;
      }
    }
    if (next === 'S' || next === 's') {
      const end = rawText.indexOf(';', index + 2);
      if (end >= 0) {
        const stacked = rawText.slice(index + 2, end).replace(/[#^/]/g, '/');
        buffer.value += stacked;
        index = end;
        continue;
      }
    }
    if ('FfHhWwTtQqCcAa'.includes(next || '')) {
      const end = rawText.indexOf(';', index + 2);
      if (end >= 0) {
        index = end;
        continue;
      }
    }
    buffer.value += char;
  }

  flush();
  pushFormattedLine(lines, segments);
  return lines.filter(line => line.plainText.length > 0);
}

export interface TextLayoutEstimate {
  plainText: string;
  lines: string[];
  textHeight: number;
  widthFactor: number;
  lineHeight: number;
  blockWidth: number;
  blockHeight: number;
}

export function estimateCadTextLayout(ent: DxfText, styles?: Record<string, DxfStyle>): TextLayoutEstimate {
  const plainText = ent.type === EntityType.MTEXT ? cleanMText(ent.value) : cleanCadText(ent.value);
  const sourceLines = plainText ? plainText.split('\n') : [''];
  const textHeight = getEffectiveTextHeight(ent, styles);
  const widthFactor = getEffectiveTextWidthFactor(ent, styles);
  const isMText = ent.type === EntityType.MTEXT;
  const lineSpacingRaw = (ent as any).lineSpacingFactor;
  const lineSpacingFactor = Number.isFinite(lineSpacingRaw) ? lineSpacingRaw : 1;
  const lineHeight = isMText
    ? textHeight * TEXT_RENDER_CONFIG.mtextDefaultLineSpacingFactor * lineSpacingFactor
    : textHeight;

  const wrappedLines: string[] = [];
  if (isMText && ent.width && ent.width > 0) {
    sourceLines.forEach(line => {
      if (!line) {
        wrappedLines.push('');
        return;
      }
      let current = '';
      for (const char of line) {
        const testLine = current + char;
        if (estimateCadLineWidth(testLine, textHeight, widthFactor) * getCadTextExtentsWidthCompensation(ent, styles) > ent.width! && current) {
          wrappedLines.push(current);
          current = char;
        } else {
          current = testLine;
        }
      }
      wrappedLines.push(current);
    });
  } else {
    wrappedLines.push(...sourceLines);
  }

  const widthCompensation = getCadTextExtentsWidthCompensation(ent, styles);
  const lineWidths = wrappedLines.map(line => estimateCadLineWidth(line, textHeight, widthFactor) * widthCompensation);
  const measuredWidth = Math.max(...lineWidths, 0);
  const actualWidth = Number((ent as any).actualWidth) || 0;
  const declaredWidth = isMText && ent.width && ent.width > 0 ? ent.width : 0;
  const blockWidth = declaredWidth > 0
    ? Math.max(declaredWidth, measuredWidth)
    : Math.max(measuredWidth, actualWidth > 0 ? actualWidth : 0);
  const blockHeight = wrappedLines.length > 0
    ? (wrappedLines.length - 1) * lineHeight + textHeight
    : textHeight;

  return {
    plainText,
    lines: wrappedLines,
    textHeight,
    widthFactor,
    lineHeight,
    blockWidth,
    blockHeight,
  };
}

const rotateTranslate = (origin: Point2D, point: Point2D, rotationDegrees: number): Point2D => {
  const rad = rotationDegrees * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: origin.x + point.x * cos - point.y * sin,
    y: origin.y + point.x * sin + point.y * cos,
  };
};

export function getCadTextAnchorPosition(ent: DxfText): Point2D {
  const hAlign = ent.hAlign || 0;
  const vAlign = ent.vAlign || 0;
  if (ent.type !== EntityType.MTEXT && (hAlign !== 0 || vAlign !== 0) && ent.secondPosition && hAlign !== 3 && hAlign !== 5) {
    return ent.secondPosition;
  }
  return ent.position;
}

export function getCadTextLocalCorners(ent: DxfText, layout: TextLayoutEstimate): Point2D[] {
  const isMText = ent.type === EntityType.MTEXT;
  const width = layout.blockWidth;
  const height = layout.blockHeight;
  let ox = 0;
  let oy = 0;

  if (isMText) {
    const ap = ent.attachmentPoint || 1;
    if ([2, 5, 8].includes(ap)) ox = -width / 2;
    else if ([3, 6, 9].includes(ap)) ox = -width;

    if ([1, 2, 3].includes(ap)) oy = 0;
    else if ([4, 5, 6].includes(ap)) oy = height / 2;
    else if ([7, 8, 9].includes(ap)) oy = height;
  } else {
    const hAlign = ent.hAlign || 0;
    const vAlign = ent.vAlign || 0;
    if (hAlign === 1 || hAlign === 4) ox = -width / 2;
    else if (hAlign === 2) ox = -width;

    if (vAlign === 1) oy = 0;
    else if (vAlign === 2 || hAlign === 4) oy = height / 2;
    else if (vAlign === 3) oy = height;
    else oy = layout.textHeight * TEXT_RENDER_CONFIG.alphabeticBaselineOffsetFactor;
  }

  return [
    { x: ox, y: oy },
    { x: ox + width, y: oy },
    { x: ox, y: oy - height },
    { x: ox + width, y: oy - height },
  ];
}

export function getCadTextExtents(ent: DxfText, styles?: Record<string, DxfStyle>): { min: Point2D; max: Point2D } | null {
  const layout = estimateCadTextLayout(ent, styles);
  if (!layout.plainText) return null;

  if ((ent.hAlign === 3 || ent.hAlign === 5) && ent.secondPosition) {
    const halfHeight = layout.textHeight / 2;
    const p1 = ent.position;
    const p2 = ent.secondPosition;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len * halfHeight;
    const ny = dx / len * halfHeight;
    const pts = [
      { x: p1.x + nx, y: p1.y + ny },
      { x: p1.x - nx, y: p1.y - ny },
      { x: p2.x + nx, y: p2.y + ny },
      { x: p2.x - nx, y: p2.y - ny },
    ];
    return pointsToExtents(pts);
  }

  const anchor = getCadTextAnchorPosition(ent);
  const rotation = ent.rotation || 0;
  const corners = getCadTextLocalCorners(ent, layout).map(p => rotateTranslate(anchor, p, rotation));
  return pointsToExtents(corners);
}

export function pointsToExtents(points: Point2D[]): { min: Point2D; max: Point2D } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  points.forEach(point => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  });
  if (minX === Infinity) return null;
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}
