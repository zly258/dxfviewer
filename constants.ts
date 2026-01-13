export const DEFAULT_VIEWPORT = {
  x: 0,
  y: 0,
  zoom: 1
};

export const DEFAULT_COLOR = '#FFFFFF';

export const GRID_SIZE = 100;

export const LINE_TYPE_MAP: Record<string, string> = {
  'CONTINUOUS': 'none',
  'BYLAYER': 'none',
  'BYBLOCK': 'none',
  'DASHED': '10, 5',
  'HIDDEN': '5, 5',
  'CENTER': '15, 5, 5, 5',
  'PHANTOM': '15, 5, 5, 5, 5, 5',
  'DOT': '2, 2',
  'DASHDOT': '10, 5, 2, 5',
  'BORDER': '15, 5, 15, 5, 2, 5',
  'DIVIDE': '15, 5, 2, 5, 2, 5'
};

// Basic Colors for quick lookup
export const AUTO_CAD_COLORS: Record<number, string> = {
  1: '#FF0000', 2: '#FFFF00', 3: '#00FF00', 4: '#00FFFF', 5: '#0000FF', 6: '#FF00FF', 7: '#FFFFFF', 
  8: '#808080', 9: '#C0C0C0'
};

// ACI to RGB Conversion Algorithm
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
  // Group start indices: 10, 20, 30 ... 240
  // Each group has 5 shades (Even numbers: 10,12,14,16,18 are different brightness)
  // Actually, standard ACI logic:
  // Hues: 0, 15, 30 ... 345 degrees.
  // Saturation/Value steps.
  
  // Simplified approximation that covers the full spectrum reasonable well:
  const group = Math.floor((index - 10) / 10);
  const step = (index - 10) % 10;
  
  // Hue covers 360 degrees in 24 steps
  const hue = group * 15;
  
  // Saturation and Lightness vary by step
  let s = 100;
  let l = 50;
  
  // Even steps (0, 2, 4, 6, 8) in the group usually map to:
  // 0: 100% S, 50% L (Pure Color)
  // 2: 75% L
  // 4: 50% S
  // etc. 
  // A reasonable approximation for visualization:
  if (step === 0) { s = 100; l = 50; }
  else if (step === 1) { s = 80; l = 60; } // Odd indices are often interpolation
  else if (step === 2) { s = 60; l = 75; }
  else if (step === 3) { s = 50; l = 80; }
  else if (step === 4) { s = 30; l = 85; }
  else if (step === 5) { s = 100; l = 40; } // Darker
  else if (step === 6) { s = 100; l = 30; }
  else if (step === 7) { s = 100; l = 20; }
  else if (step === 8) { s = 70; l = 15; }
  else if (step === 9) { s = 50; l = 10; }

  return `hsl(${hue}, ${s}%, ${l}%)`;
};