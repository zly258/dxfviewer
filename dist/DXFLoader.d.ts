/**
 * TypeScript Definitions for threejs-dxf-loader v1.0.0
 * Author: zhangly1403 <zhangly1403@qq.com>
 * License: MIT
 */
import * as THREE from 'three';

export interface DXFLoaderOptions {
  /** Base CSS font stack fallback (default: Microsoft YaHei / PingFang SC / Inter) */
  fontFamily?: string;
  /** Default hex color when layer/entity color is unspecified */
  defaultColor?: number;
  /** Active canvas background theme: 'light' | 'dark' */
  backgroundColor?: 'light' | 'dark';
  /** Dimension rendering mode: 'auto' (prefers anonymous *D<n> block if present) | 'procedural' */
  dimensionMode?: 'auto' | 'procedural';
  /** Include paper-space entities (group code 67 = 1) */
  includePaperSpace?: boolean;
  /** Default tessellation segments for circles/arcs/splines (default: 48) */
  curveSegments?: number;
  /** Extrude 2D entities with non-zero group code 39 thickness into closed 3D solid volumes */
  extrudeThickness?: boolean;
  /** Shift large coordinates (>5000) to local origin to prevent 32-bit WebGL jitter */
  centerOrigin?: boolean;
}

export interface DXFProgressEvent {
  /** Progress percentage from 0 to 100 */
  percent: number;
  /** Human-readable stage description */
  stage: string;
  /** Detailed counter or sub-status */
  detail: string;
}

export interface DXFLayerSummary {
  name: string;
  displayName: string;
  visible: boolean;
  colorHex: number;
  colorPair: { light: number; dark: number };
  linetype: string;
  entityCount: number;
}

export interface DXFPickRecord {
  id: number;
  isTopLevel: boolean;
  isNestedText?: boolean;
  parentBlock?: string | null;
  plainText?: string;
  resolvedFont?: string;
  entity: Record<string, any>;
  layer: string;
  displayLayer: string;
  colorPair: { light: number; dark: number };
  box: THREE.Box3;
}

export interface DXFTextRecord {
  id: number;
  plainText: string;
  rawText: string;
  type: string;
  handle: string;
  layer: string;
  displayLayer: string;
  parentBlock: string | null;
  resolvedFont: string;
  height: number;
  colorPair: { light: number; dark: number };
  box: THREE.Box3;
  entity: Record<string, any> | null;
  pickRecord?: DXFPickRecord;
}

export interface DXFParseResult {
  /** Root THREE.Group containing batched layer meshes and text atlas meshes */
  scene: THREE.Group;
  /** Raw parsed DXF structure (header, tables, blocks, entities, objects) */
  dxf: Record<string, any>;
  /** Map of normalized layer name -> THREE.Group */
  layers: Record<string, THREE.Group>;
  /** Statistics and telemetry */
  stats: {
    totalEntities: number;
    totalVertices: number;
    drawCalls: number;
    parseTimeMs: number;
    encoding: string;
    acadVer: string;
    originShift: { x: number; y: number; z: number };
    warnings: string[];
    byType: Record<string, number>;
    layers: DXFLayerSummary[];
    blocksCount: number;
    stylesCount: number;
    dimstylesCount: number;
    has3D: boolean;
  };
  /** Outlier-filtered viewport bounding box */
  boundingBox: THREE.Box3;
  /** Full unclipped WCS bounding box */
  fullBoundingBox: THREE.Box3;
  /** Spatial pick records for raycasting and Window/Crossing box selection */
  pickRecords: DXFPickRecord[];
  /** Searchable text records with exact quad bounding boxes for instant locate */
  textRecords: DXFTextRecord[];
  /** 64-bit origin offset subtracted from scene coordinates */
  originShift: { x: number; y: number; z: number };
}

export class DXFLoader {
  options: DXFLoaderOptions;
  constructor(manager?: THREE.LoadingManager);
  setOptions(opts: Partial<DXFLoaderOptions>): this;
  load(
    url: string,
    onLoad?: (result: DXFParseResult) => void,
    onProgress?: (event: DXFProgressEvent | ProgressEvent) => void,
    onError?: (err: unknown) => void
  ): void;
  parse(dxfInput: string | ArrayBuffer | Uint8Array, customOptions?: Partial<DXFLoaderOptions>): DXFParseResult;
  parseAsync(
    dxfInput: string | ArrayBuffer | Uint8Array,
    customOptions?: Partial<DXFLoaderOptions> | null,
    onProgress?: (event: DXFProgressEvent) => void
  ): Promise<DXFParseResult>;

  /** Swaps precomputed light/dark vertex color buffers in <1ms without re-parsing */
  static applyBackgroundTheme(rootGroup: THREE.Group, bgTheme: 'light' | 'dark'): void;
  /** Auto-detects UTF-8 vs GB18030/GBK encoding from ArrayBuffer */
  static decodeDXFArrayBuffer(input: string | ArrayBuffer | Uint8Array): {
    text: string;
    encoding: string;
    isBinary: boolean;
  };
  /** Maps CAD SHX/TTF font names to the closest OS system font stack */
  static mapCADFontToSystemFont(fontName?: string, bigFontName?: string, defaultStack?: string): string;
  static ACI_PALETTE: number[];
}

export default DXFLoader;
