export type CanvasTheme = 'black' | 'white';
export type UiTheme = 'light' | 'dark';
export type DrawingColorMode = 'original' | 'monochrome';

export interface Point2D {
  x: number;
  y: number;
}

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface ViewPort {
  targetX: number;
  targetY: number;
  zoom: number;
}

export enum ToolMode {
  SELECT = 'SELECT',
  PAN = 'PAN'
}
