import { DxfLayer, ViewPort, DxfStyle } from '../../types';
import { CanvasTheme } from '../types/ui';
import {
  CAD_DEFAULT_LAYER_COLOR,
  CAD_DEFAULT_LAYER_NAME,
  CAD_DEFAULT_LINE_TYPE_SCALE,
  CAD_DEFAULT_TEXT_STYLE,
} from '../constants/cadConstants';

export const DEFAULT_VIEWPORT: ViewPort = {
  targetX: 0,
  targetY: 0,
  zoom: 1,
};

export const VIEWER_DEFAULTS = {
  language: 'zh' as const,
  uiTheme: 'light' as const,
  canvasTheme: 'black' as CanvasTheme,
  toastDurationMs: 5000,
  defaultLineTypeScale: CAD_DEFAULT_LINE_TYPE_SCALE,
};

export const LAYOUT_CONFIG = {
  minViewportWidth: 100,
  minViewportHeight: 100,
  fallbackSidebarWidth: 256,
  fallbackPropertiesWidth: 320,
  fallbackToolbarHeight: 30,
  fallbackStatusBarHeight: 24,
};

export const ZOOM_CONFIG = {
  fitViewMarginFactor: 0.98,
  singleEntityMarginFactor: 0.9,
  minZoom: 1e-50,
  maxZoom: 1e20,
  maxSingleEntityZoom: 1000000,
};

export const TEXT_DECODER_CONFIG = {
  primaryEncoding: 'utf-8',
  fallbackEncoding: 'gb18030',
};

export const CANVAS_THEME_COLORS: Record<CanvasTheme, string> = {
  black: '#212121',
  white: '#FFFFFF',
  gray: '#808080',
};

export const FALLBACK_DRAWING_COLORS: Record<CanvasTheme, string> = {
  black: '#FFFFFF',
  white: '#000000',
  gray: '#FFFFFF',
};

export const SELECTION_CONFIG = {
  color: '#0078d4',
  textThresholdMultiplier: 2.5,
  gripSize: 2.5,
  leaderHookLength: 2.5,
};

export const DEFAULT_LAYER: DxfLayer = {
  name: CAD_DEFAULT_LAYER_NAME,
  color: CAD_DEFAULT_LAYER_COLOR,
};

export const DEFAULT_TEXT_STYLE: DxfStyle = {
  name: CAD_DEFAULT_TEXT_STYLE,
  fontFileName: 'txt',
  height: 0,
  widthFactor: 1,
};

export const DEFAULT_ENTITY_COLOR = '#FFFFFF';

export const TEXT_RENDER_CONFIG = {
  minimumWidthFactor: 0.01,
  tinyTextPixelHeight: 3,
  averageCharacterWidthFactor: 0.72,
  cjkCharacterWidthFactor: 1.0,
  latinCharacterWidthFactor: 0.58,
  digitCharacterWidthFactor: 0.56,
  punctuationCharacterWidthFactor: 0.34,
  spaceCharacterWidthFactor: 0.28,
  textWidthPaddingFactor: 0.02,
  alphabeticBaselineOffsetFactor: 0.8,
  mtextDefaultLineSpacingFactor: 1.666,
  mtextBackgroundPaddingFactor: 0.1,
  trueTypeFontHeightFactor: 1.33,
  shxFontHeightFactor: 1.4,
  trueTypeRenderWidthFactor: 0.96,
  shxRenderWidthFactor: 0.84,
  cjkRenderWidthFactor: 0.92,
  extentsTrueTypeWidthCompensation: 1.0,
  extentsShxWidthCompensation: 0.92,
  minimumMeasuredTextWidth: 0.001,
  tableTextHeightFactor: 0.5,
  tableTextHorizontalPaddingFactor: 0.1,
  minimumTableCellSize: 0.1,
};


export const TABLE_EXTENTS_CONFIG = {
  defaultRowHeight: 10,
  defaultColumnWidth: 50,
  minRowHeight: 0.1,
  minColumnWidth: 0.1,
  maxRowHeight: 10000,
  maxColumnWidth: 100000,
  maxFallbackRows: 200,
  maxFallbackColumns: 100,
  maxFallbackTotalWidth: 20000,
  maxFallbackTotalHeight: 20000,
  maxFallbackAspectRatio: 20,
};

export const EXTENTS_CONFIG = {
  minGeometryEntityCountForStableDrawingExtents: 1,
  maxFiniteCoordinate: 1e50,
  maxFiniteExtent: 1e50,
  minimumEntitySize: 1e-9,
  infiniteGuideLength: 1000,
  dimensionLocalBlockDistanceFactor: 5,
  useSmartExtentWhenEntityCountAtLeast: 8,
  smartExtentOutlierRatioLimit: 80,
  smartExtentIqrMultiplier: 2.5,
  ignoreGuideLinesInDrawingExtents: true,
  includePointsInDrawingExtents: false,
  minDrawableEntityExtent: 1e-8,
  annotationNearGeometryFactor: 3,
  annotationNearGeometryMinimumPadding: 100,
};

export const LEADER_RENDER_CONFIG = {
  defaultHookLength: 2.5,
  annotationGapFactor: 0.3,
  arrowSizeFactor: 2.5,
  arrowHalfAngleRadians: Math.PI / 6,
};
