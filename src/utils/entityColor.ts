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

  const resolved = resolveOriginalColor(entity, layer, parentColor);
  if (canvasTheme === 'white') {
    // 浅色画布对比度保障（CAD 惯例 + 打印可读性）：
    // - ACI 7 / 纯白是前景色 → 反转为黑；
    // - ACI 2 黄、4 青、8 灰在白底上过浅 → 压暗为可打印的深色变体。
    const upper = resolved.toUpperCase();
    if (upper === '#FFFFFF') return '#000000';
    if (upper === '#FFFF00') return '#B8860B'; // 黄 → 暗金
    if (upper === '#00FFFF') return '#008B8B'; // 青 → 暗青
    if (upper === '#C0C0C0') return '#696969'; // 浅灰 → 中灰
  }
  return resolved;
};

const resolveOriginalColor = (
  entity: AnyEntity,
  layer: DxfLayer | undefined,
  parentColor: string | undefined,
): string => {
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
