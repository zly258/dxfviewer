import React, { useEffect, useRef, useState } from 'react';
import { Language, UI_TRANSLATIONS, t } from '@/config/i18n';
import { DrawingColorMode, UiTheme } from '@/types';
import ViewerIcon, { ViewerIconName } from '@/components/common/ViewerIcon';

interface ViewerToolbarProps {
  onImport: (files: File[]) => void;
  onFitView: () => void;
  onPreviousView: () => void;
  onNextView: () => void;
  onToggleSearch: () => void;
  isSearchActive: boolean;
  canGoPreviousView: boolean;
  canGoNextView: boolean;
  showOpen?: boolean;
  uiTheme: UiTheme;
  onSetUiTheme: (theme: UiTheme) => void;
  drawingColorMode: DrawingColorMode;
  onSetDrawingColorMode: (mode: DrawingColorMode) => void;
  lang: Language;
  onSetLang: (lang: Language) => void;
  showLayerPanel: boolean;
  onToggleLayerPanel: () => void;
  showProperties: boolean;
  onToggleProperties: () => void;
  onShowAbout?: () => void;
}

type MenuKey = 'view';

/** 顶部工具栏只保留常用文件、视图、搜索、设置和关于入口，主题/语言/黑白模式放入视图菜单。 */
const ViewerToolbar: React.FC<ViewerToolbarProps> = ({
  onImport,
  onFitView,
  onPreviousView,
  onNextView,
  onToggleSearch,
  isSearchActive,
  canGoPreviousView,
  canGoNextView,
  showOpen = true,
  uiTheme,
  onSetUiTheme,
  drawingColorMode,
  onSetDrawingColorMode,
  lang,
  onSetLang,
  showLayerPanel,
  onToggleLayerPanel,
  showProperties,
  onToggleProperties,
  onShowAbout
}) => {
  const [activeMenu, setActiveMenu] = useState<MenuKey | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tt = UI_TRANSLATIONS[lang];

  useEffect(() => {
    if (!activeMenu) return;
    const closeMenu = () => setActiveMenu(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, [activeMenu]);

  const toggleMenu = (event: React.MouseEvent, menu: MenuKey) => {
    event.stopPropagation();
    setActiveMenu(activeMenu === menu ? null : menu);
  };

  const closeMenuAndRun = (handler: () => void) => {
    setActiveMenu(null);
    handler();
  };

  const openFileDialog = () => {
    fileInputRef.current?.click();
    setActiveMenu(null);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    event.target.value = '';
    if (files.length > 0) onImport(files);
  };

  const renderToolButton = (
    icon: ViewerIconName,
    label: string,
    onClick: () => void,
    disabled = false,
    active = false,
  ) => (
    <button
      type="button"
      className={`toolbar-button toolbar-icon-button ${active ? 'active' : ''}`}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
    >
      <span className="toolbar-icon" aria-hidden="true"><ViewerIcon name={icon} /></span>
    </button>
  );

  return (
    <div className="toolbar" role="toolbar" aria-label={t(lang, 'viewerToolbar')}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".dxf"
        multiple
        onChange={handleFileChange}
        className="hidden-file-input"
      />

      {showOpen && renderToolButton('open', tt.openFile, openFileDialog)}
      {showOpen && <div className="toolbar-separator" role="separator" />}

      {renderToolButton('previous', tt.previousView, onPreviousView, !canGoPreviousView)}
      {renderToolButton('next', tt.nextView, onNextView, !canGoNextView)}
      {renderToolButton('fit', tt.fitView, onFitView)}

      <div className="toolbar-separator" role="separator" />

      {renderToolButton('search', t(lang, 'searchText'), onToggleSearch, false, isSearchActive)}

      <div className="toolbar-separator" role="separator" />

      <div className={`toolbar-menu ${activeMenu === 'view' ? 'active' : ''}`}>
        <button
          type="button"
          className="toolbar-button toolbar-icon-button"
          onClick={(event) => toggleMenu(event, 'view')}
          title={tt.view}
          aria-label={tt.view}
          aria-haspopup="menu"
          aria-expanded={activeMenu === 'view'}
        >
          <span className="toolbar-icon" aria-hidden="true"><ViewerIcon name="view" /></span>
        </button>
        {activeMenu === 'view' && (
          <div className="dropdown-menu" role="menu" onClick={(event) => event.stopPropagation()}>
            <button type="button" onClick={() => closeMenuAndRun(() => onSetUiTheme('system'))} className={`dropdown-item ${uiTheme === 'system' ? 'checked' : ''}`}>
              <span>{tt.system}</span>
            </button>
            <button type="button" onClick={() => closeMenuAndRun(() => onSetUiTheme('light'))} className={`dropdown-item ${uiTheme === 'light' ? 'checked' : ''}`}>
              <span>{tt.light}</span>
            </button>
            <button type="button" onClick={() => closeMenuAndRun(() => onSetUiTheme('dark'))} className={`dropdown-item ${uiTheme === 'dark' ? 'checked' : ''}`}>
              <span>{tt.dark}</span>
            </button>
            <div className="divider" />
            <button
              type="button"
              onClick={() => closeMenuAndRun(() => onSetDrawingColorMode(drawingColorMode === 'monochrome' ? 'original' : 'monochrome'))}
              className={`dropdown-item ${drawingColorMode === 'monochrome' ? 'checked' : ''}`}
            >
              <span>{tt.monochrome}</span>
            </button>
            <div className="divider" />
            <button type="button" onClick={() => closeMenuAndRun(onToggleLayerPanel)} className={`dropdown-item ${showLayerPanel ? 'checked' : ''}`}>
              <span>{tt.layers}</span>
            </button>
            <button type="button" onClick={() => closeMenuAndRun(onToggleProperties)} className={`dropdown-item ${showProperties ? 'checked' : ''}`}>
              <span>{tt.properties}</span>
            </button>
            <div className="divider" />
            <button type="button" onClick={() => closeMenuAndRun(() => onSetLang(lang === 'zh' ? 'en' : 'zh'))} className="dropdown-item">
              <span>{tt.language}: {lang === 'zh' ? 'English' : '简体中文'}</span>
            </button>
          </div>
        )}
      </div>

      {onShowAbout && (
        <>
          <div className="toolbar-separator" role="separator" />
          {renderToolButton('about', tt.about, () => closeMenuAndRun(onShowAbout))}
        </>
      )}
    </div>
  );
};

export default ViewerToolbar;
