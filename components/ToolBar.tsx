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

  const menuClass = "px-4 h-full flex items-center hover:bg-gray-200 transition-colors text-sm text-gray-800 cursor-default select-none relative";
  const dropdownItemClass = "px-4 py-2 hover:bg-[#2b579a] hover:text-white text-sm text-gray-700 cursor-pointer whitespace-nowrap transition-colors flex items-center gap-2";

  return (
    <div className="h-10 bg-white border-b border-gray-300 flex items-center z-50 shrink-0 font-sans shadow-sm pl-2">
      {/* 文件 Menu */}
      <div 
        className={menuClass}
        onMouseEnter={() => setActiveMenu('file')}
        onMouseLeave={() => setActiveMenu(null)}
      >
        <span>文件</span>
        {activeMenu === 'file' && (
          <div className="absolute top-full left-0 bg-white border border-gray-300 shadow-xl py-1 min-w-[140px] z-[60]">
            <label className={dropdownItemClass}>
              <span>打开...</span>
              <input type="file" accept=".dxf" className="hidden" onChange={onImport} />
            </label>
            <div onClick={onClear} className={dropdownItemClass}>
               <span>清空</span>
            </div>
          </div>
        )}
      </div>

      {/* 视图 Menu */}
      <div 
        className={menuClass}
        onMouseEnter={() => setActiveMenu('view')}
        onMouseLeave={() => setActiveMenu(null)}
      >
        <span>视图</span>
        {activeMenu === 'view' && (
          <div className="absolute top-full left-0 bg-white border border-gray-300 shadow-xl py-1 min-w-[160px] z-[60]">
            <div onClick={onFitView} className={dropdownItemClass}>
              <span>充满</span>
            </div>
            <div className="h-px bg-gray-200 my-1"></div>
            <div onClick={onToggleSidebar} className={dropdownItemClass}>
              <span>结构</span>
            </div>
            <div onClick={onToggleProperties} className={dropdownItemClass}>
               <span>属性</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ToolBar;