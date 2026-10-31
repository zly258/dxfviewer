/**
 * 共享的 Canvas2D 影子实现：记录调用次数与调用序列，供无头渲染 /
 * 导出冒烟测试与渲染回归校验使用（无浏览器环境）。
 */

/**
 * 创建记录绘制调用的假 Canvas。
 *
 * 返回：
 * - canvas: 可传入 createCanvas / getContext 使用的画布对象
 * - counter: 各绘制操作次数（stroke/fill/fillText/...）
 * - ops: 按发生顺序记录的 ctx 方法名序列（含 measureText 等），
 *   用于两次渲染之间的逐调用等价性断言。
 */
export const createFakeCanvas = (width, height) => {
  const counter = {
    stroke: 0,
    fill: 0,
    fillText: 0,
    strokeText: 0,
    drawImage: 0,
    fillRect: 0,
    moveTo: 0,
    lineTo: 0,
    arc: 0,
    bezierCurveTo: 0,
  };
  const ops = [];
  const noop = () => {};
  let font = '10px sans-serif';

  const canvas = {
    width,
    height,
    getContext: () => ctx,
    toBlob: (callback, type = 'image/png') => callback(new Blob([new Uint8Array(16)], { type })),
    toDataURL: type => `data:${type};base64,AAAAAAAAAAAAAAAAAAAAAA==`,
    convertToBlob: async ({ type = 'image/png' } = {}) => new Blob([new Uint8Array(16)], { type }),
  };

  const ctx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'canvas') return canvas;
        if (prop === 'font') return font;
        if (prop === 'measureText') {
          return text => {
            ops.push('measureText');
            const size = Number.parseFloat(font) || 10;
            const value = String(text);
            const w = [...value].reduce((acc, ch) => acc + (ch.codePointAt(0) > 255 ? size : size * 0.55), 0);
            return {
              width: w,
              actualBoundingBoxLeft: 0,
              actualBoundingBoxRight: w,
              actualBoundingBoxAscent: size * 0.8,
              actualBoundingBoxDescent: size * 0.2,
            };
          };
        }
        if (prop === 'createPattern') {
          return () => {
            ops.push('createPattern');
            return {};
          };
        }
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
          return () => {
            ops.push(prop);
            return { addColorStop: noop };
          };
        }
        if (prop === 'getImageData') {
          return () => {
            ops.push('getImageData');
            return { data: new Uint8ClampedArray(4) };
          };
        }
        return (..._args) => {
          if (typeof prop === 'string') ops.push(prop);
          if (prop in counter) counter[prop]++;
        };
      },
      set(_target, prop, value) {
        if (prop === 'font') font = String(value);
        return true;
      },
    },
  );

  return { canvas, counter, ops };
};
