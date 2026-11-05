/**
 * SHX 形字体（编译后的 AutoCAD shape 文件）二进制解析器。
 *
 * 输出统一的「描边字形」表示：每个字形 = 若干条折线（字形坐标空间，
 * 基线 y=0，向上为正），供 strokeTextShaper 缩放排布后写入线段网格。
 *
 * 支持 AutoCAD shape 指令的常用子集：
 * - 八分向量 (0x00-0x0E)、十六方向向量、
 * - 008/009 x-y 位移、003/004 缩放、005/006 位置栈、007 子形引用、
 * - 001/002 落笔/抬笔、00A/00B/00C/00D 圆弧（含分数八分弧）。
 *
 * 文件布局：'AutoCAD-86 shapes 1.1\r\n\x1a\x00' 头 + 记录序列
 * [code:u8][len:u8][definition:len-2]。code 0 的首记录为字体元数据。
 */

export interface StrokeGlyph {
  /** 字形宽度（相对大写字高的比例；基线 y=0，Y 向上） */
  advance: number;
  /** 折线段（扁平坐标数组 [x0,y0,x1,y1,...]），Y 向上，基线 0 */
  strokes: number[][];
}

export interface StrokeFontData {
  /** 字形表：键 = 字符代码（ASCII）或 bigfont 代码 */
  glyphs: Map<number, StrokeGlyph>;
  /** 大写字高（字形坐标单位，通常 = 21） */
  capHeight: number;
  /** 下延深度（正数，向下） */
  descender: number;
  isBigFont: boolean;
}

const HEADER_SHAPES = 'AutoCAD-86 shapes 1.1';
const HEADER_BIGFONT = 'AutoCAD-86 bigfont 1.1';

interface Reader {
  data: Uint8Array;
  pos: number;
}

const readU8 = (r: Reader): number => r.data[r.pos++] ?? 0;
const readI8 = (r: Reader): number => {
  const v = readU8(r);
  return v >= 128 ? v - 256 : v;
};

/** 八分方向表：16 个半八分方向（22.5° 步进），单位向量。 */
const DIRECTIONS: Array<[number, number]> = (() => {
  const table: Array<[number, number]> = [];
  for (let i = 0; i < 16; i++) {
    const angle = (i * Math.PI) / 8;
    // 八分向量长度以「直段」为单位：斜方向的位移需按 1/cos(22.5°) 校正。
    const len = (i % 2 === 1) ? 1 / Math.cos(Math.PI / 8) : 1;
    table.push([Math.cos(angle) * len, Math.sin(angle) * len]);
  }
  return table;
})();

/** 解析单条 shape 记录的定义字节 → 折线集合（字形坐标，基线 0，Y 向上）。 */
const decodeShapeDefinition = (bytes: Uint8Array): { strokes: number[][]; xExtent: number } => {
  const strokes: number[][] = [];
  let cur: number[] | null = null;
  let x = 0;
  let y = 0;
  let penDown = true;
  let lengthScale = 1;
  let maxX = 0;
  const stack: Array<[number, number]> = [];

  const lineTo = (nx: number, ny: number) => {
    x = nx; y = ny;
    maxX = Math.max(maxX, Math.abs(x));
    if (penDown) {
      if (!cur) { cur = [x, y]; strokes.push(cur); }
      else cur.push(x, y);
    } else {
      cur = null;
    }
  };

  let i = 0;
  while (i < bytes.length) {
    const code = bytes[i++];
    if (code === 0) break; // 形定义结束

    if (code <= 0x0E) {
      // 八分向量：高 4 位长度，低 4 位方向（0-15，22.5° 步进）。
      const len = (code >> 4) & 0xF;
      const dir = code & 0xF;
      if (len === 0) continue;
      const vec = DIRECTIONS[dir];
      lineTo(x + vec[0] * len * lengthScale, y + vec[1] * len * lengthScale);
      continue;
    }

    if (code >= 0x20 && code <= 0x3F) {
      // 32-63：多方向向量：(code-32)>>2 = 方向八分位 0-7，(code-32)&3 + 1 = 长度 1-4。
      const idx = code - 0x20;
      const oct = (idx >> 2) & 0x7;
      const len = (idx & 0x3) + 1;
      const angle = oct * Math.PI / 4;
      lineTo(x + Math.cos(angle) * len * lengthScale, y + Math.sin(angle) * len * lengthScale);
      continue;
    }

    if (code === 0x0A || code === 0x0C || code === 0x0B || code === 0x0D) {
      // 八分弧 / 分数弧。
      const arc = decodeArc(code, bytes, i, x, y);
      if (arc) {
        i += arc.consumed;
        x = arc.endX;
        y = arc.endY;
        maxX = Math.max(maxX, Math.abs(x), ...arc.points.filter((_, idx) => idx % 2 === 0));
        if (arc.points.length >= 4) {
          if (penDown) {
            if (cur) cur.push(...arc.points.slice(2));
            else { cur = arc.points; strokes.push(arc.points); }
          } else {
            cur = null;
          }
        }
      }
      continue;
    }

    switch (code) {
      case 0x0F: { // 16 位长度向量：15, lenHi, lenLo, dir
        const len = ((bytes[i] << 8) | bytes[i + 1]) * lengthScale;
        const dir = bytes[i + 2] & 0xF;
        i += 3;
        const vec = DIRECTIONS[dir];
        lineTo(x + vec[0] * len, y + vec[1] * len);
        break;
      }
      case 0x10: { // 缩放后续向量长度：10, scale
        lengthScale = (bytes[i++] || 1) / 255;
        break;
      }
      case 0x11: { // 恢复默认长度
        lengthScale = 1;
        break;
      }
      case 0x13: { // 子形引用（16 位）：13, codeLo, codeHi —— v1 忽略组合形
        i += 2;
        break;
      }
      case 0x14: { // 位置栈：压栈
        stack.push([x, y]);
        break;
      }
      case 0x15: { // 位置栈：弹栈
        const top = stack.pop();
        if (top) { x = top[0]; y = top[1]; cur = null; }
        break;
      }
      case 0x16: { // 除法缩放：16, divisor
        const d = bytes[i++];
        if (d > 0) lengthScale /= d;
        break;
      }
      case 0x17: { // 乘法缩放：17, factor
        lengthScale *= bytes[i++];
        break;
      }
      case 0x18: { // 位移向量：18, dx(带符号), dy(带符号)
        const dx = bytes[i++] << 24 >> 24;
        const dy = bytes[i++] << 24 >> 24;
        lineTo(x + dx * lengthScale, y + dy * lengthScale);
        break;
      }
      case 0x19: { // 弹栈（同 0x15）
        const top = stack.pop();
        if (top) { x = top[0]; y = top[1]; cur = null; }
        break;
      }
      case 0x1A: case 0x12: { // 组合形控制标记——忽略
        break;
      }
      case 0x1B: { // bulge 弧：1B, radius, bulge —— 近似为位移处理
        i += 2;
        break;
      }
      case 0x1C: case 0x1D: case 0x1E: case 0x1F: { // 扩展位移对
        i += 2;
        break;
      }
      default:
        // 未知指令：单字节跳过，尽力保持同步。
        break;
    }
  }

  return { strokes: strokes.filter(s => s.length >= 4), xExtent: maxX };
};

/** 八分弧：从当前点出发、圆心在当前点八分角向内的圆弧。 */
const arcStroke = (
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
): number[] => {
  const points: number[] = [];
  let sweep = endAngle - startAngle;
  while (sweep <= -Math.PI * 2) sweep += Math.PI * 2;
  while (sweep >= Math.PI * 2) sweep -= Math.PI * 2;
  const segCount = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 12)));
  for (let s = 0; s <= segCount; s++) {
    const t = s / segCount;
    const a = startAngle + sweep * t;
    points.push(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
  }
  return points;
};

/** 解析 00A/00C 八分弧与 00B 分数弧指令，返回弧线点列（字形坐标）。 */
const decodeArc = (
  code: number,
  bytes: Uint8Array,
  offset: number,
  x: number,
  y: number,
): { points: number[]; consumed: number; endX: number; endY: number } | null => {
  if (code === 0x0A || code === 0x0C) {
    // 00A/00C: radius, octantByte（低 3 位 = 跨越八分数，符号位 = 逆时针）。
    const radius = bytes[offset] ?? 0;
    const octantByte = readI8({ data: bytes, pos: offset + 1 });
    const count = Math.abs(octantByte) & 0x7;
    const ccw = octantByte >= 0;
    // 起始八分角：当前点所在的八分边界。
    const startOctant = Math.round(Math.atan2(y, x) / (Math.PI / 4));
    const startAngle = startOctant * (Math.PI / 4);
    // 圆心：从起点沿半径方向指向弧心（起点在圆上，圆心在八分角反向延长线上）。
    const cx = x - Math.cos(startAngle) * radius;
    const cy = y - Math.sin(startAngle) * radius;
    const sweep = (ccw ? 1 : -1) * count * (Math.PI / 4);
    const points = arcStroke(cx, cy, radius, startAngle, startAngle + sweep);
    const endAngle = startAngle + sweep;
    return {
      points,
      consumed: 2,
      endX: cx + Math.cos(endAngle) * radius,
      endY: cy + Math.sin(endAngle) * radius,
    };
  }
  if (code === 0x0B || code === 0x0D) {
    // 00B/00D 分数弧：startInt, startFrac, endInt, endFrac, radius, octantByte
    const startOff = ((bytes[offset] ?? 0) + (bytes[offset + 1] ?? 0) / 256) * (Math.PI / 4);
    const endOff = ((bytes[offset + 2] ?? 0) + (bytes[offset + 3] ?? 0) / 256) * (Math.PI / 4);
    const radius = bytes[offset + 4] ?? 0;
    const octantByte = readI8({ data: bytes, pos: offset + 5 });
    const startOctant = octantByte & 0x7;
    const ccw = octantByte >= 0;
    const startAngle = startOctant * (Math.PI / 4) + startOff;
    const sweep = (ccw ? 1 : -1) * endOff;
    const cx = x - Math.cos(startAngle) * radius;
    const cy = y - Math.sin(startAngle) * radius;
    const points = arcStroke(cx, cy, radius, startAngle, startAngle + sweep);
    const endAngle = startAngle + sweep;
    return {
      points,
      consumed: 6,
      endX: cx + Math.cos(endAngle) * radius,
      endY: cy + Math.sin(endAngle) * radius,
    };
  }
  return null;
};

/** 解析 SHX 字体文件（ArrayBuffer）→ 描边字体数据。 */
export const parseShxFont = (buffer: ArrayBuffer): StrokeFontData => {
  const bytes = new Uint8Array(buffer);
  const headerText = new TextDecoder('ascii').decode(bytes.subarray(0, 24));
  const isBigFont = headerText.includes('bigfont');
  if (!headerText.includes(HEADER_SHAPES) && !headerText.includes(HEADER_BIGFONT)) {
    throw new Error('不是有效的 SHX 字体文件（缺少 AutoCAD-86 头）');
  }

  // 跳过头（\x1a 之后 1 字节类型标记 0x00）。
  let pos = headerText.indexOf('\x1a');
  if (pos < 0) pos = 23;
  pos += 2; // \x1a + 类型字节

  const glyphs = new Map<number, StrokeGlyph>();
  let capHeight = 21;
  let descender = 5;

  if (isBigFont) {
    // bigfont 扩展头：子码页记录数（2 字节）+ 每记录 4 字节，跳过。
    const records = bytes[pos] | (bytes[pos + 1] << 8);
    pos += 2 + records * 4;
  }

  const reader: Reader = { data: bytes, pos };
  while (reader.pos + 2 <= bytes.length) {
    const rawCode = readU8(reader);
    const recordLen = readU8(reader);
    if (recordLen < 2 || reader.pos + recordLen - 2 > bytes.length) break;
    const defBytes = bytes.subarray(reader.pos, reader.pos + recordLen - 2);
    reader.pos += recordLen - 2;

    let code = rawCode & 0x7F;
    if (rawCode & 0x80) {
      // 扩展记录（bigfont 纵排等）：首字节为真实代码 + 纵排标志。
      code = defBytes[0] & 0x7F;
      // 纵排/其他标志：忽略，按水平字形解码。
      const decoded = decodeShapeDefinition(defBytes.subarray(1));
      if (decoded.strokes.length) {
        glyphs.set(code, { advance: Math.max(decoded.xExtent, 6), strokes: decoded.strokes });
      }
      continue;
    }

    if (code === 0) {
      // 字体元数据：type, above, below, mode, width(2字节), ...
      if (defBytes.length >= 3) {
        capHeight = defBytes[1] || 21;
        descender = Math.abs(defBytes[2] || 5);
      }
      continue;
    }

    const decoded = decodeShapeDefinition(defBytes);
    if (decoded.strokes.length) {
      glyphs.set(code, { advance: Math.max(decoded.xExtent + 1, 4), strokes: decoded.strokes });
    }
  }

  return { glyphs, capHeight, descender, isBigFont };
};
