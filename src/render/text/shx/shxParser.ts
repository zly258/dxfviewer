/**
 * SHX 形字体解析。
 *
 * 支持：
 * - AutoCAD-86 shapes 1.0 / 1.1
 * - AutoCAD-86 unifont 1.0（tssdeng.shx 这一类）
 * - AutoCAD-86 bigfont 1.0（hztxt.shx 这一类）
 *
 * 字形坐标：基线 y = 0，Y 向上。advance 是字形坐标里的步进。
 */
export interface StrokeGlyph {
  advance: number;
  strokes: number[][];
}

export interface StrokeFontData {
  glyphs: Map<number, StrokeGlyph>;
  capHeight: number;
  descender: number;
  isBigFont: boolean;
}

const DIRECTIONS: Array<[number, number]> = (() => {
  const table: Array<[number, number]> = [];
  for (let i = 0; i < 16; i++) {
    const angle = (i * Math.PI) / 8;
    const len = (i % 2 === 1) ? 1 / Math.cos(Math.PI / 8) : 1;
    table.push([Math.cos(angle) * len, Math.sin(angle) * len]);
  }
  return table;
})();

const signed = (v: number): number => (v >= 128 ? v - 256 : v);

/** 跳过一条形指令（垂直文字标志 14 用）。 */
const skipCommand = (bytes: Uint8Array, i: number): number => {
  if (i >= bytes.length) return i;
  const code = bytes[i++];
  if (code === 0 || code === 1 || code === 2 || code === 5 || code === 6 || code === 14) return i;
  if (code === 3 || code === 4) return i + 1;
  if (code === 7) return bytes[i] === 0 ? i + 3 : i + 1;
  if (code === 8 || code === 10) return i + 2;
  if (code === 9) {
    while (i + 1 < bytes.length) {
      const dx = bytes[i++];
      const dy = bytes[i++];
      if (dx === 0 && dy === 0) break;
    }
    return i;
  }
  if (code === 11) return i + 5;
  if (code === 12) return i + 3;
  if (code === 13) {
    while (i + 2 < bytes.length) {
      const dx = bytes[i++];
      const dy = bytes[i++];
      i++;
      if (dx === 0 && dy === 0) break;
    }
    return i;
  }
  return i;
};

const arcPoints = (
  cx: number, cy: number, radius: number, start: number, end: number,
): number[] => {
  const points: number[] = [];
  let sweep = end - start;
  while (sweep <= -Math.PI * 2) sweep += Math.PI * 2;
  while (sweep >= Math.PI * 2) sweep -= Math.PI * 2;
  const steps = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 10)));
  for (let s = 1; s <= steps; s++) {
    const a = start + sweep * (s / steps);
    points.push(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
  }
  return points;
};

/** 解析形定义字节。笔落下开始。 */
export const decodeShapeDefinition = (bytes: Uint8Array): { strokes: number[][]; xExtent: number } => {
  const strokes: number[][] = [];
  let cur: number[] | null = null;
  let x = 0;
  let y = 0;
  let penDown = true;
  let scale = 1;
  let maxX = 0;
  const stack: Array<[number, number]> = [];

  const move = (nx: number, ny: number) => {
    const px = x;
    const py = y;
    x = nx;
    y = ny;
    maxX = Math.max(maxX, x);
    if (penDown) {
      if (!cur) {
        cur = [px, py, x, y];
        strokes.push(cur);
      } else {
        cur.push(x, y);
      }
    } else {
      cur = null;
    }
  };

  let i = 0;
  while (i < bytes.length) {
    const code = bytes[i++];
    if (code === 0) break;
    if (code === 1) { penDown = true; cur = null; continue; }
    if (code === 2) { penDown = false; cur = null; continue; }
    if (code === 3) { const d = bytes[i++] || 1; scale /= d; continue; }
    if (code === 4) { scale *= bytes[i++] || 1; continue; }
    if (code === 5) { stack.push([x, y]); continue; }
    if (code === 6) {
      const top = stack.pop();
      if (top) { x = top[0]; y = top[1]; maxX = Math.max(maxX, x); }
      cur = null;
      continue;
    }
    if (code === 7) {
      if (bytes[i] === 0) i += 3;
      else i += 1;
      continue;
    }
    if (code === 8) {
      const dx = signed(bytes[i++]);
      const dy = signed(bytes[i++]);
      move(x + dx * scale, y + dy * scale);
      continue;
    }
    if (code === 9) {
      while (i + 1 < bytes.length) {
        const dxb = bytes[i];
        const dyb = bytes[i + 1];
        const dx = signed(bytes[i++]);
        const dy = signed(bytes[i++]);
        if (dxb === 0 && dyb === 0) break;
        move(x + dx * scale, y + dy * scale);
      }
      continue;
    }
    if (code === 10 || code === 11) {
      let startOct = 0;
      let span = 8;
      let ccw = true;
      let radius = 0;
      let startBias = 0;
      let endBias = 0;
      if (code === 10) {
        radius = (bytes[i++] || 0) * scale;
        const flag = signed(bytes[i++]);
        const abs = Math.abs(flag);
        span = abs & 7;
        if (span === 0) span = 8;
        startOct = (abs >> 4) & 7;
        ccw = flag >= 0;
      } else {
        const so = bytes[i++] || 0;
        const eo = bytes[i++] || 0;
        const hi = bytes[i++] || 0;
        const lo = bytes[i++] || 0;
        radius = (hi * 256 + lo) * scale;
        const flag = signed(bytes[i++]);
        const abs = Math.abs(flag);
        span = abs & 7;
        if (span === 0) span = 8;
        startOct = (abs >> 4) & 7;
        ccw = flag >= 0;
        startBias = so / 256;
        endBias = eo / 256;
      }
      const start = (startOct + startBias) * Math.PI / 4;
      const sweepOct = ccw ? span : -span;
      const end = (startOct + sweepOct + (ccw ? endBias : -endBias)) * Math.PI / 4;
      const cx = x - Math.cos(start) * radius;
      const cy = y - Math.sin(start) * radius;
      const pts = arcPoints(cx, cy, radius, start, end);
      for (let k = 0; k < pts.length; k += 2) move(pts[k], pts[k + 1]);
      continue;
    }
    if (code === 12 || code === 13) {
      const once = code === 12;
      while (i + 2 < bytes.length) {
        const dxb = bytes[i];
        const dyb = bytes[i + 1];
        const dx = signed(bytes[i++]) * scale;
        const dy = signed(bytes[i++]) * scale;
        const bulge = signed(bytes[i++]);
        if (!once && dxb === 0 && dyb === 0) break;
        const ex = x + dx;
        const ey = y + dy;
        if (bulge === 0 || dx === 0 && dy === 0) {
          move(ex, ey);
        } else {
          const theta = 4 * Math.atan(bulge / 127);
          const dist = Math.hypot(dx, dy);
          const radius = dist / (2 * Math.sin(theta / 2) || 1);
          const mx = (x + ex) / 2;
          const my = (y + ey) / 2;
          const h = Math.sqrt(Math.max(0, radius * radius - (dist / 2) * (dist / 2)));
          const ux = -dy / (dist || 1);
          const uy = dx / (dist || 1);
          const sign = theta > 0 ? 1 : -1;
          const cx = mx + ux * h * sign;
          const cy = my + uy * h * sign;
          const a0 = Math.atan2(y - cy, x - cx);
          const a1 = Math.atan2(ey - cy, ex - cx);
          const pts = arcPoints(cx, cy, Math.abs(radius), a0, a1);
          for (let k = 0; k < pts.length; k += 2) move(pts[k], pts[k + 1]);
        }
        if (once) break;
      }
      continue;
    }
    if (code === 14) {
      i = skipCommand(bytes, i);
      continue;
    }
    if ((code & 0xF0) !== 0) {
      const len = (code >> 4) * scale;
      const dir = code & 0x0F;
      const vec = DIRECTIONS[dir];
      move(x + vec[0] * len, y + vec[1] * len);
    }
  }

  return {
    strokes: strokes.filter(s => s.length >= 4),
    xExtent: Math.max(maxX, 0),
  };
};

const glyphFromDefinition = (def: Uint8Array, advance: number): StrokeGlyph | null => {
  let body = def;
  if (body.length && body[0] === 0) body = body.subarray(1);
  else {
    const z = body.indexOf(0);
    if (z >= 0 && z < 32) body = body.subarray(z + 1);
  }
  if (body.length >= 4 && body[0] === 0x30 && body[1] === 0x00 && body[2] === 0x07) {
    body = body.subarray(4);
  }
  const decoded = decodeShapeDefinition(body);
  if (!decoded.strokes.length) return null;
  return {
    advance: advance > 0 ? advance : Math.max(decoded.xExtent, 1),
    strokes: decoded.strokes,
  };
};

const readHeaderEnd = (bytes: Uint8Array): number => {
  const mark = bytes.indexOf(0x1a);
  return mark < 0 ? 25 : mark + 1;
};

const parseShapesOrUnifont = (bytes: Uint8Array, isUnifont: boolean): StrokeFontData => {
  let pos = readHeaderEnd(bytes);
  let capHeight = isUnifont ? 26 : 21;
  let descender = isUnifont ? 7 : 5;
  const glyphs = new Map<number, StrokeGlyph>();

  if (isUnifont) {
    // uint32 字形数，uint16 信息长度，信息块末尾是 above/below。
    if (pos + 6 <= bytes.length) {
      pos += 4;
      const infoLen = bytes[pos] | (bytes[pos + 1] << 8);
      pos += 2;
      const info = bytes.subarray(pos, pos + infoLen);
      pos += infoLen;
      const nul = info.indexOf(0);
      if (nul >= 0 && nul + 2 < info.length) {
        capHeight = info[nul + 1] || capHeight;
        descender = info[nul + 2] || descender;
      }
    }
    while (pos + 4 <= bytes.length) {
      const code = bytes[pos] | (bytes[pos + 1] << 8);
      const len = bytes[pos + 2] | (bytes[pos + 3] << 8);
      pos += 4;
      if (len <= 0 || pos + len > bytes.length) break;
      const def = bytes.subarray(pos, pos + len);
      pos += len;
      const decoded = glyphFromDefinition(def, 0);
      if (decoded) {
        decoded.advance = Math.max(decoded.advance, 1);
        glyphs.set(code, decoded);
      }
    }
    return { glyphs, capHeight, descender, isBigFont: false };
  }

  // shapes 1.0 / 1.1：记录是 [code:u8][len:u8][bytes]
  while (pos + 2 <= bytes.length) {
    const code = bytes[pos++];
    const len = bytes[pos++];
    if (len < 2 || pos + len - 2 > bytes.length) break;
    const def = bytes.subarray(pos, pos + len - 2);
    pos += len - 2;
    if (code === 0) {
      if (def.length >= 3) {
        capHeight = def[1] || capHeight;
        descender = Math.abs(def[2] || descender);
      }
      continue;
    }
    const decoded = glyphFromDefinition(def, 0);
    if (decoded) glyphs.set(code, decoded);
  }
  return { glyphs, capHeight, descender, isBigFont: false };
};

const parseBigFont = (bytes: Uint8Array): StrokeFontData => {
  let pos = readHeaderEnd(bytes);
  // 有的文件在字符数前多一个 uint16。
  const maybeCount = bytes[pos + 2] | (bytes[pos + 3] << 8);
  const maybeRanges = bytes[pos + 4] | (bytes[pos + 5] << 8);
  if (maybeCount > 50 && maybeRanges > 0 && maybeRanges < 16) pos += 2;
  const nChars = bytes[pos] | (bytes[pos + 1] << 8);
  const nRanges = bytes[pos + 2] | (bytes[pos + 3] << 8);
  pos += 4 + nRanges * 4;

  let capHeight = 127;
  let descender = 0;
  const glyphs = new Map<number, StrokeGlyph>();
  for (let i = 0; i < nChars && pos + 8 <= bytes.length; i++) {
    const code = bytes[pos] | (bytes[pos + 1] << 8);
    const len = bytes[pos + 2] | (bytes[pos + 3] << 8);
    const off = (bytes[pos + 4] | (bytes[pos + 5] << 8) | (bytes[pos + 6] << 16) | (bytes[pos + 7] << 24)) >>> 0;
    pos += 8;
    if (len < 2 || off <= 0 || off + len > bytes.length) continue;
    const def = bytes.subarray(off, off + len);
    if (code === 0) {
      const nul = def.indexOf(0);
      if (nul >= 0 && nul + 1 < def.length) capHeight = def[nul + 1] || capHeight;
      if (nul >= 0 && nul + 2 < def.length) descender = def[nul + 2] || 0;
      continue;
    }
    const decoded = glyphFromDefinition(def, capHeight);
    if (decoded) glyphs.set(code, decoded);
  }
  // 方格步进用字体的 above，而不是某一笔的外接宽度。
  for (const glyph of glyphs.values()) glyph.advance = capHeight;
  return { glyphs, capHeight, descender, isBigFont: true };
};

/** 解析 SHX（ArrayBuffer）→ 描边字体。 */
export const parseShxFont = (buffer: ArrayBuffer): StrokeFontData => {
  const bytes = new Uint8Array(buffer);
  const header = new TextDecoder('ascii').decode(bytes.subarray(0, 32)).toLowerCase();
  if (header.includes('bigfont')) return parseBigFont(bytes);
  if (header.includes('unifont')) return parseShapesOrUnifont(bytes, true);
  if (header.includes('shapes')) return parseShapesOrUnifont(bytes, false);
  throw new Error('不是有效的 SHX 字体文件');
};
