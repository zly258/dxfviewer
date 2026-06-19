import React, { useEffect, useRef, useState } from 'react';
import { Language, UI_TRANSLATIONS } from '../../constants/i18n';
import { CanvasTheme, DrawingColorMode, UiTheme } from '../../types';

interface ToolBarProps {
  onImport: (files: File[]) => void;
  onClear: () => void;
  onFitView: () => void;
  showDrawingExtents: boolean;
  onToggleDrawingExtents: () => void;
  showOpen?: boolean;
  uiTheme: UiTheme;
  onSetUiTheme: (theme: UiTheme) => void;
  canvasTheme: CanvasTheme;
  onSetCanvasTheme: (theme: CanvasTheme) => void;
  drawingColorMode: DrawingColorMode;
  onSetDrawingColorMode: (mode: DrawingColorMode) => void;
  lang: Language;
  onSetLang: (lang: Language) => void;
  onShowAbout?: () => void;
}

type MenuKey = 'file' | 'interface' | 'view';

const ToolBar: React.FC<ToolBarProps> = ({
  onImport,
  onClear,
  onFitView,
  showDrawingExtents,
  onToggleDrawingExtents,
  showOpen = true,
  uiTheme,
  onSetUiTheme,
  canvasTheme,
  onSetCanvasTheme,
  drawingColorMode,
  onSetDrawingColorMode,
  lang,
  onSetLang,
  onShowAbout,
}) => {
  const [activeMenu, setActiveMenu] = useState<MenuKey | 'sample' | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const t = UI_TRANSLATIONS[lang];
  const isZh = lang === 'zh';

  useEffect(() => {
    if (!activeMenu) return;
    const closeMenu = () => setActiveMenu(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, [activeMenu]);

  const toggleMenu = (event: React.MouseEvent, menu: MenuKey | 'sample') => {
    event.stopPropagation();
    setActiveMenu(activeMenu === menu ? null : menu);
  };

  const switchMenuOnHover = (menu: MenuKey | 'sample') => {
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
                <span>{isZh ? '关闭当前图纸' : 'Close Current Drawing'}</span>
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
            <div className="dropdown-header">{isZh ? '主题' : 'Theme'}</div>
            <button type="button" onClick={() => closeMenuAndRun(() => onSetUiTheme('light'))} className={`dropdown-item ${uiTheme === 'light' ? 'checked' : ''}`}>
              <span>{isZh ? '浅色' : 'Light'}</span>
            </button>
            <button type="button" onClick={() => closeMenuAndRun(() => onSetUiTheme('dark'))} className={`dropdown-item ${uiTheme === 'dark' ? 'checked' : ''}`}>
              <span>{isZh ? '深色' : 'Dark'}</span>
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
            <div className="dropdown-header">{isZh ? '背景' : 'Background'}</div>
            <button type="button" onClick={() => closeMenuAndRun(() => onSetCanvasTheme('black'))} className={`dropdown-item ${canvasTheme === 'black' ? 'checked' : ''}`}>
              <span>{isZh ? '黑色背景' : 'Black Background'}</span>
            </button>
            <button type="button" onClick={() => closeMenuAndRun(() => onSetCanvasTheme('white'))} className={`dropdown-item ${canvasTheme === 'white' ? 'checked' : ''}`}>
              <span>{isZh ? '白色背景' : 'White Background'}</span>
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

      <div
        className={`menu-item ${activeMenu === 'sample' ? 'active' : ''}`}
        role="menuitem"
        onClick={(event) => toggleMenu(event, 'sample')}
        onMouseEnter={() => switchMenuOnHover('sample')}
      >
        <span>{isZh ? '示例图纸' : 'Sample Drawings'}</span>
        {activeMenu === 'sample' && (
          <div className="dropdown-menu" role="menu" onClick={(event) => event.stopPropagation()}>
            <button type="button" onClick={() => closeMenuAndRun(() => window.dispatchEvent(new CustomEvent('open-dxf-url', { detail: { url: '/basic.dxf' } })))} className="dropdown-item">
              <span>{isZh ? '1. 基础几何图元' : '1. Basic Geometries'}</span>
            </button>
            <button type="button" onClick={() => closeMenuAndRun(() => window.dispatchEvent(new CustomEvent('open-dxf-url', { detail: { url: '/advanced.dxf' } })))} className="dropdown-item">
              <span>{isZh ? '2. 高级图元与文字' : '2. Advanced Text & Curves'}</span>
            </button>
            <button type="button" onClick={() => closeMenuAndRun(() => window.dispatchEvent(new CustomEvent('open-dxf-url', { detail: { url: '/new_features.dxf' } })))} className="dropdown-item">
              <span>{isZh ? '3. 新型占位与螺旋' : '3. IMAGE & HELIX Placements'}</span>
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
          <span>{isZh ? '关于' : 'About'}</span>
        </div>
      )}
    </div>
  );
};

export default ToolBar;
