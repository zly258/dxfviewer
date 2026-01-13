import React from 'react';
import { AnyEntity, EntityType } from '../types';

interface PropertiesPanelProps {
  selectedEntities: AnyEntity[];
}

const PropertiesPanel: React.FC<PropertiesPanelProps> = ({ selectedEntities }) => {
  
  const renderPropertyRow = (label: string, value: React.ReactNode) => (
      <tr key={label} className="border-b border-gray-100 hover:bg-gray-50">
        <td className="py-2.5 pl-3 text-gray-500 w-28 align-top font-medium text-sm bg-gray-50/50">{label}</td>
        <td className="py-2.5 pr-3 font-mono text-gray-800 break-all text-right text-sm">{value}</td>
      </tr>
  );

  const renderEntityProperties = (ent: AnyEntity) => {
      const commonRows = [
          renderPropertyRow("Type", <span className="text-blue-600 font-bold">{ent.type}</span>),
          renderPropertyRow("Handle", ent.handle || "N/A"),
          renderPropertyRow("Layer", ent.layer),
          renderPropertyRow("Color", ent.color === 256 ? "ByLayer" : (ent.color === 0 ? "ByBlock" : ent.color)),
      ];

      let specificRows: React.ReactNode[] = [];

      switch (ent.type) {
          case EntityType.LINE:
              specificRows = [
                  renderPropertyRow("Start X", ent.start.x.toFixed(3)),
                  renderPropertyRow("Start Y", ent.start.y.toFixed(3)),
                  renderPropertyRow("End X", ent.end.x.toFixed(3)),
                  renderPropertyRow("End Y", ent.end.y.toFixed(3)),
                  renderPropertyRow("Length", Math.sqrt(Math.pow(ent.end.x - ent.start.x, 2) + Math.pow(ent.end.y - ent.start.y, 2)).toFixed(4))
              ];
              break;
          case EntityType.CIRCLE:
              specificRows = [
                  renderPropertyRow("Center X", ent.center.x.toFixed(3)),
                  renderPropertyRow("Center Y", ent.center.y.toFixed(3)),
                  renderPropertyRow("Radius", ent.radius.toFixed(4)),
                  renderPropertyRow("Area", (Math.PI * ent.radius * ent.radius).toFixed(4))
              ];
              break;
          case EntityType.ARC:
              specificRows = [
                  renderPropertyRow("Center X", ent.center.x.toFixed(3)),
                  renderPropertyRow("Center Y", ent.center.y.toFixed(3)),
                  renderPropertyRow("Radius", ent.radius.toFixed(4)),
                  renderPropertyRow("Start Angle", `${ent.startAngle.toFixed(1)}°`),
                  renderPropertyRow("End Angle", `${ent.endAngle.toFixed(1)}°`),
              ];
              break;
          case EntityType.SOLID:
          case EntityType.THREEDFACE:
              specificRows = [
                  renderPropertyRow("Vertices", ent.points.length),
                  ...ent.points.map((p, i) => renderPropertyRow(`Vertex ${i+1}`, `${p.x.toFixed(3)}, ${p.y.toFixed(3)}`))
              ];
              break;
          case EntityType.LWPOLYLINE:
          case EntityType.POLYLINE:
              specificRows = [
                  renderPropertyRow("Closed", ent.closed ? "Yes" : "No"),
                  renderPropertyRow("Vertices", ent.points.length),
              ];
              break;
          case EntityType.TEXT:
          case EntityType.MTEXT:
          case EntityType.ATTRIB:
          case EntityType.ATTDEF:
              specificRows = [
                  renderPropertyRow("Content", <span className="text-xs">{ent.value.substring(0, 50)}{ent.value.length > 50 && "..."}</span>),
                  renderPropertyRow("Height", ent.height.toFixed(4)),
                  renderPropertyRow("Pos X", ent.position.x.toFixed(3)),
                  renderPropertyRow("Pos Y", ent.position.y.toFixed(3)),
                  renderPropertyRow("Rotation", `${ent.rotation?.toFixed(1)}°`),
                  ent.type === EntityType.MTEXT && renderPropertyRow("Width", ent.width ? ent.width.toFixed(3) : "Auto")
              ].filter(Boolean);
              break;
          case EntityType.INSERT:
              specificRows = [
                  renderPropertyRow("Block", ent.blockName),
                  renderPropertyRow("Pos X", ent.position.x.toFixed(3)),
                  renderPropertyRow("Pos Y", ent.position.y.toFixed(3)),
                  renderPropertyRow("Scale", `${ent.scale.x.toFixed(2)}, ${ent.scale.y.toFixed(2)}`),
                  renderPropertyRow("Rotation", `${ent.rotation.toFixed(1)}°`),
              ];
              break;
           case EntityType.HATCH:
              specificRows = [
                  renderPropertyRow("Pattern", ent.patternName),
                  renderPropertyRow("Style", ent.solid ? "Solid" : "Pattern"),
                  renderPropertyRow("Loops", ent.loops.length),
              ];
              break;
           case EntityType.DIMENSION:
              specificRows = [
                  renderPropertyRow("Value", ent.measurement?.toFixed(4)),
                  renderPropertyRow("Text", ent.text || "(Auto)"),
              ];
              break;
      }

      return (
          <table className="w-full text-sm border-collapse bg-white">
              <tbody>
                  {commonRows}
                  {specificRows}
              </tbody>
          </table>
      );
  };

  return (
      <div className="w-80 bg-white border-l border-gray-300 flex flex-col h-full shrink-0 z-20">
        <div className="h-10 bg-gray-100 border-b border-gray-300 flex items-center px-4 text-xs font-bold text-gray-700 uppercase tracking-wider shrink-0">
           属性面板
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar p-0 bg-white">
          {selectedEntities.length === 1 ? (
             renderEntityProperties(selectedEntities[0])
          ) : selectedEntities.length > 1 ? (
             <div className="flex flex-col items-center justify-center h-40 text-gray-400 gap-3 p-6 text-center">
               <span className="font-medium text-gray-500 text-sm">已选择 {selectedEntities.length} 个对象</span>
               <span className="text-xs text-gray-400">选择单个对象以查看详细属性</span>
             </div>
          ) : (
             <div className="flex flex-col items-center justify-center h-40 text-gray-400 italic gap-3 p-6">
               <span className="text-sm">未选择对象</span>
             </div>
          )}
        </div>
      </div>
  );
};

export default PropertiesPanel;