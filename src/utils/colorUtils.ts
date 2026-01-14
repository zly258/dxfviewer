import { DEFAULT_COLOR } from '../constants';

// Basic Colors for quick lookup
export const AUTO_CAD_COLORS: Record<number, string> = {
  1: '#FF0000', 2: '#FFFF00', 3: '#00FF00', 4: '#00FFFF', 5: '#0000FF', 6: '#FF00FF', 7: '#FFFFFF', 
  8: '#808080', 9: '#C0C0C0'
};

/**
 * ACI to RGB Conversion Algorithm
 */
export const getAutoCadColor = (index: number): string => {
  if (index <= 0 || index === 256) return DEFAULT_COLOR; // ByBlock / ByLayer handled by caller usually
  
  // Standard colors 1-9
  if (index >= 1 && index <= 9) return AUTO_CAD_COLORS[index];

  // Grayscale 250-255
  if (index >= 250 && index <= 255) {
      const v = 33 + (index - 250) * (255 - 33) / 5;
      const h = Math.round(v).toString(16).padStart(2, '0');
      return `#${h}${h}${h}`;
  }

  // Indices 10-249: 24 Hue groups * 5 Saturation/Lightness levels
  // A simplified version of the ACI algorithm
  const hue = Math.floor((index - 10) / 10);
  const shade = (index - 10) % 10;
  
  // Standard ACI hues
  const hues = [
      [255, 0, 0], [255, 127, 0], [255, 255, 0], [127, 255, 0], [0, 255, 0], [0, 255, 127],
      [0, 255, 255], [0, 127, 255], [0, 0, 255], [127, 0, 255], [255, 0, 255], [255, 0, 127]
  ];
  
  const baseHue = hues[hue % 12];
  if (!baseHue) return DEFAULT_COLOR;

  // Shade 0,2,4,6,8 (Even indices are used in ACI 10-249)
  // Simplified brightness/saturation adjustment
  const factor = (10 - shade) / 10;
  const r = Math.round(baseHue[0] * factor).toString(16).padStart(2, '0');
  const g = Math.round(baseHue[1] * factor).toString(16).padStart(2, '0');
  const b = Math.round(baseHue[2] * factor).toString(16).padStart(2, '0');
  
  return `#${r}${g}${b}`;
};
