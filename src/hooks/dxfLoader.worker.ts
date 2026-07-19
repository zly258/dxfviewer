import { parseDxf } from '@/core/parser/dxfParser';
import { decodeDxfBuffer } from '@/core/parser/utils/textDecoder';
import { DxfData, DxfSourceFormat } from '@/types';

interface ParseWorkerRequest {
  type: 'parse';
  requestId: number;
  buffer: ArrayBuffer;
}

export type ParseWorkerResponse =
  | { type: 'progress'; requestId: number; progress: number }
  | { type: 'success'; requestId: number; data: DxfData; sourceFormat: DxfSourceFormat }
  | { type: 'error'; requestId: number; error: string };

const postResponse = (response: ParseWorkerResponse) => self.postMessage(response);

self.onmessage = async (e: MessageEvent<ParseWorkerRequest>) => {
  const { type, requestId, buffer } = e.data;
  if (type !== 'parse') return;

  try {
    let decoded: ReturnType<typeof decodeDxfBuffer>;
    try {
      decoded = decodeDxfBuffer(buffer);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Decode failed: ${message}`);
    }

    const data = await parseDxf(decoded.text, (progress) => {
      postResponse({ type: 'progress', requestId, progress });
    }, { yieldIntervalMs: 0, progressIntervalMs: 50 });

    postResponse({ type: 'success', requestId, data, sourceFormat: decoded.format });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    postResponse({ type: 'error', requestId, error: message });
  }
};
