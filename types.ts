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
  ACAD_TABLE = 'ACAD_TABLE'
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
  lineType?: string;
  selected?: boolean;
  visible?: boolean;
  extrusion?: Point3D;
  inPaperSpace?: boolean;
}

export interface DxfLine extends DxfEntity {
  type: EntityType.LINE;
  start: Point2D;
  end: Point2D;
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
}

export interface DxfPolyline extends DxfEntity {
  type: EntityType.LWPOLYLINE | EntityType.POLYLINE;
  points: Point2D[];
  bulges?: number[]; 
  closed: boolean;
}

export interface DxfText extends DxfEntity {
  type: EntityType.TEXT | EntityType.MTEXT | EntityType.ATTRIB | EntityType.ATTDEF;
  position: Point2D;
  secondPosition?: Point2D; // For aligned text
  height: number;
  value: string;
  rotation?: number;
  hAlign?: number; // 72
  vAlign?: number; // 73
  widthFactor?: number;
  attachmentPoint?: number; // MText 71
  width?: number; // MText width
  boxHeight?: number; // MText height
  bgFill?: boolean;
  bgColor?: number;
  styleName?: string;
  tag?: string; // For ATTDEF
  flags?: number; // For ATTDEF 70
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
}

export interface DxfSolid extends DxfEntity {
  type: EntityType.SOLID;
  points: Point2D[];
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
}

export interface DxfLeader extends DxfEntity {
  type: EntityType.LEADER;
  points: Point2D[];
  arrowHeadFlag?: number; // 71
  pathType?: number; // 72
  annotationHandle?: string; // 340
  hasHookLine?: boolean; // 75
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
}

export interface DxfRegion extends DxfEntity {
  type: EntityType.REGION;
}

export type AnyEntity = DxfLine | DxfPoint | DxfCircle | DxfArc | DxfPolyline | DxfText | DxfEllipse | DxfSpline | DxfSolid | DxfInsert | DxfDimension | DxfHatch | DxfRegion | DxfLeader;

export interface DxfBlock {
  name: string;
  handle?: string;
  basePoint: Point2D;
  entities: AnyEntity[];
}

export interface DxfLayer {
  name: string;
  color: number;
  lineType?: string;
  isVisible?: boolean;
}

export interface DxfStyle {
  name: string;
  fontFileName: string;
  bigFontFileName?: string;
  height?: number;
  widthFactor?: number;
}

export interface DxfHeader {
    extMin: Point2D;
    extMax: Point2D;
    insUnits: number;
}

export interface DxfData {
  header?: DxfHeader;
  entities: AnyEntity[];
  layers: Record<string, DxfLayer>;
  blocks: Record<string, DxfBlock>;
  styles: Record<string, DxfStyle>;
}

export interface ViewPort {
  x: number;
  y: number;
  zoom: number;
}

export enum ToolMode {
  SELECT = 'SELECT',
  PAN = 'PAN'
}