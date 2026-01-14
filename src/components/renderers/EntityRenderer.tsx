import React from 'react';
import { AnyEntity, EntityType, DxfLayer, DxfBlock, DxfStyle, Point2D } from '../../types';
import { DEFAULT_COLOR, LINE_TYPE_MAP } from '../../constants';
import { AUTO_CAD_COLORS } from '../../utils/colorUtils';
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
    offset?: Point2D;
}

// Helper to calculate point on ellipse
const getEllipsePoint = (cx: number, cy: number, majorX: number, majorY: number, ratio: number, param: number, ox: number = 0, oy: number = 0) => {
    const cosT = Math.cos(param);
    const sinT = Math.sin(param);
    const minorX = -majorY * ratio;
    const minorY = majorX * ratio;
    return {
        x: (cx - ox) + majorX * cosT + minorX * sinT,
        y: (cy - oy) + majorY * cosT + minorY * sinT
    };
};

// Helper to generate path data for polylines with bulges
const getPolylinePathData = (points: Point2D[], bulges: number[] | undefined, closed: boolean, ox: number = 0, oy: number = 0, isFlipped: boolean = false) => {
    if (points.length < 1) return "";
    let d = `M ${points[0].x - ox} ${points[0].y - oy}`;
    
    for (let i = 0; i < (closed ? points.length : points.length - 1); i++) {
        const p1 = points[i];
        const p2 = points[(i + 1) % points.length];
        const bulge = bulges ? (bulges[i] || 0) : 0;
        
        if (Math.abs(bulge) < 1e-6) {
            d += ` L ${p2.x - ox} ${p2.y - oy}`;
        } else {
            const dist = Math.sqrt((p2.x - p1.x)**2 + (p2.y - p1.y)**2);
            if (dist > 1e-9) {
                const theta = 4 * Math.atan(bulge);
                const radius = Math.abs(dist / (2 * Math.sin(theta / 2)));
                const largeArc = Math.abs(theta) > Math.PI ? 1 : 0;
                
                // If N.z = -1, CCW in OCS becomes CW in WCS.
                // bulge > 0 is CCW in OCS.
                // sweep 1 is CCW, sweep 0 is CW in SVG.
                let sweep = bulge > 0 ? 1 : 0;
                if (isFlipped) sweep = sweep === 1 ? 0 : 1;
                
                d += ` A ${radius} ${radius} 0 ${largeArc} ${sweep} ${p2.x - ox} ${p2.y - oy}`;
            } else {
                d += ` L ${p2.x - ox} ${p2.y - oy}`;
            }
        }
    }
    if (closed) d += " Z";
    return d;
};

export const EntityRenderer: React.FC<EntityRendererProps> = ({ 
    entity: ent, layers, blocks, styles, selectedIds, onSelect, parentLayer, parentColor, depth = 0, offset = {x: 0, y: 0}
}) => {
    if (ent.visible === false) return null;

    const ox = offset.x;
    const oy = offset.y;

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
            return <line x1={ent.start.x - ox} y1={ent.start.y - oy} x2={ent.end.x - ox} y2={ent.end.y - oy} {...commonProps} />;
        case EntityType.POINT:
            return <circle cx={ent.position.x - ox} cy={ent.position.y - oy} r={0.5} fill={colorStr} stroke="none" vectorEffect="non-scaling-stroke" />;
        case EntityType.CIRCLE:
            return <circle cx={ent.center.x - ox} cy={ent.center.y - oy} r={ent.radius} fill="none" {...commonProps} />;
        case EntityType.ARC: {
            const isFlipped = (ent.extrusion?.z || 1) < 0;
            
            const startRad = ent.startAngle * Math.PI / 180;
            const endRad = ent.endAngle * Math.PI / 180;
            
            const x1 = (ent.center.x - ox) + ent.radius * Math.cos(startRad);
            const y1 = (ent.center.y - oy) + ent.radius * Math.sin(startRad);
            const x2 = (ent.center.x - ox) + ent.radius * Math.cos(endRad);
            const y2 = (ent.center.y - oy) + ent.radius * Math.sin(endRad);
            
            // If isFlipped is true, sweep direction is CW (0 in SVG)
            let diff = isFlipped ? (startRad - endRad) : (endRad - startRad);
            while (diff < 0) diff += 2 * Math.PI;
            while (diff > 2 * Math.PI) diff -= 2 * Math.PI;
            
            const largeArc = diff > Math.PI ? 1 : 0;
            const sweep = isFlipped ? 0 : 1; 
            
            const d = `M ${x1} ${y1} A ${ent.radius} ${ent.radius} 0 ${largeArc} ${sweep} ${x2} ${y2}`;
            return <path d={d} fill="none" {...commonProps} />;
        }
        case EntityType.RAY: {
            // Represent as a very long line
            const length = 1000000;
            const x2 = (ent.basePoint.x - ox) + ent.direction.x * length;
            const y2 = (ent.basePoint.y - oy) + ent.direction.y * length;
            return <line x1={ent.basePoint.x - ox} y1={ent.basePoint.y - oy} x2={x2} y2={y2} {...commonProps} />;
        }
        case EntityType.XLINE: {
            // Represent as a very long line in both directions
            const length = 1000000;
            const x1 = (ent.basePoint.x - ox) - ent.direction.x * length;
            const y1 = (ent.basePoint.y - oy) - ent.direction.y * length;
            const x2 = (ent.basePoint.x - ox) + ent.direction.x * length;
            const y2 = (ent.basePoint.y - oy) + ent.direction.y * length;
            return <line x1={x1} y1={y1} x2={x2} y2={y2} {...commonProps} />;
        }
        case EntityType.LWPOLYLINE:
        case EntityType.POLYLINE: {
            if (ent.points.length < 2) return null;
            const d = getPolylinePathData(ent.points, ent.bulges, ent.closed, ox, oy, (ent.extrusion?.z || 1) < 0);
            return <path d={d} fill="none" {...commonProps} />;
        }
        case EntityType.LEADER: {
            if (ent.points.length < 2) return null;
            let d = ent.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x - ox} ${p.y - oy}`).join(' ');

            // Handle Hook Line (Landing)
            if (ent.hasHookLine) {
                const lastPt = ent.points[ent.points.length - 1];
                const prevPt = ent.points[ent.points.length - 2];
                const hookLength = 3; // Fixed length fallback
                const directionX = (lastPt.x - prevPt.x) >= 0 ? 1 : -1;
                const hookEndX = (lastPt.x - ox) + (directionX * hookLength);
                d += ` L ${hookEndX} ${lastPt.y - oy}`;
            }
            
            let arrow = null;
            if (ent.arrowHeadFlag === 1) {
                const p1 = ent.points[0]; // Arrow Tip
                const p2 = ent.points[1];
                const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
                const size = 3; // Slightly larger arrow size
                
                const ax1 = (p1.x - ox) + Math.cos(angle + Math.PI/10) * size;
                const ay1 = (p1.y - oy) + Math.sin(angle + Math.PI/10) * size;
                const ax2 = (p1.x - ox) + Math.cos(angle - Math.PI/10) * size;
                const ay2 = (p1.y - oy) + Math.sin(angle - Math.PI/10) * size;
                
                arrow = <polygon points={`${p1.x - ox},${p1.y - oy} ${ax1},${ay1} ${ax2},${ay2}`} fill={colorStr} stroke="none" vectorEffect="non-scaling-stroke" />;
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
            const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x - ox} ${p.y - oy}`).join(' ') + ' Z';
            return <path d={d} fill={colorStr} stroke="none" onClick={handleClick} className="hover-opacity cursor-pointer"/>;
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
                    paths.push(`M ${p1.x - ox} ${p1.y - oy} L ${p2.x - ox} ${p2.y - oy}`);
                }
            }
            return <path d={paths.join(' ')} fill="none" {...commonProps} />;
        }
        case EntityType.ELLIPSE: {
            const isFlipped = (ent.extrusion?.z || 1) < 0;
            const startP = ent.startParam;
            const endP = ent.endParam;
            const isFull = Math.abs(Math.abs(endP - startP) - 2 * Math.PI) < 1e-4 || (startP === 0 && endP === 0);

            const rx = Math.sqrt(ent.majorAxis.x ** 2 + ent.majorAxis.y ** 2);
            const ry = rx * ent.ratio;
            const rotationDeg = Math.atan2(ent.majorAxis.y, ent.majorAxis.x) * 180 / Math.PI;

            if (isFull) {
                return <ellipse cx={ent.center.x - ox} cy={ent.center.y - oy} rx={rx} ry={ry} transform={`rotate(${rotationDeg} ${ent.center.x - ox} ${ent.center.y - oy})`} fill="none" {...commonProps} />;
            } else {
                const p1 = getEllipsePoint(ent.center.x, ent.center.y, ent.majorAxis.x, ent.majorAxis.y, ent.ratio, startP, ox, oy);
                const p2 = getEllipsePoint(ent.center.x, ent.center.y, ent.majorAxis.x, ent.majorAxis.y, ent.ratio, endP, ox, oy);
                
                let diff = isFlipped ? (startP - endP) : (endP - startP);
                while (diff < 0) diff += 2 * Math.PI;
                const largeArc = diff > Math.PI ? 1 : 0;
                const sweep = isFlipped ? 0 : 1;
                
                return (
                    <path 
                        d={`M ${p1.x} ${p1.y} A ${rx} ${ry} ${rotationDeg} ${largeArc} ${sweep} ${p2.x} ${p2.y}`} 
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
             const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x - ox} ${p.y - oy}`).join(' ');
             return <path d={d} fill="none" {...commonProps} />;
        }
        case EntityType.TEXT:
        case EntityType.ATTRIB:
        case EntityType.ATTDEF:
            return <TextRenderer entity={ent} color={colorStr} styles={styles} onClick={handleClick} isSelected={isSelected} offset={offset} />;
        case EntityType.MTEXT:
            return <MTextRenderer entity={ent} color={colorStr} styles={styles} onClick={handleClick} isSelected={isSelected} offset={offset} />;
        case EntityType.HATCH:
            return <HatchRenderer entity={ent} color={colorStr} onClick={handleClick} offset={offset} />;
        case EntityType.INSERT:
        case EntityType.ACAD_TABLE:
            return (
                <InsertRenderer 
                    entity={ent as any} 
                    blocks={blocks} 
                    layers={layers} 
                    styles={styles} 
                    color={colorStr} 
                    layerName={effectiveLayerName} 
                    selectedIds={selectedIds}
                    onSelect={onSelect}
                    onClick={handleClick} 
                    depth={depth} 
                    offset={offset}
                />
            );
        case EntityType.DIMENSION: {
            const block = blocks[ent.blockName];
            if (!block) {
                return (
                    <g transform={`translate(${ent.textMidPoint.x - ox}, ${ent.textMidPoint.y - oy}) scale(1, -1)`}>
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
                            entity={(child.color === undefined || child.color === 256 || child.color === 0) ? { ...child, color: 0 } : child}
                            layers={layers} 
                            blocks={blocks} 
                            styles={styles}
                            selectedIds={selectedIds}
                            onSelect={onSelect}
                            parentLayer={effectiveLayerName}
                            parentColor={colorStr}
                            depth={depth + 1}
                            offset={offset}
                        />
                    ))}
                </g>
            );
        }
        default:
            return null;
    }
};