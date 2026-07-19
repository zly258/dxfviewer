import { describe, expect, it } from 'vitest';
import { hitTest, hitTestBox } from '@/renderer/services/canvasRenderService';
import { boxQueryBounds, createSceneIndex, pointQueryBounds } from '@/renderer/services/sceneIndex';
import { AnyEntity, DxfLayer, EntityType } from '@/types';

const layers: Record<string, DxfLayer> = {
  0: { name: '0', color: 7, isVisible: true },
};

const createLines = (count: number): AnyEntity[] => Array.from({ length: count }, (_, index) => {
  const x = (index % 50) * 10;
  const y = Math.floor(index / 50) * 10;
  return {
    id: `line-${index}`,
    type: EntityType.LINE,
    layer: '0',
    start: { x, y },
    end: { x: x + 6, y: y + 4 },
    extents: { min: { x, y }, max: { x: x + 6, y: y + 4 } },
  };
});

describe('SceneIndex', () => {
  it('never omits entities whose bounds overlap a query', () => {
    const entities = createLines(5_000);
    const index = createSceneIndex(entities);

    for (let queryIndex = 0; queryIndex < 100; queryIndex++) {
      const x = (queryIndex * 37) % 480;
      const y = (queryIndex * 53) % 980;
      const bounds = { min: { x, y }, max: { x: x + 25, y: y + 25 } };
      const expected = entities.filter(entity => entity.extents
        && entity.extents.max.x >= bounds.min.x
        && entity.extents.min.x <= bounds.max.x
        && entity.extents.max.y >= bounds.min.y
        && entity.extents.min.y <= bounds.max.y);
      const candidates = new Set(index.query(bounds).map(entity => entity.id));
      expected.forEach(entity => expect(candidates.has(entity.id)).toBe(true));
    }
  });

  it('keeps point and box hit testing equivalent to a full scan', () => {
    const entities = createLines(5_000);
    const index = createSceneIndex(entities);
    const blocks = {};
    const styles = {};

    for (let queryIndex = 0; queryIndex < 100; queryIndex++) {
      const x = (queryIndex % 50) * 10 + 3;
      const y = Math.floor(queryIndex / 50) * 10 + 2;
      const tolerance = 1;
      const fullHit = hitTest(x, y, tolerance, entities, blocks, layers, styles, index.splineSamples);
      const indexedHit = hitTest(x, y, tolerance, index.query(pointQueryBounds(x, y, tolerance)), blocks, layers, styles, index.splineSamples);
      expect(indexedHit).toBe(fullHit);
    }

    const box = { x1: 5, y1: 5, x2: 225, y2: 105 };
    const fullBox = hitTestBox(box, entities, layers, blocks, true);
    const indexedBox = hitTestBox(box, index.query(boxQueryBounds(box)), layers, blocks, true);
    expect([...indexedBox].sort()).toEqual([...fullBox].sort());
  });
});
