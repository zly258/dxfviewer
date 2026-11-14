import React, { useEffect, useRef, useState } from 'react';
import { Language, UI_TRANSLATIONS, t } from '@/ui/i18n';
import { DrawingColorMode, UiTheme } from '@/types';
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
  lang: Language;
  onSetLang: (lang: Language) => void;
  showLayerPanel: boolean;
  onToggleLayerPanel: () => void;
  showProperties: boolean;
  onToggleProperties: () => void;
  /** 导出（PNG/SVG/PDF/DXF），由 DxfViewer 提供实现 */
  onExport?: (kind: ExportKind) => void;
  canExport?: boolean;
  /** 三维视图开关。 */
  /** 是否在按钮上显示文字标签（桌面端 true，移动端 false）。 */
  showLabels?: boolean;
  /** 帮助 / 关于入口（桌面端工具条右侧）。 */
  onShowAbout?: () => void;
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
  lang,
  onSetLang,
  showLayerPanel,
  onToggleLayerPanel,
  showProperties,
  onToggleProperties,
  onExport,
  canExport = false,
  showLabels = true,
  onShowAbout,
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

  /** 桌面端按钮显示「图标 + 文字」；图标型按钮（上一个/下一个）仅图标。移动端由父级不渲染本组件。 */
  const showLabel = showLabels;
  const renderToolButton = (
    icon: ViewerIconName,
    label: string,
    onClick: () => void,
    disabled = false,
    active = false,
    options: { iconOnly?: boolean; text?: string } = {},
  ) => {
    const iconOnly = options.iconOnly === true;
    const visibleText = options.text ?? label;
    return (
      <button
        type="button"
        className={`toolbar-button ${showLabel && !iconOnly ? 'toolbar-button-label' : 'toolbar-icon-button'} ${active ? 'active' : ''}`}
        onClick={onClick}
        title={label}
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
      >
        <span className="toolbar-icon" aria-hidden="true"><ViewerIcon name={icon} /></span>
        {showLabel && !iconOnly && <span className="toolbar-label">{visibleText}</span>}
      </button>
    );
  };

  return (
    <div className="toolbar" role="toolbar" aria-label={t(lang, 'viewerToolbar')}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".dxf"
        onChange={handleFileChange}
        className="hidden-file-input"
      />

      {showOpen && renderToolButton('open', tt.openFile, openFileDialog, false, false, { text: '打开' })}
      {showOpen && <span className="tb-sep" role="separator" />}

      {renderToolButton('previous', tt.previousView, onPreviousView, !canGoPreviousView, false, { iconOnly: true })}
      {renderToolButton('next', tt.nextView, onNextView, !canGoNextView, false, { iconOnly: true })}
      {renderToolButton('fit', tt.fitView, onFitView, false, false, { text: '充满' })}
      {renderToolButton('search', t(lang, 'searchText'), onToggleSearch, false, isSearchActive, { text: '搜索' })}

      <span className="tb-sep" role="separator" />

      {/* 视图菜单 */}
      <div className={`toolbar-menu ${activeMenu === 'view' ? 'active' : ''}`}>
        <button
          type="button"
          className={`toolbar-button ${showLabel ? 'toolbar-button-label' : 'toolbar-icon-button'}`}
          onClick={(event) => toggleMenu(event, 'view')}
          title={tt.view}
          aria-label={tt.view}
          aria-haspopup="menu"
          aria-expanded={activeMenu === 'view'}
        >
          <span className="toolbar-icon" aria-hidden="true"><ViewerIcon name="view" /></span>
          {showLabel && <span className="toolbar-label">视图</span>}
        </button>
        {activeMenu === 'view' && (
          <div className="dropdown-menu" role="menu" onClick={(event) => event.stopPropagation()}>
            <button type="button" onClick={() => closeMenuAndRun(() => onSetUiTheme('system'))} className={`dropdown-item ${uiTheme === 'system' ? 'checked' : ''}`}>
              <span>跟随</span>
            </button>
            <button type="button" onClick={() => closeMenuAndRun(() => onSetUiTheme('light'))} className={`dropdown-item ${uiTheme === 'light' ? 'checked' : ''}`}>
              <span>浅色</span>
            </button>
            <button type="button" onClick={() => closeMenuAndRun(() => onSetUiTheme('dark'))} className={`dropdown-item ${uiTheme === 'dark' ? 'checked' : ''}`}>
              <span>深色</span>
            </button>
            <div className="divider" />
            <button
              type="button"
              onClick={() => closeMenuAndRun(() => onSetDrawingColorMode(drawingColorMode === 'monochrome' ? 'original' : 'monochrome'))}
              className={`dropdown-item ${drawingColorMode === 'monochrome' ? 'checked' : ''}`}
            >
              <span>黑白</span>
            </button>
            <div className="divider" />
            <button type="button" onClick={() => closeMenuAndRun(onToggleLayerPanel)} className={`dropdown-item ${showLayerPanel ? 'checked' : ''}`}>
              <span>图层</span>
            </button>
            <button type="button" onClick={() => closeMenuAndRun(onToggleProperties)} className={`dropdown-item ${showProperties ? 'checked' : ''}`}>
              <span>属性</span>
            </button>
            <div className="divider" />
            <button type="button" onClick={() => closeMenuAndRun(() => onSetLang(lang === 'zh' ? 'en' : 'zh'))} className="dropdown-item">
              <span>{lang === 'zh' ? '英文' : '中文'}</span>
            </button>
          </div>
        )}
      </div>

      {onExport && (
        <div className={`toolbar-menu ${activeMenu === 'export' ? 'active' : ''}`}>
          <button
            type="button"
            className={`toolbar-button ${showLabel ? 'toolbar-button-label' : 'toolbar-icon-button'}`}
            onClick={(event) => toggleMenu(event, 'export')}
            title={t(lang, 'exportMenu')}
            aria-label={t(lang, 'exportMenu')}
            aria-haspopup="menu"
            aria-expanded={activeMenu === 'export'}
            disabled={!canExport}
          >
            <span className="toolbar-icon" aria-hidden="true"><ViewerIcon name="export" /></span>
            {showLabel && <span className="toolbar-label">导出</span>}
          </button>
          {activeMenu === 'export' && (
            <div className="dropdown-menu" role="menu" onClick={(event) => event.stopPropagation()}>
              {([
                ['png', 'PNG'],
                ['svg', 'SVG'],
                ['pdfVector', 'PDF'],
                ['pngView', '图PNG'],
                ['svgView', '图SVG'],
                ['dxf', 'DXF'],
              ] as const).map(([kind, label]) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => closeMenuAndRun(() => onExport(kind))}
                  className="dropdown-item"
                >
                  <span>{label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {onShowAbout && (
        <>
          <span className="tb-sep" role="separator" />
          <button
            type="button"
            className={`toolbar-button ${showLabel ? 'toolbar-button-label' : 'toolbar-icon-button'}`}
            onClick={onShowAbout}
            title={t(lang, 'about')}
            aria-label={t(lang, 'about')}
          >
            <span className="toolbar-icon" aria-hidden="true"><ViewerIcon name="about" /></span>
            {showLabel && <span className="toolbar-label">关于</span>}
          </button>
        </>
      )}
    </div>
  );
};

export default ViewerToolbar;
