/**
 * 画布编码工具：Blob / 字节 / dataURL。
 *
 * 同时兼容 `HTMLCanvasElement`（主线程）与 `OffscreenCanvas`（Worker），
 * 以及注入的画布实现（Node 环境）。
 */
import { HeadlessCanvas } from '@/renderer/headless';

const isOffscreen = (canvas: HeadlessCanvas): canvas is OffscreenCanvas =>
  typeof (canvas as OffscreenCanvas).convertToBlob === 'function';

/** 把画布编码为 Blob。 */
export const canvasToBlob = (
  canvas: HeadlessCanvas,
  type = 'image/png',
  quality?: number,
): Promise<Blob> => {
  if (isOffscreen(canvas)) {
    return canvas.convertToBlob({ type, quality });
  }

  const element = canvas as HTMLCanvasElement;
  if (typeof element.toBlob !== 'function') {
    return Promise.reject(new Error('当前画布实现不支持 toBlob / convertToBlob'));
  }

  return new Promise<Blob>((resolve, reject) => {
    element.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error(`${type} 编码失败：toBlob 返回空`))),
      type,
      quality,
    );
  });
};

/** 把画布编码为原始字节（PDF 内嵌图像需要）。 */
export const canvasToBytes = async (
  canvas: HeadlessCanvas,
  type = 'image/jpeg',
  quality?: number,
): Promise<Uint8Array> => {
  const blob = await canvasToBlob(canvas, type, quality);
  return new Uint8Array(await blob.arrayBuffer());
};

/** 把 Blob 转 dataURL（无 URL.createObjectURL 的环境也可用）。 */
export const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    if (typeof FileReader !== 'undefined') {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Blob 转 dataURL 失败'));
      reader.readAsDataURL(blob);
      return;
    }
    // Node / 无 FileReader 环境回退：手工 base64。
    blob.arrayBuffer().then(buffer => {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);

      const globals = globalThis as {
        btoa?: (data: string) => string;
        Buffer?: { from: (data: Uint8Array) => { toString: (encoding: string) => string } };
      };

      let base64: string;
      if (typeof globals.btoa === 'function') {
        base64 = globals.btoa(binary);
      } else if (globals.Buffer) {
        base64 = globals.Buffer.from(bytes).toString('base64');
      } else {
        reject(new Error('当前环境缺少 base64 编码能力'));
        return;
      }
      resolve(`data:${blob.type || 'application/octet-stream'};base64,${base64}`);
    }, () => reject(new Error('Blob 转 dataURL 失败')));
  });
