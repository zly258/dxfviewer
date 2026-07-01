import { Point2D } from './core';
import { AnyEntity } from './entity';

export interface DxfBlock {
  name: string;
  handle?: string;
  basePoint: Point2D;
  entities: AnyEntity[];
  extents?: { min: Point2D, max: Point2D };
  isModelSpace?: boolean;
  isPaperSpace?: boolean;
  layoutName?: string;
}

export interface DxfLayer {
  name: string;
  color: number;
  trueColor?: number;
  lineType?: string;
  lineweight?: number;
  transparency?: number;
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

export interface DxfImageDef {
  handle: string;
  filePath: string;
  imageSize?: Point2D;
  pixelSize?: Point2D;
  loaded?: boolean;
  resolutionUnits?: number;
}

export interface DxfLayout {
  id: string;
  name: string;
  displayName: string;
  isModel: boolean;
  entities: AnyEntity[];
  tabOrder?: number;
  blockName?: string;
  blockRecordHandle?: string;
  paperMin?: Point2D;
  paperMax?: Point2D;
  extents?: { center: Point2D, width: number, height: number, min: Point2D, max: Point2D };
}

export interface DxfHeader {
    extMin: Point2D;
    extMax: Point2D;
    insUnits: number;
    ltScale?: number;
    celtscale?: number;
}

export interface DxfData {
  header?: DxfHeader;
  entities: AnyEntity[];
  allEntities?: AnyEntity[];
  layouts: DxfLayout[];
  activeLayoutName: string;
  layers: Record<string, DxfLayer>;
  blocks: Record<string, DxfBlock>;
  styles: Record<string, DxfStyle>;
  lineTypes: Record<string, DxfLineType>;
  imageDefs?: Record<string, DxfImageDef>;
  offset?: Point2D;
  extents?: { center: Point2D, width: number, height: number, min: Point2D, max: Point2D };
}
