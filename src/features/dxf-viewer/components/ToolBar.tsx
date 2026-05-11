import React, { useEffect, useRef, useState } from 'react';
import { Language, UI_TRANSLATIONS } from '../../../constants/i18n';
import { CanvasTheme, UiTheme } from '../../../shared/types/ui';

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
  lang: Language;
  onSetLang: (lang: Language) => void;
}

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
  lang,
  onSetLang,
}) => {
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const t = UI_TRANSLATIONS[lang];

  useEffect(() => {
    if (!activeMenu) return;
    const closeMenu = () => setActiveMenu(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, [activeMenu]);

  const toggleMenu = (event: React.MouseEvent, menu: string) => {
    event.stopPropagation();
    setActiveMenu(activeMenu === menu ? null : menu);
  };

  const switchMenuOnHover = (menu: string) => {
    if (activeMenu && activeMenu !== menu) setActiveMenu(menu);
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
    <div className="toolbar" style={{ backgroundColor: uiTheme === 'dark' ? '#252526' : '#f0f0f0', borderBottom: '1px solid var(--border-color)' }}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".dxf"
        multiple
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />

      {showOpen && (
        <div
          className={`menu-item ${activeMenu === 'file' ? 'active' : ''}`}
          onClick={(event) => toggleMenu(event, 'file')}
          onMouseEnter={() => switchMenuOnHover('file')}
        >
          <span>{lang === 'zh' ? '文件 (F)' : 'File (F)'}</span>
          {activeMenu === 'file' && (
            <div className="dropdown-menu" style={{ minWidth: '160px' }} onClick={(event) => event.stopPropagation()}>
              <div onClick={openFileDialog} className="dropdown-item">
                <span>{lang === 'zh' ? '打开 DXF...' : 'Open DXF...'}</span>
              </div>
              <div onClick={() => { setActiveMenu(null); onClear(); }} className="dropdown-item">
                <span>{lang === 'zh' ? '清空当前图纸' : 'Clear Current Drawing'}</span>
              </div>
            </div>
          )}
        </div>
      )}

      <div
        className={`menu-item ${activeMenu === 'view' ? 'active' : ''}`}
        onClick={(event) => toggleMenu(event, 'view')}
        onMouseEnter={() => switchMenuOnHover('view')}
      >
        <span>{t.view} (V)</span>
        {activeMenu === 'view' && (
          <div className="dropdown-menu" style={{ minWidth: '160px' }} onClick={(event) => event.stopPropagation()}>
            <div onClick={() => { setActiveMenu(null); onFitView(); }} className="dropdown-item">
              <span>{t.fitView}</span>
            </div>
            <div onClick={() => { setActiveMenu(null); onToggleDrawingExtents(); }} className={`dropdown-item ${showDrawingExtents ? 'checked' : ''}`}>
              <span>{t.showDrawingExtents}</span>
            </div>
            <div className="divider" />
            <div onClick={() => { setActiveMenu(null); onSetLang(lang === 'zh' ? 'en' : 'zh'); }} className="dropdown-item">
              <span>{t.language}: {lang === 'zh' ? 'English' : '简体中文'}</span>
            </div>
          </div>
        )}
      </div>

      <div
        className={`menu-item ${activeMenu === 'interface' ? 'active' : ''}`}
        onClick={(event) => toggleMenu(event, 'interface')}
        onMouseEnter={() => switchMenuOnHover('interface')}
      >
        <span>{lang === 'zh' ? '界面 (I)' : 'Interface (I)'}</span>
        {activeMenu === 'interface' && (
          <div className="dropdown-menu" style={{ minWidth: '180px' }} onClick={(event) => event.stopPropagation()}>
            <div onClick={() => { setActiveMenu(null); onToggleSidebar(); }} className={`dropdown-item ${showSidebar ? 'checked' : ''}`}>
              <span>{t.layers}</span>
            </div>
            <div onClick={() => { setActiveMenu(null); onToggleProperties(); }} className={`dropdown-item ${showProperties ? 'checked' : ''}`}>
              <span>{t.properties}</span>
            </div>
            <div className="divider" />
            <div onClick={() => { setActiveMenu(null); onSetUiTheme('light'); }} className={`dropdown-item ${uiTheme === 'light' ? 'checked' : ''}`}>
              <span>{lang === 'zh' ? '浅色模式' : 'Light Mode'}</span>
            </div>
            <div onClick={() => { setActiveMenu(null); onSetUiTheme('dark'); }} className={`dropdown-item ${uiTheme === 'dark' ? 'checked' : ''}`}>
              <span>{lang === 'zh' ? '深色模式' : 'Dark Mode'}</span>
            </div>
          </div>
        )}
      </div>

      <div
        className={`menu-item ${activeMenu === 'settings' ? 'active' : ''}`}
        onClick={(event) => toggleMenu(event, 'settings')}
        onMouseEnter={() => switchMenuOnHover('settings')}
      >
        <span>{lang === 'zh' ? '工具 (T)' : 'Tools (T)'}</span>
        {activeMenu === 'settings' && (
          <div className="dropdown-menu" style={{ minWidth: '180px' }} onClick={(event) => event.stopPropagation()}>
            <div className="dropdown-header" style={{ padding: '4px 12px', fontSize: '10px', color: 'var(--text-secondary)' }}>
              {lang === 'zh' ? '背景颜色' : 'Background Color'}
            </div>
            <div onClick={() => { setActiveMenu(null); onSetCanvasTheme('black'); }} className={`dropdown-item ${canvasTheme === 'black' ? 'checked' : ''}`}>
              <span>{lang === 'zh' ? '黑色' : 'Black'}</span>
            </div>
            <div onClick={() => { setActiveMenu(null); onSetCanvasTheme('white'); }} className={`dropdown-item ${canvasTheme === 'white' ? 'checked' : ''}`}>
              <span>{lang === 'zh' ? '白色' : 'White'}</span>
            </div>
            <div onClick={() => { setActiveMenu(null); onSetCanvasTheme('gray'); }} className={`dropdown-item ${canvasTheme === 'gray' ? 'checked' : ''}`}>
              <span>{lang === 'zh' ? '灰色' : 'Gray'}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ToolBar;
