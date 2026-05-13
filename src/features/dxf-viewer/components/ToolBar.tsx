import React, { useEffect, useRef, useState } from 'react';
import { Language, UI_TRANSLATIONS } from '../../../constants/i18n';
import { CanvasTheme, DrawingColorMode, UiTheme } from '../../../shared/types/ui';

interface ToolBarProps {
  onImport: (files: File[]) => void;
  onClear: () => void;
  onFitView: () => void;
  showDrawingExtents: boolean;
  onToggleDrawingExtents: () => void;
  showSidebar: boolean;
  onToggleSidebar: () => void;
  showProperties: boolean;
  onToggleProperties: () => void;
  showOpen?: boolean;
  uiTheme: UiTheme;
  onSetUiTheme: (theme: UiTheme) => void;
  canvasTheme: CanvasTheme;
  onSetCanvasTheme: (theme: CanvasTheme) => void;
  drawingColorMode: DrawingColorMode;
  onSetDrawingColorMode: (mode: DrawingColorMode) => void;
  lang: Language;
  onSetLang: (lang: Language) => void;
}

type MenuKey = 'file' | 'interface' | 'view';

const ToolBar: React.FC<ToolBarProps> = ({
  onImport,
  onClear,
  onFitView,
  showDrawingExtents,
  onToggleDrawingExtents,
  showSidebar,
  onToggleSidebar,
  showProperties,
  onToggleProperties,
  showOpen = true,
  uiTheme,
  onSetUiTheme,
  canvasTheme,
  onSetCanvasTheme,
  drawingColorMode,
  onSetDrawingColorMode,
  lang,
  onSetLang,
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
          className={`menu-item ${activeMenu === 'file' ? 'active' : ''}`}
          role="menuitem"
          onClick={(event) => toggleMenu(event, 'file')}
          onMouseEnter={() => switchMenuOnHover('file')}
        >
          <span>{isZh ? '文件' : 'File'}</span>
          {activeMenu === 'file' && (
            <div className="dropdown-menu" role="menu" onClick={(event) => event.stopPropagation()}>
              <button type="button" onClick={openFileDialog} className="dropdown-item">
                <span>{isZh ? '打开 DXF...' : 'Open DXF...'}</span>
              </button>
              <button type="button" onClick={() => closeMenuAndRun(onClear)} className="dropdown-item">
                <span>{isZh ? '清空当前图纸' : 'Clear Current Drawing'}</span>
              </button>
            </div>
          )}
        </div>
      )}

      <div
        className={`menu-item ${activeMenu === 'interface' ? 'active' : ''}`}
        role="menuitem"
        onClick={(event) => toggleMenu(event, 'interface')}
        onMouseEnter={() => switchMenuOnHover('interface')}
      >
        <span>{isZh ? '界面' : 'Interface'}</span>
        {activeMenu === 'interface' && (
          <div className="dropdown-menu" role="menu" onClick={(event) => event.stopPropagation()}>
            <div className="dropdown-header">{isZh ? '面板' : 'Panels'}</div>
            <button type="button" onClick={() => closeMenuAndRun(onToggleSidebar)} className={`dropdown-item ${showSidebar ? 'checked' : ''}`}>
              <span>{t.layers}</span>
            </button>
            <button type="button" onClick={() => closeMenuAndRun(onToggleProperties)} className={`dropdown-item ${showProperties ? 'checked' : ''}`}>
              <span>{t.properties}</span>
            </button>
            <div className="divider" />
            <div className="dropdown-header">{isZh ? '主题' : 'Theme'}</div>
            <button type="button" onClick={() => closeMenuAndRun(() => onSetUiTheme('light'))} className={`dropdown-item ${uiTheme === 'light' ? 'checked' : ''}`}>
              <span>{isZh ? '浅色' : 'Light'}</span>
            </button>
            <button type="button" onClick={() => closeMenuAndRun(() => onSetUiTheme('dark'))} className={`dropdown-item ${uiTheme === 'dark' ? 'checked' : ''}`}>
              <span>{isZh ? '深色' : 'Dark'}</span>
            </button>
            <div className="divider" />
            <div className="dropdown-header">{isZh ? '背景' : 'Background'}</div>
            <button type="button" onClick={() => closeMenuAndRun(() => onSetCanvasTheme('black'))} className={`dropdown-item ${canvasTheme === 'black' ? 'checked' : ''}`}>
              <span>{isZh ? '黑色背景' : 'Black Background'}</span>
            </button>
            <button type="button" onClick={() => closeMenuAndRun(() => onSetCanvasTheme('white'))} className={`dropdown-item ${canvasTheme === 'white' ? 'checked' : ''}`}>
              <span>{isZh ? '白色背景' : 'White Background'}</span>
            </button>
            <div className="divider" />
            <button type="button" onClick={() => closeMenuAndRun(() => onSetLang(lang === 'zh' ? 'en' : 'zh'))} className="dropdown-item">
              <span>{t.language}: {lang === 'zh' ? 'English' : '简体中文'}</span>
            </button>
          </div>
        )}
      </div>

      <div
        className={`menu-item ${activeMenu === 'view' ? 'active' : ''}`}
        role="menuitem"
        onClick={(event) => toggleMenu(event, 'view')}
        onMouseEnter={() => switchMenuOnHover('view')}
      >
        <span>{isZh ? '视图' : 'View'}</span>
        {activeMenu === 'view' && (
          <div className="dropdown-menu" role="menu" onClick={(event) => event.stopPropagation()}>
            <button type="button" onClick={() => closeMenuAndRun(onFitView)} className="dropdown-item">
              <span>{t.fitView}</span>
            </button>
            <button type="button" onClick={() => closeMenuAndRun(onToggleDrawingExtents)} className={`dropdown-item ${showDrawingExtents ? 'checked' : ''}`}>
              <span>{t.showDrawingExtents}</span>
            </button>
            <div className="divider" />
            <button
              type="button"
              onClick={() => closeMenuAndRun(() => onSetDrawingColorMode(drawingColorMode === 'monochrome' ? 'original' : 'monochrome'))}
              className={`dropdown-item ${drawingColorMode === 'monochrome' ? 'checked' : ''}`}
            >
              <span>{isZh ? '黑白模式' : 'Monochrome Mode'}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ToolBar;
