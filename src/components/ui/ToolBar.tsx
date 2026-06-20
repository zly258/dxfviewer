import React, { useEffect, useRef, useState } from 'react';
import { Language, UI_TRANSLATIONS } from '@/config/i18n';
import { DrawingColorMode, UiTheme } from '@/types';


interface ToolBarProps {
  onImport: (files: File[]) => void;
  onFitView: () => void;
  showOpen?: boolean;
  uiTheme: UiTheme;
  onSetUiTheme: (theme: UiTheme) => void;
  drawingColorMode: DrawingColorMode;
  onSetDrawingColorMode: (mode: DrawingColorMode) => void;
  lang: Language;
  onSetLang: (lang: Language) => void;
  showSidebar: boolean;
  onToggleSidebar: () => void;
  showProperties: boolean;
  onToggleProperties: () => void;
  onShowAbout?: () => void;
}

type MenuKey = 'view';

const ToolBar: React.FC<ToolBarProps> = ({
  onImport,
  onFitView,
  showOpen = true,
  uiTheme,
  onSetUiTheme,
  drawingColorMode,
  onSetDrawingColorMode,
  lang,
  onSetLang,
  showSidebar,
  onToggleSidebar,
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

  const switchMenuOnHover = (menu: MenuKey) => {
    if (activeMenu && activeMenu !== menu) setActiveMenu(menu);
  };

  const closeMenuAndRun = (handler: () => void) => {
    setActiveMenu(null);
    handler();
  };

  const openFileDialog = (event: React.MouseEvent) => {
    event.stopPropagation();
    fileInputRef.current?.click();
    setActiveMenu(null);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    event.target.value = '';
    if (files.length > 0) onImport(files);
  };

  return (
    <div className="toolbar" role="menubar" aria-label={isZh ? '主菜单' : 'Main Menu'}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".dxf"
        multiple
        onChange={handleFileChange}
        className="hidden-file-input"
      />

      {showOpen && (
        <div
          className="menu-item"
          role="menuitem"
          onClick={openFileDialog}
          title={isZh ? '打开 DXF 文件' : 'Open DXF file'}
        >
          <span>{isZh ? '打开' : 'Open'}</span>
        </div>
      )}

      <div
        className={`menu-item ${activeMenu === 'view' ? 'active' : ''}`}
        role="menuitem"
        onClick={(event) => toggleMenu(event, 'view')}
        onMouseEnter={() => switchMenuOnHover('view')}
      >
        <span>{t.view}</span>
        {activeMenu === 'view' && (
          <div className="dropdown-menu" role="menu" onClick={(event) => event.stopPropagation()}>
            <button type="button" onClick={() => closeMenuAndRun(onFitView)} className="dropdown-item">
              <span>{t.fitView}</span>
            </button>
            <div className="divider" />
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
            <button type="button" onClick={() => closeMenuAndRun(onToggleSidebar)} className={`dropdown-item ${showSidebar ? 'checked' : ''}`}>
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
        <div
          className="menu-item"
          role="menuitem"
          onClick={(event) => closeMenuAndRun(onShowAbout)}
        >
          <span>{t.about}</span>
        </div>
      )}
    </div>
  );
};

export default ToolBar;
