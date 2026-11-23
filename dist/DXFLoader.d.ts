/**
 * TypeScript definitions for threejs-dxf-loader.
 * Author: zhangly1403 <zhangly1403@qq.com>
 * License: GPL-3.0
 */
import * as THREE from 'three';

/** Background theme understood by the renderer. */
export type DXFTheme = 'light' | 'dark' | 'bw';

export interface DXFLoaderOptions {
  /** Base CSS font stack used by the text atlas (defaults to SimSun/Arial fallbacks). */
  fontFamily?: string;
  /** Default hex colour when a layer/entity colour is unspecified (default 0x0F172A). */
  defaultColor?: number;
  /** Initial background theme (default 'light'). */
  backgroundColor?: DXFTheme;
  /** 'auto' prefers the drawing's own *D<n> dimension block; any other value recomputes. */
  dimensionMode?: 'auto' | 'computed';
  /** Include paper-space entities (group code 67 = 1). Default false. */
  includePaperSpace?: boolean;
  /** Segments used to approximate a full circle / closed curve (default 96). */
  curveSegments?: number;
  /** Minimum segments for a full circle / closed curve (default 24). */
  minCurveSegments?: number;
  /** Maximum segments for a full circle / closed curve (default 192). */
  maxCurveSegments?: number;
  /** Scale curve tessellation by radius relative to model size (default true). */
  adaptiveCurveSegments?: boolean;
  /** Crease angle in degrees used to split smooth 3D normals (default 44). */
  creaseAngle?: number;
  /** Render entities that carry a non-zero group-code 39 thickness as 3D volumes. */
  extrudeThickness?: boolean;
  /** Shift the drawing so its geometric centre sits at the world origin (default true). */
  centerOrigin?: boolean;
  /** Nominal glyph size in the text atlas in pixels (default 96). */
  textAtlasPx?: number;
  /** Side length of each text-atlas page in pixels (default 4096; ~64 MB VRAM). */
  textAtlasPageSize?: number;
  /** Safety cap on the number of text-atlas pages (default 64). */
  textAtlasMaxPages?: number;
}

export interface DXFProgressEvent {
  /** Progress percentage, 0-100. */
  percent: number;
  /** Human-readable current stage. */
  stage: string;
  /** Optional sub-status / counter. */
  detail?: string;
}

export interface DXFLayerInfo {
  name: string;
  displayName: string;
  visible: boolean;
  colorPair: { light: number; dark: number };
  colorHex: number;
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
  /** World-space bounding box of the entity. */
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

export interface DXFStats {
  totalEntities: number;
  totalVertices: number;
  drawCalls: number;
  parseTimeMs: number;
  encoding: string;
  acadVer: string;
  originShift: { x: number; y: number; z: number };
  warnings: string[];
  byType: Record<string, number>;
  layers: DXFLayerInfo[];
  blocksCount: number;
  stylesCount: number;
  dimstylesCount: number;
  has3D: boolean;
  textAtlasPages: number;
  droppedText: number;
  acisEntities: number;
  acisSabMatched: number;
  acisSabOk: number;
  acisSabFail: number;
  acisSatOk: number;
  acisEmpty: number;
  acisEmittedEdges: number;
  acisSabMapSize: number;
}

export interface DXFParseResult {
  /** Root THREE.Group containing batched layer meshes and text-atlas meshes. */
  scene: THREE.Group;
  /** Raw parsed DXF document (header, tables, blocks, entities, objects). */
  dxf: Record<string, any>;
  /** Normalised layer name -> THREE.Group. */
  layers: Record<string, THREE.Group>;
  /** Statistics and telemetry. */
  stats: DXFStats;
  /** Outlier-filtered viewport bounding box. */
  boundingBox: THREE.Box3;
  /** Full unclipped WCS bounding box. */
  fullBoundingBox: THREE.Box3;
  /** One pick record per entity, used by host pickers. */
  pickRecords: DXFPickRecord[];
  /** Searchable text records with exact quad bounding boxes. */
  textRecords: DXFTextRecord[];
  /** Origin offset subtracted from scene coordinates. */
  originShift: { x: number; y: number; z: number };
}

export interface DXFAcisDecodeResult {
  source: string;
  satLines?: string[];
  error?: string;
}

export class DXFLoader {
  constructor(manager?: THREE.LoadingManager);
  options: DXFLoaderOptions;
  registeredFonts: Record<string, any>;

  setOptions(opts: Partial<DXFLoaderOptions>): this;
  registerFont(name: string, threeFont: any): this;
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

  /** Swaps precomputed light/dark vertex-colour buffers without re-parsing. */
  static applyBackgroundTheme(rootGroup: THREE.Group, theme?: DXFTheme, selectedIdSet?: Set<number> | null): void;
  /** Decodes the ACIS payload of a 3D-solid entity into raw SAT records. */
  static decodeAcisData(ent: Record<string, any>, dxf: Record<string, any>): DXFAcisDecodeResult;
  /** Releases geometries, materials and textures held by a parsed scene. */
  static dispose(rootGroup: THREE.Group): void;
  /** Auto-detects UTF-8 vs GB18030/GBK and decodes the buffer to text. */
  static decodeDXFArrayBuffer(input: string | ArrayBuffer | Uint8Array): {
    text: string;
    encoding: string;
    isBinary: boolean;
  };
  /** Maps CAD SHX/TTF font names to the closest OS system font stack. */
  static mapCADFontToSystemFont(fontName?: string, bigFontName?: string, defaultStack?: string): string;
  static sabBytesToSatLines(bytes: Uint8Array, ...rest: any[]): string[];
  static hexStringToUint8Array(hex: string): Uint8Array;
  static resolveAcisSatLines(ent: Record<string, any>, dxf: Record<string, any>): { source: string; satLines: string[] };

  static ACI_PALETTE: number[];
  static DXFParser: typeof DXFParser;
  static MultiPageTextAtlas: typeof MultiPageTextAtlas;
  static Float32GrowableBuffer: typeof Float32GrowableBuffer;
}

export class DXFParser {
  constructor();
  warnings: string[];
  tokenizeSync(dxfString: string): { codes: number[]; values: any[] };
  parse(dxfString: string): Record<string, any>;
}

export class MultiPageTextAtlas {
  constructor(
    fontFamily?: string,
    onVertexAdded?: ((x: number, y: number, z: number) => void) | null,
    nominalPx?: number,
    getPickId?: (() => number) | null,
    pageSize?: number,
    maxPages?: number
  );
  pages: any[];
  textRecords: DXFTextRecord[];
  readonly textAtlasPages: number;
  readonly droppedTextCount: number;
  buildAtlasMeshes(isLightTheme?: boolean): THREE.Mesh[];
  getTotalVertexCount(): number;
}

export class LayerBatchCollector {
  constructor(
    layerName: string,
    displayName: string,
    colorPair: { light: number; dark: number },
    linetype: string,
    visible: boolean,
    originShift: { x: number; y: number; z: number },
    onVertexAdded?: ((x: number, y: number, z: number) => void) | null,
    getPickId?: (() => number) | null,
    creaseAngle?: number
  );
  buildLayerGroup(isLightTheme?: boolean): THREE.Group;
}

export class Float32GrowableBuffer {
  constructor(initialCapacity?: number);
  data: Float32Array;
  length: number;
  toTypedArray(): Float32Array;
}

/**
 * Spatial pick index over a parse result's pickRecords. Keeps point picking and
 * marquee selection at O(candidates) on very large drawings.
 */
export class PickIndex {
  constructor(pickRecords: DXFPickRecord[], options?: { cellPx?: number; worldDivisions?: number });
  records: DXFPickRecord[];
  buildWorldIndex(): this;
  queryWorldBox(box: THREE.Box3): number[];
  queryRay(ray: THREE.Ray, tolerance?: number): number[];
  updateScreen(camera: THREE.Camera, width: number, height: number): this;
  getScreenBox(i: number): { x0: number; y0: number; x1: number; y1: number } | null;
  queryScreenBox(x0: number, y0: number, x1: number, y1: number): Set<number>;
  pickAt(x: number, y: number, options?: { tolerance?: number }): DXFPickRecord | null;
  invalidate(): this;
}

export const ACI_PALETTE: number[];
export const applyBackgroundTheme: typeof DXFLoader.applyBackgroundTheme;
export const decodeAcisData: typeof DXFLoader.decodeAcisData;
export const decodeDXFArrayBuffer: typeof DXFLoader.decodeDXFArrayBuffer;
export const mapCADFontToSystemFont: typeof DXFLoader.mapCADFontToSystemFont;
export const sabBytesToSatLines: typeof DXFLoader.sabBytesToSatLines;
export const resolveAcisSatLines: typeof DXFLoader.resolveAcisSatLines;

export default DXFLoader;
