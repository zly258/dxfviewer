import { DxfLayer, DxfStyle, DxfLineType, DxfBlock } from '../../types';
import { DxfParserState } from './DxfParserState';
import { parseEntityDispatcher } from './parseEntity';

/**
 * 解析图层 (LAYER) 属性
 */
export const parseLayer = (state: DxfParserState): DxfLayer => {
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
            case 370: layer.lineweight = parseInt(g.value, 10); break;
            case 440: layer.transparency = parseInt(g.value, 10); break;
            case 70: layer.isVisible = (parseInt(g.value) & 1) !== 1; break; 
        }
    }
    if (layer.color < 0) {
        layer.isVisible = false;
        layer.color = Math.abs(layer.color);
    }
    return layer;
};

/**
 * 解析文字样式 (STYLE)
 */
export const parseStyle = (state: DxfParserState): DxfStyle => {
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

/**
 * 解析线型 (LTYPE)
 */
export const parseLineType = (state: DxfParserState): DxfLineType => {
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

/**
 * 解析表段 (TABLE) 里的图层、字体样式、线型和块记录句柄映射
 */
export const parseTable = (
    state: DxfParserState, 
    layers: Record<string, DxfLayer>, 
    styles: Record<string, DxfStyle>, 
    lineTypes: Record<string, DxfLineType>, 
    blockHandleMap?: Record<string, string>
) => {
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
};

/**
 * 解析块段 (BLOCK) 定义，包含内部的实体列表
 */
export const parseBlock = (state: DxfParserState, blockHandleMap?: Record<string, string>): DxfBlock | null => {
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
