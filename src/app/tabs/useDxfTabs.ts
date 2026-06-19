import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getFileIdentity } from '../../shared/utils/fileUtils';
import { createDxfTab, DxfTab, DxfTabSource } from './tabModel';

const findNextActiveId = (tabs: DxfTab[], closeIndex: number): string => {
  const previousTab = tabs[Math.max(0, closeIndex - 1)];
  return previousTab?.id || tabs[0]?.id || '';
};

export const useDxfTabs = (editor: boolean, initialFiles: DxfTabSource[] = []) => {
  const [tabs, setTabs] = useState<DxfTab[]>([]);
  const [activeTabId, setActiveTabId] = useState('');
  const tabsRef = useRef<DxfTab[]>([]);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  const activeTab = useMemo(() => tabs.find(tab => tab.id === activeTabId), [activeTabId, tabs]);

  const openFiles = useCallback((files: File[]) => {
    if (!editor || files.length === 0) return;

    const currentTabs = tabsRef.current;
    const openedMap = new Map<string, DxfTab>();
    currentTabs.forEach(tab => {
      if (tab.file) openedMap.set(getFileIdentity(tab.file), tab);
    });

    const nextTabs = [...currentTabs];
    let nextActiveId = activeTabId;

    files.forEach(file => {
      const key = getFileIdentity(file);
      const existingTab = openedMap.get(key);
      if (existingTab) {
        nextActiveId = existingTab.id;
        return;
      }

      const tab = createDxfTab(file);
      openedMap.set(key, tab);
      nextTabs.push(tab);
      nextActiveId = tab.id;
    });

    setTabs(nextTabs);
    if (nextActiveId) setActiveTabId(nextActiveId);
  }, [activeTabId, editor]);

  const openUrl = useCallback((url: string) => {
    if (!editor || !url) return;
    const currentTabs = tabsRef.current;
    const existingTab = currentTabs.find(tab => tab.url === url);
    if (existingTab) {
      setActiveTabId(existingTab.id);
      return;
    }
    const tab = createDxfTab(url);
    setTabs([...currentTabs, tab]);
    setActiveTabId(tab.id);
  }, [editor]);

  const closeTab = useCallback((id: string) => {
    if (!editor) return;

    const currentTabs = tabsRef.current;
    const closeIndex = currentTabs.findIndex(tab => tab.id === id);
    if (closeIndex < 0) return;

    const nextTabs = currentTabs.filter(tab => tab.id !== id);
    setTabs(nextTabs);

    if (activeTabId === id || !nextTabs.some(tab => tab.id === activeTabId)) {
      setActiveTabId(findNextActiveId(nextTabs, closeIndex));
    }
  }, [activeTabId, editor]);

  const closeAllTabs = useCallback(() => {
    if (!editor) return;
    setTabs([]);
    setActiveTabId('');
  }, [editor]);

  const closeOtherTabs = useCallback((id: string) => {
    if (!editor) return;
    const targetTab = tabsRef.current.find(tab => tab.id === id);
    if (!targetTab) return;
    setTabs([targetTab]);
    setActiveTabId(targetTab.id);
  }, [editor]);

  const closeTabsToLeft = useCallback((id: string) => {
    if (!editor) return;
    const currentTabs = tabsRef.current;
    const index = currentTabs.findIndex(tab => tab.id === id);
    if (index < 0) return;
    const nextTabs = currentTabs.slice(index);
    setTabs(nextTabs);
    if (!nextTabs.some(tab => tab.id === activeTabId)) setActiveTabId(id);
  }, [activeTabId, editor]);

  const closeTabsToRight = useCallback((id: string) => {
    if (!editor) return;
    const currentTabs = tabsRef.current;
    const index = currentTabs.findIndex(tab => tab.id === id);
    if (index < 0) return;
    const nextTabs = currentTabs.slice(0, index + 1);
    setTabs(nextTabs);
    if (!nextTabs.some(tab => tab.id === activeTabId)) setActiveTabId(id);
  }, [activeTabId, editor]);

  useEffect(() => {
    if (!initialFiles.length) return;
    const newTabs = initialFiles.map(createDxfTab);
    setTabs(newTabs);
    setActiveTabId(newTabs[0]?.id || '');
  }, [initialFiles]);

  return {
    tabs,
    activeTab,
    activeTabId,
    setActiveTabId,
    openFiles,
    openUrl,
    closeTab,
    closeAllTabs,
    closeOtherTabs,
    closeTabsToLeft,
    closeTabsToRight,
  };
};
