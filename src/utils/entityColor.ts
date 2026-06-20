import { AnyEntity, DxfLayer, CanvasTheme, DrawingColorMode } from '@/types';
import { DEFAULT_ENTITY_COLOR, MONOCHROME_ENTITY_COLORS } from '@/config/viewerConfig';
import { CAD_BY_BLOCK_COLOR, CAD_BY_LAYER_COLOR } from '@/config/cadConstants';
import { getAutoCadColor, trueColorToHex } from './colorUtils';

export const resolveEntityColor = (
  entity: AnyEntity,
  layer: DxfLayer | undefined,
  parentColor: string | undefined,
  drawingColorMode: DrawingColorMode = 'original',
  canvasTheme: CanvasTheme = 'black',
): string => {
  if (drawingColorMode === 'monochrome') return MONOCHROME_ENTITY_COLORS[canvasTheme];

  if (entity.trueColor !== undefined) return trueColorToHex(entity.trueColor);

  const entityColor = entity.color;
  if (entityColor === CAD_BY_BLOCK_COLOR && parentColor) return parentColor;

  if (entityColor === CAD_BY_LAYER_COLOR || entityColor === undefined) {
    if (layer?.trueColor !== undefined) return trueColorToHex(layer.trueColor);
    if (layer?.color !== undefined) return getAutoCadColor(layer.color);
    return DEFAULT_ENTITY_COLOR;
  }

  return getAutoCadColor(entityColor);
};
