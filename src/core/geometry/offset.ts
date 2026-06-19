import { AnyEntity, EntityType, Point2D } from '../../types';

/** 将实体的所有坐标字段按给定偏移量进行平移。 */
export const offsetEntity = (ent: AnyEntity, offset: Point2D): void => {
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
                ent.points.forEach((p: Point2D) => { p.x -= ox; p.y -= oy; });
            }
            break;
        case EntityType.MLINE:
            if (ent.vertices) {
                ent.vertices.forEach((p: Point2D) => { p.x -= ox; p.y -= oy; });
            }
            break;
        case EntityType.MLEADER:
            ent.leaderLines.forEach(line => line.forEach(point => { point.x -= ox; point.y -= oy; }));
            if (ent.textPosition) { ent.textPosition.x -= ox; ent.textPosition.y -= oy; }
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
            ent.position.x -= ox; ent.position.y -= oy;
            if ('secondPosition' in ent && ent.secondPosition) {
                ent.secondPosition.x -= ox;
                ent.secondPosition.y -= oy;
            }
            break;
        case EntityType.INSERT:
        case EntityType.ACAD_TABLE:
            ent.position.x -= ox; ent.position.y -= oy;
            if (ent.type === EntityType.INSERT && ent.attributes) {
                ent.attributes.forEach((attr: AnyEntity) => offsetEntity(attr, offset));
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
    // 更新偏移后实体的包围盒范围
    if (ent.extents) {
        ent.extents.min.x -= ox; ent.extents.min.y -= oy;
        ent.extents.max.x -= ox; ent.extents.max.y -= oy;
    }
};
