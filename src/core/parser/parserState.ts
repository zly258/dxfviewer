import { Point2D, DxfEntity } from '@/types';
import { CAD_BY_LAYER_COLOR } from '@/config/cadConstants';

/** 与 String.prototype.trim() 一致的常见空白字符（ASCII + NBSP + BOM）。 */
const isWhitespaceCode = (code: number): boolean =>
  code === 32 || code === 9 || code === 10 || code === 11 || code === 12 || code === 13
  || code === 160 || code === 65279;

/**
 * DXF 解析状态机类，负责逐行读取和预读组码。
 *
 * 性能要点：大图纸的组码行有百万级，逐行 substring + trim + parseInt 会产生
 * 数倍于实体数的临时字符串。此处组码行直接在原文上按字符区间解析数字
 * （零分配），值行只做一次扫描定界 + 单次 substring。
 */
export class DxfParserState {
  private text: string;
  private pos: number = 0;
  private len: number;
  private currentGroup: { code: number, value: string } | null = null;
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

    this.currentGroup = {
      code,
      value: this.text.substring(valueBounds.start, valueBounds.end),
    };
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
        return parseFloat(p.value);
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
            return { x: parseFloat(p1.value), y: parseFloat(p2.value) };
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
        if (p.code === 10) { state.next(); x = parseFloat(p.value); }
        else if (p.code === 20) { state.next(); y = parseFloat(p.value); }
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
