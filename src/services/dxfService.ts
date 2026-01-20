import { AnyEntity, DxfData, EntityType, DxfLayer, DxfBlock, Point2D, Point3D, DxfHatch, HatchLoop, HatchEdge, DxfStyle, DxfPolyline, DxfInsert, DxfHeader, DxfSpline, DxfText, DxfLeader, DxfTable, DxfLineType } from '../types';
export { cleanMText };
import { cleanMText } from '../utils/textUtils';

class DxfParserState {
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

const readVal = (state: DxfParserState, code: number): number | null => {
    const p = state.peek();
    if (p && p.code === code) {
        state.next();
        return parseFloat(p.value);
    }
    return null;
};

const readPoint = (state: DxfParserState, xCode: number, yCode: number): Point2D | null => {
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

const parseLayer = (state: DxfParserState): DxfLayer => {
    const layer: DxfLayer = { name: '', color: 7, isVisible: true, lineType: 'Continuous' };
    while(state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        switch(g.code) {
            case 2: layer.name = g.value; break;
            case 62: layer.color = parseInt(g.value); break;
            case 420: 
                    const val = String(g.value);
                    layer.trueColor = parseInt(val.startsWith('0x') ? val : val, val.startsWith('0x') ? 16 : 10); 
                    break;
            case 6: layer.lineType = g.value; break;
            case 70: layer.isVisible = (parseInt(g.value) & 1) !== 1; break; 
        }
    }
    if (layer.color < 0) {
        layer.isVisible = false;
        layer.color = Math.abs(layer.color);
    }
    return layer;
};

const parseStyle = (state: DxfParserState): DxfStyle => {
    const style: DxfStyle = { name: '', fontFileName: 'txt', height: 0, widthFactor: 1 };
    while(state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        switch(g.code) {
            case 2: style.name = g.value; break;
            case 3: style.fontFileName = g.value; break;
            case 4: style.bigFontFileName = g.value; break;
            case 40: style.height = parseFloat(g.value); break;
            case 41: style.widthFactor = parseFloat(g.value); break;
        }
    }
    return style;
};

const parseLineType = (state: DxfParserState): DxfLineType => {
    const ltype: DxfLineType = { name: '', pattern: [], totalLength: 0 };
    let parsedTotalLength = 0;
    while(state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        switch(g.code) {
            case 2: ltype.name = g.value; break;
            case 3: ltype.description = g.value; break;
            case 40: parsedTotalLength = parseFloat(g.value); break;
            case 49: ltype.pattern.push(parseFloat(g.value)); break;
        }
    }
    // 从模式计算总长度以提高精度
    if (ltype.pattern.length > 0) {
        ltype.totalLength = ltype.pattern.reduce((acc, val) => acc + Math.abs(val), 0);
    } else {
        ltype.totalLength = parsedTotalLength;
    }
    return ltype;
};

const parseTable = (state: DxfParserState, layers: Record<string, DxfLayer>, styles: Record<string, DxfStyle>, lineTypes: Record<string, DxfLineType>, blockHandleMap?: Record<string, string>) => {
    const nameGroup = state.next();
    if (!nameGroup || nameGroup.code !== 2) return;
    const tableName = nameGroup.value;

    while(state.hasNext) {
        const p = state.peek();
        if (!p) break;
        if (p.code === 0) {
            if (p.value === 'ENDTAB') {
                state.next();
                break;
            }
            if (tableName === 'LAYER' && p.value === 'LAYER') {
                state.next();
                const layer = parseLayer(state);
                layers[layer.name] = layer;
            } else if (tableName === 'STYLE' && p.value === 'STYLE') {
                state.next();
                const style = parseStyle(state);
                styles[style.name] = style;
            } else if (tableName === 'LTYPE' && p.value === 'LTYPE') {
                state.next();
                const ltype = parseLineType(state);
                lineTypes[ltype.name] = ltype;
            } else if (tableName === 'BLOCK_RECORD' && p.value === 'BLOCK_RECORD') {
                state.next();
                let handle = '';
                let name = '';
                while(state.hasNext) {
                    const p2 = state.peek();
                    if (!p2 || p2.code === 0) break;
                    const g2 = state.next()!;
                    if (g2.code === 5) handle = g2.value;
                    if (g2.code === 2) name = g2.value;
                }
                if (handle && name && blockHandleMap) {
                    blockHandleMap[handle] = name;
                }
            } else {
                state.next(); 
            }
        } else {
            state.next();
        }
    }
}

const parseBlock = (state: DxfParserState, blockHandleMap?: Record<string, string>): DxfBlock | null => {
    const block: DxfBlock = { name: '', basePoint: {x:0, y:0}, entities: [] };
    while(state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break; 
        const g = state.next()!;
        if (g.code === 2) block.name = g.value;
        if (g.code === 10) block.basePoint.x = parseFloat(g.value);
        if (g.code === 20) block.basePoint.y = parseFloat(g.value);
        if (g.code === 5) block.handle = g.value; // 块句柄
    }

    while(state.hasNext) {
        const p = state.peek();
        if (!p) break;
        if (p.code === 0) {
            if (p.value === 'ENDBLK') {
                state.next();
                break;
            }
            state.next(); // 消耗实体类型组 (code 0)
            const entity = parseEntityDispatcher(p.value, state, blockHandleMap);
            if (entity) block.entities.push(entity);
        } else {
            state.next();
        }
    }
    return block;
};

export const getBSplinePoints = (controlPoints: Point2D[], degree: number = 3, knots?: number[], weights?: number[], segments?: number): Point2D[] => {
    if (!controlPoints || controlPoints.length === 0) return [];
    if (controlPoints.length < degree + 1) return controlPoints;

    const n = controlPoints.length - 1;
    const p = degree;
    
    const segs = segments && segments > 0 ? segments : Math.max(100, controlPoints.length * 10);

    let U = knots;
    if (!U || U.length === 0) {
        U = [];
        for (let i = 0; i <= p; i++) U.push(0);
        for (let i = 1; i < n - p + 1; i++) U.push(i / (n - p + 1));
        for (let i = 0; i <= p; i++) U.push(1);
    }

    if (U.length < n + p + 2) return controlPoints; 

    const domainStart = U[p];
    const domainEnd = U[U.length - 1 - p];
    const result: Point2D[] = [];

    for (let tStep = 0; tStep <= segs; tStep++) {
        let t = domainStart + (domainEnd - domainStart) * (tStep / segs);
        if (tStep === segs) t = domainEnd - 0.000001; 

        let k = -1;
        for (let i = p; i < U.length - 1 - p; i++) {
            if (t >= U[i] && t < U[i+1]) {
                k = i;
                break;
            }
        }
        if (k === -1) k = U.length - p - 2; 

        const d: {x:number, y:number, w:number}[] = [];
        for(let j=0; j<=p; j++) {
            const idx = k - p + j;
            const w = weights && weights[idx] !== undefined ? weights[idx] : 1;
            d.push({
                x: controlPoints[idx].x * w,
                y: controlPoints[idx].y * w,
                w: w
            });
        }

        for(let r=1; r<=p; r++) {
            for(let j=p; j>=r; j--) {
                const denominator = U[k + 1 + j - r] - U[k - p + j];
                const alpha = denominator === 0 ? 0 : (t - U[k - p + j]) / denominator;
                const p1 = d[j];
                const p2 = d[j-1];
                d[j] = {
                    x: (1 - alpha) * p2.x + alpha * p1.x,
                    y: (1 - alpha) * p2.y + alpha * p1.y,
                    w: (1 - alpha) * p2.w + alpha * p1.w
                };
            }
        }
        
        const wVal = d[p].w !== 0 ? d[p].w : 1;
        result.push({ x: d[p].x / wVal, y: d[p].y / wVal });
    }
    return result;
};

const getOcsToWcsMatrix = (Nx: number, Ny: number, Nz: number) => {
    const len = Math.sqrt(Nx*Nx + Ny*Ny + Nz*Nz);
    if (len < 1e-6) return null; // 法线向量太短
    Nx /= len; Ny /= len; Nz /= len;

    if (Math.abs(Nx) < 1e-6 && Math.abs(Ny) < 1e-6 && Math.abs(Nz - 1) < 1e-6) return null; // 已经是 WCS

    let Ax: Point3D;
    if (Math.abs(Nx) < 1/64 && Math.abs(Ny) < 1/64) {
        Ax = { x: Nz, y: 0, z: -Nx };
    } else {
        Ax = { x: -Ny, y: Nx, z: 0 };
    }
    
    const lenAx = Math.sqrt(Ax.x*Ax.x + Ax.y*Ax.y + Ax.z*Ax.z);
    Ax.x /= lenAx; Ax.y /= lenAx; Ax.z /= lenAx;

    const Ay = {
        x: Ny * Ax.z - Nz * Ax.y,
        y: Nz * Ax.x - Nx * Ax.z,
        z: Nx * Ax.y - Ny * Ax.x
    };
    const lenAy = Math.sqrt(Ay.x*Ay.x + Ay.y*Ay.y + Ay.z*Ay.z);
    Ay.x /= lenAy; Ay.y /= lenAy; Ay.z /= lenAy;
    
    const Az = { x: Nx, y: Ny, z: Nz };
    return { Ax, Ay, Az };
};

const applyOcs = (p: {x: number, y: number}, matrix: ReturnType<typeof getOcsToWcsMatrix>, elevation: number = 0): Point2D => {
    if (!matrix) return p;
    const x = p.x * matrix.Ax.x + p.y * matrix.Ay.x + elevation * matrix.Az.x;
    const y = p.x * matrix.Ax.y + p.y * matrix.Ay.y + elevation * matrix.Az.y;
    return { x, y };
};

const getWcsRotation = (rotation: number, ocs: ReturnType<typeof getOcsToWcsMatrix>) => {
    if (!ocs) return rotation;
    const rad = rotation * Math.PI / 180;
    const lx = Math.cos(rad);
    const ly = Math.sin(rad);
    const wx = lx * ocs.Ax.x + ly * ocs.Ay.x;
    const wy = lx * ocs.Ax.y + ly * ocs.Ay.y;
    return Math.atan2(wy, wx) * 180 / Math.PI;
};

export const parseDxf = async (dxfString: string, onProgress?: (percent: number) => void): Promise<DxfData> => {
  const state = new DxfParserState(dxfString);
  const entities: AnyEntity[] = [];
  const layers: Record<string, DxfLayer> = {};
  const blocks: Record<string, DxfBlock> = {};
  const styles: Record<string, DxfStyle> = {};
  const lineTypes: Record<string, DxfLineType> = {};
  const blockHandleMap: Record<string, string> = {}; 
  let header: DxfHeader | undefined;
  
  layers['0'] = { name: '0', color: 7, isVisible: true };
  styles['STANDARD'] = { name: 'STANDARD', fontFileName: 'txt', height: 0, widthFactor: 1 };
  lineTypes['CONTINUOUS'] = { name: 'CONTINUOUS', pattern: [], totalLength: 0 };

  // 进度估计的总大小：字符串长度 / 每行约 15 字节
  const estimatedTotalLines = dxfString.length / 15; 
  let lastReportedProgress = 0;
  let currentSection = '';
  let linesProcessed = 0;

  while (state.hasNext) {
    // 更频繁地让出主线程（每 500 行），以防止 UI 冻结
    if (state.linesRead > linesProcessed + 500) {
        linesProcessed = state.linesRead;
        const percent = Math.min(99, Math.round((state.linesRead / estimatedTotalLines) * 100));
        if (onProgress) onProgress(percent);
        // 即使百分比没有改变也强制让出主线程，以保持 UI 响应
        await new Promise(resolve => setTimeout(resolve, 0));
    }

    const group = state.next();
    if (!group) break;

    if (group.code === 0 && group.value === 'SECTION') {
      const next = state.next();
      if (next?.code === 2) currentSection = next.value;
    } else if (group.code === 0 && group.value === 'ENDSEC') {
      currentSection = '';
    } else {
      if (currentSection === 'HEADER') {
         if (!header) header = { extMin: {x:0, y:0}, extMax: {x:0, y:0}, insUnits: 0, ltScale: 1.0 };
         if (group.code === 9) {
             const v = group.value;
             if (v === '$EXTMIN') header.extMin = parsePoint(state);
             else if (v === '$EXTMAX') header.extMax = parsePoint(state);
             else if (v === '$INSUNITS') {
                 const n = state.next();
                 if (n && n.code === 70) header.insUnits = parseInt(n.value);
             } else if (v === '$LTSCALE') {
                 const n = state.next();
                 if (n && n.code === 40) header.ltScale = parseFloat(n.value);
             }
         }
      } else if (currentSection === 'TABLES') {
        if (group.code === 0 && group.value === 'TABLE') parseTable(state, layers, styles, lineTypes, blockHandleMap);
      } else if (currentSection === 'BLOCKS') {
        if (group.code === 0 && group.value === 'BLOCK') {
           const block = parseBlock(state, blockHandleMap);
           if (block) {
               blocks[block.name] = block;
               if (block.handle) blockHandleMap[block.handle] = block.name;
           }
        }
      } else if (currentSection === 'ENTITIES') {
        if (group.code === 0) {
          if (group.value === 'SEQEND') continue; 
          const entity = parseEntityDispatcher(group.value, state, blockHandleMap);
          if (entity && entity.visible !== false && !entity.inPaperSpace) {
             entities.push(entity);
          }
        }
      }
    }
  }

  if (onProgress) onProgress(100);

  // 预计算块范围，用于裁剪和全局范围计算
  // 1. 在原始坐标上进行初始预计算（以获得正确的初始中心）
  precomputeBlockExtents(blocks);

  // 2. 计算初始全局范围以找到中心点
  const initialExtents = calculateExtents(entities, blocks);
  const offset = { x: initialExtents.center.x, y: initialExtents.center.y };

  // 3. 将所有内容偏移到以 (0,0) 为中心
  // 这是修复浮点精度问题的“工业标准”方法
  entities.forEach(ent => offsetEntity(ent, offset));
  
  // 同时偏移所有块及其内容
  Object.values(blocks).forEach(block => {
    block.basePoint.x -= offset.x;
    block.basePoint.y -= offset.y;
    block.entities.forEach(ent => offsetEntity(ent, offset));
  });

  // 4. 重新预计算块范围（现在处于偏移后的坐标系中）
  precomputeBlockExtents(blocks);

  // 5. 为偏移后的实体重新计算最终全局范围
  const extents = calculateExtents(entities, blocks);

  return { header, entities, layers, blocks, styles, lineTypes, offset, extents };
};

const offsetEntity = (ent: AnyEntity, offset: Point2D) => {
    const ox = offset.x;
    const oy = offset.y;

    switch (ent.type) {
        case EntityType.LINE:
            ent.start.x -= ox; ent.start.y -= oy;
            ent.end.x -= ox; ent.end.y -= oy;
            break;
        case EntityType.CIRCLE:
        case EntityType.ARC:
        case EntityType.ELLIPSE:
            ent.center.x -= ox; ent.center.y -= oy;
            break;
        case EntityType.LWPOLYLINE:
        case EntityType.POLYLINE:
        case EntityType.LEADER:
        case EntityType.SOLID:
        case EntityType.THREEDFACE:
            if (ent.points) {
                ent.points.forEach(p => { p.x -= ox; p.y -= oy; });
            }
            break;
        case EntityType.SPLINE:
            if (ent.controlPoints) ent.controlPoints.forEach(p => { p.x -= ox; p.y -= oy; });
            if (ent.fitPoints) ent.fitPoints.forEach(p => { p.x -= ox; p.y -= oy; });
            if (ent.calculatedPoints) ent.calculatedPoints.forEach(p => { p.x -= ox; p.y -= oy; });
            break;
        case EntityType.POINT:
        case EntityType.TEXT:
        case EntityType.MTEXT:
        case EntityType.ATTRIB:
        case EntityType.ATTDEF:
        case EntityType.INSERT:
        case EntityType.ACAD_TABLE:
            ent.position.x -= ox; ent.position.y -= oy;
            if ((ent as any).secondPosition) {
                (ent as any).secondPosition.x -= ox;
                (ent as any).secondPosition.y -= oy;
            }
            break;
        case EntityType.RAY:
        case EntityType.XLINE:
            ent.basePoint.x -= ox; ent.basePoint.y -= oy;
            break;
        case EntityType.HATCH:
            if (ent.loops) {
                ent.loops.forEach(loop => {
                    if (loop.points) loop.points.forEach(p => { p.x -= ox; p.y -= oy; });
                    if (loop.edges) loop.edges.forEach(edge => {
                        if (edge.start) { edge.start.x -= ox; edge.start.y -= oy; }
                        if (edge.end) { edge.end.x -= ox; edge.end.y -= oy; }
                        if (edge.center) { edge.center.x -= ox; edge.center.y -= oy; }
                        if (edge.controlPoints) edge.controlPoints.forEach(p => { p.x -= ox; p.y -= oy; });
                        if (edge.calculatedPoints) edge.calculatedPoints.forEach(p => { p.x -= ox; p.y -= oy; });
                    });
                });
            }
            break;
        case EntityType.DIMENSION:
            ent.definitionPoint.x -= ox; ent.definitionPoint.y -= oy;
            if (ent.textMidPoint) { ent.textMidPoint.x -= ox; ent.textMidPoint.y -= oy; }
            if (ent.linearP1) { ent.linearP1.x -= ox; ent.linearP1.y -= oy; }
            if (ent.linearP2) { ent.linearP2.x -= ox; ent.linearP2.y -= oy; }
            if (ent.arcP1) { ent.arcP1.x -= ox; ent.arcP1.y -= oy; }
            if (ent.arcP2) { ent.arcP2.x -= ox; ent.arcP2.y -= oy; }
            break;
    }
    // 更新偏移后实体的范围
    if (ent.extents) {
        ent.extents.min.x -= ox; ent.extents.min.y -= oy;
        ent.extents.max.x -= ox; ent.extents.max.y -= oy;
    }
};

const parsePoint = (state: DxfParserState): Point2D => {
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
}

const parseCommon = (state: DxfParserState): any => {
    return {
        id: crypto.randomUUID(),
        handle: '',
        layer: '0',
        color: 256,
        lineType: 'ByLayer',
        lineTypeScale: 1.0,
        visible: true,
        extrusion: { x: 0, y: 0, z: 1 },
        inPaperSpace: false
    };
}

const applyCommonGroup = (common: any, code: number, value: string) => {
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
        case 60: common.visible = parseInt(value, 10) === 0; break;
        case 67: common.inPaperSpace = parseInt(value, 10) === 1; break;
        case 210: common.extrusion.x = parseFloat(value); break;
        case 220: common.extrusion.y = parseFloat(value); break;
        case 230: common.extrusion.z = parseFloat(value); break;
    }
}

const parseEntityDispatcher = (type: string, state: DxfParserState, blockHandleMap?: Record<string, string>): AnyEntity | null => {
    const common = parseCommon(state);
    switch (type) {
        case 'LINE': return parseLine(state, common);
        case 'CIRCLE': return parseCircle(state, common);
        case 'ARC': return parseArc(state, common);
        case 'LWPOLYLINE': return parseLwPolyline(state, common);
        case 'POLYLINE': return parsePolyline(state, common);
        case 'INSERT': return parseInsert(state, common);
        case 'TEXT': return parseText(state, common, EntityType.TEXT);
        case 'MTEXT': return parseText(state, common, EntityType.MTEXT);
        case 'ATTDEF': return parseText(state, common, EntityType.ATTDEF);
        case 'ATTRIB': return parseText(state, common, EntityType.ATTRIB);
        case 'POINT': return parsePointEntity(state, common);
        case 'SOLID': case 'TRACE': case '3DFACE': return parseSolid(state, common, type);
        case 'SPLINE': return parseSpline(state, common);
        case 'ELLIPSE': return parseEllipse(state, common);
        case 'HATCH': return parseHatch(state, common);
        case 'DIMENSION': return parseDimension(state, common);
        case 'LEADER': return parseLeader(state, common);
        case 'ACAD_TABLE': return parseAcadTable(state, common, blockHandleMap);
        case 'RAY':
        case 'XLINE':
            return parseRayXLine(state, common, type);
        default: 
            // 至关重要：通过消耗所有组码直到下一个实体（代码 0），安全地跳过未知实体
            while (state.hasNext) {
                const p = state.peek();
                if (!p || p.code === 0) break;
                state.next();
            }
            return null;
    }
}

const parseAcadTable = (state: DxfParserState, common: any, blockHandleMap?: Record<string, string>): DxfTable | null => {
    const entity: DxfTable = { 
        ...common, 
        type: EntityType.ACAD_TABLE, 
        blockName: '', 
        position: {x:0, y:0},
        scale: {x:1, y:1, z:1},
        rotation: 0
    };
    
    let z = 0;
    let blockHandle = '';
    let direction = {x: 1, y: 0, z: 0};

    while(state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroup(entity, g.code, g.value);
        switch(g.code) {
            case 2: entity.blockName = g.value; break; 
            case 10: entity.position.x = parseFloat(g.value); break;
            case 20: entity.position.y = parseFloat(g.value); break;
            case 30: z = parseFloat(g.value); break;
            case 50: entity.rotation = parseFloat(g.value); break;
            case 342: blockHandle = g.value; break; 
            case 11: direction.x = parseFloat(g.value); break; 
            case 21: direction.y = parseFloat(g.value); break; 
            case 31: direction.z = parseFloat(g.value); break;
            case 41: entity.scale!.x = parseFloat(g.value); break;
            case 42: entity.scale!.y = parseFloat(g.value); break;
            case 43: entity.scale!.z = parseFloat(g.value); break;
            case 91: entity.rowCount = parseInt(g.value); break;
            case 92: entity.columnCount = parseInt(g.value); break;
            case 141: entity.rowSpacing = parseFloat(g.value); break; // 某些版本使用 141/142 表示行/列间距
            case 142: entity.columnSpacing = parseFloat(g.value); break;
            case 44: entity.columnSpacing = parseFloat(g.value); break;
            case 45: entity.rowSpacing = parseFloat(g.value); break;
            case 1: 
                if (!entity.cells) entity.cells = [];
                entity.cells.push(g.value);
                break;
        }
    }

    if (direction.x !== 1 || direction.y !== 0 || direction.z !== 0) {
        (entity as any).direction = direction;
        if (!entity.rotation) {
            entity.rotation = Math.atan2(direction.y, direction.x) * 180 / Math.PI;
        }
    }

    if (!entity.blockName && blockHandle && blockHandleMap) {
        entity.blockName = blockHandleMap[blockHandle] || '';
    }

    // 修复异常的行数解析
    // 某些情况下，组码 91 可能包含位掩码或其他非行数数据（例如 262129 = 0x40001）
    // 如果行数异常大且与单元格数量不匹配，则尝试根据单元格数量和列数推断
    if (entity.rowCount && entity.rowCount > 500 && entity.cells && entity.cells.length > 0) {
        const calculatedRows = Math.ceil(entity.cells.length / (entity.columnCount || 1));
        if (calculatedRows < entity.rowCount) {
            entity.rowCount = calculatedRows;
        }
    }
    
    // 如果行列数未定义但有单元格，进行推断
    if ((!entity.rowCount || entity.rowCount === 0) && entity.cells && entity.cells.length > 0) {
        entity.columnCount = entity.columnCount || 1;
        entity.rowCount = Math.ceil(entity.cells.length / entity.columnCount);
    }

    // 修复极小的间距（可能是单位问题或解析错误）
    // 如果间距小于 0.1 且没有显著的缩放，这通常是不正确的，强制给一个默认值
    // 这里假设图纸单位通常是 mm，文字高度通常在 2.5 左右
    const minSpacing = 1.0;
    if ((entity.rowSpacing || 0) < minSpacing && Math.abs(entity.scale!.y) > 0.1) {
        entity.rowSpacing = 10; // 默认行距
    }
    if ((entity.columnSpacing || 0) < minSpacing && Math.abs(entity.scale!.x) > 0.1) {
        entity.columnSpacing = 25; // 默认列距
    }

    const ocs = getOcsToWcsMatrix(entity.extrusion!.x, entity.extrusion!.y, entity.extrusion!.z);
    entity.position = applyOcs(entity.position, ocs, z);
    if (entity.rotation) {
        entity.rotation = getWcsRotation(entity.rotation, ocs);
    }

    return entity;
}

const parseText = (state: DxfParserState, common: any, type: EntityType): DxfText => {
    const entity: any = { 
        ...common, 
        type: type, 
        position: {x:0, y:0}, 
        height: 0, 
        value: "", 
        rotation: 0, 
        widthFactor: 0, 
        hAlign: 0, vAlign: 0
    };
    
    let z = 0;
    const valueParts: string[] = [];
    let secondPos: Point2D | undefined;
    let direction: Point2D | undefined;
    let z2 = 0;

    while(state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroup(entity, g.code, g.value);
        switch(g.code) {
            case 1: valueParts.push(g.value); break;
            case 3: valueParts.unshift(g.value); break; 
            case 10: entity.position.x = parseFloat(g.value); break;
            case 20: entity.position.y = parseFloat(g.value); break;
            case 30: z = parseFloat(g.value); break;
            case 40: entity.height = parseFloat(g.value); break;
            case 50: entity.rotation = parseFloat(g.value); break;
            case 41: 
                if (type === EntityType.MTEXT) {
                     entity.width = parseFloat(g.value);
                } else {
                     entity.widthFactor = parseFloat(g.value);
                }
                break;
            case 72: entity.hAlign = parseInt(g.value); break;
            case 73: entity.vAlign = parseInt(g.value); break;
            case 11: 
                if (type === EntityType.MTEXT) {
                    if (!direction) direction = {x:0, y:0};
                    direction.x = parseFloat(g.value);
                } else {
                    if (!secondPos) secondPos = {x:0, y:0};
                    secondPos.x = parseFloat(g.value); 
                }
                break;
            case 21: 
                if (type === EntityType.MTEXT) {
                    if (!direction) direction = {x:0, y:0};
                    direction.y = parseFloat(g.value);
                } else {
                    if (!secondPos) secondPos = {x:0, y:0};
                    secondPos.y = parseFloat(g.value); 
                }
                break;
            case 31: z2 = parseFloat(g.value); break;
            case 71: entity.attachmentPoint = parseInt(g.value); break; 
            case 43: entity.boxHeight = parseFloat(g.value); break; 
            case 2: if (type === EntityType.ATTDEF) entity.tag = g.value; break;
            case 70: if (type === EntityType.ATTDEF) entity.flags = parseInt(g.value); break;
            case 63: if (type === EntityType.MTEXT) entity.bgColor = parseInt(g.value); break;
            case 90: 
                if (type === EntityType.MTEXT) {
                    const mask = parseInt(g.value);
                    entity.bgFill = (mask & 1) === 1 || (mask & 2) === 2;
                }
                break;
            case 7: entity.styleName = g.value; break;
        }
    }
    entity.value = valueParts.join('');
    
    if (type === EntityType.MTEXT) {
        // 从原始值解析宽度因子
        // 支持 \W 和 \w，以及可选的分号
        const matches = entity.value.match(/\\[Ww](\d+(\.\d+)?)(?:;|$)/);
        if (matches && matches[1]) {
            entity.widthFactor = parseFloat(matches[1]);
        }
        // 此处不要清理，渲染器会进行清理。
        // 这允许渲染器查看字体/高度等格式化代码。
    }
    
    if (!entity.styleName) entity.styleName = 'STANDARD';
    if (!entity.height) entity.height = 0; 
    if (!entity.widthFactor) entity.widthFactor = 0; 

    const ocs = getOcsToWcsMatrix(entity.extrusion.x, entity.extrusion.y, entity.extrusion.z);
    
    if (type === EntityType.MTEXT) {
        if (direction && (Math.abs(direction.x) > 1e-6 || Math.abs(direction.y) > 1e-6)) {
             // 根据 DXF 规范，MTEXT 方向向量 (11, 21, 31) 已经在 WCS 中
             entity.rotation = Math.atan2(direction.y, direction.x) * 180 / Math.PI;
        } else {
             // MTEXT 旋转角度（代码 50）以弧度为单位，并且已经在 WCS 中
             entity.rotation = entity.rotation * 180 / Math.PI;
        }
        // 根据 DXF 规范，MTEXT 位置 (10, 20, 30) 已经在 WCS 中
    } else {
        entity.position = applyOcs(entity.position, ocs, z);
        if (secondPos) {
            entity.secondPosition = applyOcs(secondPos, ocs, z2);
        }
        entity.rotation = getWcsRotation(entity.rotation, ocs);
    }

    // 如果 2D 行列式为负，处理 OCS 的镜像
    if (ocs) {
        const det2D = ocs.Ax.x * ocs.Ay.y - ocs.Ax.y * ocs.Ay.x;
        if (det2D < 0) {
            // 对于镜像 OCS，我们需要翻转旋转或缩放以保持正确的外观。
            // 在 AutoCAD 中，镜像 OCS（如 Nz=-1）意味着从“背面”查看 2D 平面。
            if (type === EntityType.MTEXT) {
                // MTEXT 宽度已由方向或旋转处理。
                // 但宽度因子（如果有）或内部缩放可能需要翻转。
                entity.widthFactor = -(entity.widthFactor || 1);
            } else {
                entity.widthFactor = -(entity.widthFactor || 1);
            }
        }
    }
    
    return entity;
}

const parseRayXLine = (state: DxfParserState, common: any, type: string): AnyEntity => {
    const entity: any = { 
        ...common, 
        type: type === 'RAY' ? EntityType.RAY : EntityType.XLINE, 
        basePoint: {x:0, y:0}, 
        direction: {x:1, y:0} 
    };
    let z1 = 0, z2 = 0;
    while(state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroup(entity, g.code, g.value);
        switch(g.code) {
            case 10: entity.basePoint.x = parseFloat(g.value); break;
            case 20: entity.basePoint.y = parseFloat(g.value); break;
            case 30: z1 = parseFloat(g.value); break;
            case 11: entity.direction.x = parseFloat(g.value); break;
            case 21: entity.direction.y = parseFloat(g.value); break;
            case 31: z2 = parseFloat(g.value); break;
        }
    }
    const ocs = getOcsToWcsMatrix(entity.extrusion.x, entity.extrusion.y, entity.extrusion.z);
    entity.basePoint = applyOcs(entity.basePoint, ocs, z1);
    // 如果使用了 OCS，方向向量也应该旋转
    if (ocs) {
        const d = { x: entity.direction.x, y: entity.direction.y };
        entity.direction = applyOcs(d, ocs, z2);
        // 归一化方向
        const len = Math.sqrt(entity.direction.x * entity.direction.x + entity.direction.y * entity.direction.y);
        if (len > 0) {
            entity.direction.x /= len;
            entity.direction.y /= len;
        }
    }
    return entity;
}

const parseLine = (state: DxfParserState, common: any): AnyEntity => {
    const entity: any = { ...common, type: EntityType.LINE, start: {x:0, y:0}, end: {x:0, y:0} };
    let z1 = 0, z2 = 0;
    while(state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroup(entity, g.code, g.value);
        switch(g.code) {
            case 10: entity.start.x = parseFloat(g.value); break;
            case 20: entity.start.y = parseFloat(g.value); break;
            case 30: z1 = parseFloat(g.value); break;
            case 11: entity.end.x = parseFloat(g.value); break;
            case 21: entity.end.y = parseFloat(g.value); break;
            case 31: z2 = parseFloat(g.value); break;
        }
    }
    // 根据 DXF 规范，LINE 和 POINT 坐标已经在 WCS 中
    return entity;
}

const parseCircle = (state: DxfParserState, common: any): AnyEntity => {
    const entity: any = { ...common, type: EntityType.CIRCLE, center: {x:0, y:0}, radius: 0 };
    let z = 0;
    while(state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroup(entity, g.code, g.value);
        switch(g.code) {
            case 10: entity.center.x = parseFloat(g.value); break;
            case 20: entity.center.y = parseFloat(g.value); break;
            case 30: z = parseFloat(g.value); break;
            case 40: entity.radius = parseFloat(g.value); break;
        }
    }
    const ocs = getOcsToWcsMatrix(entity.extrusion.x, entity.extrusion.y, entity.extrusion.z);
    entity.center = applyOcs(entity.center, ocs, z);
    return entity;
}

const parseArc = (state: DxfParserState, common: any): AnyEntity => {
    const entity: any = { ...common, type: EntityType.ARC, center: {x:0, y:0}, radius: 0, startAngle: 0, endAngle: 0 };
    let z = 0;
    while(state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroup(entity, g.code, g.value);
        switch(g.code) {
            case 10: entity.center.x = parseFloat(g.value); break;
            case 20: entity.center.y = parseFloat(g.value); break;
            case 30: z = parseFloat(g.value); break;
            case 40: entity.radius = parseFloat(g.value); break;
            case 50: entity.startAngle = parseFloat(g.value); break;
            case 51: entity.endAngle = parseFloat(g.value); break;
        }
    }
    const ocs = getOcsToWcsMatrix(entity.extrusion.x, entity.extrusion.y, entity.extrusion.z);
    entity.center = applyOcs(entity.center, ocs, z);
    if (ocs) {
        const det2D = ocs.Ax.x * ocs.Ay.y - ocs.Ax.y * ocs.Ay.x;
        if (det2D < 0) {
            // 对于镜像 OCS，圆弧方向会反转。
            // 交换角度并取反，或根据旋转进行调整。
            // 一个更简单的方法：AutoCAD 表示如果 Nz < 0，则圆弧为顺时针 (CW)。
            // 我们可以将其存储在实体中供渲染器使用。
            entity.isCounterClockwise = false;
        } else {
            entity.isCounterClockwise = true;
        }
        entity.startAngle = getWcsRotation(entity.startAngle, ocs);
        entity.endAngle = getWcsRotation(entity.endAngle, ocs);
    }
    return entity;
}

const parseLwPolyline = (state: DxfParserState, common: any): DxfPolyline => {
    const points: Point2D[] = [];
    const bulges: number[] = [];
    let closed = false;
    let elevation = 0;
    
    let currX: number | null = null;
    let currY: number | null = null;
    let currBulge = 0;

    const flushVertex = () => {
        if (currX !== null && currY !== null) {
            points.push({x: currX, y: currY});
            bulges.push(currBulge);
            currX = null; currY = null; currBulge = 0;
        }
    }

    while(state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroup(common, g.code, g.value);
        switch(g.code) {
            case 38: elevation = parseFloat(g.value); break;
            case 70: closed = (parseInt(g.value) & 1) === 1; break;
            case 43: common.constantWidth = parseFloat(g.value); break;
            case 10: flushVertex(); currX = parseFloat(g.value); break;
            case 20: currY = parseFloat(g.value); break;
            case 42: currBulge = parseFloat(g.value); break;
        }
    }
    flushVertex();

    const ocs = getOcsToWcsMatrix(common.extrusion.x, common.extrusion.y, common.extrusion.z);
    if (ocs) {
        const det2D = ocs.Ax.x * ocs.Ay.y - ocs.Ax.y * ocs.Ay.x;
        const mirror = det2D < 0;
        for(let i=0; i<points.length; i++) {
            points[i] = applyOcs(points[i], ocs, elevation);
            if (mirror && bulges[i] !== 0) {
                bulges[i] = -bulges[i];
            }
        }
    }
    return { ...common, type: EntityType.LWPOLYLINE, points, bulges, closed };
}

const parsePolyline = (state: DxfParserState, common: any): DxfPolyline => {
    let closed = false;
    let is3DPolyline = false;
    let elevation = 0;
    while(state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroup(common, g.code, g.value);
        if (g.code === 70) {
             const flags = parseInt(g.value);
             closed = (flags & 1) === 1;
             is3DPolyline = (flags & 8) === 8;
        }
        if (g.code === 40 || g.code === 41) common.constantWidth = parseFloat(g.value);
        if (g.code === 30) elevation = parseFloat(g.value);
    }

    const points: Point2D[] = [];
    const bulges: number[] = [];
    while(state.hasNext) {
        const p = state.peek();
        if (!p) break;
        if (p.code === 0) {
            if (p.value === 'SEQEND') { state.next(); break; }
            if (p.value === 'VERTEX') {
                state.next();
                let x=0, y=0, z=0, b=0, valid = false;
                while(state.hasNext) {
                    const vp = state.peek();
                    if (!vp || vp.code === 0) break;
                    const vg = state.next()!;
                    if (vg.code === 10) { x = parseFloat(vg.value); valid = true; }
                    if (vg.code === 20) y = parseFloat(vg.value);
                    if (vg.code === 30) z = parseFloat(vg.value);
                    if (vg.code === 42) b = parseFloat(vg.value);
                }
                if (valid) {
                    points.push({x, y});
                    bulges.push(b);
                }
                continue;
            }
            break; 
        }
        state.next();
    }

    const ocs = getOcsToWcsMatrix(common.extrusion.x, common.extrusion.y, common.extrusion.z);
    if (ocs && !is3DPolyline) {
        const det2D = ocs.Ax.x * ocs.Ay.y - ocs.Ax.y * ocs.Ay.x;
        const mirror = det2D < 0;
        for(let i=0; i<points.length; i++) {
            points[i] = applyOcs(points[i], ocs, elevation);
            if (mirror && bulges[i] !== 0) {
                bulges[i] = -bulges[i];
            }
        }
    }
    return { ...common, type: EntityType.POLYLINE, points, bulges, closed };
}

const parseInsert = (state: DxfParserState, common: any): DxfInsert => {
    const entity: any = { 
        ...common, 
        type: EntityType.INSERT, 
        blockName: '', 
        position: {x:0, y:0}, 
        scale: {x:1, y:1, z:1}, 
        rotation: 0,
        rowCount: 1, colCount: 1, rowSpacing: 0, colSpacing: 0
    };
    let z = 0;
    let hasAttribs = false;

    while(state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroup(entity, g.code, g.value);
        switch(g.code) {
            case 2: entity.blockName = g.value; break;
            case 10: entity.position.x = parseFloat(g.value); break;
            case 20: entity.position.y = parseFloat(g.value); break;
            case 30: z = parseFloat(g.value); break;
            case 41: entity.scale.x = parseFloat(g.value); break;
            case 42: entity.scale.y = parseFloat(g.value); break;
            case 43: entity.scale.z = parseFloat(g.value); break;
            case 50: entity.rotation = parseFloat(g.value); break;
            case 70: entity.colCount = parseInt(g.value); break;
            case 71: entity.rowCount = parseInt(g.value); break;
            case 44: entity.colSpacing = parseFloat(g.value); break;
            case 45: entity.rowSpacing = parseFloat(g.value); break;
            case 66: hasAttribs = parseInt(g.value) === 1; break;
        }
    }

    const ocs = getOcsToWcsMatrix(entity.extrusion.x, entity.extrusion.y, entity.extrusion.z);
    entity.position = applyOcs(entity.position, ocs, z);
    entity.rotation = getWcsRotation(entity.rotation, ocs);

    if (ocs) {
        const det2D = ocs.Ax.x * ocs.Ay.y - ocs.Ax.y * ocs.Ay.x;
        if (det2D < 0) {
            // 在 OCS 中检测到镜像。翻转 X 轴缩放比例进行补偿。
            entity.scale.x = -entity.scale.x;
        }
    }

    if (hasAttribs) {
        entity.attributes = [];
        while(state.hasNext) {
            const p = state.peek();
            if (!p) break;
            if (p.code === 0) {
                if (p.value === 'SEQEND') { state.next(); break; }
                if (p.value === 'ATTRIB') {
                    state.next();
                    const attribCommon = parseCommon(state);
                    const attrib = parseText(state, attribCommon, EntityType.ATTRIB);
                    entity.attributes.push(attrib);
                    continue;
                }
                break;
            }
            state.next();
        }
    }
    return entity;
}

const parseLeader = (state: DxfParserState, common: any): DxfLeader => {
    const entity: any = { 
        ...common, 
        type: EntityType.LEADER, 
        points: [],
        arrowHeadFlag: 1, 
        pathType: 0,
        hasHookLine: false
    };
    let currX: number | null = null;
    while(state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroup(entity, g.code, g.value);
        switch(g.code) {
            case 71: entity.arrowHeadFlag = parseInt(g.value); break;
            case 72: entity.pathType = parseInt(g.value); break;
            case 75: entity.hasHookLine = parseInt(g.value) !== 0; break;
            case 340: entity.annotationHandle = g.value; break;
            case 10: currX = parseFloat(g.value); break;
            case 20: if (currX !== null) { entity.points.push({x: currX, y: parseFloat(g.value)}); currX = null; } break;
        }
    }
    const ocs = getOcsToWcsMatrix(entity.extrusion.x, entity.extrusion.y, entity.extrusion.z);
    if (ocs) {
        for(let i=0; i<entity.points.length; i++) {
             entity.points[i] = applyOcs(entity.points[i], ocs);
        }
    }
    return entity;
}

const parseSolid = (state: DxfParserState, common: any, type: string): AnyEntity => {
    const entity: any = { ...common, type: type === '3DFACE' ? EntityType.THREEDFACE : EntityType.SOLID, points: [] };
    const pts: ({x:number, y:number, z:number} | null)[] = [null, null, null, null];
    
    while(state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroup(entity, g.code, g.value);
        switch(g.code) {
            case 10: if (!pts[0]) pts[0] = {x:0, y:0, z:0}; pts[0].x = parseFloat(g.value); break;
            case 20: if (!pts[0]) pts[0] = {x:0, y:0, z:0}; pts[0].y = parseFloat(g.value); break;
            case 30: if (!pts[0]) pts[0] = {x:0, y:0, z:0}; pts[0].z = parseFloat(g.value); break;
            case 11: if (!pts[1]) pts[1] = {x:0, y:0, z:0}; pts[1].x = parseFloat(g.value); break;
            case 21: if (!pts[1]) pts[1] = {x:0, y:0, z:0}; pts[1].y = parseFloat(g.value); break;
            case 31: if (!pts[1]) pts[1] = {x:0, y:0, z:0}; pts[1].z = parseFloat(g.value); break;
            case 12: if (!pts[2]) pts[2] = {x:0, y:0, z:0}; pts[2].x = parseFloat(g.value); break;
            case 22: if (!pts[2]) pts[2] = {x:0, y:0, z:0}; pts[2].y = parseFloat(g.value); break;
            case 32: if (!pts[2]) pts[2] = {x:0, y:0, z:0}; pts[2].z = parseFloat(g.value); break;
            case 13: if (!pts[3]) pts[3] = {x:0, y:0, z:0}; pts[3].x = parseFloat(g.value); break;
            case 23: if (!pts[3]) pts[3] = {x:0, y:0, z:0}; pts[3].y = parseFloat(g.value); break;
            case 33: if (!pts[3]) pts[3] = {x:0, y:0, z:0}; pts[3].z = parseFloat(g.value); break;
            case 70: if (type === '3DFACE') entity.edgeFlags = parseInt(g.value); break;
        }
    }
    
    // 如果缺失点，则使用默认点
    if (!pts[0]) pts[0] = {x:0, y:0, z:0};
    if (!pts[1]) pts[1] = {x:0, y:0, z:0};
    if (!pts[2]) pts[2] = {x:0, y:0, z:0};
    // 针对 3 点 SOLID（例如箭头）的修复：如果缺失第 4 个点，则它等于第 3 个点。
    if (!pts[3]) pts[3] = { ...pts[2] };

    const ocs = getOcsToWcsMatrix(entity.extrusion.x, entity.extrusion.y, entity.extrusion.z);
    // SOLID 和 TRACE 使用 OCS 坐标，但 3DFACE 使用 WCS 坐标
    const transformed = (type === 'SOLID' || type === 'TRACE') 
        ? pts.map(p => applyOcs(p!, ocs, p!.z))
        : pts.map(p => ({ x: p!.x, y: p!.y }));
    
    if (type === 'SOLID' || type === 'TRACE') {
         entity.points = [transformed[0], transformed[1], transformed[3], transformed[2]]; 
    } else {
         entity.points = [transformed[0], transformed[1], transformed[2], transformed[3]];
    }

    return entity;
}

const parsePointEntity = (state: DxfParserState, common: any): AnyEntity => {
    const entity: any = { ...common, type: EntityType.POINT, position: {x:0, y:0} };
    let z = 0;
    while(state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroup(entity, g.code, g.value);
        if (g.code === 10) entity.position.x = parseFloat(g.value);
        if (g.code === 20) entity.position.y = parseFloat(g.value);
        if (g.code === 30) z = parseFloat(g.value);
    }
    // 根据 DXF 规范，POINT 坐标已经处于 WCS 坐标系中
    return entity;
}

const parseSpline = (state: DxfParserState, common: any): DxfSpline => {
    const entity: any = { 
        ...common, 
        type: EntityType.SPLINE, 
        controlPoints: [], 
        fitPoints: [], 
        knots: [], 
        weights: [],
        degree: 3, 
        flags: 0 
    };
    while(state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroup(entity, g.code, g.value);
        switch(g.code) {
            case 70: entity.flags = parseInt(g.value); break;
            case 71: entity.degree = parseInt(g.value); break;
            case 40: entity.knots.push(parseFloat(g.value)); break;
            case 41: entity.weights.push(parseFloat(g.value)); break;
            case 10: entity.controlPoints.push({x: parseFloat(g.value), y: 0}); break; 
            case 20: if (entity.controlPoints.length > 0) entity.controlPoints[entity.controlPoints.length-1].y = parseFloat(g.value); break;
            case 30: if (entity.controlPoints.length > 0) (entity.controlPoints[entity.controlPoints.length-1] as any).z = parseFloat(g.value); break;
            case 11: entity.fitPoints.push({x: parseFloat(g.value), y: 0}); break;
            case 21: if (entity.fitPoints.length > 0) entity.fitPoints[entity.fitPoints.length-1].y = parseFloat(g.value); break;
            case 31: if (entity.fitPoints.length > 0) (entity.fitPoints[entity.fitPoints.length-1] as any).z = parseFloat(g.value); break;
        }
    }
    
    // 根据 DXF 规范，SPLINE 控制点和拟合点已经处于 WCS 坐标系中
    
    // 预计算样条曲线点以实现更快的渲染
    if (entity.controlPoints.length > 0) {
        entity.calculatedPoints = getBSplinePoints(entity.controlPoints, entity.degree, entity.knots, entity.weights);
    }
    
    return entity;
}

const parseEllipse = (state: DxfParserState, common: any): AnyEntity => {
    const entity: any = { 
        ...common, 
        type: EntityType.ELLIPSE, 
        center: {x:0, y:0}, 
        majorAxis: {x:0, y:0}, 
        ratio: 1, startParam: 0, endParam: Math.PI*2 
    };
    let z = 0;
    while(state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroup(entity, g.code, g.value);
        switch(g.code) {
            case 10: entity.center.x = parseFloat(g.value); break;
            case 20: entity.center.y = parseFloat(g.value); break;
            case 30: z = parseFloat(g.value); break;
            case 11: entity.majorAxis.x = parseFloat(g.value); break;
            case 21: entity.majorAxis.y = parseFloat(g.value); break;
            case 31: // 长轴终点的 Z 坐标 - 在 2D 显示中忽略
                break;
            case 40: entity.ratio = parseFloat(g.value); break;
            case 41: entity.startParam = parseFloat(g.value); break;
            case 42: entity.endParam = parseFloat(g.value); break;
        }
    }
    // 根据 DXF 规范，ELLIPSE 中心和长轴已经处于 WCS 坐标系中
    return entity;
}

const parseDimension = (state: DxfParserState, common: any): AnyEntity => {
    const entity: any = { 
        ...common, 
        type: EntityType.DIMENSION, 
        blockName: '', 
        definitionPoint: {x:0, y:0}, 
        textMidPoint: {x:0, y:0}, 
        linearP1: {x:0, y:0},
        linearP2: {x:0, y:0},
        arcP1: {x:0, y:0},
        arcP2: {x:0, y:0},
        dimType: 0, 
        text: '', 
        measurement: 0 
    };
    let z1=0, z2=0, z3=0, z4=0, z5=0, z6=0;
    while(state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break;
        const g = state.next()!;
        applyCommonGroup(entity, g.code, g.value);
        switch(g.code) {
            case 2: entity.blockName = g.value; break;
            case 10: entity.definitionPoint.x = parseFloat(g.value); break;
            case 20: entity.definitionPoint.y = parseFloat(g.value); break;
            case 30: z1 = parseFloat(g.value); break;
            case 11: entity.textMidPoint.x = parseFloat(g.value); break;
            case 21: entity.textMidPoint.y = parseFloat(g.value); break;
            case 31: z2 = parseFloat(g.value); break;
            case 13: if (!entity.linearP1) entity.linearP1 = {x:0, y:0}; entity.linearP1.x = parseFloat(g.value); break;
            case 23: if (!entity.linearP1) entity.linearP1 = {x:0, y:0}; entity.linearP1.y = parseFloat(g.value); break;
            case 33: z3 = parseFloat(g.value); break;
            case 14: if (!entity.linearP2) entity.linearP2 = {x:0, y:0}; entity.linearP2.x = parseFloat(g.value); break;
            case 24: if (!entity.linearP2) entity.linearP2 = {x:0, y:0}; entity.linearP2.y = parseFloat(g.value); break;
            case 34: z4 = parseFloat(g.value); break;
            case 15: if (!entity.arcP1) entity.arcP1 = {x:0, y:0}; entity.arcP1.x = parseFloat(g.value); break;
            case 25: if (!entity.arcP1) entity.arcP1 = {x:0, y:0}; entity.arcP1.y = parseFloat(g.value); break;
            case 35: z5 = parseFloat(g.value); break;
            case 16: if (!entity.arcP2) entity.arcP2 = {x:0, y:0}; entity.arcP2.x = parseFloat(g.value); break;
            case 26: if (!entity.arcP2) entity.arcP2 = {x:0, y:0}; entity.arcP2.y = parseFloat(g.value); break;
            case 36: z6 = parseFloat(g.value); break;
            case 70: entity.dimType = parseInt(g.value); break;
            case 1: entity.text = g.value; break;
            case 42: entity.measurement = parseFloat(g.value); break;
            case 3: entity.styleName = g.value; break;
        }
    }
    const ocs = getOcsToWcsMatrix(entity.extrusion.x, entity.extrusion.y, entity.extrusion.z);
    entity.definitionPoint = applyOcs(entity.definitionPoint, ocs, z1);
    entity.textMidPoint = applyOcs(entity.textMidPoint, ocs, z2);
    if (entity.linearP1) entity.linearP1 = applyOcs(entity.linearP1, ocs, z3);
    if (entity.linearP2) entity.linearP2 = applyOcs(entity.linearP2, ocs, z4);
    if (entity.arcP1) entity.arcP1 = applyOcs(entity.arcP1, ocs, z5);
    if (entity.arcP2) entity.arcP2 = applyOcs(entity.arcP2, ocs, z6);
    return entity;
}

const parseHatch = (state: DxfParserState, common: any): DxfHatch => {
    const entity: any = { 
        ...common, 
        type: EntityType.HATCH, 
        patternName: 'SOLID', 
        solid: false, 
        loops: [], 
        scale: 1, 
        angle: 0 
    };
    let currentLoop: HatchLoop | null = null;
    let edgesToRead = 0;
    let elevation = 0;
    while (state.hasNext) {
        const next = state.peek();
        if (!next || next.code === 0) break;
        const g = state.next()!;
        applyCommonGroup(entity, g.code, g.value);

        if (g.code === 30) elevation = parseFloat(g.value);
        if (g.code === 2) entity.patternName = g.value;
        if (g.code === 70) entity.solid = (parseInt(g.value) & 1) === 1;
        if (g.code === 41) entity.scale = parseFloat(g.value);
        if (g.code === 52) entity.angle = parseFloat(g.value);
        
        if (g.code === 92) {
            if (currentLoop) entity.loops.push(currentLoop); // 保存上一个循环
            const type = parseInt(g.value);
            currentLoop = { type, edges: [], isPolyline: (type & 2) === 2, points: [], bulges: [] };
            edgesToRead = 0;
        }
        if (currentLoop) {
            if (currentLoop.isPolyline) {
                if (g.code === 10) { currentLoop.points!.push({ x: parseFloat(g.value), y: 0 }); currentLoop.bulges!.push(0); }
                if (g.code === 20 && currentLoop.points!.length > 0) currentLoop.points![currentLoop.points!.length - 1].y = parseFloat(g.value);
                if (g.code === 42 && currentLoop.bulges!.length > 0) currentLoop.bulges![currentLoop.bulges!.length - 1] = parseFloat(g.value);
            } else {
                if (g.code === 93) edgesToRead = parseInt(g.value);
                if (g.code === 72 && edgesToRead > 0) {
                    const edgeType = parseInt(g.value);
                    const edge: HatchEdge = { type: 'LINE' }; 
                    if (edgeType === 1) { // 直线
                        edge.type = 'LINE';
                        const p1 = readPoint(state, 10, 20); const p2 = readPoint(state, 11, 21);
                        if(p1) edge.start = p1; if(p2) edge.end = p2;
                    } else if (edgeType === 2) { // 圆弧
                        edge.type = 'ARC';
                        const center = readPoint(state, 10, 20);
                        const radius = readVal(state, 40); const startAng = readVal(state, 50); const endAng = readVal(state, 51); const ccw = readVal(state, 73);
                        if(center) edge.center = center; if(radius !== null) edge.radius = radius;
                        if(startAng !== null) edge.startAngle = startAng; if(endAng !== null) edge.endAngle = endAng;
                        if(ccw !== null) edge.ccw = ccw === 1;

                        if (edge.center && edge.radius !== undefined && edge.startAngle !== undefined && edge.endAngle !== undefined) {
                            const sRad = edge.startAngle * Math.PI / 180;
                            const eRad = edge.endAngle * Math.PI / 180;
                            edge.start = { x: edge.center.x + edge.radius * Math.cos(sRad), y: edge.center.y + edge.radius * Math.sin(sRad) };
                            edge.end = { x: edge.center.x + edge.radius * Math.cos(eRad), y: edge.center.y + edge.radius * Math.sin(eRad) };
                        }
                    } else if (edgeType === 3) { // 椭圆弧
                        edge.type = 'ELLIPSE';
                         const center = readPoint(state, 10, 20); const maj = readPoint(state, 11, 21);
                         const ratio = readVal(state, 40); const startAng = readVal(state, 50); const endAng = readVal(state, 51); const ccw = readVal(state, 73);
                         if(center) edge.center = center; if(maj) edge.majorAxis = maj;
                         if(ratio) edge.ratio = ratio; if(startAng) edge.startAngle = startAng; if(endAng) edge.endAngle = endAng;
                         if(ccw !== null) edge.ccw = ccw === 1;

                         if (edge.center && edge.majorAxis && edge.ratio !== undefined) {
                             const sRad = (edge.startAngle || 0) * Math.PI / 180;
                             const eRad = (edge.endAngle || 360) * Math.PI / 180;
                             const calcEllipsePt = (angle: number) => {
                                 const cos = Math.cos(angle);
                                 const sin = Math.sin(angle);
                                 const minX = -edge.majorAxis!.y * edge.ratio!;
                                 const minY = edge.majorAxis!.x * edge.ratio!;
                                 return {
                                     x: edge.center!.x + edge.majorAxis!.x * cos + minX * sin,
                                     y: edge.center!.y + edge.majorAxis!.y * cos + minY * sin
                                 };
                             }
                             edge.start = calcEllipsePt(sRad);
                             edge.end = calcEllipsePt(eRad);
                         }
                    } else if (edgeType === 4) { // 样条曲线
                         edge.type = 'SPLINE'; edge.controlPoints = []; edge.knots = []; edge.weights = [];
                         const degree = readVal(state, 94); if(degree) edge.degree = degree;
                         const rational = readVal(state, 73);
                         const periodic = readVal(state, 74);
                         const nKnots = readVal(state, 95);
                         const nControl = readVal(state, 96);
                         // 读取节点 (Knots)
                         for(let k=0; k<(nKnots||0); k++) { const kn = readVal(state, 40); if(kn!==null) edge.knots!.push(kn); }
                         // 读取控制点 (Control points)
                         for(let c=0; c<(nControl||0); c++) {
                             const pt = readPoint(state, 10, 20); if(pt) edge.controlPoints!.push(pt);
                             if (rational) { const w = readVal(state, 42); if(w!==null) edge.weights!.push(w); }
                         }
                         // 预计算填充边界的样条曲线点
                         if (edge.controlPoints.length > 0) {
                             edge.calculatedPoints = getBSplinePoints(edge.controlPoints, edge.degree || 3, edge.knots, edge.weights, 20);
                         }
                    }
                    currentLoop.edges.push(edge);
                    edgesToRead--;
                }
            }
        }
    }
    if (entity.patternName === 'SOLID') entity.solid = true;
    if (currentLoop) entity.loops.push(currentLoop);
    const ocs = getOcsToWcsMatrix(entity.extrusion.x, entity.extrusion.y, entity.extrusion.z);
    const transform = (x: number, y: number) => applyOcs({x, y}, ocs, elevation); // 转换函数
    if (ocs) {
        const det2D = ocs.Ax.x * ocs.Ay.y - ocs.Ax.y * ocs.Ay.x;
        entity.isFlipped = det2D < 0;
        
        entity.loops.forEach((loop: HatchLoop) => {
             if (loop.points) loop.points = loop.points.map(p => transform(p.x, p.y));
             if (loop.edges) loop.edges.forEach(edge => {
                 if (edge.start) edge.start = transform(edge.start.x, edge.start.y);
                 if (edge.end) edge.end = transform(edge.end.x, edge.end.y);
                 if (edge.center) edge.center = transform(edge.center.x, edge.center.y);
                 if (edge.type === 'ARC' && edge.startAngle !== undefined && edge.endAngle !== undefined) {
                     edge.startAngle = getWcsRotation(edge.startAngle, ocs);
                     edge.endAngle = getWcsRotation(edge.endAngle, ocs);
                 }
                 if (edge.type === 'ELLIPSE' && edge.majorAxis) {
                     const tx = edge.majorAxis.x * ocs.Ax.x + edge.majorAxis.y * ocs.Ay.x;
                     const ty = edge.majorAxis.x * ocs.Ax.y + edge.majorAxis.y * ocs.Ay.y;
                     edge.majorAxis = { x: tx, y: ty };
                 }
                 if (edge.controlPoints) edge.controlPoints = edge.controlPoints.map(p => transform(p.x, p.y));
                 if (edge.calculatedPoints) edge.calculatedPoints = edge.calculatedPoints.map(p => transform(p.x, p.y));
             });
        });
    }
    return entity;
}

const getEntityExtents = (ent: AnyEntity, blocks: Record<string, DxfBlock>): { min: Point2D, max: Point2D } | null => {
    // 获取实体的包围盒范围 (Extents)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const update = (x: number, y: number) => {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
    };

    switch (ent.type) {
        case EntityType.LINE:
            update(ent.start.x, ent.start.y);
            update(ent.end.x, ent.end.y);
            break;
        case EntityType.CIRCLE:
        case EntityType.ARC:
            update(ent.center.x - ent.radius, ent.center.y - ent.radius);
            update(ent.center.x + ent.radius, ent.center.y + ent.radius);
            break;
        case EntityType.LWPOLYLINE:
        case EntityType.POLYLINE:
            ent.points.forEach(p => update(p.x, p.y));
            break;
        case EntityType.POINT:
        case EntityType.TEXT:
        case EntityType.MTEXT:
        case EntityType.ATTRIB:
        case EntityType.ATTDEF:
            update(ent.position.x, ent.position.y);
            if (ent.type !== EntityType.POINT) {
                const h = (ent as any).height || 2.5;
                let text = (ent as any).value || "";
                if (ent.type === EntityType.MTEXT) {
                    text = cleanMText(text);
                }
                const widthFactor = Math.abs((ent as any).widthFactor || 1);
                const rotation = (ent as any).rotation || 0;
                
                // 处理文本高度、宽度因子和行间距
                const lines = text.split('\n');
                const maxLineLen = Math.max(...lines.map(l => l.length), 1);
                const totalHeight = lines.length * h * 1.3; // 增加行间距以优化点选范围
                const totalWidth = h * 0.8 * maxLineLen * widthFactor; // 字符宽度的近似值

                const rad = rotation * Math.PI / 180;
                const cos = Math.cos(rad);
                const sin = Math.sin(rad);

                // 处理 MText 插入点 (组码 71) 和 Text 对齐 (组码 72, 73)
                let ox = 0, oy = 0;
                if (ent.type === EntityType.MTEXT) {
                    const ap = (ent as any).attachmentPoint || 1;
                    // 插入点枚举：1=左上, 2=中上, 3=右上, 4=左中, 5=正中, 6=右中, 7=左下, 8=中下, 9=右下
                    if ([2, 5, 8].includes(ap)) ox = -totalWidth / 2;
                    else if ([3, 6, 9].includes(ap)) ox = -totalWidth;
                    
                    if ([4, 5, 6].includes(ap)) oy = totalHeight / 2;
                    else if ([7, 8, 9].includes(ap)) oy = totalHeight;
                } else {
                    const ha = (ent as any).hAlign || 0;
                    const va = (ent as any).vAlign || 0;
                    // 文字对齐方式的简化处理：
                    if (ha === 1) ox = -totalWidth / 2; // 居中
                    else if (ha === 2) ox = -totalWidth; // 右对齐
                    
                    if (va === 1) oy = h * 0.5; // 底部
                    else if (va === 2) oy = h * 1.0; // 中间
                    else if (va === 3) oy = h * 1.5; // 顶部
                }

                const corners = [
                    {x: ox, y: oy}, 
                    {x: ox + totalWidth, y: oy}, 
                    {x: ox, y: oy - totalHeight}, 
                    {x: ox + totalWidth, y: oy - totalHeight}
                ];
                corners.forEach(c => {
                    update(ent.position.x + c.x * cos - c.y * sin, ent.position.y + c.x * sin + c.y * cos);
                });
            }
            break;
        case EntityType.ELLIPSE: {
            const rx = Math.sqrt(ent.majorAxis.x ** 2 + ent.majorAxis.y ** 2);
            const ry = rx * ent.ratio;
            update(ent.center.x - rx, ent.center.y - rx);
            update(ent.center.x + rx, ent.center.y + rx);
            break;
        }
        case EntityType.SPLINE: {
            const pts = ent.calculatedPoints || ent.controlPoints || ent.fitPoints || [];
            pts.forEach(p => update(p.x, p.y));
            break;
        }
        case EntityType.SOLID:
        case EntityType.THREEDFACE:
            ent.points.forEach(p => update(p.x, p.y));
            break;
        case EntityType.HATCH:
            ent.loops.forEach(loop => {
                if (loop.points) loop.points.forEach(p => update(p.x, p.y));
                loop.edges.forEach(edge => {
                    if (edge.calculatedPoints) edge.calculatedPoints.forEach(p => update(p.x, p.y));
                    else if (edge.start && edge.end) { update(edge.start.x, edge.start.y); update(edge.end.x, edge.end.y); }
                    else if (edge.center && edge.radius) {
                        update(edge.center.x - edge.radius, edge.center.y - edge.radius);
                        update(edge.center.x + edge.radius, edge.center.y + edge.radius);
                    }
                });
            });
            break;
        case EntityType.INSERT:
        case EntityType.ACAD_TABLE: {
            const block = blocks[ent.blockName];
            if (block && block.extents) {
                const rot = (ent as any).rotation || 0;
                const scale = (ent as any).scale || { x: 1, y: 1, z: 1 };
                const cos = Math.cos(rot * Math.PI / 180);
                const sin = Math.sin(rot * Math.PI / 180);
                const corners = [
                    { x: block.extents.min.x - block.basePoint.x, y: block.extents.min.y - block.basePoint.y },
                    { x: block.extents.max.x - block.basePoint.x, y: block.extents.min.y - block.basePoint.y },
                    { x: block.extents.min.x - block.basePoint.x, y: block.extents.max.y - block.basePoint.y },
                    { x: block.extents.max.x - block.basePoint.x, y: block.extents.max.y - block.basePoint.y }
                ];
                corners.forEach(p => {
                    const sx = p.x * scale.x;
                    const sy = p.y * scale.y;
                    update(ent.position.x + sx * cos - sy * sin, ent.position.y + sx * sin + sy * cos);
                });
            } else if (ent.type === EntityType.ACAD_TABLE) {
                // 表格包围盒兜底：如果没有块定义，根据行/列数和间距计算
                const table = ent as any;
                const rowCount = table.rowCount || 1;
                const colCount = table.columnCount || 1;
                const rowSpacing = table.rowSpacing || 10;
                const colSpacing = table.columnSpacing || 50;
                const rot = table.rotation || 0;
                const cos = Math.cos(rot * Math.PI / 180);
                const sin = Math.sin(rot * Math.PI / 180);
                
                const w = colCount * colSpacing;
                const h = rowCount * rowSpacing;
                
                // 表格通常从插入点向下向右生长
                const corners = [
                    { x: 0, y: 0 },
                    { x: w, y: 0 },
                    { x: 0, y: -h },
                    { x: w, y: -h }
                ];
                corners.forEach(p => {
                    update(ent.position.x + p.x * cos - p.y * sin, ent.position.y + p.x * sin + p.y * cos);
                });
            } else {
                update(ent.position.x, ent.position.y);
            }
            break;
        }
        case EntityType.DIMENSION:
            update(ent.definitionPoint.x, ent.definitionPoint.y);
            if (ent.textMidPoint) update(ent.textMidPoint.x, ent.textMidPoint.y);
            if (ent.linearP1) update(ent.linearP1.x, ent.linearP1.y);
            if (ent.linearP2) update(ent.linearP2.x, ent.linearP2.y);
            if (ent.arcP1) update(ent.arcP1.x, ent.arcP1.y);
            if (ent.arcP2) update(ent.arcP2.x, ent.arcP2.y);
            
            if (ent.blockName && blocks[ent.blockName] && blocks[ent.blockName].extents) {
                const b = blocks[ent.blockName];
                // 标注块的内容通常直接在世界坐标系定义，但需要处理基点 (basePoint) 偏移
                update(b.extents!.min.x - b.basePoint.x, b.extents!.min.y - b.basePoint.y);
                update(b.extents!.max.x - b.basePoint.x, b.extents!.max.y - b.basePoint.y);
            }
            break;
        case EntityType.LEADER:
            ent.points.forEach(p => update(p.x, p.y));
            break;
    }

    if (minX === Infinity) return null;
    return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
};

const precomputeBlockExtents = (blocks: Record<string, DxfBlock>) => {
    // 预计算块的包围盒范围
    const visited = new Set<string>();
    const computing = new Set<string>();

    const compute = (name: string) => {
        if (visited.has(name) || computing.has(name)) return;
        const block = blocks[name];
        if (!block) return;
        
        computing.add(name);
        
        // 确保首先计算子块的范围
        block.entities.forEach(ent => {
            if ((ent.type === EntityType.INSERT || ent.type === EntityType.ACAD_TABLE || ent.type === EntityType.DIMENSION) && ent.blockName) {
                compute(ent.blockName);
            }
        });

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        block.entities.forEach(ent => {
            const ext = getEntityExtents(ent, blocks);
            if (ext) {
                // 同时更新实体自身的包围盒，用于渲染时的剔除 (Culling) 和点选 (Hit test)
                ent.extents = ext;
                
                // 使用较大的限制以允许极端坐标，但防止出现 Infinity
                const isValid = (v: number) => isFinite(v) && Math.abs(v) < 1e100;
                if (isValid(ext.min.x) && ext.min.x < minX) minX = ext.min.x; 
                if (isValid(ext.max.x) && ext.max.x > maxX) maxX = ext.max.x;
                if (isValid(ext.min.y) && ext.min.y < minY) minY = ext.min.y; 
                if (isValid(ext.max.y) && ext.max.y > maxY) maxY = ext.max.y;
            }
        });

        if (minX !== Infinity && minY !== Infinity && maxX !== -Infinity && maxY !== -Infinity) {
            block.extents = { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
        }
        
        computing.delete(name);
        visited.add(name);
    };

    Object.keys(blocks).forEach(compute);
};

export const calculateExtents = (entities: AnyEntity[], blocks: Record<string, DxfBlock>): { center: Point2D, width: number, height: number, min: Point2D, max: Point2D } => {
    // 计算所有实体的总包围盒
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    entities.forEach(ent => {
        if (ent.visible === false) return;
        const ext = getEntityExtents(ent, blocks);
        if (ext) {
            // 使用较大的限制以允许极端坐标，但防止出现 Infinity
            const isValid = (v: number) => isFinite(v) && Math.abs(v) < 1e100;
            
            if (isValid(ext.min.x) && ext.min.x < minX) minX = ext.min.x; 
            if (isValid(ext.max.x) && ext.max.x > maxX) maxX = ext.max.x;
            if (isValid(ext.min.y) && ext.min.y < minY) minY = ext.min.y; 
            if (isValid(ext.max.y) && ext.max.y > maxY) maxY = ext.max.y;
            
            // 同时更新实体自身的包围盒，用于渲染时的剔除 (Culling)
            ent.extents = ext;
        }
    });

    if (minX === Infinity || minY === Infinity || maxX === -Infinity || maxY === -Infinity) {
        return { center: { x: 0, y: 0 }, width: 0, height: 0, min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
    }

    const width = maxX - minX;
    const height = maxY - minY;
    return {
        center: { x: minX + width / 2, y: minY + height / 2 },
        width: isFinite(width) ? width : 0,
        height: isFinite(height) ? height : 0,
        min: { x: minX, y: minY },
        max: { x: maxX, y: maxY }
    };
};

/**
 * 智能计算范围：通过忽略离群值并专注于最密集的区域来计算范围。
 */
export const calculateSmartExtents = (entities: AnyEntity[], blocks: Record<string, DxfBlock>): { center: Point2D, width: number, height: number, min: Point2D, max: Point2D } => {
    const validExtents: {min: Point2D, max: Point2D, center: Point2D}[] = [];
    
    entities.forEach(ent => {
        if (ent.visible === false || ent.type === EntityType.ATTDEF) return;
        const ext = getEntityExtents(ent, blocks);
        if (ext) {
            const isValid = (v: number) => isFinite(v) && Math.abs(v) < 1e50;
            if (isValid(ext.min.x) && isValid(ext.max.x) && isValid(ext.min.y) && isValid(ext.max.y)) {
                validExtents.push({
                    min: ext.min,
                    max: ext.max,
                    center: { x: (ext.min.x + ext.max.x) / 2, y: (ext.min.y + ext.max.y) / 2 }
                });
                ent.extents = ext;
            }
        }
    });

    if (validExtents.length === 0) {
        return { center: { x: 0, y: 0 }, width: 0, height: 0, min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
    }

    if (validExtents.length <= 2) {
        return calculateExtents(entities, blocks);
    }

    // 1. 计算完整的包围盒
    let fullMinX = Infinity, fullMinY = Infinity, fullMaxX = -Infinity, fullMaxY = -Infinity;
    validExtents.forEach(ext => {
        fullMinX = Math.min(fullMinX, ext.min.x);
        fullMaxX = Math.max(fullMaxX, ext.max.x);
        fullMinY = Math.min(fullMinY, ext.min.y);
        fullMaxY = Math.max(fullMaxY, ext.max.y);
    });

    // 2. 针对离群值的统计过滤
    // 使用 X 和 Y 中心点来寻找“密集”区域
    const centersX = validExtents.map(e => e.center.x).sort((a, b) => a - b);
    const centersY = validExtents.map(e => e.center.y).sort((a, b) => a - b);
    
    // 获取中心点的四分位距 (IQR)
    const q1Idx = Math.floor(centersX.length * 0.25);
    const q3Idx = Math.floor(centersX.length * 0.75);
    
    const iqrX = centersX[q3Idx] - centersX[q1Idx];
    const iqrY = centersY[q3Idx] - centersY[q1Idx];
    
    // 离群值阈值：标准为 1.5 * IQR，但我们会更宽松一些（例如 5.0 * IQR），
    // 或者直接使用第 5 和第 95 百分位数，以确保安全且聚焦。
    const lowIdx = Math.floor(centersX.length * 0.05);
    const highIdx = Math.floor(centersX.length * 0.95);
    
    const p5X = centersX[lowIdx];
    const p95X = centersX[highIdx];
    const p5Y = centersY[lowIdx];
    const p95Y = centersY[highIdx];

    // 如果完整范围远大于百分位范围（例如 > 10倍），
    // 则极有可能存在离群值。
    const pWidth = p95X - p5X;
    const pHeight = p95Y - p5Y;
    const fWidth = fullMaxX - fullMinX;
    const fHeight = fullMaxY - fullMinY;

    let finalMinX = fullMinX, finalMaxX = fullMaxX, finalMinY = fullMinY, finalMaxY = fullMaxY;

    // 如果完整范围显著大于百分位范围，则专注于“主体部分”
    if (fWidth > pWidth * 10 || fHeight > pHeight * 10) {
        // 过滤掉不在 p5-p95 框内合理距离范围内的实体
        // 我们将使用带有边距的 p5-p95 作为“智能”框
        const marginX = Math.max(pWidth * 0.5, fWidth * 0.01);
        const marginY = Math.max(pHeight * 0.5, fHeight * 0.01);
        
        finalMinX = Infinity; finalMaxX = -Infinity;
        finalMinY = Infinity; finalMaxY = -Infinity;
        
        validExtents.forEach(ext => {
            // 如果实体距离核心区域较近，则将其包含在拟合计算中
            if (ext.center.x >= p5X - marginX && ext.center.x <= p95X + marginX &&
                ext.center.y >= p5Y - marginY && ext.center.y <= p95Y + marginY) {
                finalMinX = Math.min(finalMinX, ext.min.x);
                finalMaxX = Math.max(finalMaxX, ext.max.x);
                finalMinY = Math.min(finalMinY, ext.min.y);
                finalMaxY = Math.max(finalMaxY, ext.max.y);
            }
        });
        
        // 安全机制：如果过滤后没有任何内容（不应发生），则恢复为完整范围
        if (finalMinX === Infinity) {
            finalMinX = fullMinX; finalMaxX = fullMaxX;
            finalMinY = fullMinY; finalMaxY = fullMaxY;
        }
    }

    const width = finalMaxX - finalMinX;
    const height = finalMaxY - finalMinY;
    
    return {
        center: { x: finalMinX + width / 2, y: finalMinY + height / 2 },
        width: width,
        height: height,
        min: { x: finalMinX, y: finalMinY },
        max: { x: finalMaxX, y: finalMaxY }
    };
};
