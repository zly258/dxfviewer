import React, { useEffect, useMemo, useRef, useState } from 'react';
import DxfViewerMain from '../features/dxf-viewer/DxfViewerMain';
import '../styles/App.css';
import { DxfTabSource } from './tabs/tabModel';
import { useDxfTabs } from './tabs/useDxfTabs';

interface AppProps {
  editor?: boolean;
  initialFiles?: DxfTabSource[];
}

interface TabContextMenuState {
  tabId: string;
  x: number;
  y: number;
}

function App({ editor = true, initialFiles = [] }: AppProps) {
  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const [tabContextMenu, setTabContextMenu] = useState<TabContextMenuState | null>(null);
  const {
    tabs,
    activeTabId,
    setActiveTabId,
    openFiles,
    closeTab,
    closeAllTabs,
    closeOtherTabs,
    closeTabsToLeft,
    closeTabsToRight,
  } = useDxfTabs(editor, initialFiles);

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

    window.addEventListener('open-dxf-file', handleGlobalOpen);
    window.addEventListener('open-dxf-files', handleGlobalOpen);
    return () => {
      window.removeEventListener('open-dxf-file', handleGlobalOpen);
      window.removeEventListener('open-dxf-files', handleGlobalOpen);
    };
  }, [openFiles]);

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

  const handleCloseTab = (event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    closeTab(id);
  };

  const handleTabScroll = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!tabsContainerRef.current) return;
    tabsContainerRef.current.scrollLeft += event.deltaY;
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

  const tabStrip = tabs.length > 0 ? (
    <div className="tabs-container" ref={tabsContainerRef} onWheel={handleTabScroll}>
      {tabs.map(tab => (
        <div
          key={tab.id}
          className={`tab-item ${effectiveActiveTabId === tab.id ? 'active' : ''} ${!editor ? 'no-close' : ''}`}
          onClick={() => setActiveTabId(tab.id)}
          onContextMenu={(event) => handleTabContextMenu(event, tab.id)}
          title={tab.name}
        >
          <span className="tab-name">{tab.name}</span>
          {editor && <span className="tab-close" onClick={(event) => handleCloseTab(event, tab.id)}>×</span>}
        </div>
      ))}

      {tabContextMenu && (
        <div
          className="tab-context-menu"
          style={{ left: tabContextMenu.x, top: tabContextMenu.y }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button type="button" onClick={runTabCommand(() => closeTab(tabContextMenu.tabId))}>关闭当前</button>
          <button type="button" onClick={runTabCommand(() => closeOtherTabs(tabContextMenu.tabId))}>关闭其他</button>
          <div className="tab-context-divider" />
          <button type="button" onClick={runTabCommand(() => closeTabsToLeft(tabContextMenu.tabId))}>关闭左边</button>
          <button type="button" onClick={runTabCommand(() => closeTabsToRight(tabContextMenu.tabId))}>关闭右边</button>
          <div className="tab-context-divider" />
          <button type="button" onClick={runTabCommand(closeAllTabs)}>全部关闭</button>
        </div>
      )}
    </div>
  ) : null;

  return (
    <div className="app-main-container">
      <div className="tabs-content">
        {tabs.length === 0 ? (
          <DxfViewerMain showOpenMenu={editor} onOpenFiles={openFiles} tabStrip={tabStrip} />
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
              <DxfViewerMain
                initFile={tab.file || tab.url}
                fileName={tab.name}
                showOpenMenu={editor}
                onOpenFiles={openFiles}
                tabStrip={tabStrip}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default App;
