import React, { useEffect, useMemo, useRef, useState } from 'react';
import DxfViewer from '@/components/viewer/DxfViewer';
import ViewerIcon from '@/components/common/ViewerIcon';
import { CANVAS_THEME_COLORS, getSystemUiTheme, resolveUiTheme, SHORTCUT_CONFIG, VIEWER_DEFAULTS, TABS_CONFIG } from '@/config/viewerConfig';
import { DxfTabSource } from '@/components/workspace/DxfTabs';
import { useDxfTabs } from '@/components/workspace/DxfTabs';
import { UiTheme, DrawingColorMode, ResolvedUiTheme } from '@/types';
import { Language, t } from '@/config/i18n';
import { readViewerUiSettings } from '@/components/viewer/viewerUiSettings';

export interface DxfWorkspaceProps {
  editor?: boolean;
  initialFiles?: DxfTabSource[];
}

interface TabContextMenuState {
  tabId: string;
  x: number;
  y: number;
}

function DxfWorkspace({ editor = true, initialFiles = [] }: DxfWorkspaceProps) {
  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const globalFileInputRef = useRef<HTMLInputElement>(null);
  const [tabContextMenu, setTabContextMenu] = useState<TabContextMenuState | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const {
    tabs,
    activeTabId,
    setActiveTabId,
    openFiles,
    openUrl,
    closeTab,
    closeAllTabs,
    closeOtherTabs,
    closeTabsToLeft,
    closeTabsToRight,
  } = useDxfTabs(editor, initialFiles);

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

  const handleTabOpenFailed = (tabId: string, message: string) => {
    closeTab(tabId);
    showAppToast(message);
  };

  const effectiveActiveTabId = useMemo(() => {
    if (tabs.some(tab => tab.id === activeTabId)) return activeTabId;
    return tabs[0]?.id || '';
  }, [activeTabId, tabs]);

  useEffect(() => {
    if (tabs.length > 0 && effectiveActiveTabId && activeTabId !== effectiveActiveTabId) {
      setActiveTabId(effectiveActiveTabId);
    }
  }, [activeTabId, effectiveActiveTabId, setActiveTabId, tabs.length]);

  useEffect(() => {
    const handleGlobalOpen = (event: Event) => {
      const customEvent = event as CustomEvent<{ file?: File; files?: File[] }>;
      const files = customEvent.detail?.files || (customEvent.detail?.file ? [customEvent.detail.file] : []);
      openFiles(files);
    };

    const handleGlobalUrlOpen = (event: Event) => {
      const customEvent = event as CustomEvent<{ url: string }>;
      if (customEvent.detail?.url) {
        openUrl(customEvent.detail.url);
      }
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
    if (!tabContextMenu) return;

    const closeContextMenu = () => setTabContextMenu(null);
    const closeContextMenuByKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeContextMenu();
    };

    window.addEventListener('click', closeContextMenu);
    window.addEventListener('contextmenu', closeContextMenu);
    window.addEventListener('keydown', closeContextMenuByKeyboard);
    return () => {
      window.removeEventListener('click', closeContextMenu);
      window.removeEventListener('contextmenu', closeContextMenu);
      window.removeEventListener('keydown', closeContextMenuByKeyboard);
    };
  }, [tabContextMenu]);


  useEffect(() => {
    if (!effectiveActiveTabId || !tabsContainerRef.current) return;
    const activeElement = tabsContainerRef.current.querySelector<HTMLElement>(`[data-tab-id="${effectiveActiveTabId}"]`);
    activeElement?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [effectiveActiveTabId, tabs.length]);

  const handleCloseTab = (event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    closeTab(id);
  };

  const scrollTabs = (delta: number) => {
    if (!tabsContainerRef.current) return;
    tabsContainerRef.current.scrollBy({ left: delta, behavior: 'smooth' });
  };

  const handleTabScroll = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!tabsContainerRef.current) return;
    tabsContainerRef.current.scrollLeft += event.deltaY || event.deltaX;
  };

  const handleTabContextMenu = (event: React.MouseEvent, tabId: string) => {
    if (!editor) return;
    event.preventDefault();
    event.stopPropagation();
    setActiveTabId(tabId);
    setTabContextMenu({ tabId, x: event.clientX, y: event.clientY });
  };

  const runTabCommand = (command: () => void) => (event: React.MouseEvent) => {
    event.stopPropagation();
    command();
    setTabContextMenu(null);
  };

  const tabDensityClass = tabs.length > TABS_CONFIG.denseThreshold ? 'dense' : tabs.length > TABS_CONFIG.compactThreshold ? 'compact' : '';

  const tabStrip = tabs.length > 0 ? (
    <div className={`tabs-container ${tabDensityClass}`}>
      {tabs.length > 8 && (
        <button type="button" className="tab-scroll-button" onClick={() => scrollTabs(-TABS_CONFIG.scrollStep)} title={t(lang, 'scrollTabsLeft')} aria-label={t(lang, 'scrollTabsLeft')}>
          <ViewerIcon name="chevronLeft" />
        </button>
      )}
      <div className="tabs-scroll-viewport" ref={tabsContainerRef} onWheel={handleTabScroll}>
        {tabs.map(tab => (
          <div
            key={tab.id}
            data-tab-id={tab.id}
            className={`tab-item ${effectiveActiveTabId === tab.id ? 'active' : ''} ${!editor ? 'no-close' : ''}`}
            onClick={() => setActiveTabId(tab.id)}
            onContextMenu={(event) => handleTabContextMenu(event, tab.id)}
            title={tab.name}
          >
            <span className="tab-name">{tab.name}</span>
            {editor && (
              <span className="tab-close" onClick={(event) => handleCloseTab(event, tab.id)} aria-label={t(lang, 'closeTabAriaLabel')}>
                <ViewerIcon name="close" />
              </span>
            )}
          </div>
        ))}
      </div>
      {tabs.length > 8 && (
        <button type="button" className="tab-scroll-button" onClick={() => scrollTabs(TABS_CONFIG.scrollStep)} title={t(lang, 'scrollTabsRight')} aria-label={t(lang, 'scrollTabsRight')}>
          <ViewerIcon name="chevronRight" />
        </button>
      )}

      {tabContextMenu && (
        <div
          className="tab-context-menu"
          style={{ left: tabContextMenu.x, top: tabContextMenu.y }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button type="button" onClick={runTabCommand(() => closeTab(tabContextMenu.tabId))}>{t(lang, 'closeTab')}</button>
          <button type="button" onClick={runTabCommand(() => closeOtherTabs(tabContextMenu.tabId))}>{t(lang, 'closeOtherTabs')}</button>
          <div className="tab-context-divider" />
          <button type="button" onClick={runTabCommand(() => closeTabsToLeft(tabContextMenu.tabId))}>{t(lang, 'closeTabsToLeft')}</button>
          <button type="button" onClick={runTabCommand(() => closeTabsToRight(tabContextMenu.tabId))}>{t(lang, 'closeTabsToRight')}</button>
          <div className="tab-context-divider" />
          <button type="button" onClick={runTabCommand(closeAllTabs)}>{t(lang, 'closeAllTabs')}</button>
        </div>
      )}
    </div>
  ) : null;

  const handleGlobalFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    event.target.value = '';
    if (files.length > 0) openFiles(files);
  };

  const canvasBgColor = effectiveUiTheme === 'dark' ? CANVAS_THEME_COLORS.black : CANVAS_THEME_COLORS.white;

  return (
    <div className={`app-main-container ${effectiveUiTheme === 'dark' ? 'theme-dark' : ''}`} style={{ '--canvas-bg': canvasBgColor } as React.CSSProperties}>
      {toastMessage && (
        <div className="toast-container app-toast-container">
          <div className="toast error">
            <span className="toast-message">{toastMessage}</span>
            <span className="toast-close" onClick={() => setToastMessage(null)} aria-label={t(lang, 'closeToast')}>
              <ViewerIcon name="close" />
            </span>
          </div>
        </div>
      )}
      {editor && (
        <input
          ref={globalFileInputRef}
          type="file"
          accept=".dxf"
          multiple
          onChange={handleGlobalFileChange}
          className="hidden-file-input"
        />
      )}
      <div className="tabs-content">
        {tabs.length === 0 ? (
          <DxfViewer
            showOpenMenu={editor}
            onOpenFiles={openFiles}
            tabStrip={tabStrip}
            uiTheme={uiTheme} onUiThemeChange={setUiTheme}
            drawingColorMode={drawingColorMode} onDrawingColorModeChange={setDrawingColorMode}
            lang={lang} onLanguageChange={setLang}
          />
        ) : (
          tabs.map(tab => (
            <div
              key={tab.id}
              className="tab-viewer-host"
              style={{
                visibility: effectiveActiveTabId === tab.id ? 'visible' : 'hidden',
                pointerEvents: effectiveActiveTabId === tab.id ? 'auto' : 'none'
              }}
            >
              <DxfViewer
                initFile={tab.file || tab.url}
                fileName={tab.name}
                showOpenMenu={editor}
                onOpenFiles={openFiles}
                tabStrip={tabStrip}
                onOpenFailed={(message) => handleTabOpenFailed(tab.id, message)}
                uiTheme={uiTheme} onUiThemeChange={setUiTheme}
                drawingColorMode={drawingColorMode} onDrawingColorModeChange={setDrawingColorMode}
                lang={lang} onLanguageChange={setLang}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default DxfWorkspace;
