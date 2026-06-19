import { 
  DxfData, 
  DxfLayer, 
  DxfBlock, 
  DxfStyle, 
  DxfLineType, 
  DxfHeader, 
  AnyEntity, 
  EntityType 
} from '../../types';
import { DxfParserState, parsePoint } from './DxfParserState';
import { parseTable, parseBlock } from './parseSection';
import { parseEntityDispatcher } from './parseEntity';
import { offsetEntity } from '../geometry/offset';
import { calculateExtents, getEntityExtents, precomputeBlockExtents } from '../geometry/extents';
import { 
  CAD_DEFAULT_LAYER_COLOR, 
  CAD_DEFAULT_LAYER_NAME, 
  CAD_DEFAULT_TEXT_STYLE 
} from '../../shared/constants/cadConstants';
import { DEFAULT_TEXT_STYLE, EXTENTS_CONFIG } from '../../shared/config/viewerConfig';

/**
 * 确保 DXF 文件结构有效，有基本的 SECTION 和 ENTITIES 标记
 */
export const ensureDxfStructure = (dxfString: string) => {
  const text = dxfString.replace(/^\uFEFF/, '');
  const hasSection = /(?:^|\r?\n)\s*0\s*\r?\n\s*SECTION\s*(?:\r?\n|$)/i.test(text);
  const hasEntities = /(?:^|\r?\n)\s*2\s*\r?\n\s*ENTITIES\s*(?:\r?\n|$)/i.test(text);

  if (!hasSection || !hasEntities) {
    throw new Error('未找到 SECTION 或 ENTITIES 段，可能不是有效 DXF 文件或编码识别错误');
  }
};

/**
 * DXF 文件解析核心主函数
 */
export const parseDxf = async (dxfString: string, onProgress?: (percent: number) => void): Promise<DxfData> => {
  ensureDxfStructure(dxfString);
  const state = new DxfParserState(dxfString);
  const entities: AnyEntity[] = [];
  const layers: Record<string, DxfLayer> = {};
  const blocks: Record<string, DxfBlock> = {};
  const styles: Record<string, DxfStyle> = {};
  const lineTypes: Record<string, DxfLineType> = {};
  const blockHandleMap: Record<string, string> = {}; 
  let header: DxfHeader | undefined;
  
  layers[CAD_DEFAULT_LAYER_NAME] = { name: CAD_DEFAULT_LAYER_NAME, color: CAD_DEFAULT_LAYER_COLOR, isVisible: true };
  styles[CAD_DEFAULT_TEXT_STYLE] = DEFAULT_TEXT_STYLE;
  lineTypes['CONTINUOUS'] = { name: 'CONTINUOUS', pattern: [], totalLength: 0 };

  // 进度估计的总大小：字符串长度 / 每行约 15 字节
  const estimatedTotalLines = dxfString.length / 15; 
  let currentSection = '';
  let linesProcessed = 0;

  while (state.hasNext) {
    // 每 500 行让出主线程一次，以防 UI 假死
    if (state.linesRead > linesProcessed + 500) {
        linesProcessed = state.linesRead;
        const percent = Math.min(99, Math.round((state.linesRead / estimatedTotalLines) * 100));
        if (onProgress) onProgress(percent);
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
         if (!header) header = { extMin: {x:0, y:0}, extMax: {x:0, y:0}, insUnits: 0, ltScale: 1.0, celtscale: 1.0 };
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
             } else if (v === '$CELTSCALE') {
                 const n = state.next();
                 if (n && n.code === 40) header.celtscale = parseFloat(n.value);
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

  // 1. 在原始坐标上进行初始预计算（以获得正确的初始中心点）
  precomputeBlockExtents(blocks, styles);

  // 2. 计算初始全局范围以找到中心点
  const offset = (() => {
    const centersX: number[] = [];
    const centersY: number[] = [];
    const isValid = (v: number) => isFinite(v) && Math.abs(v) < EXTENTS_CONFIG.maxFiniteExtent;

    entities.forEach(ent => {
      if (ent.visible === false || ent.type === EntityType.ATTDEF || ent.type === EntityType.ATTRIB) return;
      const ext = getEntityExtents(ent, blocks, styles);
      if (!ext) return;
      const cx = (ext.min.x + ext.max.x) / 2;
      const cy = (ext.min.y + ext.max.y) / 2;
      if (isValid(cx) && isValid(cy)) {
        centersX.push(cx);
        centersY.push(cy);
      }
    });

    if (centersX.length === 0) {
      const initialExtents = calculateExtents(entities, blocks, styles);
      return { x: initialExtents.center.x, y: initialExtents.center.y };
    }

    centersX.sort((a, b) => a - b);
    centersY.sort((a, b) => a - b);
    const mid = Math.floor(centersX.length / 2);
    const cx = centersX.length % 2 === 0 ? (centersX[mid - 1] + centersX[mid]) / 2 : centersX[mid];
    const cy = centersY.length % 2 === 0 ? (centersY[mid - 1] + centersY[mid]) / 2 : centersY[mid];
    return { x: cx, y: cy };
  })();

  // 3. 将所有内容平移到以 (0,0) 为中心（工业标准的浮点精度处理方式）
  entities.forEach(ent => offsetEntity(ent, offset));
  
  // 同时偏移所有块及其内容
  Object.values(blocks).forEach(block => {
    block.basePoint.x -= offset.x;
    block.basePoint.y -= offset.y;
    block.entities.forEach(ent => offsetEntity(ent, offset));
  });

  // 4. 重新预计算块范围（处于平移后的坐标系中）
  precomputeBlockExtents(blocks, styles);

  // 5. 计算平移后的实体最终全局包围盒范围
  const extents = calculateExtents(entities, blocks, styles);

  return { header, entities, layers, blocks, styles, lineTypes, offset, extents };
};
