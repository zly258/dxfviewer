import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { AnyEntity, EntityType, DxfLayer } from '@/types';
import { getAutoCadColor } from '@/utils/colorUtils';
import { Language, UI_TRANSLATIONS, ENTITY_TYPE_NAMES, t as translate } from '@/config/i18n';
import ViewerIcon from '@/components/common/ViewerIcon';

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

const ROW_HEIGHT = 26; // 列表项高度。

type SortKey = 'name' | 'count';
type SortDir = 'asc' | 'desc';

type FlatItem = 
  | { type: 'layer'; name: string; layer: DxfLayer; count: number; expanded: boolean }
  | { type: 'entity'; id: string; entity: AnyEntity };

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
  const t = UI_TRANSLATIONS[lang];
  const entNames = ENTITY_TYPE_NAMES[lang];

  // 将实体按图层分组
  const entitiesByLayer = useMemo(() => {
    return entities.reduce((acc, ent) => {
      if (!acc[ent.layer]) acc[ent.layer] = [];
      acc[ent.layer].push(ent);
      return acc;
    }, {} as Record<string, AnyEntity[]>);
  }, [entities]);

  // 切换排序方向
  const handleSortToggle = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'count' ? 'desc' : 'asc');
    }
  }, [sortKey]);

  // 生成扁平化的列表用于虚拟滚动
  const flatList = useMemo(() => {
    const list: FlatItem[] = [];
    let layerNames = Object.keys(layers);

    // 搜索过滤
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      layerNames = layerNames.filter(name => name.toLowerCase().includes(q));
    }

    // 空图层过滤
    if (hideEmptyLayers) {
      layerNames = layerNames.filter(name => (entitiesByLayer[name]?.length ?? 0) > 0);
    }

    // 排序
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
                list.push({
                    type: 'entity',
                    id: ent.id,
                    entity: ent
                });
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
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 2); 
  const endIndex = Math.min(flatList.length, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + 2); 

  const visibleItems = flatList.slice(startIndex, endIndex);
  const offsetY = startIndex * ROW_HEIGHT;

  // 展开/收起图层
  const toggleLayer = (layerName: string) => {
    const next = new Set(expandedLayers);
    if (next.has(layerName)) next.delete(layerName);
    else next.add(layerName);
    setExpandedLayers(next);
  };

  // 处理项点击
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

  // 获取实体图标
  const getEntityIcon = (type: EntityType) => <span className="entity-icon">{type.substring(0, 1)}</span>;
  
  // 获取图层颜色十六进制
  const getLayerColorHex = (layer: DxfLayer) => getAutoCadColor(layer.color);

  const renderSortIndicator = (key: SortKey) => {
    if (sortKey !== key) return null;
    return <ViewerIcon className="layer-tool-sort-indicator" name={sortDir === 'asc' ? 'sortAsc' : 'sortDesc'} />;
  };

  const layerCount = Object.keys(layers).length;
  const filteredCount = flatList.filter(i => i.type === 'layer').length;

  return (
    <div className={`layer-panel ${className || ''}`}>
      <div className="layer-panel-header">
        <span className="layer-panel-title">{t.layersTitle}</span>
        {layerCount > 0 && (
          <span className="layer-panel-header-count">{filteredCount}/{layerCount}</span>
        )}
      </div>

      {/* 搜索 & 工具栏 */}
      <div className="layer-toolbar">
        <div className="layer-search-box">
          <ViewerIcon className="layer-search-icon" name="search" />
          <input
            ref={searchInputRef}
            className="layer-search-input"
            type="text"
            placeholder={t.layerSearch || 'Search layers…'}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            spellCheck={false}
          />
          {searchQuery && (
            <button
              className="layer-search-clear"
              onClick={() => { setSearchQuery(''); searchInputRef.current?.focus(); }}
              tabIndex={-1}
              title="Clear"
            >
              <ViewerIcon name="close" />
            </button>
          )}
        </div>

        <div className="layer-toolbar-actions">
          {/* 隐藏空图层 */}
          <button
            className={`layer-tool-btn ${hideEmptyLayers ? 'active' : ''}`}
            title={t.layerFilterEmpty || 'Hide empty layers'}
            onClick={() => setHideEmptyLayers(v => !v)}
          >
            <ViewerIcon name="filterEmpty" />
          </button>

          {/* 按名称排序 */}
          <button
            className={`layer-tool-btn ${sortKey === 'name' ? 'active' : ''}`}
            title={t.layerSortName || 'Sort by name'}
            onClick={() => handleSortToggle('name')}
          >
            <ViewerIcon name="sortName" />
            {renderSortIndicator('name')}
          </button>

          {/* 按数量排序 */}
          <button
            className={`layer-tool-btn ${sortKey === 'count' ? 'active' : ''}`}
            title={t.layerSortCount || 'Sort by count'}
            onClick={() => handleSortToggle('count')}
          >
            <ViewerIcon name="sortCount" />
            {renderSortIndicator('count')}
          </button>
        </div>
      </div>
      
      <div 
        ref={containerRef}
        className="layer-panel-content"
        onScroll={handleScroll}
      >
        {flatList.length === 0 && (
          <div className="layer-empty-hint">
            {t.layerEmptyHint || 'No matching layers'}
          </div>
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
                                className={`layer-row ${isHidden ? 'layer-hidden' : ''}`}
                                onClick={() => toggleLayer(item.name)}
                            >
                                <ViewerIcon className={`chevron ${item.expanded ? 'expanded' : ''}`} name="chevronRight" />
                                <div 
                                    className="layer-visibility-toggle"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onToggleLayerVisibility?.(item.name);
                                    }}
                                    title={isHidden ? translate(lang, 'showLayer') : translate(lang, 'hideLayer')}
                                >
                                    <ViewerIcon className="layer-checkbox-icon" name={isHidden ? 'checkboxEmpty' : 'checkboxChecked'} />
                                </div>
                                <div className="layer-icon" style={{ backgroundColor: colorHex }}></div>
                                <span className="layer-name">{item.name}</span>
                                <span className="layer-count">{item.count}</span>
                            </div>
                        );
                    } else {
                        const isSelected = selectedEntityIds.has(item.id);
                        return (
                            <div 
                                key={key}
                                onClick={(e) => handleItemClick(item.id, e.ctrlKey || e.metaKey)}
                                className={`entity-row ${isSelected ? 'selected' : ''}`}
                            >
                                {getEntityIcon(item.entity.type)}
                                <span className="entity-name">
                            {entNames[item.entity.type] || item.entity.type}
                          </span>
                                {isSelected && <div className="selection-dot"></div>}
                            </div>
                        );
                    }
                })}
            </div>
        </div>
      </div>
    </div>
  );
};

export default LayerPanel;
