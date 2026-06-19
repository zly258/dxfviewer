import { Point2D, DxfEntity, Point3D } from '../../types';
import { CAD_BY_LAYER_COLOR } from '../../shared/constants/cadConstants';

/**
 * DXF 解析状态机类，负责逐行读取和 Peek 组码
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

  private readLine(): string | null {
    if (this.pos >= this.len) return null;
    let end = this.text.indexOf('\n', this.pos);
    if (end === -1) end = this.len;
    // 提取行并修整空白字符（处理 \r\n）
    const line = this.text.substring(this.pos, end).trim();
    this.pos = end + 1;
    this.linesRead++;
    return line;
  }

  peek() {
    if (this.groupLoaded) return this.currentGroup;
    
    let codeStr = this.readLine();
    // 循环跳过可能导致 peek() 无限递归的空行
    while (codeStr === "" && this.pos < this.len) {
        codeStr = this.readLine();
    }
    
    if (codeStr === null) return null;
    
    const valueStr = this.readLine();
    if (valueStr === null) return null; 

    const code = parseInt(codeStr, 10);
    // 处理如果文件损坏导致 parseInt 返回 NaN 的情况
    if (isNaN(code)) {
        // 如果遇到 NaN，文件结构可能已损坏。
        // 跳过此 "code" 并返回 null 以打破解析循环。
        return null;
    }

    this.currentGroup = { code, value: valueStr };
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

/**
 * 构造一个基础 DXF 实体默认属性对象
 */
export const parseCommon = (_state: DxfParserState): DxfEntity => {
    return {
        id: crypto.randomUUID(),
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
        case 210: common.extrusion.x = parseFloat(value); break;
        case 220: common.extrusion.y = parseFloat(value); break;
        case 230: common.extrusion.z = parseFloat(value); break;
    }
};
