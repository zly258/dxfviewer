import { DxfInsert, DxfBlock, DxfLayer, DxfStyle, EntityType, Point2D } from '../../types';
import { EntityRenderer } from './EntityRenderer';

interface InsertRendererProps {
    entity: DxfInsert;
    blocks: Record<string, DxfBlock>;
    layers: Record<string, DxfLayer>;
    styles: Record<string, DxfStyle>;
    color: string; // Parent color (if ByBlock)
    layerName: string; // Parent layer (if 0)
    selectedIds?: Set<string>;
    onSelect?: (id: string, multi: boolean) => void;
    onClick?: (e: React.MouseEvent) => void;
    depth?: number;
    offset?: Point2D;
}

export const InsertRenderer: React.FC<InsertRendererProps> = ({ 
    entity: ent, blocks, layers, styles, color, layerName, selectedIds, onSelect, onClick, depth = 0, offset
}) => {
    const ox = offset?.x || 0;
    const oy = offset?.y || 0;

    // Limit recursion depth to prevent crashes on circular references
    if (depth > 20) return null;

    const block = blocks[ent.blockName];
    if (!block) return null;

    const rows = ent.rowCount > 1 ? ent.rowCount : 1;
    const cols = ent.colCount > 1 ? ent.colCount : 1;
    const rowSpace = ent.rowSpacing || 0;
    const colSpace = ent.colSpacing || 0;

    // Filter entities to render. 
    // Hide non-constant ATTDEF entities. 
    // Real attributes (ATTRIB) attached to the Insert will be rendered separately.
    const entitiesToRender = block.entities.filter(child => {
        if (child.type === EntityType.ATTDEF) {
             const flags = child.flags || 0;
             const isConstant = (flags & 2) === 2;
             return isConstant;
        }
        return true;
    });

    // Handle Block Base Point: Translate -BasePoint
    // transform order: translate(InsertPos) rotate(Rot) scale(Scale) translate(-BasePoint)
    const basePoint = block.basePoint || { x: 0, y: 0 };

    const instances = [];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const key = `r${r}-c${c}`;
            const xOff = c * colSpace;
            const yOff = r * rowSpace;
            instances.push(
                <g key={key} transform={`translate(${xOff}, ${yOff})`}>
                    <g transform={`translate(${-basePoint.x}, ${-basePoint.y})`}>
                        {entitiesToRender.map(child => (
                            <EntityRenderer 
                                key={child.id} 
                                entity={child} 
                                layers={layers} 
                                blocks={blocks} 
                                styles={styles}
                                selectedIds={selectedIds}
                                onSelect={onSelect}
                                parentLayer={layerName} 
                                parentColor={color}
                                depth={depth + 1}
                                // Children of a block are in local space, so we don't pass the global offset.
                                // The global offset is already handled by the translate of the parent INSERT.
                            />
                        ))}
                    </g>
                </g>
            );
        }
    }

    // Attributes attached to the Insert (ATTRIB)
    // These contain the actual values for the block instance.
    // Attributes are in world coordinates, so they need the global offset.
    const attributes = ent.attributes?.map(attr => (
        <EntityRenderer 
            key={attr.id}
            entity={attr}
            layers={layers}
            blocks={blocks}
            styles={styles}
            selectedIds={selectedIds}
            onSelect={onSelect}
            parentLayer={layerName}
            parentColor={color}
            depth={depth + 1}
            offset={offset}
        />
    ));

    return (
        <g onClick={(e) => { e.stopPropagation(); onClick && onClick(e); }} className="cursor-pointer">
            <g transform={`translate(${ent.position.x - ox}, ${ent.position.y - oy}) rotate(${ent.rotation}) scale(${ent.scale.x}, ${ent.scale.y})`}>
                {instances}
            </g>
            {attributes && <g>{attributes}</g>}
        </g>
    );
};