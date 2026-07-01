import React from 'react';
import { AnyEntity, EntityType, DxfStyle } from '@/types';
import { getAutoCadColor } from '@/utils/colorUtils';
import { Language, UI_TRANSLATIONS, ENTITY_TYPE_NAMES } from '@/config/i18n';
import { CAD_BY_BLOCK_COLOR, CAD_BY_LAYER_COLOR, CAD_DEFAULT_LAYER_COLOR, CAD_DEFAULT_TEXT_STYLE } from '@/config/cadConstants';

/**
 * 属性面板组件
 * 显示所选 DXF 实体的详细属性信息
 */
interface PropertiesPanelProps {
  entities: AnyEntity[]; // 所选实体列表。
  styles?: Record<string, DxfStyle>; // 样式表。
  offset?: { x: number, y: number }; // 世界坐标偏移（用于显示原始坐标）。
  lang: Language; // 当前语言。
  className?: string;
}

const PropertiesPanel: React.FC<PropertiesPanelProps> = ({ entities, styles = {}, offset, lang, className }) => {
  const t = UI_TRANSLATIONS[lang];
  const entNames = ENTITY_TYPE_NAMES[lang];
  
  /**
   * 渲染属性行
   * 参数 label：属性名称，将尝试自动翻译。
   * 参数 value：属性值。
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
    } catch {
      return handle;
    }
  };

  /**
   * 渲染 CAD 颜色值。
   * 支持随层、随块以及索引颜色的十六进制预览。
   */
  const renderColorValue = (color: number | undefined) => {
    if (color === CAD_BY_LAYER_COLOR) return <span className="property-muted">随层 (ByLayer)</span>;
    if (color === CAD_BY_BLOCK_COLOR) return <span className="property-muted">随块 (ByBlock)</span>;
    
    const hex = getAutoCadColor(color || CAD_DEFAULT_LAYER_COLOR);
    return (
      <div className="color-preview-container">
        <span className="property-color-index">({color})</span>
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
    if (lw === undefined || lw === -1) return <span className="property-muted">随层 (ByLayer)</span>;
    if (lw === -2) return <span className="property-muted">随块 (ByBlock)</span>;
    if (lw === -3) return <span className="property-muted">默认 (Default)</span>;
    if (lw === 0) return "0.00 mm";
    return `${(lw / 100).toFixed(2)} mm`;
  };

  /**
   * 格式化坐标
   * 考虑世界坐标偏移，以还原到 CAD 中的原始坐标。
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
          renderPropertyRow("Type", <span className="property-type-value">{typeDisplay}</span>),
          renderPropertyRow("Handle", formatHandle(ent.handle)),
          renderPropertyRow("Layer", ent.layer),
          renderPropertyRow("Current Space", ent.layoutName || (ent.inPaperSpace ? 'Layout' : 'Model')),
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
              const styleName = textEnt.styleName || CAD_DEFAULT_TEXT_STYLE;
              const style = styles[styleName] || styles[styleName.toUpperCase()];
              const primaryFontFile = (style?.fontFileName || '').trim();
              const bigFontFile = (style?.bigFontFileName || '').trim();
              const friendlyFont = primaryFontFile || bigFontFile || style?.name || styleName;

              specificRows = [
                  renderPropertyRow("Content", <span className="text-xs">{ent.value.substring(0, 50)}{ent.value.length > 50 && "..."}</span>),
                  renderPropertyRow("Height", ent.height.toFixed(4)),
                  renderPropertyRow("StyleName", styleName),
                  renderPropertyRow("Font", <span className="font-semibold">{friendlyFont}</span>),
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
                           <tr key="cells-header" className="property-row property-section-row">
                               <td colSpan={2} className="property-section-cell">
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
           case EntityType.VIEWPORT:
              specificRows = [
                  renderPropertyRow("Center X", formatCoord(ent.center.x, 'x')),
                  renderPropertyRow("Center Y", formatCoord(ent.center.y, 'y')),
                  renderPropertyRow("Width", ent.width.toFixed(4)),
                  renderPropertyRow("Height", ent.height.toFixed(4)),
                  renderPropertyRow("Viewport ID", ent.viewportId ?? "N/A"),
                  renderPropertyRow("Status", ent.status ?? "N/A"),
              ];
              break;
           case EntityType.SHAPE:
              specificRows = [
                  renderPropertyRow("Name", ent.name),
                  renderPropertyRow("Size", ent.size.toFixed(4)),
                  renderPropertyRow("Pos X", formatCoord(ent.position.x, 'x')),
                  renderPropertyRow("Pos Y", formatCoord(ent.position.y, 'y')),
                  renderPropertyRow("Rotation", `${(ent.rotation || 0).toFixed(1)}°`),
                  renderPropertyRow("X Scale", (ent.xScale || 1).toFixed(3)),
              ];
              break;
           case EntityType.IMAGE:
              specificRows = [
                  renderPropertyRow("Pos X", formatCoord(ent.position.x, 'x')),
                  renderPropertyRow("Pos Y", formatCoord(ent.position.y, 'y')),
                  renderPropertyRow("Image Width", ent.imageSize.x.toFixed(3)),
                  renderPropertyRow("Image Height", ent.imageSize.y.toFixed(3)),
                  renderPropertyRow("Image Ref", ent.imageRef || ent.imagePath || "N/A"),
              ];
              break;
           case EntityType.WIPEOUT:
              specificRows = [
                  renderPropertyRow("Vertices", ent.points.length),
                  ...ent.points.slice(0, 8).map((point, i) => renderPropertyRow(`Vertex ${i + 1}`, `${formatCoord(point.x, 'x')}, ${formatCoord(point.y, 'y')}`)),
              ];
              break;
           case EntityType.TOLERANCE:
              specificRows = [
                  renderPropertyRow("Content", ent.text || "N/A"),
                  renderPropertyRow("Pos X", formatCoord(ent.position.x, 'x')), 
                  renderPropertyRow("Pos Y", formatCoord(ent.position.y, 'y')),
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
      <div className={`properties-panel ${className || ''}`}>
        <div className="properties-header">
          {t.propertiesTitle || "属性面板"}
        </div>
        <div className="properties-content">
          {entities.length === 0 ? (
             <div className="empty-state property-empty-state">
               {t.noSelection || "未选择对象"}
             </div>
          ) : entities.length > 1 ? (
             <div className="empty-state property-empty-state">
               <div className="property-empty-title">
                 {t.selectedCount ? t.selectedCount.replace('{count}', entities.length.toString()) : `已选择 ${entities.length} 个对象`}
               </div>
               <div className="property-empty-subtitle">
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
