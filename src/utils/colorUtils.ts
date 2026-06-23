import { DEFAULT_ENTITY_COLOR } from '@/config/viewerConfig';

export const AUTO_CAD_COLORS: Record<number, string> = {
  1: '#FF0000',
  2: '#FFFF00',
  3: '#00FF00',
  4: '#00FFFF',
  5: '#0000FF',
  6: '#FF00FF',
  7: '#FFFFFF',
  8: '#808080',
  9: '#C0C0C0',
};

export const trueColorToHex = (trueColor: number): string => {
  const colorValue = trueColor >>> 0;
  const red = (colorValue >> 16) & 0xff;
  const green = (colorValue >> 8) & 0xff;
  const blue = colorValue & 0xff;

  return `#${red.toString(16).padStart(2, '0')}${green.toString(16).padStart(2, '0')}${blue.toString(16).padStart(2, '0')}`.toUpperCase();
};

const toHexChannel = (value: number): string => Math.round(value).toString(16).padStart(2, '0');

const getExtendedAciColor = (colorIndex: number): string => {
  const hueIndex = Math.floor((colorIndex - 10) / 10);
  const level = (colorIndex - 10) % 10;

  const hues = [
    [255, 0, 0], [255, 63, 0], [255, 127, 0], [255, 191, 0], [255, 255, 0], [191, 255, 0],
    [127, 255, 0], [63, 255, 0], [0, 255, 0], [0, 255, 63], [0, 255, 127], [0, 255, 191],
    [0, 255, 255], [0, 191, 255], [0, 127, 255], [0, 63, 255], [0, 0, 255], [63, 0, 255],
    [127, 0, 255], [191, 0, 255], [255, 0, 255], [255, 0, 191], [255, 0, 127], [255, 0, 63],
  ];

  const baseHue = hues[hueIndex] ?? hues[0];
  const brightnessMap = [1, 1, 0.8, 0.8, 0.6, 0.6, 0.4, 0.4, 0.2, 0.2];
  const brightness = brightnessMap[level] ?? 1;
  const halfSaturation = level % 2 !== 0;

  let [red, green, blue] = baseHue;
  if (halfSaturation) {
    red = (red + 255) / 2;
    green = (green + 255) / 2;
    blue = (blue + 255) / 2;
  }

  return `#${toHexChannel(red * brightness)}${toHexChannel(green * brightness)}${toHexChannel(blue * brightness)}`.toUpperCase();
};

export const getAutoCadColor = (index: number | undefined): string => {
  if (!Number.isFinite(index)) return DEFAULT_ENTITY_COLOR;

  const colorIndex = Math.abs(Math.trunc(index as number));
  if (colorIndex <= 0 || colorIndex === 256) return DEFAULT_ENTITY_COLOR;
  if (AUTO_CAD_COLORS[colorIndex]) return AUTO_CAD_COLORS[colorIndex];

  if (colorIndex >= 250 && colorIndex <= 255) {
    const value = 33 + ((colorIndex - 250) * (255 - 33)) / 5;
    const hex = toHexChannel(value);
    return `#${hex}${hex}${hex}`.toUpperCase();
  }

  if (colorIndex >= 10 && colorIndex <= 249) return getExtendedAciColor(colorIndex);

  return DEFAULT_ENTITY_COLOR;
};
