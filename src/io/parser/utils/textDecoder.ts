import { TEXT_DECODER_CONFIG } from '@/config/viewerConfig';
import { decodeBinaryDxfBuffer, isBinaryDxfBuffer } from './binaryDxfDecoder';

export type DxfDecodeResult = {
  text: string;
  format: 'ascii' | 'binary';
};

export const decodeDxfBuffer = (buffer: ArrayBuffer): DxfDecodeResult => {
  if (isBinaryDxfBuffer(buffer)) {
    return {
      text: decodeBinaryDxfBuffer(buffer),
      format: 'binary',
    };
  }

  try {
    return {
      text: new TextDecoder(TEXT_DECODER_CONFIG.primaryEncoding, { fatal: true }).decode(buffer),
      format: 'ascii',
    };
  } catch {
    return {
      text: new TextDecoder(TEXT_DECODER_CONFIG.fallbackEncoding).decode(buffer),
      format: 'ascii',
    };
  }
};
