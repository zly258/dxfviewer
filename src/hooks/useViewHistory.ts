import { useState, useRef, useCallback, useEffect } from 'react';
import { ViewPort } from '@/types';
import { VIEWER_DEFAULTS } from '@/config/viewerConfig';

/** 判断两个视图是否足够接近，避免同一视图重复入栈。 */
const isSameViewPort = (a: ViewPort, b: ViewPort): boolean => {
  const positionBase = Math.max(1, Math.abs(a.targetX), Math.abs(a.targetY), Math.abs(b.targetX), Math.abs(b.targetY));
  const zoomBase = Math.max(1, Math.abs(a.zoom), Math.abs(b.zoom));
  const positionTolerance = VIEWER_DEFAULTS.viewHistoryPositionTolerance * positionBase;
  const zoomTolerance = VIEWER_DEFAULTS.viewHistoryZoomTolerance * zoomBase;
  return Math.abs(a.targetX - b.targetX) <= positionTolerance
    && Math.abs(a.targetY - b.targetY) <= positionTolerance
    && Math.abs(a.zoom - b.zoom) <= zoomTolerance;
};

export const useViewHistory = (initialViewPort: ViewPort, hasEntities: boolean) => {
  const [viewPort, setViewPort] = useState<ViewPort>(initialViewPort);
  const [viewHistory, setViewHistory] = useState<ViewPort[]>([]);
  const [viewHistoryIndex, setViewHistoryIndex] = useState(-1);
  
  const viewHistoryRef = useRef<ViewPort[]>([]);
  const viewHistoryIndexRef = useRef(-1);
  const viewHistoryTimerRef = useRef<number | undefined>(undefined);
  const isRestoringViewHistoryRef = useRef(false);

  const clearViewHistoryTimer = useCallback(() => {
    if (viewHistoryTimerRef.current !== undefined) {
      window.clearTimeout(viewHistoryTimerRef.current);
      viewHistoryTimerRef.current = undefined;
    }
  }, []);

  const applyViewHistory = useCallback((history: ViewPort[], index: number) => {
    viewHistoryRef.current = history;
    viewHistoryIndexRef.current = index;
    setViewHistory(history);
    setViewHistoryIndex(index);
  }, []);

  const resetViewHistory = useCallback(() => {
    clearViewHistoryTimer();
    applyViewHistory([], -1);
  }, [applyViewHistory, clearViewHistoryTimer]);

  const commitViewHistory = useCallback((nextViewPort: ViewPort) => {
    const history = viewHistoryRef.current;
    const currentIndex = viewHistoryIndexRef.current;
    const currentViewPort = currentIndex >= 0 ? history[currentIndex] : undefined;
    if (currentViewPort && isSameViewPort(currentViewPort, nextViewPort)) return;

    const baseHistory = currentIndex >= 0 ? history.slice(0, currentIndex + 1) : [];
    const lastViewPort = baseHistory[baseHistory.length - 1];
    if (lastViewPort && isSameViewPort(lastViewPort, nextViewPort)) return;

    const limitedHistory = [...baseHistory, nextViewPort].slice(-VIEWER_DEFAULTS.viewHistoryMaxSize);
    applyViewHistory(limitedHistory, limitedHistory.length - 1);
  }, [applyViewHistory]);

  const goToViewHistory = useCallback((nextIndex: number) => {
    const history = viewHistoryRef.current;
    if (nextIndex < 0 || nextIndex >= history.length) return;
    clearViewHistoryTimer();
    isRestoringViewHistoryRef.current = true;
    viewHistoryIndexRef.current = nextIndex;
    setViewHistoryIndex(nextIndex);
    setViewPort(history[nextIndex]);
  }, [clearViewHistoryTimer]);

  const handlePreviousView = useCallback(() => {
    goToViewHistory(viewHistoryIndexRef.current - 1);
  }, [goToViewHistory]);

  const handleNextView = useCallback(() => {
    goToViewHistory(viewHistoryIndexRef.current + 1);
  }, [goToViewHistory]);

  useEffect(() => {
    if (isRestoringViewHistoryRef.current) {
      isRestoringViewHistoryRef.current = false;
      return;
    }
    if (!hasEntities) return;
    clearViewHistoryTimer();
    viewHistoryTimerRef.current = window.setTimeout(() => {
      commitViewHistory(viewPort);
      viewHistoryTimerRef.current = undefined;
    }, VIEWER_DEFAULTS.viewHistoryIdleMs);

    return clearViewHistoryTimer;
  }, [clearViewHistoryTimer, commitViewHistory, hasEntities, viewPort]);
  
  return {
    viewPort,
    setViewPort,
    viewHistory,
    viewHistoryIndex,
    resetViewHistory,
    handlePreviousView,
    handleNextView,
    canGoPreviousView: viewHistoryIndex > 0,
    canGoNextView: viewHistoryIndex >= 0 && viewHistoryIndex < viewHistory.length - 1,
    commitViewHistory
  };
};
