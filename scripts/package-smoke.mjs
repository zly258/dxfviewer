import { readFile } from 'node:fs/promises';
import { strict as assert } from 'node:assert';

const parserEntry = await import('../dist/parser.js');
const viewerEntry = await import('../dist/dxfviewer.js');
assert.equal(typeof parserEntry.parseDxf, 'function');
assert.equal(typeof viewerEntry.DxfViewer, 'function');

const parserSource = await readFile(new URL('../dist/parser.js', import.meta.url), 'utf8');
const parserChunkPath = parserSource.match(/from\s+["'](.+parser[^"']+\.js)["']/)?.[1];
assert.ok(parserChunkPath, 'parser entry should reference its parser chunk');
const parserChunk = await readFile(new URL(`../dist/${parserChunkPath.replace(/^\.\//, '')}`, import.meta.url), 'utf8');
assert.doesNotMatch(parserChunk, /from\s+["']react(?:\/[^"']*)?["']/);
assert.doesNotMatch(parserSource, /\.css["']/);

const fixture = await readFile(new URL('../tests/fixtures/basic-ascii.dxf', import.meta.url), 'utf8');
const parsed = await parserEntry.parseDxf(fixture, undefined, { yieldIntervalMs: 0 });
assert.equal(parsed.entities.length, 2);
console.log('package smoke test passed');
