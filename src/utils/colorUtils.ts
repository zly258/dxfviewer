import { DEFAULT_COLOR } from '../constants';

// Basic Colors for quick lookup
export const AUTO_CAD_COLORS: Record<number, string> = {
  1: '#FF0000', 2: '#FFFF00', 3: '#00FF00', 4: '#00FFFF', 5: '#0000FF', 6: '#FF00FF', 7: '#FFFFFF', 
  8: '#808080', 9: '#C0C0C0'
};

export const trueColorToHex = (trueColor: number): string => {
  // TrueColor in DXF is 24-bit integer: 0x00RRGGBB
  // Note: Sometimes it's negative if bit 24 is set in signed int
  const c = trueColor >>> 0; // Convert to unsigned
  const r = (c >> 16) & 0xFF;
  const g = (c >> 8) & 0xFF;
  const b = c & 0xFF;
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();
};

/**
 * ACI to RGB Conversion Algorithm
 * @param index ACI color index
 * @param theme Current background theme ('black', 'white' or 'gray')
 */
export const getAutoCadColor = (index: number, theme: 'black' | 'white' | 'gray' = 'black'): string => {
  const bgIsDark = theme === 'black' || theme === 'gray';
  if (index <= 0 || index === 256) return bgIsDark ? '#FFFFFF' : '#000000'; // ByBlock / ByLayer handled by caller usually
  
  // Special handling for Color 7 (White/Black)
  if (index === 7) {
      return bgIsDark ? '#FFFFFF' : '#000000';
  }

  // Standard colors 1-9
  if (index >= 1 && index <= 6) return AUTO_CAD_COLORS[index];
  if (index >= 8 && index <= 9) return AUTO_CAD_COLORS[index];

  // Grayscale 250-255
  if (index >= 250 && index <= 255) {
      const v = 33 + (index - 250) * (255 - 33) / 5;
      const h = Math.round(v).toString(16).padStart(2, '0');
      return `#${h}${h}${h}`;
  }

  // Indices 10-249: 24 Hue groups * 10 levels
  const hueIndex = Math.floor((index - 10) / 10);
  const level = (index - 10) % 10;
  
  // Standard ACI 24 Hues
  const hues = [
    [255, 0, 0], [255, 63, 0], [255, 127, 0], [255, 191, 0], [255, 255, 0], [191, 255, 0],
    [127, 255, 0], [63, 255, 0], [0, 255, 0], [0, 255, 63], [0, 255, 127], [0, 255, 191],
    [0, 255, 255], [0, 191, 255], [0, 127, 255], [0, 63, 255], [0, 0, 255], [63, 0, 255],
    [127, 0, 255], [191, 0, 255], [255, 0, 255], [255, 0, 191], [255, 0, 127], [255, 0, 63]
  ];
  
  const baseHue = hues[hueIndex] || hues[0];

  // ACI Level handling:
  // Even levels (0, 2, 4, 6, 8): Full saturation, varying brightness
  // Odd levels (1, 3, 5, 7, 9): 50% saturation, varying brightness
  const isHalfSaturation = level % 2 !== 0;
  const brightnessMap = [1.0, 1.0, 0.8, 0.8, 0.6, 0.6, 0.4, 0.4, 0.2, 0.2];
  const brightness = brightnessMap[level];

  let r = baseHue[0];
  let g = baseHue[1];
  let b = baseHue[2];

  if (isHalfSaturation) {
      // Mix with white for half saturation
      r = (r + 255) / 2;
      g = (g + 255) / 2;
      b = (b + 255) / 2;
  }

  // Apply brightness
  r = Math.round(r * brightness);
  g = Math.round(g * brightness);
  b = Math.round(b * brightness);
  
  const rs = r.toString(16).padStart(2, '0');
  const gs = g.toString(16).padStart(2, '0');
  const bs = b.toString(16).padStart(2, '0');
  
  return `#${rs}${gs}${bs}`;
};
