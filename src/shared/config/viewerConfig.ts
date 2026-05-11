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
  averageCharacterWidthFactor: 0.7,
  alphabeticBaselineOffsetFactor: 0.8,
  mtextDefaultLineSpacingFactor: 1.666,
  mtextBackgroundPaddingFactor: 0.1,
  trueTypeFontHeightFactor: 1.33,
  shxFontHeightFactor: 1.4,
  minimumMeasuredTextWidth: 0.001,
  tableTextHeightFactor: 0.5,
  tableTextHorizontalPaddingFactor: 0.1,
  minimumTableCellSize: 0.1,
};
