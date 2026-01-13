import { AnyEntity, DxfData, EntityType, DxfLayer, DxfBlock, Point2D, Point3D, DxfHatch, HatchLoop, HatchEdge, DxfStyle, DxfPolyline, DxfInsert, DxfHeader, DxfSpline, DxfText, DxfLeader } from '../types';

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
    // Extract line and trim whitespace (handles \r\n)
    const line = this.text.substring(this.pos, end).trim();
    this.pos = end + 1;
    this.linesRead++;
    return line;
  }

  peek() {
    if (this.groupLoaded) return this.currentGroup;
    
    const codeStr = this.readLine();
    if (codeStr === null) return null;
    
    const valueStr = this.readLine();
    if (valueStr === null) return null; 

    // Robust parsing: if code is empty (e.g. extra newlines), try next
    if (codeStr === "") return this.peek();

    const code = parseInt(codeStr, 10);
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
            // Optional Z
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

const parseTable = (state: DxfParserState, layers: Record<string, DxfLayer>, styles: Record<string, DxfStyle>) => {
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
            } else {
                state.next(); 
            }
        } else {
            state.next();
        }
    }
}

const parseBlock = (state: DxfParserState): DxfBlock | null => {
    const block: DxfBlock = { name: '', basePoint: {x:0, y:0}, entities: [] };
    while(state.hasNext) {
        const p = state.peek();
        if (!p || p.code === 0) break; 
        const g = state.next()!;
        if (g.code === 2) block.name = g.value;
        if (g.code === 10) block.basePoint.x = parseFloat(g.value);
        if (g.code === 20) block.basePoint.y = parseFloat(g.value);
        if (g.code === 5) block.handle = g.value;
    }

    while(state.hasNext) {
        const p = state.peek();
        if (!p) break;
        if (p.code === 0) {
            if (p.value === 'ENDBLK') {
                state.next();
                break;
            }
            const entity = parseEntityDispatcher(p.value, state);
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
    if (len < 1e-6) return null; 
    Nx /= len; Ny /= len; Nz /= len;

    if (Math.abs(Nx) < 1e-6 && Math.abs(Ny) < 1e-6 && Math.abs(Nz - 1) < 1e-6) return null; 

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
  const blockHandleMap: Record<string, string> = {}; 
  let header: DxfHeader | undefined;
  
  layers['0'] = { name: '0', color: 7, isVisible: true };
  styles['STANDARD'] = { name: 'STANDARD', fontFileName: 'txt', height: 0, widthFactor: 1 };

  // Heuristic total size for progress: length of string / ~20 bytes per line
  const estimatedTotalLines = dxfString.length / 15; 
  let lastReportedProgress = 0;
  let currentSection = '';
  let linesProcessed = 0;

  while (state.hasNext) {
    if (state.linesRead > linesProcessed + 2000) {
        linesProcessed = state.linesRead;
        const percent = Math.min(99, Math.round((state.linesRead / estimatedTotalLines) * 100));
        if (percent !== lastReportedProgress) {
            lastReportedProgress = percent;
            if (onProgress) onProgress(percent);
            await new Promise(resolve => setTimeout(resolve, 0));
        }
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
         if (!header) header = { extMin: {x:0, y:0}, extMax: {x:0, y:0}, insUnits: 0 };
         if (group.code === 9) {
             const v = group.value;
             if (v === '$EXTMIN') header.extMin = parsePoint(state);
             else if (v === '$EXTMAX') header.extMax = parsePoint(state);
             else if (v === '$INSUNITS') {
                 const n = state.next();
                 if (n && n.code === 70) header.insUnits = parseInt(n.value);
             }
         }
      } else if (currentSection === 'TABLES') {
        if (group.code === 0 && group.value === 'TABLE') parseTable(state, layers, styles);
      } else if (currentSection === 'BLOCKS') {
        if (group.code === 0 && group.value === 'BLOCK') {
           const block = parseBlock(state);
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
  return { header, entities, layers, blocks, styles };
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
        case 6: common.lineType = value; break;
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
        case 'SOLID': case 'TRACE': case '3DFACE': return parseSolid(state, common);
        case 'SPLINE': return parseSpline(state, common);
        case 'ELLIPSE': return parseEllipse(state, common);
        case 'HATCH': return parseHatch(state, common);
        case 'DIMENSION': return parseDimension(state, common);
        case 'LEADER': return parseLeader(state, common);
        case 'ACAD_TABLE': return parseAcadTable(state, common, blockHandleMap);
        default: 
            while (state.hasNext) {
                const p = state.peek();
                if (!p || p.code === 0) break;
                state.next();
            }
            return null;
    }
}

const parseAcadTable = (state: DxfParserState, common: any, blockHandleMap?: Record<string, string>): AnyEntity | null => {
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
    let blockHandle = '';
    let direction = {x: 1, y: 0};

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
            case 342: blockHandle = g.value; break; 
            case 11: direction.x = parseFloat(g.value); break; 
            case 21: direction.y = parseFloat(g.value); break; 
        }
    }

    if (!entity.blockName && blockHandle && blockHandleMap) {
        entity.blockName = blockHandleMap[blockHandle] || '';
    }

    const angle = Math.atan2(direction.y, direction.x) * 180 / Math.PI;
    entity.rotation = angle;

    const ocs = getOcsToWcsMatrix(entity.extrusion.x, entity.extrusion.y, entity.extrusion.z);
    entity.position = applyOcs(entity.position, ocs, z);
    entity.rotation = getWcsRotation(entity.rotation, ocs);

    if (!entity.blockName) return null; 
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
    
    if (!entity.styleName) entity.styleName = 'STANDARD';
    if (!entity.height) entity.height = 0; 
    if (!entity.widthFactor) entity.widthFactor = 0; 

    const ocs = getOcsToWcsMatrix(entity.extrusion.x, entity.extrusion.y, entity.extrusion.z);
    
    if (type === EntityType.MTEXT) {
        if (direction && (Math.abs(direction.x) > 1e-6 || Math.abs(direction.y) > 1e-6)) {
             entity.rotation = Math.atan2(direction.y, direction.x) * 180 / Math.PI;
        } else {
             const rad = entity.rotation; 
             const deg = rad * 180 / Math.PI;
             entity.rotation = getWcsRotation(deg, ocs);
        }
    } else {
        if (secondPos) {
            entity.secondPosition = applyOcs(secondPos, ocs, z2);
        }
        entity.rotation = getWcsRotation(entity.rotation, ocs);
    }
    entity.position = applyOcs(entity.position, ocs, z);
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
    const ocs = getOcsToWcsMatrix(entity.extrusion.x, entity.extrusion.y, entity.extrusion.z);
    entity.start = applyOcs(entity.start, ocs, z1);
    entity.end = applyOcs(entity.end, ocs, z2);
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
            case 10: flushVertex(); currX = parseFloat(g.value); break;
            case 20: currY = parseFloat(g.value); break;
            case 42: currBulge = parseFloat(g.value); break;
        }
    }
    flushVertex();

    const ocs = getOcsToWcsMatrix(common.extrusion.x, common.extrusion.y, common.extrusion.z);
    if (ocs) {
        for(let i=0; i<points.length; i++) {
            points[i] = applyOcs(points[i], ocs, elevation);
        }
    }
    return { ...common, type: EntityType.LWPOLYLINE, points, bulges, closed };
}

const parsePolyline = (state: DxfParserState, common: any): DxfPolyline => {
    let closed = false;
    let is3DPolyline = false;
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
    }

    const points: Point2D[] = [];
    while(state.hasNext) {
        const p = state.peek();
        if (!p) break;
        if (p.code === 0) {
            if (p.value === 'SEQEND') { state.next(); break; }
            if (p.value === 'VERTEX') {
                state.next();
                let x=0, y=0, z=0, valid = false;
                while(state.hasNext) {
                    const vp = state.peek();
                    if (!vp || vp.code === 0) break;
                    const vg = state.next()!;
                    if (vg.code === 10) { x = parseFloat(vg.value); valid = true; }
                    if (vg.code === 20) y = parseFloat(vg.value);
                    if (vg.code === 30) z = parseFloat(vg.value);
                }
                if (valid) points.push({x, y}); 
                continue;
            }
            break; 
        }
        state.next();
    }
    return { ...common, type: EntityType.POLYLINE, points, closed };
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

const parseSolid = (state: DxfParserState, common: any): AnyEntity => {
    const entity: any = { ...common, type: EntityType.SOLID, points: [] };
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
        }
    }
    
    // Default points if missing
    if (!pts[0]) pts[0] = {x:0, y:0, z:0};
    if (!pts[1]) pts[1] = {x:0, y:0, z:0};
    if (!pts[2]) pts[2] = {x:0, y:0, z:0};
    // Fix for 3-point solids (e.g. arrows): If 4th point is missing, it equals the 3rd.
    if (!pts[3]) pts[3] = { ...pts[2] };

    const ocs = getOcsToWcsMatrix(entity.extrusion.x, entity.extrusion.y, entity.extrusion.z);
    const transformed = pts.map(p => applyOcs(p!, ocs, p!.z));
    
    if (common.type === 'SOLID' || common.type === 'TRACE') {
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
    const ocs = getOcsToWcsMatrix(entity.extrusion.x, entity.extrusion.y, entity.extrusion.z);
    entity.position = applyOcs(entity.position, ocs, z);
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
            case 11: entity.fitPoints.push({x: parseFloat(g.value), y: 0}); break;
            case 21: if (entity.fitPoints.length > 0) entity.fitPoints[entity.fitPoints.length-1].y = parseFloat(g.value); break;
        }
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
    let z = 0, az = 0;
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
            case 31: az = parseFloat(g.value); break;
            case 40: entity.ratio = parseFloat(g.value); break;
            case 41: entity.startParam = parseFloat(g.value); break;
            case 42: entity.endParam = parseFloat(g.value); break;
        }
    }
    const ocs = getOcsToWcsMatrix(entity.extrusion.x, entity.extrusion.y, entity.extrusion.z);
    entity.center = applyOcs(entity.center, ocs, z);
    if (ocs) {
        const tx = entity.majorAxis.x * ocs.Ax.x + entity.majorAxis.y * ocs.Ay.x + az * ocs.Az.x;
        const ty = entity.majorAxis.x * ocs.Ax.y + entity.majorAxis.y * ocs.Ay.y + az * ocs.Az.y;
        entity.majorAxis = {x: tx, y: ty};
    }
    return entity;
}

const parseDimension = (state: DxfParserState, common: any): AnyEntity => {
    const entity: any = { 
        ...common, 
        type: EntityType.DIMENSION, 
        blockName: '', 
        definitionPoint: {x:0, y:0}, 
        textMidPoint: {x:0, y:0}, 
        dimType: 0, 
        text: '', 
        measurement: 0 
    };
    let z1=0, z2=0;
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
            case 70: entity.dimType = parseInt(g.value); break;
            case 1: entity.text = g.value; break;
            case 42: entity.measurement = parseFloat(g.value); break;
            case 3: entity.styleName = g.value; break;
        }
    }
    const ocs = getOcsToWcsMatrix(entity.extrusion.x, entity.extrusion.y, entity.extrusion.z);
    entity.definitionPoint = applyOcs(entity.definitionPoint, ocs, z1);
    entity.textMidPoint = applyOcs(entity.textMidPoint, ocs, z2);
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
            if (currentLoop) entity.loops.push(currentLoop); 
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
                    if (edgeType === 1) { 
                        edge.type = 'LINE';
                        const p1 = readPoint(state, 10, 20); const p2 = readPoint(state, 11, 21);
                        if(p1) edge.start = p1; if(p2) edge.end = p2;
                    } else if (edgeType === 2) {
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
                    } else if (edgeType === 3) {
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
                    } else if (edgeType === 4) {
                         edge.type = 'SPLINE'; edge.controlPoints = []; edge.knots = []; edge.weights = [];
                         const degree = readVal(state, 94); if(degree) edge.degree = degree;
                         const rational = readVal(state, 73);
                         const periodic = readVal(state, 74);
                         const nKnots = readVal(state, 95);
                         const nControl = readVal(state, 96);
                         // Read knots
                         for(let k=0; k<(nKnots||0); k++) { const kn = readVal(state, 40); if(kn!==null) edge.knots!.push(kn); }
                         // Read control points
                         for(let c=0; c<(nControl||0); c++) {
                             const pt = readPoint(state, 10, 20); if(pt) edge.controlPoints!.push(pt);
                             if (rational) { const w = readVal(state, 42); if(w!==null) edge.weights!.push(w); }
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
    const transform = (x: number, y: number) => applyOcs({x, y}, ocs, elevation);
    if (ocs) {
        entity.loops.forEach((loop: HatchLoop) => {
             if (loop.points) loop.points = loop.points.map(p => transform(p.x, p.y));
             if (loop.edges) loop.edges.forEach(edge => {
                 if (edge.start) edge.start = transform(edge.start.x, edge.start.y);
                 if (edge.end) edge.end = transform(edge.end.x, edge.end.y);
                 if (edge.center) edge.center = transform(edge.center.x, edge.center.y);
                 if (edge.controlPoints) edge.controlPoints = edge.controlPoints.map(p => transform(p.x, p.y));
             });
        });
    }
    return entity;
}

export const calculateExtents = (entities: AnyEntity[], blocks: Record<string, DxfBlock>): { center: Point2D, width: number, height: number, min: Point2D, max: Point2D } => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    const updateExtents = (x: number, y: number) => {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    };

    const processEntity = (ent: AnyEntity, transform?: (p: Point2D) => Point2D, depth: number = 0) => {
        if (depth > 20) return; // Prevent infinite recursion
        
        const apply = transform || ((p) => p);
        if (ent.visible === false) return;

        if (ent.type === EntityType.LINE) {
            const s = apply(ent.start);
            const e = apply(ent.end);
            updateExtents(s.x, s.y);
            updateExtents(e.x, e.y);
        } else if (ent.type === EntityType.CIRCLE || ent.type === EntityType.ARC) {
            const c = apply(ent.center);
            updateExtents(c.x - ent.radius, c.y - ent.radius);
            updateExtents(c.x + ent.radius, c.y + ent.radius);
        } else if (ent.type === EntityType.LWPOLYLINE || ent.type === EntityType.POLYLINE) {
            ent.points.forEach(p => {
                const pt = apply(p);
                updateExtents(pt.x, pt.y);
            });
        } else if (ent.type === EntityType.POINT || ent.type === EntityType.TEXT || ent.type === EntityType.MTEXT || ent.type === EntityType.ATTRIB || ent.type === EntityType.ATTDEF) {
             const p = apply(ent.position);
             updateExtents(p.x, p.y);
        } else if (ent.type === EntityType.SOLID) {
            ent.points.forEach(p => {
                const pt = apply(p);
                updateExtents(pt.x, pt.y);
            });
        } else if (ent.type === EntityType.INSERT) {
            const block = blocks[ent.blockName];
            if (block) {
                const cos = Math.cos(ent.rotation * Math.PI / 180);
                const sin = Math.sin(ent.rotation * Math.PI / 180);
                const newTransform = (p: Point2D) => {
                     const bx = (p.x - block.basePoint.x) * ent.scale.x;
                     const by = (p.y - block.basePoint.y) * ent.scale.y;
                     const rx = bx * cos - by * sin;
                     const ry = bx * sin + by * cos;
                     const final = { x: rx + ent.position.x, y: ry + ent.position.y };
                     return apply ? apply(final) : final;
                };
                block.entities.forEach(child => processEntity(child, newTransform, depth + 1));
            } else {
                const p = apply(ent.position);
                updateExtents(p.x, p.y);
            }
        }
    };

    entities.forEach(ent => processEntity(ent));

    if (minX === Infinity) {
        return { center: {x:0, y:0}, width: 0, height: 0, min: {x:0,y:0}, max: {x:0,y:0} };
    }

    const width = maxX - minX;
    const height = maxY - minY;
    return {
        center: { x: minX + width / 2, y: minY + height / 2 },
        width,
        height,
        min: { x: minX, y: minY },
        max: { x: maxX, y: maxY }
    };
};