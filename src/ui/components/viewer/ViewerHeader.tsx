import React, { useEffect, useRef, useState } from 'react';
import { Language, t } from '@/ui/i18n';
import ViewerIcon from '@/ui/components/common/ViewerIcon';
import type { ExportKind } from '@/ui/components/viewer/ViewerToolbar';

interface ViewerHeaderProps {
  lang: Language;
  /** 当前图纸名；空表示未打开文件。 */
  fileName?: string;
  /** 类型角标（DXF / DWG…）。 */
  fileTag?: string;
  onExport?: (kind: ExportKind) => void;
  canExport?: boolean;
  onShowAbout?: () => void;
  /** 关闭当前图纸。未打开文件时不显示。 */
  onClose?: () => void;
  /** 额外操作（由工作台注入）。 */
  extra?: React.ReactNode;
}

const EXPORT_ITEMS = [
  ['png', 'exportPng'],
  ['svg', 'exportSvg'],
  ['pdfVector', 'exportPdf'],
  ['pngView', 'exportPngView'],
  ['svgView', 'exportSvgView'],
  ['dxf', 'exportDxf'],
] as const;

/**
 * 顶栏 42px（web-ui-style §2 三维工作台骨架）。
 *
 * 左侧：文件标题（16px/600、单行省略 + title）+ 类型角标（18px、11px/600）。
 * 不放 logo；右侧：导出菜单 + 关于。下拉右对齐到按钮右缘，不溢出视口。
 */
const ViewerHeader: React.FC<ViewerHeaderProps> = ({
  lang,
  fileName,
  fileTag = 'DXF',
  onExport,
  canExport = false,
  onShowAbout,
  onClose,
  extra,
}) => {
  const [exportOpen, setExportOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!exportOpen) return;
    const close = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setExportOpen(false);
    };
    const closeByEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExportOpen(false);
    };
    window.addEventListener('click', close);
    window.addEventListener('keydown', closeByEscape);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', closeByEscape);
    };
  }, [exportOpen]);

  const title = fileName || t(lang, 'noFileOpen');

  return (
    <header className="app-header" role="banner">
      <span className="app-header-title" title={title}>{title}</span>
      {fileTag && <span className="app-header-tag" title={fileTag}>{fileTag}</span>}

      <div className="app-header-actions">
        {extra}
        {onClose && fileName && (
          <button
            type="button"
            className="tb-icon-btn drawing-close"
            onClick={onClose}
            title={t(lang, 'closeDrawingAria')}
            aria-label={t(lang, 'closeDrawingAria')}
          >
            <ViewerIcon name="close" />
          </button>
        )}
        {onExport && (
          <div className="toolbar-menu" ref={menuRef}>
            <button
              type="button"
              className="tb-icon-btn"
              onClick={(event) => { event.stopPropagation(); setExportOpen(v => !v); }}
              title={t(lang, 'exportMenu')}
              aria-label={t(lang, 'exportMenu')}
              aria-haspopup="menu"
              aria-expanded={exportOpen}
              disabled={!canExport}
            >
              <ViewerIcon name="export" />
            </button>
            {exportOpen && (
              <div
                className="dropdown-menu dropdown-menu-right"
                role="menu"
                onClick={(event) => event.stopPropagation()}
              >
                {EXPORT_ITEMS.map(([kind, labelKey]) => (
                  <button
                    key={kind}
                    type="button"
                    className="dropdown-item"
                    onClick={() => { setExportOpen(false); onExport(kind); }}
                  >
                    <span>{t(lang, labelKey)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {onShowAbout && (
          <button
            type="button"
            className="tb-icon-btn"
            onClick={onShowAbout}
            title={t(lang, 'about')}
            aria-label={t(lang, 'about')}
          >
            <ViewerIcon name="about" />
          </button>
        )}
      </div>
    </header>
  );
};

export default ViewerHeader;
