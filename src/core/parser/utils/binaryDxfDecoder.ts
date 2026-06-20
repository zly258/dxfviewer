import { TEXT_DECODER_CONFIG } from '@/config/viewerConfig';

const BINARY_DXF_HEADER = 'AutoCAD Binary DXF\r\n\x1A\0';
const BINARY_DXF_HEADER_BYTES = new Uint8Array([...BINARY_DXF_HEADER].map(ch => ch.charCodeAt(0)));

export const isBinaryDxfBuffer = (buffer: ArrayBuffer): boolean => {
  if (buffer.byteLength < BINARY_DXF_HEADER_BYTES.length) return false;
  const bytes = new Uint8Array(buffer, 0, BINARY_DXF_HEADER_BYTES.length);
  for (let i = 0; i < BINARY_DXF_HEADER_BYTES.length; i++) {
    if (bytes[i] !== BINARY_DXF_HEADER_BYTES[i]) return false;
  }
  return true;
};

class BinaryDxfReader {
  private readonly view: DataView;
  private readonly bytes: Uint8Array;
  private offset: number;
  private readonly utf8Decoder = new TextDecoder(TEXT_DECODER_CONFIG.primaryEncoding);
  private readonly fallbackDecoder = new TextDecoder(TEXT_DECODER_CONFIG.fallbackEncoding);

  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer);
    this.bytes = new Uint8Array(buffer);
    this.offset = BINARY_DXF_HEADER_BYTES.length;
  }

  get hasRemaining(): boolean {
    return this.offset < this.bytes.length;
  }

  readGroupCode(): number | null {
    if (!this.hasRemaining) return null;
    const marker = this.readUint8();
    if (marker !== 255) return marker;
    if (!this.canRead(2)) return null;
    return this.readInt16();
  }

  readValue(groupCode: number): string {
    if (isStringGroup(groupCode)) return this.readNullTerminatedString();
    if (isDoubleGroup(groupCode)) return formatNumber(this.readFloat64());
    if (isBooleanGroup(groupCode)) return String(this.readUint8() ? 1 : 0);
    if (isInt16Group(groupCode)) return String(this.readInt16());
    if (isInt32Group(groupCode)) return String(this.readInt32());
    if (isInt64Group(groupCode)) return String(this.readInt64());
    if (isBinaryChunkGroup(groupCode)) return this.readBinaryChunkAsHex();
    return this.readNullTerminatedString();
  }

  private canRead(length: number): boolean {
    return this.offset + length <= this.bytes.length;
  }

  private readUint8(): number {
    this.ensureCanRead(1);
    return this.bytes[this.offset++];
  }

  private readInt16(): number {
    this.ensureCanRead(2);
    const value = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return value;
  }

  private readInt32(): number {
    this.ensureCanRead(4);
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }

  private readInt64(): bigint {
    this.ensureCanRead(8);
    const low = BigInt(this.view.getUint32(this.offset, true));
    const high = BigInt(this.view.getInt32(this.offset + 4, true));
    this.offset += 8;
    return (high << 32n) | low;
  }

  private readFloat64(): number {
    this.ensureCanRead(8);
    const value = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return value;
  }

  private readNullTerminatedString(): string {
    const start = this.offset;
    while (this.offset < this.bytes.length && this.bytes[this.offset] !== 0) {
      this.offset++;
    }
    const end = this.offset;
    if (this.offset < this.bytes.length && this.bytes[this.offset] === 0) {
      this.offset++;
    }
    return this.decodeBytes(this.bytes.slice(start, end));
  }

  private readBinaryChunkAsHex(): string {
    const length = this.readUint8();
    this.ensureCanRead(length);
    const chunk = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return Array.from(chunk, byte => byte.toString(16).padStart(2, '0').toUpperCase()).join('');
  }

  private decodeBytes(bytes: Uint8Array): string {
    try {
      return this.utf8Decoder.decode(bytes);
    } catch {
      return this.fallbackDecoder.decode(bytes);
    }
  }

  private ensureCanRead(length: number): void {
    if (!this.canRead(length)) {
      throw new Error('二进制 DXF 数据不完整，读取组码值时到达文件末尾');
    }
  }
}

const isStringGroup = (code: number): boolean => {
  return (
    code <= 9 ||
    code === 100 ||
    code === 102 ||
    code === 105 ||
    (code >= 300 && code <= 309) ||
    (code >= 320 && code <= 369) ||
    (code >= 390 && code <= 399) ||
    (code >= 410 && code <= 419) ||
    (code >= 430 && code <= 439) ||
    (code >= 470 && code <= 481) ||
    code === 999 ||
    (code >= 1000 && code <= 1003) ||
    code === 1005
  );
};

const isDoubleGroup = (code: number): boolean => {
  return (
    (code >= 10 && code <= 59) ||
    (code >= 110 && code <= 149) ||
    (code >= 210 && code <= 239) ||
    (code >= 460 && code <= 469) ||
    (code >= 1010 && code <= 1059)
  );
};

const isBooleanGroup = (code: number): boolean => {
  return code >= 290 && code <= 299;
};

const isInt16Group = (code: number): boolean => {
  return (
    (code >= 60 && code <= 79) ||
    (code >= 170 && code <= 179) ||
    (code >= 270 && code <= 289) ||
    (code >= 370 && code <= 389) ||
    (code >= 400 && code <= 409) ||
    (code >= 1060 && code <= 1070)
  );
};

const isInt32Group = (code: number): boolean => {
  return (
    (code >= 90 && code <= 99) ||
    (code >= 420 && code <= 429) ||
    (code >= 440 && code <= 459) ||
    code === 1071
  );
};

const isInt64Group = (code: number): boolean => {
  return code >= 160 && code <= 169;
};

const isBinaryChunkGroup = (code: number): boolean => {
  return (code >= 310 && code <= 319) || code === 1004;
};

const formatNumber = (value: number): string => {
  if (!Number.isFinite(value)) return '0';
  return Number.isInteger(value) ? value.toString() : value.toPrecision(15).replace(/(?:\.0+|0+)$/, '');
};

export const decodeBinaryDxfBuffer = (buffer: ArrayBuffer): string => {
  if (!isBinaryDxfBuffer(buffer)) {
    throw new Error('不是有效的二进制 DXF 文件');
  }

  const reader = new BinaryDxfReader(buffer);
  const lines: string[] = [];

  while (reader.hasRemaining) {
    const groupCode = reader.readGroupCode();
    if (groupCode === null) break;
    const value = reader.readValue(groupCode);
    lines.push(String(groupCode), value);
    if (groupCode === 0 && value === 'EOF') break;
  }

  return lines.join('\n');
};
