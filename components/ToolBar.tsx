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

  // Icons
  const OpenIcon = () => <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>;
  const ClearIcon = () => <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6m4-6v6" /></svg>;
  const FitViewIcon = () => <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>;
  const CheckIcon = () => <svg className="w-4 h-4 text-current" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>;
  const EmptyIcon = () => <div className="w-4 h-4"></div>;

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
              <OpenIcon />
              <span>打开...</span>
              <input type="file" accept=".dxf" className="hidden" onChange={onImport} />
            </label>
            <div onClick={onClear} className={dropdownItemClass}>
               <ClearIcon />
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
              <FitViewIcon />
              <span>充满窗口</span>
            </div>
            <div className="h-px bg-gray-200 my-1"></div>
            <div onClick={onToggleSidebar} className={dropdownItemClass}>
              {showSidebar ? <CheckIcon /> : <EmptyIcon />}
              <span>结构树</span>
            </div>
            <div onClick={onToggleProperties} className={dropdownItemClass}>
               {showProperties ? <CheckIcon /> : <EmptyIcon />}
               <span>属性面板</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ToolBar;