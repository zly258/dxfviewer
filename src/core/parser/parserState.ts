import { Point2D, DxfEntity } from '@/types';
import { CAD_BY_LAYER_COLOR } from '@/config/cadConstants';

/** 与 String.prototype.trim() 一致的常见空白字符（ASCII + NBSP + BOM）。 */
const isWhitespaceCode = (code: number): boolean =>
  code === 32 || code === 9 || code === 10 || code === 11 || code === 12 || code === 13
  || code === 160 || code === 65279;

/**
 * 组码数值类型表：按 DXF 规范，这些组码的值是数值（坐标/角度/整数/比例等）。
 * 命中时 peek() 在字符区间上原位解析出 num，全程零字符串分配。
 */
const NUMERIC_GROUP_TYPES = (() => {
  const table = new Uint8Array(1072);
  const mark = (from: number, to: number) => {
    for (let c = from; c <= to; c++) table[c] = 1;
  };
  mark(10, 59);    // 坐标/角度/高度等 double
  mark(60, 79);    // int16（可见性、标志、对齐）
  mark(90, 99);    // int32
  mark(110, 149);  // double
  mark(160, 179);  // long / int16
  mark(210, 239);  // 拉伸方向等 double
  mark(270, 299);  // int8 / bool
  mark(370, 399);  // 线宽 int16 / int30
  mark(400, 429);  // int16 / int32
  mark(440, 469);  // int32 / double
  return table;
})();

/** 预计算的 10 的幂（|e| ≤ 22 内为精确最近双精度），供快速路径使用。 */
const POW10 = (() => {
  const table = new Array<number>(23);
  for (let i = 0; i <= 22; i++) table[i] = Math.pow(10, i);
  return table;
})();

/**
 * 单个组码对。数值类型组码在 peek() 阶段原位解析出 num（零分配）；
 * value 为惰性访问器——只在调用方需要原始字符串时物化子串。
 * 这样坐标类热路径（parseFloat(p.value) → p.float）不再产生中间字符串。
 */
export class DxfGroup {
  public readonly num: number;

  constructor(
    private readonly text: string,
    private readonly valueStart: number,
    private readonly valueEnd: number,
    public readonly code: number,
    num: number,
  ) {
    this.num = num;
  }

  /** 原始字符串值（惰性物化，与旧实现 substring+trim 的结果逐字符一致）。 */
  get value(): string {
    return this.text.substring(this.valueStart, this.valueEnd);
  }

  /**
   * 数值便捷访问：num 有效（快速路径精确解析）时直接返回；
   * 超长精度等回退场景物化字符串走 parseFloat，语义与 parseFloat(value) 一致。
   */
  get float(): number {
    const n = this.num;
    return n === n ? n : parseFloat(this.text.substring(this.valueStart, this.valueEnd));
  }
}

/**
 * DXF 解析状态机类，负责逐行读取和预读组码。
 *
 * 性能要点：大图纸的组码行有百万级，逐行 substring + trim + parseInt 会产生
 * 数倍于实体数的临时字符串。此处组码行直接在原文上按字符区间解析数字
 * （零分配），数值类型组码的值同样原位解析为 num；value 只在真正需要
 * 字符串时惰性物化。
 */
export class DxfParserState {
  private text: string;
  private pos: number = 0;
  private len: number;
  private currentGroup: DxfGroup | null = null;
  private groupLoaded: boolean = false;
  public linesRead: number = 0;

  constructor(text: string) {
    this.text = text;
    this.len = text.length;
  }

  get hasNext() {
    if (this.groupLoaded) return true;
    return this.pos < this.len;
  }

  /**
   * 读取一行并计算修剪空白后的区间，不产生字符串分配。
   * 行以 \n 结尾（与原实现的 indexOf('\n') 一致，孤立 \r 不视为换行）。
   */
  private readTrimmedBounds(): { start: number; end: number } | null {
    if (this.pos >= this.len) return null;
    const text = this.text;
    let end = text.indexOf('\n', this.pos);
    if (end === -1) end = this.len;
    let start = this.pos;
    let stop = end;
    while (start < stop && isWhitespaceCode(text.charCodeAt(start))) start++;
    while (stop > start && isWhitespaceCode(text.charCodeAt(stop - 1))) stop--;
    this.pos = end + 1;
    this.linesRead++;
    return { start, end: stop };
  }

  /** 在 [start, end) 区间上解析前导十进制整数（与 parseInt(value, 10) 行为一致）。 */
  private parseIntInRange(start: number, end: number): number {
    const text = this.text;
    let i = start;
    let sign = 1;
    if (i < end) {
      const c = text.charCodeAt(i);
      if (c === 45) { sign = -1; i++; }
      else if (c === 43) i++;
    }
    let value = 0;
    let digits = 0;
    while (i < end) {
      const c = text.charCodeAt(i);
      if (c < 48 || c > 57) break;
      value = value * 10 + (c - 48);
      i++;
      digits++;
    }
    if (digits === 0) return NaN;
    return sign * value;
  }

  /**
   * 在 [start, end) 区间上解析前导十进制浮点。
   *
   * 快速路径：有效数字 ≤ 15 位时整数化 mantissa（≤2^53 内精确），
   * 经预计算 POW10 还原——对常用坐标精度（≤9 位有效数字且小数位 ≤7）
   * 结果与 parseFloat 完全一致；更长的精度或非数字形态返回 NaN，
   * 由调用方（DxfGroup.float）物化字符串走 parseFloat 兜底。
   */
  private parseFloatInRange(start: number, end: number): number {
    const text = this.text;
    let i = start;
    let sign = 1;
    if (i < end) {
      const c = text.charCodeAt(i);
      if (c === 45) { sign = -1; i++; }
      else if (c === 43) i++;
    }
    let mantissa = 0;
    let digits = 0;
    let exp10 = 0;
    let sawDot = false;
    while (i < end) {
      const c = text.charCodeAt(i);
      if (c === 46 && !sawDot) { sawDot = true; i++; continue; }
      if (c < 48 || c > 57) break;
      mantissa = mantissa * 10 + (c - 48);
      digits++;
      if (sawDot) exp10--;
      i++;
    }
    if (digits === 0 || digits > 15) return NaN;
    if (i < end && (text.charCodeAt(i) === 69 || text.charCodeAt(i) === 101)) {
      const save = i;
      i++;
      let expSign = 1;
      if (i < end) {
        const c = text.charCodeAt(i);
        if (c === 45) { expSign = -1; i++; }
        else if (c === 43) i++;
      }
      let exp = 0;
      let expDigits = 0;
      while (i < end) {
        const c = text.charCodeAt(i);
        if (c < 48 || c > 57) break;
        exp = exp * 10 + (c - 48);
        i++;
        expDigits++;
      }
      if (expDigits > 0) exp10 += expSign * exp;
      else i = save;
    }
    // 快速精确路径：|exp10| ≤ 7 时 mantissa×5^|exp10| ≤ 1e15×7.8e4，
    // 数值精确可表示；其余（大指数/长小数）交由字符串兜底。
    if (exp10 < -7 || exp10 > 7) return NaN;
    const value = exp10 >= 0
      ? mantissa * POW10[exp10]
      : mantissa / POW10[-exp10];
    return sign * value;
  }

  peek() {
    if (this.groupLoaded) return this.currentGroup;

    // 读取组码行：循环跳过空行/纯空白行，避免 peek() 空转
    let codeBounds = this.readTrimmedBounds();
    while (codeBounds && codeBounds.start === codeBounds.end && this.pos < this.len) {
      codeBounds = this.readTrimmedBounds();
    }

    if (!codeBounds) return null;

    const valueBounds = this.readTrimmedBounds();
    if (!valueBounds) return null;

    const code = this.parseIntInRange(codeBounds.start, codeBounds.end);
    // 处理文件损坏导致整数解析失败的情况：跳过当前组码并返回空值，避免解析循环卡住。
    if (isNaN(code)) {
      return null;
    }

    const numeric = code >= 0 && code < NUMERIC_GROUP_TYPES.length && NUMERIC_GROUP_TYPES[code] === 1;
    const num = numeric ? this.parseFloatInRange(valueBounds.start, valueBounds.end) : NaN;
    this.currentGroup = new DxfGroup(this.text, valueBounds.start, valueBounds.end, code, num);
    this.groupLoaded = true;
    return this.currentGroup;
  }

  next() {
    const g = this.peek();
    this.groupLoaded = false;
    this.currentGroup = null;
    return g;
  }
}

/**
 * 读取特定组码的值，并转换成浮点数
 */
export const readVal = (state: DxfParserState, code: number): number | null => {
    const p = state.peek();
    if (p && p.code === code) {
        state.next();
        return p.float;
    }
    return null;
};

/**
 * 读取二维点坐标（X和Y组码），可选跳过Z坐标组码30
 */
export const readPoint = (state: DxfParserState, xCode: number, yCode: number): Point2D | null => {
    const p1 = state.peek();
    if (p1 && p1.code === xCode) {
        state.next();
        const p2 = state.peek();
        if (p2 && p2.code === yCode) {
            state.next();
            // 可选的 Z 坐标
            const p3 = state.peek();
            if (p3 && p3.code === 30) state.next();
            return { x: p1.float, y: p2.float };
        }
    }
    return null;
};

/**
 * 解析点对象（支持10/20/30组码）
 */
export const parsePoint = (state: DxfParserState): Point2D => {
    let x = 0, y = 0;
    while(state.hasNext) {
        const p = state.peek();
        if(!p || p.code === 0) break;
        if (p.code === 10) { state.next(); x = p.float; }
        else if (p.code === 20) { state.next(); y = p.float; }
        else if (p.code === 30) { state.next(); }
        else break;
    }
    return {x, y};
};

/** 解析期实体 id 序列：仅用作文档内唯一键，计数器远快于 crypto.randomUUID。 */
let parsedEntityIdSeq = 0;

/**
 * 构造一个基础 DXF 实体默认属性对象
 */
export const parseCommon = (_state: DxfParserState): DxfEntity => {
    return {
        id: `e${++parsedEntityIdSeq}`,
        handle: '',
        layer: '0',
        color: CAD_BY_LAYER_COLOR,
        lineType: 'ByLayer',
        lineTypeScale: 1.0,
        visible: true,
        extrusion: { x: 0, y: 0, z: 1 },
        inPaperSpace: false
    } as any;
};

/**
 * 应用实体的通用组码（如图层、颜色、线型等）
 */
export const applyCommonGroup = (common: any, code: number, value: string) => {
    switch (code) {
        case 5: common.handle = value; break;
        case 8: common.layer = value; break;
        case 62: common.color = parseInt(value, 10); break;
        case 420:
                // 组码 420 是真彩色（24位整数）
                common.trueColor = typeof value === 'string' ? parseInt(value.startsWith('0x') ? value : value, value.startsWith('0x') ? 16 : 10) : Number(value);
                break;
        case 6: common.lineType = value; break;
        case 48: common.lineTypeScale = parseFloat(value); break;
        case 370: common.lineweight = parseInt(value, 10); break;
        case 440: common.transparency = parseInt(value, 10); break;
        case 60: common.visible = parseInt(value, 10) === 0; break;
        case 67: common.inPaperSpace = parseInt(value, 10) === 1; break;
        case 330: if (!common.ownerHandle) common.ownerHandle = value; break;
        case 410: common.layoutName = value; break;
        case 210: common.extrusion.x = parseFloat(value); break;
        case 220: common.extrusion.y = parseFloat(value); break;
        case 230: common.extrusion.z = parseFloat(value); break;
    }
};

/**
 * 从组对象直接应用通用属性：数值组码走原位解析的 g.float（零分配），
 * 字符串组码才物化 g.value。与 applyCommonGroup 语义逐字段一致。
 */
export const applyCommonGroupFrom = (common: any, g: DxfGroup): void => {
    switch (g.code) {
        case 5: common.handle = g.value; break;
        case 8: common.layer = g.value; break;
        case 62: common.color = g.float | 0; break;
        case 420: {
            // 组码 420 是真彩色（24位整数），历史文件可能带 0x 前缀
            const value = g.value;
            common.trueColor = value.startsWith('0x') ? parseInt(value, 16) : parseInt(value, 10);
            break;
        }
        case 6: common.lineType = g.value; break;
        case 48: common.lineTypeScale = g.float; break;
        case 370: common.lineweight = g.float | 0; break;
        case 440: common.transparency = g.float | 0; break;
        case 60: common.visible = g.float === 0; break;
        case 67: common.inPaperSpace = g.float === 1; break;
        case 330: if (!common.ownerHandle) common.ownerHandle = g.value; break;
        case 410: common.layoutName = g.value; break;
        case 210: common.extrusion.x = g.float; break;
        case 220: common.extrusion.y = g.float; break;
        case 230: common.extrusion.z = g.float; break;
    }
};
