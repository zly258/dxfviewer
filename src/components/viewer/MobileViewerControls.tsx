import React, { useState } from 'react';
import { Language, UI_TRANSLATIONS } from '@/config/i18n';
import { DxfLayout, DrawingColorMode, UiTheme } from '@/types';
import ViewerIcon, { ViewerIconName } from '@/components/viewer/ViewerIcon';

export interface MobileViewerControlsProps {
  lang: Language;
  showOpen: boolean;
  onOpen: () => void;
  onFitView: () => void;
  onPreviousView: () => void;
  onNextView: () => void;
  onToggleSearch: () => void;
  isSearchActive: boolean;
  canGoPreviousView: boolean;
  canGoNextView: boolean;
  uiTheme: UiTheme;
  onSetUiTheme: (t: UiTheme) => void;
  drawingColorMode: DrawingColorMode;
  onSetDrawingColorMode: (m: DrawingColorMode) => void;
  onSetLang: (l: Language) => void;
  onShowAbout: () => void;
  mouseCoords: { x: number; y: number };
  selectedCount: number;
  layerPanelContent: React.ReactNode;
  propertiesContent: React.ReactNode;
  layouts: DxfLayout[];
  activeLayoutName: string;
  onSelectLayout: (layoutName: string) => void;
}

type MobilePanel = 'layers' | 'properties' | 'view';

interface MobileToolButtonProps {
  icon: ViewerIconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}

const MobileToolButton: React.FC<MobileToolButtonProps> = ({ icon, label, onClick, disabled = false, active = false }) => (
  <button
    type="button"
    className={`mobile-tool-button ${active ? 'active' : ''}`}
    onClick={onClick}
    disabled={disabled}
    title={label}
    aria-label={label}
    aria-pressed={active}
  >
    <ViewerIcon name={icon} />
  </button>
);

const nextTheme = (theme: UiTheme): UiTheme => {
  if (theme === 'system') return 'light';
  if (theme === 'light') return 'dark';
  return 'system';
};

const MobileViewerControls: React.FC<MobileViewerControlsProps> = ({
  lang,
  showOpen,
  onOpen,
  onFitView,
  onPreviousView,
  onNextView,
  onToggleSearch,
  isSearchActive,
  canGoPreviousView,
  canGoNextView,
  uiTheme,
  onSetUiTheme,
  drawingColorMode,
  onSetDrawingColorMode,
  onSetLang,
  onShowAbout,
  mouseCoords,
  selectedCount,
  layerPanelContent,
  propertiesContent,
  layouts,
  activeLayoutName,
  onSelectLayout,
}) => {
  const t = UI_TRANSLATIONS[lang];
  const isZh = lang === 'zh';
  const [activePanel, setActivePanel] = useState<MobilePanel | null>(null);

  const togglePanel = (panel: MobilePanel) => {
    setActivePanel(current => (current === panel ? null : panel));
  };

  const closePanel = () => setActivePanel(null);

  const showViewPanelTitle = isZh ? '视图设置' : 'View Settings';

  return (
    <>
      <div className="mobile-coord-chip" aria-live="polite">
        <span>X {mouseCoords.x.toFixed(2)}</span>
        <span>Y {mouseCoords.y.toFixed(2)}</span>
        {selectedCount > 0 && <span className="coord-selected">· {selectedCount}</span>}
      </div>

      <div className="mobile-right-toolbar" role="toolbar" aria-label={isZh ? '移动端工具栏' : 'Mobile toolbar'}>
        {showOpen && <MobileToolButton icon="open" label={t.openFile} onClick={onOpen} />}
        {showOpen && <div className="mobile-tool-separator" role="separator" />}
        <MobileToolButton icon="search" label={isZh ? '搜索文字' : 'Search Text'} onClick={onToggleSearch} active={isSearchActive} />
        <MobileToolButton icon="previous" label={t.previousView} onClick={onPreviousView} disabled={!canGoPreviousView} />
        <MobileToolButton icon="next" label={t.nextView} onClick={onNextView} disabled={!canGoNextView} />
        <MobileToolButton icon="fit" label={t.fitView} onClick={onFitView} />
        <div className="mobile-tool-separator" role="separator" />
        <MobileToolButton icon="layers" label={t.layers} onClick={() => togglePanel('layers')} active={activePanel === 'layers'} />
        <MobileToolButton icon="properties" label={t.properties} onClick={() => togglePanel('properties')} active={activePanel === 'properties'} />
        <MobileToolButton icon="view" label={showViewPanelTitle} onClick={() => togglePanel('view')} active={activePanel === 'view'} />
        <MobileToolButton icon="about" label={t.about} onClick={() => { closePanel(); onShowAbout(); }} />
      </div>

      {activePanel && <div className="mobile-side-backdrop" onClick={closePanel} />}

      <aside className={`mobile-side-panel ${activePanel ? 'open' : ''}`} aria-hidden={!activePanel}>
        <div className="mobile-side-panel-header">
          <span>
            {activePanel === 'layers' && t.layers}
            {activePanel === 'properties' && t.properties}
            {activePanel === 'view' && showViewPanelTitle}
          </span>
          <button type="button" className="mobile-side-close" onClick={closePanel} aria-label={isZh ? '关闭' : 'Close'}>
            <ViewerIcon name="close" />
          </button>
        </div>
        <div className="mobile-side-panel-content">
          {activePanel === 'layers' && layerPanelContent}
          {activePanel === 'properties' && propertiesContent}
          {activePanel === 'view' && (
            <div className="mobile-view-list">
              <button type="button" className="mobile-view-item" onClick={() => onSetUiTheme(nextTheme(uiTheme))}>
                <ViewerIcon name="theme" />
                <span>{uiTheme === 'system' ? t.system : uiTheme === 'light' ? t.light : t.dark}</span>
              </button>
              <button type="button" className={`mobile-view-item ${drawingColorMode === 'monochrome' ? 'checked' : ''}`} onClick={() => onSetDrawingColorMode(drawingColorMode === 'monochrome' ? 'original' : 'monochrome')}>
                <ViewerIcon name="monochrome" />
                <span>{t.monochrome}</span>
              </button>
              <button type="button" className="mobile-view-item" onClick={() => onSetLang(lang === 'zh' ? 'en' : 'zh')}>
                <ViewerIcon name="language" />
                <span>{t.language}: {lang === 'zh' ? 'English' : '简体中文'}</span>
              </button>
              {layouts.length > 1 && (
                <>
                  <div className="mobile-view-section-title">{isZh ? '空间' : 'Space'}</div>
                  {layouts.map(layout => {
                    const label = layout.isModel ? (isZh ? '模型' : 'Model') : (layout.displayName || layout.name);
                    return (
                      <button
                        key={layout.name}
                        type="button"
                        className={`mobile-view-item ${activeLayoutName === layout.name ? 'checked' : ''}`}
                        onClick={() => onSelectLayout(layout.name)}
                      >
                        <ViewerIcon name="layout" />
                        <span>{label}</span>
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
};

export default MobileViewerControls;
