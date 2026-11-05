/**
 * 有向距离场（SDF）生成：字形遮罩 → 距离场灰度页。
 *
 * 这是「文字转图形」的成熟落地方式（tiny-sdf / troika-three-text / msdfgen
 * 同类技术）：把字形轮廓编码成到最近边缘的距离，着色器再用
 * `smoothstep(0.5-w, 0.5+w, d)` 还原边缘——放大到任意倍数都保持锐利，
 * 不会像位图遮罩那样糊掉，也不再依赖超大光栅尺寸。
 *
 * 算法：3×3 chamfer 双遍扫描（正/反各一遍），得到近似欧氏距离平方，
 * 再按 `spread` 归一化到 0..255（128 = 边缘）。
 */

/** 计算 SDF 页：输入 RGBA 遮罩，输出单通道距离场（0..255）。 */
export const buildSdfPage = (
  imageData: ImageData | { width: number; height: number; data: Uint8ClampedArray | Uint8Array },
  spread: number,
): Uint8Array => {
  const width = imageData.width;
  const height = imageData.height;
  const src = imageData.data as Uint8ClampedArray | Uint8Array;
  const count = width * height;
  const INF = 1e18;

  // dIn[i] = 到最近「内部像素」的距离²；dOut[i] = 到最近「外部像素」的距离²。
  const dIn = new Float64Array(count);
  const dOut = new Float64Array(count);
  const insideMask = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const inside = src[i * 4 + 3] > 127 ? 1 : 0;
    insideMask[i] = inside;
    dIn[i] = inside ? 0 : INF;
    dOut[i] = inside ? INF : 0;
  }

  const chamfer = (grid: Float64Array): void => {
    // 正向
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        let best = grid[i];
        if (best === 0) continue;
        if (x > 0) { const v = grid[i - 1] + 1; if (v < best) best = v; }
        if (y > 0) {
          const up = i - width;
          const vUp = grid[up] + 1; if (vUp < best) best = vUp;
          if (x > 0) { const v = grid[up - 1] + 2; if (v < best) best = v; }
          if (x + 1 < width) { const v = grid[up + 1] + 2; if (v < best) best = v; }
        }
        grid[i] = best;
      }
    }
    // 反向
    for (let y = height - 1; y >= 0; y--) {
      for (let x = width - 1; x >= 0; x--) {
        const i = y * width + x;
        let best = grid[i];
        if (best === 0) continue;
        if (x + 1 < width) { const v = grid[i + 1] + 1; if (v < best) best = v; }
        if (y + 1 < height) {
          const dn = i + width;
          const vDn = grid[dn] + 1; if (vDn < best) best = vDn;
          if (x + 1 < width) { const v = grid[dn + 1] + 2; if (v < best) best = v; }
          if (x > 0) { const v = grid[dn - 1] + 2; if (v < best) best = v; }
        }
        grid[i] = best;
      }
    }
  };

  chamfer(dIn);
  chamfer(dOut);

  const out = new Uint8Array(count);
  const invSpread = 1 / Math.max(1, spread);
  for (let i = 0; i < count; i++) {
    // 内部像素到最近外部像素的距离为正；外部像素到最近内部像素的距离为负。
    const signed = insideMask[i]
      ? Math.sqrt(dOut[i])
      : -Math.sqrt(dIn[i]);
    // 归一化：0.5 = 边缘，1 = 深处内部，0 = 远处外部。
    const value = 0.5 + (signed * invSpread) * 0.5;
    out[i] = value <= 0 ? 0 : value >= 1 ? 255 : Math.round(value * 255);
  }
  return out;
};