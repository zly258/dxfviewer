import React, { useState, useMemo, useRef, useEffect } from 'react';
import { AnyEntity, DxfLayer } from '@/types';
import { getAutoCadColor } from '@/utils/colorUtils';
import { Language, ENTITY_TYPE_NAMES, t as translate } from '@/ui/i18n';
import ViewerIcon from '@/ui/components/common/ViewerIcon';

interface LayerPanelProps {
  layers: Record<string, DxfLayer>;
  entities: AnyEntity[];
  selectedEntityIds: Set<string>;
  onSelectIds: (ids: Set<string>) => void;
  lang: Language;
  hiddenLayers?: Set<string>;
  onToggleLayerVisibility?: (layerName: string) => void;
  className?: string;
}

/** 树行高（web-ui-style §7 VTREE_ROW_H = 26）。 */
const ROW_HEIGHT = 26;
/** 虚拟滚动 overscan 行数。 */
const OVERSCAN = 10;

type SortKey = 'name' | 'count';
type SortDir = 'asc' | 'desc';

type FlatItem =
  | { type: 'layer'; name: string; layer: DxfLayer; count: number; expanded: boolean }
  | { type: 'entity'; id: string; entity: AnyEntity };

/**
 * 图层结构树（web-ui-style §7）。
 *
 * - 树行 26px，--text-sec，hover --bg-hover，选中 --accent-soft + --accent；
 * - 图层行 = 展开箭头 + 可见性复选 + 色块 + 名称 + 计数；
 * - 构件行用左侧 1px 引导线 + 缩进表达层级；
 * - 大列表虚拟滚动（固定行高 + overscan），不一次渲染全部行；
 * - P9：所有省略号文本都带 title。
 */
const LayerPanel: React.FC<LayerPanelProps> = ({
  layers,
  entities,
  selectedEntityIds,
  onSelectIds,
  lang,
  hiddenLayers = new Set(),
  onToggleLayerVisibility,
  className
}) => {
  const [expandedLayers, setExpandedLayers] = useState<Set<string>>(new Set(Object.keys(layers)));
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(500);
  const [searchQuery, setSearchQuery] = useState('');
  const [hideEmptyLayers, setHideEmptyLayers] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const entNames = ENTITY_TYPE_NAMES[lang];

  // 点击菜单外部关闭
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menuOpen]);

  // 将实体按图层分组
  const entitiesByLayer = useMemo(() => {
    return entities.reduce((acc, ent) => {
      if (!acc[ent.layer]) acc[ent.layer] = [];
      acc[ent.layer].push(ent);
      return acc;
    }, {} as Record<string, AnyEntity[]>);
  }, [entities]);

  // 生成扁平化列表用于虚拟滚动
  const flatList = useMemo(() => {
    const list: FlatItem[] = [];
    let layerNames = Object.keys(layers);

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      layerNames = layerNames.filter(name => name.toLowerCase().includes(q));
    }

    if (hideEmptyLayers) {
      layerNames = layerNames.filter(name => (entitiesByLayer[name]?.length ?? 0) > 0);
    }

    layerNames.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'name') {
        cmp = a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
      } else {
        const ca = entitiesByLayer[a]?.length ?? 0;
        const cb = entitiesByLayer[b]?.length ?? 0;
        cmp = ca - cb;
        if (cmp === 0) cmp = a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    for (const name of layerNames) {
      const layerEnts = entitiesByLayer[name] || [];
      const isExpanded = expandedLayers.has(name);

      list.push({
        type: 'layer',
        name,
        layer: layers[name],
        count: layerEnts.length,
        expanded: isExpanded
      });

      if (isExpanded) {
        for (const ent of layerEnts) {
          list.push({ type: 'entity', id: ent.id, entity: ent });
        }
      }
    }
    return list;
  }, [layers, entitiesByLayer, expandedLayers, searchQuery, hideEmptyLayers, sortKey, sortDir]);

  const totalHeight = flatList.length * ROW_HEIGHT;

  // 监听容器高度变化
  useEffect(() => {
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }
    return () => resizeObserver.disconnect();
  }, []);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  // 计算可见范围索引
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(flatList.length, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN);

  const visibleItems = flatList.slice(startIndex, endIndex);
  const offsetY = startIndex * ROW_HEIGHT;

  const toggleLayer = (layerName: string) => {
    const next = new Set(expandedLayers);
    if (next.has(layerName)) next.delete(layerName);
    else next.add(layerName);
    setExpandedLayers(next);
  };

  const handleItemClick = (id: string, multi: boolean) => {
    if (multi) {
      const newSet = new Set(selectedEntityIds);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      onSelectIds(newSet);
    } else {
      onSelectIds(new Set([id]));
    }
  };

  const getLayerColorHex = (layer: DxfLayer) => getAutoCadColor(layer.color);

  const layerCount = Object.keys(layers).length;
  const filteredCount = flatList.filter(i => i.type === 'layer').length;

  return (
    <div className={`layer-panel ${className || ''}`}>
      <div className="layer-panel-header">
        <span className="layer-panel-title" title={translate(lang, 'layersTitle')}>
          {translate(lang, 'layersTitle')}
        </span>
        {layerCount > 0 && (
          <span className="layer-panel-header-count" title={`${filteredCount}/${layerCount}`}>
            {filteredCount}/{layerCount}
          </span>
        )}
        <div className="layer-header-menu" ref={menuRef}>
          <button
            type="button"
            className={`layer-tool-btn ${menuOpen ? 'active' : ''}`}
            title={translate(lang, 'layerOptions')}
            aria-label={translate(lang, 'layerOptions')}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(event) => { event.stopPropagation(); setMenuOpen(v => !v); }}
          >
            <ViewerIcon name="more" />
          </button>
          {menuOpen && (
            <div className="dropdown-menu layer-panel-menu" role="menu" onClick={(event) => event.stopPropagation()}>
              <button
                type="button"
                className={`dropdown-item ${hideEmptyLayers ? 'checked' : ''}`}
                onClick={() => setHideEmptyLayers(v => !v)}
              >
                <span>{translate(lang, 'layerFilterEmpty')}</span>
              </button>
              <div className="divider" />
              <button
                type="button"
                className={`dropdown-item ${sortKey === 'name' ? 'checked' : ''}`}
                onClick={() => setSortKey('name')}
              >
                <span>{translate(lang, 'layerSortName')}</span>
              </button>
              <button
                type="button"
                className={`dropdown-item ${sortKey === 'count' ? 'checked' : ''}`}
                onClick={() => setSortKey('count')}
              >
                <span>{translate(lang, 'layerSortCount')}</span>
              </button>
              <div className="divider" />
              <button
                type="button"
                className={`dropdown-item ${sortDir === 'asc' ? 'checked' : ''}`}
                onClick={() => setSortDir('asc')}
              >
                <span>{translate(lang, 'layerSortAsc')}</span>
              </button>
              <button
                type="button"
                className={`dropdown-item ${sortDir === 'desc' ? 'checked' : ''}`}
                onClick={() => setSortDir('desc')}
              >
                <span>{translate(lang, 'layerSortDesc')}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 搜索行：26px 输入框 */}
      <div className="layer-toolbar">
        <div className="layer-search-box">
          <ViewerIcon className="layer-search-icon" name="search" />
          <input
            ref={searchInputRef}
            className="layer-search-input"
            type="text"
            placeholder={translate(lang, 'layerSearch')}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            spellCheck={false}
            aria-label={translate(lang, 'layerSearch')}
          />
          {searchQuery && (
            <button
              type="button"
              className="layer-search-clear"
              onClick={() => { setSearchQuery(''); searchInputRef.current?.focus(); }}
              tabIndex={-1}
              title={translate(lang, 'clearSearch')}
              aria-label={translate(lang, 'clearSearch')}
            >
              <ViewerIcon name="close" />
            </button>
          )}
        </div>
      </div>

      <div
        ref={containerRef}
        className="layer-panel-content"
        onScroll={handleScroll}
      >
        {flatList.length === 0 && (
          <div className="layer-empty-hint">{translate(lang, 'layerEmptyHint')}</div>
        )}
        <div style={{ height: totalHeight, position: 'relative' }}>
          <div style={{ transform: `translateY(${offsetY}px)` }}>
            {visibleItems.map((item) => {
              const key = item.type === 'layer' ? `L_${item.name}` : `E_${item.id}`;

              if (item.type === 'layer') {
                const colorHex = getLayerColorHex(item.layer);
                const isHidden = hiddenLayers.has(item.name);
                return (
                  <div
                    key={key}
                    className={`tree-row tree-layer layer-row ${isHidden ? 'layer-hidden' : ''}`}
                    onClick={() => toggleLayer(item.name)}
                    title={item.name}
                  >
                    <ViewerIcon className={`chevron ${item.expanded ? 'expanded' : ''}`} name="chevronRight" />
                    <span
                      className="layer-visibility-toggle"
                      role="checkbox"
                      aria-checked={!isHidden}
                      tabIndex={-1}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleLayerVisibility?.(item.name);
                      }}
                      title={isHidden ? translate(lang, 'showLayer') : translate(lang, 'hideLayer')}
                    >
                      <span className={`tree-check ${isHidden ? '' : 'checked'}`} aria-hidden="true" />
                    </span>
                    <div className="layer-icon" style={{ backgroundColor: colorHex }} aria-hidden="true" />
                    <span className="layer-name tree-label">{item.name}</span>
                    <span className="layer-count tree-count">{item.count}</span>
                  </div>
                );
              }

              const isSelected = selectedEntityIds.has(item.id);
              const typeLabel = entNames[item.entity.type] || item.entity.type;
              return (
                <div
                  key={key}
                  onClick={(e) => handleItemClick(item.id, e.ctrlKey || e.metaKey)}
                  className={`tree-row tree-comp entity-row ${isSelected ? 'selected' : ''}`}
                  title={typeLabel}
                >
                  <span className="entity-name tree-label">{typeLabel}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(LayerPanel);
