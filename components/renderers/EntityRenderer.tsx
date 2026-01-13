import React from 'react';
import { AnyEntity, EntityType, DxfLayer, DxfBlock, DxfStyle, Point2D } from '../../types';
import { AUTO_CAD_COLORS, DEFAULT_COLOR, LINE_TYPE_MAP } from '../../constants';
import { TextRenderer, MTextRenderer } from './TextRenderer';
import { HatchRenderer } from './HatchRenderer';
import { InsertRenderer } from './InsertRenderer';
import { getBSplinePoints } from '../../services/dxfService';

interface EntityRendererProps {
    entity: AnyEntity;
    layers: Record<string, DxfLayer>;
    blocks: Record<string, DxfBlock>;
    styles: Record<string, DxfStyle>;
    selectedIds?: Set<string>;
    onSelect?: (id: string, multi: boolean) => void;
    parentLayer?: string;
    parentColor?: string; // Hex color passed from parent block if ByBlock
    depth?: number; // Recursion depth for blocks
}

// Helper to calculate point on ellipse
const getEllipsePoint = (cx: number, cy: number, majorX: number, majorY: number, ratio: number, param: number) => {
    const cosT = Math.cos(param);
    const sinT = Math.sin(param);
    const minorX = -majorY * ratio;
    const minorY = majorX * ratio;
    return {
        x: cx + majorX * cosT + minorX * sinT,
        y: cy + majorY * cosT + minorY * sinT
    };
};

export const EntityRenderer: React.FC<EntityRendererProps> = ({ 
    entity: ent, layers, blocks, styles, selectedIds, onSelect, parentLayer, parentColor, depth = 0
}) => {
    if (ent.visible === false) return null;

    const effectiveLayerName = (ent.layer === '0' && parentLayer) ? parentLayer : ent.layer;
    const layer = layers[effectiveLayerName];
    if (layer && layer.isVisible === false) return null;

    let colorStr = DEFAULT_COLOR;
    if (ent.color === 0 && parentColor) {
        colorStr = parentColor;
    } else if (ent.color === 256 || ent.color === undefined) {
        colorStr = layer ? (AUTO_CAD_COLORS[layer.color] || DEFAULT_COLOR) : DEFAULT_COLOR;
    } else {
        colorStr = AUTO_CAD_COLORS[Math.abs(ent.color)] || DEFAULT_COLOR;
    }

    const isSelected = selectedIds?.has(ent.id);
    if (isSelected) colorStr = '#3B82F6'; 

    const handleClick = (e: React.MouseEvent) => {
        if (onSelect) {
            e.stopPropagation();
            onSelect(ent.id, e.ctrlKey || e.metaKey);
        }
    };

    const strokeWidth = isSelected ? 3 : 1; 
    let ltype = ent.lineType?.toUpperCase() || 'BYLAYER';
    if (ltype === 'BYLAYER') ltype = layer?.lineType?.toUpperCase() || 'CONTINUOUS';
    const dashArray = isSelected ? undefined : LINE_TYPE_MAP[ltype];

    const commonProps = {
        stroke: colorStr,
        strokeWidth,
        strokeDasharray: dashArray,
        vectorEffect: "non-scaling-stroke" as "non-scaling-stroke",
        onClick: handleClick,
        className: "hover:opacity-80 cursor-pointer",
        strokeLinejoin: "round" as "round",
        strokeLinecap: "round" as "round"
    };

    switch (ent.type) {
        case EntityType.LINE:
            return <line x1={ent.start.x} y1={ent.start.y} x2={ent.end.x} y2={ent.end.y} {...commonProps} />;
        case EntityType.POINT:
            return <circle cx={ent.position.x} cy={ent.position.y} r={0.5} fill={colorStr} stroke="none" vectorEffect="non-scaling-stroke" />;
        case EntityType.CIRCLE:
            return <circle cx={ent.center.x} cy={ent.center.y} r={ent.radius} fill="none" {...commonProps} />;
        case EntityType.ARC: {
            const isFlipped = (ent.extrusion?.z || 1) < 0;
            const startRad = ent.startAngle * Math.PI / 180;
            const endRad = ent.endAngle * Math.PI / 180;
            
            const x1 = ent.center.x + ent.radius * Math.cos(startRad);
            const y1 = ent.center.y + ent.radius * Math.sin(startRad);
            const x2 = ent.center.x + ent.radius * Math.cos(endRad);
            const y2 = ent.center.y + ent.radius * Math.sin(endRad);
            
            let diff = endRad - startRad;
            if (diff < 0) diff += 2 * Math.PI;
            
            const largeArc = diff > Math.PI ? 1 : 0;
            const sweep = isFlipped ? 0 : 1; 
            
            const d = `M ${x1} ${y1} A ${ent.radius} ${ent.radius} 0 ${largeArc} ${sweep} ${x2} ${y2}`;
            return <path d={d} fill="none" {...commonProps} />;
        }
        case EntityType.RAY: {
            // Represent as a very long line
            const length = 1000000;
            const x2 = ent.basePoint.x + ent.direction.x * length;
            const y2 = ent.basePoint.y + ent.direction.y * length;
            return <line x1={ent.basePoint.x} y1={ent.basePoint.y} x2={x2} y2={y2} {...commonProps} />;
        }
        case EntityType.XLINE: {
            // Represent as a very long line in both directions
            const length = 1000000;
            const x1 = ent.basePoint.x - ent.direction.x * length;
            const y1 = ent.basePoint.y - ent.direction.y * length;
            const x2 = ent.basePoint.x + ent.direction.x * length;
            const y2 = ent.basePoint.y + ent.direction.y * length;
            return <line x1={x1} y1={y1} x2={x2} y2={y2} {...commonProps} />;
        }
        case EntityType.LWPOLYLINE:
        case EntityType.POLYLINE: {
            if (ent.points.length < 2) return null;
            const d = ent.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + (ent.closed ? ' Z' : '');
            return <path d={d} fill="none" {...commonProps} />;
        }
        case EntityType.LEADER: {
            if (ent.points.length < 2) return null;
            let d = ent.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

            // Handle Hook Line (Landing)
            if (ent.hasHookLine) {
                const lastPt = ent.points[ent.points.length - 1];
                const prevPt = ent.points[ent.points.length - 2];
                const hookLength = 3; // Fixed length fallback
                const directionX = (lastPt.x - prevPt.x) >= 0 ? 1 : -1;
                const hookEndX = lastPt.x + (directionX * hookLength);
                d += ` L ${hookEndX} ${lastPt.y}`;
            }
            
            let arrow = null;
            if (ent.arrowHeadFlag === 1) {
                const p1 = ent.points[0]; // Arrow Tip
                const p2 = ent.points[1];
                const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
                const size = 3; // Slightly larger arrow size
                
                // Angle is direction from tip to back.
                // Arrow tails should be "back" along the line.
                // p1 is tip. p1 + vector(angle) is towards p2.
                // We want tails at p1 + rotated vectors.
                const ax1 = p1.x + Math.cos(angle + Math.PI/10) * size;
                const ay1 = p1.y + Math.sin(angle + Math.PI/10) * size;
                const ax2 = p1.x + Math.cos(angle - Math.PI/10) * size;
                const ay2 = p1.y + Math.sin(angle - Math.PI/10) * size;
                
                arrow = <polygon points={`${p1.x},${p1.y} ${ax1},${ay1} ${ax2},${ay2}`} fill={colorStr} stroke="none" vectorEffect="non-scaling-stroke" />;
            }

            return (
                <g>
                   <path d={d} fill="none" {...commonProps} />
                   {arrow}
                </g>
            );
        }
        case EntityType.SOLID: {
            const pts = ent.points;
            if(pts.length < 3) return null;
            const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z';
            return <path d={d} fill={colorStr} stroke="none" onClick={handleClick} className="hover:opacity-80 cursor-pointer"/>;
        }
        case EntityType.THREEDFACE: {
            const pts = ent.points;
            if(pts.length < 3) return null;
            const flags = ent.edgeFlags || 0;
            const paths: string[] = [];
            for (let i = 0; i < pts.length; i++) {
                const isVisible = (flags & (1 << i)) === 0;
                if (isVisible) {
                    const p1 = pts[i];
                    const p2 = pts[(i + 1) % pts.length];
                    paths.push(`M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`);
                }
            }
            return <path d={paths.join(' ')} fill="none" {...commonProps} />;
        }
        case EntityType.ELLIPSE: {
            const startP = ent.startParam;
            const endP = ent.endParam;
            const isFull = Math.abs(Math.abs(endP - startP) - 2 * Math.PI) < 1e-4 || (startP === 0 && endP === 0);

            const rx = Math.sqrt(ent.majorAxis.x ** 2 + ent.majorAxis.y ** 2);
            const ry = rx * ent.ratio;
            const rotationDeg = Math.atan2(ent.majorAxis.y, ent.majorAxis.x) * 180 / Math.PI;

            if (isFull) {
                return <ellipse cx={ent.center.x} cy={ent.center.y} rx={rx} ry={ry} transform={`rotate(${rotationDeg} ${ent.center.x} ${ent.center.y})`} fill="none" {...commonProps} />;
            } else {
                const p1 = getEllipsePoint(ent.center.x, ent.center.y, ent.majorAxis.x, ent.majorAxis.y, ent.ratio, startP);
                const p2 = getEllipsePoint(ent.center.x, ent.center.y, ent.majorAxis.x, ent.majorAxis.y, ent.ratio, endP);
                
                let diff = endP - startP;
                if (diff < 0) diff += 2 * Math.PI;
                const largeArc = diff > Math.PI ? 1 : 0;
                
                return (
                    <path 
                        d={`M ${p1.x} ${p1.y} A ${rx} ${ry} ${rotationDeg} ${largeArc} 1 ${p2.x} ${p2.y}`} 
                        fill="none" 
                        {...commonProps} 
                    />
                );
            }
        }
        case EntityType.SPLINE: {
             // Prioritize Control Points for NURBS rendering
             let points: Point2D[] = [];
             if (ent.controlPoints && ent.controlPoints.length > 0) {
                 points = getBSplinePoints(ent.controlPoints, ent.degree || 3, ent.knots, ent.weights);
             } else if (ent.fitPoints && ent.fitPoints.length > 0) {
                 points = ent.fitPoints;
             }
             
             if (!points || points.length < 2) return null;
             const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
             return <path d={d} fill="none" {...commonProps} />;
        }
        case EntityType.TEXT:
        case EntityType.ATTRIB:
        case EntityType.ATTDEF:
            return <TextRenderer entity={ent} color={colorStr} styles={styles} onClick={handleClick} isSelected={isSelected} />;
        case EntityType.MTEXT:
            return <MTextRenderer entity={ent} color={colorStr} styles={styles} onClick={handleClick} isSelected={isSelected} />;
        case EntityType.HATCH:
            return <HatchRenderer entity={ent} color={colorStr} onClick={handleClick} />;
        case EntityType.INSERT:
            return (
                <InsertRenderer 
                    entity={ent} 
                    blocks={blocks} 
                    layers={layers} 
                    styles={styles} 
                    color={colorStr} 
                    layerName={effectiveLayerName} 
                    selectedIds={selectedIds}
                    onSelect={onSelect}
                    onClick={handleClick} 
                    depth={depth} 
                />
            );
        case EntityType.DIMENSION: {
            const block = blocks[ent.blockName];
            if (!block) {
                return (
                    <g transform={`translate(${ent.textMidPoint.x}, ${ent.textMidPoint.y}) scale(1, -1)`}>
                         <text fontSize={2.5} fill={colorStr} textAnchor="middle" fontFamily="sans-serif">
                            {ent.text || (ent.measurement ? ent.measurement.toFixed(2) : "?")}
                        </text>
                    </g>
                );
            }
            return (
                 <g onClick={handleClick} className="cursor-pointer">
                    {block.entities.map(child => (
                        <EntityRenderer 
                            key={child.id} 
                            // Force dimension block entities to inherit the dimension entity's color (ByBlock)
                            // This ensures text and lines match the dimension's color override.
                            entity={(child.color === undefined || child.color === 256 || child.color === 0) ? { ...child, color: 0 } : child}
                            layers={layers} 
                            blocks={blocks} 
                            styles={styles}
                            selectedIds={selectedIds}
                            onSelect={onSelect}
                            parentLayer={effectiveLayerName}
                            parentColor={colorStr}
                            depth={depth + 1}
                        />
                    ))}
                 </g>
            );
        }
        default:
            return null;
    }
};