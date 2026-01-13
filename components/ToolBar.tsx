import React, { useState } from 'react';

interface ToolBarProps {
  onImport: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClear: () => void;
  onFitView: () => void;
  showSidebar: boolean;
  onToggleSidebar: () => void;
  showProperties: boolean;
  onToggleProperties: () => void;
}

const ToolBar: React.FC<ToolBarProps> = ({ 
    onImport, 
    onClear, 
    onFitView, 
    showSidebar, 
    onToggleSidebar, 
    showProperties, 
    onToggleProperties 
}) => {
  const [activeMenu, setActiveMenu] = useState<string | null>(null);

  return (
    <div className="toolbar">
      {/* 文件 Menu */}
      <div 
        className="menu-item"
        onMouseEnter={() => setActiveMenu('file')}
        onMouseLeave={() => setActiveMenu(null)}
      >
        <span>文件</span>
        {activeMenu === 'file' && (
          <div className="dropdown-menu">
            <label className="dropdown-item">
              <span>打开...</span>
              <input type="file" accept=".dxf" className="hidden" onChange={onImport} />
            </label>
            <div onClick={onClear} className="dropdown-item">
               <span>清空</span>
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
        <span>视图</span>
        {activeMenu === 'view' && (
          <div className="dropdown-menu" style={{ minWidth: '160px' }}>
            <div onClick={onFitView} className="dropdown-item">
              <span>充满</span>
            </div>
            <div className="divider"></div>
            <div onClick={onToggleSidebar} className="dropdown-item">
              <span>结构 ({showSidebar ? '显示' : '隐藏'})</span>
            </div>
            <div onClick={onToggleProperties} className="dropdown-item">
               <span>属性 ({showProperties ? '显示' : '隐藏'})</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ToolBar;