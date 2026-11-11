import React, { useEffect, useRef, useState } from 'react';
import { Language, UI_TRANSLATIONS, t } from '@/ui/i18n';
import { DrawingColorMode, UiTheme } from '@/types';
import type { EngineKind } from '@/render/engine';
import ViewerIcon, { ViewerIconName } from '@/ui/components/common/ViewerIcon';

interface ViewerToolbarProps {
  onImport: (files: File[]) => void;
  onFitView: () => void;
  onPreviousView: () => void;
  onNextView: () => void;
  onToggleSearch: () => void;
  isSearchActive: boolean;
  canGoPreviousView: boolean;
  canGoNextView: boolean;
  showOpen?: boolean;
  uiTheme: UiTheme;
  onSetUiTheme: (theme: UiTheme) => void;
  drawingColorMode: DrawingColorMode;
  onSetDrawingColorMode: (mode: DrawingColorMode) => void;
  /** 渲染引擎（WebGL / Canvas 可切换对比）。 */
  renderEngine: EngineKind;
  onSetRenderEngine: (engine: EngineKind) => void;
  lang: Language;
  onSetLang: (lang: Language) => void;
  showLayerPanel: boolean;
  onToggleLayerPanel: () => void;
  showProperties: boolean;
  onToggleProperties: () => void;
  /** 导出（PNG/SVG/PDF/DXF），由 DxfViewer 提供实现 */
  onExport?: (kind: ExportKind) => void;
  canExport?: boolean;
}
export type ExportKind = 'png' | 'svg' | 'pdf' | 'pdfVector' | 'dxf' | 'pngView' | 'svgView';

type MenuKey = 'view' | 'export';

/**
 * 视口工具条（web-ui-style §1 / §8）。
 *
 * 布局：`ui-toolbar-row` 32px 行内的一组 26px 图标按钮 +
 * `tb-sep` 分隔符 + 视图/导出下拉菜单；文件标签条由父级渲染在右侧。
 * 所有纯图标按钮都带 title + aria-label（R8 / §1.3）。
 */
const ViewerToolbar: React.FC<ViewerToolbarProps> = ({
  onImport,
  onFitView,
  onPreviousView,
  onNextView,
  onToggleSearch,
  isSearchActive,
  canGoPreviousView,
  canGoNextView,
  showOpen = true,
  uiTheme,
  onSetUiTheme,
  drawingColorMode,
  onSetDrawingColorMode,
  renderEngine,
  onSetRenderEngine,
  lang,
  onSetLang,
  showLayerPanel,
  onToggleLayerPanel,
  showProperties,
  onToggleProperties,
  onExport,
  canExport = false,
}) => {
  const [activeMenu, setActiveMenu] = useState<MenuKey | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tt = UI_TRANSLATIONS[lang];

  useEffect(() => {
    if (!activeMenu) return;
    const closeMenu = () => setActiveMenu(null);
    const closeByEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActiveMenu(null);
    };
    window.addEventListener('click', closeMenu);
    window.addEventListener('keydown', closeByEscape);
    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('keydown', closeByEscape);
    };
  }, [activeMenu]);

  const toggleMenu = (event: React.MouseEvent, menu: MenuKey) => {
    event.stopPropagation();
    setActiveMenu(activeMenu === menu ? null : menu);
  };

  const closeMenuAndRun = (handler: () => void) => {
    setActiveMenu(null);
    handler();
  };

  const openFileDialog = () => {
    fileInputRef.current?.click();
    setActiveMenu(null);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    event.target.value = '';
    if (files.length > 0) onImport(files);
  };

  const renderToolButton = (
    icon: ViewerIconName,
    label: string,
    onClick: () => void,
    disabled = false,
    active = false,
  ) => (
    <button
      type="button"
      className={`toolbar-button toolbar-icon-button ${active ? 'active' : ''}`}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
    >
      <span className="toolbar-icon" aria-hidden="true"><ViewerIcon name={icon} /></span>
    </button>
  );

  return (
    <div className="toolbar" role="toolbar" aria-label={t(lang, 'viewerToolbar')}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".dxf"
        multiple
        onChange={handleFileChange}
        className="hidden-file-input"
      />

      {showOpen && renderToolButton('open', tt.openFile, openFileDialog)}
      {showOpen && <span className="tb-sep" role="separator" />}

      {renderToolButton('previous', tt.previousView, onPreviousView, !canGoPreviousView)}
      {renderToolButton('next', tt.nextView, onNextView, !canGoNextView)}
      {renderToolButton('fit', tt.fitView, onFitView)}
      {renderToolButton('search', t(lang, 'searchText'), onToggleSearch, false, isSearchActive)}

      <span className="tb-sep" role="separator" />

      {/* 视图菜单：纯图标按钮（无文字、无下拉箭头），tooltip 说明用途 */}
      <div className={`toolbar-menu ${activeMenu === 'view' ? 'active' : ''}`}>
        <button
          type="button"
          className="toolbar-button toolbar-icon-button"
          onClick={(event) => toggleMenu(event, 'view')}
          title={tt.view}
          aria-label={tt.view}
          aria-haspopup="menu"
          aria-expanded={activeMenu === 'view'}
        >
          <span className="toolbar-icon" aria-hidden="true"><ViewerIcon name="view" /></span>
        </button>
        {activeMenu === 'view' && (
          <div className="dropdown-menu" role="menu" onClick={(event) => event.stopPropagation()}>
            <div className="dropdown-header">{tt.light} / {tt.dark}</div>
            <button type="button" onClick={() => closeMenuAndRun(() => onSetUiTheme('system'))} className={`dropdown-item ${uiTheme === 'system' ? 'checked' : ''}`}>
              <span>{tt.system}</span>
            </button>
            <button type="button" onClick={() => closeMenuAndRun(() => onSetUiTheme('light'))} className={`dropdown-item ${uiTheme === 'light' ? 'checked' : ''}`}>
              <span>{tt.light}</span>
            </button>
            <button type="button" onClick={() => closeMenuAndRun(() => onSetUiTheme('dark'))} className={`dropdown-item ${uiTheme === 'dark' ? 'checked' : ''}`}>
              <span>{tt.dark}</span>
            </button>
            <div className="divider" />
            <button
              type="button"
              onClick={() => closeMenuAndRun(() => onSetDrawingColorMode(drawingColorMode === 'monochrome' ? 'original' : 'monochrome'))}
              className={`dropdown-item ${drawingColorMode === 'monochrome' ? 'checked' : ''}`}
            >
              <span>{tt.monochrome}</span>
            </button>
            <button
              type="button"
              onClick={() => closeMenuAndRun(() => onSetRenderEngine('webgl'))}
              className={`dropdown-item ${renderEngine === 'webgl' ? 'checked' : ''}`}
            >
              <span>{tt.engineWebgl}</span>
            </button>
            <button
              type="button"
              onClick={() => closeMenuAndRun(() => onSetRenderEngine('canvas'))}
              className={`dropdown-item ${renderEngine === 'canvas' ? 'checked' : ''}`}
            >
              <span>{tt.engineCanvas}</span>
            </button>
            <div className="divider" />
            <button type="button" onClick={() => closeMenuAndRun(onToggleLayerPanel)} className={`dropdown-item ${showLayerPanel ? 'checked' : ''}`}>
              <span>{tt.layers}</span>
            </button>
            <button type="button" onClick={() => closeMenuAndRun(onToggleProperties)} className={`dropdown-item ${showProperties ? 'checked' : ''}`}>
              <span>{tt.properties}</span>
            </button>
            <div className="divider" />
            <button type="button" onClick={() => closeMenuAndRun(() => onSetLang(lang === 'zh' ? 'en' : 'zh'))} className="dropdown-item">
              <span>{tt.language}: {lang === 'zh' ? 'English' : '简体中文'}</span>
            </button>
          </div>
        )}
      </div>

      {onExport && (
        <div className={`toolbar-menu ${activeMenu === 'export' ? 'active' : ''}`}>
          <button
            type="button"
            className="toolbar-button toolbar-icon-button"
            onClick={(event) => toggleMenu(event, 'export')}
            title={t(lang, 'exportMenu')}
            aria-label={t(lang, 'exportMenu')}
            aria-haspopup="menu"
            aria-expanded={activeMenu === 'export'}
            disabled={!canExport}
          >
            <span className="toolbar-icon" aria-hidden="true"><ViewerIcon name="export" /></span>
          </button>
          {activeMenu === 'export' && (
            <div className="dropdown-menu" role="menu" onClick={(event) => event.stopPropagation()}>
              {([
                ['png', 'exportPng'],
                ['svg', 'exportSvg'],
                ['pdfVector', 'exportPdf'],
                ['pngView', 'exportPngView'],
                ['svgView', 'exportSvgView'],
                ['dxf', 'exportDxf'],
              ] as const).map(([kind, labelKey]) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => closeMenuAndRun(() => onExport(kind))}
                  className="dropdown-item"
                >
                  <span>{t(lang, labelKey)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ViewerToolbar;
