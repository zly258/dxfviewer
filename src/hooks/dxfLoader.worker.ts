import { parseDxf } from '@/core/parser/dxfParser';
import { decodeDxfBuffer } from '@/core/parser/utils/textDecoder';

self.onmessage = async (e: MessageEvent) => {
  const { buffer } = e.data;

  try {
    let decoded;
    try {
      decoded = decodeDxfBuffer(buffer);
    } catch (err: any) {
      throw new Error(`Decode failed: ${err.message}`);
    }

    const data = await parseDxf(decoded.text, (progress) => {
      self.postMessage({ type: 'progress', progress });
    });

    self.postMessage({ type: 'success', data, sourceFormat: decoded.format });
  } catch (err: any) {
    self.postMessage({ type: 'error', error: err.message });
  }
};
