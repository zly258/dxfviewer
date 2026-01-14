import React, { useId } from 'react';
import { DxfHatch, HatchLoop, HatchEdge, Point2D } from '../../types';

interface HatchRendererProps {
    entity: DxfHatch;
    color: string;
    onClick?: (e: React.MouseEvent) => void;
    offset?: Point2D;
}

const bulgeToArc = (p1: {x:number, y:number}, p2: {x:number, y:number}, bulge: number, ox: number = 0, oy: number = 0) => {
    if (bulge === 0 || Math.abs(bulge) < 1e-6) return `L ${p2.x - ox} ${p2.y - oy}`;
    const theta = 4 * Math.atan(bulge);
    const dist = Math.sqrt((p2.x - p1.x)**2 + (p2.y - p1.y)**2);
    if (dist < 1e-9) return ""; 
    const radius = dist / (2 * Math.sin(theta / 2));
    const absRadius = Math.abs(radius);
    const largeArc = Math.abs(theta) > Math.PI ? 1 : 0; 
    
    return `A ${absRadius} ${absRadius} 0 ${largeArc} ${bulge > 0 ? 0 : 1} ${p2.x - ox} ${p2.y - oy}`;
};

export const HatchRenderer: React.FC<HatchRendererProps> = ({ entity: ent, color, onClick, offset }) => {
    const ox = offset?.x || 0;
    const oy = offset?.y || 0;
    const uniqueId = useId().replace(/:/g, ''); 
    
    const buildLoopPath = (loop: HatchLoop) => {
        if (loop.isPolyline && loop.points && loop.points.length > 0) {
            const points = loop.points;
            const bulges = loop.bulges || [];
            let d = `M ${points[0].x - ox} ${points[0].y - oy}`;
            for (let i = 0; i < points.length; i++) {
                const p1 = points[i];
                const p2 = (i === points.length - 1) ? points[0] : points[i+1];
                const bulge = bulges[i] || 0;
                d += " " + bulgeToArc(p1, p2, bulge, ox, oy);
            }
            return d + ' Z';
        } else if (loop.edges && loop.edges.length > 0) {
            let d = "";
            let currentPt = {x:0, y:0};

            loop.edges.forEach((edge, i) => {
                // If it's the start of the loop or not connected, Move to start
                if (i === 0 && edge.start) {
                    d += `M ${edge.start.x - ox} ${edge.start.y - oy}`;
                    currentPt = edge.start;
                } else if (edge.start && (Math.abs(edge.start.x - currentPt.x) > 1e-4 || Math.abs(edge.start.y - currentPt.y) > 1e-4)) {
                     // Gap in edges, strictly move
                     d += ` M ${edge.start.x - ox} ${edge.start.y - oy}`;
                }
                
                if (edge.type === 'LINE' && edge.end) {
                    d += ` L ${edge.end.x - ox} ${edge.end.y - oy}`;
                    currentPt = edge.end;
                } else if (edge.type === 'ARC' && edge.radius && edge.center) {
                    const r = edge.radius;
                    let diff = (edge.endAngle || 0) - (edge.startAngle || 0);
                    // Normalize to 0-360
                    if (diff < 0) diff += 360;
                    if (edge.ccw === false) diff = 360 - diff; 

                    const largeArc = diff > 180 ? 1 : 0;
                    const sweep = edge.ccw !== false ? 1 : 0; 
                    
                    const x2 = edge.end ? edge.end.x : (edge.center.x + r * Math.cos((edge.endAngle || 0) * Math.PI / 180));
                    const y2 = edge.end ? edge.end.y : (edge.center.y + r * Math.sin((edge.endAngle || 0) * Math.PI / 180));
                    
                    d += ` A ${r} ${r} 0 ${largeArc} ${sweep} ${x2 - ox} ${y2 - oy}`;
                    currentPt = {x: x2, y: y2};
                } else if (edge.type === 'SPLINE' && edge.controlPoints) {
                     // Approximate spline with lines
                     const pts = edge.controlPoints;
                     if(pts.length > 0) {
                         // Simple polyline for spline control points as fallback
                         pts.forEach(p => d+= ` L ${p.x - ox} ${p.y - oy}`);
                         currentPt = pts[pts.length-1];
                     }
                }
            });
            return d + ' Z';
        }
        return '';
    };

    const paths = ent.loops.map(buildLoopPath).filter(p => p).join(' ');
    if (!paths) return null;

    const patternId = `hatchPattern_${uniqueId}`;

    return (
        <g onClick={onClick} className="hover-opacity cursor-pointer">
            {!ent.solid && (
                <defs>
                    <pattern id={patternId} patternUnits="userSpaceOnUse" width="5" height="5" patternTransform={`rotate(${ent.angle || 45}) scale(${ent.scale || 1})`}>
                        <path d="M-1,1 l2,-2 M0,5 l5,-5 M4,6 l2,-2" stroke={color} strokeWidth="0.5" />
                    </pattern>
                </defs>
            )}
            <path 
                d={paths} 
                fill={ent.solid ? color : `url(#${patternId})`} 
                stroke={ent.solid ? 'none' : color} 
                strokeWidth={ent.solid ? 0 : 1}
                fillOpacity={ent.solid ? 0.6 : 0.4} 
                fillRule="evenodd"
                vectorEffect="non-scaling-stroke"
            />
            {/* Draw border */}
            {!ent.solid && <path d={paths} fill="none" stroke={color} strokeWidth="1" vectorEffect="non-scaling-stroke" />}
        </g>
    );
};