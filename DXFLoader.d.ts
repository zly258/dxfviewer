import * as THREE from 'three';

export interface DXFLoaderOptions {
  fontMode?: 'shx' | 'canvas' | 'hybrid';
  fontFamily?: string;
  defaultColor?: number;
  backgroundColor?: 'dark' | 'light';
  dimensionMode?: 'auto' | 'procedural';
  includePaperSpace?: boolean;
  curveSegments?: number;
  extrudeThickness?: boolean;
}

export interface DXFLayerSummary {
  name: string;
  visible: boolean;
  colorHex: number;
  linetype: string;
  entityCount: number;
}

export interface DXFLoadResult {
  scene: THREE.Group;
  dxf: any;
  layers: Record<string, THREE.Group>;
  stats: {
    totalEntities: number;
    byType: Record<string, number>;
    layers: DXFLayerSummary[];
    blocksCount: number;
    stylesCount: number;
    dimstylesCount: number;
    has3D: boolean;
  };
  boundingBox: THREE.Box3;
}

export class DXFLoader {
  constructor(manager?: THREE.LoadingManager);
  options: DXFLoaderOptions;
  setOptions(options: DXFLoaderOptions): this;
  registerFont(name: string, threeFont: any): this;
  load(
    url: string,
    onLoad: (result: DXFLoadResult) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (err: unknown) => void
  ): void;
  parse(dxfText: string, customOptions?: DXFLoaderOptions): DXFLoadResult;
  static ACI_PALETTE: number[];
  static SHX_GLYPHS: Record<string, { w: number; s: number[][][] }>;
}

export default DXFLoader;
