/**
 * Generates the bundled showcase drawings.
 *
 *   examples/samples/elements_showcase_2d.dxf  — every 2D entity type, laid
 *     out on a labelled grid so nothing overlaps and every sample is in its
 *     own cell.
 *   examples/samples/elements_showcase_3d.dxf  — the 3D entity types.
 *
 * Run:  node scripts/make-showcase.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const samplesDir = path.join(rootDir, 'examples', 'samples');

const HEADER = [
  '0', 'SECTION', '2', 'HEADER',
  '9', '$ACADVER', '1', 'AC1027',
  '9', '$INSUNITS', '70', '4',
  '9', '$DIMFAC', '70', '1',
  '9', '$DIMSCALE', '40', '1.0',
  '9', '$DIMTXT', '40', '3.0',
  '9', '$DIMASZ', '40', '3.0',
  '9', '$TEXTSIZE', '40', '3.0',
  '0', 'ENDSEC'
];

const LTYPE = [
  '0', 'SECTION', '2', 'TABLES',
  '0', 'TABLE', '2', 'LTYPE',
  '0', 'LTYPE', '2', 'CONTINUOUS', '3', 'Solid line', '73', '0', '40', '0.0',
  '0', 'LTYPE', '2', 'CENTER', '3', 'Center', '73', '4', '40', '12.0',
  '49', '7.0', '49', '-1.8', '49', '1.4', '49', '-1.8',
  '0', 'LTYPE', '2', 'HIDDEN', '3', 'Hidden', '73', '2', '40', '6.0',
  '49', '4.0', '49', '-2.0',
  '0', 'ENDTAB'
];

const STYLE = [
  '0', 'TABLE', '2', 'STYLE',
  '0', 'STYLE', '2', 'STANDARD', '3', 'simplex.shx', '4', '', '40', '0.0', '41', '1.0', '50', '0.0',
  '0', 'ENDTAB'
];

const DIMSTYLE = [
  '0', 'TABLE', '2', 'DIMSTYLE',
  '0', 'DIMSTYLE', '2', 'STANDARD',
  '40', '1.0', '41', '3.0', '42', '0.9', '44', '1.5', '140', '3.0', '271', '2',
  '0', 'ENDTAB'
];

const layer = (name, color, ltype = 'CONTINUOUS') =>
  ['0', 'LAYER', '2', name, '70', '0', '62', String(color), '6', ltype];

const LAYERS = [
  '0', 'TABLE', '2', 'LAYER',
  layer('0', 7),
  layer('A-LINE', 7),
  layer('B-CURVE', 3),
  layer('C-FILL', 8),
  layer('D-TEXT', 2),
  layer('E-DIM', 1),
  layer('F-CONSTR', 5, 'CENTER'),
  layer('G-HIDDEN', 4, 'HIDDEN'),
  layer('H-BLOCK', 6),
  '0', 'ENDTAB'
];

const TABLES = ['0', 'SECTION', '2', 'TABLES', ...LTYPE, ...LAYERS, ...STYLE, ...DIMSTYLE, '0', 'ENDSEC'];

const tail = ['0', 'SECTION', '2', 'ENTITIES'];

// ---------------------------------------------------------------- helpers
function fmt(v) {
  if (Number.isInteger(v)) return String(v);
  return String(Math.round(v * 1e6) / 1e6);
}
function p(x, y) { return ['10', fmt(x), '20', fmt(y), '30', '0.0']; }
function p3(x, y, z) { return ['10', fmt(x), '20', fmt(y), '30', fmt(z)]; }

// A small block that the showcase inserts, so the INSERT / ATTRIB case has
// real geometry to pick.
const BLOCKS = [
  '0', 'SECTION', '2', 'BLOCKS',
  '0', 'BLOCK', '2', 'TAG_BLOCK', '70', '0',
  '10', '0.0', '20', '0.0', '30', '0.0', '3', 'TAG_BLOCK', '1', '',
  '0', 'LINE', '8', '0', ...p(0, 0), ...p(60, 0),
  '0', 'LINE', '8', '0', ...p(60, 0), ...p(60, 20),
  '0', 'LINE', '8', '0', ...p(60, 20), ...p(0, 20),
  '0', 'LINE', '8', '0', ...p(0, 20), ...p(0, 0),
  '0', 'ENDBLK',
  '0', 'ENDSEC'
];

const text = (layerName, x, y, height, str, opts = {}) => {
  const a = ['0', 'TEXT', '8', layerName, '10', fmt(x), '20', fmt(y), '30', '0.0', '40', fmt(height)];
  if (opts.halign) a.push('72', String(opts.halign));
  if (opts.valign) a.push('11', fmt(opts.alignX ?? x), '21', fmt(opts.alignY ?? y), '31', '0.0');
  if (opts.valignCode !== undefined) a.push('73', String(opts.valignCode));
  if (opts.rot) a.push('50', fmt(opts.rot));
  a.push('1', str);
  return a;
};

// =========================================================================
//  2D showcase — a labelled grid of cells
// =========================================================================
function build2D() {
  const e = [];

  // Grid geometry: 4 columns x 4 rows of cells, each 170 x 120, with a
  // 40 unit gutter. Cell (col,row) origin is computed from the layout so
  // every sample sits in its own cell and nothing can overlap.
  const COLS = 4, ROWS = 5;
  const CW = 190, CH = 130, GX = 50, GY = 45;
  const X0 = 0, Y0 = 0;
  const cell = (col, row) => ({
    x: X0 + col * (CW + GX),
    y: Y0 + row * (CH + GY),
    cx: X0 + col * (CW + GX) + CW / 2,
    cy: Y0 + row * (CH + GY) + CH / 2
  });

  // Section frames + captions
  const caption = (col, row, label) => {
    const c = cell(col, row);
    e.push(...['0', 'LINE', '8', 'A-LINE', '62', '8', ...p(c.x, c.y), ...p(c.x + CW, c.y)]);
    e.push(...['0', 'LINE', '8', 'A-LINE', '62', '8', ...p(c.x + CW, c.y), ...p(c.x + CW, c.y + CH)]);
    e.push(...['0', 'LINE', '8', 'A-LINE', '62', '8', ...p(c.x + CW, c.y + CH), ...p(c.x, c.y + CH)]);
    e.push(...['0', 'LINE', '8', 'A-LINE', '62', '8', ...p(c.x, c.y + CH), ...p(c.x, c.y)]);
    e.push(...text('D-TEXT', c.x, c.y - 10, 6, label));
    return c;
  };

  // ---- row 0: line types
  {
    const c = caption(0, 4, '01  LINE / linetypes');
    e.push(...['0', 'LINE', '8', 'A-LINE', ...p(c.x + 20, c.cy + 30), ...p(c.x + CW - 20, c.cy + 30)]);
    e.push(...['0', 'LINE', '8', 'F-CONSTR', '6', 'CENTER', ...p(c.x + 20, c.cy), ...p(c.x + CW - 20, c.cy)]);
    e.push(...['0', 'LINE', '8', 'G-HIDDEN', '6', 'HIDDEN', ...p(c.x + 20, c.cy - 30), ...p(c.x + CW - 20, c.cy - 30)]);
    e.push(...text('D-TEXT', c.x + 20, c.cy + 36, 5, 'CONTINUOUS'));
    e.push(...text('D-TEXT', c.x + 20, c.cy + 6, 5, 'CENTER'));
    e.push(...text('D-TEXT', c.x + 20, c.cy - 36, 5, 'HIDDEN'));
  }

  // ---- row 0, col 1: construction lines + point
  {
    const c = caption(1, 4, '02  XLINE / RAY / POINT');
    e.push(...['0', 'XLINE', '8', 'F-CONSTR', ...p(c.x + 20, c.cy), '11', '1.0', '21', '0.0', '31', '0.0']);
    e.push(...['0', 'RAY', '8', 'F-CONSTR', ...p(c.x + 20, c.cy + 40), '11', '0.0', '21', '1.0', '31', '0.0']);
    e.push(...['0', 'POINT', '8', 'A-LINE', '62', '6', ...p(c.x + CW - 40, c.cy - 40)]);
    e.push(...text('D-TEXT', c.x + 20, c.cy + 46, 5, 'XLINE / RAY / POINT'));
  }

  // ---- row 0, col 2: circle / arc / ellipse
  {
    const c = caption(2, 4, '03  CIRCLE / ARC / ELLIPSE');
    e.push(...['0', 'CIRCLE', '8', 'B-CURVE', ...p(c.x + 55, c.cy + 30), '40', '30.0']);
    e.push(...['0', 'ARC', '8', 'B-CURVE', ...p(c.x + 135, c.cy + 30), '40', '30.0', '50', '200.0', '51', '340.0']);
    e.push(...['0', 'ELLIPSE', '8', 'B-CURVE', ...p(c.x + 95, c.cy - 40),
      '11', '45.0', '21', '0.0', '31', '0.0',
      '210', '0.0', '220', '0.0', '230', '1.0', '40', '0.5', '41', '0.0', '42', '6.283185307179586']);
    e.push(...text('D-TEXT', c.x + 20, c.cy + 66, 5, 'CIRCLE  ARC  ELLIPSE'));
  }

  // ---- row 0, col 3: spline + lwpolyline
  {
    const c = caption(3, 4, '04  SPLINE / LWPOLYLINE');
    const sp = ['0', 'SPLINE', '8', 'B-CURVE', '70', '8', '71', '3', '72', '8',
      ...p(c.x + 20, c.cy + 40), ...p(c.x + 65, c.cy + 60), ...p(c.x + 110, c.cy + 20), ...p(c.x + 155, c.cy + 45)];
    for (let i = 0; i <= 4; i++) sp.push('12', fmt(i / 4), '22', '0.0', '32', '0.0');
    e.push(...sp);
    e.push(...['0', 'LWPOLYLINE', '8', 'B-CURVE', '90', '4', '70', '1', '43', '1.5',
      ...p(c.x + 25, c.cy - 50), ...p(c.x + 90, c.cy - 50), ...p(c.x + 90, c.cy - 20), ...p(c.x + 25, c.cy - 20)]);
    e.push(...text('D-TEXT', c.x + 20, c.cy - 60, 5, 'SPLINE  LWPOLYLINE'));
  }

  // ---- row 1, col 0: polyline (old style) with bulge
  {
    const c = caption(0, 3, '05  POLYLINE (bulge arc)');
    e.push(...['0', 'POLYLINE', '8', 'B-CURVE', '66', '1', ...p(0, 0), '70', '0']);
    e.push(...['0', 'VERTEX', '8', 'B-CURVE', ...p(c.x + 20, c.cy - 30), '42', '0.6']);
    e.push(...['0', 'VERTEX', '8', 'B-CURVE', ...p(c.x + 90, c.cy - 30), '42', '-0.6']);
    e.push(...['0', 'VERTEX', '8', 'B-CURVE', ...p(c.x + 90, c.cy + 30)]);
    e.push(...['0', 'SEQEND', '8', 'B-CURVE']);
    e.push(...text('D-TEXT', c.x + 20, c.cy + 38, 5, 'bulge 0.6 / -0.6'));
  }

  // ---- row 1, col 1: SOLID (filled quad)
  {
    const c = caption(1, 3, '06  SOLID (filled quad)');
    e.push(...['0', 'SOLID', '8', 'C-FILL', '62', '3',
      '10', fmt(c.x + 30), '20', fmt(c.cy - 30),
      '11', fmt(c.x + 110), '21', fmt(c.cy - 30),
      '12', fmt(c.x + 30), '22', fmt(c.cy + 30),
      '13', fmt(c.x + 110), '23', fmt(c.cy + 30)]);
    e.push(...text('D-TEXT', c.x + 30, c.cy + 38, 5, 'SOLID'));
  }

  // ---- row 1, col 2: HATCH solid + ANSI31
  {
    const c = caption(2, 3, '07  HATCH  SOLID / ANSI31');
    e.push(...['0', 'HATCH', '8', 'C-FILL', '62', '1',
      ...p(0, 0), '210', '0.0', '220', '0.0', '230', '1.0',
      '2', 'SOLID', '70', '1', '71', '0',
      '91', '1', '92', '3', '73', '1', '93', '4',
      ...p(c.x + 30, c.cy - 30), ...p(c.x + 80, c.cy - 30), ...p(c.x + 80, c.cy + 30), ...p(c.x + 30, c.cy + 30),
      '97', '0', '75', '0', '76', '1', '47', '1.0', '98', '1', ...p(0, 0)]);
    e.push(...['0', 'HATCH', '8', 'C-FILL', '62', '8',
      ...p(0, 0), '210', '0.0', '220', '0.0', '230', '1.0',
      '2', 'ANSI31', '70', '0', '71', '0',
      '91', '1', '92', '3', '73', '1', '93', '4',
      ...p(c.x + 105, c.cy - 30), ...p(c.x + 160, c.cy - 30), ...p(c.x + 160, c.cy + 30), ...p(c.x + 105, c.cy + 30),
      '97', '0', '75', '0', '76', '1',
      '52', '0.0', '41', '1.0', '77', '0', '78', '1', '53', '45.0', '43', '1.5', '44', '0.0', '45', '0.0', '46', '0.0', '79', '0',
      '47', '1.0', '98', '1', ...p(0, 0)]);
    e.push(...text('D-TEXT', c.x + 30, c.cy + 38, 5, 'SOLID   ANSI31'));
  }

  // ---- row 1, col 3: block reference with attributes
  {
    const c = caption(3, 3, '08  INSERT + ATTRIB');
    e.push(...['0', 'INSERT', '8', 'H-BLOCK', '62', '6',
      ...p(c.x + 30, c.cy - 10), '2', 'TAG_BLOCK', '41', '1.0', '42', '1.0', '43', '1.0', '66', '1']);
    e.push(...['0', 'ATTRIB', '8', 'H-BLOCK', '62', '6', ...p(c.x + 70, c.cy + 30), '40', '5.0',
      '1', 'SHEET 01', '2', 'SHEET_NO', '70', '0']);
    e.push(...['0', 'ATTRIB', '8', 'H-BLOCK', '62', '6', ...p(c.x + 70, c.cy + 10), '40', '5.0',
      '1', 'REV A', '2', 'REVISION', '70', '0']);
    e.push(...['0', 'SEQEND', '8', 'H-BLOCK']);
    e.push(...text('D-TEXT', c.x + 30, c.cy + 38, 5, 'block with attributes'));
  }

  // ---- row 2, col 0: TEXT alignments
  {
    const c = caption(0, 2, '09  TEXT  4 alignments');
    e.push(...text('D-TEXT', c.x + 20, c.cy + 40, 7, 'Left aligned'));
    e.push(...text('D-TEXT', c.x + 95, c.cy + 20, 7, 'Center', { halign: 1, alignX: c.x + 95, alignY: c.cy + 20 }));
    e.push(...text('D-TEXT', c.x + 165, c.cy, 7, 'Right', { halign: 2, alignX: c.x + 165, alignY: c.cy }));
    e.push(...text('D-TEXT', c.x + 95, c.cy - 20, 7, 'Middle', { halign: 1, valignCode: 2, alignX: c.x + 95, alignY: c.cy - 20 }));
    e.push(...text('D-TEXT', c.x + 20, c.cy - 45, 5, 'halign 0 / 1 / 2, valign 2'));
  }

  // ---- row 2, col 1: MTEXT with inline codes
  {
    const c = caption(1, 2, '10  MTEXT  inline codes');
    e.push(...['0', 'MTEXT', '8', 'D-TEXT', ...p(c.x + 20, c.cy + 40), '40', '6.0', '41', '160.0', '71', '1',
      '1', 'Inline codes: \\PH2.5;{\\H1.5x|c2550000taller\\H2.5x} \\W0.8; narrower \\W1; normal',
      '%%c 50  %%d 30  %%p 0.05']);
    e.push(...text('D-TEXT', c.x + 20, c.cy - 45, 5, '\\H \\W \\C \\P %%c %%d %%p'));
  }

  // ---- row 2, col 2: dimensions
  {
    const c = caption(2, 2, '11  DIMENSION  aligned / radial');
    e.push(...['0', 'LINE', '8', 'A-LINE', ...p(c.x + 20, c.cy - 20), ...p(c.x + 150, c.cy - 20)]);
    e.push(...['0', 'DIMENSION', '8', 'E-DIM', '100', 'AcDbEntity', '8', 'E-DIM',
      '100', 'AcDbDimension', '2', '', ...p(c.x + 85, c.cy + 30), ...p(c.x + 85, c.cy - 5),
      '70', '1', '1', '', '71', '5', '72', '1', '41', '1.0', '42', '130.0', '73', '0', '74', '0', '75', '0',
      '3', 'STANDARD', '100', 'AcDbAlignedDimension',
      '13', fmt(c.x + 20), '23', fmt(c.cy - 20), '33', '0.0',
      '14', fmt(c.x + 150), '24', fmt(c.cy - 20), '34', '0.0',
      '100', 'AcDbRotatedDimension']);
    e.push(...['0', 'CIRCLE', '8', 'B-CURVE', ...p(c.x + 60, c.cy - 45), '40', '25.0']);
    e.push(...['0', 'DIMENSION', '8', 'E-DIM', '100', 'AcDbEntity', '8', 'E-DIM',
      '100', 'AcDbDimension', '2', '', ...p(c.x + 60, c.cy - 45), ...p(c.x + 60, c.cy - 70),
      '70', '4', '1', 'R25', '41', '1.0', '42', '25.0', '73', '0', '74', '0', '75', '0',
      '3', 'STANDARD', '100', 'AcDbRadialDimension',
      '15', fmt(c.x + 60), '25', fmt(c.cy - 45), '35', '0.0', '40', '25.0',
      '100', 'AcDbRadialDimension']);
    e.push(...text('D-TEXT', c.x + 20, c.cy + 45, 5, 'aligned + radial'));
  }

  // ---- row 2, col 3: LEADER
  {
    const c = caption(3, 2, '12  LEADER');
    e.push(...['0', 'CIRCLE', '8', 'B-CURVE', ...p(c.x + 45, c.cy - 10), '40', '22.0']);
    e.push(...['0', 'LEADER', '8', 'E-DIM', '62', '3',
      ...p(c.x + 45, c.cy - 10), ...p(c.x + 100, c.cy + 25), ...p(c.x + 155, c.cy + 25),
      '3', 'note text']);
    e.push(...text('D-TEXT', c.x + 95, c.cy + 30, 5, 'leader note'));
  }

  // ---- row 3: a full mini assembly combining several types
  {
    const c = caption(0, 1, '13  combined 2D assembly');
    e.push(...['0', 'LWPOLYLINE', '8', 'A-LINE', '90', '4', '70', '1', '43', '1.0',
      ...p(c.x + 25, c.cy - 40), ...p(c.x + 165, c.cy - 40), ...p(c.x + 165, c.cy + 25), ...p(c.x + 25, c.cy + 25)]);
    e.push(...['0', 'CIRCLE', '8', 'B-CURVE', ...p(c.x + 60, c.cy - 8), '40', '18.0']);
    e.push(...['0', 'CIRCLE', '8', 'B-CURVE', ...p(c.x + 130, c.cy - 8), '40', '18.0']);
    e.push(...['0', 'LINE', '8', 'G-HIDDEN', '6', 'HIDDEN', ...p(c.x + 60, c.cy - 8), ...p(c.x + 130, c.cy - 8)]);
    e.push(...['0', 'HATCH', '8', 'C-FILL', '62', '8',
      ...p(0, 0), '210', '0.0', '220', '0.0', '230', '1.0',
      '2', 'ANSI31', '70', '0', '71', '0',
      '91', '1', '92', '3', '73', '1', '93', '4',
      ...p(c.x + 25, c.cy - 40), ...p(c.x + 165, c.cy - 40), ...p(c.x + 165, c.cy + 25), ...p(c.x + 25, c.cy + 25),
      '97', '0', '75', '0', '76', '1',
      '52', '0.0', '41', '1.0', '77', '0', '78', '1', '53', '45.0', '43', '1.5', '44', '0.0', '45', '0.0', '46', '0.0', '79', '0',
      '47', '1.0', '98', '1', ...p(0, 0)]);
    e.push(...text('D-TEXT', c.x + 25, c.cy + 32, 5, 'outline + hatch + holes'));
  }

  // ---- row 3, col 1..3: title block
  {
    const c = caption(1, 1, '14  title block');
    e.push(...['0', 'LWPOLYLINE', '8', 'A-LINE', '90', '4', '70', '1', '43', '0.5',
      ...p(c.x + 20, c.cy - 30), ...p(c.x + 170, c.cy - 30), ...p(c.x + 170, c.cy + 30), ...p(c.x + 20, c.cy + 30)]);
    e.push(...['0', 'LINE', '8', 'A-LINE', ...p(c.x + 20, c.cy), ...p(c.x + 170, c.cy)]);
    e.push(...text('D-TEXT', c.x + 26, c.cy + 12, 5, 'TITLE'));
    e.push(...text('D-TEXT', c.x + 26, c.cy - 18, 5, 'A-01'));
    e.push(...text('D-TEXT', c.x + 100, c.cy + 12, 5, 'SCALE 1:1'));
    e.push(...text('D-TEXT', c.x + 100, c.cy - 18, 5, 'SHEET 1/1'));
  }

  // ---- title
  e.push(...text('D-TEXT', 0, 780, 16, '2D ELEMENT SHOWCASE  -  every DXF entity type'));
  e.push(...text('D-TEXT', 0, 752, 7, 'Each sample sits in its own cell; nothing overlaps.'));

  return [...HEADER, ...TABLES, ...BLOCKS, ...tail, ...e, '0', 'ENDSEC', '0', 'EOF'];
}

// =========================================================================
//  3D showcase
// =========================================================================
function build3D() {
  const e = [];
  const caption = (x, y, label) => e.push(...text('D-TEXT', x, y, 8, label));

  // --- SOLID / 3DFACE plate
  e.push(...['0', '3DFACE', '8', 'A-SOLID', '62', '3',
    '10', '0.0', '20', '0.0', '30', '0.0',
    '11', '60.0', '21', '0.0', '31', '0.0',
    '12', '60.0', '22', '40.0', '32', '0.0',
    '13', '0.0', '23', '40.0', '33', '0.0']);
  caption(0, -18, '3DFACE');

  // --- 3D solid via POLYLINE with width (thick 3D member)
  e.push(...['0', 'POLYLINE', '8', 'A-SOLID', '62', '4', '66', '1', ...p3(0, 0, 0), '70', '0']);
  e.push(...['0', 'VERTEX', '8', 'A-SOLID', ...p3(220, 0, 0), '42', '0.0']);
  e.push(...['0', 'VERTEX', '8', 'A-SOLID', ...p3(220, 60, 0)]);
  e.push(...['0', 'VERTEX', '8', 'A-SOLID', ...p3(0, 60, 0)]);
  e.push(...['0', 'SEQEND', '8', 'A-SOLID']);
  caption(160, -18, 'POLYLINE (3D)');

  // --- HELIX
  e.push(...['0', 'HELIX', '8', 'A-SOLID', '62', '1', '100', 'AcDbHelix',
    ...p3(0, 130, 0), '40', '25.0', '41', '4.0', '42', '5.0']);
  caption(0, 72, 'HELIX');

  // --- MESH box
  e.push(...['0', 'MESH', '8', 'A-SOLID', '62', '30', '100', 'AcDbSubDMesh',
    '71', '2', '72', '0', '91', '0', '92', '8',
    ...p3(420, 0, 0), ...p3(500, 0, 0), ...p3(500, 80, 0), ...p3(420, 80, 0),
    ...p3(420, 0, 60), ...p3(500, 0, 60), ...p3(500, 80, 60), ...p3(420, 80, 60),
    '93', '30',
    '90', '4', '90', '0', '90', '1', '90', '5', '90', '4', '90', '4', '90', '1', '90', '2',
    '90', '6', '90', '5', '90', '4', '90', '2', '90', '3', '90', '7', '90', '6', '90', '4',
    '90', '3', '90', '0', '90', '4', '90', '7', '90', '4', '90', '4', '90', '5', '90', '6',
    '90', '7', '90', '4', '90', '3', '90', '2', '90', '1', '90', '0',
    '94', '0', '95', '0']);
  caption(420, -18, 'MESH');

  // --- 3D text
  e.push(...['0', 'TEXT', '8', 'D-TEXT', ...p3(0, 190, 40), '40', '12.0', '72', '1',
    '11', '0.0', '21', '190.0', '31', '40.0', '1', '3D TEXT']);
  caption(0, 152, 'TEXT in space');

  // --- 3D spline
  const sp = ['0', 'SPLINE', '8', 'B-CURVE', '70', '8', '71', '3', '72', '8',
    ...p3(220, 190, 0), ...p3(280, 220, 30), ...p3(360, 170, 60)];
  for (let i = 0; i <= 2; i++) sp.push('12', fmt(i / 2), '22', '0.0', '32', '0.0');
  e.push(...sp);
  caption(200, 152, 'SPLINE in space');

  // --- 3D circle + ellipse
  e.push(...['0', 'CIRCLE', '8', 'B-CURVE', ...p3(460, 190, 40), '40', '30.0']);
  caption(430, 152, 'CIRCLE at Z=40');

  return [...HEADER, ...TABLES, ...BLOCKS, ...tail, ...e, '0', 'ENDSEC', '0', 'EOF'];
}

// =========================================================================
//  write
// =========================================================================
const out2D = path.join(samplesDir, 'elements_showcase_2d.dxf');
const out3D = path.join(samplesDir, 'elements_showcase_3d.dxf');
fs.writeFileSync(out2D, build2D().join('\n') + '\n', 'utf8');
fs.writeFileSync(out3D, build3D().join('\n') + '\n', 'utf8');
console.log('wrote', path.basename(out2D), 'and', path.basename(out3D));
