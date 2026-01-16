import React, { useState } from 'react';
import { Language, UI_TRANSLATIONS } from '../constants/i18n';

interface ToolBarProps {
  onImport: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClear: () => void;
  onFitView: () => void;
  showSidebar: boolean;
  onToggleSidebar: () => void;
  showProperties: boolean;
  onToggleProperties: () => void;
  showOpen?: boolean;
  uiTheme: 'light' | 'dark';
  onSetUiTheme: (theme: 'light' | 'dark') => void;
  canvasTheme: 'black' | 'white' | 'gray';
  onSetCanvasTheme: (theme: 'black' | 'white' | 'gray') => void;
  lang: Language;
  onSetLang: (lang: Language) => void;
}

const ToolBar: React.FC<ToolBarProps> = ({ 
    onImport, 
    onClear, 
    onFitView, 
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
    onSetLang
}) => {
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const t = UI_TRANSLATIONS[lang];

  return (
    <div className="toolbar">
      {/* 文件 Menu */}
      <div 
        className={`menu-item ${activeMenu === 'file' ? 'active' : ''}`}
        onMouseEnter={() => setActiveMenu('file')}
        onMouseLeave={() => setActiveMenu(null)}
      >
        <span>{t.file}</span>
        {activeMenu === 'file' && (
          <div className="dropdown-menu">
            {showOpen && (
              <label className="dropdown-item">
                <span>{t.open}</span>
                <input type="file" accept=".dxf" className="hidden" onChange={onImport} />
              </label>
            )}
            <div onClick={onClear} className="dropdown-item">
               <span>{t.clear}</span>
            </div>
          </div>
        )}
      </div>

      {/* 视图 Menu */}
      <div 
        className={`menu-item ${activeMenu === 'view' ? 'active' : ''}`}
        onMouseEnter={() => setActiveMenu('view')}
        onMouseLeave={() => setActiveMenu(null)}
      >
        <span>{t.view}</span>
        {activeMenu === 'view' && (
          <div className="dropdown-menu" style={{ minWidth: '160px' }}>
            <div onClick={onFitView} className="dropdown-item">
              <span>{t.fitView}</span>
            </div>
            <div className="divider"></div>
            <div onClick={() => onSetLang(lang === 'zh' ? 'en' : 'zh')} className="dropdown-item">
              <span>{t.language}: {lang === 'zh' ? 'English' : '简体中文'}</span>
            </div>
          </div>
        )}
      </div>

      {/* 界面 Menu (Ref 3DBrowser) */}
      <div 
        className={`menu-item ${activeMenu === 'interface' ? 'active' : ''}`}
        onMouseEnter={() => setActiveMenu('interface')}
        onMouseLeave={() => setActiveMenu(null)}
      >
        <span>{lang === 'zh' ? '界面' : 'Interface'}</span>
        {activeMenu === 'interface' && (
          <div className="dropdown-menu" style={{ minWidth: '180px' }}>
            <div onClick={onToggleSidebar} className={`dropdown-item ${showSidebar ? 'checked' : ''}`}>
              <span>{t.layers}</span>
            </div>
            <div onClick={onToggleProperties} className={`dropdown-item ${showProperties ? 'checked' : ''}`}>
               <span>{t.properties}</span>
            </div>
            <div className="divider"></div>
            <div onClick={() => onSetUiTheme('light')} className={`dropdown-item ${uiTheme === 'light' ? 'checked' : ''}`}>
              <span>{lang === 'zh' ? '浅色模式' : 'Light Mode'}</span>
            </div>
            <div onClick={() => onSetUiTheme('dark')} className={`dropdown-item ${uiTheme === 'dark' ? 'checked' : ''}`}>
              <span>{lang === 'zh' ? '深色模式' : 'Dark Mode'}</span>
            </div>
          </div>
        )}
      </div>

      {/* 设置 Menu (Background) */}
      <div 
        className={`menu-item ${activeMenu === 'settings' ? 'active' : ''}`}
        onMouseEnter={() => setActiveMenu('settings')}
        onMouseLeave={() => setActiveMenu(null)}
      >
        <span>{lang === 'zh' ? '设置' : 'Settings'}</span>
        {activeMenu === 'settings' && (
          <div className="dropdown-menu" style={{ minWidth: '180px' }}>
            <div className="dropdown-header" style={{ padding: '4px 12px', fontSize: '10px', color: 'var(--text-secondary)' }}>
              {lang === 'zh' ? '背景颜色' : 'Background Color'}
            </div>
            <div onClick={() => onSetCanvasTheme('black')} className={`dropdown-item ${canvasTheme === 'black' ? 'checked' : ''}`}>
              <span>{lang === 'zh' ? '黑色' : 'Black'}</span>
            </div>
            <div onClick={() => onSetCanvasTheme('white')} className={`dropdown-item ${canvasTheme === 'white' ? 'checked' : ''}`}>
              <span>{lang === 'zh' ? '白色' : 'White'}</span>
            </div>
            <div onClick={() => onSetCanvasTheme('gray')} className={`dropdown-item ${canvasTheme === 'gray' ? 'checked' : ''}`}>
              <span>{lang === 'zh' ? '灰色' : 'Gray'}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ToolBar;