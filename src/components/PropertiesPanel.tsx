import React from 'react';
import { AnyEntity, EntityType, DxfStyle } from '../types';
import { getAutoCadColor } from '../utils/colorUtils';
import { Language, UI_TRANSLATIONS, ENTITY_TYPE_NAMES } from '../constants/i18n';
import { getStyleFontFamily } from '../services/fontService';

/**
 * 属性面板组件
 * 显示所选 DXF 实体的详细属性信息
 */
interface PropertiesPanelProps {
  entities: AnyEntity[]; // 所选实体列表
  layers?: any[]; // 图层列表
  styles?: Record<string, DxfStyle>; // 样式表
  offset?: { x: number, y: number }; // 世界坐标偏移（用于显示原始坐标）
  theme: 'black' | 'white' | 'gray'; // 画布主题（用于颜色转换）
  lang: Language; // 当前语言
}

const PropertiesPanel: React.FC<PropertiesPanelProps> = ({ entities, layers, styles = {}, offset, theme, lang }) => {
  const t = UI_TRANSLATIONS[lang];
  const entNames = ENTITY_TYPE_NAMES[lang];
  
  /**
   * 渲染属性行
   * @param label 属性名称（英文，将尝试自动翻译）
   * @param value 属性值
   */
  const renderPropertyRow = (label: string, value: React.ReactNode) => {
    // 尝试查找标签的翻译（将标签转换为小驼峰命名或直接匹配）
    const key = label.charAt(0).toLowerCase() + label.slice(1).replace(/ /g, '');
    const translatedLabel = t[key] || t[label] || label;
    return (
      <tr key={label} className="property-row">
        <td className="property-label-cell">{translatedLabel}</td>
        <td className="property-value-cell">{value}</td>
      </tr>
    );
  };

  /**
   * 格式化实体句柄 (Handle)
   * 将十六进制字符串转换为十进制显示
   */
  const formatHandle = (handle: string | undefined) => {
    if (!handle) return "N/A";
    try {
      return parseInt(handle, 16).toString();
    } catch (e) {
      return handle;
    }
  };

  /**
   * 渲染 AutoCAD 颜色值
   * 支持随层 (ByLayer)、随块 (ByBlock) 以及索引颜色的 HEX 预览
   */
  const renderColorValue = (color: number | undefined) => {
    if (color === 256) return <span style={{ color: 'var(--text-secondary)' }}>随层 (ByLayer)</span>;
    if (color === 0) return <span style={{ color: 'var(--text-secondary)' }}>随块 (ByBlock)</span>;
    
    const hex = getAutoCadColor(color || 7, theme);
    return (
      <div className="color-preview-container">
        <span style={{ color: 'var(--text-secondary)', fontSize: '10px' }}>({color})</span>
        <span className="color-hex">{hex}</span>
        <div 
          className="color-swatch" 
          style={{ backgroundColor: hex }}
        />
      </div>
    );
  };

  /**
   * 渲染线宽
   */
  const renderLineweight = (lw: number | undefined) => {
    if (lw === undefined || lw === -1) return <span style={{ color: 'var(--text-secondary)' }}>随层 (ByLayer)</span>;
    if (lw === -2) return <span style={{ color: 'var(--text-secondary)' }}>随块 (ByBlock)</span>;
    if (lw === -3) return <span style={{ color: 'var(--text-secondary)' }}>默认 (Default)</span>;
    if (lw === 0) return "0.00 mm";
    return `${(lw / 100).toFixed(2)} mm`;
  };

  /**
   * 格式化坐标
   * 考虑 worldOffset 以还原到 CAD 中的原始坐标
   */
  const formatCoord = (val: number, axis: 'x' | 'y') => {
    const originalVal = val + (offset ? (axis === 'x' ? offset.x : offset.y) : 0);
    return originalVal.toFixed(3);
  };

  /**
   * 渲染实体特定的属性
   */
  const renderEntityProperties = (ent: AnyEntity) => {
      const typeDisplay = entNames[ent.type] || ent.type;
      
      const commonRows = [
          renderPropertyRow("Type", <span style={{ color: 'var(--accent-blue)', fontWeight: 'bold' }}>{typeDisplay}</span>),
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
              
              // 从字体栈中提取易读的名称
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
              ];
              
              if (ent.type === EntityType.ACAD_TABLE) {
                   const table = ent as any;
                   specificRows.push(renderPropertyRow("Rows", table.rowCount || (table.rowHeights ? table.rowHeights.length : 1)));
                   specificRows.push(renderPropertyRow("Columns", table.columnCount || (table.colWidths ? table.colWidths.length : 1)));
                   specificRows.push(renderPropertyRow("Row Spacing", (table.rowSpacing || 0).toFixed(2)));
                   specificRows.push(renderPropertyRow("Col Spacing", (table.columnSpacing || 0).toFixed(2)));
                   specificRows.push(renderPropertyRow("Rotation", `${(table.rotation || 0).toFixed(1)}°`));
                   
                   // 显示单元格内容摘要
                   if (table.cells && table.cells.length > 0) {
                       specificRows.push(
                           <tr key="cells-header" className="property-row" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                               <td colSpan={2} style={{ padding: '4px 8px', fontSize: '11px', fontWeight: 'bold' }}>
                                   {t.cellContents || (lang === 'zh' ? '单元格内容' : 'Cell Contents')}
                               </td>
                           </tr>
                       );
                       table.cells.forEach((cell: string, idx: number) => {
                           const r = Math.floor(idx / (table.columnCount || 1));
                           const c = idx % (table.columnCount || 1);
                           // 仅显示前 10 个非空单元格以避免面板过长
                           if (idx < 10 && cell && cell.trim()) {
                               specificRows.push(
                                   renderPropertyRow(`R${r+1}:C${c+1}`, cell)
                               );
                           }
                       });
                       if (table.cells.length > 10) {
                           const totalText = t.totalCells ? t.totalCells.replace('{count}', table.cells.length.toString()) : `Total ${table.cells.length} cells`;
                           specificRows.push(
                               renderPropertyRow("...", totalText)
                           );
                       }
                   }
              }
              specificRows = specificRows.filter(Boolean);
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
          {t.propertiesTitle || "属性面板"}
        </div>
        <div className="properties-content">
          {entities.length === 0 ? (
             <div className="empty-state" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
               {t.noSelection || "未选择对象"}
             </div>
          ) : entities.length > 1 ? (
             <div className="empty-state" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
               <div style={{ fontWeight: 500, color: '#6b7280' }}>
                 {t.selectedCount ? t.selectedCount.replace('{count}', entities.length.toString()) : `已选择 ${entities.length} 个对象`}
               </div>
               <div style={{ fontSize: '12px', marginTop: '4px', color: '#999' }}>
                 {t.selectSingle || "选择单个对象以查看详细属性"}
               </div>
             </div>
          ) : (
             renderEntityProperties(entities[0])
          )}
        </div>
      </div>
  );
};

export default PropertiesPanel;