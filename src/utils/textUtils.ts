import { TEXT_RENDER_CONFIG } from '@/config/viewerConfig';
import { CAD_DEFAULT_TEXT_HEIGHT, CAD_DEFAULT_TEXT_STYLE } from '@/config/cadConstants';
import { DxfStyle, DxfText, EntityType, Point2D } from '@/types';
import { resolveCadTextFontProfile } from '@/render/text/fontService';

const TEMP_BACKSLASH = '\x01';
const TEMP_LEFT_BRACE = '\x02';
const TEMP_RIGHT_BRACE = '\x03';

const decodeUnicodeEscape = (_: string, hex: string) => String.fromCharCode(parseInt(hex, 16));

/** 上标字符映射表 */
const SUPERSCRIPTS: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
  'n': 'ⁿ', 'i': 'ⁱ',
};

/** 下标字符映射表 */
const SUBSCRIPTS: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
  '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
  'a': 'ₐ', 'e': 'ₑ', 'h': 'ₕ', 'i': 'ᵢ', 'j': 'ⱼ',
  'k': 'ₖ', 'l': 'ₗ', 'm': 'ₘ', 'n': 'ₙ', 'o': 'ₒ',
  'p': 'ₚ', 'r': 'ᵣ', 's': 'ₛ', 't': 'ₜ', 'u': 'ᵤ',
  'v': 'ᵥ', 'x': 'ₓ',
};

/** 带圈数字映射表（土层代号等） */
const CIRCLED_NUMBERS: Record<string, string> = {
  '0': '⓪', '1': '①', '2': '②', '3': '③', '4': '④',
  '5': '⑤', '6': '⑥', '7': '⑦', '8': '⑧', '9': '⑨',
  '10': '⑩', '11': '⑪', '12': '⑫', '13': '⑬', '14': '⑭',
  '15': '⑮', '16': '⑯', '17': '⑰', '18': '⑱', '19': '⑲', '20': '⑳',
};

const toSuperscript = (str: string): string =>
  str.split('').map(ch => SUPERSCRIPTS[ch] || ch).join('');

const toSubscript = (str: string): string =>
  str.split('').map(ch => SUBSCRIPTS[ch] || ch).join('');

const toCircledNumber = (str: string): string => {
  const trimmed = str.trim();
  if (CIRCLED_NUMBERS[trimmed]) return CIRCLED_NUMBERS[trimmed];
  return trimmed.split('').map(ch => CIRCLED_NUMBERS[ch] || ch).join('');
};

/**
 * 解码 AutoCAD 与探索者 (TSSD) 专用特殊转义码：
 * - %%c/%%d/%%p: 常用直径、度数、正负号
 * - %%130~%%138: 结构各级钢筋等级符号（一级钢~四级钢等）
 * - %%140...%%141: 上标开/关（如 kN/m%%1402%%141 -> kN/m²）
 * - %%142...%%143: 下标开/关（如 L%%142aE%%143 -> LₐE）
 * - %%144/%%145: 标题加重或下划线开关（如 %%144说明：-> 说明：，彻底清除 0x90 乱码控制符）
 * - %%146...%%147: 带圈数字（土层代号，如 %%1462%%147 -> ②）
 * - %%148...%%149, %%150...%%151: 轴号定位符号
 */
export function decodeCadSpecialCodes(text: string): string {
  if (!text) return '';
  let res = text;

  // 1. 上标：%%140...%%141
  res = res.replace(/%%140([\s\S]*?)%%141/g, (_, content) => toSuperscript(content));
  res = res.replace(/%%14[01]/g, '');

  // 2. 下标：%%142...%%143
  res = res.replace(/%%142([\s\S]*?)%%143/g, (_, content) => toSubscript(content));
  res = res.replace(/%%14[23]/g, '');

  // 3. 带圈数字：%%146...%%147
  res = res.replace(/%%146([\s\S]*?)%%147/g, (_, content) => toCircledNumber(content));
  res = res.replace(/%%14[67]/g, '');

  // 4. 轴号圆圈/定位符：%%148...%%149, %%150...%%151
  res = res.replace(/%%148([\s\S]*?)%%149/g, (_, content) => `(${content})`);
  res = res.replace(/%%150([\s\S]*?)%%151/g, (_, content) => `(${content})`);
  res = res.replace(/%%(148|149|150|151)/g, '');

  // 5. 钢筋级别符号（TSSD 国标标准映射）
  res = res.replace(/%%130/g, 'Ø');       // 一级钢筋 HPB300
  res = res.replace(/%%131/g, 'Φ');       // 二级钢筋 HRB335
  res = res.replace(/%%132/g, 'Φ');       // 三级钢筋 HRB400
  res = res.replace(/%%133/g, 'Φ');       // 四级钢筋 HRB500
  res = res.replace(/%%134/g, 'Φ');
  res = res.replace(/%%135/g, 'Φ');
  res = res.replace(/%%136/g, 'Φ');
  res = res.replace(/%%137/g, 'Φ');
  res = res.replace(/%%138/g, 'Φ');

  // 6. %%144, %%145 (说明大标题强调符、下划线开关码，去除以避免 0x90 乱码)
  res = res.replace(/%%144/g, '');
  res = res.replace(/%%145/g, '');

  // 7. AutoCAD 标准转义码
  res = res.replace(/%%[cC]/g, 'Ø');
  res = res.replace(/%%[dD]/g, '°');
  res = res.replace(/%%[pP]/g, '±');
  res = res.replace(/%%%/g, '%');
  res = res.replace(/%%[uUoO]/g, '');

  return res;
}

const isCjk = (char: string) => /[\u2e80-\u9fff\uf900-\ufaff]/.test(char);
const isDigit = (char: string) => /[0-9]/.test(char);
const isLatin = (char: string) => /[A-Za-z]/.test(char);
const isSpace = (char: string) => /\s/.test(char);
const isPunctuation = (char: string) => /[.,;:!?，。；：！？、'"`~^_\-+=|/\\()[\]{}<>《》【】（）]/.test(char);

export function cleanMText(text: string): string {
  if (!text) return '';

  let result = text;
  result = result.replace(/\\\\/g, TEMP_BACKSLASH);
  result = result.replace(/\\\\\{/g, TEMP_LEFT_BRACE);
  result = result.replace(/\\\\\}/g, TEMP_RIGHT_BRACE);

  // 多行文字常用转义符。段落属性 \p...; 只移除格式，不作为换行；段落换行 \P 才转为换行。
  result = result.replace(/\\U\\+([0-9A-Fa-f]{4})/g, decodeUnicodeEscape);
  // 标准 \U+XXXX 转义（单反斜杠形式，CJK 图纸中最常见的特殊字符写法）
  result = result.replace(/\\U\+([0-9A-Fa-f]{4})/g, decodeUnicodeEscape);

  // 统一解码工程特种符号（TSSD / AutoCAD 特殊码：%%144说明、%%130钢筋、%%140上标、%%142下标等）
  result = decodeCadSpecialCodes(result);
  result = result.replace(/%%([0-9]{1,3})/g, (_, code) => {
    const num = parseInt(code, 10);
    // 过滤掉不可见的 C0/C1 控制字符（0-31, 128-159），避免污染排版与字形库
    if ((num >= 0 && num <= 31) || (num >= 127 && num <= 159)) return '';
    return String.fromCharCode(num);
  });
  result = result.replace(/\\P/g, '\n');
  result = result.replace(/\\[Xx]/g, '\n');
  result = result.replace(/\\p[^;]*;/g, '');
  result = result.replace(/\\[Ss]([^;]*)[#^/]([^;]*);/g, '$1/$2');

  result = result.replace(/\\[Ff][^;]*;/g, '');
  result = result.replace(/\\[HhWwTtQqCcAa][^;]*;/g, '');
  result = result.replace(/\\[A-Za-z][^;]*;/g, '');
  result = result.replace(/\\[LlOoKk]/g, '');
  result = result.replace(/\\~/g, ' ');
  result = result.replace(/[{}]/g, '');

  result = result.replace(new RegExp(TEMP_BACKSLASH, 'g'), '\\\\');
  result = result.replace(new RegExp(TEMP_LEFT_BRACE, 'g'), '{');
  result = result.replace(new RegExp(TEMP_RIGHT_BRACE, 'g'), '}');

  return result.replace(/\\r\\n?/g, '\n');
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
  const absFactor = Math.abs(factor);
  if (absFactor < TEXT_RENDER_CONFIG.minimumWidthFactor) {
    return factor >= 0 ? TEXT_RENDER_CONFIG.minimumWidthFactor : -TEXT_RENDER_CONFIG.minimumWidthFactor;
  }
  // 上限钳制：防止损坏的 DXF 数据中宽度系数过大导致水平拉伸失控。
  const maxFactor = TEXT_RENDER_CONFIG.maximumWidthFactor ?? 100;
  if (absFactor > maxFactor) {
    return factor >= 0 ? maxFactor : -maxFactor;
  }
  return factor;
}


export function getCadFontWidthCompensation(_ent: DxfText, _styles?: Record<string, DxfStyle>): number {
  // 横向只使用图纸自己的宽度因子。再按“中文样式 ×0.88、形文件 ×1”分档，
  // 同一字高会宽窄不一。
  return 1;
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
  const paragraphMatch = rawText.match(/\\[Pp][^;]*q([lcrj])/i);
  const code = (paragraphMatch?.[1] || '').toLowerCase();
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
  bold?: boolean;
  italic?: boolean;
  color?: number;
}

export function splitCadFormattedText(rawText: string): CadFormattedTextSegment[] {
  const decodedText = decodeCadSpecialCodes(rawText);
  const segments: CadFormattedTextSegment[] = [];
  let underline = false;
  let buffer = '';

  const flush = () => {
    if (!buffer) return;
    segments.push({ text: cleanCadText(buffer), underline });
    buffer = '';
  };

  for (let index = 0; index < decodedText.length; index++) {
    const char = decodedText[index];
    // 单行文字 %% 特殊码：%%u 下划线开关、%%o 上划线（去除）、%%% 百分号、%%nnn ASCII 字符
    if (char === '%' && decodedText[index + 1] === '%') {
      const third = decodedText[index + 2];
      if (third === 'u' || third === 'U') {
        flush();
        underline = !underline;
        index += 2;
        continue;
      }
      if (third === 'o' || third === 'O') {
        // 上划线暂不支持渲染，去除开关码
        index += 2;
        continue;
      }
      if (third === '%') {
        buffer += '%';
        index += 2;
        continue;
      }
      if (third && third >= '0' && third <= '9') {
        // %%nnn：最多读取 3 位数字（AutoCAD 语义，%%65 → A）
        let code = third;
        let j = index + 3;
        while (j < decodedText.length && code.length < 3 && decodedText[j] >= '0' && decodedText[j] <= '9') {
          code += decodedText[j];
          j++;
        }
        const num = parseInt(code, 10);
        if (num > 31 && (num < 127 || num > 159)) {
          buffer += String.fromCharCode(num);
        }
        index = j - 1;
        continue;
      }
      buffer += '%%';
      index += 1;
      continue;
    }
    if (char !== '\\') {
      buffer += char;
      continue;
    }

    const next = decodedText[index + 1];
    if (next === 'U' && decodedText[index + 2] === '+') {
      const hex = decodedText.slice(index + 3, index + 7);
      if (/^[0-9A-Fa-f]{4}$/.test(hex)) {
        buffer += String.fromCharCode(parseInt(hex, 16));
        // 转义序列 `\U+XXXX` 共 7 个字符（\ U + 四位十六进制，下标 index..index+6）。
        // 这里把 index 停在最后一个已消费字符（+6），再由 for 的 index++ 前进到下一个字符。
        // 旧值 +7 会跳过一个字符：连续转义（中文文本几乎总是 `\U+6280\U+672F...`）
        // 会漏掉一半字形并残留字面量 "U+XXXX" 与丢字（实测「160」渲染成「60」）。
        index += 6;
        continue;
      }
    }
    if (next === 'L' || next === 'l') {
      flush();
      underline = next === 'L';
      index++;
      continue;
    }
    if (next === 'P') {
      buffer += '\\P';
      index++;
      continue;
    }
    if (next === 'p') {
      const end = decodedText.indexOf(';', index + 2);
      index = end >= 0 ? end : index + 1;
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
  align?: CanvasTextAlign;
}

const flushFormattedBuffer = (segments: CadFormattedTextSegment[], bufferState: { value: string }, underline: boolean) => {
  if (!bufferState.value) return;
  const text = cleanCadText(bufferState.value);
  if (text) segments.push({ text, underline });
  bufferState.value = '';
};

const pushFormattedLine = (lines: CadFormattedTextLine[], segments: CadFormattedTextSegment[], align?: CanvasTextAlign) => {
  const filtered = segments.filter(segment => segment.text.length > 0);
  const plainText = filtered.map(segment => segment.text).join('');
  lines.push({ segments: filtered, plainText, align });
};

export function splitCadFormattedLines(rawText: string): CadFormattedTextLine[] {
  if (!rawText) return [];
  const decodedText = decodeCadSpecialCodes(rawText);

  const lines: CadFormattedTextLine[] = [];
  let segments: CadFormattedTextSegment[] = [];
  const buffer = { value: '' };
  let underline = false;
  let currentAlign: CanvasTextAlign | undefined = getInlineMTextParagraphAlign(decodedText) || undefined;

  const flush = () => flushFormattedBuffer(segments, buffer, underline);
  const newLine = () => {
    flush();
    pushFormattedLine(lines, segments, currentAlign);
    segments = [];
  };
  const readUntilSemicolon = (startIndex: number): { content: string; endIndex: number } | null => {
    const end = decodedText.indexOf(';', startIndex);
    if (end < 0) return null;
    return { content: decodedText.slice(startIndex, end), endIndex: end };
  };
  const applyParagraphProperty = (content: string) => {
    const match = content.match(/q([lcrj])/i);
    if (!match) return;
    const code = match[1].toLowerCase();
    currentAlign = code === 'c' ? 'center' : code === 'r' ? 'right' : 'left';
  };

  for (let index = 0; index < decodedText.length; index++) {
    const char = decodedText[index];
    // 单行 %% 特殊码在 MTEXT 中同样可能出现（legacy 内容）：%%u 开关、%%% 百分号、%%nnn ASCII
    if (char === '%' && decodedText[index + 1] === '%') {
      const third = decodedText[index + 2];
      if (third === 'u' || third === 'U') {
        flush();
        underline = !underline;
        index += 2;
        continue;
      }
      if (third === 'o' || third === 'O') {
        index += 2;
        continue;
      }
      if (third === '%') {
        buffer.value += '%';
        index += 2;
        continue;
      }
      if (third && third >= '0' && third <= '9') {
        // %%nnn：最多读取 3 位数字（AutoCAD 语义，%%65 → A）
        let code = third;
        let j = index + 3;
        while (j < decodedText.length && code.length < 3 && decodedText[j] >= '0' && decodedText[j] <= '9') {
          code += decodedText[j];
          j++;
        }
        const num = parseInt(code, 10);
        if (num > 31 && (num < 127 || num > 159)) {
          buffer.value += String.fromCharCode(num);
        }
        index = j - 1;
        continue;
      }
      buffer.value += '%%';
      index += 1;
      continue;
    }
    if (char !== '\\') {
      buffer.value += char;
      continue;
    }

    const next = decodedText[index + 1];
    if (next === 'L' || next === 'l') {
      flush();
      underline = next === 'L';
      index++;
      continue;
    }
    if (next === 'O' || next === 'o' || next === 'K' || next === 'k') {
      index++;
      continue;
    }
    if (next === 'P') {
      index++;
      newLine();
      continue;
    }
    if (next === 'p') {
      const paragraph = readUntilSemicolon(index + 2);
      if (paragraph) {
        applyParagraphProperty(paragraph.content);
        index = paragraph.endIndex;
      } else {
        index++;
      }
      continue;
    }
    if (next === 'X' || next === 'x') {
      index++;
      newLine();
      continue;
    }
    if (next === '~') {
      buffer.value += ' ';
      index++;
      continue;
    }
    if (next === 'U' && decodedText[index + 2] === '+') {
      const hex = decodedText.slice(index + 3, index + 7);
      if (/^[0-9A-Fa-f]{4}$/.test(hex)) {
        buffer.value += String.fromCharCode(parseInt(hex, 16));
        index += 6;
        continue;
      }
    }
    if (next === 'S' || next === 's') {
      const stacked = readUntilSemicolon(index + 2);
      if (stacked) {
        buffer.value += stacked.content.replace(/[#^/]/g, '/');
        index = stacked.endIndex;
        continue;
      }
    }
    if ('FfHhWwTtQqCcAa'.includes(next || '')) {
      const format = readUntilSemicolon(index + 2);
      if (format) {
        index = format.endIndex;
        continue;
      }
      index++;
      continue;
    }
    if (next === '{' || next === '}') {
      buffer.value += next;
      index++;
      continue;
    }
    buffer.value += char;
  }

  flush();
  pushFormattedLine(lines, segments, currentAlign);
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
  if (isMText && ent.width && ent.width > textHeight * 0.5) {
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
  const measuredBlockHeight = wrappedLines.length > 0
    ? (wrappedLines.length - 1) * lineHeight + textHeight
    : textHeight;
  const declaredBlockHeight = isMText && Number(ent.boxHeight) > 0 ? Number(ent.boxHeight) : 0;
  const blockHeight = Math.max(measuredBlockHeight, declaredBlockHeight);

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
    // DXF 规范：对齐方式不是"左/基线"时，第二对齐点 (11,21) 是唯一定位点，
    // 两个轴都取它。第一对齐点 (10,20) 是创建期的陈旧值——第三方导出器常
    // 不同步（实测图纸中旋转 270° 的居中文字两点相差半个文字长度）。
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
    // 居中的垂直偏移按「字高」的一半（与绘制端 getCadSingleLineBaselineY 一致）。
    else if (vAlign === 2 || hAlign === 4) oy = layout.textHeight / 2;
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

