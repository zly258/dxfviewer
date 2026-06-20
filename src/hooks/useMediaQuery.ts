import { useEffect, useState } from 'react';

/**
 * 监听 CSS 媒体查询，返回当前是否匹配。
 * SSR 安全：window 不存在时返回 false。
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

/** 是否处于移动端布局（<= 768px）。 */
export const useIsMobile = (): boolean => useMediaQuery('(max-width: 768px)');
