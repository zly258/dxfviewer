import { bench, describe } from 'vitest';
import { createSceneIndex, SceneBounds } from '@/renderer/services/sceneIndex';
import { AnyEntity, EntityType } from '@/types';

const entities: AnyEntity[] = Array.from({ length: 100_000 }, (_, index) => {
  const x = (index % 1_000) * 10;
  const y = Math.floor(index / 1_000) * 10;
  return {
    id: `line-${index}`,
    type: EntityType.LINE,
    layer: '0',
    start: { x, y },
    end: { x: x + 5, y: y + 5 },
    extents: { min: { x, y }, max: { x: x + 5, y: y + 5 } },
  };
});
const index = createSceneIndex(entities);
const bounds: SceneBounds = { min: { x: 4_000, y: 300 }, max: { x: 4_500, y: 500 } };

describe('100k entity viewport query', () => {
  bench('full scan', () => {
    entities.filter(entity => entity.extents
      && entity.extents.max.x >= bounds.min.x
      && entity.extents.min.x <= bounds.max.x
      && entity.extents.max.y >= bounds.min.y
      && entity.extents.min.y <= bounds.max.y);
  });

  bench('BVH query', () => {
    index.query(bounds);
  });
});
