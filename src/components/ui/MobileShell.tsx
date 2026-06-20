import React, { useEffect, useRef, useState } from 'react';
import { Language, UI_TRANSLATIONS } from '@/config/i18n';
import { DrawingColorMode, UiTheme } from '@/types';

/**
 * 移动端专属外壳（<= 768px 使用）。
 *
 * 设计目标：
 * - 画布全屏铺满，最大化可视区域
 * - 左上角圆形 FAB「打开」文件
 * - 右上角浮动坐标小标签（替代桌面端底部状态栏的坐标）
 * - 底部 Tab 栏：图层 / 属性 / 视图 / 关于
 *   - 图层、属性、视图 → 从底部上滑的 Sheet（带拖拽手柄，下拉关闭，半屏高度）
 *   - 关于 → 弹窗（由外层 onShowAbout 触发）
 *
 * 桌面端的 Sidebar / PropertiesPanel 以 children 形式注入，在对应 Sheet 激活时渲染。
 */
export interface MobileShellProps {
  lang: Language;
  showOpen: boolean;
  onOpen: () => void;
  onFitView: () => void;
  uiTheme: UiTheme;
  onSetUiTheme: (t: UiTheme) => void;
  drawingColorMode: DrawingColorMode;
  onSetDrawingColorMode: (m: DrawingColorMode) => void;
  onSetLang: (l: Language) => void;
  onShowAbout: () => void;
  mouseCoords: { x: number; y: number };
  selectedCount: number;
  sidebarContent: React.ReactNode;
  propertiesContent: React.ReactNode;
}

type SheetTab = 'layers' | 'properties' | 'view';

const MobileShell: React.FC<MobileShellProps> = ({
  lang,
  showOpen,
  onOpen,
  onFitView,
  uiTheme,
  onSetUiTheme,
  drawingColorMode,
  onSetDrawingColorMode,
  onSetLang,
  onShowAbout,
  mouseCoords,
  selectedCount,
  sidebarContent,
  propertiesContent,
}) => {
  const t = UI_TRANSLATIONS[lang];
  const isZh = lang === 'zh';
  const [activeSheet, setActiveSheet] = useState<SheetTab | null>(null);
  const [dragY, setDragY] = useState(0);
  const draggingRef = useRef(false);
  const startYRef = useRef(0);

  // 切换 Sheet：再次点击已激活的 Tab 关闭
  const toggleSheet = (tab: SheetTab) => {
    setActiveSheet(prev => (prev === tab ? null : tab));
    setDragY(0);
  };

  const closeSheet = () => {
    setActiveSheet(null);
    setDragY(0);
  };

  const handleAbout = () => {
    closeSheet();
    onShowAbout();
  };

  // 拖拽手柄：下拉关闭
  const onHandlePointerDown = (e: React.PointerEvent) => {
    draggingRef.current = true;
    startYRef.current = e.clientY;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onHandlePointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const dy = e.clientY - startYRef.current;
    if (dy > 0) setDragY(dy);
  };
  const onHandlePointerUp = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (dragY > 90) {
      closeSheet();
    } else {
      setDragY(0);
    }
  };

  const sheetStyle: React.CSSProperties = dragY > 0
    ? { transform: `translateY(${dragY}px)`, transition: 'none' }
    : { transform: activeSheet ? 'translateY(0)' : 'translateY(100%)' };

  return (
    <>
      {/* 左上角：打开文件 FAB */}
      {showOpen && (
        <button
          type="button"
          className="mobile-fab-open"
          onClick={onOpen}
          title={isZh ? '打开 DXF 文件' : 'Open DXF file'}
          aria-label={isZh ? '打开' : 'Open'}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            <line x1="12" y1="11" x2="12" y2="17" />
            <line x1="9" y1="14" x2="15" y2="14" />
          </svg>
        </button>
      )}

      {/* 右上角：浮动坐标标签 */}
      <div className="mobile-coord-chip" aria-live="polite">
        <span>X {mouseCoords.x.toFixed(2)}</span>
        <span>Y {mouseCoords.y.toFixed(2)}</span>
        {selectedCount > 0 && <span className="coord-selected">· {selectedCount}</span>}
      </div>

      {/* Sheet 遮罩 */}
      <div
        className={`mobile-sheet-backdrop ${activeSheet ? 'visible' : ''}`}
        onClick={closeSheet}
      />

      {/* 底部上滑 Sheet */}
      <div
        className={`mobile-sheet ${activeSheet ? 'open' : ''}`}
        style={sheetStyle}
        role="dialog"
        aria-modal="true"
      >
        <div
          className="mobile-sheet-handle"
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerUp}
        >
          <span className="mobile-sheet-grip" />
        </div>
        <div className="mobile-sheet-content">
          {activeSheet === 'layers' && sidebarContent}
          {activeSheet === 'properties' && propertiesContent}
          {activeSheet === 'view' && (
            <div className="mobile-view-list">
              <button type="button" className="mobile-view-item" onClick={() => { onFitView(); closeSheet(); }}>
                <span>{t.fitView}</span>
              </button>
              <div className="mobile-view-divider" />
              <button
                type="button"
                className={`mobile-view-item ${uiTheme === 'light' ? 'checked' : ''}`}
                onClick={() => onSetUiTheme('light')}
              >
                <span>{t.light}</span>
              </button>
              <button
                type="button"
                className={`mobile-view-item ${uiTheme === 'dark' ? 'checked' : ''}`}
                onClick={() => onSetUiTheme('dark')}
              >
                <span>{t.dark}</span>
              </button>
              <div className="mobile-view-divider" />
              <button
                type="button"
                className={`mobile-view-item ${drawingColorMode === 'monochrome' ? 'checked' : ''}`}
                onClick={() => onSetDrawingColorMode(drawingColorMode === 'monochrome' ? 'original' : 'monochrome')}
              >
                <span>{t.monochrome}</span>
              </button>
              <div className="mobile-view-divider" />
              <button type="button" className="mobile-view-item" onClick={() => onSetLang(lang === 'zh' ? 'en' : 'zh')}>
                <span>{t.language}: {lang === 'zh' ? 'English' : '简体中文'}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 底部 Tab 栏 */}
      <div className="mobile-tab-bar" role="tablist">
        <button
          type="button"
          className={`mobile-tab ${activeSheet === 'layers' ? 'active' : ''}`}
          role="tab"
          aria-selected={activeSheet === 'layers'}
          onClick={() => toggleSheet('layers')}
        >
          <span>{t.layers}</span>
        </button>
        <button
          type="button"
          className={`mobile-tab ${activeSheet === 'properties' ? 'active' : ''}`}
          role="tab"
          aria-selected={activeSheet === 'properties'}
          onClick={() => toggleSheet('properties')}
        >
          <span>{t.properties}</span>
        </button>
        <button
          type="button"
          className={`mobile-tab ${activeSheet === 'view' ? 'active' : ''}`}
          role="tab"
          aria-selected={activeSheet === 'view'}
          onClick={() => toggleSheet('view')}
        >
          <span>{t.view}</span>
        </button>
        <button
          type="button"
          className="mobile-tab"
          role="tab"
          aria-selected={false}
          onClick={handleAbout}
        >
          <span>{t.about}</span>
        </button>
      </div>
    </>
  );
};

export default MobileShell;
