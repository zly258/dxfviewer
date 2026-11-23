/**
 * Generates an ultra-scale 2D DXF stress-test sample:
 *
 *   examples/samples/million_elements_stress_2d.dxf
 *
 * Contains exactly 1,000,000 entities:
 *   - Ultra-dense wafer / VLSI micro-architecture layout (1000 x 1000 cell matrix)
 *   - Structured mix of LINE, CIRCLE, ARC, LWPOLYLINE, POINT, and SOLID entities
 *   - 7 distinct functional layers with standard ACI colors
 *   - Deterministic seeded PRNG (seed = 20261123)
 *
 * Author: zhangly1403 <zhangly1403@qq.com>
 * License: GPL-3.0
 * Run:  node scripts/make-million-sample.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(rootDir, 'examples', 'samples');
const outFile = path.join(outDir, 'million_elements_stress_2d.dxf');

let seed = 20261123;
function rnd() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}

const TOTAL = 1000000;
const COLS = 1000;
const STEP = 100;

console.log(`[make-million-sample] Generating ${TOTAL.toLocaleString()} entities -> ${path.basename(outFile)}...`);
console.time('[make-million-sample] Time');

const writeStream = fs.createWriteStream(outFile, { encoding: 'utf8', highWaterMark: 1024 * 1024 });

// 1. Header & Layer Tables
writeStream.write(
`0
SECTION
2
HEADER
9
$ACADVER
1
AC1027
9
$INSUNITS
70
4
9
$EXTMIN
10
0.0
20
0.0
30
0.0
9
$EXTMAX
10
100000.0
20
100000.0
30
0.0
0
ENDSEC
0
SECTION
2
TABLES
0
TABLE
2
LAYER
70
7
0
LAYER
2
0
70
0
62
7
6
CONTINUOUS
0
LAYER
2
CHIP_BUS_H
70
0
62
2
6
CONTINUOUS
0
LAYER
2
CHIP_BUS_V
70
0
62
4
6
CONTINUOUS
0
LAYER
2
VIAS_PADS
70
0
62
1
6
CONTINUOUS
0
LAYER
2
CIRCUITS
70
0
62
3
6
CONTINUOUS
0
LAYER
2
CORES_BLOCKS
70
0
62
5
6
CONTINUOUS
0
LAYER
2
PINS
70
0
62
6
6
CONTINUOUS
0
ENDTAB
0
ENDSEC
0
SECTION
2
ENTITIES
`
);

// 2. Stream 1,000,000 Entities
let buf = '';
for (let i = 0; i < TOTAL; i++) {
  const c = i % COLS;
  const r = (i / COLS) | 0;
  const x = c * STEP;
  const y = r * STEP;
  const m = i % 10;

  if (m === 0) {
    // Horizontal bus trace (LINE)
    buf += `0\nLINE\n8\nCHIP_BUS_H\n10\n${x}\n20\n${y + 50}\n11\n${x + 90}\n21\n${y + 50}\n`;
  } else if (m === 1) {
    // Vertical interconnect bus (LINE)
    buf += `0\nLINE\n8\nCHIP_BUS_V\n10\n${x + 50}\n20\n${y}\n11\n${x + 50}\n21\n${y + 90}\n`;
  } else if (m === 2) {
    // Via pad (CIRCLE)
    buf += `0\nCIRCLE\n8\nVIAS_PADS\n10\n${x + 50}\n20\n${y + 50}\n40\n18\n`;
  } else if (m === 3) {
    // Diagonal route line (LINE)
    buf += `0\nLINE\n8\nCIRCUITS\n10\n${x + 10}\n20\n${y + 10}\n11\n${x + 80}\n21\n${y + 80}\n`;
  } else if (m === 4) {
    // Corner curve fillet (ARC)
    buf += `0\nARC\n8\nCIRCUITS\n10\n${x + 30}\n20\n${y + 30}\n40\n24\n50\n0.0\n51\n90.0\n`;
  } else if (m === 5) {
    // Probe test pin (POINT)
    buf += `0\nPOINT\n8\nPINS\n10\n${x + 25}\n20\n${y + 75}\n`;
  } else if (m === 6) {
    // L-shaped routing polyline (LWPOLYLINE with 3 vertices)
    buf += `0\nLWPOLYLINE\n8\nCIRCUITS\n90\n3\n70\n0\n10\n${x + 20}\n20\n${y + 20}\n10\n${x + 70}\n20\n${y + 20}\n10\n${x + 70}\n20\n${y + 70}\n`;
  } else if (m === 7) {
    // Inner via ring (CIRCLE)
    buf += `0\nCIRCLE\n8\nVIAS_PADS\n10\n${x + 50}\n20\n${y + 50}\n40\n8\n`;
  } else if (m === 8) {
    // Transistor / micro-cell island (SOLID)
    buf += `0\nSOLID\n8\nCORES_BLOCKS\n10\n${x + 35}\n20\n${y + 35}\n11\n${x + 65}\n21\n${y + 35}\n12\n${x + 35}\n22\n${y + 65}\n13\n${x + 65}\n23\n${y + 65}\n`;
  } else {
    // Bypass cross-trace (LINE)
    buf += `0\nLINE\n8\nCHIP_BUS_H\n10\n${x + 15}\n20\n${y + 85}\n11\n${x + 85}\n21\n${y + 15}\n`;
  }

  // Flush in ~64k chunks to optimize Node stream throughput
  if (buf.length >= 65536) {
    writeStream.write(buf);
    buf = '';
  }
}

if (buf.length > 0) {
  writeStream.write(buf);
  buf = '';
}

writeStream.write('0\nENDSEC\n0\nEOF\n');
writeStream.end();

await new Promise((resolve) => writeStream.on('finish', resolve));
console.timeEnd('[make-million-sample] Time');

const stats = fs.statSync(outFile);
console.log(`[make-million-sample] Generated ${TOTAL.toLocaleString()} entities! File size: ${(stats.size / 1048576).toFixed(2)} MB`);
