/**
 * @license GPL-3.0
 * threejs-dxf-loader - Shared utilities: growable float buffer, ACI palette, sRGB/linear colour management, CAD font mapping, DXF encoding detection.
 */
class Float32GrowableBuffer {
  constructor(initialCapacity = 8192) {
    this.data = new Float32Array(initialCapacity);
    this.length = 0;
  }

  ensure(additional) {
    const needed = this.length + additional;
    if (needed <= this.data.length) return;
    let newCap = this.data.length * 2;
    while (newCap < needed) newCap *= 2;
    const next = new Float32Array(newCap);
    next.set(this.data.subarray(0, this.length));
    this.data = next;
  }

  push3(a, b, c) {
    if (this.length + 3 > this.data.length) this.ensure(3);
    const d = this.data;
    let l = this.length;
    d[l] = a; d[l + 1] = b; d[l + 2] = c;
    this.length = l + 3;
  }

  push6(a, b, c, d, e, f) {
    if (this.length + 6 > this.data.length) this.ensure(6);
    const arr = this.data;
    let l = this.length;
    arr[l] = a; arr[l + 1] = b; arr[l + 2] = c;
    arr[l + 3] = d; arr[l + 4] = e; arr[l + 5] = f;
    this.length = l + 6;
  }

  push9(a, b, c, d, e, f, g, h, i) {
    if (this.length + 9 > this.data.length) this.ensure(9);
    const arr = this.data;
    let l = this.length;
    arr[l] = a; arr[l + 1] = b; arr[l + 2] = c;
    arr[l + 3] = d; arr[l + 4] = e; arr[l + 5] = f;
    arr[l + 6] = g; arr[l + 7] = h; arr[l + 8] = i;
    this.length = l + 9;
  }

  pushRGBRepeat(r, g, b, count) {
    const add = count * 3;
    if (this.length + add > this.data.length) this.ensure(add);
    const arr = this.data;
    let l = this.length;
    for (let i = 0; i < count; i++) {
      arr[l] = r; arr[l + 1] = g; arr[l + 2] = b;
      l += 3;
    }
    this.length = l;
  }

  toTypedArray() {
    return this.data.subarray(0, this.length);
  }
}

// ============================================================================
// 2. AutoCAD Color Index (ACI 0-255) & High-Contrast Light-Background Adapter
// ============================================================================
const ACI_PALETTE = [
  0x000000, 0xFF0000, 0xFFFF00, 0x00FF00, 0x00FFFF, 0x0000FF, 0xFF00FF, 0xFFFFFF, 0x808080, 0xC0C0C0,
  0xFF0000, 0xFF7F7F, 0xCC0000, 0xCC6666, 0x990000, 0x994C4C, 0x7F0000, 0x7F3F3F, 0x4C0000, 0x4C2626,
  0xFF3F00, 0xFF9F7F, 0xCC3300, 0xCC7F66, 0x992600, 0x995F4C, 0x7F1F00, 0x7F4F3F, 0x4C1300, 0x4C2F26,
  0xFF7F00, 0xFFBF7F, 0xCC6600, 0xCC9966, 0x994C00, 0x99724C, 0x7F3F00, 0x7F5F3F, 0x4C2600, 0x4C3926,
  0xFFBF00, 0xFFDF7F, 0xCC9900, 0xCCB266, 0x997200, 0x99854C, 0x7F5F00, 0x7F6F3F, 0x4C3900, 0x4C4226,
  0xFFFF00, 0xFFFF7F, 0xCCCC00, 0xCCCC66, 0x999900, 0x99994C, 0x7F7F00, 0x7F7F3F, 0x4C4C00, 0x4C4C26,
  0xBFFF00, 0xDFFF7F, 0x99CC00, 0xB2CC66, 0x729900, 0x85994C, 0x5F7F00, 0x6F7F3F, 0x394C00, 0x424C26,
  0x7FFF00, 0xBFFF7F, 0x66CC00, 0x99CC66, 0x4C9900, 0x72994C, 0x3F7F00, 0x5F7F3F, 0x264C00, 0x394C26,
  0x3FFF00, 0x9FFF7F, 0x33CC00, 0x7FCC66, 0x269900, 0x5F994C, 0x1F7F00, 0x4F7F3F, 0x134C00, 0x2F4C26,
  0x00FF00, 0x7FFF7F, 0x00CC00, 0x66CC66, 0x009900, 0x4C994C, 0x007F00, 0x3F7F3F, 0x004C00, 0x264C26,
  0x00FF3F, 0x7FFF9F, 0x00CC33, 0x66CC7F, 0x009926, 0x4C995F, 0x007F1F, 0x3F7F4F, 0x004C13, 0x264C2F,
  0x00FF7F, 0x7FFFBF, 0x00CC66, 0x66CC99, 0x00994C, 0x4C9972, 0x007F3F, 0x3F7F5F, 0x004C26, 0x264C39,
  0x00FFBF, 0x7FFFDF, 0x00CC99, 0x66CCB2, 0x009972, 0x4C9985, 0x007F5F, 0x3F7F6F, 0x004C39, 0x264C42,
  0x00FFFF, 0x7FFFFF, 0x00CCCC, 0x66CCCC, 0x009999, 0x4C9999, 0x007F7F, 0x3F7F7F, 0x004C4C, 0x264C4C,
  0x00BFFF, 0x7FDFFF, 0x0099CC, 0x66B2CC, 0x007299, 0x4C8599, 0x005F7F, 0x3F6F7F, 0x00394C, 0x26424C,
  0x007FFF, 0x7FBFFF, 0x0066CC, 0x6699CC, 0x004C99, 0x4C7299, 0x003F7F, 0x3F5F7F, 0x00264C, 0x26394C,
  0x003FFF, 0x7F9FFF, 0x0033CC, 0x667FCC, 0x002699, 0x4C5F99, 0x001F7F, 0x3F4F7F, 0x00134C, 0x262F4C,
  0x0000FF, 0x7F7FFF, 0x0000CC, 0x6666CC, 0x000099, 0x4C4C99, 0x00007F, 0x3F3F7F, 0x00004C, 0x26264C,
  0x3F00FF, 0x9F7FFF, 0x3300CC, 0x7F66CC, 0x260099, 0x5F4C99, 0x1F007F, 0x4F3F7F, 0x13004C, 0x2F264C,
  0x7F00FF, 0xBF7FFF, 0x6600CC, 0x9966CC, 0x4C0099, 0x724C99, 0x3F007F, 0x5F3F7F, 0x26004C, 0x39264C,
  0xBF00FF, 0xDF7FFF, 0x9900CC, 0xB266CC, 0x720099, 0x854C99, 0x5F007F, 0x6F3F7F, 0x39004C, 0x42264C,
  0xFF00FF, 0xFF7FFF, 0xCC00CC, 0xCC66CC, 0x990099, 0x994C99, 0x7F007F, 0x7F3F7F, 0x4C004C, 0x4C264C,
  0xFF00BF, 0xFF7FDF, 0xCC0099, 0xCC66B2, 0x990072, 0x994C85, 0x7F005F, 0x7F3F6F, 0x4C0039, 0x4C2642,
  0xFF007F, 0xFF7FBF, 0xCC0066, 0xCC6699, 0x99004C, 0x994C72, 0x7F003F, 0x7F3F5F, 0x4C0026, 0x4C2639,
  0xFF003F, 0xFF7F9F, 0xCC0033, 0xCC667F, 0x990026, 0x994C5F, 0x7F001F, 0x7F3F4F, 0x4C0013, 0x4C262F,
  0x333333, 0x505050, 0x696969, 0x828282, 0xBEBEBE, 0xFFFFFF
];

/**
 * Adapts any raw CAD hex color so it has crisp, unmistakable contrast on a white background (`#FFFFFF`).
 * Specifically transforms bright Yellow (#FFFF00 -> #B45309), Cyan (#00FFFF -> #0284C7),
 * Lime Green (#00FF00 -> #15803D), White (#FFFFFF -> #0F172A), and clamps pale colors.
 */
/**
 * Convert an sRGB colour byte to the linear-sRGB working space.
 *
 * three.js interprets `BufferAttribute` colours as **Linear-sRGB** (the
 * renderer's working colour space), while CAD/ACI colours are authored in
 * sRGB. Writing the raw sRGB byte values into the colour attribute makes
 * every mid-tone render one step too bright (e.g. #808080 shows up as
 * ~#BCBCBC). Converting here keeps the colours identical to AutoCAD.
 */
function srgbByteToLinear(byte) {
  const s = byte / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** Pack an sRGB hex colour into linear-sRGB components for a vertex colour. */
const _linearRgbCache = new Map();
function hexToLinearRgb(hex) {
  const hit = _linearRgbCache.get(hex);
  if (hit !== undefined) return hit;
  const value = {
    r: srgbByteToLinear((hex >> 16) & 255),
    g: srgbByteToLinear((hex >> 8) & 255),
    b: srgbByteToLinear(hex & 255)
  };
  // A drawing has few distinct colours, so this cache stays tiny and turns a
  // per-primitive conversion (called millions of times on big drawings) into a
  // hash lookup.
  if (_linearRgbCache.size < 8192) _linearRgbCache.set(hex, value);
  return value;
}

const _lightAdaptCache = new Map();
function adaptHexForLightBackground(hex) {
  const hit = _lightAdaptCache.get(hex);
  if (hit !== undefined) return hit;
  const value = adaptHexForLightBackgroundUncached(hex);
  if (_lightAdaptCache.size < 16384) _lightAdaptCache.set(hex, value);
  return value;
}

function adaptHexForLightBackgroundUncached(hex) {
  if (hex === 0xFFFFFF || hex === 0xF8FAFC || hex === 0xFEFEFE) return 0x0F172A;
  if (hex === 0xFFFF00 || hex === 0xFFFF7F) return 0xB45309;
  if (hex === 0x00FFFF || hex === 0x7FFFFF) return 0x0284C7;
  if (hex === 0x00FF00 || hex === 0x7FFF00 || hex === 0x7FFF7F) return 0x15803D;
  if (hex === 0xC0C0C0 || hex === 0xBEBEBE) return 0x475569;

  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  if (lum > 0.88 && Math.max(r, g, b) - Math.min(r, g, b) < 0.15) return 0x0F172A;
  if (lum > 0.60) {
    const scale = 0.42 / Math.max(0.01, lum);
    const nr = Math.min(255, Math.round(r * scale * 255));
    const ng = Math.min(255, Math.round(g * scale * 255));
    const nb = Math.min(255, Math.round(b * scale * 255));
    return (nr << 16) | (ng << 8) | nb;
  }
  return hex;
}

const _darkAdaptCache = new Map();
function adaptHexForDarkBackground(hex) {
  const hit = _darkAdaptCache.get(hex);
  if (hit !== undefined) return hit;
  const value = adaptHexForDarkBackgroundUncached(hex);
  if (_darkAdaptCache.size < 16384) _darkAdaptCache.set(hex, value);
  return value;
}

function adaptHexForDarkBackgroundUncached(hex) {
  if (hex === 0x000000 || hex === 0x0F172A || hex === 0x1E293B || hex === 0x333333) return 0xF8FAFC;
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  if (lum < 0.08) return 0xF8FAFC;
  if (lum < 0.28) {
    const boost = 0.62 / Math.max(0.05, lum);
    const nr = Math.min(255, Math.round(Math.min(1, r * boost + 0.18) * 255));
    const ng = Math.min(255, Math.round(Math.min(1, g * boost + 0.18) * 255));
    const nb = Math.min(255, Math.round(Math.min(1, b * boost + 0.18) * 255));
    return (nr << 16) | (ng << 8) | nb;
  }
  return hex;
}

// ============================================================================
// 3. CAD Font Name -> Closest System Font Stack Mapper
// ============================================================================
const DEFAULT_CAD_FONT_STACK = '"SimSun", "NSimSun", "Songti SC", "STSong", "Arial", sans-serif';

function mapCADFontToSystemFont(fontName, bigFontName, defaultStack) {
  const fallback = defaultStack || DEFAULT_CAD_FONT_STACK;
  const combined = `${fontName || ''} ${bigFontName || ''}`.toLowerCase();
  if (!combined.trim()) return fallback;

  if (combined.includes('fangsong') || combined.includes('仿宋') || combined.includes('fsdb')) {
    return '"FangSong", "FangSong_GB2312", "STFangsong", "SimSun", "Arial", serif';
  }
  if (combined.includes('kaiti') || combined.includes('楷体') || combined.includes('stkai')) {
    return '"KaiTi", "KaiTi_GB2312", "STKaiti", "SimSun", "Arial", serif';
  }
  if (combined.includes('simhei') || combined.includes('黑体')) {
    return '"SimHei", "Microsoft YaHei", "SimSun", "Arial", sans-serif';
  }
  if (combined.includes('yahei') || combined.includes('雅黑')) {
    return '"Microsoft YaHei", "SimSun", "Arial", sans-serif';
  }
  if (combined.includes('arial') || combined.includes('helvetica') || combined.includes('isocp') || combined.includes('simplex') || combined.includes('txt')) {
    return '"Arial", "SimSun", "NSimSun", "Songti SC", sans-serif';
  }
  if (
    combined.includes('simsun') || combined.includes('宋体') || combined.includes('song') ||
    combined.includes('romans') || combined.includes('gbenor') || combined.includes('gbcbig') ||
    combined.includes('hztxt') || combined.includes('tssd')
  ) {
    return DEFAULT_CAD_FONT_STACK;
  }
  return DEFAULT_CAD_FONT_STACK;
}

const _normKeyCache = new Map();
function normKey(str, fallback = '0') {
  if (str === undefined || str === null) return fallback;
  if (typeof str === 'string') {
    const hit = _normKeyCache.get(str);
    if (hit !== undefined) return hit;
    const s = str.trim();
    const value = s === '' ? fallback : s.toUpperCase();
    // Layer names and handles repeat heavily across a drawing; caching keeps
    // per-entity normalisation allocation-free in the common case.
    if (_normKeyCache.size < 65536) _normKeyCache.set(str, value);
    return value;
  }
  const s = String(str).trim();
  return s === '' ? fallback : s.toUpperCase();
}

// ============================================================================
// 4. Auto-Detect Encoding & Decode \M+nXXXX MIF Escapes
// ============================================================================
function decodeDXFArrayBuffer(buffer) {
  if (typeof buffer === 'string') return { text: buffer, encoding: 'UTF-8' };
  const bytes = new Uint8Array(buffer);
  if (bytes.length > 22) {
    const head = String.fromCharCode(...bytes.slice(0, 18));
    if (head === 'AutoCAD Binary DXF') {
      return { text: '', encoding: 'BINARY_DXF', isBinary: true };
    }
  }
  if (typeof TextDecoder !== 'undefined') {
    try {
      const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
      const text = utf8Decoder.decode(bytes);
      return { text, encoding: 'UTF-8' };
    } catch (_) {
      try {
        const gbkDecoder = new TextDecoder('gb18030');
        const text = gbkDecoder.decode(bytes);
        return { text, encoding: 'GB18030 / GBK' };
      } catch (_2) {
        const fallback = new TextDecoder('utf-8');
        return { text: fallback.decode(bytes), encoding: 'UTF-8' };
      }
    }
  }
  return { text: '', encoding: 'UNKNOWN' };
}

function decodeMIFAndSpecialChars(str) {
  if (!str) return '';
  let s = String(str)
    .replace(/%%%/g, '\x01PCT\x01')
    .replace(/%%[cC]/g, '⌀')
    .replace(/%%[dD]/g, '°')
    .replace(/%%[pP]/g, '±')
    .replace(/%%[oOuUkK]/g, '')
    .replace(/%%130/g, 'Ⅰ')
    .replace(/%%131/g, 'Ⅱ')
    .replace(/%%132/g, 'Ⅲ')
    .replace(/%%133/g, 'Ⅳ')
    .replace(/%%134/g, 'Ⅴ')
    .replace(/%%135/g, 'Ⅵ')
    .replace(/%%127/g, '°')
    .replace(/%%128/g, '±')
    .replace(/%%129/g, '⌀')
    .replace(/%%(\d{3})/g, (_, digits) => {
      const code = parseInt(digits, 10);
      if (code === 176) return '°';
      if (code === 177) return '±';
      if (code === 215) return '×';
      if (code === 216 || code === 248) return '⌀';
      if (code === 178) return '²';
      if (code === 179) return '³';
      if (code >= 32 && code <= 126) return String.fromCharCode(code);
      if (code >= 160 && code <= 255) return String.fromCharCode(code);
      return '⌀';
    })
    .replace(/%%(\d{1,2})/g, (_, digits) => {
      const code = parseInt(digits, 10);
      if (code >= 32 && code <= 126) return String.fromCharCode(code);
      return '';
    })
    .replace(/%%[a-zA-Z]/g, '')
    .replace(/\x01PCT\x01/g, '%')
    .replace(/\{\\Fgdt;j\}/gi, '⌖')
    .replace(/\{\\Fgdt;f\}/gi, '∥')
    .replace(/\{\\Fgdt;b\}/gi, '⊥')
    .replace(/\{\\Fgdt;e\}/gi, '○')
    .replace(/\{\\Fgdt;a\}/gi, '∠')
    .replace(/\{\\Fgdt;g\}/gi, '⌭')
    .replace(/\{\\Fgdt;d\}/gi, '⌓')
    .replace(/\{\\Fgdt;h\}/gi, '↗')
    .replace(/\{\\Fgdt;n\}/gi, '⌀')
    .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

  if (s.includes('\\M+') && typeof TextDecoder !== 'undefined') {
    s = s.replace(/\\M\+([1-5])([0-9A-Fa-f]{4})/g, (match, page, hex) => {
      try {
        const b1 = parseInt(hex.slice(0, 2), 16);
        const b2 = parseInt(hex.slice(2, 4), 16);
        const encMap = { '1': 'shift-jis', '3': 'euc-kr', '4': 'big5', '5': 'gb18030' };
        const dec = new TextDecoder(encMap[page] || 'gb18030');
        return dec.decode(new Uint8Array([b1, b2]));
      } catch (_) {
        return match;
      }
    });
  }
  return s;
}

export { Float32GrowableBuffer, ACI_PALETTE, srgbByteToLinear, hexToLinearRgb, adaptHexForLightBackground, adaptHexForDarkBackground, DEFAULT_CAD_FONT_STACK, mapCADFontToSystemFont, normKey, decodeDXFArrayBuffer, decodeMIFAndSpecialChars };
