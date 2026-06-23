import React, { useEffect, useRef, useState } from 'react';
import { Language, UI_TRANSLATIONS } from '@/config/i18n';
import { DrawingColorMode, UiTheme } from '@/types';
import ViewerIcon, { ViewerIconName } from '@/components/viewer/ViewerIcon';

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
  const t = UI_TRANSLATIONS[lang];
  const isZh = lang === 'zh';

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
    <div className="toolbar" role="toolbar" aria-label={isZh ? '查看器工具栏' : 'Viewer toolbar'}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".dxf"
        multiple
        onChange={handleFileChange}
        className="hidden-file-input"
      />

      {showOpen && renderToolButton('open', t.openFile, openFileDialog)}
      {showOpen && <div className="toolbar-separator" role="separator" />}

      {renderToolButton('previous', t.previousView, onPreviousView, !canGoPreviousView)}
      {renderToolButton('next', t.nextView, onNextView, !canGoNextView)}
      {renderToolButton('fit', t.fitView, onFitView)}

      <div className="toolbar-separator" role="separator" />

      {renderToolButton('search', isZh ? '搜索文字' : 'Search text', onToggleSearch, false, isSearchActive)}

      <div className="toolbar-separator" role="separator" />

      <div className={`toolbar-menu ${activeMenu === 'view' ? 'active' : ''}`}>
        <button
          type="button"
          className="toolbar-button toolbar-icon-button"
          onClick={(event) => toggleMenu(event, 'view')}
          title={t.view}
          aria-label={t.view}
          aria-haspopup="menu"
          aria-expanded={activeMenu === 'view'}
        >
          <span className="toolbar-icon" aria-hidden="true"><ViewerIcon name="view" /></span>
        </button>
        {activeMenu === 'view' && (
          <div className="dropdown-menu" role="menu" onClick={(event) => event.stopPropagation()}>
            <button type="button" onClick={() => closeMenuAndRun(() => onSetUiTheme('system'))} className={`dropdown-item ${uiTheme === 'system' ? 'checked' : ''}`}>
              <span>{t.system}</span>
            </button>
            <button type="button" onClick={() => closeMenuAndRun(() => onSetUiTheme('light'))} className={`dropdown-item ${uiTheme === 'light' ? 'checked' : ''}`}>
              <span>{t.light}</span>
            </button>
            <button type="button" onClick={() => closeMenuAndRun(() => onSetUiTheme('dark'))} className={`dropdown-item ${uiTheme === 'dark' ? 'checked' : ''}`}>
              <span>{t.dark}</span>
            </button>
            <div className="divider" />
            <button
              type="button"
              onClick={() => closeMenuAndRun(() => onSetDrawingColorMode(drawingColorMode === 'monochrome' ? 'original' : 'monochrome'))}
              className={`dropdown-item ${drawingColorMode === 'monochrome' ? 'checked' : ''}`}
            >
              <span>{t.monochrome}</span>
            </button>
            <div className="divider" />
            <button type="button" onClick={() => closeMenuAndRun(onToggleLayerPanel)} className={`dropdown-item ${showLayerPanel ? 'checked' : ''}`}>
              <span>{t.layers}</span>
            </button>
            <button type="button" onClick={() => closeMenuAndRun(onToggleProperties)} className={`dropdown-item ${showProperties ? 'checked' : ''}`}>
              <span>{t.properties}</span>
            </button>
            <div className="divider" />
            <button type="button" onClick={() => closeMenuAndRun(() => onSetLang(lang === 'zh' ? 'en' : 'zh'))} className="dropdown-item">
              <span>{t.language}: {lang === 'zh' ? 'English' : '简体中文'}</span>
            </button>
          </div>
        )}
      </div>

      {onShowAbout && (
        <>
          <div className="toolbar-separator" role="separator" />
          {renderToolButton('about', t.about, () => closeMenuAndRun(onShowAbout))}
        </>
      )}
    </div>
  );
};

export default ViewerToolbar;
