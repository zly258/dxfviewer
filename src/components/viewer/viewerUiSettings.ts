import { DrawingColorMode, UiTheme } from '@/types';
import { Language } from '@/config/i18n';

export interface ViewerUiSettings {
  uiTheme?: UiTheme;
  drawingColorMode?: DrawingColorMode;
  language?: Language;
  showLayerPanel?: boolean;
  showSidebar?: boolean;
  showProperties?: boolean;
}

export const VIEWER_UI_SETTINGS_KEY = 'dxfviewer.uiSettings.v1';

export const readViewerUiSettings = (): ViewerUiSettings => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(VIEWER_UI_SETTINGS_KEY);
    return raw ? JSON.parse(raw) as ViewerUiSettings : {};
  } catch {
    return {};
  }
};

export const writeViewerUiSettings = (settings: ViewerUiSettings) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(VIEWER_UI_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // 浏览器隐私模式或配额限制时忽略保存失败，不影响查看器运行。
  }
};
