/**
 * @license GPL-3.0
 * threejs-dxf-loader - ACIS SAT/SAB decoding and B-rep surface reconstruction (plane, cone, sphere, torus, revolution spline).
 */
import * as THREE from 'three';
import { classifyHatchLoops } from './03-hatch.js';

const SAT_DECODE_TABLE = (() => {
  const t = new Map();
  t.set(0x20, ' ');
  t.set(0x40, '_');
  t.set(0x5F, '@');
  for (let c = 0x41; c <= 0x5e; c++) t.set(c, String.fromCharCode(0x41 + (0x5e - c)));
  return t;
})();

function decodeACISSatLine(line) {
  let out = '';
  let skip = false;
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (skip) { skip = false; continue; }
    const mapped = SAT_DECODE_TABLE.get(c);
    if (mapped !== undefined) {
      out += mapped;
      if (c === 0x5e) skip = true;
    } else if (c >= 33 && c <= 126) {
      out += String.fromCharCode(159 - c);
    } else {
      out += line[i];
    }
  }
  return out;
}

function decodeACISSatLines(rawLines) {
  if (!rawLines || rawLines.length === 0) return '';
  const joined = rawLines.join('\n');
  // Already-plain SAT text: detect it by the ACIS keywords rather than by
  // guessing, so an encrypted body that happens to contain those words is
  // still decoded correctly.
  if (/^\s*-?\d*\s*(body|lump|shell|face|loop|coedge|edge|vertex|point)\b/im.test(joined)) {
    return joined;
  }
  return rawLines.map(decodeACISSatLine).join('\n');
}


// ==========================================================================
// Binary ACIS (SAB) decoder — ASM BinaryFile / ACIS BinaryFile (ezdxf-compatible tags)
// Used for DXF R2013+ where 3DSOLID/REGION/SURFACE store geometry in ACDSDATA.
// ==========================================================================
const SAB_TAGS = {
  INT: 0x04,
  DOUBLE: 0x06,
  STR: 0x07,
  BOOL_TRUE: 0x0a,
  BOOL_FALSE: 0x0b,
  POINTER: 0x0c,
  ENTITY_TYPE: 0x0d,
  ENTITY_TYPE_EX: 0x0e,
  SUBTYPE_START: 0x0f,
  SUBTYPE_END: 0x10,
  RECORD_END: 0x11,
  LITERAL_STR: 0x12,
  LOCATION_VEC: 0x13,
  DIRECTION_VEC: 0x14,
  ENUM: 0x15,
  UNKNOWN_0x17: 0x17
};
const SAB_SIGNATURES = [
  [65, 67, 73, 83, 32, 66, 105, 110, 97, 114, 121, 70, 105, 108, 101], // ACIS BinaryFile
  [65, 83, 77, 32, 66, 105, 110, 97, 114, 121, 70, 105, 108, 101, 52]  // ASM BinaryFile4
];

function hexStringToUint8Array(hex) {
  const clean = String(hex || '').replace(/[\s\r\n]/g, '');
  const len = clean.length >>> 1;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16) || 0;
  }
  return out;
}

function sabMatchSignature(bytes) {
  for (let s = 0; s < SAB_SIGNATURES.length; s++) {
    const sig = SAB_SIGNATURES[s];
    if (bytes.length < sig.length) continue;
    let ok = true;
    for (let i = 0; i < sig.length; i++) {
      if (bytes[i] !== sig[i]) { ok = false; break; }
    }
    if (ok) return sig.length;
  }
  return -1;
}

class SabDecoder {
  constructor(bytes) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.index = 0;
  }
  get hasData() { return this.index < this.bytes.length; }
  readByte() {
    if (this.index >= this.bytes.length) throw new Error('SAB truncated');
    return this.bytes[this.index++];
  }
  readBytes(n) {
    if (this.index + n > this.bytes.length) throw new Error('SAB truncated');
    const start = this.index;
    this.index += n;
    return this.bytes.subarray(start, this.index);
  }
  readInt32() {
    if (this.index + 4 > this.bytes.length) throw new Error('SAB truncated');
    const v = this.view.getInt32(this.index, true);
    this.index += 4;
    return v;
  }
  readFloat64() {
    if (this.index + 8 > this.bytes.length) throw new Error('SAB truncated');
    const v = this.view.getFloat64(this.index, true);
    this.index += 8;
    return v;
  }
  readFloat64s(count) {
    const out = new Array(count);
    for (let i = 0; i < count; i++) out[i] = this.readFloat64();
    return out;
  }
  readStr(len) {
    const slice = this.readBytes(len);
    if (typeof TextDecoder !== 'undefined') {
      try { return new TextDecoder('utf-8').decode(slice); } catch (_) {}
    }
    let s = '';
    for (let i = 0; i < slice.length; i++) s += String.fromCharCode(slice[i]);
    return s;
  }
  readRecord() {
    const values = [];
    const entityType = [];
    let subtypeLevel = 0;
    while (this.hasData) {
      const tag = this.readByte();
      if (tag === SAB_TAGS.INT) {
        values.push({ tag, value: this.readInt32() });
      } else if (tag === SAB_TAGS.DOUBLE) {
        values.push({ tag, value: this.readFloat64() });
      } else if (tag === SAB_TAGS.STR) {
        values.push({ tag, value: this.readStr(this.readByte()) });
      } else if (tag === SAB_TAGS.POINTER) {
        values.push({ tag, value: this.readInt32() });
      } else if (tag === SAB_TAGS.BOOL_TRUE) {
        values.push({ tag, value: true });
      } else if (tag === SAB_TAGS.BOOL_FALSE) {
        values.push({ tag, value: false });
      } else if (tag === SAB_TAGS.LITERAL_STR) {
        values.push({ tag, value: this.readStr(this.readInt32()) });
      } else if (tag === SAB_TAGS.ENTITY_TYPE_EX) {
        entityType.push(this.readStr(this.readByte()));
      } else if (tag === SAB_TAGS.ENTITY_TYPE) {
        entityType.push(this.readStr(this.readByte()));
        values.push({ tag, value: entityType.join('-') });
        entityType.length = 0;
      } else if (tag === SAB_TAGS.LOCATION_VEC || tag === SAB_TAGS.DIRECTION_VEC) {
        values.push({ tag, value: this.readFloat64s(3) });
      } else if (tag === SAB_TAGS.ENUM) {
        values.push({ tag, value: this.readInt32() });
      } else if (tag === SAB_TAGS.UNKNOWN_0x17) {
        values.push({ tag, value: this.readFloat64() });
      } else if (tag === SAB_TAGS.SUBTYPE_START) {
        subtypeLevel += 1;
        values.push({ tag, value: subtypeLevel });
      } else if (tag === SAB_TAGS.SUBTYPE_END) {
        values.push({ tag, value: subtypeLevel });
        subtypeLevel -= 1;
      } else if (tag === SAB_TAGS.RECORD_END) {
        return values;
      } else {
        throw new Error('unknown SAB tag 0x' + tag.toString(16));
      }
    }
    return values;
  }
}

function formatSabNumber(n) {
  if (!isFinite(n)) return '0';
  if (Math.abs(n) < 1e-15) return '0';
  const s = n.toPrecision(17);
  return s.indexOf('e') >= 0 || s.indexOf('E') >= 0 ? String(n) : s.replace(/\.?0+$/, '') || '0';
}

function sabRecordToSatChunk(recordIndex, tokens) {
  if (!tokens || tokens.length === 0) return null;
  const first = tokens[0];
  if (!first || first.tag !== SAB_TAGS.ENTITY_TYPE) return null;
  const name = String(first.value || '');
  if (!name) return null;
  if (/^End-of-(ACIS|ASM)-data$/i.test(name) || name === 'End-of-ACIS-History-data') {
    return { end: true, name };
  }
  const parts = ['-' + recordIndex, name];
  // ACIS booleans are context dependent (ezdxf `acis/const.py`,
  // `BOOL_SPECIFIER`):
  //   - sense fields (coedge/edge/face sense): TRUE -> "reversed", FALSE -> "forward"
  //   - sidedness fields (face double_sided, shell solid): TRUE -> "double"/"solid"
  // Using "reversed" for every TRUE flips the loop orientation of solids and
  // therefore their shading normals, so the meaning is resolved per record.
  const isSenseRecord = /^(coedge|tcoedge-coedge|edge|tedge-edge|face|loop)$/i.test(name);
  const isSidedRecord = /^(face|shell|body|lump)$/i.test(name);
  // Skip ACIS common header (attr pointer, entity id, optional third ptr) so geometric
  // numbers align with the existing SAT reconstructor (which does not expect those fields).
  let startIdx = 1;
  let skipped = 0;
  while (startIdx < tokens.length && skipped < 3) {
    const ht = tokens[startIdx];
    if (ht && (ht.tag === SAB_TAGS.POINTER || ht.tag === SAB_TAGS.INT)) {
      startIdx++;
      skipped++;
    } else break;
  }
  for (let i = startIdx; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t) continue;
    if (t.tag === SAB_TAGS.POINTER) {
      parts.push('$' + t.value);
    } else if (t.tag === SAB_TAGS.BOOL_TRUE) {
      if (isSenseRecord) parts.push('reversed');
      else if (isSidedRecord) parts.push('double');
      else parts.push('I');
    } else if (t.tag === SAB_TAGS.BOOL_FALSE) {
      if (isSenseRecord) parts.push('forward');
      else if (isSidedRecord) parts.push('single');
      else parts.push('forward');
    } else if (t.tag === SAB_TAGS.INT || t.tag === SAB_TAGS.ENUM) {
      parts.push(String(t.value));
    } else if (t.tag === SAB_TAGS.DOUBLE || t.tag === SAB_TAGS.UNKNOWN_0x17) {
      parts.push(formatSabNumber(t.value));
    } else if (t.tag === SAB_TAGS.LOCATION_VEC || t.tag === SAB_TAGS.DIRECTION_VEC) {
      const v = t.value;
      parts.push(formatSabNumber(v[0]), formatSabNumber(v[1]), formatSabNumber(v[2]));
    } else if (t.tag === SAB_TAGS.STR || t.tag === SAB_TAGS.LITERAL_STR) {
      const s = String(t.value || '');
      if (s.indexOf(' ') >= 0 || s.indexOf('#') >= 0) parts.push('{' + s + '}');
      else parts.push(s);
    } else if (t.tag === SAB_TAGS.ENTITY_TYPE) {
      // Keep subtype class names (nubs, nurbs, exact_spl_sur, exp_par_cur, ...)
      // so the SAT bridge can parse spline / intcurve / pcurve payloads.
      if (t.value) parts.push(String(t.value));
    } else if (t.tag === SAB_TAGS.SUBTYPE_START) {
      parts.push('{');
    } else if (t.tag === SAB_TAGS.SUBTYPE_END) {
      parts.push('}');
    }
  }
  return { end: false, text: parts.join(' ') };
}

function sabBytesToSatLines(bytes) {
  if (!bytes || !bytes.length) return [];
  const sigLen = sabMatchSignature(bytes);
  if (sigLen < 0) throw new Error('not a SAB/ASM binary blob');
  const dec = new SabDecoder(bytes);
  dec.index = sigLen;
  // Header: version, n_records, n_entities, flags (raw ints, untagged)
  const version = dec.readInt32();
  dec.readInt32(); // n_records
  dec.readInt32(); // n_entities
  dec.readInt32(); // flags
  // product_id, acis_version, date as STR tags; units/tolerances as DOUBLE tags
  const expectStr = () => {
    if (dec.readByte() !== SAB_TAGS.STR) throw new Error('SAB header string tag missing');
    return dec.readStr(dec.readByte());
  };
  const expectDouble = () => {
    if (dec.readByte() !== SAB_TAGS.DOUBLE) throw new Error('SAB header double tag missing');
    return dec.readFloat64();
  };
  expectStr(); expectStr(); expectStr();
  expectDouble(); expectDouble(); expectDouble();

  const lines = [];
  // Keep a lightweight header so decodeACISSatLines recognizes plain SAT
  lines.push(String(version) + ' 0 1 0');
  let recIdx = 0;
  while (dec.hasData) {
    let tokens;
    try { tokens = dec.readRecord(); }
    catch (err) { break; }
    if (!tokens || tokens.length === 0) continue;
    const chunk = sabRecordToSatChunk(recIdx, tokens);
    if (!chunk) continue;
    if (chunk.end) break;
    // emitReconstructedACIS splits SAT on '#'; keep binary records aligned with that convention
    lines.push(chunk.text + ' #');
    recIdx++;
  }
  return lines;
}

function resolveAcisSatLines(ent, dxf) {
  if (ent.satLines && ent.satLines.length > 0) {
    return { satLines: ent.satLines, source: 'sat' };
  }
  const handle = ent.handle ? String(ent.handle).toLowerCase() : '';
  if (!handle || !dxf || !dxf.acisSabByHandle) return { satLines: null, source: 'none' };
  const entry = dxf.acisSabByHandle.get(handle);
  if (!entry) return { satLines: null, source: 'none' };
  if (entry.satLines && entry.satLines.length) return { satLines: entry.satLines, source: 'sab' };
  const bytes = entry.bytes || entry;
  const satLines = sabBytesToSatLines(bytes instanceof Uint8Array ? bytes : hexStringToUint8Array(String(bytes)));
  if (entry && typeof entry === 'object') entry.satLines = satLines;
  return { satLines, source: 'sab' };
}

// ==========================================================================
// ACIS reconstruction helpers (cone / torus / sphere / NURBS, trimmed faces)
// ==========================================================================

const ACIS_NUM_RE = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;

function acisExtractNums(rec) {
  const withoutRefs = String(rec || '').replace(/\$-?\d+/g, ' ');
  return (withoutRefs.match(ACIS_NUM_RE) || []).map(Number);
}

function acisExtractRefs(rec) {
  return (String(rec || '').match(/\$(-?\d+)/g) || []).map(s => parseInt(s.slice(1), 10));
}

function acisHasReversed(rec) {
  return /\breversed\b/i.test(String(rec || ''));
}

function acisExpandKnots(pairs, degree) {
  // ACIS omits one endpoint repetition on each axis (acadrust / SAT save format).
  const out = [];
  for (let i = 0; i < pairs.length; i++) {
    let m = pairs[i].mult | 0;
    if (m < 1) m = 1;
    if (i === 0 || i === pairs.length - 1) m += 1;
    const v = pairs[i].value;
    for (let k = 0; k < m; k++) out.push(v);
  }
  return out;
}

function acisReadKnotPairs(nums, start, count) {
  const pairs = [];
  let i = start;
  for (let k = 0; k < count; k++) {
    if (i + 1 >= nums.length) break;
    const value = nums[i];
    const mult = Math.max(1, Math.round(nums[i + 1]));
    pairs.push({ value, mult });
    i += 2;
  }
  return { pairs, next: i };
}

function acisFindSpan(degree, knots, nCtrl, u) {
  const n = nCtrl - 1;
  const p = degree;
  const uEnd = knots[n + 1];
  const uStart = knots[p];
  if (u >= uEnd) return n;
  if (u <= uStart) return p;
  let low = p, high = n + 1, mid = (low + high) >> 1;
  let guard = 0;
  while (u < knots[mid] || u >= knots[mid + 1]) {
    if (u < knots[mid]) high = mid;
    else low = mid;
    mid = (low + high) >> 1;
    if (++guard > 64) break;
  }
  return mid;
}

function acisBasisFuns(span, u, degree, knots, N) {
  N[0] = 1;
  const left = acisBasisFuns._left || (acisBasisFuns._left = new Float64Array(16));
  const right = acisBasisFuns._right || (acisBasisFuns._right = new Float64Array(16));
  for (let j = 1; j <= degree; j++) {
    left[j] = u - knots[span + 1 - j];
    right[j] = knots[span + j] - u;
    let saved = 0;
    for (let r = 0; r < j; r++) {
      const denom = right[r + 1] + left[j - r];
      const temp = denom > 1e-15 ? N[r] / denom : 0;
      N[r] = saved + right[r + 1] * temp;
      saved = left[j - r] * temp;
    }
    N[j] = saved;
  }
}

function acisEvalNurbsCurve(degree, poles, knots, weights, u) {
  if (!poles || poles.length < 1) return null;
  const nCtrl = poles.length;
  const p = Math.max(1, Math.min(degree, nCtrl - 1));
  if (!knots || knots.length < nCtrl + p + 1) return null;
  const uu = Math.min(knots[nCtrl], Math.max(knots[p], u));
  const span = acisFindSpan(p, knots, nCtrl, uu);
  const N = acisEvalNurbsCurve._N || (acisEvalNurbsCurve._N = new Float64Array(16));
  acisBasisFuns(span, uu, p, knots, N);
  let x = 0, y = 0, z = 0, wsum = 0;
  for (let j = 0; j <= p; j++) {
    const idx = span - p + j;
    if (idx < 0 || idx >= nCtrl) continue;
    const w = (weights && weights[idx] > 0) ? weights[idx] : 1;
    const bw = N[j] * w;
    const pt = poles[idx];
    x += pt.x * bw; y += pt.y * bw; z += pt.z * bw;
    wsum += bw;
  }
  if (wsum < 1e-15) return null;
  return new THREE.Vector3(x / wsum, y / wsum, z / wsum);
}

function acisEvalNurbsSurface(degU, degV, nU, nV, poles, knotsU, knotsV, weights, u, v) {
  // poles are v-major: index = v * nU + u
  if (!poles || !nU || !nV) return null;
  const pU = Math.max(1, Math.min(degU, nU - 1));
  const pV = Math.max(0, Math.min(degV, nV - 1));
  if (!knotsU || knotsU.length < nU + pU + 1) return null;
  if (!knotsV || knotsV.length < nV + pV + 1) return null;
  const uu = Math.min(knotsU[nU], Math.max(knotsU[pU], u));
  const vv = Math.min(knotsV[nV], Math.max(knotsV[pV], v));
  const spanU = acisFindSpan(pU, knotsU, nU, uu);
  const Nu = acisEvalNurbsSurface._Nu || (acisEvalNurbsSurface._Nu = new Float64Array(16));
  acisBasisFuns(spanU, uu, pU, knotsU, Nu);
  let spanV = pV, Nv;
  if (pV === 0 || nV === 1) {
    Nv = acisEvalNurbsSurface._Nv || (acisEvalNurbsSurface._Nv = new Float64Array(16));
    Nv[0] = 1;
    spanV = 0;
  } else {
    spanV = acisFindSpan(pV, knotsV, nV, vv);
    Nv = acisEvalNurbsSurface._Nv || (acisEvalNurbsSurface._Nv = new Float64Array(16));
    acisBasisFuns(spanV, vv, pV, knotsV, Nv);
  }
  let x = 0, y = 0, z = 0, wsum = 0;
  for (let j = 0; j <= pV; j++) {
    const vIdx = spanV - pV + j;
    if (vIdx < 0 || vIdx >= nV) continue;
    const nv = Nv[j];
    if (Math.abs(nv) < 1e-18) continue;
    for (let i = 0; i <= pU; i++) {
      const uIdx = spanU - pU + i;
      if (uIdx < 0 || uIdx >= nU) continue;
      const idx = vIdx * nU + uIdx;
      const w = (weights && weights[idx] > 0) ? weights[idx] : 1;
      const bw = Nu[i] * nv * w;
      const pt = poles[idx];
      if (!pt) continue;
      x += pt.x * bw; y += pt.y * bw; z += pt.z * bw;
      wsum += bw;
    }
  }
  if (wsum < 1e-15) return null;
  return new THREE.Vector3(x / wsum, y / wsum, z / wsum);
}

function acisParseSplineSurface(rec) {
  const brace = rec.indexOf('{');
  if (brace < 0) return null;
  const inner = rec.slice(brace);
  const hasNurbs = /\bnurbs\b/i.test(inner);
  const hasNubs = /\bnubs\b/i.test(inner);
  if (!hasNurbs && !hasNubs && !/\bexact_spl_sur\b/i.test(inner) && !/\b20900\b/.test(inner)) {
    return null;
  }
  const words = inner.replace(/[{}]/g, ' ').trim().split(/\s+/);
  let k = 0;
  const skipMeta = () => {
    while (k < words.length && /^(exact_spl_sur|exactsur|spline|bs3_surface|\{|\}$)/i.test(words[k])) k++;
  };
  skipMeta();
  // optional version int (20900) + form enum
  if (k < words.length && /^(20900|20800|21800|22300|700|400|20800)$/.test(words[k])) k++;
  if (k < words.length && /^-?\d+$/.test(words[k]) && Math.abs(Number(words[k])) <= 4) {
    // might be form enum before "nurbs"; don't consume if it's the degree after type
  }
  // Find nubs/nurbs even when a procedural wrapper (rot_spl_sur, etc.) precedes the bs3 payload.
  let rational = hasNurbs;
  let foundType = false;
  for (let i = 0; i < words.length; i++) {
    if (/^nurbs$/i.test(words[i])) { rational = true; k = i + 1; foundType = true; break; }
    if (/^nubs$/i.test(words[i])) { rational = false; k = i + 1; foundType = true; break; }
  }
  const nextInt = () => {
    while (k < words.length && !/^[+-]?\d+$/.test(words[k])) k++;
    if (k >= words.length) return null;
    return parseInt(words[k++], 10);
  };
  const nextNum = () => {
    while (k < words.length && !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(words[k])) k++;
    if (k >= words.length) return null;
    return Number(words[k++]);
  };
  const degU = nextInt();
  const degV = nextInt();
  if (degU == null || degV == null || degU < 1 || degU > 15 || degV < 0 || degV > 15) return null;
  // optional rational ident (none/u/v/both) and 4 closure/singularity identifiers
  if (k < words.length && /^(none|u|v|both|open|closed|periodic)$/i.test(words[k])) k++;
  let skippedIds = 0;
  while (k < words.length && skippedIds < 4 && /^(none|open|closed|periodic|0|1|2|3)$/i.test(words[k])) {
    k++;
    skippedIds++;
  }
  const nKU = nextInt();
  const nKV = nextInt();
  if (!nKU || !nKV || nKU < 2 || nKV < 1 || nKU > 400 || nKV > 400) return null;
  const numsFromHere = [];
  const startK = k;
  for (let i = k; i < words.length; i++) {
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(words[i])) numsFromHere.push(Number(words[i]));
    else if (/^(forward|reversed|I|i)$/i.test(words[i])) continue;
    else if (/^[a-zA-Z_]/.test(words[i])) break;
  }
  const uPairs = [];
  let ni = 0;
  for (let i = 0; i < nKU; i++) {
    if (ni + 1 >= numsFromHere.length) return null;
    uPairs.push({ value: numsFromHere[ni], mult: Math.max(1, Math.round(numsFromHere[ni + 1])) });
    ni += 2;
  }
  const vPairs = [];
  for (let i = 0; i < nKV; i++) {
    if (ni + 1 >= numsFromHere.length) return null;
    vPairs.push({ value: numsFromHere[ni], mult: Math.max(1, Math.round(numsFromHere[ni + 1])) });
    ni += 2;
  }
  const knotsU = acisExpandKnots(uPairs, degU);
  const knotsV = acisExpandKnots(vPairs, degV);
  const nU = knotsU.length - degU - 1;
  const nV = knotsV.length - degV - 1;
  if (nU < 2 || nV < 1 || nU > 400 || nV > 400) return null;
  const remain = numsFromHere.length - ni;
  const need4 = nU * nV * 4;
  const need3 = nU * nV * 3;
  // Infer rational if count fits 4-tuples better, even when the type tag said nubs.
  if (!rational && remain >= need4 && (remain - need4) <= (remain - need3)) rational = true;
  if (rational && remain < need4 && remain >= need3) rational = false;
  const stride = rational ? 4 : 3;
  const need = nU * nV * stride;
  if (remain < need) return null;
  const poles = [];
  const weights = rational ? [] : null;
  for (let i = 0; i < nU * nV; i++) {
    const x = numsFromHere[ni++], y = numsFromHere[ni++], z = numsFromHere[ni++];
    let w = 1;
    if (rational) w = numsFromHere[ni++];
    if (!isFinite(x) || !isFinite(y) || !isFinite(z) || !isFinite(w)) return null;
    // SAT/SAB stores (x,y,z,w); evaluate with Euclidean coords + weight.
    poles.push(new THREE.Vector3(x, y, z));
    if (weights) weights.push(w > 1e-15 ? w : 1);
  }
  const u0 = knotsU[degU], u1 = knotsU[nU];
  const v0 = knotsV[degV], v1 = knotsV[nV];
  const parsed = {
    type: 'spline',
    degU, degV, nU, nV, poles, knotsU, knotsV, weights,
    periodicU: false, periodU: (u1 - u0) || 1,
    periodicV: false, periodV: (v1 - v0) || 1,
    domainU: [u0, u1], domainV: [v0, v1],
    eval(u, v) {
      return acisEvalNurbsSurface(degU, degV, nU, nV, poles, knotsU, knotsV, weights, u, v);
    },
    invert(p) {
      return acisInvertOnSurfaceGrid(this, p, 16, 12);
    }
  };
  return parsed;
}

function acisParseIntcurve(rec) {
  const brace = rec.indexOf('{');
  if (brace < 0) return null;
  const inner = rec.slice(brace);
  const words = inner.replace(/[{}]/g, ' ').trim().split(/\s+/);
  let k = 0;
  while (k < words.length && /^(exactcur|exact_int_cur|surfintcur|intcurve|int_int_cur|parcur|lawintcur|helix|spline|bs3_curve|\{)$/i.test(words[k])) k++;
  if (k < words.length && /^(20900|20800|21800|22300|700|400)$/.test(words[k])) k++;
  if (k < words.length && /^-?\d+$/.test(words[k]) && Math.abs(Number(words[k])) <= 8) {
    // form / leftover int — only skip if the following word is nubs/nurbs or another meta
    if (k + 1 < words.length && /^(nubs|nurbs)$/i.test(words[k + 1])) k++;
  }
  let rational = false;
  for (let i = k; i < Math.min(k + 6, words.length); i++) {
    if (/^nurbs$/i.test(words[i])) { rational = true; k = i + 1; break; }
    if (/^nubs$/i.test(words[i])) { rational = false; k = i + 1; break; }
  }
  const nums = [];
  for (let i = k; i < words.length; i++) {
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(words[i])) nums.push(Number(words[i]));
    else if (/^(forward|reversed|I|i)$/i.test(words[i])) continue;
    else if (/^[a-zA-Z_]/.test(words[i])) break;
  }
  if (nums.length < 8) return null;
  let i = 0;
  // Expected: degree, form, n_knots, pairs, poles
  let degree = Math.round(nums[i++]);
  // form may be an int (0-3) or already consumed
  let form = 0;
  if (i < nums.length && nums[i] <= 8 && Number.isInteger(nums[i])) form = nums[i++];
  let nK = Math.round(nums[i++]);
  if (degree < 1 || degree > 15 || nK < 2 || nK > 800) {
    // Alternate layout: nubs already consumed degree; maybe no form field
    return acisParseIntcurveFallback(nums);
  }
  const { pairs, next } = acisReadKnotPairs(nums, i, nK);
  if (pairs.length !== nK) return acisParseIntcurveFallback(nums);
  i = next;
  const knots = acisExpandKnots(pairs, degree);
  const nCtrl = knots.length - degree - 1;
  if (nCtrl < 2 || nCtrl > 2000) return acisParseIntcurveFallback(nums);
  const remain = nums.length - i;
  if (remain >= nCtrl * 4 && (remain - nCtrl * 4) <= Math.max(8, remain - nCtrl * 3)) rational = true;
  if (rational && remain < nCtrl * 4) rational = false;
  const stride = rational ? 4 : 3;
  if (remain < nCtrl * stride) return acisParseIntcurveFallback(nums);
  const poles = [];
  const weights = rational ? [] : null;
  for (let p = 0; p < nCtrl; p++) {
    poles.push(new THREE.Vector3(nums[i], nums[i + 1], nums[i + 2]));
    i += 3;
    if (rational) {
      const w = nums[i++];
      weights.push(isFinite(w) && w > 1e-15 ? w : 1);
    }
  }
  return { type: 'intcurve', degree, poles, knots, weights, u0: knots[degree], u1: knots[nCtrl] };
}

function acisParseIntcurveFallback(nums) {
  // Coordinate harvest: sequences of plausible 3D points (legacy path).
  const poles = [];
  for (let k = 0; k + 2 < nums.length; k++) {
    const x = nums[k], y = nums[k + 1], z = nums[k + 2];
    if (Math.abs(x) < 1e7 && Math.abs(y) < 1e7 && Math.abs(z) < 1e7 &&
        isFinite(x) && isFinite(y) && isFinite(z)) {
      // Skip obvious knot-like values (0-1 range all three) unless mixed with large coords later
      poles.push(new THREE.Vector3(x, y, z));
      k += 2;
    }
  }
  if (poles.length < 3) return null;
  // Dedup near-identical consecutive samples
  const clean = [poles[0]];
  for (let i = 1; i < poles.length; i++) {
    if (poles[i].distanceToSquared(clean[clean.length - 1]) > 1e-10) clean.push(poles[i]);
  }
  if (clean.length < 3) return null;
  return { type: 'intcurve-polyline', samples: clean };
}

function acisParsePcurve(rec) {
  const brace = rec.indexOf('{');
  if (brace < 0) return null;
  const inner = rec.slice(brace);
  const words = inner.replace(/[{}]/g, ' ').trim().split(/\s+/);
  let k = 0;
  for (let i = 0; i < words.length; i++) {
    if (/^(nubs|nurbs)$/i.test(words[i])) { k = i + 1; break; }
  }
  const nums = [];
  const startAt = k || 0;
  for (let i = startAt; i < words.length; i++) {
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(words[i])) nums.push(Number(words[i]));
    else if (/^(forward|reversed|I|i|spline|ref)$/i.test(words[i])) {
      if (/^(spline|ref)$/i.test(words[i])) break;
    } else if (/^[a-zA-Z_]/.test(words[i])) break;
  }
  if (nums.length < 8) return null;
  let i = 0;
  let degree = Math.round(nums[i++]);
  if (degree < 1 || degree > 15) return null;
  if (i < nums.length && nums[i] <= 8 && Number.isInteger(nums[i])) i++; // form
  let nK = Math.round(nums[i++]);
  if (nK < 2 || nK > 400) return null;
  const { pairs, next } = acisReadKnotPairs(nums, i, nK);
  if (pairs.length !== nK) return null;
  i = next;
  const knots = acisExpandKnots(pairs, degree);
  const nCtrl = knots.length - degree - 1;
  if (nCtrl < 2 || i + nCtrl * 2 - 1 >= nums.length + 4) {
    // try anyway
  }
  if (nCtrl < 2) return null;
  const poles = [];
  for (let p = 0; p < nCtrl; p++) {
    if (i + 1 >= nums.length) break;
    poles.push(new THREE.Vector3(nums[i], nums[i + 1], 0));
    i += 2;
  }
  if (poles.length < 2) return null;
  return { type: 'pcurve', degree, poles, knots, u0: knots[degree], u1: knots[poles.length] };
}

function acisMakeOrthoFrame(axis, major) {
  const N = axis.clone().normalize();
  let U;
  if (major && major.lengthSq() > 1e-20) {
    U = major.clone().sub(N.clone().multiplyScalar(major.dot(N)));
    if (U.lengthSq() < 1e-20) U = null;
    else U.normalize();
  }
  if (!U) {
    U = Math.abs(N.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    U.cross(N).normalize();
  }
  const V = new THREE.Vector3().crossVectors(N, U).normalize();
  return { N, U, V };
}

function acisMakeConeSurface(center, axis, major, ratio, sine, cosine, radius) {
  const R = (isFinite(radius) && radius > 1e-12) ? radius : major.length();
  const frame = acisMakeOrthoFrame(axis, major);
  const rat = (isFinite(ratio) && ratio > 1e-12) ? ratio : 1;
  const U = frame.U.clone().multiplyScalar(1); // unit
  const V = frame.V.clone().multiplyScalar(rat);
  const N = frame.N;
  const C = center.clone();
  const sa = isFinite(sine) ? sine : 0;
  const ca = isFinite(cosine) ? cosine : 1;
  return {
    type: 'cone',
    center: C, axis: N, major, ratio: rat, sine: sa, cosine: ca, radius: R, U, V,
    periodicU: true, periodU: Math.PI * 2, periodicV: false, periodV: 1,
    eval(u, v) {
      const ru = R + v * sa;
      const cu = Math.cos(u), su = Math.sin(u);
      return new THREE.Vector3(
        C.x + ru * (U.x * cu + V.x * su) + (v * ca) * N.x,
        C.y + ru * (U.y * cu + V.y * su) + (v * ca) * N.y,
        C.z + ru * (U.z * cu + V.z * su) + (v * ca) * N.z
      );
    },
    invert(p) {
      const dx = p.x - C.x, dy = p.y - C.y, dz = p.z - C.z;
      const axial = dx * N.x + dy * N.y + dz * N.z;
      const rx = dx - N.x * axial, ry = dy - N.y * axial, rz = dz - N.z * axial;
      const u = Math.atan2(rx * V.x + ry * V.y + rz * V.z, rx * U.x + ry * U.y + rz * U.z);
      let v;
      if (Math.abs(ca) >= Math.abs(sa)) v = (Math.abs(ca) > 1e-12) ? axial / ca : 0;
      else {
        const rlen = Math.sqrt(rx * rx + ry * ry + rz * rz);
        v = (rlen - R) / sa;
      }
      return { u, v };
    }
  };
}

function acisMakeTorusSurface(center, normal, majorR, minorR, uDir) {
  const frame = acisMakeOrthoFrame(normal, uDir);
  const C = center.clone();
  const N = frame.N, U = frame.U, W = frame.V;
  const R = majorR, r = minorR;
  return {
    type: 'torus',
    center: C, normal: N, majorR: R, minorR: r, U, W,
    periodicU: true, periodU: Math.PI * 2, periodicV: true, periodV: Math.PI * 2,
    eval(u, v) {
      const cu = Math.cos(u), su = Math.sin(u), cv = Math.cos(v), sv = Math.sin(v);
      const rad = R + r * cv;
      return new THREE.Vector3(
        C.x + rad * (U.x * cu + W.x * su) + (r * sv) * N.x,
        C.y + rad * (U.y * cu + W.y * su) + (r * sv) * N.y,
        C.z + rad * (U.z * cu + W.z * su) + (r * sv) * N.z
      );
    },
    invert(p) {
      const dx = p.x - C.x, dy = p.y - C.y, dz = p.z - C.z;
      const axial = dx * N.x + dy * N.y + dz * N.z;
      const ix = dx - N.x * axial, iy = dy - N.y * axial, iz = dz - N.z * axial;
      const u = Math.atan2(ix * W.x + iy * W.y + iz * W.z, ix * U.x + iy * U.y + iz * U.z);
      const ilen = Math.sqrt(ix * ix + iy * iy + iz * iz) || 1e-15;
      const hx = C.x + R * (ix / ilen), hy = C.y + R * (iy / ilen), hz = C.z + R * (iz / ilen);
      const wx = p.x - hx, wy = p.y - hy, wz = p.z - hz;
      const radialDot = wx * (ix / ilen) + wy * (iy / ilen) + wz * (iz / ilen);
      const v = Math.atan2(wx * N.x + wy * N.y + wz * N.z, radialDot);
      return { u, v };
    }
  };
}

function acisMakeSphereSurface(center, radius, axis, refDir) {
  const frame = acisMakeOrthoFrame(axis || new THREE.Vector3(0, 0, 1), refDir);
  const C = center.clone();
  const N = frame.N, U = frame.U, W = frame.V;
  const R = radius;
  return {
    type: 'sphere',
    center: C, radius: R, N, U, W,
    periodicU: true, periodU: Math.PI * 2, periodicV: false, periodV: Math.PI,
    eval(u, v) {
      const cv = Math.cos(v), sv = Math.sin(v), cu = Math.cos(u), su = Math.sin(u);
      return new THREE.Vector3(
        C.x + R * (cv * (U.x * cu + W.x * su) + sv * N.x),
        C.y + R * (cv * (U.y * cu + W.y * su) + sv * N.y),
        C.z + R * (cv * (U.z * cu + W.z * su) + sv * N.z)
      );
    },
    invert(p) {
      const dx = p.x - C.x, dy = p.y - C.y, dz = p.z - C.z;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const x = dx / len, y = dy / len, z = dz / len;
      const axial = x * N.x + y * N.y + z * N.z;
      const v = Math.asin(Math.max(-1, Math.min(1, axial)));
      const ix = x - N.x * axial, iy = y - N.y * axial, iz = z - N.z * axial;
      const u = Math.atan2(ix * W.x + iy * W.y + iz * W.z, ix * U.x + iy * U.y + iz * U.z);
      return { u, v };
    }
  };
}

function acisMakePlaneSurface(root, normal, uHint) {
  const frame = acisMakeOrthoFrame(normal, uHint);
  const C = root.clone();
  const N = frame.N, U = frame.U, V = frame.V;
  return {
    type: 'plane',
    root: C, normal: N, U, V,
    periodicU: false, periodU: 1, periodicV: false, periodV: 1,
    eval(u, v) {
      return new THREE.Vector3(C.x + U.x * u + V.x * v, C.y + U.y * u + V.y * v, C.z + U.z * u + V.z * v);
    },
    invert(p) {
      const dx = p.x - C.x, dy = p.y - C.y, dz = p.z - C.z;
      return { u: dx * U.x + dy * U.y + dz * U.z, v: dx * V.x + dy * V.y + dz * V.z };
    }
  };
}

function acisInvertOnSurfaceGrid(surf, p, nu, nv) {
  const du = surf.domainU || [0, 1];
  const dv = surf.domainV || [0, 1];
  let best = { u: (du[0] + du[1]) * 0.5, v: (dv[0] + dv[1]) * 0.5 }, bestD = Infinity;
  for (let i = 0; i <= nu; i++) {
    const u = du[0] + (du[1] - du[0]) * (i / nu);
    for (let j = 0; j <= nv; j++) {
      const v = dv[0] + (dv[1] - dv[0]) * (j / nv);
      const q = surf.eval(u, v);
      if (!q) continue;
      const d = q.distanceToSquared(p);
      if (d < bestD) { bestD = d; best = { u, v }; }
    }
  }
  // Two local refinement passes
  let spanU = (du[1] - du[0]) / nu, spanV = (dv[1] - dv[0]) / nv;
  for (let pass = 0; pass < 3; pass++) {
    spanU *= 0.45; spanV *= 0.45;
    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) {
        const u = best.u + i * spanU;
        const v = best.v + j * spanV;
        if (u < du[0] - 1e-9 || u > du[1] + 1e-9 || v < dv[0] - 1e-9 || v > dv[1] + 1e-9) continue;
        const q = surf.eval(u, v);
        if (!q) continue;
        const d = q.distanceToSquared(p);
        if (d < bestD) { bestD = d; best = { u, v }; }
      }
    }
  }
  return best;
}

function acisUnwrapAngle(prev, cur, period) {
  const half = period * 0.5;
  let u = cur;
  if (prev == null || !isFinite(prev)) return u;
  while (u - prev > half) u -= period;
  while (prev - u > half) u += period;
  return u;
}

// Periodic UV bounds for a trimmed analytic face (Open CASCADE / ACIS elbow
// convention). Two isocurve ends of a 90° torus whose parameters straddle
// the atan2 branch cut used to be filled along the 270° major arc, producing
// doughnut / C-shaped "coils" that are not in the SAB.
function acisPeriodicFaceSpan(loopsUV, coord, period) {
  if (!period || !loopsUV.length) return null;
  const loopStats = [];
  for (let i = 0; i < loopsUV.length; i++) {
    const lp = loopsUV[i];
    if (!lp || !lp.length) continue;
    let lo = Infinity, hi = -Infinity, sum = 0;
    for (let k = 0; k < lp.length; k++) {
      const x = lp[k][coord];
      if (x < lo) lo = x;
      if (x > hi) hi = x;
      sum += x;
    }
    loopStats.push({ lo, hi, span: hi - lo, mean: sum / lp.length });
  }
  if (!loopStats.length) return null;
  let gmin = Infinity, gmax = -Infinity;
  for (const st of loopStats) {
    if (st.lo < gmin) gmin = st.lo;
    if (st.hi > gmax) gmax = st.hi;
  }
  // Each loop already traces nearly a full period (pipe/elbow "around"):
  // keep exactly one period, not the union of independently unwrapped copies.
  if (loopStats.every(st => st.span > period * 0.8)) {
    return { min: gmin, max: gmin + period };
  }
  // Two (or more) nearly-constant isocurves: take the shortest arc between
  // their means. In this plant all torus fittings are <= 180°.
  const constTol = period * 0.1;
  if (loopStats.length >= 2 && loopStats.every(st => st.span < constTol)) {
    const means = loopStats.map(st => st.mean);
    let bestA = means[0], bestD = period;
    for (let i = 0; i < means.length; i++) {
      for (let j = i + 1; j < means.length; j++) {
        let d = means[j] - means[i];
        while (d < 0) d += period;
        while (d >= period) d -= period;
        const short = Math.min(d, period - d);
        if (short < bestD) {
          bestD = short;
          if (d <= period * 0.5 + 1e-9) { bestA = means[i]; }
          else { bestA = means[j]; }
        }
      }
    }
    if (means.length === 2) {
      let d = means[1] - means[0];
      while (d < 0) d += period;
      while (d >= period) d -= period;
      if (d <= period * 0.5 + 1e-9) return { min: means[0], max: means[0] + d };
      return { min: means[1], max: means[0] + period };
    }
    return { min: bestA, max: bestA + bestD };
  }
  if (gmax - gmin > period) return { min: gmin, max: gmin + period };
  return { min: gmin, max: gmax };
}

function acisLoopsAreIsoRectangle(loopsUV, surf) {
  if (!loopsUV.length) return null;
  const uTol = surf.periodicU ? Math.max(1e-3, surf.periodU * 0.02) : 1e-3;
  const vTol = surf.periodicV ? Math.max(1e-3, surf.periodV * 0.02) : 1e-3;
  // Scale-agnostic fallback tols for spline param domains
  let allIso = true;
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (const loop of loopsUV) {
    if (!loop.length) continue;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      if (loop.length >= 2) {
        const b = loop[(i + 1) % loop.length];
        const du = Math.abs(a.u - b.u), dv = Math.abs(a.v - b.v);
        if (du > uTol && dv > vTol) allIso = false;
      }
      if (a.u < uMin) uMin = a.u; if (a.u > uMax) uMax = a.u;
      if (a.v < vMin) vMin = a.v; if (a.v > vMax) vMax = a.v;
    }
  }
  if (!isFinite(uMin) || !isFinite(vMin)) return null;
  if (surf.periodicU) {
    const adj = acisPeriodicFaceSpan(loopsUV, 'u', surf.periodU);
    if (adj) { uMin = adj.min; uMax = adj.max; }
  }
  if (surf.periodicV) {
    const adj = acisPeriodicFaceSpan(loopsUV, 'v', surf.periodV);
    if (adj) { vMin = adj.min; vMax = adj.max; }
  }
  // Single closed isocurve (e.g. a spherical cap): extend the nearly-constant
  // parameter toward the surface domain / pole so the face has area.
  if (uMax - uMin < 1e-8 && surf.periodicV) {
    uMin -= 0; // keep, will be handled below if still degenerate
  }
  // Only close obvious analytic caps. Extending a spline/torus trim to the
  // full surface domain invents faces that are not in the SAB.
  if ((uMax - uMin < 1e-8 || vMax - vMin < 1e-8) && loopsUV.length) {
    const mid = loopsUV[0][Math.floor(loopsUV[0].length / 4)] || loopsUV[0][0];
    if (!mid) {
      // skip
    } else if (vMax - vMin < 1e-8 && surf.type === 'sphere') {
      const pole = (Math.abs(mid.v - Math.PI / 2) < Math.abs(mid.v + Math.PI / 2)) ? Math.PI / 2 : -Math.PI / 2;
      vMin = Math.min(vMin, pole); vMax = Math.max(vMax, pole);
    } else if (uMax - uMin < 1e-8 && (surf.type === 'sphere' || surf.type === 'cone') && surf.periodicU) {
      uMin = mid.u; uMax = mid.u + surf.periodU;
    }
  }
  // Revolution spline surfaces (`rot_spl_sur`, e.g. 2:1 elliptical dished
  // heads on pressure vessels): the face is bounded by a single rim
  // isocurve plus seam edges, so the projected meridian range collapses to
  // (approximately) one parameter value while the revolution direction
  // covers the full circle. Extend the collapsed range across the meridian
  // domain toward the end farther from the rim — the same treatment the
  // sphere/cone caps get above. Grid-based inversion quantises the rim
  // parameter, so the test is relative to the surface domain, not absolute.
  if (surf.type === 'spline' && surf.domainU && surf.domainV && loopsUV.length) {
    const duDomain = Math.abs(surf.domainU[1] - surf.domainU[0]);
    const dvDomain = Math.abs(surf.domainV[1] - surf.domainV[0]);
    const duCollapsed = (uMax - uMin) < Math.max(1e-8, duDomain * 0.06);
    const vFullCircle = (vMax - vMin) >= dvDomain * 0.9;
    if (duCollapsed && vFullCircle) {
      const d0 = surf.domainU[0], d1 = surf.domainU[1];
      const mid = loopsUV[0][Math.floor(loopsUV[0].length / 4)] || loopsUV[0][0];
      if (mid) {
        if (Math.abs(mid.u - d0) <= Math.abs(d1 - mid.u)) {
          uMin = Math.min(mid.u, d0); uMax = d1;
        } else {
          uMin = d0; uMax = Math.max(mid.u, d1);
        }
      }
    }
  }
  if (uMax - uMin < 1e-12 || vMax - vMin < 1e-12) return null;
  return { uMin, uMax, vMin, vMax, allIso };
}

function acisUvInside(pt, loop) {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const yi = loop[i].v, yj = loop[j].v;
    const xi = loop[i].u, xj = loop[j].u;
    const intersect = ((yi > pt.v) !== (yj > pt.v)) &&
      (pt.u < ((xj - xi) * (pt.v - yi)) / (yj - yi + 1e-15) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function acisUvLoopArea(loop) {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i], q = loop[(i + 1) % loop.length];
    a += p.u * q.v - q.u * p.v;
  }
  return a * 0.5;
}

function acisClassifyUvLoops(loopsUV) {
  const metas = [];
  for (let idx = 0; idx < loopsUV.length; idx++) {
    const lp = loopsUV[idx];
    if (!lp || lp.length < 3) continue;
    let cu = 0, cv = 0;
    for (const p of lp) { cu += p.u; cv += p.v; }
    metas.push({
      idx, lp,
      absArea: Math.abs(acisUvLoopArea(lp)),
      c: { u: cu / lp.length, v: cv / lp.length }
    });
  }
  metas.sort((x, y) => y.absArea - x.absArea);
  const groups = [];
  const used = new Set();
  for (const m of metas) {
    if (used.has(m.idx)) continue;
    used.add(m.idx);
    const holes = [];
    for (const h of metas) {
      if (used.has(h.idx) || h.absArea >= m.absArea * 0.999) continue;
      if (acisUvInside(h.c, m.lp)) { holes.push(h.lp); used.add(h.idx); }
    }
    groups.push({ outer: m.lp, holes });
  }
  return groups;
}

function acisPointInFaceUV(pt, outer, holes) {
  if (!acisUvInside(pt, outer)) return false;
  for (let i = 0; i < holes.length; i++) {
    if (acisUvInside(pt, holes[i])) return false;
  }
  return true;
}

// Bowyer-Watson Delaunay in UV, following the Open CASCADE BRepMesh
// approach: triangulate face contours in 2D parametric space, then keep
// triangles whose centroid lies inside the trimmed face (outer minus holes).
function acisDelaunayUV(pts) {
  const n = pts.length;
  if (n < 3) return [];
  let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    if (p.u < umin) umin = p.u; if (p.u > umax) umax = p.u;
    if (p.v < vmin) vmin = p.v; if (p.v > vmax) vmax = p.v;
  }
  const du = Math.max(1e-15, umax - umin);
  const dv = Math.max(1e-15, vmax - vmin);
  const verts = new Array(n + 3);
  for (let i = 0; i < n; i++) {
    verts[i] = { u: (pts[i].u - umin) / du, v: (pts[i].v - vmin) / dv };
  }
  verts[n]     = { u: 0.5, v:  20 };
  verts[n + 1] = { u: -20, v: -20 };
  verts[n + 2] = { u:  21, v: -20 };
  const orient = (a, b, c) => {
    return (verts[b].u - verts[a].u) * (verts[c].v - verts[a].v)
         - (verts[b].v - verts[a].v) * (verts[c].u - verts[a].u);
  };
  const incircle = (a, b, c, p) => {
    const x1 = verts[a].u - verts[p].u, y1 = verts[a].v - verts[p].v;
    const x2 = verts[b].u - verts[p].u, y2 = verts[b].v - verts[p].v;
    const x3 = verts[c].u - verts[p].u, y3 = verts[c].v - verts[p].v;
    return (x1 * x1 + y1 * y1) * (x2 * y3 - x3 * y2)
         - (x2 * x2 + y2 * y2) * (x1 * y3 - x3 * y1)
         + (x3 * x3 + y3 * y3) * (x1 * y2 - x2 * y1) > 0;
  };
  const tris = [[n, n + 1, n + 2]];
  for (let i = 0; i < n; i++) {
    const bad = [];
    for (let t = 0; t < tris.length; t++) {
      let a = tris[t][0], b = tris[t][1], c = tris[t][2];
      if (orient(a, b, c) < 0) { const tmp = b; b = c; c = tmp; tris[t][1] = b; tris[t][2] = c; }
      if (incircle(a, b, c, i)) bad.push(t);
    }
    const edgeMap = new Map();
    const addEdge = (a, b) => {
      const k2 = b + ',' + a;
      if (edgeMap.has(k2)) edgeMap.delete(k2);
      else edgeMap.set(a + ',' + b, [a, b]);
    };
    for (let k = 0; k < bad.length; k++) {
      const tr = tris[bad[k]];
      addEdge(tr[0], tr[1]); addEdge(tr[1], tr[2]); addEdge(tr[2], tr[0]);
    }
    bad.sort((a, b) => b - a);
    for (let k = 0; k < bad.length; k++) tris.splice(bad[k], 1);
    for (const pair of edgeMap.values()) {
      const a = pair[0], b = pair[1];
      if (orient(a, b, i) >= 0) tris.push([a, b, i]);
      else tris.push([a, i, b]);
    }
  }
  const out = [];
  for (let t = 0; t < tris.length; t++) {
    const a = tris[t][0], b = tris[t][1], c = tris[t][2];
    if (a >= n || b >= n || c >= n) continue;
    if (orient(a, b, c) < 0) out.push([a, c, b]);
    else out.push([a, b, c]);
  }
  return out;
}

function acisTessellateFace(surf, loopsUV, batch, combMat, colorPair, sense) {
  if (!surf || !surf.eval || !loopsUV.length) return 0;
  const rect = acisLoopsAreIsoRectangle(loopsUV, surf);
  if (surf.type === 'cone') {
    nu = Math.max(24, Math.min(192, Math.round((uSpan || Math.PI * 2) / (Math.PI * 2) * 96)));
    // A cylinder (cone with sine == 0) is linear along its axis: one row of
    // quads reproduces it exactly. Extra rows only multiplied the triangle
    // count of piping-heavy assemblies by ~16 without any visual gain.
    const isCylinder = Math.abs(surf.sine || 0) < 1e-9;
    nv = isCylinder
      ? 2
      : Math.max(8, Math.min(64, Math.round((Math.abs(vSpan) || 1) > 1 ? 16 : 12) + (Math.abs(surf.sine) > 1e-6 ? 6 : 0)));
  } else if (surf.type === 'torus') {
    nu = Math.max(24, Math.min(192, Math.round((uSpan || Math.PI * 2) / (Math.PI * 2) * 72)));
    nv = Math.max(16, Math.min(72, Math.round((vSpan || Math.PI * 2) / (Math.PI * 2) * 28)));
  } else if (surf.type === 'sphere') {
    nu = Math.max(20, Math.min(128, Math.round((uSpan || Math.PI * 2) / (Math.PI * 2) * 56)));
    nv = Math.max(14, Math.min(56, Math.round((vSpan || Math.PI) / Math.PI * 28)));
  } else if (surf.type === 'spline') {
    nu = Math.max(16, Math.min(128, (surf.nU || 8) * 6));
    nv = Math.max(10, Math.min(96, (surf.nV || 4) * 7));
    if (uSpan && surf.domainU) nu = Math.max(6, Math.min(nu, Math.round((uSpan / Math.max(1e-9, surf.domainU[1] - surf.domainU[0])) * nu) + 2));
  } else {
    nu = 32; nv = 16;
  }

  const flip = sense < 0;
  let tris = 0;
  const emitTri = (p0, p1, p2) => {
    if (!p0 || !p1 || !p2) return;
    p0 = p0.clone().applyMatrix4(combMat);
    p1 = p1.clone().applyMatrix4(combMat);
    p2 = p2.clone().applyMatrix4(combMat);
    if (!flip) batch.addTriangle3D(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, colorPair);
    else batch.addTriangle3D(p0.x, p0.y, p0.z, p2.x, p2.y, p2.z, p1.x, p1.y, p1.z, colorPair);
    tris++;
  };
  const emitQuad = (p00, p10, p01, p11) => {
    emitTri(p00, p10, p11);
    emitTri(p00, p11, p01);
  };

  // Iso-rectangle (cylinder/cone/elbow/sphere band): structured UV grid, as
  // BRepMesh_CylinderRangeSplitter / ConeRangeSplitter / TorusRangeSplitter do.
  // Two const-v end circles of a pipe are not a filled 2D polygon, so the
  // bounding rectangle is the correct face and must keep this path.
  // Revolution caps (rot_spl_sur dished heads) are also full parameter
  // rectangles even though `allIso` trips: their UV contour transitions
  // from the rim isocurve to the seam isocurve at corners, which the
  // adjacency test reads as non-iso. Accept the rectangle whenever the
  // face's UV contour spans (nearly) the whole surface domain — partial
  // trimmed faces span less and keep the Delaunay trimming path.
  if (rect && !rect.allIso && surf.domainU && surf.domainV) {
    const duDomain = Math.abs(surf.domainU[1] - surf.domainU[0]);
    const dvDomain = Math.abs(surf.domainV[1] - surf.domainV[0]);
    const uCover = (rect.uMax - rect.uMin) >= duDomain * 0.95;
    const vCover = (rect.vMax - rect.vMin) >= dvDomain * 0.95;
    if (uCover && vCover) rect.allIso = true;
  }
  if (rect && rect.allIso) {
    const { uMin, uMax, vMin, vMax } = rect;
    const groups = acisClassifyUvLoops(loopsUV);
    let holeLoops = [];
    if (groups.length === 1 && groups[0].holes.length) holeLoops = groups[0].holes;
    else if (loopsUV.length > 1) {
      const vMeans = loopsUV.map(lp => {
        let s = 0; for (const p of lp) s += p.v; return s / Math.max(1, lp.length);
      });
      const vSpread = Math.max(...vMeans) - Math.min(...vMeans);
      const looksLikeTwoEnds = loopsUV.length === 2 && vSpread > Math.max(1e-6, vSpan * 0.05);
      if (!looksLikeTwoEnds && groups.length === 1) holeLoops = groups[0].holes;
    }
    for (let i = 0; i < nu; i++) {
      const u0 = uMin + (uMax - uMin) * (i / nu);
      const u1 = uMin + (uMax - uMin) * ((i + 1) / nu);
      const uc = 0.5 * (u0 + u1);
      for (let j = 0; j < nv; j++) {
        const v0 = vMin + (vMax - vMin) * (j / nv);
        const v1 = vMin + (vMax - vMin) * ((j + 1) / nv);
        if (holeLoops.length) {
          const vc = 0.5 * (v0 + v1);
          let inHole = false;
          for (const hl of holeLoops) {
            if (acisUvInside({ u: uc, v: vc }, hl)) { inHole = true; break; }
          }
          if (inHole) continue;
        }
        emitQuad(surf.eval(u0, v0), surf.eval(u1, v0), surf.eval(u0, v1), surf.eval(u1, v1));
      }
    }
    return tris;
  }

  // Non-rectangular trim: do not fill the UV bounding box (that invented
  // faces). Discretize the real contour, insert interior nodes, Delaunay.
  const groups = acisClassifyUvLoops(loopsUV);
  if (!groups.length && rect) {
    // Degenerate-area loops (e.g. two unconnected end circles) that failed
    // the allIso test still have a usable bbox.
    const { uMin, uMax, vMin, vMax } = rect;
    for (let i = 0; i < nu; i++) {
      const u0 = uMin + (uMax - uMin) * (i / nu);
      const u1 = uMin + (uMax - uMin) * ((i + 1) / nu);
      for (let j = 0; j < nv; j++) {
        const v0 = vMin + (vMax - vMin) * (j / nv);
        const v1 = vMin + (vMax - vMin) * ((j + 1) / nv);
        emitQuad(surf.eval(u0, v0), surf.eval(u1, v0), surf.eval(u0, v1), surf.eval(u1, v1));
      }
    }
    return tris;
  }

  for (const g of groups) {
    const pts = [];
    const pushUnique = (u, v) => {
      for (let k = 0; k < pts.length; k++) {
        const dU = pts[k].u - u, dV = pts[k].v - v;
        if (dU * dU + dV * dV < 1e-16) return;
      }
      pts.push({ u, v });
    };
    for (const p of g.outer) pushUnique(p.u, p.v);
    for (const h of g.holes) for (const p of h) pushUnique(p.u, p.v);
    let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    for (const p of g.outer) {
      if (p.u < uMin) uMin = p.u; if (p.u > uMax) uMax = p.u;
      if (p.v < vMin) vMin = p.v; if (p.v > vMax) vMax = p.v;
    }
    if (isFinite(uMin)) {
      for (let i = 1; i < nu; i++) {
        const u = uMin + (uMax - uMin) * (i / nu);
        for (let j = 1; j < nv; j++) {
          const v = vMin + (vMax - vMin) * (j / nv);
          if (acisPointInFaceUV({ u, v }, g.outer, g.holes)) pushUnique(u, v);
        }
      }
    }
    let idxTris = acisDelaunayUV(pts);
    const kept = [];
    for (let t = 0; t < idxTris.length; t++) {
      const a = pts[idxTris[t][0]], b = pts[idxTris[t][1]], c = pts[idxTris[t][2]];
      const mid = { u: (a.u + b.u + c.u) / 3, v: (a.v + b.v + c.v) / 3 };
      if (acisPointInFaceUV(mid, g.outer, g.holes)) kept.push(idxTris[t]);
    }
    if (!kept.length && !g.holes.length && typeof THREE !== 'undefined' && THREE.ShapeUtils) {
      try {
        const outer2 = g.outer.map(q => new THREE.Vector2(q.u, q.v));
        const fan = THREE.ShapeUtils.triangulateShape(outer2, []) || [];
        for (const t of fan) kept.push(t);
      } catch (_) {}
    }
    for (let t = 0; t < kept.length; t++) {
      const a = pts[kept[t][0]], b = pts[kept[t][1]], c = pts[kept[t][2]];
      emitTri(surf.eval(a.u, a.v), surf.eval(b.u, b.v), surf.eval(c.u, c.v));
    }
  }
  return tris;
}

function emitReconstructedACIS(satLines, colorPair, batch, worldMat) {
  const satText = decodeACISSatLines(satLines);
  if (!satText) return null;

  const rawChunks = satText.split('#').map(s => s.trim()).filter(Boolean);
  const records = new Map();
  const seqRecords = [];

  const entityStartRe = /(?:^|\n)\s*(?:-(\d+)\s+)?(body|lump|shell|subshell|face|wire|loop|coedge|tcoedge-coedge|edge|tedge-edge|vertex|tvertex-vertex|point|transform|plane-surface|cone-surface|sphere-surface|torus-surface|spline-surface|straight-curve|ellipse-curve|intcurve-curve|pcurve)\b/i;

  for (let cIdx = 0; cIdx < rawChunks.length; cIdx++) {
    let chunk = rawChunks[cIdx];
    if (cIdx === 0) {
      const m = chunk.match(entityStartRe);
      if (m && m.index !== undefined) {
        chunk = chunk.slice(m.index).trim();
      }
    }
    const idMatch = chunk.match(/^-(\d+)\s+(.*)$/s);
    if (idMatch) {
      const expId = parseInt(idMatch[1], 10);
      const bodyStr = idMatch[2].trim();
      records.set(expId, bodyStr);
      seqRecords.push({ id: expId, text: bodyStr });
    } else {
      const seqId = seqRecords.length;
      records.set(seqId, chunk);
      seqRecords.push({ id: seqId, text: chunk });
    }
  }

  const acisTransform = new THREE.Matrix4();
  const points = new Map();
  const vertices = new Map();
  const curves = new Map();
  const surfaces = new Map();
  const edges = new Map();
  const coedges = new Map();
  const loops = new Map();
  const pcurves = new Map();
  const faces = [];
  const faceStats = {
    plane: { total: 0, meshed: 0, tris: 0 },
    cone: { total: 0, meshed: 0, tris: 0 },
    torus: { total: 0, meshed: 0, tris: 0 },
    sphere: { total: 0, meshed: 0, tris: 0 },
    spline: { total: 0, meshed: 0, tris: 0 },
    other: { total: 0, meshed: 0, tris: 0 }
  };

  for (const { id, text: rec } of seqRecords) {
    const typeMatch = rec.match(/^([a-zA-Z0-9_-]+)/);
    if (!typeMatch) continue;
    const rType = typeMatch[1].toLowerCase();
    const nums = acisExtractNums(rec);
    const refs = acisExtractRefs(rec);

    if (rType === 'transform') {
      if (nums.length >= 12) {
        const s = (nums[12] && nums[12] > 0) ? nums[12] : 1.0;
        acisTransform.set(
          nums[0] * s, nums[3] * s, nums[6] * s, nums[9],
          nums[1] * s, nums[4] * s, nums[7] * s, nums[10],
          nums[2] * s, nums[5] * s, nums[8] * s, nums[11],
          0, 0, 0, 1
        );
      }
    } else if (rType === 'point') {
      if (nums.length >= 3) {
        const n = nums.length;
        points.set(id, new THREE.Vector3(nums[n - 3], nums[n - 2], nums[n - 1]));
      }
    } else if (rType === 'vertex' || rType === 'tvertex-vertex') {
      if (refs.length > 0) vertices.set(id, refs[refs.length - 1]);
    } else if (rType === 'straight-curve') {
      if (nums.length >= 6) {
        curves.set(id, {
          type: 'straight',
          root: new THREE.Vector3(nums[0], nums[1], nums[2]),
          dir: new THREE.Vector3(nums[3], nums[4], nums[5]).normalize()
        });
      }
    } else if (rType === 'ellipse-curve') {
      if (nums.length >= 10) {
        curves.set(id, {
          type: 'ellipse',
          center: new THREE.Vector3(nums[0], nums[1], nums[2]),
          normal: new THREE.Vector3(nums[3], nums[4], nums[5]).normalize(),
          major: new THREE.Vector3(nums[6], nums[7], nums[8]),
          ratio: nums[9] || 1.0
        });
      }
    } else if (rType === 'intcurve-curve') {
      const parsed = acisParseIntcurve(rec);
      if (parsed) curves.set(id, parsed);
      else curves.set(id, { type: 'intcurve', rawNums: nums });
    } else if (rType === 'pcurve') {
      const parsed = acisParsePcurve(rec);
      if (parsed) pcurves.set(id, parsed);
    } else if (rType === 'plane-surface') {
      if (nums.length >= 6) {
        const uHint = (nums.length >= 9) ? new THREE.Vector3(nums[6], nums[7], nums[8]) : null;
        surfaces.set(id, acisMakePlaneSurface(
          new THREE.Vector3(nums[0], nums[1], nums[2]),
          new THREE.Vector3(nums[3], nums[4], nums[5]),
          uHint
        ));
      }
    } else if (rType === 'cone-surface') {
      if (nums.length >= 10) {
        surfaces.set(id, acisMakeConeSurface(
          new THREE.Vector3(nums[0], nums[1], nums[2]),
          new THREE.Vector3(nums[3], nums[4], nums[5]),
          new THREE.Vector3(nums[6], nums[7], nums[8]),
          nums[9] || 1.0,
          nums.length >= 11 ? nums[10] : 0,
          nums.length >= 12 ? nums[11] : 1,
          nums.length >= 13 ? nums[12] : undefined
        ));
      }
    } else if (rType === 'sphere-surface') {
      if (nums.length >= 4 && nums[3] > 0) {
        const axis = (nums.length >= 7) ? new THREE.Vector3(nums[4], nums[5], nums[6]) : new THREE.Vector3(0, 0, 1);
        const ref = (nums.length >= 10) ? new THREE.Vector3(nums[7], nums[8], nums[9]) : null;
        surfaces.set(id, acisMakeSphereSurface(new THREE.Vector3(nums[0], nums[1], nums[2]), nums[3], axis, ref));
      }
    } else if (rType === 'torus-surface') {
      if (nums.length >= 8 && Math.abs(nums[6]) > 1e-12 && Math.abs(nums[7]) > 1e-12) {
        const uDir = (nums.length >= 11) ? new THREE.Vector3(nums[8], nums[9], nums[10]) : null;
        surfaces.set(id, acisMakeTorusSurface(
          new THREE.Vector3(nums[0], nums[1], nums[2]),
          new THREE.Vector3(nums[3], nums[4], nums[5]),
          nums[6],
          Math.abs(nums[7]),
          uDir
        ));
      }
    } else if (rType === 'spline-surface') {
      const parsed = acisParseSplineSurface(rec);
      if (parsed) surfaces.set(id, parsed);
    } else if (rType === 'edge' || rType === 'tedge-edge') {
      edges.set(id, {
        refs, sense: acisHasReversed(rec) ? -1 : 1, id,
        startParam: nums.length >= 1 ? nums[0] : null,
        endParam: nums.length >= 2 ? nums[1] : null
      });
    } else if (rType === 'coedge' || rType === 'tcoedge-coedge') {
      // ezdxf Coedge.restore_common: next, prev, partner, edge, sense, loop, ...
      coedges.set(id, { refs, sense: acisHasReversed(rec) ? -1 : 1, id, pcurveId: -1, nextId: refs.length ? refs[0] : -1 });
    } else if (rType === 'loop') {
      loops.set(id, { refs, id });
    } else if (rType === 'face') {
      faces.push({ refs, sense: acisHasReversed(rec) ? -1 : 1, id });
    }
  }

  // Attach pcurves to coedges (last matching ref)
  for (const ce of coedges.values()) {
    for (const rId of ce.refs) {
      if (pcurves.has(rId)) ce.pcurveId = rId;
    }
  }

  const combMat = new THREE.Matrix4().multiplyMatrices(worldMat, acisTransform);

  const resolveEdgePoints = (edgeObj, segs) => {
    if (!edgeObj) return [];
    let vStart = -1, vEnd = -1, curveIdx = -1;
    for (const rId of edgeObj.refs) {
      if (vertices.has(rId)) {
        if (vStart === -1) vStart = rId;
        else if (vEnd === -1) vEnd = rId;
      } else if (curves.has(rId)) {
        curveIdx = rId;
      }
    }
    const pStart = vertices.has(vStart) ? points.get(vertices.get(vStart)) : null;
    const pEnd = vertices.has(vEnd) ? points.get(vertices.get(vEnd)) : null;
    const crv = curves.get(curveIdx);
    const nSeg = segs == null ? 28 : segs;

    if (crv && crv.type === 'ellipse') {
      const c = crv.center;
      const maj = crv.major;
      const min = new THREE.Vector3().crossVectors(crv.normal, maj).multiplyScalar(crv.ratio);
      let sa = 0, ea = Math.PI * 2;
      if (pStart && pEnd) {
        const d1 = pStart.clone().sub(c);
        const d2 = pEnd.clone().sub(c);
        const rMaj = maj.length() || 1;
        const rMin = min.length() || 1;
        sa = Math.atan2(d1.dot(min) / (rMin * rMin), d1.dot(maj) / (rMaj * rMaj));
        ea = Math.atan2(d2.dot(min) / (rMin * rMin), d2.dot(maj) / (rMaj * rMaj));
        if (edgeObj.sense < 0) { const tmp = sa; sa = ea; ea = tmp; }
        while (ea <= sa + 1e-12) ea += Math.PI * 2;
        // Full circle if start≈end
        if (pStart.distanceToSquared(pEnd) < 1e-8) { sa = 0; ea = Math.PI * 2; }
      }
      const pts = [];
      const steps = Math.max(8, Math.round(nSeg * Math.max(0.15, (ea - sa) / (Math.PI * 2))));
      for (let s = 0; s <= steps; s++) {
        const a = sa + (ea - sa) * (s / steps);
        const ca = Math.cos(a), sina = Math.sin(a);
        pts.push(new THREE.Vector3(
          c.x + maj.x * ca + min.x * sina,
          c.y + maj.y * ca + min.y * sina,
          c.z + maj.z * ca + min.z * sina
        ));
      }
      return pts;
    }

    if (crv && crv.type === 'intcurve' && crv.poles) {
      let u0 = crv.u0, u1 = crv.u1;
      if (edgeObj.startParam != null && edgeObj.endParam != null && isFinite(edgeObj.startParam) && isFinite(edgeObj.endParam)) {
        u0 = edgeObj.startParam;
        u1 = edgeObj.endParam;
      }
      if (edgeObj.sense < 0) { const tmp = u0; u0 = u1; u1 = tmp; }
      const pts = [];
      const steps = Math.max(12, nSeg);
      for (let s = 0; s <= steps; s++) {
        const u = u0 + (u1 - u0) * (s / steps);
        const p = acisEvalNurbsCurve(crv.degree, crv.poles, crv.knots, crv.weights, u);
        if (p) pts.push(p);
      }
      return pts;
    }

    if (crv && crv.type === 'intcurve-polyline' && crv.samples && crv.samples.length >= 2) {
      return crv.samples.map(p => p.clone());
    }

    if (crv && crv.type === 'straight' && pStart && pEnd) {
      return [pStart.clone(), pEnd.clone()];
    }
    if (pStart && pEnd) {
      return [pStart.clone(), pEnd.clone()];
    }
    if (pStart) return [pStart.clone()];
    if (pEnd) return [pEnd.clone()];
    return [];
  };

  const walkLoop = (lp, edgeSegs) => {
    let startCoedgeId = -1;
    for (const rId of lp.refs) {
      if (coedges.has(rId)) { startCoedgeId = rId; break; }
    }
    if (startCoedgeId === -1) return { pts: [], edges: [], pcurveIds: [] };
    const loopPts3D = [];
    const usedEdges = [];
    const usedPcurves = [];
    const visited = new Set();
    let curId = startCoedgeId;
    while (curId !== -1 && !visited.has(curId) && visited.size < 400) {
      visited.add(curId);
      const ce = coedges.get(curId);
      if (!ce) break;
      let edgeObj = null;
      for (const rId of ce.refs) {
        if (edges.has(rId) && !edgeObj) edgeObj = edges.get(rId);
      }
      if (edgeObj) {
        const ePts = resolveEdgePoints(edgeObj, edgeSegs);
        if (ce.sense < 0) ePts.reverse();
        usedEdges.push({ edgeObj, ce, pts: ePts });
        usedPcurves.push(ce.pcurveId);
        for (const pt of ePts) {
          if (loopPts3D.length === 0 || pt.distanceToSquared(loopPts3D[loopPts3D.length - 1]) > 1e-10) {
            loopPts3D.push(pt);
          }
        }
      }
      // Follow only coedge.next (ezdxf Loop.coedges / mesh.py). Falling
      // through to prev or partner pulled adjacent faces into ~800 of 2024
      // loops in the plant sample and produced wrong trimmed shells.
      const nextCeId = (ce.nextId != null) ? ce.nextId : -1;
      curId = (nextCeId !== -1 && coedges.has(nextCeId) && !visited.has(nextCeId)) ? nextCeId : -1;
    }
    if (loopPts3D.length > 2 && loopPts3D[0].distanceToSquared(loopPts3D[loopPts3D.length - 1]) < 1e-8) {
      loopPts3D.pop();
    }
    return { pts: loopPts3D, edges: usedEdges, pcurveIds: usedPcurves };
  };

  const projectLoopUV = (surf, walked) => {
    const uv = [];
    let prevU = null, prevV = null;
    const periodU = surf.periodicU ? surf.periodU : 0;
    const periodV = surf.periodicV ? surf.periodV : 0;
    const pushUV = (u, v) => {
      if (periodU) u = acisUnwrapAngle(prevU, u, periodU);
      if (periodV) v = acisUnwrapAngle(prevV, v, periodV);
      uv.push({ u, v });
      prevU = u; prevV = v;
    };
    // Pcurves live in ACIS surface parameter space. Analytic eval/invert
    // follow the Open CASCADE convention (u around, v along the axis), so
    // raw pcurve UV would be wrong there. Use pcurves only on splines,
    // where they share the NURBS domain (same approach as keeping SAT
    // pcurve data in ezdxf, then evaluating in the surface's own UV).
    const allPc = surf.type === 'spline' && walked.pcurveIds.length && walked.pcurveIds.every(id => id >= 0 && pcurves.has(id));
    if (allPc && walked.edges.length) {
      for (let ei = 0; ei < walked.edges.length; ei++) {
        const { edgeObj, ce, pts } = walked.edges[ei];
        const pc = pcurves.get(walked.pcurveIds[ei]);
        const n = Math.max(1, pts.length - 1);
        let t0 = pc.u0, t1 = pc.u1;
        if (edgeObj.startParam != null && edgeObj.endParam != null) {
          t0 = edgeObj.startParam; t1 = edgeObj.endParam;
        }
        if (ce.sense < 0) { const tmp = t0; t0 = t1; t1 = tmp; }
        for (let s = 0; s <= n; s++) {
          if (ei > 0 && s === 0) continue;
          const t = t0 + (t1 - t0) * (s / n);
          const p = acisEvalNurbsCurve(pc.degree, pc.poles, pc.knots, null, t);
          if (p) pushUV(p.x, p.y);
        }
      }
      if (uv.length >= 3) return uv;
      uv.length = 0; prevU = null; prevV = null;
    }
    for (const pt of walked.pts) {
      const inv = surf.invert(pt);
      if (!inv) continue;
      pushUV(inv.u, inv.v);
    }
    return uv;
  };

  const collectFaceLoops = (faceRefs) => {
    let first = -1;
    for (const rId of faceRefs) {
      if (loops.has(rId)) { first = rId; break; }
    }
    const out = [];
    const seen = new Set();
    let lid = first;
    while (lid !== -1 && loops.has(lid) && !seen.has(lid) && seen.size < 80) {
      seen.add(lid);
      const lp = loops.get(lid);
      out.push(lp);
      let next = -1;
      for (const rId of lp.refs) {
        if (rId !== lid && loops.has(rId) && !seen.has(rId)) { next = rId; break; }
      }
      lid = next;
    }
    return out;
  };

  const meshFullAnalytic = (surf, batch, combMat, colorPair, sense) => {
    if (!surf || !surf.eval) return 0;
    let u0 = 0, u1 = 0, v0 = 0, v1 = 0, nu = 24, nv = 12;
    if (surf.type === 'sphere') {
      u0 = 0; u1 = Math.PI * 2; v0 = -Math.PI / 2; v1 = Math.PI / 2; nu = 28; nv = 16;
    } else if (surf.type === 'torus') {
      u0 = 0; u1 = Math.PI * 2; v0 = 0; v1 = Math.PI * 2; nu = 36; nv = 16;
    } else if (surf.domainU && surf.domainV) {
      u0 = surf.domainU[0]; u1 = surf.domainU[1]; v0 = surf.domainV[0]; v1 = surf.domainV[1];
    } else return 0;
    const loopsUV = [
      [{ u: u0, v: v0 }, { u: u1, v: v0 }, { u: u1, v: v1 }, { u: u0, v: v1 }]
    ];
    // Temporarily pretend periodic spans are a rectangle
    return acisTessellateFace(surf, loopsUV, batch, combMat, colorPair, sense);
  };

  // Mesh faces from topology
  for (const face of faces) {
    let surfObj = null;
    for (const rId of face.refs) {
      if (surfaces.has(rId)) surfObj = surfaces.get(rId);
    }
    const faceLoops = collectFaceLoops(face.refs);
    const stKey = (surfObj && faceStats[surfObj.type]) ? surfObj.type : 'other';
    faceStats[stKey].total++;
    if (!surfObj) continue;
    if (faceLoops.length === 0) {
      // Complete analytic faces (typically a sphere) have no boundary loops.
      if (surfObj.type === 'sphere' || surfObj.type === 'torus') {
        const nTris = meshFullAnalytic(surfObj, batch, combMat, colorPair, face.sense);
        if (nTris > 0) { faceStats[stKey].meshed++; faceStats[stKey].tris += nTris; }
      }
      continue;
    }

    if (surfObj.type === 'plane') {
      const walkedLoops = faceLoops.map(lp => walkLoop(lp, 20)).filter(w => w.pts.length >= 3);
      if (!walkedLoops.length) continue;
      const rings = walkedLoops.map(w => w.pts);
      // Project to plane UV for triangulation (with holes)
      const classified = rings.length === 1
        ? [{ outer: rings[0], holes: [] }]
        : (typeof classifyHatchLoops === 'function'
          ? classifyHatchLoops(rings.map(r => r.map(p => {
              const inv = surfObj.invert(p);
              return new THREE.Vector2(inv.u, inv.v);
            }))).map(item => {
              // classifyHatchLoops works in 2D; map back is messy — redo locally
              return null;
            })
          : null);
      // Local outer/hole classification in plane UV
      const uvRings = rings.map(r => r.map(p => {
        const inv = surfObj.invert(p);
        return { u: inv.u, v: inv.v, p };
      }));
      const metas = uvRings.map((ring, idx) => {
        let a = 0;
        for (let i = 0; i < ring.length; i++) {
          const p = ring[i], q = ring[(i + 1) % ring.length];
          a += p.u * q.v - q.u * p.v;
        }
        return { idx, ring, absArea: Math.abs(a) * 0.5, sample: ring[0] };
      });
      metas.sort((a, b) => b.absArea - a.absArea);
      const groups = [];
      const used = new Set();
      for (const m of metas) {
        if (used.has(m.idx)) continue;
        const holes = [];
        used.add(m.idx);
        for (const h of metas) {
          if (used.has(h.idx) || h.absArea >= m.absArea * 0.999) continue;
          if (acisUvInside(h.sample, m.ring)) { holes.push(h); used.add(h.idx); }
        }
        groups.push({ outer: m, holes });
      }
      let triCount = 0;
      for (const g of groups) {
        try {
          const outer2 = g.outer.ring.map(q => new THREE.Vector2(q.u, q.v));
          const holes2 = g.holes.map(h => h.ring.map(q => new THREE.Vector2(q.u, q.v)));
          const pts3 = g.outer.ring.map(q => q.p).concat(...g.holes.map(h => h.ring.map(q => q.p)));
          // ShapeUtils.triangulateShape expects hole indices into the combined? No: holes are separate arrays
          // and indices refer to each ring independently... actually triangulateShape(outer, holes)
          // returns indices into a concatenation of outer + holes verts in order.
          const allPts = g.outer.ring.map(q => q.p);
          for (const h of g.holes) for (const q of h.ring) allPts.push(q.p);
          let tris = [];
          try { tris = THREE.ShapeUtils.triangulateShape(outer2, holes2) || []; } catch (_) { tris = []; }
          const flip = face.sense < 0;
          const emit = (p0, p1, p2) => {
            const a = p0.clone().applyMatrix4(combMat);
            const b = p1.clone().applyMatrix4(combMat);
            const c = p2.clone().applyMatrix4(combMat);
            if (!flip) batch.addTriangle3D(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, colorPair);
            else batch.addTriangle3D(a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z, colorPair);
            triCount++;
          };
          if (tris.length) {
            for (const [i0, i1, i2] of tris) emit(allPts[i0], allPts[i1], allPts[i2]);
          } else if (!g.holes.length && g.outer.ring.length >= 3) {
            // Convex fan fallback (circular pipe caps, disks)
            const pts = g.outer.ring.map(q => q.p);
            const c = new THREE.Vector3();
            for (const pt of pts) c.add(pt);
            c.multiplyScalar(1 / pts.length);
            for (let i = 0; i < pts.length; i++) emit(c, pts[i], pts[(i + 1) % pts.length]);
          }
        } catch (_) {}
      }
      if (triCount > 0) {
        faceStats.plane.meshed++;
        faceStats.plane.tris += triCount;
      }
      continue;
    }

    // Curved surfaces: UV-grid tessellation of the trimmed face
    const walkedLoops = faceLoops.map(lp => walkLoop(lp, 24));
    const loopsUV = [];
    for (const w of walkedLoops) {
      if (w.pts.length >= 2) {
        const uv = projectLoopUV(surfObj, w);
        if (uv.length >= 2) loopsUV.push(uv);
      } else if (w.pts.length === 1 && surfObj.invert) {
        // Degenerate apex / pole loop: still contributes a UV bound
        const inv = surfObj.invert(w.pts[0]);
        if (inv) loopsUV.push([inv]);
      }
    }
    const nTris = acisTessellateFace(surfObj, loopsUV, batch, combMat, colorPair, face.sense);
    if (nTris > 0) {
      faceStats[stKey].meshed++;
      faceStats[stKey].tris += nTris;
    }
  }

  // Emit all 3D edges (silhouette / wire overlay)
  let emittedAnyEdge = false;
  let emittedEdgeCount = 0;
  for (const e of edges.values()) {
    const ePts = resolveEdgePoints(e, 36);
    if (ePts.length >= 2) {
      let prev = ePts[0].clone().applyMatrix4(combMat);
      for (let k = 1; k < ePts.length; k++) {
        const cur = ePts[k].clone().applyMatrix4(combMat);
        batch.addSegment(prev.x, prev.y, prev.z, cur.x, cur.y, cur.z, colorPair);
        prev = cur;
      }
      emittedAnyEdge = true;
      emittedEdgeCount++;
    }
  }
  if (!emittedAnyEdge && points.size >= 2) {
    const ptArr = Array.from(points.values()).map(p => p.clone().applyMatrix4(combMat));
    for (let i = 0; i < ptArr.length - 1; i++) {
      batch.addSegment(ptArr[i].x, ptArr[i].y, ptArr[i].z, ptArr[i + 1].x, ptArr[i + 1].y, ptArr[i + 1].z, colorPair);
    }
    emittedEdgeCount += Math.max(0, ptArr.length - 1);
  }

  let facesMeshed = 0, facesTotal = 0, faceTris = 0;
  for (const k of Object.keys(faceStats)) {
    facesTotal += faceStats[k].total;
    facesMeshed += faceStats[k].meshed;
    faceTris += faceStats[k].tris;
  }

  return {
    points: points.size,
    edges: edges.size,
    faces: faces.length,
    curves: curves.size,
    surfaces: surfaces.size,
    emittedEdges: emittedEdgeCount,
    facesTotal,
    facesMeshed,
    facesEdgeOnly: Math.max(0, facesTotal - facesMeshed),
    faceTris,
    faceStats
  };
}

export { SAT_DECODE_TABLE, decodeACISSatLine, decodeACISSatLines, SAB_TAGS, SAB_SIGNATURES, hexStringToUint8Array, sabMatchSignature, SabDecoder, formatSabNumber, sabRecordToSatChunk, sabBytesToSatLines, resolveAcisSatLines, ACIS_NUM_RE, acisExtractNums, acisExtractRefs, acisHasReversed, acisExpandKnots, acisReadKnotPairs, acisFindSpan, acisBasisFuns, acisEvalNurbsCurve, acisEvalNurbsSurface, acisParseSplineSurface, acisParseIntcurve, acisParseIntcurveFallback, acisParsePcurve, acisMakeOrthoFrame, acisMakeConeSurface, acisMakeTorusSurface, acisMakeSphereSurface, acisMakePlaneSurface, acisInvertOnSurfaceGrid, acisUnwrapAngle, acisPeriodicFaceSpan, acisLoopsAreIsoRectangle, acisUvInside, acisUvLoopArea, acisClassifyUvLoops, acisPointInFaceUV, acisDelaunayUV, acisTessellateFace, emitReconstructedACIS };
