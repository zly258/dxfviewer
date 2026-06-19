import { 
  DxfInsert, 
  DxfTable, 
  DxfDimension, 
  DxfBlock, 
  DxfLayer, 
  CanvasTheme, 
  Point2D, 
  AnyEntity, 
  EntityType 
} from '../../types';
import { 
  TABLE_EXTENTS_CONFIG, 
  TEXT_RENDER_CONFIG, 
  LEADER_RENDER_CONFIG, 
  CANVAS_THEME_COLORS 
} from '../../shared/config/viewerConfig';
import { 
  CAD_DEFAULT_TEXT_HEIGHT, 
  CAD_BY_LAYER_COLOR 
} from '../../shared/constants/cadConstants';
import { cleanMText, cleanCadText } from '../utils/textUtils';
import { getAutoCadColor } from '../utils/colorUtils';
import { normalizeAcadTableGeometry } from '../../core/geometry/extents';

export interface RenderTransform {
    project: (p: Point2D) => Point2D;
    scale: number;
    rotation: number;
}

/**
 * 绘制块插入 (INSERT) 或表格 (ACAD_TABLE)
 */
export const drawInsertOrTable = (
    ctx: CanvasRenderingContext2D,
    ent: DxfInsert | DxfTable,
    transform: RenderTransform,
    blocks: Record<string, DxfBlock>,
    theme: CanvasTheme,
    color: string,
    isSelected: boolean,
    parentLayerName: string | undefined,
    depth: number,
    noMTextWrap: boolean,
    drawEntityCallback: (
        child: AnyEntity,
        nestedTransform: RenderTransform,
        layerName: string,
        color: string,
        isSelected: boolean,
        depth: number,
        noWrap: boolean
    ) => void
) => {
    const block = blocks[ent.blockName];
    
    // 表格匿名块缺失时的回退自绘
    const tableHasTextContent = ent.type === EntityType.ACAD_TABLE
        && Array.isArray((ent as any).cells)
        && (ent as any).cells.some((cell: unknown) => cleanMText(String(cell || '')).trim().length > 0);
    const shouldDrawTableFallback = ent.type === EntityType.ACAD_TABLE
        && tableHasTextContent
        && (!block || !block.entities || block.entities.length === 0);

    if (!block || shouldDrawTableFallback) {
        if (ent.type === EntityType.ACAD_TABLE) {
            const table = ent as any;
            const rowCount = Math.max(1, Math.min(TABLE_EXTENTS_CONFIG.maxFallbackRows, Math.floor(table.rowCount || 1)));
            const colCount = Math.max(1, Math.min(TABLE_EXTENTS_CONFIG.maxFallbackColumns, Math.floor(table.columnCount || 1)));
            const rowHeights = Array.isArray(table.rowHeights) ? table.rowHeights.slice(0, rowCount) : [];
            const colWidths = Array.isArray(table.colWidths) ? table.colWidths.slice(0, colCount) : [];
            const defaultRowH = Math.max(table.rowSpacing || TABLE_EXTENTS_CONFIG.defaultRowHeight, TABLE_EXTENTS_CONFIG.minRowHeight);
            const defaultColW = Math.max(table.columnSpacing || TABLE_EXTENTS_CONFIG.defaultColumnWidth, TABLE_EXTENTS_CONFIG.minColumnWidth);

            const scale = ent.scale || { x: 1, y: 1, z: 1 };
            
            ctx.save();
            const sPos = transform.project(ent.position);
            ctx.translate(sPos.x, sPos.y);
            const rotation = (table.rotation || 0) * Math.PI / 180;
            ctx.rotate(-rotation);
            
            ctx.beginPath();
            const sScale = transform.scale;
            
            // 行 Y 坐标数组
            const rowY: number[] = [0];
            let currentY = 0;
            for (let i = 0; i < rowCount; i++) {
                const h = (rowHeights[i] !== undefined ? rowHeights[i] : defaultRowH) * scale.y;
                currentY -= Math.max(h, TEXT_RENDER_CONFIG.minimumTableCellSize);
                rowY.push(currentY);
            }
            
            // 列 X 坐标数组
            const colX: number[] = [0];
            let currentX = 0;
            for (let j = 0; j < colCount; j++) {
                const w = (colWidths[j] !== undefined ? colWidths[j] : defaultColW) * scale.x;
                currentX += Math.max(w, TEXT_RENDER_CONFIG.minimumTableCellSize);
                colX.push(currentX);
            }
            
            const totalWidth = colX[colCount];
            const totalHeight = -rowY[rowCount];
            const tableAspectRatio = totalWidth > 0 && totalHeight > 0 ? Math.max(totalWidth / totalHeight, totalHeight / totalWidth) : Infinity;
            if (totalWidth > TABLE_EXTENTS_CONFIG.maxFallbackTotalWidth
                || totalHeight > TABLE_EXTENTS_CONFIG.maxFallbackTotalHeight
                || tableAspectRatio > TABLE_EXTENTS_CONFIG.maxFallbackAspectRatio) {
                ctx.restore();
                return;
            }

            // 绘制横线
            for (let i = 0; i <= rowCount; i++) {
                const y = rowY[i] * sScale;
                ctx.moveTo(0, y);
                ctx.lineTo(totalWidth * sScale, y);
            }
            // 绘制竖线
            for (let j = 0; j <= colCount; j++) {
                const x = colX[j] * sScale;
                ctx.moveTo(x, 0);
                ctx.lineTo(x, rowY[rowCount] * sScale);
            }
            ctx.stroke();

            // 绘制单元格文本
            if (table.cells && table.cells.length > 0) {
                ctx.fillStyle = color;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                
                table.cells.forEach((cell: string, idx: number) => {
                    const r = Math.floor(idx / colCount);
                    const c = idx % colCount;
                    if (r < rowCount && c < colCount) {
                        const cleanedCell = cleanMText(cell);
                        
                        const yTop = rowY[r];
                        const yBottom = rowY[r+1];
                        const xLeft = colX[c];
                        const xRight = colX[c+1];
                        
                        const cellH = Math.abs(yTop - yBottom);
                        const cellW = Math.abs(xRight - xLeft);
                        
                        const tx = (xLeft + cellW / 2) * sScale;
                        const tyCenter = (yTop + yBottom) / 2 * sScale;

                        const fontSize = (cellH * TEXT_RENDER_CONFIG.tableTextHeightFactor) * sScale;
                        ctx.font = `${fontSize}px sans-serif`;

                        const marginX = (cellW * TEXT_RENDER_CONFIG.tableTextHorizontalPaddingFactor) * sScale;
                        ctx.fillText(cleanedCell, tx, tyCenter, (cellW * sScale) - 2 * marginX);
                    }
                });
            }
            ctx.restore();
        }
        return;
    }

    const scale = ent.scale || { x: 1, y: 1, z: 1 };
    const rotation = (ent.rotation || 0) * Math.PI / 180;
    const cosR = Math.cos(rotation);
    const sinR = Math.sin(rotation);
    
    // 创建嵌套变换
    const nestedTransform: RenderTransform = {
        project: (p: Point2D) => {
            const px = p.x - block.basePoint.x;
            const py = p.y - block.basePoint.y;
            const sx = px * scale.x;
            const sy = py * scale.y;
            const rx = sx * cosR - sy * sinR;
            const ry = sx * sinR + sy * cosR;
            const tx = rx + ent.position.x;
            const ty = ry + ent.position.y;
            return transform.project({ x: tx, y: ty });
        },
        scale: transform.scale * Math.abs(scale.x),
        rotation: transform.rotation + rotation
    };

    const layerName = (ent.layer === '0' && parentLayerName) ? parentLayerName : ent.layer;
    const childNoWrap = noMTextWrap || ent.type === EntityType.ACAD_TABLE;

    // 递归绘制块实体
    block.entities.forEach(child => {
        if (child.type === EntityType.ATTDEF) return;
        drawEntityCallback(child, nestedTransform, layerName, color, isSelected, depth + 1, childNoWrap);
    });
    
    // 绘制块属性 (ATTRIB)
    if ((ent as any).attributes) {
        (ent as any).attributes.forEach((attr: AnyEntity) => {
            const val = (attr as any).value ? String((attr as any).value).trim() : '';
            if (!val) return;
            if ((attr as any).tag && val === (attr as any).tag) return;
            drawEntityCallback(attr, transform, layerName, color, isSelected, depth + 1, childNoWrap);
        });
    }
};

/**
 * 绘制尺寸标注 (DIMENSION)
 */
export const drawDimension = (
    ctx: CanvasRenderingContext2D,
    ent: DxfDimension,
    transform: RenderTransform,
    blocks: Record<string, DxfBlock>,
    theme: CanvasTheme,
    color: string,
    isSelected: boolean,
    parentLayerName: string | undefined,
    depth: number,
    noMTextWrap: boolean,
    drawEntityCallback: (
        child: AnyEntity,
        nestedTransform: RenderTransform,
        layerName: string,
        color: string,
        isSelected: boolean,
        depth: number,
        noWrap: boolean
    ) => void
) => {
    const block = blocks[ent.blockName];
    const layerName = (ent.layer === '0' && parentLayerName) ? parentLayerName : ent.layer;

    // 无有效标注块定义时的后备画线和数值标注
    if (!block || !block.entities || block.entities.length === 0) {
        const p1 = ent.linearP1 || ent.arcP1;
        const p2 = ent.linearP2 || ent.arcP2;
        if (p1 && p2) {
            const sp1 = transform.project(p1);
            const sp2 = transform.project(p2);
            ctx.beginPath();
            ctx.moveTo(sp1.x, sp1.y);
            ctx.lineTo(sp2.x, sp2.y);
            if (ent.definitionPoint) {
                const dp = transform.project(ent.definitionPoint);
                ctx.moveTo(sp1.x, sp1.y);
                ctx.lineTo(dp.x, dp.y);
                ctx.moveTo(sp2.x, sp2.y);
                ctx.lineTo(dp.x, dp.y);
            }
            ctx.stroke();
        }

        const label = ent.text && ent.text !== '<>'
            ? cleanCadText(ent.text)
            : (Number.isFinite(ent.measurement) && ent.measurement !== 0 ? String(Math.round(ent.measurement * 1000) / 1000) : '');
        if (label && ent.textMidPoint) {
            const tp = transform.project(ent.textMidPoint);
            ctx.save();
            ctx.font = `${Math.max(10, CAD_DEFAULT_TEXT_HEIGHT * transform.scale)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = color;
            ctx.fillText(label, tp.x, tp.y);
            ctx.restore();
        }
        return;
    }

    const dp = ent.definitionPoint;
    let treatAsLocal = false;
    if (block.extents) {
        const bw = block.extents.max.x - block.extents.min.x;
        const bh = block.extents.max.y - block.extents.min.y;
        const size = Math.max(Math.abs(bw), Math.abs(bh), 1);
        const bc = { x: (block.extents.min.x + block.extents.max.x) / 2, y: (block.extents.min.y + block.extents.max.y) / 2 };
        const distance = Math.hypot(bc.x - dp.x, bc.y - dp.y);
        treatAsLocal = distance > size * 5;
    }

    const nestedTransform: RenderTransform = treatAsLocal
        ? {
            project: (p: Point2D) => {
                const px = p.x - block.basePoint.x;
                const py = p.y - block.basePoint.y;
                return transform.project({ x: dp.x + px, y: dp.y + py });
            },
            scale: transform.scale,
            rotation: transform.rotation
        }
        : {
            project: (p: Point2D) => transform.project(p),
            scale: transform.scale,
            rotation: transform.rotation
        };

    block.entities.forEach(child => drawEntityCallback(child, nestedTransform, layerName, color, isSelected, depth + 1, noMTextWrap));
};
