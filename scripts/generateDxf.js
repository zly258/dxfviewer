import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const targetDir = path.join(__dirname, '../public');

if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

// ----------------------------------------------------
// 1. JS 版 DXF 序列化 Writer (保持与 src/core/writer 算法一致)
// ----------------------------------------------------

const EntityType = {
  LINE: 'LINE',
  CIRCLE: 'CIRCLE',
  ARC: 'ARC',
  LWPOLYLINE: 'LWPOLYLINE',
  TEXT: 'TEXT',
  POINT: 'POINT',
  MTEXT: 'MTEXT',
  ELLIPSE: 'ELLIPSE',
  SPLINE: 'SPLINE',
  INSERT: 'INSERT',
  SOLID: 'SOLID',
  POLYLINE: 'POLYLINE',
  DIMENSION: 'DIMENSION',
  HATCH: 'HATCH',
  ATTRIB: 'ATTRIB',
  ATTDEF: 'ATTDEF',
  REGION: 'REGION',
  LEADER: 'LEADER',
  MLEADER: 'MLEADER',
  ACAD_TABLE: 'ACAD_TABLE',
  THREEDFACE: '3DFACE',
  RAY: 'RAY',
  XLINE: 'XLINE',
  MLINE: 'MLINE',
  IMAGE: 'IMAGE',
  WIPEOUT: 'WIPEOUT',
  SOLID3D: '3DSOLID',
  BODY: 'BODY',
  SURFACE: 'SURFACE',
  HELIX: 'HELIX',
  TOLERANCE: 'TOLERANCE'
};

function dxfGroup(code, value) {
  return `${code.toString().padStart(3, ' ')}\n${value}\n`;
}

function getEntityCommonGroups(ent) {
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

function serializeEntity(ent) {
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
    case EntityType.SOLID:
      ent.points.forEach((pt, idx) => {
        s += dxfGroup(10 + idx, pt.x);
        s += dxfGroup(20 + idx, pt.y);
        s += dxfGroup(30 + idx, 0.0);
      });
      break;
    case EntityType.THREEDFACE:
      ent.points.forEach((pt, idx) => {
        s += dxfGroup(10 + idx, pt.x);
        s += dxfGroup(20 + idx, pt.y);
        s += dxfGroup(30 + idx, 0.0);
      });
      break;
    case EntityType.SPLINE:
      s += dxfGroup(70, ent.flags || 8);
      s += dxfGroup(71, ent.degree || 3);
      s += dxfGroup(72, 0); // 节点数由写出层控制，此处占位
      s += dxfGroup(73, ent.controlPoints.length);
      s += dxfGroup(74, 0);
      ent.controlPoints.forEach(pt => {
        s += dxfGroup(10, pt.x);
        s += dxfGroup(20, pt.y);
        s += dxfGroup(30, 0.0);
      });
      break;
    case EntityType.HATCH:
      s += dxfGroup(2, ent.patternName);
      s += dxfGroup(70, ent.solid ? 1 : 0);
      if (ent.scale !== undefined) s += dxfGroup(41, ent.scale);
      if (ent.angle !== undefined) s += dxfGroup(52, ent.angle);
      s += dxfGroup(91, ent.loops.length);
      ent.loops.forEach(loop => {
        s += dxfGroup(92, loop.type);
        if (loop.isPolyline) {
          s += dxfGroup(73, 1);
          s += dxfGroup(93, loop.points.length);
          loop.points.forEach((pt, idx) => {
            s += dxfGroup(10, pt.x);
            s += dxfGroup(20, pt.y);
            const bulge = loop.bulges?.[idx] || 0;
            if (bulge !== 0) s += dxfGroup(42, bulge);
          });
        } else {
          s += dxfGroup(73, 0);
          s += dxfGroup(93, loop.edges.length);
          loop.edges.forEach(edge => {
            if (edge.type === 'LINE') {
              s += dxfGroup(72, 1);
              s += dxfGroup(10, edge.start.x);
              s += dxfGroup(20, edge.start.y);
              s += dxfGroup(11, edge.end.x);
              s += dxfGroup(21, edge.end.y);
            } else if (edge.type === 'ARC') {
              s += dxfGroup(72, 2);
              s += dxfGroup(10, edge.center.x);
              s += dxfGroup(20, edge.center.y);
              s += dxfGroup(40, edge.radius);
              s += dxfGroup(50, edge.startAngle);
              s += dxfGroup(51, edge.endAngle);
              s += dxfGroup(73, edge.ccw ? 1 : 0);
            }
          });
        }
      });
      break;
    case EntityType.LEADER:
      s += dxfGroup(71, ent.arrowHeadFlag || 1);
      s += dxfGroup(72, ent.pathType || 0);
      s += dxfGroup(75, ent.hasHookLine ? 1 : 0);
      s += dxfGroup(76, ent.points.length);
      ent.points.forEach(pt => {
        s += dxfGroup(10, pt.x);
        s += dxfGroup(20, pt.y);
      });
      break;
  }
  return s;
}

function serializeDxf(data) {
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

  // 2.1 LTYPE
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

  // 2.2 LAYER
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

  // 2.3 STYLE
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
}

// ----------------------------------------------------
// 2. 构造精密复杂 CAD 示例图纸数据结构并输出
// ----------------------------------------------------

const defaultLayers = {
  '0': { name: '0', color: 7 },
  'Outline': { name: 'Outline', color: 1 }, // 红色
  'Grid': { name: 'Grid', color: 3 },       // 绿色
  'Text': { name: 'Text', color: 4 },       // 青色
  'Curves': { name: 'Curves', color: 5 },   // 蓝色
  'Hatch': { name: 'Hatch', color: 6 },     // 洋红
  '3D': { name: '3D', color: 1 },           // 红色（用于 helix）
  'Placements': { name: 'Placements', color: 2 }, // 黄色
  'Wipeout': { name: 'Wipeout', color: 7 }   // 白色
};

const defaultLineTypes = {
  'CONTINUOUS': { name: 'CONTINUOUS', description: 'Solid line', pattern: [], totalLength: 0 },
  'DASHED': { name: 'DASHED', description: 'Dashed __ __ __', pattern: [6.0, -3.0], totalLength: 9.0 }
};

const defaultStyles = {
  'STANDARD': { name: 'STANDARD', fontFileName: 'txt.shx', widthFactor: 1.0 }
};

// 1. 生成 basic.dxf — 极复杂的机械齿轮与工程辐射格网背景
function generateBasicDxf() {
  const entities = [];

  // (1) Grid 图层：极坐标极线与同心定位网格圆 (测试高密度线型渲染)
  for (let angle = 0; angle < 360; angle += 10) {
    const rad = (angle * Math.PI) / 180;
    entities.push({
      type: EntityType.LINE,
      layer: 'Grid',
      color: 3, // 绿色
      lineType: 'DASHED',
      start: { x: 0.0, y: 0.0 },
      end: { x: 140.0 * Math.cos(rad), y: 140.0 * Math.sin(rad) }
    });
  }

  for (let r = 20; r <= 120; r += 20) {
    entities.push({
      type: EntityType.CIRCLE,
      layer: 'Grid',
      color: 3,
      center: { x: 0.0, y: 0.0 },
      radius: r
    });
  }

  // (2) Outline 图层：用极坐标与 48 个顶点 (奇偶交替设置 Bulge 凸度) 生成 24 齿轮外廓 LWPOLYLINE
  const toothCount = 24;
  const totalPoints = toothCount * 2;
  const gearPoints = [];
  const gearBulges = [];

  for (let i = 0; i < totalPoints; i++) {
    const angle = (i * 2 * Math.PI) / totalPoints;
    // 奇偶数顶点交替：齿顶圆半径 80，齿根圆半径 66
    const r = i % 2 === 0 ? 80.0 : 66.0;
    gearPoints.push({ x: r * Math.cos(angle), y: r * Math.sin(angle) });
    // 奇数点和偶数点交替使用 0.18 和 -0.18 凸度，使齿侧过渡光滑
    gearBulges.push(i % 2 === 0 ? 0.18 : -0.18);
  }

  entities.push({
    type: EntityType.LWPOLYLINE,
    layer: 'Outline',
    color: 1, // 红色
    points: gearPoints,
    bulges: gearBulges,
    closed: true
  });

  // 齿轮中心孔与减重孔
  entities.push({
    type: EntityType.CIRCLE,
    layer: 'Outline',
    color: 1,
    center: { x: 0.0, y: 0.0 },
    radius: 16.0
  });

  // 轴承键槽
  entities.push({
    type: EntityType.LWPOLYLINE,
    layer: 'Outline',
    color: 1,
    points: [
      { x: -16.0, y: -4.0 },
      { x: -20.0, y: -4.0 },
      { x: -20.0, y: 4.0 },
      { x: -16.0, y: 4.0 }
      // 保持开口
    ],
    closed: false
  });

  // 4个对称的椭圆减重孔 (ELLIPSE)
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2;
    entities.push({
      type: EntityType.ELLIPSE,
      layer: 'Outline',
      color: 1,
      center: { x: 42.0 * Math.cos(angle), y: 42.0 * Math.sin(angle) },
      majorAxis: { x: 12.0 * Math.cos(angle + Math.PI/2), y: 12.0 * Math.sin(angle + Math.PI/2) },
      ratio: 0.6,
      startParam: 0.0,
      endParam: Math.PI * 2
    });
  }

  // (3) SOLID 与 3DFACE：在四个象限绘制实体填充三角面和三维四边形
  entities.push({
    type: EntityType.SOLID,
    layer: 'Outline',
    color: 4, // 青色
    points: [
      { x: 110.0, y: 110.0 },
      { x: 130.0, y: 110.0 },
      { x: 120.0, y: 130.0 },
      { x: 120.0, y: 130.0 } // 退化为三角形
    ]
  });

  entities.push({
    type: EntityType.THREEDFACE,
    layer: 'Outline',
    color: 5, // 蓝色
    points: [
      { x: -130.0, y: 110.0 },
      { x: -110.0, y: 110.0 },
      { x: -110.0, y: 130.0 },
      { x: -130.0, y: 130.0 }
    ]
  });

  // (4) Text 图层：技术参数标注说明
  entities.push({
    type: EntityType.TEXT,
    layer: 'Text',
    color: 7,
    position: { x: -140.0, y: -130.0 },
    height: 6.0,
    value: 'SPUR GEAR PROTOTYPE (N=24, BULGE OVERLAY)',
    rotation: 0.0
  });
  entities.push({
    type: EntityType.TEXT,
    layer: 'Text',
    color: 7,
    position: { x: -140.0, y: -142.0 },
    height: 5.0,
    value: 'SCALE 1:1  |  UNIT: MM  |  DESIGN: DXF WRITER SERVICE',
    rotation: 0.0
  });

  const dxfData = {
    header: {
      extMin: { x: -150.0, y: -150.0 },
      extMax: { x: 150.0, y: 150.0 },
      insUnits: 4,
      ltScale: 1.0
    },
    layers: defaultLayers,
    lineTypes: defaultLineTypes,
    styles: defaultStyles,
    blocks: {},
    entities
  };

  const serialized = serializeDxf(dxfData);
  fs.writeFileSync(path.join(targetDir, 'basic.dxf'), serialized, 'utf-8');
  console.log('basic.dxf generated successfully.');
}

// 2. 生成 advanced.dxf — 余弦样条曲线、倾斜嵌套椭圆、双环孤岛填充及富文本 MTEXT
function generateAdvancedDxf() {
  const entities = [];

  // (1) Curves 图层：15个控制点正弦余弦复合样条线 (SPLINE)
  const splineControlPoints = [];
  for (let i = 0; i < 15; i++) {
    const x = -110.0 + i * 16.0;
    const y = 35.0 * Math.cos(i * 0.95) + 15.0;
    splineControlPoints.push({ x, y });
  }

  entities.push({
    type: EntityType.SPLINE,
    layer: 'Curves',
    color: 5, // 蓝色
    controlPoints: splineControlPoints,
    flags: 8, // planar
    degree: 3
  });

  // (2) Curves 图层：嵌套 5 层不同旋转角的椭圆 (ELLIPSE)
  for (let i = 0; i < 5; i++) {
    const angle = (i * Math.PI) / 5;
    entities.push({
      type: EntityType.ELLIPSE,
      layer: 'Curves',
      color: 6, // 洋红
      center: { x: 0.0, y: -65.0 },
      majorAxis: { x: 45.0 * Math.cos(angle), y: 45.0 * Math.sin(angle) },
      ratio: 0.35,
      startParam: 0.0,
      endParam: Math.PI * 2
    });
  }

  // (3) Hatch 图层：带有内圆孤岛的双环 HATCH (ANSI31 图案)
  entities.push({
    type: EntityType.HATCH,
    layer: 'Hatch',
    color: 3, // 绿色
    patternName: 'ANSI31',
    solid: false,
    scale: 1.5,
    angle: 45.0,
    loops: [
      // 外环边界：大圆 (ARC, CCW)
      {
        type: 1, // 外边界
        isPolyline: false,
        edges: [
          {
            type: 'ARC',
            center: { x: 65.0, y: 65.0 },
            radius: 42.0,
            startAngle: 0.0,
            endAngle: 360.0,
            ccw: true
          }
        ]
      },
      // 内环边界（孤岛）：小圆 (ARC, CCW)
      {
        type: 0, // 内边界/默认
        isPolyline: false,
        edges: [
          {
            type: 'ARC',
            center: { x: 65.0, y: 65.0 },
            radius: 20.0,
            startAngle: 0.0,
            endAngle: 360.0,
            ccw: true
          }
        ]
      }
    ]
  });

  // (4) MText 图层：富文本排版 (使用控制字符和各种格式演示)
  entities.push({
    type: EntityType.MTEXT,
    layer: 'Text',
    color: 7,
    position: { x: -110.0, y: 135.0 },
    height: 5.5,
    value: '{\\FInter|\\H5.5;CAD 高级图元与文字排版测试说明：\\P\\C3;1. 样条曲线 (SPLINE) 15个周期采样三阶拟合\\P\\C6;2. 嵌套旋转椭圆 (ELLIPSE) 五向等分倾角\\P\\C4;3. 复合双环孤岛剖面填充 (HATCH - ANSI31)\\P\\C1;4. 演示带有格式字体的多行富文本。}'
  });

  const dxfData = {
    header: {
      extMin: { x: -130.0, y: -130.0 },
      extMax: { x: 130.0, y: 150.0 },
      insUnits: 4,
      ltScale: 1.0
    },
    layers: defaultLayers,
    lineTypes: defaultLineTypes,
    styles: defaultStyles,
    blocks: {},
    entities
  };

  const serialized = serializeDxf(dxfData);
  fs.writeFileSync(path.join(targetDir, 'advanced.dxf'), serialized, 'utf-8');
  console.log('advanced.dxf generated successfully.');
}

// 3. 生成 new_features.dxf — 15圈 HELIX 投影、WIPEOUT 遮罩、带缩放的 IMAGE 及公差标注
function generateNewFeaturesDxf() {
  const entities = [];

  // (1) 3D 图层：15圈、具有 480 个插值顶点的 3D 螺旋线投影段 (HELIX)
  entities.push({
    type: EntityType.HELIX,
    layer: '3D',
    color: 1, // 红色
    startPoint: { x: 0.0, y: 0.0, z: -60.0 },
    axisVector: { x: 0.0, y: 0.0, z: 1.0 },
    radius: 35.0,
    turns: 15.0,
    pitch: 8.0,
    handedness: 1 // 右手
  });

  // (2) Wipeout 图层：正八边形遮罩区域 (WIPEOUT)
  const wipeoutPoints = [];
  const wRadius = 38.0;
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4;
    // 平移偏置到左下方 (x = -65, y = -65)
    wipeoutPoints.push({
      x: wRadius * Math.cos(angle) - 65.0,
      y: wRadius * Math.sin(angle) - 65.0
    });
  }

  entities.push({
    type: EntityType.WIPEOUT,
    layer: 'Wipeout',
    color: 7,
    points: wipeoutPoints,
    closed: true
  });

  // (3) Placements 图层：IMAGE 图像占位图元
  entities.push({
    type: EntityType.IMAGE,
    layer: 'Placements',
    color: 2, // 黄色
    position: { x: 25.0, y: -85.0, z: 0.0 },
    uVector: { x: 1.2, y: 0.0, z: 0.0 }, // X轴缩放1.2
    vVector: { x: 0.0, y: 0.8, z: 0.0 }, // Y轴缩放0.8
    imageSize: { x: 60.0, y: 40.0 },
    imageRef: 'HDF2_IMAGEREF'
  });

  // (4) Text 图层：TOLERANCE 形位公差标注框结构
  entities.push({
    type: EntityType.TOLERANCE,
    layer: 'Text',
    color: 4, // 青色
    text: '{\\Ftxt;|\\H4.5;[%%c0.03|A|B|C]}',
    position: { x: -100.0, y: 90.0, z: 0.0 },
    direction: { x: 1.0, y: 0.0, z: 0.0 }
  });

  // 添加描述文本
  entities.push({
    type: EntityType.TEXT,
    layer: 'Text',
    color: 7,
    position: { x: -110.0, y: 120.0 },
    height: 5.5,
    value: 'HELIX SCENARIO & WIPEOUT MASKING TEST',
    rotation: 0.0
  });

  const dxfData = {
    header: {
      extMin: { x: -130.0, y: -130.0 },
      extMax: { x: 130.0, y: 140.0 },
      insUnits: 4,
      ltScale: 1.0
    },
    layers: defaultLayers,
    lineTypes: defaultLineTypes,
    styles: defaultStyles,
    blocks: {},
    entities
  };

  const serialized = serializeDxf(dxfData);
  fs.writeFileSync(path.join(targetDir, 'new_features.dxf'), serialized, 'utf-8');
  console.log('new_features.dxf generated successfully.');
}

generateBasicDxf();
generateAdvancedDxf();
generateNewFeaturesDxf();
