import React, { useEffect, useMemo, useRef, useState } from 'react';
import DxfViewer from '@/ui/components/viewer/DxfViewer';
import ViewerIcon from '@/ui/components/common/ViewerIcon';
import { CANVAS_THEME_COLORS, getSystemUiTheme, resolveUiTheme, SHORTCUT_CONFIG, VIEWER_DEFAULTS } from '@/config/viewerConfig';
import { DxfOpenSource, useDxfDocument } from '@/ui/components/workspace/drawingDocument';
import { UiTheme, DrawingColorMode, ResolvedUiTheme } from '@/types';
import { Language, t } from '@/ui/i18n';
import { readViewerUiSettings } from '@/ui/components/viewer/viewerUiSettings';

export interface DxfWorkspaceProps {
  editor?: boolean;
  initialFiles?: DxfOpenSource[];
}

function DxfWorkspace({ editor = true, initialFiles = [] }: DxfWorkspaceProps) {
  const globalFileInputRef = useRef<HTMLInputElement>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const { document: drawing, openFiles, openUrl, closeDocument } = useDxfDocument(editor, initialFiles);

  const savedSettings = useMemo(() => readViewerUiSettings(), []);
  const [uiTheme, setUiTheme] = useState<UiTheme>(savedSettings.uiTheme || VIEWER_DEFAULTS.uiTheme);
  const [systemTheme, setSystemTheme] = useState<ResolvedUiTheme>(() => getSystemUiTheme());
  const [drawingColorMode, setDrawingColorMode] = useState<DrawingColorMode>(savedSettings.drawingColorMode || VIEWER_DEFAULTS.drawingColorMode);
  const [lang, setLang] = useState<Language>(savedSettings.language || VIEWER_DEFAULTS.language);
  const effectiveUiTheme = resolveUiTheme(uiTheme, systemTheme);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const updateSystemTheme = () => setSystemTheme(media.matches ? 'dark' : 'light');
    updateSystemTheme();
    media.addEventListener?.('change', updateSystemTheme);
    return () => media.removeEventListener?.('change', updateSystemTheme);
  }, []);

  const showAppToast = (message: string) => {
    setToastMessage(message);
    window.setTimeout(() => setToastMessage(null), VIEWER_DEFAULTS.toastDurationMs);
  };

  const handleOpenFailed = (message: string) => {
    closeDocument();
    showAppToast(message);
  };

  useEffect(() => {
    const handleGlobalOpen = (event: Event) => {
      const customEvent = event as CustomEvent<{ file?: File; files?: File[] }>;
      const files = customEvent.detail?.files || (customEvent.detail?.file ? [customEvent.detail.file] : []);
      openFiles(files);
    };
    const handleGlobalUrlOpen = (event: Event) => {
      const customEvent = event as CustomEvent<{ url: string }>;
      if (customEvent.detail?.url) openUrl(customEvent.detail.url);
    };
    const handleOpenRequest = () => {
      if (editor) globalFileInputRef.current?.click();
    };
    const handleShortcut = (event: KeyboardEvent) => {
      if (!editor) return;
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      if (tagName === 'input' || tagName === 'textarea' || target?.isContentEditable) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === SHORTCUT_CONFIG.openFileKey) {
        event.preventDefault();
        handleOpenRequest();
      }
    };

    window.addEventListener('open-dxf-file', handleGlobalOpen);
    window.addEventListener('open-dxf-files', handleGlobalOpen);
    window.addEventListener('open-dxf-url', handleGlobalUrlOpen);
    window.addEventListener('request-open-dxf-file', handleOpenRequest);
    window.addEventListener('keydown', handleShortcut);
    return () => {
      window.removeEventListener('open-dxf-file', handleGlobalOpen);
      window.removeEventListener('open-dxf-files', handleGlobalOpen);
      window.removeEventListener('open-dxf-url', handleGlobalUrlOpen);
      window.removeEventListener('request-open-dxf-file', handleOpenRequest);
      window.removeEventListener('keydown', handleShortcut);
    };
  }, [editor, openFiles, openUrl]);

  useEffect(() => {
    if (!confirmClose) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setConfirmClose(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmClose]);

  const requestClose = () => {
    if (!drawing) return;
    setConfirmClose(true);
  };

  const handleGlobalFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    event.target.value = '';
    if (files.length > 0) openFiles(files);
  };

  const canvasBgColor = effectiveUiTheme === 'dark' ? CANVAS_THEME_COLORS.black : CANVAS_THEME_COLORS.white;

  return (
    <div className={`app-main-container ${effectiveUiTheme === 'dark' ? 'theme-dark' : ''}`} style={{ '--canvas-bg': canvasBgColor } as React.CSSProperties}>
      {toastMessage && (
        <div className="cad-toast-container">
          <div className="cad-toast error" role="status">
            <span className="toast-message">{toastMessage}</span>
            <button type="button" className="toast-close" onClick={() => setToastMessage(null)} title={t(lang, 'closeToast')} aria-label={t(lang, 'closeToast')}>
              <ViewerIcon name="close" />
            </button>
          </div>
        </div>
      )}
      {confirmClose && drawing && (
        <div className="close-confirm-overlay" role="presentation" onClick={() => setConfirmClose(false)}>
          <div
            className="close-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="close-confirm-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div id="close-confirm-title" className="close-confirm-title">{t(lang, 'confirmCloseTitle')}</div>
            <p className="close-confirm-message">{t(lang, 'confirmCloseMessage', { name: drawing.name })}</p>
            <div className="close-confirm-actions">
              <button type="button" className="close-confirm-cancel" autoFocus onClick={() => setConfirmClose(false)}>
                {t(lang, 'confirmCloseCancel')}
              </button>
              <button
                type="button"
                className="close-confirm-ok"
                onClick={() => {
                  setConfirmClose(false);
                  closeDocument();
                }}
              >
                {t(lang, 'confirmCloseOk')}
              </button>
            </div>
          </div>
        </div>
      )}
      {editor && (
        <input
          ref={globalFileInputRef}
          type="file"
          accept=".dxf"
          onChange={handleGlobalFileChange}
          className="hidden-file-input"
        />
      )}
        <DxfViewer
          key={drawing?.id || 'empty'}
          active
          initFile={drawing?.file || drawing?.url}
          fileName={drawing?.name}
          showOpenMenu={editor}
          onOpenFiles={openFiles}
          onClose={editor && drawing ? requestClose : undefined}
          onOpenFailed={drawing ? handleOpenFailed : undefined}
          uiTheme={uiTheme} onUiThemeChange={setUiTheme}
          drawingColorMode={drawingColorMode} onDrawingColorModeChange={setDrawingColorMode}
          lang={lang} onLanguageChange={setLang}
        />
    </div>
  );
}

export default DxfWorkspace;
