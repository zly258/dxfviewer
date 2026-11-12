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
  // 快照平移缩放（性能模式）默认开启；用户可在视图菜单中关闭以换取
  // 交互期间的逐帧精确渲染。
  snapshotMode: true,
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
  fallbackLayerPanelWidth: 272,
  fallbackPropertiesWidth: 340,
  // 与 CSS 变量保持一致：--header-h 42px / --toolbar-h 32px / --footer-h 30px
  fallbackToolbarHeight: 42,
  fallbackStatusBarHeight: 30,
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

/**
 * WebGL 引擎的文字渲染模式：
 * - 'sdf'     —— 字形有向距离场烘焙进 GPU 网格（文字转图形，单画布、可导出）；
 * - 'overlay' —— 几何走 GPU，文字由 Canvas 2D 覆盖层绘制（浏览器原生文本引擎）。
 */
export type TextRenderMode = 'sdf' | 'overlay';
export const TEXT_RENDER_MODE: TextRenderMode = 'sdf';

export const TEXT_RENDER_CONFIG = {
  minimumWidthFactor: 0.01,
  // 宽度系数上限钳制，防止损坏的 DXF 数据导致水平拉伸失控。
  maximumWidthFactor: 100,
  // 文字低于该屏幕高度时直接跳过绘制，不再使用填充占位块。
  // 判定基于真实缩放后的像素高度（CSS px），避免远距离视图出现固定大小的假文字。
  //
  // 取值依据（两个引擎共用同一常量，语义统一为「CSS 像素字高」）：
  // - 旧值 4px 会让超大图纸在充满视图时整幅无文字（图纸跨度大 → 字高 × zoom 常 < 4），
  //   必须放大很多倍才「突然出现」，观感上就是文字丢失；
  // - 1.5px 只过滤真正不可辨认的投影，同时保证充满视图时仍能看到文字分布，
  //   与 CAD 的「缩小看全图仍保留文字」一致；
  // - 再低（<1px）只会画出无法辨识的亚像素墨块，收益为负。
  minimumTextRenderPixelHeight: 1.5,
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
  // MTEXT 缺省行距：AutoCAD 的"行距倍数 1.0"= 字高的 5/3 ≈ 1.66×
  // （DXF 组码 73/44 的倍数以"一个行距"为单位，一个行距 = 1.66×字高）。
  // 旧值 1.25 使多行文字行距比 AutoCAD 偏小约 25%。
  mtextDefaultLineSpacingFactor: 1.66,
  mtextBackgroundPaddingFactor: 0.1,
  // DXF 组码 40 的"字高"是 cap height（大写字母高度）语义；Canvas 的
  // font size 是 em size。换算系数 = 1/capRatio：典型 CAD 字体（gbenor/
  // SimSun/Arial）的 capHeight ≈ 0.70~0.73em → 系数 ≈ 1.39。
  // 旧值 1.28 使文字比 AutoCAD 偏小约 12%（实测用户反馈）。
  trueTypeFontHeightFactor: 1.39,
  // 中文（CJK）字形墨迹约占 0.88em：em = 字高 / 0.88 ≈ 1.14。
  // 若沿用拉丁的 1.39，中文会比 CAD 字高大 22%（实测"高度超出"）。
  cjkFontHeightFactor: 1.14,
  shxFontHeightFactor: 1.0,
  trueTypeRenderWidthFactor: 1.0,
  shxRenderWidthFactor: 1.0,
  cjkRenderWidthFactor: 0.88,
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
  outlierSizeMedianMultiplier: 80,
  outlierAspectRatioLimit: 25,
  // 离群实体只能是极少数：最多剔除该比例（且至少 1 个）。
  // 图纸内容（图框/标题栏/尺寸）本身分布很广，超预算时宁可不剪。
  outlierMaxDropRatio: 0.03,
  // 距离排序尾部出现该倍数的跳变时才截断（正常图纸尾部是平滑分布）。
  outlierMinimumDistanceGapRatio: 4,
  // 「超长瘦高包围盒」还必须是离主体这么远（相对中位中心距离）才判为残留引导线。
  outlierStrayDistanceFactor: 4,
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

export const INTERACTION_CONFIG = {
  wheelZoomFactor: 1.2,
  touchMoveThresholdPixels: 6,
  touchLongPressDelayMs: 560,
  touchTapMaxDurationMs: 300,
  touchHitToleranceMultiplier: 2.5,
  // 交互（平移/缩放）停止后多久触发一次渲染（防抖）。
  // 交互期间画布保持上一帧（平移为精确位移贴图，缩放保持不动），
  // 停止后在离屏画布一次性渲染当前屏幕范围，完成后原子呈现。
  interactionRefineDelayMs: 150,
};

/**
 * LOD（细节层次）剔除：
 * 屏幕投影尺寸低于阈值的实体在当前缩放下不可辨认，直接跳过绘制。
 * 这是 CAD 处理"缩小看全图"场景的核心手段——全图视图下万级实体中
 * 大量图元的投影不足 1 像素，逐个 stroke 的开销远大于其视觉价值。
 */
export const LOD_RENDER_CONFIG = {
  /** 实体包围盒投影宽高均低于该像素值时跳过绘制。 */
  minimumEntityScreenSizePixels: 1,
};

/**
 * 侧栏宽度：与 web-ui-style R9 的三栏骨架一致 ——
 * 左栏 clamp(250px, 22vw, 320px)、右栏 clamp(320px, 27vw, 440px)。
 * 用户仍可拖拽调整，但被约束在同一区间内。
 */
export const PANEL_CONFIG = {
  layerPanelMinWidth: 250,
  layerPanelMaxWidth: 320,
  layerPanelViewportRatio: 0.22,
  layerPanelInitialWidth: 272,
  propertiesPanelMinWidth: 320,
  propertiesPanelMaxWidth: 440,
  propertiesPanelViewportRatio: 0.27,
  propertiesPanelInitialWidth: 340,
};

/** 按 clamp(min, ratio*vw, max) 计算侧栏初始宽度。 */
export const clampPanelWidth = (min: number, ratio: number, max: number): number => {
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1600;
  return Math.round(Math.min(max, Math.max(min, viewportWidth * ratio)));
};

export const CONTEXT_MENU_CONFIG = {
  desktopWidth: 156,
  desktopHeight: 174,
  mobileWidth: 160,
  mobileHeight: 196,
  padding: 6,
  mobilePadding: 10,
};

export const TABS_CONFIG = {
  denseThreshold: 18,
  compactThreshold: 10,
  scrollStep: 240,
};

export const BREAKPOINTS = {
  mobile: 768,
};


