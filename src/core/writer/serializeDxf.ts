import { DxfData, AnyEntity, EntityType } from '../../types';

/**
 * 辅助函数：将组码和值格式化为 DXF 双行文本格式
 */
function dxfGroup(code: number, value: string | number): string {
  return `${code.toString().padStart(3, ' ')}\n${value}\n`;
}

/**
 * 获取图元的基础组码（类型、图层、颜色等）
 */
function getEntityCommonGroups(ent: AnyEntity): string {
  let s = dxfGroup(0, ent.type);
  if (ent.handle) {
    s += dxfGroup(5, ent.handle);
  }
  s += dxfGroup(8, ent.layer || '0');
  if (ent.color !== undefined) {
    s += dxfGroup(62, ent.color);
  }
  if (ent.trueColor !== undefined) {
    s += dxfGroup(420, ent.trueColor);
  }
  if (ent.lineType) {
    s += dxfGroup(6, ent.lineType);
  }
  if (ent.lineTypeScale !== undefined) {
    s += dxfGroup(48, ent.lineTypeScale);
  }
  if (ent.lineweight !== undefined) {
    s += dxfGroup(370, ent.lineweight);
  }
  return s;
}

/**
 * 序列化单个 DXF 图元实体
 */
export const serializeEntity = (ent: AnyEntity): string => {
  let s = getEntityCommonGroups(ent);

  switch (ent.type) {
    case EntityType.LINE:
      s += dxfGroup(10, ent.start.x);
      s += dxfGroup(20, ent.start.y);
      s += dxfGroup(30, 0.0);
      s += dxfGroup(11, ent.end.x);
      s += dxfGroup(21, ent.end.y);
      s += dxfGroup(31, 0.0);
      break;
    case EntityType.CIRCLE:
      s += dxfGroup(10, ent.center.x);
      s += dxfGroup(20, ent.center.y);
      s += dxfGroup(30, 0.0);
      s += dxfGroup(40, ent.radius);
      break;
    case EntityType.ARC:
      s += dxfGroup(10, ent.center.x);
      s += dxfGroup(20, ent.center.y);
      s += dxfGroup(30, 0.0);
      s += dxfGroup(40, ent.radius);
      s += dxfGroup(50, ent.startAngle || 0.0);
      s += dxfGroup(51, ent.endAngle || 0.0);
      break;
    case EntityType.LWPOLYLINE:
      s += dxfGroup(90, ent.points.length);
      s += dxfGroup(70, ent.closed ? 1 : 0);
      ent.points.forEach((pt, idx) => {
        s += dxfGroup(10, pt.x);
        s += dxfGroup(20, pt.y);
        const bulge = ent.bulges?.[idx] || 0;
        if (bulge !== 0) {
          s += dxfGroup(42, bulge);
        }
      });
      break;
    case EntityType.TEXT:
    case EntityType.MTEXT:
    case EntityType.ATTRIB:
    case EntityType.ATTDEF:
      s += dxfGroup(10, ent.position.x);
      s += dxfGroup(20, ent.position.y);
      s += dxfGroup(30, 0.0);
      s += dxfGroup(40, ent.height);
      s += dxfGroup(1, ent.value || '');
      if (ent.rotation) {
        s += dxfGroup(50, ent.rotation);
      }
      if (ent.styleName) {
        s += dxfGroup(7, ent.styleName);
      }
      break;
    case EntityType.POINT:
      s += dxfGroup(10, ent.position.x);
      s += dxfGroup(20, ent.position.y);
      s += dxfGroup(30, 0.0);
      break;
    case EntityType.ELLIPSE:
      s += dxfGroup(10, ent.center.x);
      s += dxfGroup(20, ent.center.y);
      s += dxfGroup(30, 0.0);
      s += dxfGroup(11, ent.majorAxis.x);
      s += dxfGroup(21, ent.majorAxis.y);
      s += dxfGroup(31, 0.0);
      s += dxfGroup(40, ent.ratio);
      s += dxfGroup(41, ent.startParam || 0.0);
      s += dxfGroup(42, ent.endParam || (Math.PI * 2));
      break;
    case EntityType.INSERT:
      s += dxfGroup(2, ent.blockName);
      s += dxfGroup(10, ent.position.x);
      s += dxfGroup(20, ent.position.y);
      s += dxfGroup(30, 0.0);
      if (ent.scale) {
        s += dxfGroup(41, ent.scale.x);
        s += dxfGroup(42, ent.scale.y);
        s += dxfGroup(43, ent.scale.z);
      }
      if (ent.rotation) {
        s += dxfGroup(50, ent.rotation);
      }
      break;
    case EntityType.IMAGE:
      s += dxfGroup(10, ent.position.x);
      s += dxfGroup(20, ent.position.y);
      s += dxfGroup(30, ent.position.z || 0.0);
      if (ent.uVector) {
        s += dxfGroup(11, ent.uVector.x);
        s += dxfGroup(21, ent.uVector.y);
        s += dxfGroup(31, ent.uVector.z);
      }
      if (ent.vVector) {
        s += dxfGroup(12, ent.vVector.x);
        s += dxfGroup(22, ent.vVector.y);
        s += dxfGroup(32, ent.vVector.z);
      }
      s += dxfGroup(13, ent.imageSize.x);
      s += dxfGroup(23, ent.imageSize.y);
      if (ent.imageRef) {
        s += dxfGroup(340, ent.imageRef);
      }
      break;
    case EntityType.WIPEOUT:
      s += dxfGroup(70, ent.closed ? 1 : 0);
      ent.points.forEach(pt => {
        s += dxfGroup(10, pt.x);
        s += dxfGroup(20, pt.y);
      });
      break;
    case EntityType.HELIX:
      s += dxfGroup(10, ent.startPoint.x);
      s += dxfGroup(20, ent.startPoint.y);
      s += dxfGroup(30, ent.startPoint.z);
      s += dxfGroup(11, ent.axisVector.x);
      s += dxfGroup(21, ent.axisVector.y);
      s += dxfGroup(31, ent.axisVector.z);
      s += dxfGroup(40, ent.radius);
      s += dxfGroup(41, ent.turns);
      s += dxfGroup(42, ent.pitch);
      if (ent.handedness !== undefined) {
        s += dxfGroup(71, ent.handedness);
      }
      break;
    case EntityType.TOLERANCE:
      s += dxfGroup(1, ent.text || '');
      s += dxfGroup(10, ent.position.x);
      s += dxfGroup(20, ent.position.y);
      s += dxfGroup(30, ent.position.z || 0.0);
      if (ent.direction) {
        s += dxfGroup(11, ent.direction.x);
        s += dxfGroup(21, ent.direction.y);
        s += dxfGroup(31, ent.direction.z);
      }
      break;
    default:
      // 其他实体导出通用基础信息，作为占位以防止 AutoCAD 抛错
      break;
  }
  return s;
};

/**
 * 将 DxfData 序列化为符合 AutoCAD 格式的 DXF 文本字符串
 */
export const serializeDxf = (data: DxfData): string => {
  let s = '';

  // 1. HEADER SECTION
  s += dxfGroup(0, 'SECTION');
  s += dxfGroup(2, 'HEADER');
  if (data.header) {
    if (data.header.extMin) {
      s += dxfGroup(9, '$EXTMIN');
      s += dxfGroup(10, data.header.extMin.x);
      s += dxfGroup(20, data.header.extMin.y);
      s += dxfGroup(30, 0.0);
    }
    if (data.header.extMax) {
      s += dxfGroup(9, '$EXTMAX');
      s += dxfGroup(10, data.header.extMax.x);
      s += dxfGroup(20, data.header.extMax.y);
      s += dxfGroup(30, 0.0);
    }
    if (data.header.insUnits !== undefined) {
      s += dxfGroup(9, '$INSUNITS');
      s += dxfGroup(70, data.header.insUnits);
    }
    if (data.header.ltScale !== undefined) {
      s += dxfGroup(9, '$LTSCALE');
      s += dxfGroup(40, data.header.ltScale);
    }
  }
  s += dxfGroup(0, 'ENDSEC');

  // 2. TABLES SECTION
  s += dxfGroup(0, 'SECTION');
  s += dxfGroup(2, 'TABLES');

  // 2.1 LTYPE TABLE
  const ltypes = Object.values(data.lineTypes || {});
  s += dxfGroup(0, 'TABLE');
  s += dxfGroup(2, 'LTYPE');
  s += dxfGroup(70, ltypes.length);
  ltypes.forEach(lt => {
    s += dxfGroup(0, 'LTYPE');
    s += dxfGroup(2, lt.name);
    s += dxfGroup(70, 64);
    s += dxfGroup(3, lt.description || '');
    s += dxfGroup(72, 65);
    s += dxfGroup(73, lt.pattern.length);
    s += dxfGroup(40, lt.totalLength);
    lt.pattern.forEach(p => {
      s += dxfGroup(49, p);
    });
  });
  s += dxfGroup(0, 'ENDTAB');

  // 2.2 LAYER TABLE
  const layers = Object.values(data.layers || {});
  s += dxfGroup(0, 'TABLE');
  s += dxfGroup(2, 'LAYER');
  s += dxfGroup(70, layers.length);
  layers.forEach(layer => {
    s += dxfGroup(0, 'LAYER');
    s += dxfGroup(2, layer.name);
    s += dxfGroup(70, 0);
    s += dxfGroup(62, layer.color);
    if (layer.trueColor !== undefined) {
      s += dxfGroup(420, layer.trueColor);
    }
  });
  s += dxfGroup(0, 'ENDTAB');

  // 2.3 STYLE TABLE
  const styles = Object.values(data.styles || {});
  s += dxfGroup(0, 'TABLE');
  s += dxfGroup(2, 'STYLE');
  s += dxfGroup(70, styles.length);
  styles.forEach(style => {
    s += dxfGroup(0, 'STYLE');
    s += dxfGroup(2, style.name);
    s += dxfGroup(70, 0);
    s += dxfGroup(40, style.height || 0.0);
    s += dxfGroup(41, style.widthFactor || 1.0);
    s += dxfGroup(3, style.fontFileName);
    if (style.bigFontFileName) {
      s += dxfGroup(4, style.bigFontFileName);
    }
  });
  s += dxfGroup(0, 'ENDTAB');

  s += dxfGroup(0, 'ENDSEC');

  // 3. BLOCKS SECTION
  s += dxfGroup(0, 'SECTION');
  s += dxfGroup(2, 'BLOCKS');
  Object.values(data.blocks || {}).forEach(block => {
    s += dxfGroup(0, 'BLOCK');
    s += dxfGroup(8, '0');
    s += dxfGroup(2, block.name);
    s += dxfGroup(70, 0);
    s += dxfGroup(10, block.basePoint.x);
    s += dxfGroup(20, block.basePoint.y);
    s += dxfGroup(30, 0.0);
    s += dxfGroup(3, block.name);
    if (block.handle) {
      s += dxfGroup(1, block.handle);
    }
    block.entities.forEach(ent => {
      s += serializeEntity(ent);
    });
    s += dxfGroup(0, 'ENDBLK');
    s += dxfGroup(8, '0');
  });
  s += dxfGroup(0, 'ENDSEC');

  // 4. ENTITIES SECTION
  s += dxfGroup(0, 'SECTION');
  s += dxfGroup(2, 'ENTITIES');
  data.entities.forEach(ent => {
    s += serializeEntity(ent);
  });
  s += dxfGroup(0, 'ENDSEC');

  // 5. EOF
  s += dxfGroup(0, 'EOF');

  return s;
};
