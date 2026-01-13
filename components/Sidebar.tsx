import React, { useState, useMemo, useRef, useEffect } from 'react';
import { AnyEntity, EntityType, DxfLayer } from '../types';
import { AUTO_CAD_COLORS, DEFAULT_COLOR } from '../constants';

interface SidebarProps {
  layers: Record<string, DxfLayer>;
  entities: AnyEntity[];
  selectedEntityIds: Set<string>;
  onSelectIds: (ids: Set<string>) => void;
}

const ROW_HEIGHT = 36; 

type FlatItem = 
  | { type: 'layer'; name: string; layer: DxfLayer; count: number; expanded: boolean }
  | { type: 'entity'; id: string; entity: AnyEntity };

const Sidebar: React.FC<SidebarProps> = ({ layers, entities, selectedEntityIds, onSelectIds }) => {
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

  const getEntityIcon = (type: EntityType) => <span className="text-xs font-bold text-gray-400 w-6 text-center inline-block">{type.substring(0, 1)}</span>;
  const getLayerColorHex = (layer: DxfLayer) => AUTO_CAD_COLORS[layer.color] || '#000000';

  const ChevronIcon = ({ expanded }: { expanded: boolean }) => (
    <svg 
      className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-200 mr-1 ${expanded ? 'rotate-90' : ''}`} 
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
    <div className="w-64 bg-white border-r border-gray-300 flex flex-col h-full shrink-0 z-20 font-sans text-sm">
      <div className="h-10 bg-gray-50 border-b border-gray-200 flex items-center px-3 text-xs font-bold text-gray-500 uppercase tracking-widest shrink-0">
        图层与实体
      </div>
      
      <div 
        ref={containerRef}
        className="flex-1 overflow-y-auto overflow-x-hidden bg-white"
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
                                className="flex items-center px-2 hover:bg-gray-100 cursor-pointer select-none group border-b border-gray-50 h-[36px]"
                                onClick={() => toggleLayer(item.name)}
                            >
                                <ChevronIcon expanded={item.expanded} />
                                <div className="w-3.5 h-3.5 rounded-full mr-2 border border-gray-200 shrink-0" style={{ backgroundColor: colorHex }}></div>
                                <span className="font-medium text-gray-700 truncate">{item.name}</span>
                                <span className="ml-auto text-xs text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity pr-1">{item.count}</span>
                            </div>
                        );
                    } else {
                        const isSelected = selectedEntityIds.has(item.id);
                        return (
                            <div 
                                key={key}
                                onClick={(e) => handleItemClick(item.id, e.ctrlKey || e.metaKey)}
                                className={`flex items-center pl-8 pr-2 cursor-pointer h-[36px] border-b border-gray-50 ${isSelected ? 'bg-blue-50 text-blue-700' : 'text-gray-500 hover:bg-gray-50'}`}
                            >
                                {getEntityIcon(item.entity.type)}
                                <span className="truncate flex-1 font-mono text-xs">{item.entity.type}</span>
                                {isSelected && <div className="w-1.5 h-1.5 bg-blue-500 rounded-full"></div>}
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