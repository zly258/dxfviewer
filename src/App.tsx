import React, { useState, useEffect } from 'react';
import DxfViewerMain from './DxfViewerMain';
import './styles/App.css';

interface Tab {
  id: string;
  name: string;
  file?: File;
  url?: string;
}

interface AppProps {
  editor?: boolean; // 默认为 true。如果为 false，则禁用手动打开/删除文件功能。
  initialFiles?: (File|string)[];
}

function App({ editor = true, initialFiles = [] }: AppProps) {
  const getDefaultName = () => navigator.language.startsWith('zh') ? '新图纸' : 'New Drawing';
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('');
  const tabsContainerRef = React.useRef<HTMLDivElement>(null);

  // 使用可选的 initialFiles 进行初始化
  useEffect(() => {
    if (initialFiles && initialFiles.length > 0) {
      const newTabs: Tab[] = initialFiles.map(f => {
        if (typeof f === 'string') {
          return { id: Math.random().toString(36).substr(2, 9), name: f.split('/').pop() || f, url: f };
        } else {
          return { id: Math.random().toString(36).substr(2, 9), name: f.name, file: f };
        }
      });
      setTabs(newTabs);
      if (newTabs.length > 0) setActiveTabId(newTabs[0].id);
    }
  }, [initialFiles]);

  const addTab = (file: File) => {
    if (!editor) return; // 如果不是编辑模式，防止手动打开
    // 检查文件是否已打开
    const existingTab = tabs.find(t => t.name === file.name);
    if (existingTab) {
      setActiveTabId(existingTab.id);
      return;
    }
    // 否则，添加新标签页
    const newTab = {
      id: Math.random().toString(36).substr(2, 9),
      name: file.name,
      file,
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
  };

  const closeTab = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!editor) return; // 如果不是编辑模式，防止手动关闭
    const newTabs = tabs.filter(t => t.id !== id);
    setTabs(newTabs);
    
    if (newTabs.length === 0) {
      setActiveTabId('');
    } else if (activeTabId === id) {
      setActiveTabId(newTabs[newTabs.length - 1].id);
    }
  };

  const handleGlobalOpen = (e: Event) => {
    const customEvent = e as CustomEvent<{ file: File }>;
    if (customEvent.detail?.file) {
      addTab(customEvent.detail.file);
    }
  };

  useEffect(() => {
    window.addEventListener('open-dxf-file', handleGlobalOpen);
    return () => {
      window.removeEventListener('open-dxf-file', handleGlobalOpen);
    };
  }, [activeTabId, tabs]);

  const handleTabScroll = (e: React.WheelEvent<HTMLDivElement>) => {
    if (tabsContainerRef.current) {
      // 根据鼠标滚轮的垂直移动进行水平滚动
      tabsContainerRef.current.scrollLeft += e.deltaY;
    }
  };

  return (
    <div className="app-main-container" style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div 
        className="tabs-container" 
        ref={tabsContainerRef}
        onWheel={handleTabScroll}
      >
        {tabs.map(tab => (
          <div 
            key={tab.id} 
            className={`tab-item ${activeTabId === tab.id ? 'active' : ''} ${!editor ? 'no-close' : ''}`}
            onClick={() => setActiveTabId(tab.id)}
            title={tab.name}
          >
            <span className="tab-name">{tab.name}</span>
            {editor && <span className="tab-close" onClick={(e) => closeTab(e, tab.id)}>×</span>}
          </div>
        ))}
        {editor && (
          <div className="tab-new" onClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.dxf';
            input.onchange = (e: any) => {
              const file = e.target.files?.[0];
              if (file) addTab(file);
            };
            input.click();
          }}>+</div>
        )}
      </div>
      <div className="tabs-content" style={{ flex: 1, position: 'relative', backgroundColor: '#212121' }}>
        {tabs.length === 0 ? (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            color: '#666', userSelect: 'none'
          }}>
            <svg viewBox="0 0 24 24" style={{ width: 80, height: 80, marginBottom: 20, fill: '#444' }}>
              <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
            </svg>
            <h2 style={{ fontWeight: 'normal', margin: '0 0 10px 0', color: '#888' }}>
              {navigator.language.startsWith('zh') ? '欢迎使用 DXF Viewer' : 'Welcome to DXF Viewer'}
            </h2>
            <p style={{ margin: 0 }}>
              {editor 
                ? (navigator.language.startsWith('zh') ? '点击左上方的 "+" 打开图纸文件' : 'Click the "+" button in the top left to open a drawing')
                : (navigator.language.startsWith('zh') ? '当前处于只读模式，请查看可用图纸' : 'Read-only mode. Please view available drawings.')}
            </p>
          </div>
        ) : (
          tabs.map(tab => (
          <div 
            key={tab.id} 
            style={{ 
              position: 'absolute', 
              top: 0, left: 0, right: 0, bottom: 0, 
              visibility: activeTabId === tab.id ? 'visible' : 'hidden',
              pointerEvents: activeTabId === tab.id ? 'auto' : 'none'
            }}
          >
            <DxfViewerMain 
              initFile={tab.file || tab.url}
              showOpenMenu={editor}
            />
          </div>
        )))}
      </div>
    </div>
  );
}

export default App;
