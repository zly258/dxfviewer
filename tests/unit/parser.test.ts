import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDxf } from '@/core/parser';
import { decodeDxfBuffer } from '@/core/parser/utils/textDecoder';
import { EntityType } from '@/types';

const fixturePath = path.resolve(process.cwd(), 'tests/fixtures/basic-ascii.dxf');

const createBinaryFixture = (): ArrayBuffer => {
  const header = new TextEncoder().encode('AutoCAD Binary DXF\r\n\x1A\0');
  const bytes: number[] = [...header];
  const pushString = (code: number, value: string) => {
    bytes.push(code, ...new TextEncoder().encode(value), 0);
  };
  const pushDouble = (code: number, value: number) => {
    const buffer = new ArrayBuffer(8);
    new DataView(buffer).setFloat64(0, value, true);
    bytes.push(code, ...new Uint8Array(buffer));
  };
  pushString(0, 'SECTION');
  pushString(2, 'ENTITIES');
  pushString(0, 'LINE');
  pushString(8, '0');
  pushDouble(10, 0);
  pushDouble(20, 0);
  pushDouble(11, 5);
  pushDouble(21, 7);
  pushString(0, 'ENDSEC');
  pushString(0, 'EOF');
  return new Uint8Array(bytes).buffer;
};

describe('DXF parser', () => {
  it('parses ASCII entities and reports completion', async () => {
    const source = await readFile(fixturePath, 'utf8');
    const progress: number[] = [];
    const data = await parseDxf(source, value => progress.push(value), { yieldIntervalMs: 0 });

    expect(data.entities.map(entity => entity.type)).toEqual([EntityType.LINE, EntityType.CIRCLE]);
    expect(data.layouts[0]?.name).toBe('Model');
    expect(data.extents?.width).toBeGreaterThan(0);
    expect(progress.at(-1)).toBe(100);
  });

  it('decodes and parses binary DXF data', async () => {
    const decoded = decodeDxfBuffer(createBinaryFixture());
    const data = await parseDxf(decoded.text, undefined, { yieldIntervalMs: 0 });

    expect(decoded.format).toBe('binary');
    expect(data.entities).toHaveLength(1);
    expect(data.entities[0]?.type).toBe(EntityType.LINE);
  });

  it('honors an already aborted parse signal', async () => {
    const source = await readFile(fixturePath, 'utf8');
    const controller = new AbortController();
    controller.abort();

    await expect(parseDxf(source, undefined, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects malformed input', async () => {
    await expect(parseDxf('not a dxf')).rejects.toThrow(/SECTION|ENTITIES/);
  });
});
