/**
 * DEFLATE 压缩（PDF FlateDecode 用）。
 *
 * 优先用运行时自带的 CompressionStream('deflate')——浏览器 Chrome 80+ /
 * Node 17+ 均可用，产物为 zlib 包装格式，正是 PDF /FlateDecode 需要的；
 * 不可用时返回原始字节（PDF 流允许无 /Filter，只是体积大些）。
 */

export interface DeflateResult {
  data: Uint8Array;
  compressed: boolean;
}

export const deflateSupported = (): boolean =>
  typeof CompressionStream !== 'undefined';

export const deflateBytes = async (bytes: Uint8Array): Promise<DeflateResult> => {
  if (!deflateSupported() || bytes.length === 0) {
    return { data: bytes, compressed: false };
  }

  try {
    const stream = new Blob([bytes as unknown as BlobPart])
      .stream()
      .pipeThrough(new CompressionStream('deflate'));
    const buffer = await new Response(stream).arrayBuffer();
    return { data: new Uint8Array(buffer), compressed: true };
  } catch {
    return { data: bytes, compressed: false };
  }
};
