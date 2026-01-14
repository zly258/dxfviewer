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
  theme: 'black' | 'white';
  onToggleTheme: () => void;
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
    theme,
    onToggleTheme,
    lang,
    onSetLang
}) => {
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const t = UI_TRANSLATIONS[lang];

  return (
    <div className="toolbar">
      {/* 文件 Menu */}
      <div 
        className="menu-item"
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
        className="menu-item"
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
            <div onClick={onToggleSidebar} className="dropdown-item">
              <span>{t.layers} ({showSidebar ? t.off : t.on})</span>
            </div>
            <div onClick={onToggleProperties} className="dropdown-item">
               <span>{t.properties} ({showProperties ? t.off : t.on})</span>
            </div>
            <div className="divider"></div>
            <div onClick={onToggleTheme} className="dropdown-item">
              <span>{t.theme} ({theme === 'black' ? t.black : t.white})</span>
            </div>
            <div className="divider"></div>
            <div onClick={() => onSetLang(lang === 'zh' ? 'en' : 'zh')} className="dropdown-item">
              <span>{t.language}: {lang === 'zh' ? 'English' : '简体中文'}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ToolBar;