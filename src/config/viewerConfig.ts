import { DxfLayer, ViewPort, DxfStyle, CanvasTheme, DrawingColorMode, ResolvedUiTheme, UiTheme } from '@/types';
import {
  CAD_DEFAULT_LAYER_COLOR,
  CAD_DEFAULT_LAYER_NAME,
  CAD_DEFAULT_LINE_TYPE_SCALE,
  CAD_DEFAULT_TEXT_STYLE,
} from '@/config/cadConstants';

export const DEFAULT_VIEWPORT: ViewPort = {
  targetX: 0,
  targetY: 0,
  zoom: 1,
};

export const VIEWER_DEFAULTS = {
  language: 'zh' as const,
  uiTheme: 'system' as UiTheme,
  drawingColorMode: 'original' as DrawingColorMode,
  toastDurationMs: 5000,
  defaultLineTypeScale: CAD_DEFAULT_LINE_TYPE_SCALE,
  // 视图停留超过该时间才写入历史，避免滚轮缩放和平移过程中频繁入栈。
  viewHistoryIdleMs: 900,
  // 限制视图历史数量，防止长时间浏览后状态无限增长。
  viewHistoryMaxSize: 50,
  viewHistoryPositionTolerance: 1e-8,
  viewHistoryZoomTolerance: 1e-8,
};

/**
 * 画布背景色跟随 UI 主题：
 * - 浅色 UI  → 白色画布
 * - 深色 UI  → 深色画布
 * 场景背景不再单独暴露为属性，统一由界面主题决定。
 */
/** 获取当前系统外观。 */
export const getSystemUiTheme = (): ResolvedUiTheme => {
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
};

/** 将用户主题设置解析为最终的浅色/深色主题。 */
export const resolveUiTheme = (uiTheme: UiTheme, systemTheme: ResolvedUiTheme = getSystemUiTheme()): ResolvedUiTheme =>
  uiTheme === 'system' ? systemTheme : uiTheme;

export const canvasThemeFromUiTheme = (uiTheme: ResolvedUiTheme): CanvasTheme =>
  uiTheme === 'dark' ? 'black' : 'white';

export const LAYOUT_CONFIG = {
  minViewportWidth: 100,
  minViewportHeight: 100,
  fallbackLayerPanelWidth: 256,
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
  clickMovementTolerancePixels: 8,
  geometryHitTolerancePixels: 20,
  minimumHitToleranceWorld: 1e-10,
  maximumHitToleranceViewportFactor: 0.1,
  // 文字拾取相对几何拾取的容差倍数。原值 2.0 会让文字包围盒过度扩张，
  // 抢占附近几何体的点击；改为 1.0 使文字与几何体按相同容差判定。
  textHitToleranceFactor: 1.0,
  // 点击落在文字包围盒内部时，给文字距离加一个惩罚分（占容差的比例），
  // 这样当点击正好落在几何体上时，几何体（距离≈0）会优先于文字被选中。
  textHitInsidePenaltyFactor: 0.3,
  selectionBorderColor: '#00A8FF',
  selectionBorderWidth: 2,
  selectionControlPointFill: '#00A8FF',
  selectionControlPointSize: 6,
  windowSelectionFill: 'rgba(0, 100, 255, 0.1)',
  windowSelectionBorder: 'rgba(0, 100, 255, 0.5)',
  crossingSelectionFill: 'rgba(0, 255, 100, 0.1)',
  crossingSelectionBorder: 'rgba(0, 255, 100, 0.5)',
  maxNestedEntityDepth: 20,
  infiniteLineHitTestLength: 1000000,
  splineHitTestSegments: 20,
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
  // 宽度系数上限钳制，防止损坏的 DXF 数据导致水平拉伸失控。
  maximumWidthFactor: 100,
  // 文字低于该屏幕高度时直接跳过绘制，不再使用填充占位块。
  // 判定基于真实缩放后的像素高度，避免远距离视图出现固定大小的假文字。
  minimumTextRenderPixelHeight: 0.35,
  // 画布字体大小不允许为 0，极小字号仍保持数值稳定。
  minimumCanvasFontPixelHeight: 0.1,
  // 对齐和适配文字按目标宽度 / 测量宽度做缩放，当测量值在亚像素级别不可靠时
  // 可能产生极端拉伸（巨长文字）。此处对缩放比例做上下限钳制。
  // 收紧上限 40→10：40x 拉伸仍然过于极端，10x 足以覆盖合理的 FIT 文字场景。
  maximumTextFitScale: 10,
  minimumTextFitScale: 0.02,
  averageCharacterWidthFactor: 0.72,
  cjkCharacterWidthFactor: 1.0,
  latinCharacterWidthFactor: 0.58,
  digitCharacterWidthFactor: 0.56,
  punctuationCharacterWidthFactor: 0.34,
  spaceCharacterWidthFactor: 0.32,
  textWidthPaddingFactor: 0.02,
  alphabeticBaselineOffsetFactor: 0.8,
  mtextDefaultLineSpacingFactor: 1.25,
  mtextBackgroundPaddingFactor: 0.1,
  trueTypeFontHeightFactor: 1.28,
  shxFontHeightFactor: 1.0,
  trueTypeRenderWidthFactor: 1.0,
  shxRenderWidthFactor: 1.0,
  cjkRenderWidthFactor: 0.96,
  engineeringShxRenderWidthFactor: 1.0,
  latinTrueTypeRenderWidthFactor: 1.0,
  latinShxRenderWidthFactor: 1.0,
  extentsTrueTypeWidthCompensation: 1.0,
  extentsShxWidthCompensation: 1.0,
  extentsEngineeringShxWidthCompensation: 1.0,
  extentsCjkWidthCompensation: 1.0,
  minimumMeasuredTextWidth: 0.001,
  underlineTopBaselineFactor: 0.9,
  underlineMiddleBaselineFactor: 0.36,
  underlineAlphabeticBaselineFactor: 0.12,
  underlineLineWidthFactor: 0.045,
  mtextLineWidthMeasurePaddingFactor: 1.0,
  mtextActualWidthTrustFactor: 1.35,
  mtextMinimumWrapWidthFactor: 1.5,
  mtextDeclaredWidthToleranceFactor: 0.985,
  mtextMinimumLineHeightFactor: 1.05,
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
