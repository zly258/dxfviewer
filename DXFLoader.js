/**
 * THREE.DXFLoader v7.0 — Precision 2D/3D AutoCAD DXF Loader for Three.js
 *
 * Key Fixes in v7.0:
 *  1. Calibrated Solid Filled 2D Text (Height, Width & Style Inheritance):
 *     - Fixes parser initialization where `ent.height` and `ent.xscale` defaulted to truthy constants
 *       (`2.5` and `1.0`), which previously masked `STYLE` table `height` (`code 40`), `widthFactor`
 *       (`code 41`), and `$TEXTSIZE` / `$DIMSCALE` / `$DIMTXT`.
 *     - Calibrates Canvas Texture Atlas em-height and horizontal condensation so both CJK ideographs
 *       and Latin/numeric characters match AutoCAD's nominal `height` (`code 40`) and `widthFactor` (`code 41`)
 *       1:1 without oversized bloat or cell overflow.
 *     - Supports `MTEXT` reference width (`refWidth`, code 41) automatic word-wrapping.
 *     - Automatically un-mirrors text quads inside mirrored `INSERT` blocks (`det2D < 0`) so text
 *       stays readable left-to-right within its exact bounding box.
 *  2. Elimination of Deviated / Offset Elements (OCS / UCS / Subclass / Block Fixes):
 *     - Stops `ATTRIB` / `ATTDEF` / `TEXT` parsing at `100: AcDbXrecord` or `101: Embedded Object` so
 *       trailing annotation-scale (`40: 1.0`), lock flags (`70: 1`), and `(0,0,0)` Xrecord points never
 *       overwrite the entity's true coordinates or height.
 *     - Fixes `*D<n>` anonymous `DIMENSION` blocks: applies `(ent.x2, ent.y2, ent.z2)` (`code 12,22,32`)
 *       clone offset in OCS while keeping `*D<n>` internal WCS geometry un-flipped, and skips internal
 *       `DEFPOINTS` / `POINT` markers.
 *     - Fixes procedural `DIMENSION` OCS text midpoint (`11,21,31`), UCS horizontal rotation (`51`),
 *       and 2-line angular dimension (`dimType === 2`) line-line intersection vertex.
 *     - Fixes out-of-order non-polyline `HATCH` boundary edges via greedy nearest-endpoint stitching,
 *       caps polyline loop vertices at `code 93` count, and honors `code 73` (`ccw`) on elliptic arcs.
 *     - Filters out invisible spline-frame control vertices (`v.flags & 16`) on spline-fit 2D `POLYLINE`s
 *       and skips Paper Space `VIEWPORT` frames in Model Space.
 */

(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory;
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    root.DXFLoader = factory(root.THREE);
    if (root.THREE) root.THREE.DXFLoader = root.DXFLoader;
  }
})(typeof self !== 'undefined' ? self : this, function (THREE) {
  'use strict';

  if (!THREE && typeof window !== 'undefined' && window.THREE) {
    THREE = window.THREE;
  }

  // ============================================================================
  // 1. Contiguous Float32GrowableBuffer
  // ============================================================================
  class Float32GrowableBuffer {
    constructor(initialCapacity = 8192) {
      this.data = new Float32Array(initialCapacity);
      this.length = 0;
    }

    ensure(additional) {
      const needed = this.length + additional;
      if (needed <= this.data.length) return;
      let newCap = this.data.length * 2;
      while (newCap < needed) newCap *= 2;
      const next = new Float32Array(newCap);
      next.set(this.data.subarray(0, this.length));
      this.data = next;
    }

    push3(a, b, c) {
      if (this.length + 3 > this.data.length) this.ensure(3);
      const d = this.data;
      let l = this.length;
      d[l] = a; d[l + 1] = b; d[l + 2] = c;
      this.length = l + 3;
    }

    push6(a, b, c, d, e, f) {
      if (this.length + 6 > this.data.length) this.ensure(6);
      const arr = this.data;
      let l = this.length;
      arr[l] = a; arr[l + 1] = b; arr[l + 2] = c;
      arr[l + 3] = d; arr[l + 4] = e; arr[l + 5] = f;
      this.length = l + 6;
    }

    push9(a, b, c, d, e, f, g, h, i) {
      if (this.length + 9 > this.data.length) this.ensure(9);
      const arr = this.data;
      let l = this.length;
      arr[l] = a; arr[l + 1] = b; arr[l + 2] = c;
      arr[l + 3] = d; arr[l + 4] = e; arr[l + 5] = f;
      arr[l + 6] = g; arr[l + 7] = h; arr[l + 8] = i;
      this.length = l + 9;
    }

    pushRGBRepeat(r, g, b, count) {
      const add = count * 3;
      if (this.length + add > this.data.length) this.ensure(add);
      const arr = this.data;
      let l = this.length;
      for (let i = 0; i < count; i++) {
        arr[l] = r; arr[l + 1] = g; arr[l + 2] = b;
        l += 3;
      }
      this.length = l;
    }

    toTypedArray() {
      return this.data.subarray(0, this.length);
    }
  }

  // ============================================================================
  // 2. AutoCAD Color Index (ACI 0-255) Official Palette
  // ============================================================================
  const ACI_PALETTE = [
    0x000000, 0xFF0000, 0xFFFF00, 0x00FF00, 0x00FFFF, 0x0000FF, 0xFF00FF, 0xFFFFFF, 0x808080, 0xC0C0C0,
    0xFF0000, 0xFF7F7F, 0xCC0000, 0xCC6666, 0x990000, 0x994C4C, 0x7F0000, 0x7F3F3F, 0x4C0000, 0x4C2626,
    0xFF3F00, 0xFF9F7F, 0xCC3300, 0xCC7F66, 0x992600, 0x995F4C, 0x7F1F00, 0x7F4F3F, 0x4C1300, 0x4C2F26,
    0xFF7F00, 0xFFBF7F, 0xCC6600, 0xCC9966, 0x994C00, 0x99724C, 0x7F3F00, 0x7F5F3F, 0x4C2600, 0x4C3926,
    0xFFBF00, 0xFFDF7F, 0xCC9900, 0xCCB266, 0x997200, 0x99854C, 0x7F5F00, 0x7F6F3F, 0x4C3900, 0x4C4226,
    0xFFFF00, 0xFFFF7F, 0xCCCC00, 0xCCCC66, 0x999900, 0x99994C, 0x7F7F00, 0x7F7F3F, 0x4C4C00, 0x4C4C26,
    0xBFFF00, 0xDFFF7F, 0x99CC00, 0xB2CC66, 0x729900, 0x85994C, 0x5F7F00, 0x6F7F3F, 0x394C00, 0x424C26,
    0x7FFF00, 0xBFFF7F, 0x66CC00, 0x99CC66, 0x4C9900, 0x72994C, 0x3F7F00, 0x5F7F3F, 0x264C00, 0x394C26,
    0x3FFF00, 0x9FFF7F, 0x33CC00, 0x7FCC66, 0x269900, 0x5F994C, 0x1F7F00, 0x4F7F3F, 0x134C00, 0x2F4C26,
    0x00FF00, 0x7FFF7F, 0x00CC00, 0x66CC66, 0x009900, 0x4C994C, 0x007F00, 0x3F7F3F, 0x004C00, 0x264C26,
    0x00FF3F, 0x7FFF9F, 0x00CC33, 0x66CC7F, 0x009926, 0x4C995F, 0x007F1F, 0x3F7F4F, 0x004C13, 0x264C2F,
    0x00FF7F, 0x7FFFBF, 0x00CC66, 0x66CC99, 0x00994C, 0x4C9972, 0x007F3F, 0x3F7F5F, 0x004C26, 0x264C39,
    0x00FFBF, 0x7FFFDF, 0x00CC99, 0x66CCB2, 0x009972, 0x4C9985, 0x007F5F, 0x3F7F6F, 0x004C39, 0x264C42,
    0x00FFFF, 0x7FFFFF, 0x00CCCC, 0x66CCCC, 0x009999, 0x4C9999, 0x007F7F, 0x3F7F7F, 0x004C4C, 0x264C4C,
    0x00BFFF, 0x7FDFFF, 0x0099CC, 0x66B2CC, 0x007299, 0x4C8599, 0x005F7F, 0x3F6F7F, 0x00394C, 0x26424C,
    0x007FFF, 0x7FBFFF, 0x0066CC, 0x6699CC, 0x004C99, 0x4C7299, 0x003F7F, 0x3F5F7F, 0x00264C, 0x26394C,
    0x003FFF, 0x7F9FFF, 0x0033CC, 0x667FCC, 0x002699, 0x4C5F99, 0x001F7F, 0x3F4F7F, 0x00134C, 0x262F4C,
    0x0000FF, 0x7F7FFF, 0x0000CC, 0x6666CC, 0x000099, 0x4C4C99, 0x00007F, 0x3F3F7F, 0x00004C, 0x26264C,
    0x3F00FF, 0x9F7FFF, 0x3300CC, 0x7F66CC, 0x260099, 0x5F4C99, 0x1F007F, 0x4F3F7F, 0x13004C, 0x2F264C,
    0x7F00FF, 0xBF7FFF, 0x6600CC, 0x9966CC, 0x4C0099, 0x724C99, 0x3F007F, 0x5F3F7F, 0x26004C, 0x39264C,
    0xBF00FF, 0xDF7FFF, 0x9900CC, 0xB266CC, 0x720099, 0x854C99, 0x5F007F, 0x6F3F7F, 0x39004C, 0x42264C,
    0xFF00FF, 0xFF7FFF, 0xCC00CC, 0xCC66CC, 0x990099, 0x994C99, 0x7F007F, 0x7F3F7F, 0x4C004C, 0x4C264C,
    0xFF00BF, 0xFF7FDF, 0xCC0099, 0xCC66B2, 0x990072, 0x994C85, 0x7F005F, 0x7F3F6F, 0x4C0039, 0x4C2642,
    0xFF007F, 0xFF7FBF, 0xCC0066, 0xCC6699, 0x99004C, 0x994C72, 0x7F003F, 0x7F3F5F, 0x4C0026, 0x4C2639,
    0xFF003F, 0xFF7F9F, 0xCC0033, 0xCC667F, 0x990026, 0x994C5F, 0x7F001F, 0x7F3F4F, 0x4C0013, 0x4C262F,
    0x333333, 0x505050, 0x696969, 0x828282, 0xBEBEBE, 0xFFFFFF
  ];

  function normKey(str, fallback = '0') {
    if (str === undefined || str === null || String(str).trim() === '') return fallback;
    return String(str).trim().toUpperCase();
  }

  // ============================================================================
  // 3. Auto-Detect Encoding (UTF-8 vs GB18030/GBK) & Decode \M+nXXXX MIF Escapes
  // ============================================================================
  function decodeDXFArrayBuffer(buffer) {
    if (typeof buffer === 'string') return { text: buffer, encoding: 'UTF-8' };
    const bytes = new Uint8Array(buffer);
    if (bytes.length > 22) {
      const head = String.fromCharCode(...bytes.slice(0, 18));
      if (head === 'AutoCAD Binary DXF') {
        return { text: '', encoding: 'BINARY_DXF', isBinary: true };
      }
    }
    if (typeof TextDecoder !== 'undefined') {
      try {
        const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
        const text = utf8Decoder.decode(bytes);
        return { text, encoding: 'UTF-8' };
      } catch (_) {
        try {
          const gbkDecoder = new TextDecoder('gb18030');
          const text = gbkDecoder.decode(bytes);
          return { text, encoding: 'GB18030 / GBK' };
        } catch (_2) {
          const fallback = new TextDecoder('utf-8');
          return { text: fallback.decode(bytes), encoding: 'UTF-8' };
        }
      }
    }
    return { text: '', encoding: 'UNKNOWN' };
  }

  function decodeMIFAndSpecialChars(str) {
    if (!str) return '';
    let s = String(str)
      .replace(/%%[cC]/g, '⌀')
      .replace(/%%[dD]/g, '°')
      .replace(/%%[pP]/g, '±')
      .replace(/%%[oO]/g, '')
      .replace(/%%[uU]/g, '')
      .replace(/%%%/g, '%')
      .replace(/\{\\Fgdt;j\}/gi, '⌖')
      .replace(/\{\\Fgdt;f\}/gi, '∥')
      .replace(/\{\\Fgdt;b\}/gi, '⊥')
      .replace(/\{\\Fgdt;e\}/gi, '○')
      .replace(/\{\\Fgdt;a\}/gi, '∠')
      .replace(/\{\\Fgdt;g\}/gi, '⌭')
      .replace(/\{\\Fgdt;d\}/gi, '⌓')
      .replace(/\{\\Fgdt;h\}/gi, '↗')
      .replace(/\{\\Fgdt;n\}/gi, '⌀')
      .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

    if (s.includes('\\M+') && typeof TextDecoder !== 'undefined') {
      s = s.replace(/\\M\+([1-5])([0-9A-Fa-f]{4})/g, (match, page, hex) => {
        try {
          const b1 = parseInt(hex.slice(0, 2), 16);
          const b2 = parseInt(hex.slice(2, 4), 16);
          const encMap = { '1': 'shift-jis', '3': 'euc-kr', '4': 'big5', '5': 'gb18030' };
          const dec = new TextDecoder(encMap[page] || 'gb18030');
          return dec.decode(new Uint8Array([b1, b2]));
        } catch (_) {
          return match;
        }
      });
    }
    return s;
  }

  // ============================================================================
  // 4. Mathematical Helpers: OCS->WCS, Bulge, Cox-de Boor NURBS, ACIS SAT, Hatch
  // ============================================================================
  function getOCS2WCSMatrix(extrusion) {
    const mat = new THREE.Matrix4();
    if (!extrusion) return mat;
    const nx = extrusion.x || 0, ny = extrusion.y || 0, nz = extrusion.z !== undefined ? extrusion.z : 1;
    if (Math.abs(nx) < 1e-7 && Math.abs(ny) < 1e-7 && Math.abs(nz - 1) < 1e-7) return mat;
    const N = new THREE.Vector3(nx, ny, nz);
    if (N.lengthSq() < 1e-12) return mat;
    N.normalize();
    const threshold = 1.0 / 64.0;
    const Ax = (Math.abs(N.x) < threshold && Math.abs(N.y) < threshold)
      ? new THREE.Vector3(0, 1, 0).cross(N).normalize()
      : new THREE.Vector3(0, 0, 1).cross(N).normalize();
    const Ay = new THREE.Vector3().crossVectors(N, Ax).normalize();
    mat.makeBasis(Ax, Ay, N);
    return mat;
  }

  function interpolateBulgePoints(p1, p2, bulge, segmentsPerCircle = 48) {
    if (!bulge || Math.abs(bulge) < 1e-6 || !isFinite(bulge)) {
      return [new THREE.Vector3(p1.x, p1.y, p1.z || 0), new THREE.Vector3(p2.x, p2.y, p2.z || 0)];
    }
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const chord = Math.hypot(dx, dy);
    if (chord < 1e-9) return [new THREE.Vector3(p1.x, p1.y, p1.z || 0)];
    const includedAngle = 4.0 * Math.atan(bulge);
    const sinHalf = Math.sin(Math.abs(includedAngle) / 2.0);
    if (sinHalf < 1e-9) return [new THREE.Vector3(p1.x, p1.y, p1.z || 0), new THREE.Vector3(p2.x, p2.y, p2.z || 0)];
    const radius = chord / (2.0 * sinHalf);
    const midX = (p1.x + p2.x) * 0.5;
    const midY = (p1.y + p2.y) * 0.5;
    const cotHalf = (1.0 - bulge * bulge) / (2.0 * bulge);
    const cx = midX - (dy * 0.5) * cotHalf;
    const cy = midY + (dx * 0.5) * cotHalf;
    const startAngle = Math.atan2(p1.y - cy, p1.x - cx);
    const numSegs = Math.max(4, Math.min(96, Math.ceil((Math.abs(includedAngle) / (Math.PI * 2)) * segmentsPerCircle)));
    const pts = [];
    const z1 = p1.z || 0;
    const z2 = p2.z !== undefined ? p2.z : z1;
    for (let i = 0; i <= numSegs; i++) {
      const t = i / numSegs;
      const ang = startAngle + includedAngle * t;
      pts.push(new THREE.Vector3(cx + radius * Math.cos(ang), cy + radius * Math.sin(ang), z1 + (z2 - z1) * t));
    }
    return pts;
  }

  function evaluateNurbsSpline(degree, controlPoints, knots, weights, baseSamples = 48) {
    if (!controlPoints || controlPoints.length < 2) return [];
    const validCP = controlPoints.filter(p => isFinite(p.x) && isFinite(p.y));
    const n = validCP.length - 1;
    if (n < 1) return [];
    const p = Math.max(1, Math.min(degree || 3, n));
    const expectedKnots = n + p + 2;

    let U = null;
    if (knots && knots.length === expectedKnots) {
      const span = knots[n + 1] - knots[p];
      if (isFinite(span) && span > 1e-9) U = knots;
    } else if (knots && knots.length === n + p && n >= p) {
      const span = knots[n] - knots[p - 1];
      if (isFinite(span) && span > 1e-9) {
        U = [knots[0], ...knots, knots[knots.length - 1]];
      }
    }
    if (!U) {
      U = [];
      const m = n + p + 1;
      for (let i = 0; i <= m; i++) {
        if (i <= p) U.push(0);
        else if (i >= m - p) U.push(1);
        else U.push((i - p) / (m - 2 * p));
      }
    }

    const uStart = U[p];
    const uEnd = U[n + 1];
    if (uEnd <= uStart) return validCP.map(pt => new THREE.Vector3(pt.x, pt.y, pt.z || 0));

    const numSamples = Math.max(baseSamples, Math.min(240, validCP.length * 6));

    function findSpan(u) {
      if (u >= U[n + 1]) return n;
      if (u <= U[p]) return p;
      let low = p, high = n + 1, mid = (low + high) >> 1;
      while (u < U[mid] || u >= U[mid + 1]) {
        if (u < U[mid]) high = mid;
        else low = mid;
        mid = (low + high) >> 1;
      }
      return mid;
    }

    const N = new Float64Array(p + 1);
    const left = new Float64Array(p + 1);
    const right = new Float64Array(p + 1);
    const pts = [];

    for (let s = 0; s <= numSamples; s++) {
      const u = s === numSamples ? uEnd : (s === 0 ? uStart : uStart + (uEnd - uStart) * (s / numSamples));
      const span = findSpan(u);
      N[0] = 1.0;
      for (let j = 1; j <= p; j++) {
        left[j] = u - U[span + 1 - j];
        right[j] = U[span + j] - u;
        let saved = 0.0;
        for (let r = 0; r < j; r++) {
          const denom = right[r + 1] + left[j - r];
          const temp = denom > 1e-12 ? N[r] / denom : 0.0;
          N[r] = saved + right[r + 1] * temp;
          saved = left[j - r] * temp;
        }
        N[j] = saved;
      }

      let wx = 0, wy = 0, wz = 0, wSum = 0;
      for (let j = 0; j <= p; j++) {
        const cpIdx = span - p + j;
        if (cpIdx >= 0 && cpIdx <= n) {
          const w = (weights && weights[cpIdx] !== undefined && weights[cpIdx] > 0) ? weights[cpIdx] : 1.0;
          const bw = N[j] * w;
          wx += validCP[cpIdx].x * bw;
          wy += validCP[cpIdx].y * bw;
          wz += (validCP[cpIdx].z || 0) * bw;
          wSum += bw;
        }
      }
      if (wSum > 1e-12) {
        pts.push(new THREE.Vector3(wx / wSum, wy / wSum, wz / wSum));
      }
    }
    return pts;
  }

  function decodeACISSatLines(rawLines) {
    if (!rawLines || rawLines.length === 0) return '';
    const joined = rawLines.join('\n');
    if (/\b(body|lump|shell|face|loop|coedge|edge|vertex|point)\b/.test(joined)) {
      return joined;
    }
    const decodedLines = rawLines.map(line => {
      let out = '';
      for (let i = 0; i < line.length; i++) {
        const c = line.charCodeAt(i);
        if (c >= 33 && c <= 126) {
          out += String.fromCharCode(159 - c);
        } else {
          out += line[i];
        }
      }
      return out;
    });
    return decodedLines.join('\n');
  }

  function emitReconstructedACIS(satLines, color, batch, worldMat) {
    const satText = decodeACISSatLines(satLines);
    if (!satText) return;

    const rawRecs = satText.split('#').map(s => s.trim()).filter(Boolean);
    const records = [];
    for (const r of rawRecs) {
      const cleaned = r.replace(/^-\d+\s+/, '').trim();
      records.push(cleaned);
    }

    const acisTransform = new THREE.Matrix4();
    const numRe = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;

    const points = new Map();
    const vertices = new Map();
    const curves = new Map();
    const edges = [];

    records.forEach((rec, idx) => {
      const typeMatch = rec.match(/^([a-zA-Z0-9_-]+)/);
      if (!typeMatch) return;
      const rType = typeMatch[1].toLowerCase();

      if (rType === 'transform') {
        const nums = (rec.replace(/\$-\d+|\$\d+/g, ' ').match(numRe) || []).map(Number);
        if (nums.length >= 12) {
          const s = nums[12] && nums[12] > 0 ? nums[12] : 1.0;
          acisTransform.set(
            nums[0] * s, nums[3] * s, nums[6] * s, nums[9],
            nums[1] * s, nums[4] * s, nums[7] * s, nums[10],
            nums[2] * s, nums[5] * s, nums[8] * s, nums[11],
            0, 0, 0, 1
          );
        }
      } else if (rType === 'point') {
        const withoutRefs = rec.replace(/\$-\d+|\$\d+/g, ' ');
        const nums = (withoutRefs.match(numRe) || []).map(Number);
        if (nums.length >= 3) {
          const n = nums.length;
          points.set(idx, new THREE.Vector3(nums[n - 3], nums[n - 2], nums[n - 1]));
        }
      } else if (rType === 'vertex') {
        const refs = (rec.match(/\$(-?\d+)/g) || []).map(s => parseInt(s.slice(1), 10));
        if (refs.length > 0) {
          vertices.set(idx, refs[refs.length - 1]);
        }
      } else if (rType === 'straight-curve') {
        const withoutRefs = rec.replace(/\$-\d+|\$\d+/g, ' ');
        const nums = (withoutRefs.match(numRe) || []).map(Number);
        if (nums.length >= 6) {
          curves.set(idx, {
            type: 'straight',
            root: new THREE.Vector3(nums[0], nums[1], nums[2]),
            dir: new THREE.Vector3(nums[3], nums[4], nums[5]).normalize()
          });
        }
      } else if (rType === 'ellipse-curve') {
        const withoutRefs = rec.replace(/\$-\d+|\$\d+/g, ' ');
        const nums = (withoutRefs.match(numRe) || []).map(Number);
        if (nums.length >= 10) {
          curves.set(idx, {
            type: 'ellipse',
            center: new THREE.Vector3(nums[0], nums[1], nums[2]),
            normal: new THREE.Vector3(nums[3], nums[4], nums[5]).normalize(),
            major: new THREE.Vector3(nums[6], nums[7], nums[8]),
            ratio: nums[9] || 1.0
          });
        }
      } else if (rType === 'edge') {
        const refs = (rec.match(/\$(-?\d+)/g) || []).map(s => parseInt(s.slice(1), 10));
        const sense = rec.includes('reversed') ? -1 : 1;
        if (refs.length >= 4) {
          let vStart = -1, vEnd = -1, curveIdx = -1;
          for (const rId of refs) {
            if (vertices.has(rId)) {
              if (vStart === -1) vStart = rId;
              else if (vEnd === -1) vEnd = rId;
            } else if (curves.has(rId)) {
              curveIdx = rId;
            }
          }
          if (vStart === -1 && refs.length >= 5) {
            vStart = refs[1];
            vEnd = refs[2];
            curveIdx = refs[4];
          }
          edges.push({ vStart, vEnd, curveIdx, sense, recIdx: idx });
        }
      }
    });

    const combMat = new THREE.Matrix4().multiplyMatrices(worldMat, acisTransform);

    let emittedAnyEdge = false;
    for (const e of edges) {
      const pStart = vertices.has(e.vStart) ? points.get(vertices.get(e.vStart)) : null;
      const pEnd = vertices.has(e.vEnd) ? points.get(vertices.get(e.vEnd)) : null;
      const crv = curves.get(e.curveIdx);

      if (crv && crv.type === 'ellipse') {
        const c = crv.center;
        const maj = crv.major;
        const min = new THREE.Vector3().crossVectors(crv.normal, maj).multiplyScalar(crv.ratio);
        let sa = 0, ea = Math.PI * 2;
        if (pStart && pEnd && pStart.distanceToSquared(pEnd) > 1e-6) {
          const d1 = pStart.clone().sub(c);
          const d2 = pEnd.clone().sub(c);
          const rMaj = maj.length() || 1;
          const rMin = min.length() || 1;
          sa = Math.atan2(d1.dot(min) / (rMin * rMin), d1.dot(maj) / (rMaj * rMaj));
          ea = Math.atan2(d2.dot(min) / (rMin * rMin), d2.dot(maj) / (rMaj * rMaj));
          if (e.sense < 0) { const tmp = sa; sa = ea; ea = tmp; }
          while (ea <= sa) ea += Math.PI * 2;
        }
        const steps = 32;
        let prev = null;
        for (let s = 0; s <= steps; s++) {
          const a = sa + (ea - sa) * (s / steps);
          const ca = Math.cos(a), sina = Math.sin(a);
          const pt = new THREE.Vector3(
            c.x + maj.x * ca + min.x * sina,
            c.y + maj.y * ca + min.y * sina,
            c.z + maj.z * ca + min.z * sina
          ).applyMatrix4(combMat);
          if (prev) batch.addSegment(prev.x, prev.y, prev.z, pt.x, pt.y, pt.z, color);
          prev = pt;
        }
        emittedAnyEdge = true;
      } else if (pStart && pEnd && pStart.distanceToSquared(pEnd) > 1e-8) {
        const w1 = pStart.clone().applyMatrix4(combMat);
        const w2 = pEnd.clone().applyMatrix4(combMat);
        batch.addSegment(w1.x, w1.y, w1.z, w2.x, w2.y, w2.z, color);
        emittedAnyEdge = true;
      }
    }

    if (!emittedAnyEdge) {
      for (const crv of curves.values()) {
        if (crv.type === 'ellipse') {
          const c = crv.center, maj = crv.major;
          const min = new THREE.Vector3().crossVectors(crv.normal, maj).multiplyScalar(crv.ratio);
          let prev = null;
          for (let s = 0; s <= 32; s++) {
            const a = (s / 32) * Math.PI * 2;
            const pt = new THREE.Vector3(
              c.x + maj.x * Math.cos(a) + min.x * Math.sin(a),
              c.y + maj.y * Math.cos(a) + min.y * Math.sin(a),
              c.z + maj.z * Math.cos(a) + min.z * Math.sin(a)
            ).applyMatrix4(combMat);
            if (prev) batch.addSegment(prev.x, prev.y, prev.z, pt.x, pt.y, pt.z, color);
            prev = pt;
          }
          emittedAnyEdge = true;
        }
      }
      if (!emittedAnyEdge && points.size >= 2) {
        const ptArr = Array.from(points.values()).map(p => p.clone().applyMatrix4(combMat));
        for (let i = 0; i < ptArr.length - 1; i++) {
          batch.addSegment(ptArr[i].x, ptArr[i].y, ptArr[i].z, ptArr[i + 1].x, ptArr[i + 1].y, ptArr[i + 1].z, color);
        }
      }
    }
  }

  function polygonSignedArea2D(ring) {
    let area = 0;
    for (let i = 0, n = ring.length; i < n; i++) {
      const p1 = ring[i], p2 = ring[(i + 1) % n];
      area += (p1.x * p2.y - p2.x * p1.y);
    }
    return area * 0.5;
  }

  function isPointInPolygon2D(pt, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i].x, yi = ring[i].y;
      const xj = ring[j].x, yj = ring[j].y;
      const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
        (pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-15) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function classifyHatchLoops(rings) {
    if (rings.length === 0) return [];
    if (rings.length === 1) return [{ outer: rings[0], holes: [] }];
    if (rings.length > 80) {
      return rings.map(r => ({ outer: r, holes: [] }));
    }

    const metas = rings.map((r, idx) => ({
      idx,
      ring: r,
      absArea: Math.abs(polygonSignedArea2D(r)),
      samplePt: r[0],
      parents: []
    }));

    for (let i = 0; i < metas.length; i++) {
      for (let j = 0; j < metas.length; j++) {
        if (i === j) continue;
        if (metas[j].absArea > metas[i].absArea && isPointInPolygon2D(metas[i].samplePt, metas[j].ring)) {
          metas[i].parents.push(j);
        }
      }
    }

    const groups = new Map();
    for (const m of metas) {
      if (m.parents.length % 2 === 0) {
        groups.set(m.idx, { outer: m.ring, holes: [] });
      }
    }
    for (const m of metas) {
      if (m.parents.length % 2 === 1) {
        let bestParentIdx = -1;
        let smallestArea = Infinity;
        for (const pIdx of m.parents) {
          if (groups.has(pIdx) && metas[pIdx].absArea < smallestArea) {
            smallestArea = metas[pIdx].absArea;
            bestParentIdx = pIdx;
          }
        }
        if (bestParentIdx !== -1) {
          groups.get(bestParentIdx).holes.push(m.ring);
        } else {
          groups.set(m.idx, { outer: m.ring, holes: [] });
        }
      }
    }
    return Array.from(groups.values());
  }

  function tessellatePolylineSegmentsToBatch(pts, pattern, batch, colorHex) {
    if (!pts || pts.length < 2) return;
    if (!pattern || pattern.length === 0) {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        batch.addSegment(a.x, a.y, a.z, b.x, b.y, b.z, colorHex);
      }
      return;
    }

    let totalPolyLen = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      totalPolyLen += pts[i].distanceTo(pts[i + 1]);
    }
    if (totalPolyLen < 1e-6) return;

    let patSum = 0;
    for (let i = 0; i < pattern.length; i++) patSum += Math.abs(pattern[i]) || 0.2;
    if (patSum < 1e-4) {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        batch.addSegment(a.x, a.y, a.z, b.x, b.y, b.z, colorHex);
      }
      return;
    }

    let adaptScale = 1.0;
    if (totalPolyLen / patSum > 60) {
      adaptScale = (totalPolyLen / 35) / patSum;
    } else if (totalPolyLen / patSum < 0.35) {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        batch.addSegment(a.x, a.y, a.z, b.x, b.y, b.z, colorHex);
      }
      return;
    }

    const effPattern = pattern.map(v => v * adaptScale);
    const effSum = patSum * adaptScale;

    let patIdx = 0;
    let patRem = Math.abs(effPattern[0]) || (effSum * 0.05);
    let isDraw = effPattern[0] >= 0;

    for (let i = 0; i < pts.length - 1; i++) {
      const pA = pts[i], pB = pts[i + 1];
      const dx = pB.x - pA.x, dy = pB.y - pA.y, dz = pB.z - pA.z;
      const segLen = Math.hypot(dx, dy, dz);
      if (segLen < 1e-9) continue;

      const ux = dx / segLen, uy = dy / segLen, uz = dz / segLen;
      let dist = 0;
      let curX = pA.x, curY = pA.y, curZ = pA.z;

      while (dist < segLen - 1e-7) {
        const step = Math.min(patRem, segLen - dist);
        const nx = curX + ux * step, ny = curY + uy * step, nz = curZ + uz * step;
        if (isDraw) batch.addSegment(curX, curY, curZ, nx, ny, nz, colorHex);
        curX = nx; curY = ny; curZ = nz;
        dist += step;
        patRem -= step;
        if (patRem <= 1e-7) {
          patIdx = (patIdx + 1) % effPattern.length;
          const rawP = effPattern[patIdx];
          isDraw = rawP >= 0;
          patRem = Math.abs(rawP) < 1e-4 ? (effSum * 0.04) : Math.abs(rawP);
        }
      }
    }
  }

  function parseMTextRichTokens(rawText, defaultWidthFactor = 1.0, defaultOblique = 0) {
    if (!rawText) return [[]];
    const text = decodeMIFAndSpecialChars(rawText).replace(/\t/g, '  ');
    const lines = [[]];
    const styleStack = [{
      scale: 1.0,
      widthFactor: defaultWidthFactor || 1.0,
      oblique: defaultOblique || 0,
      aciColor: null,
      trueColor: null,
      font: null,
      bold: false,
      italic: false,
      underline: false,
      overline: false,
      strike: false
    }];

    const currentStyle = () => Object.assign({}, styleStack[styleStack.length - 1]);
    let buf = '';
    const flushBuf = () => {
      if (buf.length > 0) {
        lines[lines.length - 1].push({ type: 'text', text: buf, style: currentStyle() });
        buf = '';
      }
    };

    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '{') { flushBuf(); styleStack.push(currentStyle()); i++; }
      else if (ch === '}') { flushBuf(); if (styleStack.length > 1) styleStack.pop(); i++; }
      else if (ch === '\\') {
        const next = text[i + 1];
        if (!next) { i++; continue; }
        if (next === 'P' || next === 'X' || next === 'N') { flushBuf(); lines.push([]); i += 2; }
        else if (next === '~') { buf += ' '; i += 2; }
        else if (next === '\\' || next === '{' || next === '}') { buf += next; i += 2; }
        else if (next === 'L') { flushBuf(); styleStack[styleStack.length - 1].underline = true; i += 2; }
        else if (next === 'l') { flushBuf(); styleStack[styleStack.length - 1].underline = false; i += 2; }
        else if (next === 'O') { flushBuf(); styleStack[styleStack.length - 1].overline = true; i += 2; }
        else if (next === 'o') { flushBuf(); styleStack[styleStack.length - 1].overline = false; i += 2; }
        else if (next === 'K') { flushBuf(); styleStack[styleStack.length - 1].strike = true; i += 2; }
        else if (next === 'k') { flushBuf(); styleStack[styleStack.length - 1].strike = false; i += 2; }
        else {
          const semi = text.indexOf(';', i + 2);
          if (semi !== -1 && semi - i < 80) {
            const cmd = next;
            const arg = text.slice(i + 2, semi);
            flushBuf();
            const top = styleStack[styleStack.length - 1];
            if (cmd === 'S') {
              let divider = '^', parts = [arg, ''];
              if (arg.includes('^')) { divider = '^'; parts = arg.split('^'); }
              else if (arg.includes('/')) { divider = '/'; parts = arg.split('/'); }
              else if (arg.includes('#')) { divider = '#'; parts = arg.split('#'); }
              lines[lines.length - 1].push({
                type: 'stack', upper: parts[0] || '', lower: parts.slice(1).join('') || '', divider, style: currentStyle()
              });
            } else if (cmd === 'H') {
              if (arg.endsWith('x') || arg.endsWith('X')) {
                const factor = parseFloat(arg);
                if (!isNaN(factor) && factor > 0) top.scale *= factor;
              } else {
                const absH = parseFloat(arg);
                if (!isNaN(absH) && absH > 0) top.absHeight = absH;
              }
            } else if (cmd === 'W') {
              const wf = parseFloat(arg);
              if (!isNaN(wf) && wf > 0) top.widthFactor = wf;
            } else if (cmd === 'Q') {
              const ob = parseFloat(arg);
              if (!isNaN(ob)) top.oblique = ob;
            } else if (cmd === 'C') {
              const aci = parseInt(arg, 10);
              if (!isNaN(aci)) top.aciColor = aci;
            } else if (cmd === 'c') {
              const tc = parseInt(arg, 10);
              if (!isNaN(tc)) top.trueColor = tc;
            } else if (cmd === 'F' || cmd === 'f') {
              const parts = arg.split('|');
              if (parts[0]) top.font = parts[0].replace(/\.shx$/i, '').replace(/\.ttf$/i, '');
              parts.slice(1).forEach(p => {
                if (p === 'b1') top.bold = true;
                if (p === 'b0') top.bold = false;
                if (p === 'i1') top.italic = true;
                if (p === 'i0') top.italic = false;
              });
            }
            i = semi + 1;
          } else { buf += ch; i++; }
        }
      } else if (ch === '\n') { flushBuf(); lines.push([]); i++; }
      else if (ch === '\r') { i++; }
      else { buf += ch; i++; }
    }
    flushBuf();
    return lines;
  }

  // ============================================================================
  // 5. High-DPI Multi-Page Filled Text Atlas (Calibrated Height, Width & Wrapping)
  // ============================================================================
  class MultiPageTextAtlas {
    constructor(fontFamily, onVertexAdded) {
      this.size = 2048;
      this.fontFamily = fontFamily || '"Microsoft YaHei", "PingFang SC", "SimHei", "Inter", sans-serif';
      this.onVertexAdded = onVertexAdded || null;
      this.hasDOM = typeof document !== 'undefined';
      this.pages = [];
      this.cache = new Map();
      if (this.hasDOM) {
        this.allocateNewPage();
      }
    }

    allocateNewPage() {
      const canvas = document.createElement('canvas');
      canvas.width = this.size;
      canvas.height = this.size;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, this.size, this.size);
      const page = {
        pageIndex: this.pages.length,
        canvas,
        ctx,
        cursorX: 6,
        cursorY: 6,
        rowHeight: 0,
        quadPositions: new Float32GrowableBuffer(4096),
        quadUVs: new Float32GrowableBuffer(2730)
      };
      this.pages.push(page);
      return page;
    }

    getTotalVertexCount() {
      let sum = 0;
      for (const p of this.pages) sum += p.quadPositions.length / 3;
      return sum;
    }

    /**
     * Renders solid filled 2D/3D text onto the Canvas Texture Atlas with 1:1 CAD height/width calibration.
     */
    addRichTextQuad(lines, baseHeight, defaultColorHex, halign, valign, worldMatrix, originShift, bgMaskColorHex = null, refWidthWorld = 0) {
      if (!this.hasDOM || !baseHeight || baseHeight <= 0) return false;

      // Nominal font size in pixels: pxBase = 48.
      // In HTML5 Canvas, a 48px font has visible cap/CJK height = 42px (0.875 * pxBase).
      // Applying a 0.86 horizontal condensation factor makes CJK width = 0.86 * H * widthFactor
      // and ASCII character width = 0.52 * H * widthFactor — matching AutoCAD SHX/TTF aspect ratios!
      const pxBase = 48;
      const glyphHeightPx = pxBase * 0.88;
      const condenseX = 0.86;
      const maxWrapPx = (refWidthWorld && refWidthWorld > baseHeight * 2.5)
        ? (refWidthWorld / baseHeight) * glyphHeightPx
        : 0;

      const cacheKey = JSON.stringify({ lines, defaultColorHex, halign, bgMaskColorHex, maxWrapPx: Math.round(maxWrapPx) });
      let entry = this.cache.get(cacheKey);

      if (!entry) {
        if (this.pages.length >= 24 && this.pages[this.pages.length - 1].cursorY > 1920) {
          return false;
        }
        let page = this.pages[this.pages.length - 1];
        const ctx = page.ctx;
        const baseFam = this.fontFamily;

        const buildFontStr = (runStyle, pxSize) => {
          const weight = runStyle.bold ? '700 ' : '500 ';
          const italic = runStyle.italic ? 'italic ' : '';
          const fam = runStyle.font ? `"${runStyle.font}", ${baseFam}` : baseFam;
          return `${italic}${weight}${Math.max(11, Math.min(96, Math.round(pxSize)))}px ${fam}`;
        };

        // Optional word-wrapping when MTEXT refWidth is set
        let wrappedLines = lines;
        if (maxWrapPx > 40) {
          wrappedLines = [];
          for (const srcLine of lines) {
            let curLine = [];
            let curW = 0;
            for (const run of srcLine) {
              const st = run.style || {};
              const scale = st.absHeight ? Math.min(4, Math.max(0.2, st.absHeight / baseHeight)) : (st.scale || 1.0);
              const wf = (st.widthFactor || 1.0) * condenseX;
              if (run.type === 'stack') {
                curLine.push(run);
                curW += pxBase * scale * wf * 1.5;
              } else {
                const pxSize = pxBase * scale;
                ctx.font = buildFontStr(st, pxSize);
                const fullW = ctx.measureText(run.text).width * wf;
                if (curW + fullW <= maxWrapPx || run.text.length <= 1) {
                  curLine.push(run);
                  curW += fullW;
                } else {
                  let chunk = '';
                  for (const ch of Array.from(run.text)) {
                    const chW = ctx.measureText(chunk + ch).width * wf;
                    if (curW + chW > maxWrapPx && (curLine.length > 0 || chunk.length > 0)) {
                      if (chunk.length > 0) curLine.push({ type: 'text', text: chunk, style: st });
                      wrappedLines.push(curLine);
                      curLine = [];
                      curW = 0;
                      chunk = ch;
                    } else {
                      chunk += ch;
                    }
                  }
                  if (chunk.length > 0) {
                    curLine.push({ type: 'text', text: chunk, style: st });
                    curW += ctx.measureText(chunk).width * wf;
                  }
                }
              }
            }
            wrappedLines.push(curLine);
          }
        }

        const lineSpacing = glyphHeightPx * 1.48;
        const pad = 6;
        let maxLineW = 8;

        const lineMetrics = wrappedLines.map(line => {
          let w = 0;
          const runs = line.map(run => {
            const st = run.style || {};
            const scale = st.absHeight ? Math.min(4, Math.max(0.2, st.absHeight / baseHeight)) : (st.scale || 1.0);
            const wf = (st.widthFactor || 1.0) * condenseX;
            const ob = st.oblique || 0;
            const shearExtra = Math.abs(Math.tan(THREE.MathUtils.degToRad(ob))) * glyphHeightPx * scale * 0.35;
            if (run.type === 'stack') {
              const subPx = pxBase * scale * 0.56;
              ctx.font = buildFontStr(st, subPx);
              const uw = ctx.measureText(run.upper).width * wf;
              const lw = ctx.measureText(run.lower).width * wf;
              const rw = Math.max(uw, lw) + 6 + shearExtra;
              w += rw;
              return { run, rw, pxSize: pxBase * scale, subPx, wf };
            } else {
              const pxSize = pxBase * scale;
              ctx.font = buildFontStr(st, pxSize);
              const rw = ctx.measureText(run.text).width * wf + shearExtra;
              w += rw;
              return { run, rw, pxSize, wf };
            }
          });
          if (w > maxLineW) maxLineW = w;
          return { width: w, runs };
        });

        const totalGlyphH = wrappedLines.length === 1
          ? glyphHeightPx
          : ((wrappedLines.length - 1) * lineSpacing + glyphHeightPx);
        const descenderPad = Math.ceil(pxBase * 0.22);
        const boxW = Math.min(this.size - 12, Math.ceil(maxLineW + pad * 2));
        const boxH = Math.min(this.size - 12, Math.ceil(totalGlyphH + descenderPad + pad * 2));

        if (page.cursorX + boxW + 6 > this.size) {
          page.cursorX = 6;
          page.cursorY += page.rowHeight + 6;
          page.rowHeight = 0;
        }
        if (page.cursorY + boxH + 6 > this.size) {
          page = this.allocateNewPage();
        }

        const drawCtx = page.ctx;
        const ox = page.cursorX, oy = page.cursorY;
        page.cursorX += boxW + 6;
        if (boxH > page.rowHeight) page.rowHeight = boxH;

        if (bgMaskColorHex !== null && bgMaskColorHex !== undefined) {
          drawCtx.fillStyle = '#' + new THREE.Color(bgMaskColorHex).getHexString();
          drawCtx.fillRect(ox, oy, boxW, boxH);
        }

        const hexToCss = (hex) => '#' + new THREE.Color(hex).getHexString();
        const defCss = hexToCss(defaultColorHex);
        drawCtx.textBaseline = 'alphabetic';
        drawCtx.lineJoin = 'round';

        lineMetrics.forEach((lm, lIdx) => {
          let curX = ox + pad;
          if (halign === 1 || halign === 4) curX = ox + pad + (maxLineW - lm.width) * 0.5;
          else if (halign === 2) curX = ox + pad + (maxLineW - lm.width);
          const baseY = oy + pad + glyphHeightPx + lIdx * lineSpacing;

          lm.runs.forEach(rm => {
            const { run, rw, pxSize, subPx, wf } = rm;
            const st = run.style || {};
            let fillCss = defCss;
            if (st.trueColor !== null && st.trueColor !== undefined) fillCss = hexToCss(st.trueColor & 0xFFFFFF);
            else if (st.aciColor !== null && st.aciColor !== undefined && ACI_PALETTE[st.aciColor]) fillCss = hexToCss(ACI_PALETTE[st.aciColor]);

            drawCtx.save();
            drawCtx.fillStyle = fillCss;
            drawCtx.strokeStyle = fillCss;
            const shear = Math.tan(THREE.MathUtils.degToRad(st.oblique || 0));

            if (run.type === 'stack') {
              drawCtx.font = buildFontStr(st, subPx);
              drawCtx.translate(curX + 2, baseY);
              drawCtx.transform(wf, 0, -shear, 1, 0, 0);
              drawCtx.fillText(run.upper, 0, -glyphHeightPx * 0.50);
              drawCtx.fillText(run.lower, 0, glyphHeightPx * 0.04);
              if (run.divider === '/' || run.divider === '#') {
                drawCtx.lineWidth = Math.max(1.5, pxSize * 0.045);
                drawCtx.beginPath();
                drawCtx.moveTo(0, -glyphHeightPx * 0.40);
                drawCtx.lineTo((rw - 4) / wf, -glyphHeightPx * 0.40);
                drawCtx.stroke();
              }
            } else {
              drawCtx.font = buildFontStr(st, pxSize);
              drawCtx.translate(curX, baseY);
              drawCtx.transform(wf, 0, -shear, 1, 0, 0);
              drawCtx.fillText(run.text, 0, 0);
              if (st.underline) {
                drawCtx.lineWidth = Math.max(1.8, pxSize * 0.055);
                drawCtx.beginPath(); drawCtx.moveTo(0, glyphHeightPx * 0.14); drawCtx.lineTo(rw / wf, glyphHeightPx * 0.14); drawCtx.stroke();
              }
              if (st.overline) {
                drawCtx.lineWidth = Math.max(1.8, pxSize * 0.055);
                drawCtx.beginPath(); drawCtx.moveTo(0, -glyphHeightPx * 1.02); drawCtx.lineTo(rw / wf, -glyphHeightPx * 1.02); drawCtx.stroke();
              }
              if (st.strike) {
                drawCtx.lineWidth = Math.max(1.8, pxSize * 0.05);
                drawCtx.beginPath(); drawCtx.moveTo(0, -glyphHeightPx * 0.42); drawCtx.lineTo(rw / wf, -glyphHeightPx * 0.42); drawCtx.stroke();
              }
            }
            drawCtx.restore();
            curX += rw;
          });
        });

        entry = {
          pageIndex: page.pageIndex,
          u0: ox / this.size,
          v0: 1.0 - (oy + boxH) / this.size,
          u1: (ox + boxW) / this.size,
          v1: 1.0 - oy / this.size,
          boxW, boxH, pad, totalGlyphH, glyphHeightPx
        };
        this.cache.set(cacheKey, entry);
      }

      const targetPage = this.pages[entry.pageIndex];
      // 1.0 * glyphHeightPx on Canvas maps to 1.0 * baseHeight in CAD world units
      const worldScale = baseHeight / entry.glyphHeightPx;
      const planeW = entry.boxW * worldScale;
      const planeH = entry.boxH * worldScale;
      const padW = entry.pad * worldScale;
      const glyphWorldH = entry.totalGlyphH * worldScale;

      let x0, x1;
      if (halign === 1 || halign === 4) { x0 = -planeW * 0.5; x1 = planeW * 0.5; }
      else if (halign === 2) { x0 = -planeW + padW; x1 = padW; }
      else { x0 = -padW; x1 = planeW - padW; }

      let y0, y1;
      if (valign === 3) {
        y1 = padW;
        y0 = y1 - planeH;
      } else if (valign === 2 || halign === 4) {
        y1 = glyphWorldH * 0.5 + padW;
        y0 = y1 - planeH;
      } else if (valign === 1) {
        y1 = glyphWorldH + padW;
        y0 = y1 - planeH;
      } else {
        y1 = (entry.pad + entry.glyphHeightPx) * worldScale;
        y0 = y1 - planeH;
      }

      // If worldMatrix has a negative 2D XY determinant (e.g. inside a mirrored INSERT block),
      // swap x0 and x1 around the quad's horizontal center so glyphs stay left-to-right readable!
      const me = worldMatrix.elements;
      const det2D = me[0] * me[5] - me[1] * me[4];
      if (det2D < -1e-9) {
        const tmp = x0;
        x0 = x1;
        x1 = tmp;
      }

      const sx = originShift ? originShift.x : 0;
      const sy = originShift ? originShift.y : 0;
      const sz = originShift ? originShift.z : 0;

      const p00 = new THREE.Vector3(x0, y0, 0.03).applyMatrix4(worldMatrix);
      const p10 = new THREE.Vector3(x1, y0, 0.03).applyMatrix4(worldMatrix);
      const p11 = new THREE.Vector3(x1, y1, 0.03).applyMatrix4(worldMatrix);
      const p01 = new THREE.Vector3(x0, y1, 0.03).applyMatrix4(worldMatrix);

      const ax = p00.x - sx, ay = p00.y - sy, az = p00.z - sz;
      const bx = p10.x - sx, by = p10.y - sy, bz = p10.z - sz;
      const cx = p11.x - sx, cy = p11.y - sy, cz = p11.z - sz;
      const dx = p01.x - sx, dy = p01.y - sy, dz = p01.z - sz;

      targetPage.quadPositions.push9(ax, ay, az, bx, by, bz, cx, cy, cz);
      targetPage.quadPositions.push9(ax, ay, az, cx, cy, cz, dx, dy, dz);

      if (this.onVertexAdded) {
        this.onVertexAdded(ax, ay, az);
        this.onVertexAdded(bx, by, bz);
        this.onVertexAdded(cx, cy, cz);
        this.onVertexAdded(dx, dy, dz);
      }

      const { u0, v0, u1, v1 } = entry;
      targetPage.quadUVs.push6(u0, v0, u1, v0, u1, v1);
      targetPage.quadUVs.push6(u0, v0, u1, v1, u0, v1);
      return true;
    }

    buildAtlasMeshes() {
      if (!this.hasDOM) return [];
      const meshes = [];
      for (const page of this.pages) {
        if (page.quadPositions.length === 0) continue;
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(page.quadPositions.toTypedArray(), 3));
        geom.setAttribute('uv', new THREE.BufferAttribute(page.quadUVs.toTypedArray(), 2));
        const texture = new THREE.CanvasTexture(page.canvas);
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.anisotropy = 4;
        texture.needsUpdate = true;
        const mat = new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          alphaTest: 0.04,
          side: THREE.DoubleSide,
          depthWrite: false
        });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.renderOrder = 4;
        mesh.name = `Batched_Text_Atlas_Page_${page.pageIndex}`;
        meshes.push(mesh);
      }
      return meshes;
    }
  }

  // ============================================================================
  // 6. Phase-Locked Fault-Tolerant DXF Parser
  // ============================================================================
  class DXFParser {
    constructor() {
      this.warnings = [];
    }

    parse(dxfString) {
      this.warnings = [];
      const codes = [];
      const values = [];
      const len = dxfString.length;
      let pos = 0;

      const nextRawLine = () => {
        if (pos >= len) return null;
        let nl = dxfString.indexOf('\n', pos);
        if (nl === -1) nl = len;
        let end = nl;
        if (end > pos && dxfString.charCodeAt(end - 1) === 13) end--;
        const line = dxfString.slice(pos, end);
        pos = nl + 1;
        return line;
      };

      while (pos < len) {
        const rawCodeLine = nextRawLine();
        if (rawCodeLine === null) break;
        const trimmedCode = rawCodeLine.trim();
        if (trimmedCode === '') continue;

        if (!/^\d+$/.test(trimmedCode)) {
          if (values.length > 0 && typeof values[values.length - 1] === 'string') {
            values[values.length - 1] += '\n' + trimmedCode;
          }
          continue;
        }

        const code = parseInt(trimmedCode, 10);
        const rawValLine = nextRawLine();
        if (rawValLine === null) break;
        if (code === 999) continue;
        codes.push(code);
        values.push(this.castValue(code, rawValLine.trim()));
      }

      const data = {
        header: {},
        classes: [],
        tables: {
          vports: {},
          ltypes: {},
          layers: {},
          styles: {},
          views: {},
          ucs: {},
          appids: {},
          dimstyles: {},
          blockRecords: {}
        },
        blocks: {},
        entities: [],
        objects: {
          mlinestyles: {},
          imagedefs: {}
        },
        warnings: this.warnings
      };

      const totalPairs = codes.length;
      let idx = 0;
      while (idx < totalPairs) {
        if (codes[idx] === 0 && String(values[idx]).toUpperCase() === 'SECTION') {
          idx++;
          let secName = '';
          while (idx < totalPairs && codes[idx] !== 0) {
            if (codes[idx] === 2) { secName = String(values[idx]).toUpperCase(); idx++; break; }
            idx++;
          }
          try {
            if (secName === 'HEADER') idx = this.parseHeader(codes, values, idx, data.header);
            else if (secName === 'CLASSES') idx = this.parseClasses(codes, values, idx, data.classes);
            else if (secName === 'TABLES') idx = this.parseTables(codes, values, idx, data.tables);
            else if (secName === 'BLOCKS') idx = this.parseBlocks(codes, values, idx, data.blocks);
            else if (secName === 'ENTITIES') idx = this.parseEntitiesSection(codes, values, idx, data.entities, 'ENDSEC');
            else if (secName === 'OBJECTS') idx = this.parseObjects(codes, values, idx, data.objects);
            else {
              while (idx < totalPairs && !(codes[idx] === 0 && String(values[idx]).toUpperCase() === 'ENDSEC')) idx++;
              if (idx < totalPairs) idx++;
            }
          } catch (secErr) {
            this.warnings.push(`Section ${secName} error: ${secErr.message}`);
            while (idx < totalPairs && !(codes[idx] === 0 && String(values[idx]).toUpperCase() === 'ENDSEC')) idx++;
            if (idx < totalPairs) idx++;
          }
        } else {
          idx++;
        }
      }

      // Fallback if ENTITIES is empty: prefer *MODEL_SPACE first, then *PAPER_SPACE
      if (data.entities.length === 0) {
        for (const bKey of Object.keys(data.blocks)) {
          if (bKey.startsWith('*MODEL_SPACE')) {
            const blk = data.blocks[bKey];
            if (blk && blk.entities && blk.entities.length > 0) {
              for (let i = 0; i < blk.entities.length; i++) data.entities.push(blk.entities[i]);
            }
          }
        }
        if (data.entities.length === 0) {
          for (const bKey of Object.keys(data.blocks)) {
            if (bKey.startsWith('*PAPER_SPACE')) {
              const blk = data.blocks[bKey];
              if (blk && blk.entities && blk.entities.length > 0) {
                for (let i = 0; i < blk.entities.length; i++) data.entities.push(blk.entities[i]);
              }
            }
          }
        }
      }

      if (!data.tables.layers['0']) {
        data.tables.layers['0'] = { name: '0', displayName: '0', colorIndex: 7, linetype: 'CONTINUOUS', flags: 0, visible: true };
      }
      if (!data.tables.ltypes['CONTINUOUS']) data.tables.ltypes['CONTINUOUS'] = { name: 'CONTINUOUS', pattern: [] };
      if (!data.tables.ltypes['CENTER']) data.tables.ltypes['CENTER'] = { name: 'CENTER', pattern: [6.0, -1.5, 1.0, -1.5] };
      if (!data.tables.ltypes['HIDDEN']) data.tables.ltypes['HIDDEN'] = { name: 'HIDDEN', pattern: [3.0, -1.5] };
      if (!data.tables.ltypes['DASHED']) data.tables.ltypes['DASHED'] = { name: 'DASHED', pattern: [4.0, -2.0] };
      if (!data.tables.ltypes['PHANTOM']) data.tables.ltypes['PHANTOM'] = { name: 'PHANTOM', pattern: [6.0, -1.2, 1.0, -1.2, 1.0, -1.2] };
      if (!data.tables.ltypes['DASHDOT']) data.tables.ltypes['DASHDOT'] = { name: 'DASHDOT', pattern: [4.0, -1.2, 0.2, -1.2] };
      if (!data.tables.styles['STANDARD']) {
        data.tables.styles['STANDARD'] = { name: 'STANDARD', font: 'simplex.shx', height: 0, widthFactor: 1.0, obliqueAngle: 0 };
      }
      if (!data.objects.mlinestyles['STANDARD']) {
        data.objects.mlinestyles['STANDARD'] = {
          name: 'STANDARD', flags: 0,
          elements: [
            { offset: 0.5, colorIndex: 256, linetype: 'BYLAYER' },
            { offset: -0.5, colorIndex: 256, linetype: 'BYLAYER' }
          ]
        };
      }

      return data;
    }

    castValue(code, val) {
      if (code >= 0 && code <= 9) return val;
      if (code >= 10 && code <= 59) { const f = parseFloat(val); return isFinite(f) ? f : 0; }
      if (code >= 60 && code <= 99) { const i = parseInt(val, 10); return isFinite(i) ? i : 0; }
      if (code >= 110 && code <= 149) { const f = parseFloat(val); return isFinite(f) ? f : 0; }
      if (code >= 160 && code <= 179) { const i = parseInt(val, 10); return isFinite(i) ? i : 0; }
      if (code >= 210 && code <= 239) { const f = parseFloat(val); return isFinite(f) ? f : 0; }
      if (code >= 270 && code <= 289) { const i = parseInt(val, 10); return isFinite(i) ? i : 0; }
      if (code >= 290 && code <= 299) return parseInt(val, 10) !== 0;
      if (code >= 370 && code <= 389) { const i = parseInt(val, 10); return isFinite(i) ? i : 0; }
      if (code >= 420 && code <= 429) { const i = parseInt(val, 10); return isFinite(i) ? i : 0; }
      if (code >= 450 && code <= 459) { const i = parseInt(val, 10); return isFinite(i) ? i : 0; }
      if (code === 1040 || code === 1041 || code === 1042) { const f = parseFloat(val); return isFinite(f) ? f : 0; }
      if (code === 1070 || code === 1071) { const i = parseInt(val, 10); return isFinite(i) ? i : 0; }
      return val;
    }

    parseHeader(codes, values, idx, header) {
      let curVar = null;
      const n = codes.length;
      while (idx < n) {
        const c = codes[idx], v = values[idx];
        if (c === 0 && String(v).toUpperCase() === 'ENDSEC') return idx + 1;
        if (c === 9) curVar = String(v).trim();
        else if (curVar) {
          if (c === 10 || c === 20 || c === 30) {
            if (typeof header[curVar] !== 'object' || header[curVar] === null) header[curVar] = { x: 0, y: 0, z: 0 };
            if (c === 10) header[curVar].x = v;
            if (c === 20) header[curVar].y = v;
            if (c === 30) header[curVar].z = v;
          } else {
            header[curVar] = v;
          }
        }
        idx++;
      }
      return idx;
    }

    parseClasses(codes, values, idx, classes) {
      const n = codes.length;
      let cur = null;
      while (idx < n) {
        if (codes[idx] === 0 && String(values[idx]).toUpperCase() === 'ENDSEC') return idx + 1;
        if (codes[idx] === 0 && String(values[idx]).toUpperCase() === 'CLASS') {
          cur = { dxfName: '', cppName: '', appName: '', flags: 0 };
          classes.push(cur);
        } else if (cur) {
          if (codes[idx] === 1) cur.dxfName = values[idx];
          else if (codes[idx] === 2) cur.cppName = values[idx];
          else if (codes[idx] === 3) cur.appName = values[idx];
          else if (codes[idx] === 90) cur.flags = values[idx];
        }
        idx++;
      }
      return idx;
    }

    parseTables(codes, values, idx, tables) {
      const n = codes.length;
      while (idx < n) {
        if (codes[idx] === 0 && String(values[idx]).toUpperCase() === 'ENDSEC') return idx + 1;
        if (codes[idx] === 0 && String(values[idx]).toUpperCase() === 'TABLE') {
          idx++;
          while (idx < n && !(codes[idx] === 0 && String(values[idx]).toUpperCase() === 'ENDTAB')) {
            if (codes[idx] !== 0) { idx++; continue; }
            const recType = String(values[idx]).toUpperCase();
            idx++;
            const recStart = idx;
            while (idx < n && codes[idx] !== 0) idx++;
            const recEnd = idx;

            if (recType === 'LAYER') {
              const layer = { name: '0', displayName: '0', colorIndex: 7, trueColor: null, linetype: 'CONTINUOUS', flags: 0, lineweight: -3, visible: true };
              for (let k = recStart; k < recEnd; k++) {
                const lc = codes[k], lv = values[k];
                if (lc >= 1000) continue;
                if (lc === 2 && lv) { layer.displayName = String(lv); layer.name = normKey(lv); }
                else if (lc === 62) { layer.colorIndex = Math.abs(lv); if (lv < 0) layer.visible = false; }
                else if (lc === 420) layer.trueColor = lv;
                else if (lc === 6 && lv) layer.linetype = normKey(lv, 'CONTINUOUS');
                else if (lc === 70) { layer.flags = lv; if (lv & 1) layer.visible = false; }
                else if (lc === 370) layer.lineweight = lv;
              }
              tables.layers[layer.name] = layer;
            } else if (recType === 'LTYPE') {
              const ltype = { name: 'CONTINUOUS', description: '', pattern: [], totalLength: 0 };
              for (let k = recStart; k < recEnd; k++) {
                const lc = codes[k], lv = values[k];
                if (lc >= 1000) continue;
                if (lc === 2 && lv) ltype.name = normKey(lv, 'CONTINUOUS');
                else if (lc === 3) ltype.description = lv;
                else if (lc === 40) ltype.totalLength = lv;
                else if (lc === 49) ltype.pattern.push(lv);
              }
              tables.ltypes[ltype.name] = ltype;
            } else if (recType === 'STYLE') {
              const style = { name: 'STANDARD', font: 'simplex.shx', bigFont: '', height: 0, widthFactor: 1.0, obliqueAngle: 0, flags: 0, genFlags: 0 };
              for (let k = recStart; k < recEnd; k++) {
                const sc = codes[k], sv = values[k];
                if (sc >= 1000) continue;
                if (sc === 2 && sv) style.name = normKey(sv, 'STANDARD');
                else if (sc === 3) style.font = sv;
                else if (sc === 4) style.bigFont = sv;
                else if (sc === 40 && sv > 0) style.height = sv;
                else if (sc === 41 && sv > 0) style.widthFactor = sv;
                else if (sc === 50) style.obliqueAngle = sv || 0;
                else if (sc === 70) style.flags = sv;
                else if (sc === 71) style.genFlags = sv;
              }
              tables.styles[style.name] = style;
            } else if (recType === 'DIMSTYLE') {
              // Initialize numeric fields to undefined so HEADER $DIMSCALE/$DIMTXT/$DIMASZ fallbacks work!
              const ds = {
                name: 'STANDARD', dimscale: undefined, dimasz: undefined, dimexo: undefined, dimexe: undefined,
                dimtxt: undefined, dimgap: undefined, dimtad: 1, dimclrd: 0, dimclre: 0, dimclrt: 0,
                dimdec: undefined, dimlfac: undefined, dimpost: '', dimblk: '', arrowBlockHandle: ''
              };
              for (let k = recStart; k < recEnd; k++) {
                const dc = codes[k], dv = values[k];
                if (dc >= 1000) continue;
                if (dc === 2 && dv) ds.name = normKey(dv, 'STANDARD');
                else if (dc === 3) ds.dimpost = dv;
                else if (dc === 5 || dc === 6 || dc === 7) { if (dv) ds.dimblk = String(dv); }
                else if (dc === 40 && dv > 0) ds.dimscale = dv;
                else if (dc === 41 && dv > 0) ds.dimasz = dv;
                else if (dc === 42) ds.dimexo = dv;
                else if (dc === 44) ds.dimexe = dv;
                else if (dc === 77) ds.dimtad = dv;
                else if (dc === 140 && dv > 0) ds.dimtxt = dv;
                else if (dc === 144 && dv !== 0) ds.dimlfac = dv;
                else if (dc === 147) ds.dimgap = dv;
                else if (dc === 176) ds.dimclrd = dv;
                else if (dc === 177) ds.dimclre = dv;
                else if (dc === 178) ds.dimclrt = dv;
                else if (dc === 271) ds.dimdec = dv;
                else if (dc === 342 || dc === 343 || dc === 344) ds.arrowBlockHandle = normKey(dv, '');
              }
              tables.dimstyles[ds.name] = ds;
            } else if (recType === 'BLOCK_RECORD') {
              let handle = '', name = '';
              for (let k = recStart; k < recEnd; k++) {
                if (codes[k] === 5 && !handle) handle = normKey(values[k], '');
                else if (codes[k] === 2 && !name) name = normKey(values[k], '');
              }
              if (handle && name) tables.blockRecords[handle] = name;
            }
          }
          if (idx < n && codes[idx] === 0 && String(values[idx]).toUpperCase() === 'ENDTAB') idx++;
        } else {
          idx++;
        }
      }
      return idx;
    }

    parseBlocks(codes, values, idx, blocks) {
      const n = codes.length;
      while (idx < n) {
        if (codes[idx] === 0 && String(values[idx]).toUpperCase() === 'ENDSEC') return idx + 1;
        if (codes[idx] === 0 && String(values[idx]).toUpperCase() === 'BLOCK') {
          const block = { name: '', displayName: '', basePoint: { x: 0, y: 0, z: 0 }, flags: 0, layer: '0', entities: [] };
          idx++;
          while (idx < n && codes[idx] !== 0) {
            const bc = codes[idx], bv = values[idx];
            if (bc >= 1000) { idx++; continue; }
            if (bc === 2 && String(bv).trim() !== '') {
              block.displayName = String(bv).trim();
              block.name = normKey(bv, '');
            } else if (bc === 3 && !block.name && String(bv).trim() !== '') {
              block.displayName = String(bv).trim();
              block.name = normKey(bv, '');
            } else if (bc === 8 && bv) block.layer = normKey(bv, '0');
            else if (bc === 70) block.flags = bv;
            else if (bc === 10) block.basePoint.x = bv;
            else if (bc === 20) block.basePoint.y = bv;
            else if (bc === 30) block.basePoint.z = bv;
            idx++;
          }
          idx = this.parseEntitiesSection(codes, values, idx, block.entities, 'ENDBLK');
          if (block.name) {
            blocks[block.name] = block;
          }
        } else {
          idx++;
        }
      }
      return idx;
    }

    parseObjects(codes, values, idx, objects) {
      const n = codes.length;
      while (idx < n) {
        if (codes[idx] === 0 && String(values[idx]).toUpperCase() === 'ENDSEC') return idx + 1;
        if (codes[idx] === 0 && String(values[idx]).toUpperCase() === 'MLINESTYLE') {
          const ms = { name: 'STANDARD', flags: 0, elements: [] };
          let curElem = null;
          idx++;
          while (idx < n && codes[idx] !== 0) {
            const c = codes[idx], v = values[idx];
            if (c === 2 && v) ms.name = normKey(v, 'STANDARD');
            else if (c === 70) ms.flags = v;
            else if (c === 49) {
              curElem = { offset: v, colorIndex: 256, linetype: 'BYLAYER' };
              ms.elements.push(curElem);
            } else if (curElem && c === 62) curElem.colorIndex = v;
            else if (curElem && c === 6) curElem.linetype = normKey(v, 'BYLAYER');
            idx++;
          }
          objects.mlinestyles[ms.name] = ms;
        } else {
          idx++;
        }
      }
      return idx;
    }

    parseEntitiesSection(codes, values, idx, outEntities, stopToken) {
      const n = codes.length;
      while (idx < n) {
        if (codes[idx] !== 0) { idx++; continue; }
        const tok = String(values[idx]).trim().toUpperCase();
        if (tok === stopToken || tok === 'ENDSEC' || tok === 'EOF') {
          if (tok === stopToken) {
            idx++;
            while (idx < n && codes[idx] !== 0) idx++;
          }
          return idx;
        }

        idx++;
        const recStart = idx;
        while (idx < n && codes[idx] !== 0) idx++;
        const recEnd = idx;

        try {
          if (tok === 'POLYLINE') {
            const polyEnt = this.parsePolylineHeader(codes, values, recStart, recEnd);
            while (idx < n && codes[idx] === 0) {
              const subTok = String(values[idx]).trim().toUpperCase();
              if (subTok === 'VERTEX') {
                idx++;
                const vStart = idx;
                while (idx < n && codes[idx] !== 0) idx++;
                polyEnt.vertices.push(this.parseVertexRecord(codes, values, vStart, idx, polyEnt));
              } else if (subTok === 'SEQEND') {
                idx++;
                while (idx < n && codes[idx] !== 0) idx++;
                break;
              } else {
                break;
              }
            }
            outEntities.push(polyEnt);
          } else if (tok === 'INSERT') {
            const insEnt = this.parseInsertRecord(codes, values, recStart, recEnd);
            if (insEnt.followAttribs || (idx < n && codes[idx] === 0 && String(values[idx]).trim().toUpperCase() === 'ATTRIB')) {
              while (idx < n && codes[idx] === 0) {
                const subTok = String(values[idx]).trim().toUpperCase();
                if (subTok === 'ATTRIB') {
                  idx++;
                  const aStart = idx;
                  while (idx < n && codes[idx] !== 0) idx++;
                  const attrEnt = this.parseTextOrAttribRecord('ATTRIB', codes, values, aStart, idx);
                  if (attrEnt) insEnt.attribs.push(attrEnt);
                } else if (subTok === 'SEQEND') {
                  idx++;
                  while (idx < n && codes[idx] !== 0) idx++;
                  break;
                } else {
                  break;
                }
              }
            }
            outEntities.push(insEnt);
          } else if (tok === 'SEQEND') {
            continue;
          } else {
            const ent = this.parseIsolatedEntitySlice(tok, codes, values, recStart, recEnd);
            if (ent) outEntities.push(ent);
          }
        } catch (entErr) {
          this.warnings.push(`Skipped malformed ${tok} at pair ${recStart}: ${entErr.message}`);
        }
      }
      return idx;
    }

    createBaseEntity(type) {
      return {
        type,
        layer: '0',
        displayLayer: '0',
        handle: '',
        linetype: 'BYLAYER',
        colorIndex: 256,
        trueColor: null,
        ltscale: 1.0,
        thickness: 0,
        visible: true,
        inPaperSpace: false,
        extrusion: { x: 0, y: 0, z: 1 }
      };
    }

    applyCommonCode(ent, code, val) {
      switch (code) {
        case 5: if (!ent.handle) ent.handle = String(val); return true;
        case 6: ent.linetype = normKey(val, 'BYLAYER'); return true;
        case 8:
          ent.displayLayer = String(val || '0').trim();
          ent.layer = normKey(val, '0');
          return true;
        case 39: ent.thickness = val; return true;
        case 48: if (val > 0) ent.ltscale = val; return true;
        case 60: ent.visible = val === 0; return true;
        case 62: ent.colorIndex = val; return true;
        case 67: ent.inPaperSpace = val === 1; return true;
        case 210: ent.extrusion.x = val; return true;
        case 220: ent.extrusion.y = val; return true;
        case 230: ent.extrusion.z = val; return true;
        case 420: ent.trueColor = val; return true;
        default: return false;
      }
    }

    parseIsolatedEntitySlice(type, codes, values, start, end) {
      switch (type) {
        case 'LWPOLYLINE': return this.parseLWPolylineRecord(codes, values, start, end);
        case 'SPLINE': return this.parseSplineRecord(codes, values, start, end);
        case 'HELIX': return this.parseHelixRecord(codes, values, start, end);
        case 'HATCH':
        case 'MPOLYGON': return this.parseHatchRecord(type, codes, values, start, end);
        case 'DIMENSION':
        case 'ARC_DIMENSION':
        case 'LARGE_RADIAL_DIMENSION': return this.parseDimensionRecord(type, codes, values, start, end);
        case 'TEXT':
        case 'ATTRIB':
        case 'ATTDEF':
        case 'SHAPE':
        case 'ARCTEXT': return this.parseTextOrAttribRecord(type, codes, values, start, end);
        case 'MTEXT': return this.parseMTextRecord(codes, values, start, end);
        case 'LEADER': return this.parseLeaderRecord(codes, values, start, end);
        case 'MLEADER':
        case 'MULTILEADER': return this.parseMLeaderRecord(codes, values, start, end);
        case 'MLINE': return this.parseMLineRecord(codes, values, start, end);
        case 'ACAD_TABLE': return this.parseAcadTableRecord(codes, values, start, end);
        case 'MESH': return this.parseSubDMeshRecord(codes, values, start, end);
        default: return this.parseSimpleGeometricRecord(type, codes, values, start, end);
      }
    }

    parseLWPolylineRecord(codes, values, start, end) {
      const ent = this.createBaseEntity('LWPOLYLINE');
      ent.vertices = [];
      ent.flags = 0;
      ent.constantWidth = 0;
      ent.elevation = 0;
      let curV = null;
      for (let i = start; i < end; i++) {
        const c = codes[i], v = values[i];
        if (c >= 1000) continue;
        if (c === 101 || (c === 100 && String(v).toUpperCase().includes('XRECORD'))) break;
        if (this.applyCommonCode(ent, c, v)) continue;
        if (c === 70) ent.flags = v;
        else if (c === 43) ent.constantWidth = v;
        else if (c === 38) ent.elevation = v;
        else if (c === 10) {
          curV = { x: v, y: 0, z: 0, startWidth: null, endWidth: null, bulge: 0 };
          ent.vertices.push(curV);
        } else if (c === 20 && curV) curV.y = v;
        else if (c === 30 && curV) curV.z = v;
        else if (c === 40 && curV) curV.startWidth = v;
        else if (c === 41 && curV) curV.endWidth = v;
        else if (c === 42 && curV) curV.bulge = v;
      }
      if (ent.elevation !== 0) {
        for (const v of ent.vertices) {
          if (v.z === 0) v.z = ent.elevation;
        }
      }
      return ent;
    }

    parsePolylineHeader(codes, values, start, end) {
      const ent = this.createBaseEntity('POLYLINE');
      ent.vertices = [];
      ent.flags = 0;
      ent.meshM = 0;
      ent.meshN = 0;
      ent.smoothM = 0;
      ent.smoothN = 0;
      ent.elevation = 0;
      ent.defaultStartWidth = 0;
      ent.defaultEndWidth = 0;
      for (let i = start; i < end; i++) {
        const c = codes[i], v = values[i];
        if (c >= 1000) continue;
        if (this.applyCommonCode(ent, c, v)) continue;
        if (c === 70) ent.flags = v;
        else if (c === 71) ent.meshM = v;
        else if (c === 72) ent.meshN = v;
        else if (c === 73) ent.smoothM = v;
        else if (c === 74) ent.smoothN = v;
        else if (c === 30) ent.elevation = v;
        else if (c === 40) ent.defaultStartWidth = v;
        else if (c === 41) ent.defaultEndWidth = v;
      }
      return ent;
    }

    parseVertexRecord(codes, values, start, end, polyEnt) {
      const is2DPoly = ((polyEnt.flags || 0) & (8 | 16 | 64)) === 0;
      const vtx = {
        x: 0, y: 0, z: polyEnt.elevation || 0,
        startWidth: null,
        endWidth: null,
        bulge: 0, flags: 0,
        colorIndex: undefined,
        trueColor: null,
        faceIndices: []
      };
      for (let i = start; i < end; i++) {
        const c = codes[i], v = values[i];
        if (c >= 1000) continue;
        if (c === 10) vtx.x = v;
        else if (c === 20) vtx.y = v;
        else if (c === 30) {
          if (!is2DPoly || v !== 0 || !polyEnt.elevation) vtx.z = v;
        }
        else if (c === 40) vtx.startWidth = v;
        else if (c === 41) vtx.endWidth = v;
        else if (c === 42) vtx.bulge = v;
        else if (c === 62) vtx.colorIndex = v;
        else if (c === 420) vtx.trueColor = v;
        else if (c === 70) vtx.flags = v;
        else if (c === 71 || c === 72 || c === 73 || c === 74) vtx.faceIndices.push(v);
      }
      return vtx;
    }

    parseInsertRecord(codes, values, start, end) {
      const ent = this.createBaseEntity('INSERT');
      ent.name = '';
      ent.x = 0; ent.y = 0; ent.z = 0;
      ent.xscale = 1.0; ent.yscale = 1.0; ent.zscale = 1.0;
      ent.rotation = 0;
      ent.colCount = 1; ent.rowCount = 1;
      ent.colSpacing = 0; ent.rowSpacing = 0;
      ent.followAttribs = 0;
      ent.attribs = [];

      for (let i = start; i < end; i++) {
        const c = codes[i], v = values[i];
        if (c >= 1000) continue;
        if (c === 101 || (c === 100 && String(v).toUpperCase().includes('XRECORD'))) break;
        if (this.applyCommonCode(ent, c, v)) continue;
        switch (c) {
          case 2: if (v) ent.name = normKey(v, ''); break;
          case 10: ent.x = v; break;
          case 20: ent.y = v; break;
          case 30: ent.z = v; break;
          case 41: if (v !== 0) ent.xscale = v; break;
          case 42: if (v !== 0) ent.yscale = v; break;
          case 43: if (v !== 0) ent.zscale = v; break;
          case 44: ent.colSpacing = v; break;
          case 45: ent.rowSpacing = v; break;
          case 50: ent.rotation = v; break;
          case 66: ent.followAttribs = v; break;
          case 70: if (v > 0 && v < 500) ent.colCount = v; break;
          case 71: if (v > 0 && v < 500) ent.rowCount = v; break;
        }
      }
      return ent;
    }

    parseDimensionRecord(type, codes, values, start, end) {
      const ent = this.createBaseEntity(type);
      ent.name = '';
      ent.styleName = 'STANDARD';
      ent.text = '';
      ent.flags = 0;
      ent.attachmentPoint = 5;
      ent.actualMeasurement = undefined;
      ent.rotation = 0;
      ent.horizontalDir = 0;
      ent.textRotation = 0;
      ent.x = 0; ent.y = 0; ent.z = 0;
      ent.x1 = undefined; ent.y1 = undefined; ent.z1 = 0;
      ent.x2 = 0; ent.y2 = 0; ent.z2 = 0;
      ent.x3 = undefined; ent.y3 = undefined; ent.z3 = 0;
      ent.x4 = undefined; ent.y4 = undefined; ent.z4 = 0;
      ent.x5 = undefined; ent.y5 = undefined; ent.z5 = 0;
      ent.x6 = undefined; ent.y6 = undefined; ent.z6 = 0;
      ent.dimOverrides = {};

      let inXData = false;
      let inDStyle = false;
      let pendingDimVar = null;

      for (let i = start; i < end; i++) {
        const c = codes[i], v = values[i];
        if (c === 1001) {
          inXData = true;
          inDStyle = (normKey(v, '') === 'ACAD');
          continue;
        }
        if (inXData) {
          if (inDStyle) {
            if (c === 1070) {
              if (pendingDimVar === null) pendingDimVar = v;
              else { ent.dimOverrides[pendingDimVar] = v; pendingDimVar = null; }
            } else if ((c === 1040 || c === 1000 || c === 1005) && pendingDimVar !== null) {
              ent.dimOverrides[pendingDimVar] = v;
              pendingDimVar = null;
            }
          }
          continue;
        }
        if (c === 101 || (c === 100 && String(v).toUpperCase().includes('XRECORD'))) break;
        if (this.applyCommonCode(ent, c, v)) continue;
        switch (c) {
          case 1: ent.text = String(v); break;
          case 2: if (v) ent.name = normKey(v, ''); break;
          case 3: if (v) ent.styleName = normKey(v, 'STANDARD'); break;
          case 10: ent.x = v; break;
          case 20: ent.y = v; break;
          case 30: ent.z = v; break;
          case 11: ent.x1 = v; break;
          case 21: ent.y1 = v; break;
          case 31: ent.z1 = v; break;
          case 12: ent.x2 = v; break;
          case 22: ent.y2 = v; break;
          case 32: ent.z2 = v; break;
          case 13: ent.x3 = v; break;
          case 23: ent.y3 = v; break;
          case 33: ent.z3 = v; break;
          case 14: ent.x4 = v; break;
          case 24: ent.y4 = v; break;
          case 34: ent.z4 = v; break;
          case 15: ent.x5 = v; break;
          case 25: ent.y5 = v; break;
          case 35: ent.z5 = v; break;
          case 16: ent.x6 = v; break;
          case 26: ent.y6 = v; break;
          case 36: ent.z6 = v; break;
          case 42: if (v > 0) ent.actualMeasurement = v; break;
          case 50: ent.rotation = v; break;
          case 51: ent.horizontalDir = v; break;
          case 53: ent.textRotation = v; break;
          case 70: ent.flags = v; break;
          case 71: ent.attachmentPoint = v || 5; break;
        }
      }
      return ent;
    }

    /**
     * Parses TEXT, ATTRIB, ATTDEF, SHAPE, ARCTEXT.
     * Critically stops at `100: AcDbXrecord` or `101: Embedded Object` so trailing Xrecord
     * annotation scale (`40: 1.0`), lock flags (`70: 1`), and `(0,0,0)` never overwrite ATTRIB properties!
     */
    parseTextOrAttribRecord(type, codes, values, start, end) {
      const ent = this.createBaseEntity(type);
      ent.text = '';
      ent.textStyle = 'STANDARD';
      ent.x = 0; ent.y = 0; ent.z = 0;
      ent.x1 = undefined; ent.y1 = undefined; ent.z1 = undefined;
      ent.height = undefined;
      ent.xscale = undefined;
      ent.rotation = 0;
      ent.oblique = undefined;
      ent.halign = 0;
      ent.valign = 0;
      ent.flags = 0;
      ent.textGenFlags = 0;
      ent.r = 20;
      ent.startAngle = 0;
      ent.endAngle = 180;
      let inAcDbAttrib = false;
      let gotAttribFlags = false;

      for (let i = start; i < end; i++) {
        const c = codes[i], v = values[i];
        if (c >= 1000) continue;
        if (c === 101) break;
        if (c === 100) {
          const sub = String(v).toUpperCase();
          if (sub.includes('XRECORD')) break;
          if (sub.includes('ATTRIBUTE')) inAcDbAttrib = true;
          continue;
        }
        if (this.applyCommonCode(ent, c, v)) continue;
        switch (c) {
          case 1: if (!inAcDbAttrib || !ent.text) ent.text = String(v); break;
          case 2: if (type === 'SHAPE') ent.text = String(v); else if (!ent.tag) ent.tag = String(v); break;
          case 7: if (v) ent.textStyle = normKey(v, 'STANDARD'); break;
          case 10: if (!inAcDbAttrib) ent.x = v; break;
          case 20: if (!inAcDbAttrib) ent.y = v; break;
          case 30: if (!inAcDbAttrib) ent.z = v; break;
          case 11: if (!inAcDbAttrib) ent.x1 = v; break;
          case 21: if (!inAcDbAttrib) ent.y1 = v; break;
          case 31: if (!inAcDbAttrib) ent.z1 = v; break;
          case 40:
            if (type === 'ARCTEXT') ent.r = v;
            else if (v > 0 && !inAcDbAttrib) ent.height = v;
            break;
          case 41: if (v > 0 && !inAcDbAttrib) ent.xscale = v; break;
          case 42: if (type === 'ARCTEXT' && v > 0) ent.height = v; break;
          case 50:
            if (type === 'ARCTEXT') ent.startAngle = v;
            else if (!inAcDbAttrib) ent.rotation = v;
            break;
          case 51:
            if (type === 'ARCTEXT') ent.endAngle = v;
            else if (!inAcDbAttrib) ent.oblique = v;
            break;
          case 70:
            if (!gotAttribFlags) {
              ent.flags = v;
              if (inAcDbAttrib) gotAttribFlags = true;
            }
            break;
          case 71: if (!inAcDbAttrib) ent.textGenFlags = v; break;
          case 72: if (!inAcDbAttrib) ent.halign = v; break;
          case 73: if (type === 'TEXT') ent.valign = v; break;
          case 74: if (type === 'ATTRIB' || type === 'ATTDEF') ent.valign = v; break;
        }
      }
      return ent;
    }

    parseMTextRecord(codes, values, start, end) {
      const ent = this.createBaseEntity('MTEXT');
      ent.text = '';
      const chunks = [];
      ent.textStyle = 'STANDARD';
      ent.x = 0; ent.y = 0; ent.z = 0;
      ent.x1 = undefined; ent.y1 = undefined; ent.z1 = undefined;
      ent.height = undefined;
      ent.refWidth = 0;
      ent.rotation = 0;
      ent.attachmentPoint = 1;
      ent.bgFillFlags = 0;
      ent.bgColorIndex = null;
      ent.bgTrueColor = null;
      let inColumns = false;

      for (let i = start; i < end; i++) {
        const c = codes[i], v = values[i];
        if (c >= 1000) continue;
        if (c === 101 || (c === 100 && String(v).toUpperCase().includes('XRECORD'))) break;
        if (this.applyCommonCode(ent, c, v)) continue;
        if (c === 75) { inColumns = true; continue; }
        switch (c) {
          case 1: chunks.push(String(v)); break;
          case 3: chunks.push(String(v)); break;
          case 7: if (v) ent.textStyle = normKey(v, 'STANDARD'); break;
          case 10: if (!inColumns) ent.x = v; break;
          case 20: if (!inColumns) ent.y = v; break;
          case 30: if (!inColumns) ent.z = v; break;
          case 11: if (!inColumns) ent.x1 = v; break;
          case 21: if (!inColumns) ent.y1 = v; break;
          case 31: if (!inColumns) ent.z1 = v; break;
          case 40: if (v > 0 && !inColumns) ent.height = v; break;
          case 41: if (!inColumns) ent.refWidth = v; break;
          case 50: if (!inColumns) ent.rotation = v; break;
          case 63: ent.bgColorIndex = v; break;
          case 421: ent.bgTrueColor = v; break;
          case 71: if (v >= 1 && v <= 9) ent.attachmentPoint = v; break;
          case 90: ent.bgFillFlags = v; break;
        }
      }
      ent.text = chunks.join('');
      return ent;
    }

    parseSplineRecord(codes, values, start, end) {
      const ent = this.createBaseEntity('SPLINE');
      ent.flags = 0; ent.degree = 3; ent.knots = []; ent.weights = []; ent.controlPoints = []; ent.fitPoints = [];
      let curCP = null, curFP = null;
      for (let i = start; i < end; i++) {
        const c = codes[i], v = values[i];
        if (c >= 1000) continue;
        if (c === 101) break;
        if (this.applyCommonCode(ent, c, v)) continue;
        if (c === 70) ent.flags = v;
        else if (c === 71 && v >= 1 && v <= 10) ent.degree = v;
        else if (c === 40) ent.knots.push(v);
        else if (c === 41) ent.weights.push(v);
        else if (c === 10) { curCP = { x: v, y: 0, z: 0 }; ent.controlPoints.push(curCP); }
        else if (c === 20 && curCP) curCP.y = v;
        else if (c === 30 && curCP) curCP.z = v;
        else if (c === 11) { curFP = { x: v, y: 0, z: 0 }; ent.fitPoints.push(curFP); }
        else if (c === 21 && curFP) curFP.y = v;
        else if (c === 31 && curFP) curFP.z = v;
      }
      return ent;
    }

    parseHelixRecord(codes, values, start, end) {
      const ent = this.createBaseEntity('HELIX');
      ent.degree = 3; ent.knots = []; ent.weights = []; ent.controlPoints = [];
      ent.x = 0; ent.y = 0; ent.z = 0;
      ent.x1 = undefined; ent.y1 = undefined; ent.z1 = undefined;
      ent.r = undefined; ent.turns = 3; ent.turnHeight = 5.0;
      let inHelixSubclass = false;
      let curCP = null;
      for (let i = start; i < end; i++) {
        const c = codes[i], v = values[i];
        if (c >= 1000) continue;
        if (this.applyCommonCode(ent, c, v)) continue;
        if (c === 100 && String(v).toUpperCase().includes('HELIX')) {
          inHelixSubclass = true;
          continue;
        }
        if (!inHelixSubclass) {
          if (c === 71 && v >= 1 && v <= 10) ent.degree = v;
          else if (c === 40) ent.knots.push(v);
          else if (c === 41) ent.weights.push(v);
          else if (c === 10) { curCP = { x: v, y: 0, z: 0 }; ent.controlPoints.push(curCP); }
          else if (c === 20 && curCP) curCP.y = v;
          else if (c === 30 && curCP) curCP.z = v;
          else if (c === 11) ent.x1 = v;
          else if (c === 21) ent.y1 = v;
          else if (c === 31) ent.z1 = v;
          else if (c === 42) ent.turnHeight = v;
        } else {
          if (c === 10) ent.x = v;
          else if (c === 20) ent.y = v;
          else if (c === 30) ent.z = v;
          else if (c === 11) ent.x1 = v;
          else if (c === 21) ent.y1 = v;
          else if (c === 31) ent.z1 = v;
          else if (c === 40) ent.r = v;
          else if (c === 41) ent.turns = v;
          else if (c === 42) ent.turnHeight = v;
        }
      }
      return ent;
    }

    parseHatchRecord(type, codes, values, start, end) {
      const ent = this.createBaseEntity(type);
      ent.patternName = 'SOLID';
      ent.solidFill = 1;
      ent.isGradient = false;
      ent.loops = [];
      ent.patternAngle = 0;
      ent.patternScale = 1.0;
      ent.patternLines = [];
      ent.z = 0;

      let state = 'HEADER';
      let curLoop = null;
      let curPolyV = null;
      let curEdge = null;
      let curPatLine = null;

      for (let i = start; i < end; i++) {
        const c = codes[i], v = values[i];
        if (c >= 1000) continue;
        if (c === 101 || (c === 100 && String(v).toUpperCase().includes('XRECORD'))) break;
        if (this.applyCommonCode(ent, c, v)) continue;
        if (c === 450 && v > 0) { ent.isGradient = true; continue; }

        if (state === 'HEADER') {
          if (c === 2 && v) ent.patternName = normKey(v, 'SOLID');
          else if (c === 30) ent.z = v;
          else if (c === 70) ent.solidFill = v;
          else if (c === 91) state = 'LOOPS';
          else if (c === 92) {
            state = 'LOOPS';
            curLoop = { typeFlags: v, isPolyline: (v & 2) !== 0, maxCount: 0, vertices: [], edges: [] };
            ent.loops.push(curLoop);
          }
        } else if (state === 'LOOPS') {
          if (c === 75 || c === 76 || c === 98 || c === 47) {
            state = 'FOOTER';
            continue;
          }
          if (c === 92) {
            curLoop = { typeFlags: v, isPolyline: (v & 2) !== 0, maxCount: 0, vertices: [], edges: [] };
            curPolyV = null;
            curEdge = null;
            ent.loops.push(curLoop);
          } else if (curLoop && curLoop.isPolyline) {
            if (c === 93 && curLoop.vertices.length === 0) {
              curLoop.maxCount = v;
            } else if (c === 10) {
              if (curLoop.maxCount > 0 && curLoop.vertices.length >= curLoop.maxCount) continue;
              curPolyV = { x: v, y: 0, bulge: 0 };
              curLoop.vertices.push(curPolyV);
            } else if (c === 20 && curPolyV) curPolyV.y = v;
            else if (c === 42 && curPolyV) curPolyV.bulge = v;
          } else if (curLoop && !curLoop.isPolyline) {
            if (c === 93 && curLoop.edges.length === 0) {
              curLoop.maxCount = v;
            } else if (c === 72) {
              if (curLoop.maxCount > 0 && curLoop.edges.length >= curLoop.maxCount) {
                curEdge = null;
                continue;
              }
              curEdge = { edgeType: v, maxCP: 0, maxFP: 0, controlPoints: [], knots: [], weights: [], fitPoints: [] };
              curLoop.edges.push(curEdge);
            } else if (curEdge) {
              if (curEdge.edgeType === 1) {
                if (c === 10) curEdge.x1 = v;
                else if (c === 20) curEdge.y1 = v;
                else if (c === 11) curEdge.x2 = v;
                else if (c === 21) curEdge.y2 = v;
              } else if (curEdge.edgeType === 2) {
                if (c === 10) curEdge.x1 = v;
                else if (c === 20) curEdge.y1 = v;
                else if (c === 40) curEdge.radius = v;
                else if (c === 50) curEdge.startAngle = v;
                else if (c === 51) curEdge.endAngle = v;
                else if (c === 73) curEdge.ccw = v !== 0;
              } else if (curEdge.edgeType === 3) {
                if (c === 10) curEdge.x1 = v;
                else if (c === 20) curEdge.y1 = v;
                else if (c === 11) curEdge.x2 = v;
                else if (c === 21) curEdge.y2 = v;
                else if (c === 40) curEdge.ratio = v;
                else if (c === 50) curEdge.startAngle = v;
                else if (c === 51) curEdge.endAngle = v;
                else if (c === 73) curEdge.ccw = v !== 0;
              } else if (curEdge.edgeType === 4) {
                if (c === 94) curEdge.degree = v;
                else if (c === 96) curEdge.maxCP = v;
                else if (c === 97) curEdge.maxFP = v;
                else if (c === 40) curEdge.knots.push(v);
                else if (c === 42) curEdge.weights.push(v);
                else if (c === 10) {
                  if (curEdge.maxCP === 0 || curEdge.controlPoints.length < curEdge.maxCP) {
                    curEdge.controlPoints.push({ x: v, y: 0, z: 0 });
                  }
                } else if (c === 20 && curEdge.controlPoints.length > 0) {
                  curEdge.controlPoints[curEdge.controlPoints.length - 1].y = v;
                } else if (c === 11) {
                  if (curEdge.maxFP === 0 || curEdge.fitPoints.length < curEdge.maxFP) {
                    curEdge.fitPoints.push({ x: v, y: 0, z: 0 });
                  }
                } else if (c === 21 && curEdge.fitPoints.length > 0) {
                  curEdge.fitPoints[curEdge.fitPoints.length - 1].y = v;
                }
              }
            }
          }
        } else if (state === 'FOOTER') {
          if (c === 52) ent.patternAngle = v;
          else if (c === 41 && v > 0) ent.patternScale = v;
          else if (c === 53) {
            curPatLine = { angle: v, baseX: 0, baseY: 0, offsetX: 0, offsetY: 1, dashes: [] };
            ent.patternLines.push(curPatLine);
          } else if (curPatLine) {
            if (c === 43) curPatLine.baseX = v;
            else if (c === 44) curPatLine.baseY = v;
            else if (c === 45) curPatLine.offsetX = v;
            else if (c === 46) curPatLine.offsetY = v;
            else if (c === 49) curPatLine.dashes.push(v);
          }
        }
      }
      return ent;
    }

    parseLeaderRecord(codes, values, start, end) {
      const ent = this.createBaseEntity('LEADER');
      ent.vertices = []; ent.hasArrow = true; ent.pathType = 0; ent.dimstyle = 'STANDARD';
      let curV = null;
      for (let i = start; i < end; i++) {
        const c = codes[i], v = values[i];
        if (c >= 1000) continue;
        if (c === 101 || (c === 100 && String(v).toUpperCase().includes('XRECORD'))) break;
        if (this.applyCommonCode(ent, c, v)) continue;
        if (c === 3 && v) ent.dimstyle = normKey(v, 'STANDARD');
        else if (c === 71) ent.hasArrow = v !== 0;
        else if (c === 72) ent.pathType = v;
        else if (c === 10) { curV = { x: v, y: 0, z: 0 }; ent.vertices.push(curV); }
        else if (c === 20 && curV) curV.y = v;
        else if (c === 30 && curV) curV.z = v;
      }
      return ent;
    }

    parseMLeaderRecord(codes, values, start, end) {
      const ent = this.createBaseEntity('MLEADER');
      ent.leaderBranches = []; ent.doglegLength = 4.0; ent.arrowSize = 2.5; ent.textHeight = 2.5;
      ent.text = ''; ent.textPos = null; ent.landingPt = null;
      let inLeaderNode = false, inLeaderLine = false, curBranch = null, curV = null;
      for (let i = start; i < end; i++) {
        const c = codes[i], v = values[i];
        if (c >= 1000) continue;
        if (this.applyCommonCode(ent, c, v)) continue;
        if (c === 304) ent.text = (ent.text ? ent.text + '\\P' : '') + v;
        else if (c === 41 && v > 0 && !inLeaderNode) ent.doglegLength = v;
        else if (c === 42 && v > 0 && !inLeaderNode) ent.arrowSize = v;
        else if (c === 140 && v > 0) ent.textHeight = v;
        else if (c === 301 && String(v).includes('LEADER')) {
          inLeaderNode = true;
        } else if (c === 302 && String(v).includes('}')) {
          inLeaderNode = false;
        } else if (c === 302 && String(v).includes('LEADER_LINE')) {
          inLeaderLine = true; curBranch = []; ent.leaderBranches.push(curBranch);
        } else if (c === 303 && inLeaderLine) {
          inLeaderLine = false; curBranch = null;
        } else if (inLeaderLine && curBranch) {
          if (c === 10) { curV = { x: v, y: 0, z: 0 }; curBranch.push(curV); }
          else if (c === 20 && curV) curV.y = v;
          else if (c === 30 && curV) curV.z = v;
        } else if (inLeaderNode && !inLeaderLine) {
          if (c === 10 && !ent.landingPt) ent.landingPt = { x: v, y: 0, z: 0 };
          else if (c === 20 && ent.landingPt && ent.landingPt.y === 0) ent.landingPt.y = v;
          else if (c === 30 && ent.landingPt && ent.landingPt.z === 0) ent.landingPt.z = v;
        } else if (!inLeaderNode && !inLeaderLine) {
          if (c === 10 && !ent.landingPt) ent.landingPt = { x: v, y: 0, z: 0 };
          else if (c === 20 && ent.landingPt && ent.landingPt.y === 0) ent.landingPt.y = v;
          else if (c === 12 && !ent.textPos) ent.textPos = { x: v, y: 0, z: 0 };
          else if (c === 22 && ent.textPos && ent.textPos.y === 0) ent.textPos.y = v;
        }
      }
      return ent;
    }

    parseMLineRecord(codes, values, start, end) {
      const ent = this.createBaseEntity('MLINE');
      ent.styleName = 'STANDARD'; ent.scale = 1.0; ent.justification = 0; ent.flags = 0; ent.vertices = [];
      let curV = null;
      for (let i = start; i < end; i++) {
        const c = codes[i], v = values[i];
        if (c >= 1000) continue;
        if (c === 101) break;
        if (this.applyCommonCode(ent, c, v)) continue;
        if (c === 2 && v) ent.styleName = normKey(v, 'STANDARD');
        else if (c === 40) ent.scale = v || 1.0;
        else if (c === 70) ent.justification = v;
        else if (c === 71) ent.flags = v;
        else if (c === 11) {
          curV = { x: v, y: 0, z: 0, dirX: 1, dirY: 0, dirZ: 0, miterX: 0, miterY: 1, miterZ: 0 };
          ent.vertices.push(curV);
        } else if (c === 21 && curV) curV.y = v;
        else if (c === 31 && curV) curV.z = v;
        else if (c === 12 && curV) curV.dirX = v;
        else if (c === 22 && curV) curV.dirY = v;
        else if (c === 32 && curV) curV.dirZ = v;
        else if (c === 13 && curV) curV.miterX = v;
        else if (c === 23 && curV) curV.miterY = v;
        else if (c === 33 && curV) curV.miterZ = v;
      }
      return ent;
    }

    parseAcadTableRecord(codes, values, start, end) {
      const ent = this.createBaseEntity('ACAD_TABLE');
      ent.x = 0; ent.y = 0; ent.z = 0; ent.numRows = 0; ent.numCols = 0;
      ent.rowHeights = []; ent.colWidths = []; ent.cells = [];
      let curCell = null;
      for (let i = start; i < end; i++) {
        const c = codes[i], v = values[i];
        if (c >= 1000) continue;
        if (this.applyCommonCode(ent, c, v)) continue;
        if (c === 10 && !curCell) ent.x = v;
        else if (c === 20 && !curCell) ent.y = v;
        else if (c === 30 && !curCell) ent.z = v;
        else if (c === 91 && ent.numRows === 0) ent.numRows = v;
        else if (c === 92 && ent.numCols === 0) ent.numCols = v;
        else if (c === 141) ent.rowHeights.push(v);
        else if (c === 142) ent.colWidths.push(v);
        else if (c === 171) { curCell = { cellType: v, text: '', textHeight: 2.5 }; ent.cells.push(curCell); }
        else if (curCell) {
          if ((c === 1 || c === 302) && String(v) !== 'CELL_VALUE') curCell.text += v;
          else if (c === 140 && v > 0) curCell.textHeight = v;
        }
      }
      return ent;
    }

    parseSubDMeshRecord(codes, values, start, end) {
      const ent = this.createBaseEntity('MESH');
      ent.vertices = []; ent.faces = [];
      let readingVerts = false, readingFaces = false, vertsLeft = 0, faceIntsLeft = 0, curV = null;
      let vertPhaseDone = false, facePhaseDone = false;
      const faceStream = [];
      for (let i = start; i < end; i++) {
        const c = codes[i], v = values[i];
        if (c >= 1000) continue;
        if (this.applyCommonCode(ent, c, v)) continue;
        if (c === 92 && !vertPhaseDone && ent.vertices.length === 0) {
          vertsLeft = v; readingVerts = true; readingFaces = false; vertPhaseDone = true;
        } else if (c === 93 && !facePhaseDone && faceStream.length === 0) {
          faceIntsLeft = v; readingVerts = false; readingFaces = true; facePhaseDone = true;
        } else if (c === 94 || c === 95) {
          readingVerts = false; readingFaces = false;
        } else if (readingVerts && vertsLeft > 0) {
          if (c === 10) { curV = { x: v, y: 0, z: 0 }; ent.vertices.push(curV); vertsLeft--; }
          else if (c === 20 && curV) curV.y = v;
          else if (c === 30 && curV) curV.z = v;
        } else if (readingFaces && faceIntsLeft > 0 && c === 90) {
          faceStream.push(v); faceIntsLeft--;
        }
      }
      let fi = 0;
      while (fi < faceStream.length) {
        const cnt = faceStream[fi++];
        if (cnt >= 3 && fi + cnt <= faceStream.length) { ent.faces.push(faceStream.slice(fi, fi + cnt)); fi += cnt; }
        else break;
      }
      return ent;
    }

    parseSimpleGeometricRecord(type, codes, values, start, end) {
      const ent = this.createBaseEntity(type);
      ent.satLines = [];
      const isAcisType = (
        type === '3DSOLID' || type === 'REGION' || type === 'BODY' ||
        type === 'SURFACE' || type === 'PLANESURFACE' || type === 'EXTRUDEDSURFACE' ||
        type === 'REVOLVEDSURFACE' || type === 'SWEPTSURFACE' || type === 'LOFTEDSURFACE'
      );
      for (let i = start; i < end; i++) {
        const c = codes[i], v = values[i];
        if (c >= 1000) continue;
        if (c === 101 && !isAcisType) break;
        if (c === 100 && String(v).toUpperCase().includes('XRECORD')) break;
        if (this.applyCommonCode(ent, c, v)) continue;
        switch (c) {
          case 1:
            if (isAcisType) ent.satLines.push(String(v));
            else ent.text = (ent.text || '') + v;
            break;
          case 2: ent.name = normKey(v, ''); break;
          case 3:
            if (isAcisType) ent.satLines.push(String(v));
            else ent.styleName = normKey(v, 'STANDARD');
            break;
          case 10: if (ent.x === undefined) ent.x = v; break;
          case 20: if (ent.y === undefined) ent.y = v; break;
          case 30: if (ent.z === undefined) ent.z = v; break;
          case 11: if (ent.x1 === undefined) ent.x1 = v; break;
          case 21: if (ent.y1 === undefined) ent.y1 = v; break;
          case 31: if (ent.z1 === undefined) ent.z1 = v; break;
          case 12: if (ent.x2 === undefined) ent.x2 = v; break;
          case 22: if (ent.y2 === undefined) ent.y2 = v; break;
          case 32: if (ent.z2 === undefined) ent.z2 = v; break;
          case 13: if (ent.x3 === undefined) ent.x3 = v; break;
          case 23: if (ent.y3 === undefined) ent.y3 = v; break;
          case 33: if (ent.z3 === undefined) ent.z3 = v; break;
          case 40: ent.r = v; ent.height = v; ent.ratio = v; break;
          case 41: ent.xscale = v; ent.startParam = v; ent.turns = v; break;
          case 42: ent.yscale = v; ent.endParam = v; ent.turnHeight = v; break;
          case 50: ent.rotation = v; ent.startAngle = v; break;
          case 51: ent.oblique = v; ent.endAngle = v; break;
          case 70: ent.flags = v; break;
        }
      }
      return ent;
    }
  }

  // ============================================================================
  // 7. High-Performance Batched Layer Collector
  // ============================================================================
  class LayerBatchCollector {
    constructor(layerName, displayName, colorHex, linetype, visible, originShift, onVertexAdded) {
      this.layerName = layerName;
      this.displayName = displayName || layerName;
      this.colorHex = colorHex;
      this.linetype = linetype;
      this.visible = visible;
      this.originShift = originShift || { x: 0, y: 0, z: 0 };
      this.onVertexAdded = onVertexAdded || null;
      this.entityCount = 0;

      this.linePos = new Float32GrowableBuffer(16384);
      this.lineCol = new Float32GrowableBuffer(16384);
      this.mesh2DPos = new Float32GrowableBuffer(4096);
      this.mesh2DCol = new Float32GrowableBuffer(4096);
      this.mesh3DPos = new Float32GrowableBuffer(4096);
      this.mesh3DCol = new Float32GrowableBuffer(4096);
    }

    addSegment(x1, y1, z1, x2, y2, z2, colorHex) {
      const ox = this.originShift.x, oy = this.originShift.y, oz = this.originShift.z;
      const ax = x1 - ox, ay = y1 - oy, az = z1 - oz;
      const bx = x2 - ox, by = y2 - oy, bz = z2 - oz;
      this.linePos.push6(ax, ay, az, bx, by, bz);
      const r = ((colorHex >> 16) & 255) / 255;
      const g = ((colorHex >> 8) & 255) / 255;
      const b = (colorHex & 255) / 255;
      this.lineCol.push6(r, g, b, r, g, b);
      if (this.onVertexAdded) {
        this.onVertexAdded(ax, ay, az);
        this.onVertexAdded(bx, by, bz);
      }
    }

    addSegmentsArray(coords, colorHex) {
      if (!coords || coords.length === 0) return;
      const ox = this.originShift.x, oy = this.originShift.y, oz = this.originShift.z;
      const r = ((colorHex >> 16) & 255) / 255;
      const g = ((colorHex >> 8) & 255) / 255;
      const b = (colorHex & 255) / 255;
      const cb = this.onVertexAdded;
      for (let i = 0; i < coords.length; i += 3) {
        const vx = coords[i] - ox, vy = coords[i + 1] - oy, vz = coords[i + 2] - oz;
        this.linePos.push3(vx, vy, vz);
        this.lineCol.push3(r, g, b);
        if (cb && (i % 6 === 0)) cb(vx, vy, vz);
      }
    }

    addTriangle2D(ax, ay, az, bx, by, bz, cx, cy, cz, colorHex) {
      const ox = this.originShift.x, oy = this.originShift.y, oz = this.originShift.z;
      const x1 = ax - ox, y1 = ay - oy, z1 = az - oz;
      const x2 = bx - ox, y2 = by - oy, z2 = bz - oz;
      const x3 = cx - ox, y3 = cy - oy, z3 = cz - oz;
      this.mesh2DPos.push9(x1, y1, z1, x2, y2, z2, x3, y3, z3);
      const r = ((colorHex >> 16) & 255) / 255;
      const g = ((colorHex >> 8) & 255) / 255;
      const b = (colorHex & 255) / 255;
      this.mesh2DCol.pushRGBRepeat(r, g, b, 3);
      if (this.onVertexAdded) {
        this.onVertexAdded(x1, y1, z1);
        this.onVertexAdded(x2, y2, z2);
        this.onVertexAdded(x3, y3, z3);
      }
    }

    addTriangle3D(ax, ay, az, bx, by, bz, cx, cy, cz, colorHex) {
      const ox = this.originShift.x, oy = this.originShift.y, oz = this.originShift.z;
      const x1 = ax - ox, y1 = ay - oy, z1 = az - oz;
      const x2 = bx - ox, y2 = by - oy, z2 = bz - oz;
      const x3 = cx - ox, y3 = cy - oy, z3 = cz - oz;
      this.mesh3DPos.push9(x1, y1, z1, x2, y2, z2, x3, y3, z3);
      const r = ((colorHex >> 16) & 255) / 255;
      const g = ((colorHex >> 8) & 255) / 255;
      const b = (colorHex & 255) / 255;
      this.mesh3DCol.pushRGBRepeat(r, g, b, 3);
      if (this.onVertexAdded) {
        this.onVertexAdded(x1, y1, z1);
        this.onVertexAdded(x2, y2, z2);
        this.onVertexAdded(x3, y3, z3);
      }
    }

    buildLayerGroup() {
      const group = new THREE.Group();
      group.name = this.layerName;
      group.visible = this.visible;
      group.userData = {
        layerName: this.layerName,
        displayName: this.displayName,
        colorHex: this.colorHex,
        linetype: this.linetype,
        entityCount: this.entityCount
      };

      if (this.mesh2DPos.length > 0) {
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(this.mesh2DPos.toTypedArray(), 3));
        geom.setAttribute('color', new THREE.BufferAttribute(this.mesh2DCol.toTypedArray(), 3));
        const mat = new THREE.MeshBasicMaterial({
          vertexColors: true,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.88,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1
        });
        const mesh2d = new THREE.Mesh(geom, mat);
        mesh2d.renderOrder = 1;
        mesh2d.name = `BatchedMesh2D_${this.layerName}`;
        group.add(mesh2d);
      }

      if (this.mesh3DPos.length > 0) {
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(this.mesh3DPos.toTypedArray(), 3));
        geom.setAttribute('color', new THREE.BufferAttribute(this.mesh3DCol.toTypedArray(), 3));
        geom.computeVertexNormals();
        const mat = new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.48,
          metalness: 0.18,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1
        });
        const mesh3d = new THREE.Mesh(geom, mat);
        mesh3d.renderOrder = 2;
        mesh3d.name = `BatchedMesh3D_${this.layerName}`;
        group.add(mesh3d);
      }

      if (this.linePos.length > 0) {
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(this.linePos.toTypedArray(), 3));
        geom.setAttribute('color', new THREE.BufferAttribute(this.lineCol.toTypedArray(), 3));
        const lines = new THREE.LineSegments(geom, new THREE.LineBasicMaterial({ vertexColors: true }));
        lines.renderOrder = 3;
        lines.name = `BatchedLines_${this.layerName}`;
        group.add(lines);
      }

      return group;
    }
  }

  // ============================================================================
  // 8. Main THREE.DXFLoader Class
  // ============================================================================
  class DXFLoader {
    constructor(manager) {
      this.manager = manager || (THREE && THREE.DefaultLoadingManager ? THREE.DefaultLoadingManager : null);
      this.options = {
        fontFamily: '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "SimHei", "Inter", sans-serif',
        defaultColor: 0x1E293B,
        backgroundColor: 'light',
        dimensionMode: 'auto',
        includePaperSpace: false,
        curveSegments: 48,
        extrudeThickness: true,
        centerOrigin: true
      };
      this.registeredFonts = {};
    }

    setOptions(opts) {
      Object.assign(this.options, opts || {});
      return this;
    }

    registerFont(name, threeFont) {
      this.registeredFonts[name.toLowerCase()] = threeFont;
      return this;
    }

    load(url, onLoad, onProgress, onError) {
      const loader = new THREE.FileLoader(this.manager);
      loader.setResponseType('arraybuffer');
      loader.load(
        url,
        (buffer) => {
          try {
            const result = this.parse(buffer);
            if (onLoad) onLoad(result);
          } catch (err) {
            if (onError) onError(err);
            else console.error('THREE.DXFLoader parse error:', err);
          }
        },
        onProgress,
        onError
      );
    }

    computeSceneOrigin(dxf, includePaperSpace) {
      const xs = [], ys = [], zs = [];
      const addSample = (x, y, z = 0) => {
        if (x !== undefined && y !== undefined && isFinite(x) && isFinite(y) && Math.abs(x) < 1e11 && Math.abs(y) < 1e11) {
          if (Math.abs(x) > 1e-5 || Math.abs(y) > 1e-5 || Math.abs(z) > 1e-5) {
            xs.push(x);
            ys.push(y);
            zs.push(isFinite(z) ? z : 0);
          }
        }
      };

      for (const ent of dxf.entities) {
        if (ent.inPaperSpace && !includePaperSpace) continue;
        if (ent.type === 'VIEWPORT') continue;
        if (ent.x !== undefined) {
          const pt = new THREE.Vector3(ent.x, ent.y || 0, ent.z || 0);
          if (ent.extrusion && (ent.type === 'CIRCLE' || ent.type === 'ARC' || ent.type === 'INSERT' || ent.type === 'TEXT')) {
            pt.applyMatrix4(getOCS2WCSMatrix(ent.extrusion));
          }
          addSample(pt.x, pt.y, pt.z);
        } else if (ent.vertices && ent.vertices.length > 0) {
          const pt = new THREE.Vector3(ent.vertices[0].x, ent.vertices[0].y || 0, ent.vertices[0].z || 0);
          if (ent.extrusion && ent.type === 'LWPOLYLINE') {
            pt.applyMatrix4(getOCS2WCSMatrix(ent.extrusion));
          }
          addSample(pt.x, pt.y, pt.z);
        } else if (ent.controlPoints && ent.controlPoints.length > 0) {
          addSample(ent.controlPoints[0].x, ent.controlPoints[0].y || 0, ent.controlPoints[0].z || 0);
        }
        if (xs.length >= 1000) break;
      }
      if (xs.length === 0) return { x: 0, y: 0, z: 0 };
      xs.sort((a, b) => a - b);
      ys.sort((a, b) => a - b);
      zs.sort((a, b) => a - b);
      const medX = xs[Math.floor(xs.length / 2)];
      const medY = ys[Math.floor(ys.length / 2)];
      const medZ = zs[Math.floor(zs.length / 2)];
      if (this.options.centerOrigin && (Math.abs(medX) > 5000 || Math.abs(medY) > 5000 || Math.abs(medZ) > 5000)) {
        return {
          x: Math.abs(medX) > 5000 ? Math.round(medX) : 0,
          y: Math.abs(medY) > 5000 ? Math.round(medY) : 0,
          z: Math.abs(medZ) > 5000 ? Math.round(medZ) : 0
        };
      }
      return { x: 0, y: 0, z: 0 };
    }

    parse(dxfInput, customOptions) {
      const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (customOptions) this.setOptions(customOptions);

      const decoded = decodeDXFArrayBuffer(dxfInput);
      const dxfText = decoded.text;

      const parser = new DXFParser();
      const dxf = parser.parse(dxfText);

      let usePaperSpace = this.options.includePaperSpace;
      const modelEntCount = dxf.entities.filter(e => !e.inPaperSpace && e.visible !== false && e.type !== 'VIEWPORT').length;
      if (modelEntCount === 0 && dxf.entities.length > 0) {
        usePaperSpace = true;
      }

      const baseSegs = dxf.entities.length > 15000 ? 24 : (dxf.entities.length > 5000 ? 32 : (this.options.curveSegments || 48));
      this._activeCurveSegs = baseSegs;

      const originShift = this.computeSceneOrigin(dxf, usePaperSpace);

      const globalBBox = new THREE.Box3();
      let curEntMinX = Infinity, curEntMinY = Infinity, curEntMinZ = Infinity;
      let curEntMaxX = -Infinity, curEntMaxY = -Infinity, curEntMaxZ = -Infinity;
      const sampleXs = [], sampleYs = [];
      let totalVertexEvents = 0;

      const onVertexAdded = (vx, vy, vz) => {
        if (!isFinite(vx) || !isFinite(vy) || !isFinite(vz)) return;
        if (Math.abs(vx) > 1e9 || Math.abs(vy) > 1e9 || Math.abs(vz) > 1e9) return;
        if (vx < curEntMinX) curEntMinX = vx;
        if (vy < curEntMinY) curEntMinY = vy;
        if (vz < curEntMinZ) curEntMinZ = vz;
        if (vx > curEntMaxX) curEntMaxX = vx;
        if (vy > curEntMaxY) curEntMaxY = vy;
        if (vz > curEntMaxZ) curEntMaxZ = vz;

        totalVertexEvents++;
        if (sampleXs.length < 4096) {
          sampleXs.push(vx);
          sampleYs.push(vy);
        } else if ((totalVertexEvents & 31) === 0) {
          const slot = totalVertexEvents % 4096;
          sampleXs[slot] = vx;
          sampleYs[slot] = vy;
        }
      };

      const collectors = {};
      const textAtlas = new MultiPageTextAtlas(this.options.fontFamily, onVertexAdded);
      const pickRecords = [];

      const stats = {
        totalEntities: 0,
        totalVertices: 0,
        drawCalls: 0,
        parseTimeMs: 0,
        encoding: decoded.encoding,
        acadVer: dxf.header['$ACADVER'] || 'AC1027',
        originShift,
        warnings: dxf.warnings || [],
        byType: {},
        layers: [],
        blocksCount: Object.keys(dxf.blocks).length,
        stylesCount: Object.keys(dxf.tables.styles).length,
        dimstylesCount: Object.keys(dxf.tables.dimstyles).length,
        has3D: false
      };

      const getCollector = (layerKey) => {
        const key = normKey(layerKey, '0');
        if (!collectors[key]) {
          const lDef = dxf.tables.layers[key] || { name: key, displayName: key, colorIndex: 7, visible: true, linetype: 'CONTINUOUS' };
          const colHex = this.resolveColor({ layer: key, colorIndex: 256 }, dxf, null);
          collectors[key] = new LayerBatchCollector(
            key,
            lDef.displayName || key,
            colHex,
            lDef.linetype || 'CONTINUOUS',
            lDef.visible !== false,
            originShift,
            onVertexAdded
          );
        }
        return collectors[key];
      };

      Object.keys(dxf.tables.layers).forEach(ln => getCollector(ln));
      const identityMat = new THREE.Matrix4();

      for (const ent of dxf.entities) {
        if (ent.inPaperSpace && !usePaperSpace) continue;
        if (ent.visible === false || ent.type === 'VIEWPORT') continue;

        const primaryBatch = getCollector(ent.layer);
        curEntMinX = Infinity; curEntMinY = Infinity; curEntMinZ = Infinity;
        curEntMaxX = -Infinity; curEntMaxY = -Infinity; curEntMaxZ = -Infinity;

        try {
          this.emitEntity(ent, dxf, getCollector, primaryBatch, textAtlas, identityMat, originShift, null, 0, stats);
        } catch (emitErr) {
          stats.warnings.push(`Render skipped ${ent.type} (#${ent.handle}): ${emitErr.message}`);
          continue;
        }

        primaryBatch.entityCount++;
        stats.totalEntities++;
        stats.byType[ent.type] = (stats.byType[ent.type] || 0) + 1;

        if (curEntMinX <= curEntMaxX) {
          const entBox = new THREE.Box3(
            new THREE.Vector3(curEntMinX, curEntMinY, curEntMinZ),
            new THREE.Vector3(curEntMaxX, curEntMaxY, curEntMaxZ)
          );
          if (ent.type !== 'XLINE' && ent.type !== 'RAY') {
            globalBBox.union(entBox);
          }
          if (pickRecords.length < 50000) {
            pickRecords.push({
              entity: ent,
              layer: normKey(ent.layer, '0'),
              box: entBox
            });
          }
        }
      }

      const viewBBox = globalBBox.clone();
      const fullW = globalBBox.max.x - globalBBox.min.x;
      const fullH = globalBBox.max.y - globalBBox.min.y;
      const fullZ = globalBBox.max.z - globalBBox.min.z;
      if (fullZ > Math.max(1.0, Math.max(fullW, fullH) * 0.04)) {
        stats.has3D = true;
      }

      if (sampleXs.length >= 16) {
        const sortedX = sampleXs.slice().sort((a, b) => a - b);
        const sortedY = sampleYs.slice().sort((a, b) => a - b);
        const q01X = sortedX[Math.floor(sortedX.length * 0.01)];
        const q99X = sortedX[Math.floor(sortedX.length * 0.99)];
        const q01Y = sortedY[Math.floor(sortedY.length * 0.01)];
        const q99Y = sortedY[Math.floor(sortedY.length * 0.99)];
        const spanX = Math.max(10, q99X - q01X);
        const spanY = Math.max(10, q99Y - q01Y);

        if (fullW > spanX * 12 || fullH > spanY * 12) {
          const padX = spanX * 0.25;
          const padY = spanY * 0.25;
          viewBBox.min.set(q01X - padX, q01Y - padY, globalBBox.min.z);
          viewBBox.max.set(q99X + padX, q99Y + padY, globalBBox.max.z);
        }
      }

      const rootGroup = new THREE.Group();
      rootGroup.name = 'DXF_Root';
      const layerGroups = {};

      Object.keys(collectors).forEach(ln => {
        const col = collectors[ln];
        const lg = col.buildLayerGroup();
        layerGroups[ln] = lg;
        rootGroup.add(lg);
        stats.totalVertices += (col.linePos.length + col.mesh2DPos.length + col.mesh3DPos.length) / 3;
        stats.drawCalls += lg.children.length;
        stats.layers.push({
          name: ln,
          displayName: col.displayName,
          visible: col.visible,
          colorHex: col.colorHex,
          linetype: col.linetype,
          entityCount: col.entityCount
        });
      });

      const atlasMeshes = textAtlas.buildAtlasMeshes();
      for (const am of atlasMeshes) {
        rootGroup.add(am);
        stats.drawCalls += 1;
      }
      stats.totalVertices += textAtlas.getTotalVertexCount();

      const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      stats.parseTimeMs = Math.round(t1 - t0);

      rootGroup.userData = {
        dxfData: dxf,
        layerGroups,
        stats,
        boundingBox: viewBBox,
        fullBoundingBox: globalBBox,
        pickRecords,
        originShift
      };

      return {
        scene: rootGroup,
        dxf,
        layers: layerGroups,
        stats,
        boundingBox: viewBBox,
        fullBoundingBox: globalBBox,
        pickRecords,
        originShift
      };
    }

    // ==========================================================================
    // Color & Linetype Pattern Resolution
    // ==========================================================================
    resolveColor(ent, dxf, parentContext) {
      if (ent.trueColor !== null && ent.trueColor !== undefined) return ent.trueColor & 0xFFFFFF;
      let aci = ent.colorIndex !== undefined ? ent.colorIndex : 256;
      if (aci === 0 && parentContext && parentContext.colorHex !== undefined) return parentContext.colorHex;
      if (aci === 256 || aci === 0) {
        const entLayer = normKey(ent.layer, '0');
        const layerName = (entLayer === '0' && parentContext && parentContext.layer) ? parentContext.layer : entLayer;
        const layer = dxf.tables.layers[layerName];
        if (layer) {
          if (layer.trueColor !== null && layer.trueColor !== undefined) return layer.trueColor & 0xFFFFFF;
          aci = Math.abs(layer.colorIndex || 7);
        } else aci = 7;
      }
      aci = Math.abs(aci);
      if (aci === 7) return this.options.backgroundColor === 'light' ? 0x0F172A : (this.options.defaultColor || 0xF8FAFC);
      return ACI_PALETTE[aci] !== undefined ? ACI_PALETTE[aci] : 0xF8FAFC;
    }

    resolveLinetypePattern(ent, dxf, parentContext) {
      let ltName = normKey(ent.linetype, 'BYLAYER');
      if (ltName === 'BYBLOCK' && parentContext && parentContext.linetype) ltName = parentContext.linetype;
      if (ltName === 'BYLAYER' || ltName === 'BYBLOCK') {
        const entLayer = normKey(ent.layer, '0');
        const layerName = (entLayer === '0' && parentContext && parentContext.layer) ? parentContext.layer : entLayer;
        const layer = dxf.tables.layers[layerName];
        ltName = (layer && layer.linetype) ? normKey(layer.linetype, 'CONTINUOUS') : 'CONTINUOUS';
      }
      if (ltName === 'CONTINUOUS') return null;

      const globalScale = (dxf.header['$LTSCALE'] || 1.0) * (dxf.header['$CELTSCALE'] || 1.0);
      const scale = Math.max(0.05, (ent.ltscale || 1.0) * globalScale);
      const ltDef = dxf.tables.ltypes[ltName];
      if (ltDef && ltDef.pattern && ltDef.pattern.length >= 2) {
        return ltDef.pattern.map(v => v * scale);
      }
      if (ltName.includes('CENTER')) return [6.0 * scale, -1.5 * scale, 1.2 * scale, -1.5 * scale];
      if (ltName.includes('PHANTOM')) return [6.0 * scale, -1.2 * scale, 1.0 * scale, -1.2 * scale, 1.0 * scale, -1.2 * scale];
      if (ltName.includes('DASHDOT') || ltName.includes('DIVIDE')) return [4.0 * scale, -1.2 * scale, 0.2 * scale, -1.2 * scale];
      if (ltName.includes('DOT')) return [0.3 * scale, -1.2 * scale];
      if (ltName.includes('HIDDEN') || ltName.includes('DASH')) return [3.0 * scale, -1.5 * scale];
      return null;
    }

    emitPolylineToBatch(pts, ent, dxf, batch, worldMat, parentContext, isClosed = false, overrideColor = undefined, isOCS = false) {
      if (!pts || pts.length < 2) return;
      const color = overrideColor !== undefined ? overrideColor : this.resolveColor(ent, dxf, parentContext);
      const localPts = isClosed ? [...pts, pts[0].clone()] : pts;
      const transformed = localPts.map(p => p.clone().applyMatrix4(worldMat));

      const pattern = this.resolveLinetypePattern(ent, dxf, parentContext);
      tessellatePolylineSegmentsToBatch(transformed, pattern, batch, color);

      if (this.options.extrudeThickness && Math.abs(ent.thickness || 0) > 1e-4) {
        let topPts;
        if (isOCS) {
          topPts = localPts.map(p => new THREE.Vector3(p.x, p.y, (p.z || 0) + ent.thickness).applyMatrix4(worldMat));
        } else {
          const extDir = new THREE.Vector3(
            ent.extrusion ? ent.extrusion.x : 0,
            ent.extrusion ? ent.extrusion.y : 0,
            ent.extrusion && ent.extrusion.z !== undefined ? ent.extrusion.z : 1
          ).normalize().multiplyScalar(ent.thickness);
          topPts = localPts.map(p => p.clone().add(extDir).applyMatrix4(worldMat));
        }

        tessellatePolylineSegmentsToBatch(topPts, pattern, batch, color);

        const vertStep = Math.max(1, Math.floor((transformed.length - 1) / 8));
        for (let i = 0; i < transformed.length - 1; i++) {
          const a = transformed[i], b = transformed[i + 1];
          const aT = topPts[i], bT = topPts[i + 1];
          batch.addTriangle3D(a.x, a.y, a.z, b.x, b.y, b.z, bT.x, bT.y, bT.z, color);
          batch.addTriangle3D(a.x, a.y, a.z, bT.x, bT.y, bT.z, aT.x, aT.y, aT.z, color);
          if (transformed.length <= 12 || i % vertStep === 0) {
            batch.addSegment(a.x, a.y, a.z, aT.x, aT.y, aT.z, color);
          }
        }
        const lastIdx = transformed.length - 1;
        batch.addSegment(
          transformed[lastIdx].x, transformed[lastIdx].y, transformed[lastIdx].z,
          topPts[lastIdx].x, topPts[lastIdx].y, topPts[lastIdx].z,
          color
        );
      }
    }

    // ==========================================================================
    // Master Entity Emitter
    // ==========================================================================
    emitEntity(ent, dxf, getCollector, batch, textAtlas, worldMat, originShift, parentContext, depth, stats) {
      if (depth > 12) return;
      if (
        ent.type === '3DFACE' || ent.type === 'MESH' || ent.type === '3DSOLID' ||
        ent.type === 'SURFACE' || ent.type === 'EXTRUDEDSURFACE' || ent.type === 'REVOLVEDSURFACE' ||
        ent.type === 'SWEPTSURFACE' || ent.type === 'LOFTEDSURFACE' || ent.type === 'HELIX' ||
        (ent.type === 'POLYLINE' && (ent.flags & (8 | 16 | 64))) ||
        Math.abs(ent.thickness || 0) > 1e-4
      ) {
        stats.has3D = true;
      }

      switch (ent.type) {
        case 'LINE': return this.emitLine(ent, dxf, batch, worldMat, parentContext);
        case 'XLINE':
        case 'RAY': return this.emitXLineOrRay(ent, dxf, batch, worldMat, parentContext);
        case 'POINT': return this.emitPoint(ent, dxf, batch, worldMat, parentContext);
        case 'CIRCLE': return this.emitCircle(ent, dxf, batch, worldMat, parentContext, depth);
        case 'ARC': return this.emitArc(ent, dxf, batch, worldMat, parentContext, depth);
        case 'ELLIPSE': return this.emitEllipse(ent, dxf, batch, worldMat, parentContext);
        case 'HELIX': return this.emitHelix(ent, dxf, batch, worldMat, parentContext);
        case 'LWPOLYLINE': return this.emitLWPolyline(ent, dxf, batch, worldMat, parentContext);
        case 'POLYLINE': return this.emitPolyline(ent, dxf, batch, worldMat, parentContext);
        case 'MLINE': return this.emitMLine(ent, dxf, batch, worldMat, parentContext);
        case 'SPLINE': return this.emitSpline(ent, dxf, batch, worldMat, parentContext);
        case 'SOLID':
        case 'TRACE': return this.emitSolid(ent, dxf, batch, worldMat, parentContext);
        case 'WIPEOUT':
        case 'IMAGE':
        case 'PDFUNDERLAY':
        case 'DWFUNDERLAY':
        case 'DGNUNDERLAY': return this.emitWipeoutOrImage(ent, dxf, batch, worldMat, parentContext);
        case '3DFACE': return this.emit3DFace(ent, dxf, batch, worldMat, parentContext);
        case 'MESH': return this.emitSubDMesh(ent, dxf, batch, worldMat, parentContext);
        case '3DSOLID':
        case 'REGION':
        case 'BODY':
        case 'SURFACE':
        case 'PLANESURFACE':
        case 'EXTRUDEDSURFACE':
        case 'REVOLVEDSURFACE':
        case 'SWEPTSURFACE':
        case 'LOFTEDSURFACE': return this.emitACISSolid(ent, dxf, batch, worldMat, parentContext);
        case 'HATCH':
        case 'MPOLYGON': return this.emitHatch(ent, dxf, batch, worldMat, parentContext);
        case 'TEXT':
        case 'ATTRIB':
        case 'ATTDEF':
        case 'SHAPE': return this.emitText(ent, dxf, batch, textAtlas, worldMat, originShift, parentContext);
        case 'ARCTEXT': return this.emitArcText(ent, dxf, batch, textAtlas, worldMat, originShift, parentContext);
        case 'MTEXT': return this.emitMText(ent, dxf, batch, textAtlas, worldMat, originShift, parentContext);
        case 'ACAD_TABLE': return this.emitAcadTable(ent, dxf, batch, textAtlas, worldMat, originShift, parentContext);
        case 'DIMENSION':
        case 'ARC_DIMENSION':
        case 'LARGE_RADIAL_DIMENSION': return this.emitDimension(ent, dxf, getCollector, batch, textAtlas, worldMat, originShift, parentContext, depth, stats);
        case 'LEADER': return this.emitLeader(ent, dxf, batch, worldMat, parentContext);
        case 'MLEADER': return this.emitMLeader(ent, dxf, batch, textAtlas, worldMat, originShift, parentContext);
        case 'TOLERANCE': return this.emitTolerance(ent, dxf, batch, textAtlas, worldMat, originShift, parentContext);
        case 'INSERT': return this.emitInsert(ent, dxf, getCollector, batch, textAtlas, worldMat, originShift, parentContext, depth, stats);
        default: break;
      }
    }

    emitLine(ent, dxf, batch, worldMat, parentContext) {
      const p1 = new THREE.Vector3(ent.x || 0, ent.y || 0, ent.z || 0);
      const p2 = new THREE.Vector3(ent.x1 !== undefined ? ent.x1 : (ent.x || 0), ent.y1 !== undefined ? ent.y1 : (ent.y || 0), ent.z1 || 0);
      this.emitPolylineToBatch([p1, p2], ent, dxf, batch, worldMat, parentContext, false, undefined, false);
    }

    emitXLineOrRay(ent, dxf, batch, worldMat, parentContext) {
      const base = new THREE.Vector3(ent.x || 0, ent.y || 0, ent.z || 0);
      const dir = new THREE.Vector3(ent.x1 || 1, ent.y1 || 0, ent.z1 || 0).normalize();
      const reach = 250;
      const pStart = ent.type === 'XLINE' ? base.clone().addScaledVector(dir, -reach) : base;
      const pEnd = base.clone().addScaledVector(dir, reach);
      this.emitPolylineToBatch([pStart, pEnd], ent, dxf, batch, worldMat, parentContext, false, undefined, false);
    }

    emitPoint(ent, dxf, batch, worldMat, parentContext) {
      if (normKey(ent.layer, '0') === 'DEFPOINTS') return;
      const pdmode = dxf.header['$PDMODE'] !== undefined ? dxf.header['$PDMODE'] : 0;
      if (pdmode === 0 || pdmode === 1) return;
      const p = new THREE.Vector3(ent.x || 0, ent.y || 0, ent.z || 0).applyMatrix4(worldMat);
      const rawSize = dxf.header['$PDSIZE'] || 0;
      const s = rawSize > 0 ? rawSize : 1.0;
      const color = this.resolveColor(ent, dxf, parentContext);

      const baseShape = pdmode & 7;
      if (baseShape === 3) {
        batch.addSegment(p.x - s, p.y - s, p.z, p.x + s, p.y + s, p.z, color);
        batch.addSegment(p.x - s, p.y + s, p.z, p.x + s, p.y - s, p.z, color);
      } else if (baseShape === 2) {
        batch.addSegment(p.x - s, p.y, p.z, p.x + s, p.y, p.z, color);
        batch.addSegment(p.x, p.y - s, p.z, p.x, p.y + s, p.z, color);
      }
      if (pdmode & 32) {
        const segs = 12;
        for (let i = 0; i < segs; i++) {
          const a1 = (i / segs) * Math.PI * 2, a2 = ((i + 1) / segs) * Math.PI * 2;
          batch.addSegment(p.x + s * 0.8 * Math.cos(a1), p.y + s * 0.8 * Math.sin(a1), p.z, p.x + s * 0.8 * Math.cos(a2), p.y + s * 0.8 * Math.sin(a2), p.z, color);
        }
      }
    }

    emitCircle(ent, dxf, batch, worldMat, parentContext, depth = 0) {
      const r = ent.r || 1;
      const cx = ent.x || 0, cy = ent.y || 0, cz = ent.z || 0;
      const ocsMat = getOCS2WCSMatrix(ent.extrusion);
      const combMat = new THREE.Matrix4().multiplyMatrices(worldMat, ocsMat);
      const segs = depth > 0 ? Math.max(18, Math.floor(this._activeCurveSegs * 0.65)) : this._activeCurveSegs;
      const pts = [];
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        pts.push(new THREE.Vector3(cx + r * Math.cos(a), cy + r * Math.sin(a), cz));
      }
      this.emitPolylineToBatch(pts, ent, dxf, batch, combMat, parentContext, false, undefined, true);
    }

    emitArc(ent, dxf, batch, worldMat, parentContext, depth = 0) {
      const r = ent.r || 1;
      const cx = ent.x || 0, cy = ent.y || 0, cz = ent.z || 0;
      let startRad = THREE.MathUtils.degToRad(ent.startAngle || 0);
      let endRad = THREE.MathUtils.degToRad(ent.endAngle !== undefined ? ent.endAngle : 360);
      while (endRad <= startRad) endRad += Math.PI * 2;
      const sweep = endRad - startRad;
      const baseSegs = depth > 0 ? Math.max(14, Math.floor(this._activeCurveSegs * 0.65)) : this._activeCurveSegs;
      const segs = Math.max(6, Math.ceil((sweep / (Math.PI * 2)) * baseSegs));
      const ocsMat = getOCS2WCSMatrix(ent.extrusion);
      const combMat = new THREE.Matrix4().multiplyMatrices(worldMat, ocsMat);
      const pts = [];
      for (let i = 0; i <= segs; i++) {
        const a = startRad + sweep * (i / segs);
        pts.push(new THREE.Vector3(cx + r * Math.cos(a), cy + r * Math.sin(a), cz));
      }
      this.emitPolylineToBatch(pts, ent, dxf, batch, combMat, parentContext, false, undefined, true);
    }

    emitEllipse(ent, dxf, batch, worldMat, parentContext) {
      const center = new THREE.Vector3(ent.x || 0, ent.y || 0, ent.z || 0);
      const majorVec = new THREE.Vector3(ent.x1 || 1, ent.y1 || 0, ent.z1 || 0);
      const normal = new THREE.Vector3(
        ent.extrusion ? ent.extrusion.x : 0,
        ent.extrusion ? ent.extrusion.y : 0,
        ent.extrusion && ent.extrusion.z !== undefined ? ent.extrusion.z : 1
      ).normalize();
      const ratio = ent.ratio || 0.5;
      const minorVec = new THREE.Vector3().crossVectors(normal, majorVec).normalize().multiplyScalar(majorVec.length() * ratio);

      let startParam = ent.startParam !== undefined ? ent.startParam : 0;
      let endParam = ent.endParam !== undefined ? ent.endParam : Math.PI * 2;
      if (Math.abs(startParam) > Math.PI * 4 + 0.1 || Math.abs(endParam) > Math.PI * 4 + 0.1) {
        startParam = THREE.MathUtils.degToRad(startParam);
        endParam = THREE.MathUtils.degToRad(endParam);
      }
      while (endParam <= startParam) endParam += Math.PI * 2;
      const sweep = Math.min(Math.PI * 2, endParam - startParam);
      const segs = Math.max(12, Math.ceil((sweep / (Math.PI * 2)) * this._activeCurveSegs));
      const pts = [];
      for (let i = 0; i <= segs; i++) {
        const u = startParam + sweep * (i / segs);
        const cu = Math.cos(u), su = Math.sin(u);
        pts.push(new THREE.Vector3(
          center.x + majorVec.x * cu + minorVec.x * su,
          center.y + majorVec.y * cu + minorVec.y * su,
          center.z + majorVec.z * cu + minorVec.z * su
        ));
      }
      this.emitPolylineToBatch(pts, ent, dxf, batch, worldMat, parentContext, false, undefined, false);
    }

    emitHelix(ent, dxf, batch, worldMat, parentContext) {
      if (ent.controlPoints && ent.controlPoints.length >= 2) {
        const pts = evaluateNurbsSpline(ent.degree || 3, ent.controlPoints, ent.knots, ent.weights, this._activeCurveSegs * 2);
        this.emitPolylineToBatch(pts, ent, dxf, batch, worldMat, parentContext, false, undefined, false);
        return;
      }
      const cx = ent.x || 0, cy = ent.y || 0, cz = ent.z || 0;
      const r0 = ent.r || Math.hypot((ent.x1 !== undefined ? ent.x1 : (cx + 10)) - cx, (ent.y1 !== undefined ? ent.y1 : cy) - cy) || 10;
      const turns = Math.max(0.5, ent.turns || 3);
      const turnH = ent.turnHeight !== undefined ? ent.turnHeight : 5.0;
      const totalSegs = Math.ceil(turns * 36);
      const pts = [];
      for (let i = 0; i <= totalSegs; i++) {
        const t = (i / totalSegs) * turns;
        const ang = t * Math.PI * 2;
        pts.push(new THREE.Vector3(cx + r0 * Math.cos(ang), cy + r0 * Math.sin(ang), cz + t * turnH));
      }
      this.emitPolylineToBatch(pts, ent, dxf, batch, worldMat, parentContext, false, undefined, false);
    }

    emitVariableWidthStripToBatch(pts, widths, combMat, batch, color) {
      if (!pts || pts.length < 2) return;
      for (let i = 0; i < pts.length - 1; i++) {
        const w1 = (widths[i] || 0) * 0.5;
        const w2 = (widths[i + 1] !== undefined ? widths[i + 1] : widths[i] || 0) * 0.5;
        if (w1 < 1e-5 && w2 < 1e-5) continue;
        const p1 = pts[i], p2 = pts[i + 1];
        const dx = p2.x - p1.x, dy = p2.y - p1.y;
        const len = Math.hypot(dx, dy);
        if (len < 1e-8) continue;
        const nx = -dy / len, ny = dx / len;
        const a = new THREE.Vector3(p1.x + nx * w1, p1.y + ny * w1, p1.z).applyMatrix4(combMat);
        const b = new THREE.Vector3(p1.x - nx * w1, p1.y - ny * w1, p1.z).applyMatrix4(combMat);
        const c = new THREE.Vector3(p2.x - nx * w2, p2.y - ny * w2, p2.z).applyMatrix4(combMat);
        const d = new THREE.Vector3(p2.x + nx * w2, p2.y + ny * w2, p2.z).applyMatrix4(combMat);
        batch.addTriangle2D(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, color);
        batch.addTriangle2D(a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z, color);
      }
    }

    emitLWPolyline(ent, dxf, batch, worldMat, parentContext) {
      const verts = ent.vertices || [];
      if (verts.length < 2) return;
      const isClosed = (ent.flags & 1) !== 0;
      const ocsMat = getOCS2WCSMatrix(ent.extrusion);
      const combMat = new THREE.Matrix4().multiplyMatrices(worldMat, ocsMat);
      const color = this.resolveColor(ent, dxf, parentContext);

      const pts = [];
      const widths = [];
      const count = isClosed ? verts.length : verts.length - 1;
      const defaultW = ent.constantWidth || 0;
      let hasVariableOrConstWidth = defaultW > 1e-4;

      for (let i = 0; i < count; i++) {
        const v1 = verts[i], v2 = verts[(i + 1) % verts.length];
        const wStart = (v1.startWidth !== null && v1.startWidth !== undefined) ? v1.startWidth : defaultW;
        const wEnd = (v1.endWidth !== null && v1.endWidth !== undefined) ? v1.endWidth : wStart;
        if (wStart > 1e-4 || wEnd > 1e-4) hasVariableOrConstWidth = true;

        const segPts = interpolateBulgePoints(v1, v2, v1.bulge, this._activeCurveSegs);
        for (let k = (i === 0 ? 0 : 1); k < segPts.length; k++) {
          const t = segPts.length > 1 ? k / (segPts.length - 1) : 0;
          pts.push(segPts[k]);
          widths.push(wStart + (wEnd - wStart) * t);
        }
      }

      this.emitPolylineToBatch(pts, ent, dxf, batch, combMat, parentContext, false, color, true);

      if (hasVariableOrConstWidth && pts.length >= 2) {
        this.emitVariableWidthStripToBatch(pts, widths, combMat, batch, color);
      }
    }

    emitPolyline(ent, dxf, batch, worldMat, parentContext) {
      const verts = ent.vertices || [];
      if (verts.length === 0) return;
      const flags = ent.flags || 0;
      const color = this.resolveColor(ent, dxf, parentContext);

      // 1. Polyface Mesh (flags & 64 or VERTEX records with faceIndices)
      const hasFaceVertices = (flags & 64) !== 0 || verts.some(v => v.faceIndices && v.faceIndices.length >= 3);
      if (hasFaceVertices) {
        const coords = [], faceRecords = [];
        for (const v of verts) {
          if (v.faceIndices && v.faceIndices.length >= 3 && ((v.flags & 64) === 0)) {
            faceRecords.push(v);
          } else {
            coords.push(new THREE.Vector3(v.x, v.y, v.z).applyMatrix4(worldMat));
          }
        }
        for (const fv of faceRecords) {
          const validIdx = fv.faceIndices.filter(ix => ix !== 0);
          if (validIdx.length < 3) continue;
          let faceColor = color;
          if (fv.trueColor !== null && fv.trueColor !== undefined) faceColor = fv.trueColor & 0xFFFFFF;
          else if (fv.colorIndex !== undefined && fv.colorIndex !== 256 && fv.colorIndex !== 0) {
            faceColor = ACI_PALETTE[Math.abs(fv.colorIndex)] || color;
          }
          const pts = [];
          const visEdges = [];
          for (let k = 0; k < validIdx.length; k++) {
            const rawIx = validIdx[k];
            const pt = coords[Math.abs(rawIx) - 1];
            if (pt) {
              if (pts.length === 0 || pt.distanceToSquared(pts[pts.length - 1]) > 1e-10) {
                pts.push(pt);
                visEdges.push(rawIx > 0);
              }
            }
          }
          if (pts.length >= 3) {
            batch.addTriangle3D(pts[0].x, pts[0].y, pts[0].z, pts[1].x, pts[1].y, pts[1].z, pts[2].x, pts[2].y, pts[2].z, faceColor);
            if (pts.length === 4) {
              batch.addTriangle3D(pts[0].x, pts[0].y, pts[0].z, pts[2].x, pts[2].y, pts[2].z, pts[3].x, pts[3].y, pts[3].z, faceColor);
            }
            for (let e = 0; e < pts.length; e++) {
              if (visEdges[e]) {
                const pA = pts[e], pB = pts[(e + 1) % pts.length];
                batch.addSegment(pA.x, pA.y, pA.z, pB.x, pB.y, pB.z, faceColor);
              }
            }
          }
        }
        return;
      }

      // 2. 3D Polygon Mesh (flags & 16): Supports M-closed (flags & 1) and N-closed (flags & 32)
      if ((flags & 16) !== 0) {
        const isSmooth = (flags & 4) !== 0 && ent.smoothM > 1 && ent.smoothN > 1;
        const M = isSmooth ? ent.smoothM : ent.meshM;
        const N = isSmooth ? ent.smoothN : ent.meshN;
        const meshVerts = isSmooth ? verts.filter(v => (v.flags & 16) === 0) : verts;
        if (M > 1 && N > 1 && meshVerts.length >= M * N) {
          const tVerts = meshVerts.map(v => new THREE.Vector3(v.x, v.y, v.z).applyMatrix4(worldMat));
          const getV = (r, c) => tVerts[(r % M) * N + (c % N)];
          const mClosed = (flags & 1) !== 0;
          const nClosed = (flags & 32) !== 0;
          const rLimit = mClosed ? M : M - 1;
          const cLimit = nClosed ? N : N - 1;

          for (let r = 0; r < rLimit; r++) {
            for (let c = 0; c < cLimit; c++) {
              const v00 = getV(r, c), v10 = getV(r + 1, c), v11 = getV(r + 1, c + 1), v01 = getV(r, c + 1);
              if (v00 && v10 && v11 && v01) {
                batch.addTriangle3D(v00.x, v00.y, v00.z, v10.x, v10.y, v10.z, v11.x, v11.y, v11.z, color);
                batch.addTriangle3D(v00.x, v00.y, v00.z, v11.x, v11.y, v11.z, v01.x, v01.y, v01.z, color);
                batch.addSegment(v00.x, v00.y, v00.z, v10.x, v10.y, v10.z, color);
                batch.addSegment(v10.x, v10.y, v10.z, v11.x, v11.y, v11.z, color);
                batch.addSegment(v11.x, v11.y, v11.z, v01.x, v01.y, v01.z, color);
                batch.addSegment(v01.x, v01.y, v01.z, v00.x, v00.y, v00.z, color);
              }
            }
          }
          return;
        }
      }

      // 3. 2D or 3D Polyline (filter out invisible spline control frame points v.flags & 16!)
      const activeVerts = (flags & 4) !== 0
        ? verts.filter(v => (v.flags & 16) === 0)
        : verts;
      if (activeVerts.length < 2) return;

      const isClosed = (flags & 1) !== 0;
      const is3D = (flags & 8) !== 0;
      const ocsMat = is3D ? new THREE.Matrix4() : getOCS2WCSMatrix(ent.extrusion);
      const combMat = new THREE.Matrix4().multiplyMatrices(worldMat, ocsMat);
      const pts = [];
      const widths = [];
      const count = isClosed ? activeVerts.length : activeVerts.length - 1;
      const defStartW = ent.defaultStartWidth || 0;
      const defEndW = ent.defaultEndWidth !== undefined && ent.defaultEndWidth > 0 ? ent.defaultEndWidth : defStartW;
      let hasWidth = defStartW > 1e-4 || defEndW > 1e-4;

      for (let i = 0; i < count; i++) {
        const v1 = activeVerts[i], v2 = activeVerts[(i + 1) % activeVerts.length];
        const wStart = (v1.startWidth !== null && v1.startWidth !== undefined) ? v1.startWidth : defStartW;
        const wEnd = (v1.endWidth !== null && v1.endWidth !== undefined) ? v1.endWidth : (v1.startWidth !== null && v1.startWidth !== undefined ? v1.startWidth : defEndW);
        if (wStart > 1e-4 || wEnd > 1e-4) hasWidth = true;

        const segPts = is3D
          ? [new THREE.Vector3(v1.x, v1.y, v1.z), new THREE.Vector3(v2.x, v2.y, v2.z)]
          : interpolateBulgePoints(v1, v2, v1.bulge, this._activeCurveSegs);
        for (let k = (i === 0 ? 0 : 1); k < segPts.length; k++) {
          const t = segPts.length > 1 ? k / (segPts.length - 1) : 0;
          pts.push(segPts[k]);
          widths.push(wStart + (wEnd - wStart) * t);
        }
      }
      this.emitPolylineToBatch(pts, ent, dxf, batch, combMat, parentContext, false, color, !is3D);

      if (!is3D && hasWidth && pts.length >= 2) {
        this.emitVariableWidthStripToBatch(pts, widths, combMat, batch, color);
      }
    }

    emitMLine(ent, dxf, batch, worldMat, parentContext) {
      const verts = ent.vertices || [];
      if (verts.length < 2) return;
      const isClosed = (ent.flags & 2) !== 0;
      const style = dxf.objects.mlinestyles[normKey(ent.styleName, 'STANDARD')] || dxf.objects.mlinestyles['STANDARD'];
      const elements = (style && style.elements && style.elements.length > 0)
        ? style.elements
        : [{ offset: 0.5, colorIndex: 256 }, { offset: -0.5, colorIndex: 256 }];
      const scale = ent.scale !== undefined ? ent.scale : 1.0;

      for (const elem of elements) {
        const off = (elem.offset || 0) * scale;
        const elemColor = (elem.colorIndex && elem.colorIndex !== 256)
          ? (ACI_PALETTE[Math.abs(elem.colorIndex)] || this.resolveColor(ent, dxf, parentContext))
          : this.resolveColor(ent, dxf, parentContext);

        const pts = verts.map(v => {
          const mx = v.miterX !== undefined ? v.miterX : -v.dirY;
          const my = v.miterY !== undefined ? v.miterY : v.dirX;
          const mLen = Math.hypot(mx, my) || 1;
          return new THREE.Vector3(v.x + (mx / mLen) * off, v.y + (my / mLen) * off, v.z || 0);
        });
        this.emitPolylineToBatch(pts, ent, dxf, batch, worldMat, parentContext, isClosed, elemColor, false);
      }

      if (!isClosed && elements.length >= 2) {
        const minOff = Math.min(...elements.map(e => e.offset)) * scale;
        const maxOff = Math.max(...elements.map(e => e.offset)) * scale;
        const color = this.resolveColor(ent, dxf, parentContext);
        [verts[0], verts[verts.length - 1]].forEach(v => {
          const mx = v.miterX !== undefined ? v.miterX : -v.dirY;
          const my = v.miterY !== undefined ? v.miterY : v.dirX;
          const mLen = Math.hypot(mx, my) || 1;
          const pA = new THREE.Vector3(v.x + (mx / mLen) * minOff, v.y + (my / mLen) * minOff, v.z || 0).applyMatrix4(worldMat);
          const pB = new THREE.Vector3(v.x + (mx / mLen) * maxOff, v.y + (my / mLen) * maxOff, v.z || 0).applyMatrix4(worldMat);
          batch.addSegment(pA.x, pA.y, pA.z, pB.x, pB.y, pB.z, color);
        });
      }
    }

    emitSpline(ent, dxf, batch, worldMat, parentContext) {
      let pts = [];
      const isClosed = (ent.flags & 1) !== 0;
      if (ent.controlPoints && ent.controlPoints.length >= 2) {
        pts = evaluateNurbsSpline(ent.degree || 3, ent.controlPoints, ent.knots, ent.weights, this._activeCurveSegs);
      } else if (ent.fitPoints && ent.fitPoints.length >= 2) {
        const vecs = ent.fitPoints.filter(p => isFinite(p.x) && isFinite(p.y)).map(p => new THREE.Vector3(p.x, p.y, p.z || 0));
        if (vecs.length >= 2) {
          const curve = new THREE.CatmullRomCurve3(vecs, isClosed);
          pts = curve.getPoints(Math.max(this._activeCurveSegs, vecs.length * 6));
        }
      }
      this.emitPolylineToBatch(pts, ent, dxf, batch, worldMat, parentContext, isClosed, undefined, false);
    }

    emitSolid(ent, dxf, batch, worldMat, parentContext) {
      const ocsMat = getOCS2WCSMatrix(ent.extrusion);
      const combMat = new THREE.Matrix4().multiplyMatrices(worldMat, ocsMat);
      const z0 = ent.z || 0;
      const l0 = new THREE.Vector3(ent.x || 0, ent.y || 0, z0);
      const l1 = new THREE.Vector3(ent.x1 !== undefined ? ent.x1 : (ent.x || 0), ent.y1 !== undefined ? ent.y1 : (ent.y || 0), ent.z1 !== undefined ? ent.z1 : z0);
      const l2 = new THREE.Vector3(ent.x2 !== undefined ? ent.x2 : l1.x, ent.y2 !== undefined ? ent.y2 : l1.y, ent.z2 !== undefined ? ent.z2 : z0);
      const l3 = (ent.x3 !== undefined) ? new THREE.Vector3(ent.x3, ent.y3, ent.z3 !== undefined ? ent.z3 : z0) : l2.clone();

      const p0 = l0.clone().applyMatrix4(combMat);
      const p1 = l1.clone().applyMatrix4(combMat);
      const p2 = l2.clone().applyMatrix4(combMat);
      const p3 = l3.clone().applyMatrix4(combMat);
      const color = this.resolveColor(ent, dxf, parentContext);
      const hasFour = p2.distanceToSquared(p3) > 1e-10;

      if (this.options.extrudeThickness && Math.abs(ent.thickness || 0) > 1e-4) {
        const dz = ent.thickness;
        const t0 = new THREE.Vector3(l0.x, l0.y, l0.z + dz).applyMatrix4(combMat);
        const t1 = new THREE.Vector3(l1.x, l1.y, l1.z + dz).applyMatrix4(combMat);
        const t2 = new THREE.Vector3(l2.x, l2.y, l2.z + dz).applyMatrix4(combMat);
        const t3 = new THREE.Vector3(l3.x, l3.y, l3.z + dz).applyMatrix4(combMat);

        batch.addTriangle3D(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p3.x, p3.y, p3.z, color);
        batch.addTriangle3D(t0.x, t0.y, t0.z, t3.x, t3.y, t3.z, t1.x, t1.y, t1.z, color);
        if (hasFour) {
          batch.addTriangle3D(p0.x, p0.y, p0.z, p3.x, p3.y, p3.z, p2.x, p2.y, p2.z, color);
          batch.addTriangle3D(t0.x, t0.y, t0.z, t2.x, t2.y, t2.z, t3.x, t3.y, t3.z, color);
        }

        const perimB = hasFour ? [p0, p1, p3, p2] : [p0, p1, p2];
        const perimT = hasFour ? [t0, t1, t3, t2] : [t0, t1, t2];
        for (let i = 0; i < perimB.length; i++) {
          const ni = (i + 1) % perimB.length;
          const bA = perimB[i], bB = perimB[ni];
          const uA = perimT[i], uB = perimT[ni];
          batch.addTriangle3D(bA.x, bA.y, bA.z, bB.x, bB.y, bB.z, uB.x, uB.y, uB.z, color);
          batch.addTriangle3D(bA.x, bA.y, bA.z, uB.x, uB.y, uB.z, uA.x, uA.y, uA.z, color);
          batch.addSegment(bA.x, bA.y, bA.z, bB.x, bB.y, bB.z, color);
          batch.addSegment(uA.x, uA.y, uA.z, uB.x, uB.y, uB.z, color);
          batch.addSegment(bA.x, bA.y, bA.z, uA.x, uA.y, uA.z, color);
        }
      } else {
        batch.addTriangle2D(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p3.x, p3.y, p3.z, color);
        if (hasFour) {
          batch.addTriangle2D(p0.x, p0.y, p0.z, p3.x, p3.y, p3.z, p2.x, p2.y, p2.z, color);
        }
        batch.addSegment(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, color);
        batch.addSegment(p1.x, p1.y, p1.z, p3.x, p3.y, p3.z, color);
        if (hasFour) {
          batch.addSegment(p3.x, p3.y, p3.z, p2.x, p2.y, p2.z, color);
          batch.addSegment(p2.x, p2.y, p2.z, p0.x, p0.y, p0.z, color);
        } else {
          batch.addSegment(p3.x, p3.y, p3.z, p0.x, p0.y, p0.z, color);
        }
      }
    }

    emitWipeoutOrImage(ent, dxf, batch, worldMat, parentContext) {
      if (ent.x === undefined || ent.x3 === undefined || ent.y3 === undefined) return;
      const origin = new THREE.Vector3(ent.x, ent.y || 0, ent.z || 0);
      const uVec = new THREE.Vector3(ent.x1 || 1, ent.y1 || 0, ent.z1 || 0);
      const vVec = new THREE.Vector3(ent.x2 || 0, ent.y2 || 1, ent.z2 || 0);
      const w = ent.x3, h = ent.y3;
      const p0 = origin.clone();
      const p1 = origin.clone().addScaledVector(uVec, w);
      const p2 = origin.clone().addScaledVector(uVec, w).addScaledVector(vVec, h);
      const p3 = origin.clone().addScaledVector(vVec, h);
      this.emitPolylineToBatch([p0, p1, p2, p3], ent, dxf, batch, worldMat, parentContext, true);
    }

    emit3DFace(ent, dxf, batch, worldMat, parentContext) {
      const p0 = new THREE.Vector3(ent.x || 0, ent.y || 0, ent.z || 0).applyMatrix4(worldMat);
      const p1 = new THREE.Vector3(ent.x1 || 0, ent.y1 || 0, ent.z1 || 0).applyMatrix4(worldMat);
      const p2 = new THREE.Vector3(ent.x2 || 0, ent.y2 || 0, ent.z2 || 0).applyMatrix4(worldMat);
      const p3 = (ent.x3 !== undefined) ? new THREE.Vector3(ent.x3, ent.y3, ent.z3 || 0).applyMatrix4(worldMat) : p2;
      const color = this.resolveColor(ent, dxf, parentContext);

      batch.addTriangle3D(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, color);
      if (p2.distanceToSquared(p3) > 1e-10) {
        batch.addTriangle3D(p0.x, p0.y, p0.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z, color);
      }

      const flags = ent.flags || 0;
      if (!(flags & 1)) batch.addSegment(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, color);
      if (!(flags & 2)) batch.addSegment(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, color);
      if (!(flags & 4)) batch.addSegment(p2.x, p2.y, p2.z, p3.x, p3.y, p3.z, color);
      if (!(flags & 8)) batch.addSegment(p3.x, p3.y, p3.z, p0.x, p0.y, p0.z, color);
    }

    emitSubDMesh(ent, dxf, batch, worldMat, parentContext) {
      const verts = (ent.vertices || []).map(v => new THREE.Vector3(v.x, v.y, v.z || 0).applyMatrix4(worldMat));
      if (verts.length < 3) return;
      const color = this.resolveColor(ent, dxf, parentContext);
      for (const face of (ent.faces || [])) {
        if (face.length < 3) continue;
        const p0 = verts[face[0]];
        if (!p0) continue;
        for (let i = 1; i < face.length - 1; i++) {
          const p1 = verts[face[i]], p2 = verts[face[i + 1]];
          if (p1 && p2) batch.addTriangle3D(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, color);
        }
        for (let i = 0; i < face.length; i++) {
          const pA = verts[face[i]], pB = verts[face[(i + 1) % face.length]];
          if (pA && pB) batch.addSegment(pA.x, pA.y, pA.z, pB.x, pB.y, pB.z, color);
        }
      }
    }

    emitACISSolid(ent, dxf, batch, worldMat, parentContext) {
      const color = this.resolveColor(ent, dxf, parentContext);
      if (ent.satLines && ent.satLines.length > 0) {
        emitReconstructedACIS(ent.satLines, color, batch, worldMat);
      }
    }

    // ==========================================================================
    // HATCH & MPOLYGON (Greedy Edge Stitching + Clockwise Elliptic Arc Fix)
    // ==========================================================================
    emitHatch(ent, dxf, batch, worldMat, parentContext) {
      if (!ent.loops || ent.loops.length === 0) return;
      const color = this.resolveColor(ent, dxf, parentContext);
      const ocsMat = getOCS2WCSMatrix(ent.extrusion);
      const combMat = new THREE.Matrix4().multiplyMatrices(worldMat, ocsMat);
      const zElev = (ent.z || 0) - 0.02;

      const rings = [];
      const pushCleanRing = (rawRing) => {
        const clean = [];
        for (const pt of rawRing) {
          if (!isFinite(pt.x) || !isFinite(pt.y)) continue;
          if (clean.length === 0 || pt.distanceToSquared(clean[clean.length - 1]) > 1e-8) clean.push(pt);
        }
        if (clean.length > 2 && clean[0].distanceToSquared(clean[clean.length - 1]) < 1e-6) clean.pop();
        if (clean.length >= 3) rings.push(clean);
      };

      for (const loop of ent.loops) {
        if (loop.isPolyline && loop.vertices.length >= 2) {
          const ring = [];
          for (let i = 0; i < loop.vertices.length; i++) {
            const v1 = loop.vertices[i], v2 = loop.vertices[(i + 1) % loop.vertices.length];
            const seg = interpolateBulgePoints(v1, v2, v1.bulge, 24);
            for (let k = (i === 0 ? 0 : 1); k < seg.length; k++) ring.push(new THREE.Vector2(seg[k].x, seg[k].y));
          }
          pushCleanRing(ring);
        } else if (loop.edges && loop.edges.length > 0) {
          const edgeChains = [];
          for (const edge of loop.edges) {
            const chain = [];
            if (edge.edgeType === 1) {
              chain.push(new THREE.Vector2(edge.x1 || 0, edge.y1 || 0));
              chain.push(new THREE.Vector2(edge.x2 || 0, edge.y2 || 0));
            } else if (edge.edgeType === 2) {
              const cx = edge.x1 || 0, cy = edge.y1 || 0, r = edge.radius || 1;
              let sa = THREE.MathUtils.degToRad(edge.startAngle || 0);
              let ea = THREE.MathUtils.degToRad(edge.endAngle !== undefined ? edge.endAngle : 360);
              if (edge.ccw !== false) {
                while (ea <= sa) ea += Math.PI * 2;
              } else {
                sa = -sa; ea = -ea;
                while (ea >= sa) ea -= Math.PI * 2;
              }
              for (let s = 0; s <= 24; s++) {
                const a = sa + (ea - sa) * (s / 24);
                chain.push(new THREE.Vector2(cx + r * Math.cos(a), cy + r * Math.sin(a)));
              }
            } else if (edge.edgeType === 3) {
              const cx = edge.x1 || 0, cy = edge.y1 || 0;
              const mx = edge.x2 || 1, my = edge.y2 || 0;
              const ratio = edge.ratio || 0.5;
              const nx = -my * ratio, ny = mx * ratio;
              let sa = THREE.MathUtils.degToRad(edge.startAngle || 0);
              let ea = THREE.MathUtils.degToRad(edge.endAngle !== undefined ? edge.endAngle : 360);
              if (edge.ccw !== false) {
                while (ea <= sa) ea += Math.PI * 2;
              } else {
                sa = -sa; ea = -ea;
                while (ea >= sa) ea -= Math.PI * 2;
              }
              for (let s = 0; s <= 24; s++) {
                const u = sa + (ea - sa) * (s / 24);
                const cu = Math.cos(u), su = Math.sin(u);
                chain.push(new THREE.Vector2(cx + mx * cu + nx * su, cy + my * cu + ny * su));
              }
            } else if (edge.edgeType === 4) {
              if (edge.controlPoints && edge.controlPoints.length >= 2) {
                const sPts = evaluateNurbsSpline(edge.degree || 3, edge.controlPoints, edge.knots, edge.weights, 24);
                sPts.forEach(p => chain.push(new THREE.Vector2(p.x, p.y)));
              } else if (edge.fitPoints && edge.fitPoints.length >= 2) {
                edge.fitPoints.forEach(p => chain.push(new THREE.Vector2(p.x, p.y)));
              }
            }
            if (chain.length >= 2) edgeChains.push(chain);
          }

          // Greedy nearest-endpoint stitching for out-of-order edge chains
          const used = new Array(edgeChains.length).fill(false);
          let curSubRing = [];
          for (let step = 0; step < edgeChains.length; step++) {
            if (curSubRing.length === 0) {
              const firstIdx = used.findIndex(u => !u);
              if (firstIdx === -1) break;
              used[firstIdx] = true;
              const ch = edgeChains[firstIdx].slice();
              for (let k = 0; k < ch.length; k++) curSubRing.push(ch[k]);
            } else {
              const tail = curSubRing[curSubRing.length - 1];
              let bestIdx = -1, bestDist = Infinity, bestReverse = false;
              for (let cIdx = 0; cIdx < edgeChains.length; cIdx++) {
                if (used[cIdx]) continue;
                const cand = edgeChains[cIdx];
                const dStart = tail.distanceToSquared(cand[0]);
                const dEnd = tail.distanceToSquared(cand[cand.length - 1]);
                if (dStart < bestDist) { bestDist = dStart; bestIdx = cIdx; bestReverse = false; }
                if (dEnd < bestDist) { bestDist = dEnd; bestIdx = cIdx; bestReverse = true; }
              }
              if (bestIdx === -1) break;
              used[bestIdx] = true;
              const ch = edgeChains[bestIdx].slice();
              if (bestReverse) ch.reverse();
              for (let k = 0; k < ch.length; k++) curSubRing.push(ch[k]);
            }
            if (curSubRing.length >= 4 && curSubRing[0].distanceToSquared(curSubRing[curSubRing.length - 1]) < 1e-3) {
              pushCleanRing(curSubRing);
              curSubRing = [];
            }
          }
          if (curSubRing.length >= 3) pushCleanRing(curSubRing);
        }
      }

      if (rings.length === 0) return;

      const groups = classifyHatchLoops(rings);
      const patName = normKey(ent.patternName, 'SOLID');
      const isSolid = ent.solidFill === 1 || ent.isGradient || patName === 'SOLID';

      for (const grp of groups) {
        const { outer, holes } = grp;
        try {
          const tris = THREE.ShapeUtils.triangulateShape(outer, holes);
          const allPts = outer.slice();
          for (const h of holes) {
            for (let k = 0; k < h.length; k++) allPts.push(h[k]);
          }
          if (isSolid) {
            for (const [i0, i1, i2] of tris) {
              const p0 = new THREE.Vector3(allPts[i0].x, allPts[i0].y, zElev).applyMatrix4(combMat);
              const p1 = new THREE.Vector3(allPts[i1].x, allPts[i1].y, zElev).applyMatrix4(combMat);
              const p2 = new THREE.Vector3(allPts[i2].x, allPts[i2].y, zElev).applyMatrix4(combMat);
              batch.addTriangle2D(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, color);
            }
          } else {
            const bgTint = this.options.backgroundColor === 'light'
              ? new THREE.Color(color).lerp(new THREE.Color(0xFFFFFF), 0.78).getHex()
              : new THREE.Color(color).lerp(new THREE.Color(0x0F172A), 0.75).getHex();
            for (const [i0, i1, i2] of tris) {
              const p0 = new THREE.Vector3(allPts[i0].x, allPts[i0].y, zElev - 0.01).applyMatrix4(combMat);
              const p1 = new THREE.Vector3(allPts[i1].x, allPts[i1].y, zElev - 0.01).applyMatrix4(combMat);
              const p2 = new THREE.Vector3(allPts[i2].x, allPts[i2].y, zElev - 0.01).applyMatrix4(combMat);
              batch.addTriangle2D(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, bgTint);
            }
          }
        } catch (_) {}

        if (!isSolid) {
          if (ent.patternLines && ent.patternLines.length > 0) {
            const maxLines = Math.min(4, ent.patternLines.length);
            for (let pIdx = 0; pIdx < maxLines; pIdx++) {
              const pl = ent.patternLines[pIdx];
              const angleRad = THREE.MathUtils.degToRad(pl.angle || 0);
              const lineSpacing = Math.hypot(pl.offsetX || 0, pl.offsetY || 0) || (ent.patternScale || 1.0) * 2.5;
              const coords = this.generateClippedHatchCoords(outer, holes, angleRad, lineSpacing, zElev, combMat);
              batch.addSegmentsArray(coords, color);
            }
          } else {
            const baseAngleDeg = 45 + (ent.patternAngle || 0);
            const angleRad = THREE.MathUtils.degToRad(baseAngleDeg);
            const coords1 = this.generateClippedHatchCoords(outer, holes, angleRad, (ent.patternScale || 1.0) * 2.5, zElev, combMat);
            batch.addSegmentsArray(coords1, color);
            if (patName === 'ANSI37' || patName === 'NET' || patName === 'CROSS' || patName === 'BOX') {
              const coords2 = this.generateClippedHatchCoords(outer, holes, angleRad + Math.PI / 2, (ent.patternScale || 1.0) * 2.5, zElev, combMat);
              batch.addSegmentsArray(coords2, color);
            }
          }
        }
      }
    }

    generateClippedHatchCoords(outer, holes, angleRad, rawSpacing, zElev, combMat) {
      const cosA = Math.cos(-angleRad), sinA = Math.sin(-angleRad);
      const cosInv = Math.cos(angleRad), sinInv = Math.sin(angleRad);
      const allRings = [outer, ...holes];
      const rotRings = allRings.map(ring => ring.map(p => ({ x: p.x * cosA - p.y * sinA, y: p.x * sinA + p.y * cosA })));

      let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
      for (const p of rotRings[0]) {
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
      }
      const span = Math.max(maxY - minY, maxX - minX);
      if (!isFinite(span) || span <= 1e-6) return [];

      const step = Math.max(span / 45, Math.min(span / 5, Math.abs(rawSpacing) || (span / 16)));
      const coords = [];
      for (let y = minY + step * 0.5; y < maxY; y += step) {
        const xHits = [];
        for (const ring of rotRings) {
          for (let i = 0; i < ring.length; i++) {
            const p1 = ring[i], p2 = ring[(i + 1) % ring.length];
            if ((p1.y <= y && p2.y > y) || (p2.y <= y && p1.y > y)) {
              xHits.push(p1.x + ((y - p1.y) / (p2.y - p1.y)) * (p2.x - p1.x));
            }
          }
        }
        xHits.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xHits.length; k += 2) {
          const x1 = xHits[k], x2 = xHits[k + 1];
          const v1 = new THREE.Vector3(x1 * cosInv - y * sinInv, x1 * sinInv + y * cosInv, zElev).applyMatrix4(combMat);
          const v2 = new THREE.Vector3(x2 * cosInv - y * sinInv, x2 * sinInv + y * cosInv, zElev).applyMatrix4(combMat);
          coords.push(v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
        }
      }
      return coords;
    }

    // ==========================================================================
    // Solid Filled 2D Text, MTEXT, ARCTEXT, ACAD_TABLE
    // ==========================================================================
    emitText(ent, dxf, batch, textAtlas, worldMat, originShift, parentContext) {
      if (ent.type === 'ATTDEF') return;
      if ((ent.flags & 1) && ent.type === 'ATTRIB') return;
      const raw = ent.text;
      if (!raw || String(raw).trim() === '') return;
      const text = decodeMIFAndSpecialChars(raw);
      const styleDef = dxf.tables.styles[normKey(ent.textStyle, 'STANDARD')] || {};
      let height = (ent.height !== undefined && ent.height > 0)
        ? ent.height
        : ((styleDef.height && styleDef.height > 0) ? styleDef.height : (dxf.header['$TEXTSIZE'] || 2.5));
      let widthFactor = (ent.xscale !== undefined && ent.xscale > 0)
        ? ent.xscale
        : ((styleDef.widthFactor && styleDef.widthFactor > 0) ? styleDef.widthFactor : 1.0);
      const obliqueDeg = ent.oblique !== undefined ? ent.oblique : (styleDef.obliqueAngle || 0);
      let rotRad = THREE.MathUtils.degToRad(ent.rotation || 0);
      const color = this.resolveColor(ent, dxf, parentContext);

      let halign = ent.halign || 0;
      const valign = ent.valign || 0;
      const ocsMat = getOCS2WCSMatrix(ent.extrusion);

      let basePt;
      if ((halign === 3 || halign === 5) && ent.x1 !== undefined && ent.y1 !== undefined) {
        const p1 = new THREE.Vector3(ent.x || 0, ent.y || 0, ent.z || 0);
        const p2 = new THREE.Vector3(ent.x1 || 0, ent.y1 || 0, ent.z1 !== undefined ? ent.z1 : (ent.z || 0));
        const span = p1.distanceTo(p2);
        rotRad = Math.atan2(p2.y - p1.y, p2.x - p1.x);
        basePt = p1.clone().add(p2).multiplyScalar(0.5);
        halign = 1;
        const estW = Math.max(1, text.length * height * 0.65);
        if (ent.halign === 5 && span > 1e-4) widthFactor = Math.max(0.2, Math.min(2.5, span / estW));
        else if (ent.halign === 3 && span > 1e-4) height = height * Math.max(0.2, Math.min(2.5, span / estW));
      } else {
        const hasSecondPt = (halign !== 0 || valign !== 0) && ent.x1 !== undefined && ent.y1 !== undefined &&
          !(Math.abs(ent.x1) < 1e-7 && Math.abs(ent.y1) < 1e-7 && Math.hypot(ent.x || 0, ent.y || 0) > 50);
        basePt = hasSecondPt
          ? new THREE.Vector3(ent.x1, ent.y1, ent.z1 !== undefined ? ent.z1 : (ent.z || 0))
          : new THREE.Vector3(ent.x || 0, ent.y || 0, ent.z || 0);
      }

      const localMat = new THREE.Matrix4()
        .makeTranslation(basePt.x, basePt.y, basePt.z)
        .multiply(new THREE.Matrix4().makeRotationZ(rotRad));
      if (ent.textGenFlags & 2) localMat.scale(new THREE.Vector3(-1, 1, 1));
      if (ent.textGenFlags & 4) localMat.scale(new THREE.Vector3(1, -1, 1));

      const finalMat = new THREE.Matrix4().multiplyMatrices(worldMat, ocsMat).multiply(localMat);

      textAtlas.addRichTextQuad(
        [[{ type: 'text', text, style: { scale: 1, widthFactor, oblique: obliqueDeg } }]],
        height, color, halign, valign, finalMat, originShift
      );
    }

    emitArcText(ent, dxf, batch, textAtlas, worldMat, originShift, parentContext) {
      const text = decodeMIFAndSpecialChars(ent.text || '');
      if (!text) return;
      const cx = ent.x || 0, cy = ent.y || 0, cz = ent.z || 0;
      const r = ent.r || 20;
      const h = ent.height || 2.5;
      const sa = THREE.MathUtils.degToRad(ent.startAngle || 30);
      const ea = THREE.MathUtils.degToRad(ent.endAngle || 150);
      const color = this.resolveColor(ent, dxf, parentContext);
      const ocsMat = getOCS2WCSMatrix(ent.extrusion);
      const combMat = new THREE.Matrix4().multiplyMatrices(worldMat, ocsMat);
      const chars = Array.from(text);

      chars.forEach((ch, idx) => {
        const t = chars.length > 1 ? idx / (chars.length - 1) : 0.5;
        const ang = ea - (ea - sa) * t;
        const px = cx + r * Math.cos(ang), py = cy + r * Math.sin(ang);
        const charMat = new THREE.Matrix4()
          .multiplyMatrices(combMat, new THREE.Matrix4().makeTranslation(px, py, cz))
          .multiply(new THREE.Matrix4().makeRotationZ(ang - Math.PI / 2));
        textAtlas.addRichTextQuad(
          [[{ type: 'text', text: ch, style: { scale: 1, widthFactor: 0.85, oblique: 0 } }]],
          h, color, 1, 0, charMat, originShift
        );
      });
    }

    emitMText(ent, dxf, batch, textAtlas, worldMat, originShift, parentContext) {
      const raw = ent.text;
      if (!raw || String(raw).trim() === '') return;
      const styleDef = dxf.tables.styles[normKey(ent.textStyle, 'STANDARD')] || {};
      const height = (ent.height !== undefined && ent.height > 0)
        ? ent.height
        : ((styleDef.height && styleDef.height > 0) ? styleDef.height : (dxf.header['$TEXTSIZE'] || 2.5));
      const defWf = (styleDef.widthFactor && styleDef.widthFactor > 0) ? styleDef.widthFactor : 1.0;
      const defOblique = styleDef.obliqueAngle || 0;
      const color = this.resolveColor(ent, dxf, parentContext);
      const lines = parseMTextRichTokens(raw, defWf, defOblique);

      const ap = (ent.attachmentPoint >= 1 && ent.attachmentPoint <= 9) ? ent.attachmentPoint : 1;
      const halign = (ap - 1) % 3;
      const vRow = Math.floor((ap - 1) / 3);
      const valign = vRow === 0 ? 3 : (vRow === 1 ? 2 : 1);

      let rotRad = THREE.MathUtils.degToRad(ent.rotation || 0);
      if (ent.x1 !== undefined && ent.y1 !== undefined && (Math.abs(ent.x1) > 1e-6 || Math.abs(ent.y1) > 1e-6)) {
        rotRad = Math.atan2(ent.y1, ent.x1);
      }

      const localMat = new THREE.Matrix4()
        .makeTranslation(ent.x || 0, ent.y || 0, ent.z || 0)
        .multiply(new THREE.Matrix4().makeRotationZ(rotRad));
      const finalMat = new THREE.Matrix4().multiplyMatrices(worldMat, localMat);

      let bgMask = null;
      if (ent.bgFillFlags & 1) {
        if (ent.bgTrueColor !== null && ent.bgTrueColor !== undefined) bgMask = ent.bgTrueColor & 0xFFFFFF;
        else if (ent.bgColorIndex) bgMask = ACI_PALETTE[Math.abs(ent.bgColorIndex)] || null;
      } else if (ent.bgFillFlags & 2) {
        bgMask = this.options.backgroundColor === 'light' ? 0xFFFFFF : 0x0F172A;
      }

      textAtlas.addRichTextQuad(lines, height, color, halign, valign, finalMat, originShift, bgMask, ent.refWidth || 0);
    }

    emitAcadTable(ent, dxf, batch, textAtlas, worldMat, originShift, parentContext) {
      const rows = Math.max(1, ent.numRows || (ent.rowHeights ? ent.rowHeights.length : 2));
      const cols = Math.max(1, ent.numCols || (ent.colWidths ? ent.colWidths.length : 3));
      const rHeights = [];
      for (let r = 0; r < rows; r++) rHeights.push(ent.rowHeights[r] || 8.0);
      const cWidths = [];
      for (let c = 0; c < cols; c++) cWidths.push(ent.colWidths[c] || 24.0);

      const ox = ent.x || 0, oy = ent.y || 0, oz = ent.z || 0;
      const color = this.resolveColor(ent, dxf, parentContext);
      const totalW = cWidths.reduce((a, b) => a + b, 0);
      const totalH = rHeights.reduce((a, b) => a + b, 0);

      if (rows >= 1) {
        const hdrH = rHeights[0];
        const a = new THREE.Vector3(ox, oy, oz - 0.02).applyMatrix4(worldMat);
        const b = new THREE.Vector3(ox + totalW, oy, oz - 0.02).applyMatrix4(worldMat);
        const c = new THREE.Vector3(ox + totalW, oy - hdrH, oz - 0.02).applyMatrix4(worldMat);
        const d = new THREE.Vector3(ox, oy - hdrH, oz - 0.02).applyMatrix4(worldMat);
        const hdrColor = this.options.backgroundColor === 'light' ? 0xE2E8F0 : 0x1E293B;
        batch.addTriangle2D(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, hdrColor);
        batch.addTriangle2D(a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z, hdrColor);
      }

      let curY = oy;
      for (let r = 0; r <= rows; r++) {
        const p1 = new THREE.Vector3(ox, curY, oz).applyMatrix4(worldMat);
        const p2 = new THREE.Vector3(ox + totalW, curY, oz).applyMatrix4(worldMat);
        batch.addSegment(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, color);
        if (r < rows) curY -= rHeights[r];
      }
      let curX = ox;
      for (let c = 0; c <= cols; c++) {
        const p1 = new THREE.Vector3(curX, oy, oz).applyMatrix4(worldMat);
        const p2 = new THREE.Vector3(curX, oy - totalH, oz).applyMatrix4(worldMat);
        batch.addSegment(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, color);
        if (c < cols) curX += cWidths[c];
      }

      let cellIdx = 0, rowTop = oy;
      for (let r = 0; r < rows; r++) {
        const rh = rHeights[r];
        let colLeft = ox;
        for (let c = 0; c < cols; c++) {
          const cw = cWidths[c];
          const cell = ent.cells[cellIdx++];
          if (cell && cell.text && String(cell.text).trim() !== '') {
            const cx = colLeft + cw * 0.5, cy = rowTop - rh * 0.5;
            const th = Math.min(rh * 0.42, cell.textHeight || 2.3);
            this.emitLabelHelper(String(cell.text).trim(), th, color, cx, cy, oz, 0, batch, textAtlas, worldMat, originShift);
          }
          colLeft += cw;
        }
        rowTop -= rh;
      }
    }

    // ==========================================================================
    // Dimensions, Leaders, MLeaders & GD&T Tolerances
    // ==========================================================================
    emitLabelHelper(labelStr, txtHeight, colorHex, x, y, z, rotRad, batch, textAtlas, worldMat, originShift) {
      const mat = new THREE.Matrix4()
        .multiplyMatrices(worldMat, new THREE.Matrix4().makeTranslation(x, y, z))
        .multiply(new THREE.Matrix4().makeRotationZ(rotRad));
      const lines = parseMTextRichTokens(labelStr, 0.85, 0);
      textAtlas.addRichTextQuad(lines, txtHeight, colorHex, 1, 2, mat, originShift);
    }

    emitArrowhead(tip, dirUnit, arrowSize, colorHex, batch, worldMat, arrowType = 'CLOSED') {
      const back = dirUnit.clone().negate();
      const perp = new THREE.Vector3(-dirUnit.y, dirUnit.x, 0).multiplyScalar(arrowSize * 0.18);
      const base = tip.clone().addScaledVector(back, arrowSize);
      const tTip = tip.clone().applyMatrix4(worldMat);

      if (arrowType.includes('TICK') || arrowType.includes('OBLIQUE')) {
        const diag = dirUnit.clone().add(new THREE.Vector3(-dirUnit.y, dirUnit.x, 0)).normalize().multiplyScalar(arrowSize * 0.5);
        const a = tip.clone().sub(diag).applyMatrix4(worldMat);
        const b = tip.clone().add(diag).applyMatrix4(worldMat);
        batch.addSegment(a.x, a.y, a.z, b.x, b.y, b.z, colorHex);
        return;
      }

      const p1 = base.clone().add(perp).applyMatrix4(worldMat);
      const p2 = base.clone().sub(perp).applyMatrix4(worldMat);
      batch.addTriangle2D(tTip.x, tTip.y, tTip.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, colorHex);
      batch.addSegment(tTip.x, tTip.y, tTip.z, p1.x, p1.y, p1.z, colorHex);
      batch.addSegment(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, colorHex);
      batch.addSegment(p2.x, p2.y, p2.z, tTip.x, tTip.y, tTip.z, colorHex);
    }

    emitDimension(ent, dxf, getCollector, batch, textAtlas, worldMat, originShift, parentContext, depth, stats) {
      const ocsMat = getOCS2WCSMatrix(ent.extrusion);

      // 1. Native AutoCAD Anonymous Dimension Block (*D<n>)
      if (this.options.dimensionMode === 'auto' && ent.name && dxf.blocks[ent.name]) {
        const blk = dxf.blocks[ent.name];
        const hasVisibleGeom = (blk.entities || []).some(e => e.type !== 'POINT' && e.type !== 'ATTDEF');
        if (hasVisibleGeom) {
          // Group (12, 22, 32) is the clone insertion offset in the DIMENSION's OCS,
          // while internal *D<n> entities already carry their own WCS/OCS geometry.
          const cloneOffset = new THREE.Vector3(ent.x2 || 0, ent.y2 || 0, ent.z2 || 0).applyMatrix4(ocsMat);
          this.emitBlockInstance(
            blk,
            {
              x: cloneOffset.x, y: cloneOffset.y, z: cloneOffset.z,
              xscale: 1, yscale: 1, zscale: 1, rotation: 0,
              layer: ent.layer, colorIndex: ent.colorIndex, linetype: ent.linetype,
              extrusion: { x: 0, y: 0, z: 1 }
            },
            dxf, getCollector, batch, textAtlas, worldMat, originShift, parentContext, depth + 1, stats
          );
          return;
        }
      }

      // 2. Procedural Dimension Synthesis
      const baseDs = dxf.tables.dimstyles[normKey(ent.styleName, 'STANDARD')] || dxf.tables.dimstyles['STANDARD'] || {};
      const ov = ent.dimOverrides || {};
      const dimscale = ov[40] !== undefined ? ov[40] : (baseDs.dimscale !== undefined ? baseDs.dimscale : (dxf.header['$DIMSCALE'] || 1.0));
      const arrowSize = (ov[41] !== undefined ? ov[41] : (baseDs.dimasz !== undefined ? baseDs.dimasz : (dxf.header['$DIMASZ'] || 2.5))) * dimscale;
      const txtHeight = (ov[140] !== undefined ? ov[140] : (baseDs.dimtxt !== undefined ? baseDs.dimtxt : (dxf.header['$DIMTXT'] || 2.5))) * dimscale;
      const exo = (ov[42] !== undefined ? ov[42] : (baseDs.dimexo !== undefined ? baseDs.dimexo : (dxf.header['$DIMEXO'] || 0.625))) * dimscale;
      const exe = (ov[44] !== undefined ? ov[44] : (baseDs.dimexe !== undefined ? baseDs.dimexe : (dxf.header['$DIMEXE'] || 1.25))) * dimscale;
      const gap = (ov[147] !== undefined ? ov[147] : (baseDs.dimgap !== undefined ? baseDs.dimgap : (dxf.header['$DIMGAP'] || 0.625))) * dimscale;
      const lfac = ov[144] !== undefined ? ov[144] : (baseDs.dimlfac !== undefined ? baseDs.dimlfac : (dxf.header['$DIMLFAC'] || 1.0));
      const dec = ov[271] !== undefined ? ov[271] : (baseDs.dimdec !== undefined ? baseDs.dimdec : (dxf.header['$DIMDEC'] !== undefined ? dxf.header['$DIMDEC'] : 2));
      const color = this.resolveColor(ent, dxf, parentContext);
      const arrowBlkName = normKey(baseDs.dimblk || (baseDs.arrowBlockHandle && dxf.tables.blockRecords[baseDs.arrowBlockHandle]) || '', '');

      const dimType = (ent.flags || 0) & 7;
      const formatDimText = (val, prefix = '', suffix = '') => {
        const scaledVal = val * Math.abs(lfac || 1.0);
        if (ent.text && ent.text.trim() !== '' && ent.text.trim() !== '<>') {
          return decodeMIFAndSpecialChars(ent.text.replace(/<>/g, `${prefix}${scaledVal.toFixed(dec)}${suffix}`));
        }
        return `${prefix}${scaledVal.toFixed(dec)}${suffix}`;
      };

      const addWSeg = (a, b) => {
        const wa = a.clone().applyMatrix4(worldMat);
        const wb = b.clone().applyMatrix4(worldMat);
        batch.addSegment(wa.x, wa.y, wa.z, wb.x, wb.y, wb.z, color);
      };

      if (dimType === 0 || dimType === 1) {
        const p1 = new THREE.Vector3(ent.x3 || 0, ent.y3 || 0, ent.z3 || 0);
        const p2 = new THREE.Vector3(ent.x4 || 0, ent.y4 || 0, ent.z4 || 0);
        const defPt = new THREE.Vector3(ent.x || 0, ent.y || 0, ent.z || 0);
        let dimDir;
        if (dimType === 0) {
          const effRotDeg = (ent.rotation || 0) - (ent.horizontalDir || 0);
          const rotRad = THREE.MathUtils.degToRad(effRotDeg);
          dimDir = new THREE.Vector3(Math.cos(rotRad), Math.sin(rotRad), 0).transformDirection(ocsMat).normalize();
        } else {
          dimDir = new THREE.Vector3().subVectors(p2, p1);
          if (dimDir.lengthSq() < 1e-9) dimDir.set(1, 0, 0);
          dimDir.normalize();
        }
        const extNormal = new THREE.Vector3(-dimDir.y, dimDir.x, 0);
        const d1 = defPt.clone().addScaledVector(dimDir, new THREE.Vector3().subVectors(p1, defPt).dot(dimDir));
        const d2 = defPt.clone().addScaledVector(dimDir, new THREE.Vector3().subVectors(p2, defPt).dot(dimDir));

        const sign1 = new THREE.Vector3().subVectors(d1, p1).dot(extNormal) >= 0 ? 1 : -1;
        addWSeg(p1.clone().addScaledVector(extNormal, sign1 * exo), d1.clone().addScaledVector(extNormal, sign1 * exe));
        const sign2 = new THREE.Vector3().subVectors(d2, p2).dot(extNormal) >= 0 ? 1 : -1;
        addWSeg(p2.clone().addScaledVector(extNormal, sign2 * exo), d2.clone().addScaledVector(extNormal, sign2 * exe));
        addWSeg(d1, d2);

        const spanVec = new THREE.Vector3().subVectors(d2, d1);
        const measurement = ent.actualMeasurement || spanVec.length();
        const unitSpan = spanVec.length() > 1e-8 ? spanVec.clone().normalize() : dimDir.clone();
        this.emitArrowhead(d1, unitSpan.clone().negate(), arrowSize, color, batch, worldMat, arrowBlkName);
        this.emitArrowhead(d2, unitSpan, arrowSize, color, batch, worldMat, arrowBlkName);

        const midPt = (ent.x1 !== undefined && ent.y1 !== undefined && (Math.abs(ent.x1) > 1e-5 || Math.abs(ent.y1) > 1e-5))
          ? new THREE.Vector3(ent.x1, ent.y1, ent.z1 || 0).applyMatrix4(ocsMat)
          : new THREE.Vector3().addVectors(d1, d2).multiplyScalar(0.5).addScaledVector(extNormal, gap + txtHeight * 0.5);
        let textAngle = Math.atan2(unitSpan.y, unitSpan.x);
        if (textAngle > Math.PI * 0.5 || textAngle <= -Math.PI * 0.5) textAngle += Math.PI;
        this.emitLabelHelper(formatDimText(measurement), txtHeight, color, midPt.x, midPt.y, midPt.z, textAngle, batch, textAtlas, worldMat, originShift);
      } else if (dimType === 3 || dimType === 4) {
        const pt10 = new THREE.Vector3(ent.x || 0, ent.y || 0, ent.z || 0);
        const pt15 = new THREE.Vector3(ent.x5 !== undefined ? ent.x5 : (pt10.x + 10), ent.y5 !== undefined ? ent.y5 : pt10.y, ent.z5 || 0);
        const spanVec = new THREE.Vector3().subVectors(pt15, pt10);
        const dist = spanVec.length() || 10;
        const unitR = spanVec.clone().normalize();
        addWSeg(pt10, pt15);
        this.emitArrowhead(pt15, unitR, arrowSize, color, batch, worldMat, arrowBlkName);
        if (dimType === 3) this.emitArrowhead(pt10, unitR.clone().negate(), arrowSize, color, batch, worldMat, arrowBlkName);

        const prefix = dimType === 3 ? '⌀' : 'R';
        const measured = ent.actualMeasurement || dist;
        const txtPos = (ent.x1 !== undefined && ent.y1 !== undefined && (Math.abs(ent.x1) > 1e-5 || Math.abs(ent.y1) > 1e-5))
          ? new THREE.Vector3(ent.x1, ent.y1, ent.z1 || 0).applyMatrix4(ocsMat)
          : pt10.clone().addScaledVector(unitR, dist * 0.55);
        let textAngle = Math.atan2(unitR.y, unitR.x);
        if (textAngle > Math.PI * 0.5 || textAngle <= -Math.PI * 0.5) textAngle += Math.PI;
        const perp = new THREE.Vector3(-Math.sin(textAngle), Math.cos(textAngle), 0);
        const finalPos = txtPos.clone().addScaledVector(perp, gap + txtHeight * 0.45);
        this.emitLabelHelper(formatDimText(measured, prefix), txtHeight, color, finalPos.x, finalPos.y, finalPos.z, textAngle, batch, textAtlas, worldMat, originShift);
      } else if (dimType === 2 || dimType === 5) {
        let vertex, p1, p2, arcPt;
        if (dimType === 5) {
          // 3-Point Angular Dimension: (x5,y5) is vertex, (x3,y3) and (x4,y4) are endpoints, (x,y) is arc point
          vertex = new THREE.Vector3(ent.x5 !== undefined ? ent.x5 : 0, ent.y5 !== undefined ? ent.y5 : 0, 0);
          p1 = new THREE.Vector3(ent.x3 !== undefined ? ent.x3 : (vertex.x + 10), ent.y3 !== undefined ? ent.y3 : vertex.y, 0);
          p2 = new THREE.Vector3(ent.x4 !== undefined ? ent.x4 : vertex.x, ent.y4 !== undefined ? ent.y4 : (vertex.y + 10), 0);
          arcPt = new THREE.Vector3(ent.x || 0, ent.y || 0, 0);
        } else {
          // 2-Line Angular Dimension: Line 1 is (x3,y3)->(x4,y4), Line 2 is (x5,y5)->(x,y), ArcPt is (x6,y6)
          const l1A = new THREE.Vector3(ent.x3 !== undefined ? ent.x3 : 0, ent.y3 !== undefined ? ent.y3 : 0, 0);
          const l1B = new THREE.Vector3(ent.x4 !== undefined ? ent.x4 : 10, ent.y4 !== undefined ? ent.y4 : 0, 0);
          const l2A = new THREE.Vector3(ent.x5 !== undefined ? ent.x5 : 0, ent.y5 !== undefined ? ent.y5 : 0, 0);
          const l2B = new THREE.Vector3(ent.x !== undefined ? ent.x : 0, ent.y !== undefined ? ent.y : 10, 0);
          const d1x = l1B.x - l1A.x, d1y = l1B.y - l1A.y;
          const d2x = l2B.x - l2A.x, d2y = l2B.y - l2A.y;
          const denom = d1x * d2y - d1y * d2x;
          if (Math.abs(denom) > 1e-7) {
            const t = ((l2A.x - l1A.x) * d2y - (l2A.y - l1A.y) * d2x) / denom;
            vertex = new THREE.Vector3(l1A.x + t * d1x, l1A.y + t * d1y, 0);
          } else {
            vertex = l1A.clone();
          }
          p1 = l1B.distanceToSquared(vertex) > l1A.distanceToSquared(vertex) ? l1B : l1A;
          p2 = l2B.distanceToSquared(vertex) > l2A.distanceToSquared(vertex) ? l2B : l2A;
          arcPt = (ent.x6 !== undefined && ent.y6 !== undefined)
            ? new THREE.Vector3(ent.x6, ent.y6, ent.z6 || 0).applyMatrix4(ocsMat)
            : new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
        }
        const rArc = Math.max(2, arcPt.distanceTo(vertex));
        let a1 = Math.atan2(p1.y - vertex.y, p1.x - vertex.x);
        let a2 = Math.atan2(p2.y - vertex.y, p2.x - vertex.x);
        while (a2 <= a1) a2 += Math.PI * 2;
        if (a2 - a1 > Math.PI) { const tmp = a1; a1 = a2; a2 = tmp + Math.PI * 2; }
        const sweep = a2 - a1;
        const steps = 24;
        const arcPts = [];
        for (let i = 0; i <= steps; i++) {
          const a = a1 + sweep * (i / steps);
          arcPts.push(new THREE.Vector3(vertex.x + rArc * Math.cos(a), vertex.y + rArc * Math.sin(a), 0));
        }
        this.emitPolylineToBatch(arcPts, ent, dxf, batch, worldMat, parentContext, false, color, false);
        addWSeg(vertex.clone().addScaledVector(new THREE.Vector3(Math.cos(a1), Math.sin(a1), 0), exo), arcPts[0].clone().addScaledVector(new THREE.Vector3(Math.cos(a1), Math.sin(a1), 0), exe));
        addWSeg(vertex.clone().addScaledVector(new THREE.Vector3(Math.cos(a2), Math.sin(a2), 0), exo), arcPts[steps].clone().addScaledVector(new THREE.Vector3(Math.cos(a2), Math.sin(a2), 0), exe));
        this.emitArrowhead(arcPts[0], new THREE.Vector3(Math.sin(a1), -Math.cos(a1), 0), arrowSize, color, batch, worldMat, arrowBlkName);
        this.emitArrowhead(arcPts[steps], new THREE.Vector3(-Math.sin(a2), Math.cos(a2), 0), arrowSize, color, batch, worldMat, arrowBlkName);

        const midA = a1 + sweep * 0.5;
        this.emitLabelHelper(
          formatDimText(THREE.MathUtils.radToDeg(sweep), '', '°'),
          txtHeight, color,
          vertex.x + (rArc + gap + txtHeight * 0.55) * Math.cos(midA),
          vertex.y + (rArc + gap + txtHeight * 0.55) * Math.sin(midA),
          0, 0, batch, textAtlas, worldMat, originShift
        );
      } else if (dimType === 6) {
        const datumOrigin = new THREE.Vector3(ent.x || 0, ent.y || 0, ent.z || 0);
        const featurePt = new THREE.Vector3(ent.x3 || 0, ent.y3 || 0, ent.z3 || 0);
        const leaderEnd = new THREE.Vector3(ent.x4 !== undefined ? ent.x4 : (featurePt.x + 10), ent.y4 !== undefined ? ent.y4 : (featurePt.y + 10), ent.z4 || 0);
        const isXDatum = ((ent.flags || 0) & 64) !== 0;
        const jogPt = isXDatum
          ? new THREE.Vector3(featurePt.x, leaderEnd.y - Math.sign(leaderEnd.y - featurePt.y || 1) * arrowSize, 0)
          : new THREE.Vector3(leaderEnd.x - Math.sign(leaderEnd.x - featurePt.x || 1) * arrowSize, featurePt.y, 0);
        this.emitPolylineToBatch([featurePt, jogPt, leaderEnd], ent, dxf, batch, worldMat, parentContext, false, color, false);
        const val = ent.actualMeasurement !== undefined
          ? ent.actualMeasurement
          : (isXDatum ? Math.abs(featurePt.x - datumOrigin.x) : Math.abs(featurePt.y - datumOrigin.y));
        this.emitLabelHelper(formatDimText(val), txtHeight, color, leaderEnd.x + txtHeight, leaderEnd.y + txtHeight * 0.4, 0, 0, batch, textAtlas, worldMat, originShift);
      }
    }

    emitLeader(ent, dxf, batch, worldMat, parentContext) {
      const verts = ent.vertices || [];
      if (verts.length < 2) return;
      const color = this.resolveColor(ent, dxf, parentContext);
      const ds = dxf.tables.dimstyles[normKey(ent.dimstyle, 'STANDARD')] || {};
      const arrowSize = (ds.dimasz || dxf.header['$DIMASZ'] || 2.5) * (ds.dimscale || dxf.header['$DIMSCALE'] || 1.0);
      const pts = verts.map(v => new THREE.Vector3(v.x, v.y, v.z || 0));
      this.emitPolylineToBatch(pts, ent, dxf, batch, worldMat, parentContext, false, color, false);
      if (ent.hasArrow !== false) {
        const dir = new THREE.Vector3().subVectors(pts[0], pts[1]).normalize();
        this.emitArrowhead(pts[0], dir, arrowSize, color, batch, worldMat);
      }
    }

    emitMLeader(ent, dxf, batch, textAtlas, worldMat, originShift, parentContext) {
      const color = this.resolveColor(ent, dxf, parentContext);
      const arrowSize = ent.arrowSize || 2.5;
      const txtH = ent.textHeight || 2.5;

      for (const branch of (ent.leaderBranches || [])) {
        if (branch.length >= 2) {
          const pts = branch.map(v => new THREE.Vector3(v.x, v.y, v.z || 0));
          if (ent.landingPt) pts.push(new THREE.Vector3(ent.landingPt.x, ent.landingPt.y, ent.landingPt.z || 0));
          this.emitPolylineToBatch(pts, ent, dxf, batch, worldMat, parentContext, false, color, false);
          const dir = new THREE.Vector3().subVectors(pts[0], pts[1]).normalize();
          this.emitArrowhead(pts[0], dir, arrowSize, color, batch, worldMat);
        }
      }

      if (ent.text) {
        const tp = ent.textPos || ent.landingPt || (ent.leaderBranches[0] && ent.leaderBranches[0][ent.leaderBranches[0].length - 1]) || { x: 0, y: 0, z: 0 };
        const mat = new THREE.Matrix4().multiplyMatrices(worldMat, new THREE.Matrix4().makeTranslation(tp.x + txtH * 0.4, tp.y, tp.z || 0));
        const lines = parseMTextRichTokens(ent.text, 0.85, 0);
        textAtlas.addRichTextQuad(lines, txtH, color, 0, 2, mat, originShift);
      }
    }

    emitTolerance(ent, dxf, batch, textAtlas, worldMat, originShift, parentContext) {
      const raw = ent.text || '⌖%%v⌀0.02%%vA%%vB';
      const cleaned = decodeMIFAndSpecialChars(raw).replace(/\{|\}/g, '');
      const cells = cleaned.split(/%%v/i).filter(Boolean);
      const h = (ent.height !== undefined && ent.height > 0) ? ent.height : (dxf.header['$DIMTXT'] || 2.5);
      const boxH = h * 1.8;
      const color = this.resolveColor(ent, dxf, parentContext);
      const ox = ent.x || 0, oy = ent.y || 0, oz = ent.z || 0;

      let curX = ox;
      for (const cellText of cells) {
        const cellW = Math.max(boxH, cellText.length * h * 0.78 + h * 0.6);
        const p0 = new THREE.Vector3(curX, oy - boxH * 0.5, oz);
        const p1 = new THREE.Vector3(curX + cellW, oy - boxH * 0.5, oz);
        const p2 = new THREE.Vector3(curX + cellW, oy + boxH * 0.5, oz);
        const p3 = new THREE.Vector3(curX, oy + boxH * 0.5, oz);
        this.emitPolylineToBatch([p0, p1, p2, p3], ent, dxf, batch, worldMat, parentContext, true, color, false);
        this.emitLabelHelper(cellText, h * 0.88, color, curX + cellW * 0.5, oy, oz, 0, batch, textAtlas, worldMat, originShift);
        curX += cellW;
      }
    }

    emitInsert(ent, dxf, getCollector, batch, textAtlas, worldMat, originShift, parentContext, depth, stats) {
      const blk = dxf.blocks[normKey(ent.name, '')];
      if (!blk) return;
      this.emitBlockInstance(blk, ent, dxf, getCollector, batch, textAtlas, worldMat, originShift, parentContext, depth + 1, stats);

      if (ent.attribs && ent.attribs.length > 0) {
        const childCtx = {
          layer: normKey(ent.layer, '0'),
          colorHex: this.resolveColor(ent, dxf, parentContext),
          linetype: normKey(ent.linetype, 'BYLAYER')
        };
        for (const attr of ent.attribs) {
          if (attr.visible === false || (attr.flags & 1)) continue;
          const attrBatch = getCollector ? getCollector(attr.layer === '0' ? childCtx.layer : attr.layer) : batch;
          this.emitText(attr, dxf, attrBatch, textAtlas, worldMat, originShift, childCtx);
        }
      }
    }

    emitBlockInstance(blk, insertEnt, dxf, getCollector, batch, textAtlas, worldMat, originShift, parentContext, depth, stats) {
      const effectiveInsertLayer = (normKey(insertEnt.layer, '0') === '0' && parentContext && parentContext.layer)
        ? parentContext.layer
        : normKey(insertEnt.layer, '0');

      const childContext = {
        layer: effectiveInsertLayer,
        colorHex: this.resolveColor(insertEnt, dxf, parentContext),
        linetype: normKey(insertEnt.linetype, 'BYLAYER')
      };

      const colSpacing = insertEnt.colSpacing || 0;
      const rowSpacing = insertEnt.rowSpacing || 0;
      const colCount = Math.abs(colSpacing) > 1e-7 ? Math.max(1, Math.min(100, insertEnt.colCount || 1)) : 1;
      const rowCount = Math.abs(rowSpacing) > 1e-7 ? Math.max(1, Math.min(100, insertEnt.rowCount || 1)) : 1;
      const sx = insertEnt.xscale !== undefined ? insertEnt.xscale : 1.0;
      const sy = insertEnt.yscale !== undefined ? insertEnt.yscale : 1.0;
      const sz = insertEnt.zscale !== undefined ? insertEnt.zscale : 1.0;
      const rotRad = THREE.MathUtils.degToRad(insertEnt.rotation || 0);
      const ocsMat = getOCS2WCSMatrix(insertEnt.extrusion);
      const bp = blk.basePoint || { x: 0, y: 0, z: 0 };
      const bpTrans = new THREE.Matrix4().makeTranslation(-bp.x, -bp.y, -bp.z);
      const scaleMat = new THREE.Matrix4().makeScale(sx, sy, sz);
      const rotMat = new THREE.Matrix4().makeRotationZ(rotRad);
      const isDimBlock = blk.name && blk.name.startsWith('*D');

      for (let r = 0; r < rowCount; r++) {
        for (let c = 0; c < colCount; c++) {
          const offset = new THREE.Vector3(c * colSpacing, r * rowSpacing, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), rotRad);
          const transMat = new THREE.Matrix4().makeTranslation(
            (insertEnt.x || 0) + offset.x,
            (insertEnt.y || 0) + offset.y,
            (insertEnt.z || 0) + offset.z
          );
          const instMat = new THREE.Matrix4()
            .multiplyMatrices(worldMat, ocsMat)
            .multiply(transMat)
            .multiply(rotMat)
            .multiply(scaleMat)
            .multiply(bpTrans);

          for (const childEnt of blk.entities) {
            if (childEnt.type === 'ATTDEF' || childEnt.visible === false || childEnt.type === 'VIEWPORT') continue;
            if (isDimBlock && childEnt.type === 'POINT') continue;
            const childLayerKey = normKey(childEnt.layer, '0') === '0' ? effectiveInsertLayer : normKey(childEnt.layer, '0');
            const targetBatch = getCollector ? getCollector(childLayerKey) : batch;
            this.emitEntity(childEnt, dxf, getCollector, targetBatch, textAtlas, instMat, originShift, childContext, depth, stats);
          }
        }
      }
    }
  }

  DXFLoader.ACI_PALETTE = ACI_PALETTE;
  DXFLoader.DXFParser = DXFParser;
  DXFLoader.MultiPageTextAtlas = MultiPageTextAtlas;
  DXFLoader.Float32GrowableBuffer = Float32GrowableBuffer;
  DXFLoader.decodeDXFArrayBuffer = decodeDXFArrayBuffer;

  return DXFLoader;
});
