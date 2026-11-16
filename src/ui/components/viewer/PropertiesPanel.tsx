import React from 'react';
import { AnyEntity, EntityType, DxfStyle } from '@/types';
import { getAutoCadColor } from '@/utils/colorUtils';
import { Language, ENTITY_TYPE_NAMES, t as translate } from '@/ui/i18n';
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
  const entNames = ENTITY_TYPE_NAMES[lang];
  
  /**
   * 渲染属性行
   * 参数 label：属性名称，将尝试自动翻译。
   * 参数 value：属性值。
   */
  const renderPropertyRow = (label: string, value: React.ReactNode, opts?: { mono?: boolean; strong?: boolean }) => {
    // 尝试查找标签的翻译（将标签转换为小驼峰命名或直接匹配）
    const key = label.charAt(0).toLowerCase() + label.slice(1).replace(/ /g, '');
    const translatedLabel = translate(lang, key) !== key ? translate(lang, key) : label;
    const cls = [
      'property-value-cell',
      opts?.mono ? 'property-value-mono' : '',
      opts?.strong ? 'property-value-strong' : '',
    ].filter(Boolean).join(' ');
    return (
      <tr key={label} className="property-row">
        {/* P9：标签列可能被省略号截断，必须带 title。 */}
        <td className="property-label-cell" title={translatedLabel}>{translatedLabel}</td>
        <td className={cls}>{value}</td>
      </tr>
    );
  };

  /** 分区标题（基本信息 / 几何 / 样式 / 块属性 …） */
  const renderSectionHeader = (titleKey: string, fallback: string) => {
    const key = titleKey.charAt(0).toLowerCase() + titleKey.slice(1).replace(/ /g, '');
    const translated = translate(lang, key) !== key ? translate(lang, key) : fallback;
    return (
      <tr key={`sec-${fallback}`} className="property-section-row">
        <td colSpan={2} className="property-section-cell">
          <span className="property-section-title">{translated}</span>
        </td>
      </tr>
    );
  };

  /**
   * 格式化实体句柄 (Handle)
   * 将十六进制字符串转换为十进制显示
   */
  const formatHandle = (handle: string | undefined) => {
    if (!handle) return translate(lang, 'na');
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
    if (color === CAD_BY_LAYER_COLOR) return <span className="property-muted">{translate(lang, 'byLayer')}</span>;
    if (color === CAD_BY_BLOCK_COLOR) return <span className="property-muted">{translate(lang, 'byBlock')}</span>;
    
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
    if (lw === undefined || lw === -1) return <span className="property-muted">{translate(lang, 'byLayer')}</span>;
    if (lw === -2) return <span className="property-muted">{translate(lang, 'byBlock')}</span>;
    if (lw === -3) return <span className="property-muted">{translate(lang, 'default')}</span>;
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
   * 渲染块引用的属性列表（ATTRIB：标记 → 值）。
   * 采用与主表一致的「标签列 + 值列」两栏结构，滚动区域展示全部属性。
   */
  const renderAttributeList = (attributes: AnyEntity[]) => {
    const rows = attributes
      .map((attr, index) => {
        const tag = (attr as { tag?: string }).tag || `#${index + 1}`;
        const value = String((attr as { value?: string }).value || '').trim();
        return { tag, value, key: `${tag}-${index}` };
      })
      .filter(row => row.value.length > 0);
    if (rows.length === 0) return <span className="property-muted">{translate(lang, 'na')}</span>;
    return (
      <div className="attribute-list">
        {rows.map(row => (
          <div key={row.key} className="attribute-row">
            <span className="attribute-tag" title={row.tag}>{row.tag}</span>
            <span className="attribute-value">{row.value}</span>
          </div>
        ))}
      </div>
    );
  };

  /**
   * 渲染实体特定的属性
   */
  const renderEntityProperties = (ent: AnyEntity) => {
      const typeDisplay = entNames[ent.type] || ent.type;
      const commonRows = [
          renderSectionHeader('general', '基本信息'),
          renderPropertyRow("Type", <span className="property-type-value">{typeDisplay}</span>, { strong: true }),
          renderPropertyRow("Handle", <span className="property-value-mono">{formatHandle(ent.handle)}</span>, { mono: true }),
          renderPropertyRow("Layer", ent.layer),
          renderPropertyRow("Current Space", ent.layoutName || (ent.inPaperSpace ? translate(lang, 'paperSpace') : translate(lang, 'modelSpace'))),
      ];

      // 样式分区：颜色 / 线型 / 线宽（按类型插入在几何分区之后）。
      const styleRows = [
          renderSectionHeader('appearance', '样式'),
          renderPropertyRow("Color", renderColorValue(ent.color)),
          renderPropertyRow("Linetype", ent.lineType || translate(lang, 'byLayer')),
          renderPropertyRow("Linetype Scale", <span className="property-value-mono">{(ent.lineTypeScale !== undefined ? ent.lineTypeScale : 1.0).toFixed(2)}</span>, { mono: true }),
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
                  ...ent.points.map((p, i) => renderPropertyRow(translate(lang, 'vertex', { index: i + 1 }), `${formatCoord(p.x, 'x')}, ${formatCoord(p.y, 'y')}`))
              ];
              break;
          case EntityType.LWPOLYLINE:
          case EntityType.POLYLINE:
              specificRows = [
                  renderPropertyRow("Closed", ent.closed ? translate(lang, 'yes') : translate(lang, 'no')),
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
                  renderPropertyRow("Content", <span title={ent.value.substring(0, 50)}>{ent.value.substring(0, 50)}{ent.value.length > 50 && "..."}</span>),
                  renderPropertyRow("Height", ent.height.toFixed(4)),
                  renderPropertyRow("StyleName", styleName),
                  renderPropertyRow("Font", <span className="property-value-strong">{friendlyFont}</span>),
                  renderPropertyRow("Pos X", formatCoord(ent.position.x, 'x')),
                  renderPropertyRow("Pos Y", formatCoord(ent.position.y, 'y')),
                  renderPropertyRow("Rotation", `${ent.rotation?.toFixed(1)}°`),
                  ent.type === EntityType.MTEXT && renderPropertyRow("Width", ent.width ? ent.width.toFixed(3) : translate(lang, 'auto'))
              ].filter(Boolean);
              break;
          }
          case EntityType.INSERT:
          case EntityType.ACAD_TABLE:
              specificRows = [
                  renderSectionHeader('blockReference', '块参照'),
                  renderPropertyRow("Block", <span className="property-value-mono">{ent.blockName}</span>, { mono: true }),
                  renderPropertyRow("Pos X", <span className="property-value-mono">{formatCoord(ent.position.x, 'x')}</span>, { mono: true }),
                  renderPropertyRow("Pos Y", <span className="property-value-mono">{formatCoord(ent.position.y, 'y')}</span>, { mono: true }),
                  ent.type === EntityType.INSERT && renderPropertyRow("Scale", <span className="property-value-mono">{`${ent.scale.x.toFixed(2)}, ${ent.scale.y.toFixed(2)}`}</span>, { mono: true }),
                  ent.type === EntityType.INSERT && renderPropertyRow("Rotation", `${ent.rotation.toFixed(1)}°`),
              ].filter(Boolean) as React.ReactNode[];

              // 块引用属性（ATTRIB）：标记 → 值
              if (ent.type === EntityType.INSERT && ent.attributes && ent.attributes.length > 0) {
                  specificRows.push(
                      <tr key="attribs-header" className="property-row property-section-row">
                          <td colSpan={2} className="property-section-cell">
                              {translate(lang, 'attributes')}
                          </td>
                      </tr>,
                  );
                  specificRows.push(
                      <tr key="attribs-body" className="property-row">
                          <td colSpan={2} className="property-value-cell">
                              {renderAttributeList(ent.attributes)}
                          </td>
                      </tr>,
                  );
              }
              
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
                                   {translate(lang, 'cellContents')}
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
                           const totalText = translate(lang, 'totalCells', { count: table.cells.length });
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
                  renderPropertyRow("Style", ent.solid ? translate(lang, 'solidFill') : translate(lang, 'patternFill')),
                  renderPropertyRow("Loops", ent.loops.length),
              ];
              break;
           case EntityType.DIMENSION:
              specificRows = [
                  renderPropertyRow("Value", ent.measurement?.toFixed(4)),
                  renderPropertyRow("Text", ent.text || translate(lang, 'auto')),
              ];
              break;
           case EntityType.VIEWPORT:
              specificRows = [
                  renderPropertyRow("Center X", formatCoord(ent.center.x, 'x')),
                  renderPropertyRow("Center Y", formatCoord(ent.center.y, 'y')),
                  renderPropertyRow("Width", ent.width.toFixed(4)),
                  renderPropertyRow("Height", ent.height.toFixed(4)),
                  renderPropertyRow("Viewport ID", ent.viewportId ?? translate(lang, 'na')),
                  renderPropertyRow("Status", ent.status ?? translate(lang, 'na')),
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
                  renderPropertyRow("Image Ref", ent.imageRef || ent.imagePath || translate(lang, 'na')),
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
                  renderPropertyRow("Content", ent.text || translate(lang, 'na')),
                  renderPropertyRow("Pos X", formatCoord(ent.position.x, 'x')), 
                  renderPropertyRow("Pos Y", formatCoord(ent.position.y, 'y')),
              ];
              break;
      }

      return (
          <div className="property-group">
            <table className="properties-table">
                <tbody>
                    {commonRows}
                    {specificRows}
                    {styleRows}
                </tbody>
            </table>
          </div>
      );
  };

  return (
      <div className={`properties-panel ${className || ''}`}>
        <div className="properties-header">
          <span className="layer-panel-title" title={translate(lang, 'propertiesTitle')}>
            {translate(lang, 'propertiesTitle')}
          </span>
          {entities.length > 0 && (
            <span className="layer-panel-header-count" title={translate(lang, 'selectedCount', { count: entities.length })}>
              {entities.length}
            </span>
          )}
        </div>
        <div className="properties-content">
          {entities.length === 0 ? (
             <div className="empty-state property-empty-state">
               {translate(lang, 'noSelection')}
             </div>
          ) : entities.length > 1 ? (
             <div className="empty-state property-empty-state">
               <div className="property-empty-title">
                 {translate(lang, 'selectedCount', { count: entities.length })}
               </div>
                <div className="property-type-summary">
                  {Object.entries(
                    entities.reduce((acc, e) => {
                      const name = entNames[e.type] || e.type;
                      acc[name] = (acc[name] || 0) + 1;
                      return acc;
                    }, {} as Record<string, number>)
                  ).sort((a, b) => b[1] - a[1]).map(([typeName, count]) => (
                    <div key={typeName} className="property-type-row">
                      <span className="property-type-name" title={typeName}>{typeName}</span>
                      <span className="property-type-count">× {count}</span>
                    </div>
                  ))}
                </div>
               <div className="property-empty-subtitle">
                 {translate(lang, 'selectSingle')}
               </div>
             </div>
          ) : (
             renderEntityProperties(entities[0])
          )}
        </div>
      </div>
  );
};

export default React.memo(PropertiesPanel);


