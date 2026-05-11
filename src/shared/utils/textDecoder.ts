import { TEXT_DECODER_CONFIG } from '../config/viewerConfig';

export const decodeDxfBuffer = (buffer: ArrayBuffer): string => {
  try {
    return new TextDecoder(TEXT_DECODER_CONFIG.primaryEncoding, { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder(TEXT_DECODER_CONFIG.fallbackEncoding).decode(buffer);
  }
};
