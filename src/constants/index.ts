export const DEFAULT_VIEWPORT = {
  targetX: 0,
  targetY: 0,
  zoom: 1
};

export const DEFAULT_COLOR = '#FFFFFF';

export const GRID_SIZE = 100;

export const LINE_TYPE_MAP: Record<string, string> = {
  'CONTINUOUS': 'none',
  'BYLAYER': 'none',
  'BYBLOCK': 'none',
  'DASHED': '10, 5',
  'HIDDEN': '5, 5',
  'CENTER': '15, 5, 5, 5',
  'PHANTOM': '15, 5, 5, 5, 5, 5',
  'DOT': '2, 2',
  'DASHDOT': '10, 5, 2, 5',
  'BORDER': '15, 5, 15, 5, 2, 5',
  'DIVIDE': '15, 5, 2, 5, 2, 5'
};

export const ENTITY_TYPE_TRANSLATIONS: Record<string, string> = {
  'LINE': "线 (LINE)",
  'ARC': "弧 (ARC)",
  'CIRCLE': "圆 (CIRCLE)",
  'LWPOLYLINE': "多段线 (LWPOLYLINE)",
  'POLYLINE': "多段线 (POLYLINE)",
  'TEXT': "单行文字 (TEXT)",
  'MTEXT': "多行文字 (MTEXT)",
  'INSERT': "块参照 (INSERT)",
  'HATCH': "填充 (HATCH)",
  'DIMENSION': "标注 (DIMENSION)",
  'SPLINE': "样条曲线 (SPLINE)",
  'ELLIPSE': "椭圆 (ELLIPSE)",
  'SOLID': "二维填充 (SOLID)",
  'THREEDFACE': "三维面 (3DFACE)",
  'POINT': "点 (POINT)",
  'LEADER': "引线 (LEADER)",
  'RAY': "射线 (RAY)",
  'XLINE': "构造线 (XLINE)",
  'ATTDEF': "属性定义 (ATTDEF)",
  'ATTRIB': "属性 (ATTRIB)",
  'ACAD_TABLE': "表格 (TABLE)",
};
