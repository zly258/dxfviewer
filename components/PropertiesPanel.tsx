import React from 'react';
import { AnyEntity, EntityType, DxfStyle } from '../types';
import { getAutoCadColor } from '../constants';
import { getStyleFontFamily } from '../services/fontService';

export const ENTITY_TYPE_TRANSLATIONS: Record<string, string> = {
  [EntityType.LINE]: "线 (LINE)",
  [EntityType.ARC]: "弧 (ARC)",
  [EntityType.CIRCLE]: "圆 (CIRCLE)",
  [EntityType.LWPOLYLINE]: "多段线 (LWPOLYLINE)",
  [EntityType.POLYLINE]: "多段线 (POLYLINE)",
  [EntityType.TEXT]: "单行文字 (TEXT)",
  [EntityType.MTEXT]: "多行文字 (MTEXT)",
  [EntityType.INSERT]: "块参照 (INSERT)",
  [EntityType.HATCH]: "填充 (HATCH)",
  [EntityType.DIMENSION]: "标注 (DIMENSION)",
  [EntityType.SPLINE]: "样条曲线 (SPLINE)",
  [EntityType.ELLIPSE]: "椭圆 (ELLIPSE)",
  [EntityType.SOLID]: "二维填充 (SOLID)",
  [EntityType.THREEDFACE]: "三维面 (3DFACE)",
  [EntityType.POINT]: "点 (POINT)",
  [EntityType.LEADER]: "引线 (LEADER)",
  [EntityType.RAY]: "射线 (RAY)",
  [EntityType.XLINE]: "构造线 (XLINE)",
  [EntityType.ATTDEF]: "属性定义 (ATTDEF)",
  [EntityType.ATTRIB]: "属性 (ATTRIB)",
  [EntityType.ACAD_TABLE]: "表格 (TABLE)",
};

const LABEL_TRANSLATIONS: Record<string, string> = {
  "Type": "类型 (Type)",
  "Handle": "句柄 (Handle)",
  "Layer": "图层 (Layer)",
  "Color": "颜色 (Color)",
  "Linetype": "线型 (Linetype)",
  "Linetype Scale": "线型比例 (Linetype Scale)",
  "Lineweight": "线宽 (Lineweight)",
  "Start X": "起点 X",
  "Start Y": "起点 Y",
  "End X": "终点 X",
  "End Y": "终点 Y",
  "Length": "长度",
  "Center X": "中心 X",
  "Center Y": "中心 Y",
  "Radius": "半径",
  "Area": "面积",
  "Start Angle": "起始角度",
  "End Angle": "终止角度",
  "Vertices": "顶点数",
  "Closed": "是否闭合",
  "Content": "文字内容",
  "Height": "高度",
  "Pos X": "位置 X",
  "Pos Y": "位置 Y",
  "Rotation": "旋转角度",
  "Width": "宽度",
  "Block": "块名",
  "Scale": "缩放比例",
  "Pattern": "填充图案",
  "Style": "填充样式",
  "Loops": "边界环数",
  "Value": "测量值",
  "Text": "显示文字",
  "Font": "字体 (Font)",
  "StyleName": "文字样式",
};

interface PropertiesPanelProps {
  entities: AnyEntity[];
  layers?: any[];
  styles?: Record<string, DxfStyle>;
  offset?: { x: number, y: number };
}

const PropertiesPanel: React.FC<PropertiesPanelProps> = ({ entities, layers, styles = {}, offset }) => {
  
  const renderPropertyRow = (label: string, value: React.ReactNode) => {
    const translatedLabel = LABEL_TRANSLATIONS[label] || label;
    return (
      <tr key={label} className="property-row">
        <td className="property-label-cell">{translatedLabel}</td>
        <td className="property-value-cell">{value}</td>
      </tr>
    );
  };

  const formatHandle = (handle: string | undefined) => {
    if (!handle) return "N/A";
    try {
      return parseInt(handle, 16).toString();
    } catch (e) {
      return handle;
    }
  };

  const renderColorValue = (color: number | undefined) => {
    if (color === 256) return <span className="text-gray-500">随层 (ByLayer)</span>;
    if (color === 0) return <span className="text-gray-500">随块 (ByBlock)</span>;
    
    const hex = getAutoCadColor(color || 7);
    return (
      <div className="color-preview-container">
        <span className="text-gray-400 text-xs">({color})</span>
        <span className="color-hex">{hex}</span>
        <div 
          className="color-swatch" 
          style={{ backgroundColor: hex }}
        />
      </div>
    );
  };

  const renderLineweight = (lw: number | undefined) => {
    if (lw === undefined || lw === -1) return <span className="text-gray-500">随层 (ByLayer)</span>;
    if (lw === -2) return <span className="text-gray-500">随块 (ByBlock)</span>;
    if (lw === -3) return <span className="text-gray-500">默认 (Default)</span>;
    if (lw === 0) return "0.00 mm";
    return `${(lw / 100).toFixed(2)} mm`;
  };

  const formatCoord = (val: number, axis: 'x' | 'y') => {
    // No offset needed - using original coordinates
    return val.toFixed(3);
  };

  const renderEntityProperties = (ent: AnyEntity) => {
      const typeDisplay = ENTITY_TYPE_TRANSLATIONS[ent.type] || ent.type;
      
      const commonRows = [
          renderPropertyRow("Type", <span className="text-blue-600 font-bold">{typeDisplay}</span>),
          renderPropertyRow("Handle", formatHandle(ent.handle)),
          renderPropertyRow("Layer", ent.layer),
          renderPropertyRow("Color", renderColorValue(ent.color)),
          renderPropertyRow("Linetype", ent.lineType || 'ByLayer'),
          renderPropertyRow("Linetype Scale", (ent.lineTypeScale !== undefined ? ent.lineTypeScale : 1.0).toFixed(2)),
          renderPropertyRow("Lineweight", renderLineweight(ent.lineweight)),
      ];

      let specificRows: React.ReactNode[] = [];

      switch (ent.type) {
          case EntityType.LINE:
              specificRows = [
                  renderPropertyRow("Start X", formatCoord(ent.start.x, 'x')),
                  renderPropertyRow("Start Y", formatCoord(ent.start.y, 'y')),
                  renderPropertyRow("End X", formatCoord(ent.end.x, 'x')),
                  renderPropertyRow("End Y", formatCoord(ent.end.y, 'y')),
                  renderPropertyRow("Length", Math.sqrt(Math.pow(ent.end.x - ent.start.x, 2) + Math.pow(ent.end.y - ent.start.y, 2)).toFixed(4))
              ];
              break;
          case EntityType.CIRCLE:
              specificRows = [
                  renderPropertyRow("Center X", formatCoord(ent.center.x, 'x')),
                  renderPropertyRow("Center Y", formatCoord(ent.center.y, 'y')),
                  renderPropertyRow("Radius", ent.radius.toFixed(4)),
                  renderPropertyRow("Area", (Math.PI * ent.radius * ent.radius).toFixed(4))
              ];
              break;
          case EntityType.ARC:
              specificRows = [
                  renderPropertyRow("Center X", formatCoord(ent.center.x, 'x')),
                  renderPropertyRow("Center Y", formatCoord(ent.center.y, 'y')),
                  renderPropertyRow("Radius", ent.radius.toFixed(4)),
                  renderPropertyRow("Start Angle", `${ent.startAngle.toFixed(1)}°`),
                  renderPropertyRow("End Angle", `${ent.endAngle.toFixed(1)}°`),
              ];
              break;
          case EntityType.SOLID:
          case EntityType.THREEDFACE:
              specificRows = [
                  renderPropertyRow("Vertices", ent.points.length),
                  ...ent.points.map((p, i) => renderPropertyRow(`Vertex ${i+1}`, `${formatCoord(p.x, 'x')}, ${formatCoord(p.y, 'y')}`))
              ];
              break;
          case EntityType.LWPOLYLINE:
          case EntityType.POLYLINE:
              specificRows = [
                  renderPropertyRow("Closed", ent.closed ? "是 (Yes)" : "否 (No)"),
                  renderPropertyRow("Vertices", ent.points.length),
              ];
              break;
          case EntityType.TEXT:
          case EntityType.MTEXT:
          case EntityType.ATTRIB:
          case EntityType.ATTDEF: {
              const textEnt = ent;
              const styleName = textEnt.styleName || 'STANDARD';
              const style = styles[styleName] || styles[styleName.toUpperCase()];
              const fontFamily = getStyleFontFamily(styleName, styles);
              
              // Extract a friendly name from the font stack
              let friendlyFont = "Sans-Serif";
              if (fontFamily.includes("FangSong") || fontFamily.includes("仿宋")) friendlyFont = "仿宋 (FangSong)";
              else if (fontFamily.includes("SimSun") || fontFamily.includes("宋体")) friendlyFont = "宋体 (SimSun)";
              else if (fontFamily.includes("SimHei") || fontFamily.includes("黑体")) friendlyFont = "黑体 (SimHei)";
              else if (fontFamily.includes("SimKai") || fontFamily.includes("楷体")) friendlyFont = "楷体 (SimKai)";
              else if (fontFamily.includes("Microsoft YaHei")) friendlyFont = "微软雅黑 (YaHei)";
              else if (fontFamily.includes("Arial")) friendlyFont = "Arial";
              else if (fontFamily.includes("Times New Roman")) friendlyFont = "Times New Roman";

              specificRows = [
                  renderPropertyRow("Content", <span className="text-xs">{ent.value.substring(0, 50)}{ent.value.length > 50 && "..."}</span>),
                  renderPropertyRow("Height", ent.height.toFixed(4)),
                  renderPropertyRow("StyleName", styleName),
                  renderPropertyRow("Font", <div>
                      <div className="font-semibold">{friendlyFont}</div>
                      {style && <div className="text-[10px] text-gray-400">{style.fontFileName}{style.bigFontFileName ? ` | ${style.bigFontFileName}` : ''}</div>}
                  </div>),
                  renderPropertyRow("Pos X", formatCoord(ent.position.x, 'x')),
                  renderPropertyRow("Pos Y", formatCoord(ent.position.y, 'y')),
                  renderPropertyRow("Rotation", `${ent.rotation?.toFixed(1)}°`),
                  ent.type === EntityType.MTEXT && renderPropertyRow("Width", ent.width ? ent.width.toFixed(3) : "自动 (Auto)")
              ].filter(Boolean);
              break;
          }
          case EntityType.INSERT:
          case EntityType.ACAD_TABLE:
              specificRows = [
                  renderPropertyRow("Block", ent.blockName),
                  renderPropertyRow("Pos X", formatCoord(ent.position.x, 'x')),
                  renderPropertyRow("Pos Y", formatCoord(ent.position.y, 'y')),
                  ent.type === EntityType.INSERT && renderPropertyRow("Scale", `${ent.scale.x.toFixed(2)}, ${ent.scale.y.toFixed(2)}`),
                  ent.type === EntityType.INSERT && renderPropertyRow("Rotation", `${ent.rotation.toFixed(1)}°`),
              ].filter(Boolean);
              break;
           case EntityType.HATCH:
              specificRows = [
                  renderPropertyRow("Pattern", ent.patternName),
                  renderPropertyRow("Style", ent.solid ? "实体填充 (Solid)" : "图案填充 (Pattern)"),
                  renderPropertyRow("Loops", ent.loops.length),
              ];
              break;
           case EntityType.DIMENSION:
              specificRows = [
                  renderPropertyRow("Value", ent.measurement?.toFixed(4)),
                  renderPropertyRow("Text", ent.text || "自动 (Auto)"),
              ];
              break;
      }

      return (
          <table className="properties-table">
              <tbody>
                  {commonRows}
                  {specificRows}
              </tbody>
          </table>
      );
  };

  return (
      <div className="properties-panel">
        <div className="properties-header">
           属性面板
        </div>
        <div className="properties-content">
          {entities.length === 1 ? (
             renderEntityProperties(entities[0])
          ) : entities.length > 1 ? (
             <div className="empty-state">
               <div style={{ fontWeight: 500, color: '#6b7280' }}>已选择 {entities.length} 个对象</div>
               <div style={{ fontSize: '12px', marginTop: '4px' }}>选择单个对象以查看详细属性</div>
             </div>
          ) : (
             <div className="empty-state">
               未选择对象
             </div>
          )}
        </div>
      </div>
  );
};

export default PropertiesPanel;