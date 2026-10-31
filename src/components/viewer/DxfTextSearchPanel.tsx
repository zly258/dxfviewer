import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnyEntity, DxfBlock } from '@/types';
import { ENTITY_TYPE_NAMES, Language, t } from '@/config/i18n';
import {
  buildEntityTextSearchIndex,
  EntityTextSearchEntry,
  searchEntityTextIndex,
  TextSearchMatch,
} from '@/utils/entityTextSearch';
import ViewerIcon from '@/components/common/ViewerIcon';

interface DxfTextSearchPanelProps {
  entities: AnyEntity[];
  blocks: Record<string, DxfBlock>;
  lang: Language;
  onLocate: (match: TextSearchMatch) => void;
  onClose: () => void;
}

/** 小图纸直接同步建索引（无感知）；之上的图纸防抖后构建，避免阻塞首帧输入。 */
const SEARCH_INDEX_SYNC_LIMIT = 5_000;
const SEARCH_INDEX_BUILD_DEBOUNCE_MS = 200;


const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const renderHighlightedPreview = (text: string, query: string): React.ReactNode => {
  const keyword = query.trim();
  if (!keyword) return text;
  const regex = new RegExp(`(${escapeRegExp(keyword)})`, 'ig');
  return text.split(regex).map((part, index) => {
    if (part.toLowerCase() !== keyword.toLowerCase()) return <React.Fragment key={index}>{part}</React.Fragment>;
    return <mark key={index} className="text-search-highlight">{part}</mark>;
  });
};


/** 图纸文字搜索面板，仅搜索当前模型空间或当前图纸空间中的实体文字。 */
const DxfTextSearchPanel: React.FC<DxfTextSearchPanelProps> = ({ entities, blocks, lang, onLocate, onClose }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const entityTypeNames = ENTITY_TYPE_NAMES[lang];

  // 索引构建防抖：小图同步；大图延迟构建（键入前就绪即可），期间结果为空。
  const [searchIndex, setSearchIndex] = useState<EntityTextSearchEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    if (entities.length <= SEARCH_INDEX_SYNC_LIMIT) {
      setSearchIndex(buildEntityTextSearchIndex(entities, blocks));
      return () => { cancelled = true; };
    }
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setSearchIndex(buildEntityTextSearchIndex(entities, blocks));
    }, SEARCH_INDEX_BUILD_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [blocks, entities]);
  const matches = useMemo(() => searchEntityTextIndex(searchIndex, query), [query, searchIndex]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (activeIndex >= matches.length) setActiveIndex(Math.max(0, matches.length - 1));
  }, [activeIndex, matches.length]);

  const locateByIndex = (index: number) => {
    const match = matches[index];
    if (!match) return;
    setActiveIndex(index);
    onLocate(match);
  };

  const locateNext = () => {
    if (matches.length === 0) return;
    locateByIndex((activeIndex + 1) % matches.length);
  };

  const locatePrevious = () => {
    if (matches.length === 0) return;
    locateByIndex((activeIndex - 1 + matches.length) % matches.length);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) locatePrevious();
      else locateNext();
    }
  };

  const hasQuery = query.trim().length > 0;

  return (
    <div className="text-search-panel">
      <div className="text-search-row">
        <ViewerIcon className="text-search-icon" name="search" aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder={t(lang, 'searchPlaceholder')}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          className="text-search-input"
          aria-label={t(lang, 'searchPlaceholder')}
        />
        {hasQuery && (
          <span className="text-search-count">
            {matches.length > 0 ? `${activeIndex + 1}/${matches.length}` : '0/0'}
          </span>
        )}
        <button type="button" className="text-search-nav" onClick={locatePrevious} disabled={matches.length === 0} title={t(lang, 'searchPrevious')} aria-label={t(lang, 'searchPrevious')}>
          <ViewerIcon name="chevronUp" />
        </button>
        <button type="button" className="text-search-nav" onClick={locateNext} disabled={matches.length === 0} title={t(lang, 'searchNext')} aria-label={t(lang, 'searchNext')}>
          <ViewerIcon name="chevronDown" />
        </button>
        <button type="button" className="text-search-close" onClick={onClose} title={t(lang, 'searchClose')} aria-label={t(lang, 'searchClose')}>
          <ViewerIcon name="close" />
        </button>
      </div>

      {hasQuery && (
        <div className="text-search-results">
          {matches.length === 0 && <div className="text-search-empty">{t(lang, 'searchNoResult')}</div>}
          {matches.slice(0, 30).map((match, index) => (
            <button
              key={match.id}
              type="button"
              className={`text-search-result ${index === activeIndex ? 'active' : ''}`}
              onClick={() => locateByIndex(index)}
            >
              <span className="text-search-result-type">{entityTypeNames[match.entity.type] || match.entity.type}</span>
              <span className="text-search-result-text">{renderHighlightedPreview(match.preview, query)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default React.memo(DxfTextSearchPanel);
