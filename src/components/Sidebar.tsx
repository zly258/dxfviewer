import React, { useState, useMemo, useRef, useEffect } from 'react';
import { AnyEntity, EntityType, DxfLayer } from '../types';
import { getAutoCadColor } from '../utils/colorUtils';
import { Language, UI_TRANSLATIONS, ENTITY_TYPE_NAMES } from '../constants/i18n';

interface SidebarProps {
  layers: Record<string, DxfLayer>;
  entities: AnyEntity[];
  selectedEntityIds: Set<string>;
  onSelectIds: (ids: Set<string>) => void;
  theme: 'black' | 'white' | 'gray';
  lang: Language;
}

const ROW_HEIGHT = 26; // 列表项高度

type FlatItem = 
  | { type: 'layer'; name: string; layer: DxfLayer; count: number; expanded: boolean }
  | { type: 'entity'; id: string; entity: AnyEntity };

const Sidebar: React.FC<SidebarProps> = ({ layers, entities, selectedEntityIds, onSelectIds, theme, lang }) => {
  const [expandedLayers, setExpandedLayers] = useState<Set<string>>(new Set(Object.keys(layers)));
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(500);
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

  // 生成扁平化的列表用于虚拟滚动
  const flatList = useMemo(() => {
    const list: FlatItem[] = [];
    const layerNames = Object.keys(layers).sort();

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
  }, [layers, entitiesByLayer, expandedLayers]);

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
  const getLayerColorHex = (layer: DxfLayer) => getAutoCadColor(layer.color, theme);

  const ChevronIcon = ({ expanded }: { expanded: boolean }) => (
    <svg 
      className={`chevron ${expanded ? 'expanded' : ''}`} 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="3" 
      strokeLinecap="round" 
      strokeLinejoin="round"
    >
      <polyline points="9 18 15 12 9 6"></polyline>
    </svg>
  );

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        {t.layersTitle}
      </div>
      
      <div 
        ref={containerRef}
        className="sidebar-content"
        onScroll={handleScroll}
      >
        <div style={{ height: totalHeight, position: 'relative' }}>
            <div style={{ transform: `translateY(${offsetY}px)` }}>
                {visibleItems.map((item) => {
                    const key = item.type === 'layer' ? `L_${item.name}` : `E_${item.id}`;
                    
                    if (item.type === 'layer') {
                        const colorHex = getLayerColorHex(item.layer);
                        return (
                            <div 
                                key={key}
                                className="layer-row"
                                onClick={() => toggleLayer(item.name)}
                            >
                                <ChevronIcon expanded={item.expanded} />
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

export default Sidebar;