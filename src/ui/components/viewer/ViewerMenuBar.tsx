import React, { useEffect, useRef, useState } from 'react';
import { Language, UI_TRANSLATIONS, t } from '@/ui/i18n';
import { DrawingColorMode, UiTheme } from '@/types';
import type { EngineKind } from '@/render/engine';
import type { ExportKind } from '@/ui/components/viewer/ViewerToolbar';
import ViewerIcon from '@/ui/components/common/ViewerIcon';

type MenuKey = 'file' | 'view' | 'help';

export interface ViewerMenuBarProps {
  lang: Language;
  /** 是否有已打开图纸（控制“关闭图纸”可用性）。 */
  hasFile: boolean;
  // 文件
  onImport: () => void;
  onExport?: (kind: ExportKind) => void;
  canExport?: boolean;
  onClose?: () => void;
  // 视图
  onFitView: () => void;
  onPreviousView: () => void;
  onNextView: () => void;
  canGoPreviousView: boolean;
  canGoNextView: boolean;
  onToggleSearch: () => void;
  isSearchActive: boolean;
  is3D: boolean;
  onToggle3D: () => void;
  showLayerPanel: boolean;
  onToggleLayerPanel: () => void;
  showProperties: boolean;
  onToggleProperties: () => void;
  uiTheme: UiTheme;
  onSetUiTheme: (theme: UiTheme) => void;
  drawingColorMode: DrawingColorMode;
  onSetDrawingColorMode: (mode: DrawingColorMode) => void;
  renderEngine: EngineKind;
  onSetRenderEngine: (engine: EngineKind) => void;
  onSetLang: (lang: Language) => void;
  // 帮助
  onShowAbout: () => void;
}

/**
 * 经典菜单栏（桌面端）：纯文字菜单「文件 / 视图 / 帮助」，不使用图标。
 * 移动端不渲染本组件（使用纯图标浮层）。
 */
const ViewerMenuBar: React.FC<ViewerMenuBarProps> = (props) => {
  const { lang } = props;
  const tt = UI_TRANSLATIONS[lang];
  const zh = lang === 'zh';
  const [open, setOpen] = useState<MenuKey | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(null);
    };
    const esc = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(null); };
    window.addEventListener('click', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  const toggle = (event: React.MouseEvent, key: MenuKey) => {
    event.stopPropagation();
    setOpen(open === key ? null : key);
  };
  const run = (fn: () => void) => { setOpen(null); fn(); };

  const Item: React.FC<{ onClick?: () => void; disabled?: boolean; checked?: boolean; children: React.ReactNode }> = ({
    onClick, disabled, checked, children,
  }) => (
    <button
      type="button"
      className={`menu-item ${checked ? 'checked' : ''}`}
      role="menuitem"
      disabled={disabled}
      onClick={() => { if (onClick) run(onClick); }}
    >
      <span className="menu-item-label">{children}</span>
      {checked && <span className="menu-check" aria-hidden="true"><ViewerIcon name="check" /></span>}
    </button>
  );
  const Sep = () => <div className="menu-sep" role="separator" />;
  const GroupLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="menu-group-label">{children}</div>
  );

  const exportItems: [ExportKind, string][] = [
    ['png', 'exportPng'], ['svg', 'exportSvg'], ['pdfVector', 'exportPdf'],
    ['pngView', 'exportPngView'], ['svgView', 'exportSvgView'], ['dxf', 'exportDxf'],
  ];

  return (
    <div className="menu-bar" role="menubar" aria-label={zh ? '主菜单' : 'Main menu'} ref={rootRef}>
      <span className="menu-bar-brand">DXF Viewer</span>

      {/* 文件 */}
      <div className={`menu-bar-item ${open === 'file' ? 'open' : ''}`}>
        <button type="button" className="menu-bar-title" onClick={(e) => toggle(e, 'file')} aria-haspopup="menu" aria-expanded={open === 'file'}>
          {zh ? '文件' : 'File'}
        </button>
        {open === 'file' && (
          <div className="menu-bar-dropdown" role="menu" onClick={(e) => e.stopPropagation()}>
            <Item onClick={props.onImport}>{zh ? '打开…' : 'Open…'}</Item>
            <Sep />
            <GroupLabel>{t(lang, 'exportMenu')}</GroupLabel>
            {props.onExport && exportItems.map(([kind, labelKey]) => (
              <Item key={kind} disabled={!props.canExport} onClick={() => props.onExport!(kind)}>
                {t(lang, labelKey)}
              </Item>
            ))}
            <Sep />
            <Item disabled={!props.hasFile} onClick={props.onClose}>{zh ? '关闭图纸' : 'Close drawing'}</Item>
          </div>
        )}
      </div>

      {/* 视图 */}
      <div className={`menu-bar-item ${open === 'view' ? 'open' : ''}`}>
        <button type="button" className="menu-bar-title" onClick={(e) => toggle(e, 'view')} aria-haspopup="menu" aria-expanded={open === 'view'}>
          {zh ? '视图' : 'View'}
        </button>
        {open === 'view' && (
          <div className="menu-bar-dropdown" role="menu" onClick={(e) => e.stopPropagation()}>
            <Item onClick={props.onFitView}>{tt.fitView}</Item>
            <Item disabled={!props.canGoPreviousView} onClick={props.onPreviousView}>{tt.previousView}</Item>
            <Item disabled={!props.canGoNextView} onClick={props.onNextView}>{tt.nextView}</Item>
            <Sep />
            <Item checked={props.is3D} onClick={props.onToggle3D}>{zh ? '三维视图' : '3D View'}</Item>
            <Item checked={props.isSearchActive} onClick={props.onToggleSearch}>{t(lang, 'searchText')}</Item>
            <Sep />
            <Item checked={props.showLayerPanel} onClick={props.onToggleLayerPanel}>{tt.layers}</Item>
            <Item checked={props.showProperties} onClick={props.onToggleProperties}>{tt.properties}</Item>
            <Sep />
            <GroupLabel>{zh ? '主题' : 'Theme'}</GroupLabel>
            <Item checked={props.uiTheme === 'system'} onClick={() => props.onSetUiTheme('system')}>{tt.system}</Item>
            <Item checked={props.uiTheme === 'light'} onClick={() => props.onSetUiTheme('light')}>{tt.light}</Item>
            <Item checked={props.uiTheme === 'dark'} onClick={() => props.onSetUiTheme('dark')}>{tt.dark}</Item>
            <Item checked={props.drawingColorMode === 'monochrome'} onClick={() => props.onSetDrawingColorMode(props.drawingColorMode === 'monochrome' ? 'original' : 'monochrome')}>{tt.monochrome}</Item>
            <Sep />
            <GroupLabel>{zh ? '渲染引擎' : 'Render engine'}</GroupLabel>
            <Item checked={props.renderEngine === 'webgl'} onClick={() => props.onSetRenderEngine('webgl')}>{tt.engineWebgl}</Item>
            <Item checked={props.renderEngine === 'canvas'} onClick={() => props.onSetRenderEngine('canvas')}>{tt.engineCanvas}</Item>
            <Sep />
            <Item onClick={() => props.onSetLang(lang === 'zh' ? 'en' : 'zh')}>{tt.language}: {lang === 'zh' ? 'English' : '简体中文'}</Item>
          </div>
        )}
      </div>

      {/* 帮助 */}
      <div className={`menu-bar-item ${open === 'help' ? 'open' : ''}`}>
        <button type="button" className="menu-bar-title" onClick={(e) => toggle(e, 'help')} aria-haspopup="menu" aria-expanded={open === 'help'}>
          {zh ? '帮助' : 'Help'}
        </button>
        {open === 'help' && (
          <div className="menu-bar-dropdown" role="menu" onClick={(e) => e.stopPropagation()}>
            <Item onClick={props.onShowAbout}>{t(lang, 'about')}</Item>
          </div>
        )}
      </div>
    </div>
  );
};

export default ViewerMenuBar;
