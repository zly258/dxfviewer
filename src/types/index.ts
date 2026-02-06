export enum EntityType {
  LINE = 'LINE',
  CIRCLE = 'CIRCLE',
  ARC = 'ARC',
  LWPOLYLINE = 'LWPOLYLINE',
  TEXT = 'TEXT',
  POINT = 'POINT',
  MTEXT = 'MTEXT',
  ELLIPSE = 'ELLIPSE',
  SPLINE = 'SPLINE',
  INSERT = 'INSERT',
  SOLID = 'SOLID',
  POLYLINE = 'POLYLINE',
  DIMENSION = 'DIMENSION',
  HATCH = 'HATCH',
  ATTRIB = 'ATTRIB',
  ATTDEF = 'ATTDEF',
  REGION = 'REGION',
  LEADER = 'LEADER',
  ACAD_TABLE = 'ACAD_TABLE',
  THREEDFACE = '3DFACE',
  RAY = 'RAY',
  XLINE = 'XLINE',
  MLINE = 'MLINE',
  IMAGE = 'IMAGE',
  WIPEOUT = 'WIPEOUT',
  SOLID3D = '3DSOLID',
  REGION_ENTITY = 'REGION',
  BODY = 'BODY',
  SURFACE = 'SURFACE'
}

export interface Point2D {
  x: number;
  y: number;
}

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface DxfEntity {
  id: string;
  handle?: string;
  type: EntityType;
  layer: string;
  color?: number;
  trueColor?: number;
  lineType?: string;
  lineTypeScale?: number;
  lineweight?: number;
  visible?: boolean;
  inPaperSpace?: boolean;
  extrusion?: Point3D;
  extents?: { min: Point2D, max: Point2D };
}

export interface DxfLine extends DxfEntity {
  type: EntityType.LINE;
  start: Point2D;
  end: Point2D;
}

export interface DxfRay extends DxfEntity {
  type: EntityType.RAY;
  basePoint: Point2D;
  direction: Point2D;
}

export interface DxfXLine extends DxfEntity {
  type: EntityType.XLINE;
  basePoint: Point2D;
  direction: Point2D;
}

export interface DxfPoint extends DxfEntity {
    type: EntityType.POINT;
    position: Point2D;
}

export interface DxfCircle extends DxfEntity {
  type: EntityType.CIRCLE;
  center: Point2D;
  radius: number;
}

export interface DxfArc extends DxfEntity {
  type: EntityType.ARC;
  center: Point2D;
  radius: number;
  startAngle: number;
  endAngle: number;
  isCounterClockwise?: boolean;
}

export interface DxfPolyline extends DxfEntity {
  type: EntityType.LWPOLYLINE | EntityType.POLYLINE;
  points: Point2D[];
  bulges?: number[]; 
  closed: boolean;
  constantWidth?: number;
}

export interface DxfText extends DxfEntity {
  type: EntityType.TEXT | EntityType.MTEXT | EntityType.ATTRIB | EntityType.ATTDEF;
  position: Point2D;
  secondPosition?: Point2D; // 用于对齐的文字
  height: number;
  value: string;
  rotation?: number;
  hAlign?: number; // 水平对齐 (组码 72)
  vAlign?: number; // 垂直对齐 (组码 73)
  widthFactor?: number;
  attachmentPoint?: number; // 多行文字附着点 (组码 71)
  width?: number; // 多行文字宽度
  boxHeight?: number; // 多行文字高度
  lineSpacingFactor?: number; // 多行文字行距系数 (组码 44)
  lineSpacingStyle?: number; // 多行文字行距样式 (组码 73)
  bgFill?: boolean;
  bgColor?: number;
  styleName?: string;
  tag?: string; // 用于属性定义 (ATTDEF)
  flags?: number; // 用于属性定义 (组码 70)
}

export interface DxfEllipse extends DxfEntity {
  type: EntityType.ELLIPSE;
  center: Point2D;
  majorAxis: Point2D;
  ratio: number;
  startParam: number;
  endParam: number;
}

export interface DxfSpline extends DxfEntity {
  type: EntityType.SPLINE;
  controlPoints: Point2D[];
  fitPoints?: Point2D[];
  degree?: number;
  knots?: number[];
  weights?: number[];
  flags?: number;
  calculatedPoints?: Point2D[];
}

export interface DxfSolid extends DxfEntity {
  type: EntityType.SOLID;
  points: Point2D[];
}

export interface Dxf3DFace extends DxfEntity {
  type: EntityType.THREEDFACE;
  points: Point2D[];
  edgeFlags?: number;
}

export interface DxfInsert extends DxfEntity {
  type: EntityType.INSERT;
  blockName: string;
  position: Point2D;
  scale: { x: number, y: number, z: number };
  rotation: number;
  rowCount: number;
  colCount: number;
  rowSpacing: number;
  colSpacing: number;
  attributes?: DxfText[];
}

export interface DxfDimension extends DxfEntity {
  type: EntityType.DIMENSION;
  blockName: string;
  definitionPoint: Point2D;
  textMidPoint: Point2D;
  measurement?: number;
  text?: string;
  dimType?: number;
  styleName?: string;
  linearP1?: Point2D;
  linearP2?: Point2D;
  arcP1?: Point2D;
  arcP2?: Point2D;
}

export interface DxfLeader extends DxfEntity {
  type: EntityType.LEADER;
  points: Point2D[];
  arrowHeadFlag?: number; // 箭头标志 (组码 71)
  pathType?: number; // 路径类型 (组码 72)
  annotationHandle?: string; // 注解句柄 (组码 340)
  hasHookLine?: boolean; // 是否有钩线 (组码 75)
}

export interface HatchEdge {
  type: 'LINE' | 'ARC' | 'ELLIPSE' | 'SPLINE';
  start?: Point2D;
  end?: Point2D;
  center?: Point2D;
  radius?: number;
  startAngle?: number;
  endAngle?: number;
  ccw?: boolean;
  majorAxis?: Point2D;
  ratio?: number;
  controlPoints?: Point2D[];
  knots?: number[];
  weights?: number[];
  degree?: number;
  calculatedPoints?: Point2D[];
}

export interface HatchLoop {
  type: number;
  edges: HatchEdge[];
  isPolyline?: boolean;
  points?: Point2D[];
  bulges?: number[];
}

export interface DxfHatch extends DxfEntity {
  type: EntityType.HATCH;
  patternName: string;
  solid: boolean;
  scale?: number;
  angle?: number;
  loops: HatchLoop[];
  isFlipped?: boolean;
}

export interface DxfRegion extends DxfEntity {
  type: EntityType.REGION;
}

export interface DxfTable extends DxfEntity {
  type: EntityType.ACAD_TABLE;
  blockName: string;
  position: Point2D;
  scale?: { x: number, y: number, z: number };
  rotation?: number;
  cells?: string[];
  rowCount?: number;
  columnCount?: number;
  rowSpacing?: number;
  columnSpacing?: number;
  rowHeights?: number[];
  colWidths?: number[];
}

export type AnyEntity = DxfLine | DxfRay | DxfXLine | DxfPoint | DxfCircle | DxfArc | DxfPolyline | DxfText | DxfEllipse | DxfSpline | DxfSolid | Dxf3DFace | DxfInsert | DxfDimension | DxfHatch | DxfRegion | DxfLeader | DxfTable;

export interface DxfBlock {
  name: string;
  handle?: string;
  basePoint: Point2D;
  entities: AnyEntity[];
  extents?: { min: Point2D, max: Point2D };
}

export interface DxfLayer {
  name: string;
  color: number;
  trueColor?: number;
  lineType?: string;
  lineweight?: number;
  isVisible?: boolean;
}

export interface DxfStyle {
  name: string;
  fontFileName: string;
  bigFontFileName?: string;
  height?: number;
  widthFactor?: number;
}

export interface DxfLineType {
  name: string;
  description?: string;
  pattern: number[];
  totalLength: number;
}

export interface DxfHeader {
    extMin: Point2D;
    extMax: Point2D;
    insUnits: number;
    ltScale?: number;
}

export interface DxfData {
  header?: DxfHeader;
  entities: AnyEntity[];
  layers: Record<string, DxfLayer>;
  blocks: Record<string, DxfBlock>;
  styles: Record<string, DxfStyle>;
  lineTypes: Record<string, DxfLineType>;
  offset?: Point2D;
  extents?: { center: Point2D, width: number, height: number, min: Point2D, max: Point2D };
}

export interface ViewPort {
  targetX: number; // 屏幕中心的世界 X 坐标
  targetY: number; // 屏幕中心的世界 Y 坐标
  zoom: number;
}

export enum ToolMode {
  SELECT = 'SELECT',
  PAN = 'PAN'
}
