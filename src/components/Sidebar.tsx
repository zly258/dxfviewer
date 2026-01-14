import React, { useState, useMemo, useRef, useEffect } from 'react';
import { AnyEntity, EntityType, DxfLayer } from '../types';
import { getAutoCadColor } from '../utils/colorUtils';
import { ENTITY_TYPE_TRANSLATIONS } from '../constants';

interface SidebarProps {
  layers: Record<string, DxfLayer>;
  entities: AnyEntity[];
  selectedEntityIds: Set<string>;
  onSelectIds: (ids: Set<string>) => void;
  theme: 'black' | 'white';
}

const ROW_HEIGHT = 36; 

type FlatItem = 
  | { type: 'layer'; name: string; layer: DxfLayer; count: number; expanded: boolean }
  | { type: 'entity'; id: string; entity: AnyEntity };

const Sidebar: React.FC<SidebarProps> = ({ layers, entities, selectedEntityIds, onSelectIds, theme }) => {
  const [expandedLayers, setExpandedLayers] = useState<Set<string>>(new Set(Object.keys(layers)));
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(500);

  const entitiesByLayer = useMemo(() => {
    return entities.reduce((acc, ent) => {
      if (!acc[ent.layer]) acc[ent.layer] = [];
      acc[ent.layer].push(ent);
      return acc;
    }, {} as Record<string, AnyEntity[]>);
  }, [entities]);

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

  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 2); 
  const endIndex = Math.min(flatList.length, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + 2); 

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

  const getEntityIcon = (type: EntityType) => <span className="entity-icon">{type.substring(0, 1)}</span>;
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
        图层与实体
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
                                    {ENTITY_TYPE_TRANSLATIONS[item.entity.type] || item.entity.type}
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