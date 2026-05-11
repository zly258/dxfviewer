const TEMP_BACKSLASH = '\x01';
const TEMP_LEFT_BRACE = '\x02';
const TEMP_RIGHT_BRACE = '\x03';

const decodeUnicodeEscape = (_: string, hex: string) => String.fromCharCode(parseInt(hex, 16));

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

  // 常见内联格式：字体、颜色、高度、宽度、倾斜、跟踪、对齐、段落等。
  result = result.replace(/\\[A-Za-z][^;]*;/g, '');
  result = result.replace(/\\[LlOoKk]/g, '');
  result = result.replace(/\\~/g, ' ');
  result = result.replace(/[{}]/g, '');

  result = result.replace(new RegExp(TEMP_BACKSLASH, 'g'), '\\');
  result = result.replace(new RegExp(TEMP_LEFT_BRACE, 'g'), '{');
  result = result.replace(new RegExp(TEMP_RIGHT_BRACE, 'g'), '}');

  return result.replace(/\r\n?/g, '\n').trim();
}
