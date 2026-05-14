import { DxfLayer, ViewPort, DxfStyle } from '../../types';
import { CanvasTheme, DrawingColorMode } from '../types/ui';
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
  drawingColorMode: 'original' as DrawingColorMode,
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


export const SHORTCUT_CONFIG = {
  openFileKey: 'o',
  fitViewKeys: ['f', '0'],
  clearSelectionKey: 'Escape',
  middleButton: 1,
  middleDoubleClickDelayMs: 320,
  middleDoubleClickDistancePixels: 8,
};

export const TEXT_DECODER_CONFIG = {
  primaryEncoding: 'utf-8',
  fallbackEncoding: 'gb18030',
};

export const CANVAS_THEME_COLORS: Record<CanvasTheme, string> = {
  black: '#212121',
  white: '#FFFFFF',
};

export const MONOCHROME_ENTITY_COLORS: Record<CanvasTheme, string> = {
  black: '#FFFFFF',
  white: '#000000',
};


export const SELECTION_CONFIG = {
  color: '#0078d4',
  textThresholdMultiplier: 2.0,
  clickMovementTolerancePixels: 4,
  geometryHitTolerancePixels: 10,
  minimumHitToleranceWorld: 1e-12,
  maximumHitToleranceViewportFactor: 0.012,
  gripSize: 2.5,
  leaderHookLength: 2.5,
  windowSelectionFill: 'rgba(0, 120, 212, 0.1)',
  windowSelectionBorder: '#0078d4',
  crossingSelectionFill: 'rgba(0, 255, 0, 0.1)',
  crossingSelectionBorder: '#00ff00',
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
  trueTypeFontHeightFactor: 1.28,
  shxFontHeightFactor: 1.0,
  trueTypeRenderWidthFactor: 1.0,
  shxRenderWidthFactor: 1.0,
  cjkRenderWidthFactor: 0.96,
  engineeringShxRenderWidthFactor: 1.0,
  latinTrueTypeRenderWidthFactor: 1.0,
  latinShxRenderWidthFactor: 0.86,
  extentsTrueTypeWidthCompensation: 1.0,
  extentsShxWidthCompensation: 1.0,
  extentsEngineeringShxWidthCompensation: 1.0,
  minimumMeasuredTextWidth: 0.001,
  underlineTopBaselineFactor: 0.9,
  underlineMiddleBaselineFactor: 0.36,
  underlineAlphabeticBaselineFactor: 0.12,
  underlineLineWidthFactor: 0.045,
  mtextLineWidthMeasurePaddingFactor: 1.0,
  mtextActualWidthTrustFactor: 1.35,
  mtextMinimumWrapWidthFactor: 1.5,
  mtextLineSpacingMinFactor: 0.5,
  mtextLineSpacingMaxFactor: 3.0,
  tableTextHeightFactor: 0.5,
  tableTextHorizontalPaddingFactor: 0.1,
  minimumTableCellSize: 0.1,
  placeholderAttributeCoordinateTolerance: 1e-9,
  placeholderAttributeHeightThreshold: 100,
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
  outlierFilterMinEntityCount: 6,
  outlierCenterMadMultiplier: 8,
  outlierSizeMedianMultiplier: 80,
  outlierAspectRatioLimit: 25,
};

export const LINE_RENDER_CONFIG = {
  defaultLineweight: 25,
  byBlockLineweight: -2,
  byLayerLineweight: -1,
  defaultLineweightCode: -3,
  minimumScreenLineWidth: 0.5,
  maximumScreenLineWidth: 4,
  selectedLineWidthBoost: 1.5,
  selectedMaximumScreenLineWidth: 8,
  cadLineweightToPixelFactor: 25,
  minimumDashPatternPixels: 2,
  minimumDashSegmentPixels: 1.5,
  dotDashPixelLength: 1.5,
};

export const LEADER_RENDER_CONFIG = {
  defaultHookLength: 2.5,
  annotationGapFactor: 0.3,
  arrowSizeFactor: 2.5,
  arrowHalfAngleRadians: Math.PI / 6,
  defaultMLeaderTextHeight: 2.5,
  defaultMLeaderTextWidth: 80,
  defaultMLeaderDoglegLength: 4,
  mleaderTextGapFactor: 0.8,
  leaderAnnotationTextGapFactor: 0.5,
};
