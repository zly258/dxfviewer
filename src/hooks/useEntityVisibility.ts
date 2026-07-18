import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { AnyEntity } from '@/types';

export const useEntityVisibility = (entities: AnyEntity[]) => {
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(new Set());
  const [hiddenEntityIds, setHiddenEntityIds] = useState<Set<string>>(new Set());
  const [isolatedEntityIds, setIsolatedEntityIds] = useState<Set<string> | null>(null);

  const hiddenLayersRef = useRef(hiddenLayers);
  useEffect(() => {
    hiddenLayersRef.current = hiddenLayers;
  }, [hiddenLayers]);

  const toggleLayerVisibility = useCallback((layerName: string) => {
    setHiddenLayers(prev => {
      const next = new Set(prev);
      if (next.has(layerName)) next.delete(layerName);
      else next.add(layerName);
      return next;
    });
  }, []);

  const displayEntities = useMemo(() => {
    return entities.filter(entity => {
      if (hiddenEntityIds.has(entity.id)) return false;
      if (isolatedEntityIds && !isolatedEntityIds.has(entity.id)) return false;
      return true;
    });
  }, [entities, hiddenEntityIds, isolatedEntityIds]);

  const resetVisibility = useCallback(() => {
    setHiddenLayers(new Set());
    setHiddenEntityIds(new Set());
    setIsolatedEntityIds(null);
  }, []);

  return {
    hiddenLayers,
    setHiddenLayers,
    hiddenLayersRef,
    hiddenEntityIds,
    setHiddenEntityIds,
    isolatedEntityIds,
    setIsolatedEntityIds,
    toggleLayerVisibility,
    displayEntities,
    resetVisibility
  };
};
