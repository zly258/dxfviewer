import { Point2D } from './core';
import { AnyEntity } from './entity';

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
  layers: Record<string, DxfLayer>;
  blocks: Record<string, DxfBlock>;
  styles: Record<string, DxfStyle>;
  lineTypes: Record<string, DxfLineType>;
  offset?: Point2D;
  extents?: { center: Point2D, width: number, height: number, min: Point2D, max: Point2D };
}
