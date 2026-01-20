import { DEFAULT_COLOR } from '../constants';

// 用于快速查询的基础颜色
export const AUTO_CAD_COLORS: Record<number, string> = {
  1: '#FF0000', 2: '#FFFF00', 3: '#00FF00', 4: '#00FFFF', 5: '#0000FF', 6: '#FF00FF', 7: '#FFFFFF', 
  8: '#808080', 9: '#C0C0C0'
};

export const trueColorToHex = (trueColor: number): string => {
  // DXF 中的 TrueColor 是 24 位整数：0x00RRGGBB
  // 注意：如果符号整数中设置了第 24 位，有时它会是负数
  const c = trueColor >>> 0; // 转换为无符号
  const r = (c >> 16) & 0xFF;
  const g = (c >> 8) & 0xFF;
  const b = c & 0xFF;
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();
};

/**
 * ACI 到 RGB 转换算法
 * @param index ACI 颜色索引
 * @param theme 当前背景主题 ('black', 'white' 或 'gray')
 */
export const getAutoCadColor = (index: number, theme: 'black' | 'white' | 'gray' = 'black'): string => {
  const bgIsDark = theme === 'black' || theme === 'gray';
  if (index <= 0 || index === 256) return bgIsDark ? '#FFFFFF' : '#000000'; // ByBlock / ByLayer 通常由调用者处理
  
  // 颜色 7 (白/黑) 的特殊处理
  if (index === 7) {
      return bgIsDark ? '#FFFFFF' : '#000000';
  }

  // 标准颜色 1-9
  if (index >= 1 && index <= 6) return AUTO_CAD_COLORS[index];
  if (index >= 8 && index <= 9) return AUTO_CAD_COLORS[index];

  // 灰度 250-255
  if (index >= 250 && index <= 255) {
      const v = 33 + (index - 250) * (255 - 33) / 5;
      const h = Math.round(v).toString(16).padStart(2, '0');
      return `#${h}${h}${h}`;
  }

  // 索引 10-249：24 个色调组 * 10 个级别
  const hueIndex = Math.floor((index - 10) / 10);
  const level = (index - 10) % 10;
  
  // 标准 ACI 24 色调
  const hues = [
    [255, 0, 0], [255, 63, 0], [255, 127, 0], [255, 191, 0], [255, 255, 0], [191, 255, 0],
    [127, 255, 0], [63, 255, 0], [0, 255, 0], [0, 255, 63], [0, 255, 127], [0, 255, 191],
    [0, 255, 255], [0, 191, 255], [0, 127, 255], [0, 63, 255], [0, 0, 255], [63, 0, 255],
    [127, 0, 255], [191, 0, 255], [255, 0, 255], [255, 0, 191], [255, 0, 127], [255, 0, 63]
  ];
  
  const baseHue = hues[hueIndex] || hues[0];

  // ACI 级别处理：
  // 偶数级别 (0, 2, 4, 6, 8)：全饱和度，亮度可变
  // 奇数级别 (1, 3, 5, 7, 9)：50% 饱和度，亮度可变
  const isHalfSaturation = level % 2 !== 0;
  const brightnessMap = [1.0, 1.0, 0.8, 0.8, 0.6, 0.6, 0.4, 0.4, 0.2, 0.2];
  const brightness = brightnessMap[level];

  let r = baseHue[0];
  let g = baseHue[1];
  let b = baseHue[2];

  if (isHalfSaturation) {
      // 与白色混合以获得一半饱和度
      r = (r + 255) / 2;
      g = (g + 255) / 2;
      b = (b + 255) / 2;
  }

  // 应用亮度
  r = Math.round(r * brightness);
  g = Math.round(g * brightness);
  b = Math.round(b * brightness);
  
  const rs = r.toString(16).padStart(2, '0');
  const gs = g.toString(16).padStart(2, '0');
  const bs = b.toString(16).padStart(2, '0');
  
  return `#${rs}${gs}${bs}`;
};
