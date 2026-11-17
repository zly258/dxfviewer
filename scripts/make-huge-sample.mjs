/**
 * Generates a large but realistic 2D sample drawing:
 *
 *   examples/samples/plant_layout_huge_2d.dxf
 *
 * A structural plant layout (~200 m x 120 m) with a column grid, equipment
 * foundations, pipe racks with elbows and valves, room partitions, dimension
 * chains, grid bubbles and annotations — about 20k entities, so the viewer
 * can be exercised the way real drawings are.
 *
 * The layout is generated with a seeded PRNG so the output is deterministic.
 *
 * Run:  node scripts/make-huge-sample.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outFile = path.join(rootDir, 'examples', 'samples', 'plant_layout_huge_2d.dxf');


// --------------------------------------------------------------------------
//  Localisation for the plant-layout sample. Only textual labels change; all
//  geometry and coordinates stay identical between the two copies.
const ZH = {
  'PLANT LAYOUT  -  OVERALL PLAN': '工厂总平面 - 装置布置图',
  'GRID: 6.0 M X 6.0 M': '柱网: 6.0 米 X 6.0 米',
  'ALL DIMENSIONS IN MILLIMETRES': '所有尺寸单位为毫米',
  'PIPE RACK EL. +6.000 (CS/SS/UT)': '管廊 标高 +6.000 (碳钢/不锈钢/公用工程)',
  'UNDERGROUND UTILITIES EL. -1.200': '地下管线 标高 -1.200',
  'EQUIPMENT FOUNDATIONS: C30 CONCRETE': '设备基础: C30 混凝土',
};
let LANG = 'en';
function L(en, zh) { return LANG === 'zh' ? zh : en; }
function tr(s) {
  if (Object.prototype.hasOwnProperty.call(ZH, s)) return ZH[s];
  // Generic patterns: equipment / room / utility labels.
  if (typeof s === 'string') {
    return s
      .replace(/ROOM-/g, '房间-')
      .replace(/  EQUIP\./g, '  设备')
      .replace(/EL\.\+/g, '标高+')
      .replace(/U\/G  EL\.-/g, '地下 标高-')
      .replace(/\bCS-/g, '碳钢-')
      .replace(/\bSS-/g, '不锈钢-')
      .replace(/\bUT-/g, '公用-')
      .replace(/\bP-/g, '泵-')
      .replace(/\bTK-/g, '罐-')
      .replace(/\bE-/g, '换热器-')
      .replace(/\bV-/g, '容器-')
      .replace(/\bCMP-/g, '压缩机-')
      .replace(/\bHX-/g, '换热器-');
  }
  return s;
}

// ------------------------------------------------------------------ helpers
let seed = 20260315;
function rnd() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
function rndInt(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }
function pick(arr) { return arr[rndInt(0, arr.length - 1)]; }
function fmt(v) { return String(Math.round(v * 1e3) / 1e3); }

let out = [];
let entCount = 0;
function E(...a) { out.push(...a); entCount++; }
const P = (x, y) => { out.push('10', fmt(x), '20', fmt(y), '30', '0.0'); };
const P2 = (x, y) => { out.push('11', fmt(x), '21', fmt(y), '31', '0.0'); };

const W = 200000;   // 200 m
const H = 120000;   // 120 m
const BAY = 6000;
const NX = Math.floor(W / BAY) + 1;   // 34
const NY = Math.floor(H / BAY) + 1;   // 21
const gridCols = [];
const gridRows = [];
for (let i = 0; i < NX; i++) gridCols.push(i * BAY);
for (let j = 0; j < NY; j++) gridRows.push(j * BAY);

// ------------------------------------------------------------------ header
function build() {
E('0', 'SECTION', '2', 'HEADER',
  '9', '$ACADVER', '1', 'AC1027',
  '9', '$INSUNITS', '70', '1',
  '9', '$EXTMIN', '10', '0.0', '20', '0.0',
  '9', '$EXTMAX', '10', fmt(W), '20', fmt(H),
  '9', '$DIMSCALE', '40', '1.0',
  '9', '$DIMTXT', '40', '250.0',
  '9', '$DIMASZ', '40', '200.0',
  '9', '$DIMEXO', '40', '100.0',
  '9', '$DIMEXE', '40', '150.0',
  '9', '$DIMGAP', '40', '80.0',
  '9', '$TEXTSIZE', '40', '250.0',
  '9', '$PDMODE', '70', '34',
  '9', '$PDSIZE', '40', '150.0',
  '0', 'ENDSEC');

// ------------------------------------------------------------------ tables
E('0', 'SECTION', '2', 'TABLES');
E('0', 'TABLE', '2', 'LTYPE');
E('0', 'LTYPE', '2', 'CONTINUOUS', '3', 'Solid line', '73', '0', '40', '0.0');
E('0', 'LTYPE', '2', 'CENTER', '3', 'Center', '73', '4', '40', '3000.0',
  '49', '1500.0', '49', '-400.0', '49', '300.0', '49', '-400.0');
E('0', 'LTYPE', '2', 'HIDDEN', '3', 'Hidden', '73', '2', '40', '1200.0',
  '49', '800.0', '49', '-400.0');
E('0', 'LTYPE', '2', 'DASHDOT', '3', 'Dash dot', '73', '4', '40', '2000.0',
  '49', '1200.0', '49', '-300.0', '49', '200.0', '49', '-300.0');
E('0', 'ENDTAB');

E('0', 'TABLE', '2', 'LAYER');
const layers = [
  ['0', 7, 'CONTINUOUS'],
  ['GRID-BUBBLE', 1, 'CONTINUOUS'],
  ['COLUMN-GRID', 8, 'DASHDOT'],
  ['STRUCT-BEAM', 7, 'CONTINUOUS'],
  ['WALL-PARTITION', 253, 'CONTINUOUS'],
  ['EQUIP-FOUNDATION', 3, 'CONTINUOUS'],
  ['PIPE-CS', 4, 'CONTINUOUS'],
  ['PIPE-SS', 5, 'CONTINUOUS'],
  ['PIPE-UTILITY', 2, 'CONTINUOUS'],
  ['VALVE-SYMBOL', 1, 'CONTINUOUS'],
  ['HATCH-CONCRETE', 9, 'CONTINUOUS'],
  ['DIMS-GRID', 6, 'CONTINUOUS'],
  ['ANNOT-EQUIP', 7, 'CONTINUOUS'],
  ['ANNOT-ROOM', 30, 'CONTINUOUS'],
  ['HIDDEN-UNDERGROUND', 254, 'HIDDEN'],
  ['CENTER-LINES', 5, 'CENTER'],
];
for (const [name, color, lt] of layers) {
  E('0', 'LAYER', '2', name, '70', '0', '62', String(color), '6', lt);
}
E('0', 'ENDTAB');

E('0', 'TABLE', '2', 'STYLE');
E('0', 'STYLE', '2', 'STANDARD', '3', 'simplex.shx', '4', '',
  '40', '0.0', '41', '1.0', '50', '0.0');
E('0', 'ENDTAB');

E('0', 'TABLE', '2', 'DIMSTYLE');
E('0', 'DIMSTYLE', '2', 'STANDARD',
  '40', '1.0', '41', '200.0', '42', '100.0', '44', '150.0',
  '140', '250.0', '147', '80.0', '271', '0');
E('0', 'ENDTAB');
E('0', 'ENDSEC');

// ------------------------------------------------------------------ blocks
E('0', 'SECTION', '2', 'BLOCKS');

E('0', 'BLOCK', '2', 'VALVE_GATE', '70', '0',
  '10', '0.0', '20', '0.0', '30', '0.0', '3', 'VALVE_GATE', '1', '');
E('0', 'LINE', '8', 'VALVE-SYMBOL', '10', '-150.0', '20', '-150.0', '30', '0.0', '11', '150.0', '21', '150.0', '31', '0.0');
E('0', 'LINE', '8', 'VALVE-SYMBOL', '10', '-150.0', '20', '150.0', '30', '0.0', '11', '150.0', '21', '-150.0', '31', '0.0');
E('0', 'LINE', '8', 'VALVE-SYMBOL', '10', '0.0', '20', '150.0', '30', '0.0', '11', '0.0', '21', '400.0', '31', '0.0');
E('0', 'LINE', '8', 'VALVE-SYMBOL', '10', '-200.0', '20', '400.0', '30', '0.0', '11', '200.0', '21', '400.0', '31', '0.0');
E('0', 'ENDBLK');

E('0', 'BLOCK', '2', 'VALVE_GLOBE', '70', '0',
  '10', '0.0', '20', '0.0', '30', '0.0', '3', 'VALVE_GLOBE', '1', '');
E('0', 'CIRCLE', '8', 'VALVE-SYMBOL', '10', '0.0', '20', '0.0', '30', '0.0', '40', '180.0');
E('0', 'LINE', '8', 'VALVE-SYMBOL', '10', '0.0', '20', '180.0', '30', '0.0', '11', '0.0', '21', '400.0', '31', '0.0');
E('0', 'LINE', '8', 'VALVE-SYMBOL', '10', '-200.0', '20', '400.0', '30', '0.0', '11', '200.0', '21', '400.0', '31', '0.0');
E('0', 'ENDBLK');

E('0', 'BLOCK', '2', 'VALVE_CHECK', '70', '0',
  '10', '0.0', '20', '0.0', '30', '0.0', '3', 'VALVE_CHECK', '1', '');
E('0', 'LINE', '8', 'VALVE-SYMBOL', '10', '-180.0', '20', '180.0', '30', '0.0', '11', '180.0', '21', '-180.0', '31', '0.0');
E('0', 'LINE', '8', 'VALVE-SYMBOL', '10', '-180.0', '20', '-180.0', '30', '0.0', '11', '180.0', '21', '180.0', '31', '0.0');
E('0', 'ENDBLK');

E('0', 'BLOCK', '2', 'ANCHOR_BOLTS', '70', '0',
  '10', '0.0', '20', '0.0', '30', '0.0', '3', 'ANCHOR_BOLTS', '1', '');
for (let i = 0; i < 8; i++) {
  const a = (i / 8) * Math.PI * 2;
  E('0', 'CIRCLE', '8', 'EQUIP-FOUNDATION', '10', fmt(Math.cos(a) * 900), '20', fmt(Math.sin(a) * 900), '30', '0.0', '40', '60.0');
}
E('0', 'ENDBLK');

E('0', 'BLOCK', '2', 'INSTR_BUBBLE', '70', '0',
  '10', '0.0', '20', '0.0', '30', '0.0', '3', 'INSTR_BUBBLE', '1', '');
E('0', 'CIRCLE', '8', 'VALVE-SYMBOL', '10', '0.0', '20', '0.0', '30', '0.0', '40', '450.0');
E('0', 'LINE', '8', 'VALVE-SYMBOL', '10', '-450.0', '20', '0.0', '30', '0.0', '11', '450.0', '21', '0.0', '31', '0.0');
E('0', 'ENDBLK');

E('0', 'ENDSEC');

// ---------------------------------------------------------------- entities
E('0', 'SECTION', '2', 'ENTITIES');

// ---- 1. Column grid: axis lines + bubbles + column footprints
const rowNames = 'ABCDEFGHIJKLMNOPQRSTU'.split('');
for (let i = 0; i < NX; i++) {
  const x = gridCols[i];
  E('0', 'LINE', '8', 'COLUMN-GRID', P(x, -8000), P2(x, H + 8000));
  E('0', 'CIRCLE', '8', 'GRID-BUBBLE', P(x, -13000), '40', '1800.0');
  E('0', 'TEXT', '8', 'GRID-BUBBLE', '10', fmt(x - 900), '20', fmt(-13600), '30', '0.0',
    '40', '2200.0', '72', '1', '11', fmt(x), '21', fmt(-11800), '31', '0.0',
    '1', String(i + 1));
  for (let j = 0; j < NY; j++) {
    const y = gridRows[j];
    // I-section column symbol: outline + web + base plate
    E('0', 'LINE', '8', 'STRUCT-BEAM', P(x - 400, y - 450), P2(x + 400, y - 450));
    E('0', 'LINE', '8', 'STRUCT-BEAM', P(x - 400, y + 450), P2(x + 400, y + 450));
    E('0', 'LINE', '8', 'STRUCT-BEAM', P(x - 400, y - 450), P2(x - 400, y + 450));
    E('0', 'LINE', '8', 'STRUCT-BEAM', P(x + 400, y - 450), P2(x + 400, y + 450));
    E('0', 'LINE', '8', 'STRUCT-BEAM', P(x - 150, y - 450), P2(x - 150, y + 450));
    E('0', 'LINE', '8', 'STRUCT-BEAM', P(x + 150, y - 450), P2(x + 150, y + 450));
    E('0', 'LINE', '8', 'STRUCT-BEAM', P(x - 550, y - 600), P2(x + 550, y - 600));
    E('0', 'LINE', '8', 'STRUCT-BEAM', P(x - 550, y - 600), P2(x - 550, y + 600));
    E('0', 'LINE', '8', 'STRUCT-BEAM', P(x + 550, y - 600), P2(x + 550, y + 600));
    E('0', 'LINE', '8', 'STRUCT-BEAM', P(x - 550, y + 600), P2(x + 550, y + 600));
  }
}
for (let j = 0; j < NY; j++) {
  const y = gridRows[j];
  E('0', 'LINE', '8', 'COLUMN-GRID', P(-8000, y), P2(W + 8000, y));
  E('0', 'CIRCLE', '8', 'GRID-BUBBLE', P(-13000, y), '40', '1800.0');
  E('0', 'TEXT', '8', 'GRID-BUBBLE', '10', fmt(-13800), '20', fmt(y - 900), '30', '0.0',
    '40', '2200.0', '72', '1', '11', fmt(-11200), '21', fmt(y), '31', '0.0',
    '1', rowNames[j] || 'Z');
}

// ---- 2. Perimeter wall
E('0', 'LWPOLYLINE', '8', 'STRUCT-BEAM', '90', '4', '70', '1', '43', '500.0',
  P(0, 0), P(W, 0), P(W, H), P(0, H));

// ---- 3. Interior partitions with doors + room labels
const rooms = [];
for (let j = 0; j < NY - 1; j++) {
  for (let i = 0; i < NX - 1; i++) {
    if (rnd() < 0.45) continue;
    const x0 = gridCols[i], y0 = gridRows[j];
    const w = rnd() < 0.5 ? BAY : BAY * 2;
    const h = rnd() < 0.5 ? BAY : BAY * 2;
    if (x0 + w > W || y0 + h > H) continue;
    rooms.push({ x: x0, y: y0, w, h, id: rooms.length + 1 });
    E('0', 'LWPOLYLINE', '8', 'WALL-PARTITION', '90', '4', '70', '1', '43', '250.0',
      P(x0, y0), P(x0 + w, y0), P(x0 + w, y0 + h), P(x0, y0 + h));
    const doorW = 1000;
    const side = rndInt(0, 1);
    if (side === 0) {
      const dx = x0 + rndInt(1500, Math.max(1600, w - 1500));
      E('0', 'LINE', '8', 'WALL-PARTITION', P(dx, y0), P2(dx + doorW, y0));
      E('0', 'ARC', '8', 'WALL-PARTITION', P(dx, y0), '40', fmt(doorW), '50', '0.0', '51', '90.0');
    } else {
      const dy = y0 + rndInt(1500, Math.max(1600, h - 1500));
      E('0', 'LINE', '8', 'WALL-PARTITION', P(x0 + w, dy), P2(x0 + w, dy + doorW));
      E('0', 'ARC', '8', 'WALL-PARTITION', P(x0 + w, dy), '40', fmt(doorW), '50', '90.0', '51', '180.0');
    }
    if (rnd() < 0.5) {
      E('0', 'TEXT', '8', 'ANNOT-ROOM',
        '10', fmt(x0 + w / 2 - 2500), '20', fmt(y0 + h / 2), '30', '0.0', '40', '900.0',
        '1', tr(`ROOM-${rooms[rooms.length - 1].id}-${rowNames[j] || 'Z'}${i + 1}`));
    }
    // Room fixtures: 2-4 equipment items per room, drawn as small rectangles
    // and circles so each bay carries a realistic amount of detail.
    const nFix = rndInt(2, 4);
    for (let f = 0; f < nFix; f++) {
      const fx = x0 + rndInt(800, Math.max(900, w - 800));
      const fy = y0 + rndInt(800, Math.max(900, h - 800));
      const fw = 600 + rndInt(0, 900);
      const fh = 500 + rndInt(0, 700);
      if (rnd() < 0.5) {
        E('0', 'LWPOLYLINE', '8', 'ANNOT-ROOM', '90', '4', '70', '1', '43', '0.0',
          P(fx, fy), P(fx + fw, fy), P(fx + fw, fy + fh), P(fx, fy + fh));
      } else {
        E('0', 'CIRCLE', '8', 'ANNOT-ROOM', P(fx, fy), '40', fmt(fw / 2));
      }
    }
  }
}

// ---- 4. Equipment foundations + anchors + labels
const equipTags = ['P-101', 'P-102', 'P-103', 'P-201', 'P-202', 'TK-301', 'TK-302', 'E-401', 'E-402', 'V-501', 'CMP-601', 'HX-701'];
let eqIdx = 0;
for (let j = 0; j < NY - 1; j += 3) {
  for (let i = 0; i < NX - 1; i += 3) {
    const x = gridCols[i] + BAY / 2, y = gridRows[j] + BAY / 2;
    const w = 6000 + rndInt(0, 4000), h = 4000 + rndInt(0, 3000);
    const tag = equipTags[eqIdx % equipTags.length]; eqIdx++;
    E('0', 'LWPOLYLINE', '8', 'EQUIP-FOUNDATION', '90', '4', '70', '1', '43', '0.0',
      P(x - w / 2, y - h / 2), P(x + w / 2, y - h / 2), P(x + w / 2, y + h / 2), P(x - w / 2, y + h / 2));
    E('0', 'HATCH', '8', 'HATCH-CONCRETE', '62', '9',
      '10', '0.0', '20', '0.0', '30', '0.0', '210', '0.0', '220', '0.0', '230', '1.0',
      '2', 'ANSI31', '70', '0', '71', '0',
      '91', '1', '92', '3', '73', '1', '93', '4',
      P(x - w / 2, y - h / 2), P(x + w / 2, y - h / 2), P(x + w / 2, y + h / 2), P(x - w / 2, y + h / 2),
      '97', '0', '75', '0', '76', '1',
      '52', '0.0', '41', '1.0', '77', '0', '78', '1', '53', '45.0', '43', '600.0', '44', '0.0', '45', '0.0', '46', '0.0', '79', '0',
      '47', '100.0', '98', '1', '10', '0.0', '20', '0.0', '30', '0.0');
    E('0', 'INSERT', '8', 'EQUIP-FOUNDATION', '2', 'ANCHOR_BOLTS',
      P(x, y), '41', '1.0', '42', '1.0', '43', '1.0', '50', '0.0');
    E('0', 'CIRCLE', '8', 'EQUIP-FOUNDATION', P(x, y), '40', fmt(Math.min(w, h) / 3));
    E('0', 'LEADER', '8', 'ANNOT-EQUIP', '62', '7',
      P(x + Math.min(w, h) / 3, y), P(x + w / 2 + 3000, y + 3000), P(x + w / 2 + 9000, y + 3000),
      '3', tr(`${tag}  EQUIP.`));
    E('0', 'TEXT', '8', 'ANNOT-EQUIP', '10', fmt(x + w / 2 + 9500), '20', fmt(y + 2500), '30', '0.0',
      '40', '800.0', '1', tr(`${tag}  EL.+5.200`));
  }
}

// ---- 5. Pipe racks: runs + valves + instruments + flanges
const pipeLayers = ['PIPE-CS', 'PIPE-SS', 'PIPE-UTILITY'];
let valveN = 0;
for (let r = 0; r < 24; r++) {
  const layer = pipeLayers[r % 3];
  const y = 4000 + r * 4800 + rndInt(-600, 600);
  if (y > H - 3000) break;
  const x0 = rndInt(0, 12000);
  const x1 = W - rndInt(0, 12000);
  const bend1 = x0 + (x1 - x0) * 0.3 + rndInt(-4000, 4000);
  const bend2 = x0 + (x1 - x0) * 0.7 + rndInt(-4000, 4000);
  const yMid = y + (rnd() < 0.5 ? 1 : -1) * rndInt(1200, 3600);
  E('0', 'LWPOLYLINE', '8', layer, '90', '4', '70', '0', '43', '350.0',
    P(x0, y), P(bend1, y), P(bend1, yMid), P(bend2, yMid), P(bend2, y), P(x1, y));
  E('0', 'TEXT', '8', layer, '10', fmt(x0 + 3000), '20', fmt(y + 700), '30', '0.0',
    '40', '700.0', '1', tr(`${layer === 'PIPE-CS' ? 'CS' : layer === 'PIPE-SS' ? 'SS' : 'UT'}-${String(100 + r)}-D${rndInt(2, 24) * 25}`));
  const nValves = rndInt(1, 3);
  for (let v = 0; v < nValves; v++) {
    const vx = x0 + ((v + 1) / (nValves + 1)) * (x1 - x0);
    const blk = pick(['VALVE_GATE', 'VALVE_GLOBE', 'VALVE_CHECK']);
    const rot = rnd() < 0.75 ? 0 : 90;
    E('0', 'INSERT', '8', 'VALVE-SYMBOL', '2', blk, P(vx, y), '41', '1.0', '42', '1.0', '43', '1.0', '50', fmt(rot));
    valveN++;
    if (valveN % 4 === 0) {
      E('0', 'INSERT', '8', 'VALVE-SYMBOL', '2', 'INSTR_BUBBLE', P(vx, y + 2200), '41', '1.0', '42', '1.0', '43', '1.0', '50', '0.0');
    }
  }
  // flange pairs along the main run
  for (let fx = x0 + 9000; fx < x1; fx += 18000) {
    E('0', 'LINE', '8', layer, P(fx, y - 600), P2(fx, y + 600));
    E('0', 'LINE', '8', layer, P(fx + 400, y - 600), P2(fx + 400, y + 600));
  }
}
for (let r = 0; r < 14; r++) {
  const layer = pipeLayers[r % 3];
  const x = 6000 + r * 13000 + rndInt(-1500, 1500);
  if (x > W - 3000) break;
  const y0 = rndInt(0, 8000);
  const y1 = H - rndInt(0, 8000);
  E('0', 'LWPOLYLINE', '8', layer, '90', '2', '70', '0', '43', '350.0',
    P(x, y0), P(x, y1));
  for (let fy = y0 + 6000; fy < y1; fy += 12000) {
    E('0', 'LINE', '8', layer, P(x - 600, fy), P2(x + 600, fy));
    E('0', 'LINE', '8', layer, P(x - 600, fy + 400), P2(x + 600, fy + 400));
  }
}

// ---- 6. Underground utilities (hidden layer)
for (let r = 0; r < 8; r++) {
  const y = 6000 + r * 14000;
  E('0', 'LINE', '8', 'HIDDEN-UNDERGROUND', P(2000, y), P2(W - 2000, y));
  const label = pick(['SW-DN600', 'PW-DN400', 'FW-DN300', 'NG-DN250', 'TG-DN150', 'EP-2x120']);
  E('0', 'TEXT', '8', 'HIDDEN-UNDERGROUND', '10', fmt(10000), '20', fmt(y + 500), '30', '0.0',
    '40', '600.0', '1', tr(`${label}  U/G  EL.-1.200`));
}

// ---- 7. Center lines for major equipment
for (let j = 0; j < NY - 1; j += 6) {
  for (let i = 0; i < NX - 1; i += 6) {
    E('0', 'LINE', '8', 'CENTER-LINES', P(gridCols[i] - 4000, gridRows[j] + BAY / 2),
      P2(gridCols[i] + BAY * 2 + 4000, gridRows[j] + BAY / 2));
    E('0', 'LINE', '8', 'CENTER-LINES', P(gridCols[i] + BAY / 2, gridRows[j] - 4000),
      P2(gridCols[i] + BAY / 2, gridRows[j] + BAY * 2 + 4000));
  }
}

// ---- 8. Dimension chains along the bottom and left
let prevX = 0;
for (let i = 0; i < NX; i++) {
  const x = gridCols[i];
  E('0', 'DIMENSION', '8', 'DIMS-GRID', '3', 'STANDARD', '70', '1',
    P(x, -42000), '11', fmt((x + prevX) / 2), '21', fmt(-38000), '31', '0.0',
    '1', '', '71', '5', '72', '1', '41', '1.0', '42', fmt(x - prevX),
    '13', fmt(prevX), '23', fmt(-44000), '33', '0.0',
    '14', fmt(x), '24', fmt(-44000), '34', '0.0',
    '100', 'AcDbAlignedDimension', '100', 'AcDbRotatedDimension');
  prevX = x;
}
let prevY = 0;
for (let j = 0; j < NY; j++) {
  const y = gridRows[j];
  E('0', 'DIMENSION', '8', 'DIMS-GRID', '3', 'STANDARD', '70', '1',
    P(-42000, y), '11', fmt(-38000), '21', fmt((y + prevY) / 2), '31', '0.0',
    '1', '', '71', '5', '72', '1', '41', '1.0', '42', fmt(y - prevY),
    '13', fmt(-44000), '23', fmt(prevY), '33', '0.0',
    '14', fmt(-44000), '24', fmt(y), '34', '0.0',
    '100', 'AcDbAlignedDimension', '100', 'AcDbRotatedDimension');
  prevY = y;
}

// ---- 9. North arrow + notes
E('0', 'CIRCLE', '8', 'A-LINE', P(W - 14000, H - 10000), '40', '3000.0');
E('0', 'LINE', '8', 'A-LINE', P(W - 14000, H - 10000), P2(W - 14000, H - 5000));
E('0', 'LINE', '8', 'A-LINE', P(W - 15500, H - 8000), P2(W - 14000, H - 10000));
E('0', 'LINE', '8', 'A-LINE', P(W - 12500, H - 8000), P2(W - 14000, H - 10000));
E('0', 'TEXT', '8', 'ANNOT-ROOM', '10', fmt(W - 14700), '20', fmt(H - 4000), '30', '0.0',
  '40', '2000.0', '72', '1', '11', fmt(W - 14000), '21', fmt(H - 3000), '31', '0.0', '1', tr('N'));

const notes = [
  'PLANT LAYOUT  -  OVERALL PLAN',
  'GRID: 6.0 M X 6.0 M',
  'ALL DIMENSIONS IN MILLIMETRES',
  'PIPE RACK EL. +6.000 (CS/SS/UT)',
  'UNDERGROUND UTILITIES EL. -1.200',
  'EQUIPMENT FOUNDATIONS: C30 CONCRETE',
];
for (let n = 0; n < notes.length; n++) {
  E('0', 'TEXT', '8', 'ANNOT-ROOM', '10', fmt(W - 60000), '20', fmt(H - 6000 - n * 2600), '30', '0.0',
    '40', '1400.0', '1', tr(notes[n]));
}

E('0', 'ENDSEC');
E('0', 'EOF');

fs.writeFileSync(outFile, out.join('\n') + '\n', 'utf8');
console.log(`wrote ${path.basename(outFile)}: ${(fs.statSync(outFile).size / 1048576).toFixed(2)} MB, ${entCount} entities`);
}
// =========================================================================
//  write — English and Chinese copies with identical geometry
// =========================================================================
for (const lang of ['en', 'zh']) {
  seed = 20260315;  // reset the PRNG so both copies have identical geometry
  LANG = lang;
  out = [];
  entCount = 0;
  const suffix = lang === 'zh' ? '_zh' : '';
  build();
  const file = path.join(rootDir, 'examples', 'samples', `plant_layout_huge_2d${suffix}.dxf`);
  fs.writeFileSync(file, out.join('\n') + '\n', 'utf8');
  console.log(`wrote ${path.basename(file)}: ${(fs.statSync(file).size / 1048576).toFixed(2)} MB, ${entCount} entities`);
}
