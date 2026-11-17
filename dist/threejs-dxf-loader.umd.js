/**
 * @license MIT
 * THREE.DXFLoader v1.0.0 (Core Engine v9.0)
 * Complete, High-Performance 2D & 3D AutoCAD DXF Parser and Renderer for Three.js
 *
 * Author: zhangly1403 <zhangly1403@qq.com>
 * Repository: https://github.com/zhangly1403/three-dxf-loader
 */
/**
 * THREE.DXFLoader v8.0 — Production-Grade 2D/3D AutoCAD DXF Loader for Three.js
 *
 * Key Upgrades in v8.0:
 *  1. High-Contrast White/Dark Background Adaptation & Instant <1ms Theme Switching:
 *     - Precomputes dual vertex color buffers (`lightColors` with automatic high-luminance darkening
 *       for yellow/cyan/lime/white entities on white backgrounds, and `darkColors` for dark/black
 *       backgrounds). Calling `DXFLoader.applyBackgroundTheme(rootGroup, theme)` swaps vertex color
 *       buffers in <1ms without re-parsing or re-rasterizing the DXF!
 *  2. Zero-Clip Solid Filled Text & Closest System Font Mapping (`mapCADFontToSystemFont`):
 *     - Maps AutoCAD SHX/TTF font names (`gbenor`, `gbcbig`, `hztxt`, `tssdeng`, `fangsong`, `simsun`,
 *       `romans`, `simplex`, `isocp`, `kaiti`, etc.) to their closest native system font stacks.
 *     - Uses generous top/bottom/oblique padding and automatic width down-scaling for extra-long lines
 *       so stacked tolerances (`\S+0.02^-0.01;`), overlines, descenders, and long paragraphs are never clipped.
 *     - Optimizes extra-large drawings via adaptive atlas resolution (`pxBase = 48/34/24`), `measureText`
 *       caching, and white-glyph vertex-color instancing.
 *  3. Smooth Crease-Angle 3D Normals & Water-Tight 3D Solid Volumes (`体` instead of hollow `面`):
 *     - Automatically caps extruded 3D `CIRCLE`s (top & bottom disks + 64-segment smooth walls) and
 *       closed `LWPOLYLINE` / `POLYLINE` extrusions (triangulated top & bottom caps + side walls).
 *     - Welds and averages vertex normals across smooth curved surfaces (`creaseAngle = 44°`) while
 *       preserving sharp mechanical edges, and suppresses internal tessellation grid clutter.
 *  4. Real Multi-Stage Async Progress (`parseAsync` with Live Render Progress):
 *     - Time-sliced async pipeline reports live percentage and stage details across Decoding, Lexical
 *       Scan, Table/Block Parse, Geometry & Text Atlas Tessellation, and Smooth Normal / GPU Upload.
 */

(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    let threeMod = null;
    try { threeMod = require('three'); } catch (_) {}
    const LoaderClass = factory(threeMod || (root && root.THREE));
    LoaderClass.createDXFLoader = factory;
    module.exports = LoaderClass;
    module.exports.DXFLoader = LoaderClass;
    module.exports.default = LoaderClass;
  } else if (typeof define === 'function' && define.amd) {
    define(['three'], factory);
  } else {
    const g = root || (typeof globalThis !== 'undefined' ? globalThis : window);
    g.DXFLoader = factory(g.THREE);
    if (g.THREE) g.THREE.DXFLoader = g.DXFLoader;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function (THREE) {
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
  // 2. AutoCAD Color Index (ACI 0-255) & High-Contrast Light-Background Adapter
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

  /**
   * Adapts any raw CAD hex color so it has crisp, unmistakable contrast on a white background (`#FFFFFF`).
   * Specifically transforms bright Yellow (#FFFF00 -> #B45309), Cyan (#00FFFF -> #0284C7),
   * Lime Green (#00FF00 -> #15803D), White (#FFFFFF -> #0F172A), and clamps pale colors.
   */
  /**
   * Convert an sRGB colour byte to the linear-sRGB working space.
   *
   * three.js interprets `BufferAttribute` colours as **Linear-sRGB** (the
   * renderer's working colour space), while CAD/ACI colours are authored in
   * sRGB. Writing the raw sRGB byte values into the colour attribute makes
   * every mid-tone render one step too bright (e.g. #808080 shows up as
   * ~#BCBCBC). Converting here keeps the colours identical to AutoCAD.
   */
  function srgbByteToLinear(byte) {
    const s = byte / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }

  /** Pack an sRGB hex colour into linear-sRGB components for a vertex colour. */
  function hexToLinearRgb(hex) {
    return {
      r: srgbByteToLinear((hex >> 16) & 255),
      g: srgbByteToLinear((hex >> 8) & 255),
      b: srgbByteToLinear(hex & 255)
    };
  }

  function adaptHexForLightBackground(hex) {
    if (hex === 0xFFFFFF || hex === 0xF8FAFC || hex === 0xFEFEFE) return 0x0F172A;
    if (hex === 0xFFFF00 || hex === 0xFFFF7F) return 0xB45309;
    if (hex === 0x00FFFF || hex === 0x7FFFFF) return 0x0284C7;
    if (hex === 0x00FF00 || hex === 0x7FFF00 || hex === 0x7FFF7F) return 0x15803D;
    if (hex === 0xC0C0C0 || hex === 0xBEBEBE) return 0x475569;

    const r = ((hex >> 16) & 255) / 255;
    const g = ((hex >> 8) & 255) / 255;
    const b = (hex & 255) / 255;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum > 0.88 && Math.max(r, g, b) - Math.min(r, g, b) < 0.15) return 0x0F172A;
    if (lum > 0.60) {
      const scale = 0.42 / Math.max(0.01, lum);
      const nr = Math.min(255, Math.round(r * scale * 255));
      const ng = Math.min(255, Math.round(g * scale * 255));
      const nb = Math.min(255, Math.round(b * scale * 255));
      return (nr << 16) | (ng << 8) | nb;
    }
    return hex;
  }

  function adaptHexForDarkBackground(hex) {
    if (hex === 0x000000 || hex === 0x0F172A || hex === 0x1E293B || hex === 0x333333) return 0xF8FAFC;
    const r = ((hex >> 16) & 255) / 255;
    const g = ((hex >> 8) & 255) / 255;
    const b = (hex & 255) / 255;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum < 0.08) return 0xF8FAFC;
    if (lum < 0.28) {
      const boost = 0.62 / Math.max(0.05, lum);
      const nr = Math.min(255, Math.round(Math.min(1, r * boost + 0.18) * 255));
      const ng = Math.min(255, Math.round(Math.min(1, g * boost + 0.18) * 255));
      const nb = Math.min(255, Math.round(Math.min(1, b * boost + 0.18) * 255));
      return (nr << 16) | (ng << 8) | nb;
    }
    return hex;
  }

  // ============================================================================
  // 3. CAD Font Name -> Closest System Font Stack Mapper
  // ============================================================================
  const DEFAULT_CAD_FONT_STACK = '"SimSun", "NSimSun", "Songti SC", "STSong", "Arial", sans-serif';

  function mapCADFontToSystemFont(fontName, bigFontName, defaultStack) {
    const fallback = defaultStack || DEFAULT_CAD_FONT_STACK;
    const combined = `${fontName || ''} ${bigFontName || ''}`.toLowerCase();
    if (!combined.trim()) return fallback;

    if (combined.includes('fangsong') || combined.includes('仿宋') || combined.includes('fsdb')) {
      return '"FangSong", "FangSong_GB2312", "STFangsong", "SimSun", "Arial", serif';
    }
    if (combined.includes('kaiti') || combined.includes('楷体') || combined.includes('stkai')) {
      return '"KaiTi", "KaiTi_GB2312", "STKaiti", "SimSun", "Arial", serif';
    }
    if (combined.includes('simhei') || combined.includes('黑体')) {
      return '"SimHei", "Microsoft YaHei", "SimSun", "Arial", sans-serif';
    }
    if (combined.includes('yahei') || combined.includes('雅黑')) {
      return '"Microsoft YaHei", "SimSun", "Arial", sans-serif';
    }
    if (combined.includes('arial') || combined.includes('helvetica') || combined.includes('isocp') || combined.includes('simplex') || combined.includes('txt')) {
      return '"Arial", "SimSun", "NSimSun", "Songti SC", sans-serif';
    }
    if (
      combined.includes('simsun') || combined.includes('宋体') || combined.includes('song') ||
      combined.includes('romans') || combined.includes('gbenor') || combined.includes('gbcbig') ||
      combined.includes('hztxt') || combined.includes('tssd')
    ) {
      return DEFAULT_CAD_FONT_STACK;
    }
    return DEFAULT_CAD_FONT_STACK;
  }

  function normKey(str, fallback = '0') {
    if (str === undefined || str === null || String(str).trim() === '') return fallback;
    return String(str).trim().toUpperCase();
  }

  // ============================================================================
  // 4. Auto-Detect Encoding & Decode \M+nXXXX MIF Escapes
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
      .replace(/%%%/g, '\x01PCT\x01')
      .replace(/%%[cC]/g, '⌀')
      .replace(/%%[dD]/g, '°')
      .replace(/%%[pP]/g, '±')
      .replace(/%%[oOuUkK]/g, '')
      .replace(/%%130/g, 'Ⅰ')
      .replace(/%%131/g, 'Ⅱ')
      .replace(/%%132/g, 'Ⅲ')
      .replace(/%%133/g, 'Ⅳ')
      .replace(/%%134/g, 'Ⅴ')
      .replace(/%%135/g, 'Ⅵ')
      .replace(/%%127/g, '°')
      .replace(/%%128/g, '±')
      .replace(/%%129/g, '⌀')
      .replace(/%%(\d{3})/g, (_, digits) => {
        const code = parseInt(digits, 10);
        if (code === 176) return '°';
        if (code === 177) return '±';
        if (code === 215) return '×';
        if (code === 216 || code === 248) return '⌀';
        if (code === 178) return '²';
        if (code === 179) return '³';
        if (code >= 32 && code <= 126) return String.fromCharCode(code);
        if (code >= 160 && code <= 255) return String.fromCharCode(code);
        return '⌀';
      })
      .replace(/%%(\d{1,2})/g, (_, digits) => {
        const code = parseInt(digits, 10);
        if (code >= 32 && code <= 126) return String.fromCharCode(code);
        return '';
      })
      .replace(/%%[a-zA-Z]/g, '')
      .replace(/\x01PCT\x01/g, '%')
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
  // 5. Mathematical Helpers: OCS->WCS, Bulge, Cox-de Boor NURBS, Crease Normals
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

  /**
   * Computes smooth vertex normals across curved 3D surfaces while preserving sharp edges (>= creaseDeg).
   */
  /**
   * Compute smooth vertex normals with a crease-angle threshold.
   *
   * `creaseDeg` controls where the surface is allowed to break: faces whose
   * normals differ by more than this angle keep their own flat normal, which
   * preserves sharp mechanical edges on solids.
   *
   * The spatial welding grid is now adaptive to the model size. A fixed
   * quantisation merges unrelated vertices on large drawings (causing stray
   * shading artefacts) and fails to weld on small ones (causing visible
   * seams between neighbouring facets).
   */
  function computeCreaseAngleNormals(posArray, creaseDeg = 44) {
    const vCount = posArray.length / 3;
    const normals = new Float32Array(posArray.length);
    if (vCount < 3) return normals;

    const faceCount = Math.floor(vCount / 3);
    const faceNormals = new Float32Array(faceCount * 3);

    // 1. Compute flat face normals
    for (let f = 0; f < faceCount; f++) {
      const i = f * 9;
      const ax = posArray[i], ay = posArray[i + 1], az = posArray[i + 2];
      const bx = posArray[i + 3], by = posArray[i + 4], bz = posArray[i + 5];
      const cx = posArray[i + 6], cy = posArray[i + 7], cz = posArray[i + 8];
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      faceNormals[f * 3] = nx;
      faceNormals[f * 3 + 1] = ny;
      faceNormals[f * 3 + 2] = nz;
      normals[i] = nx; normals[i + 1] = ny; normals[i + 2] = nz;
      normals[i + 3] = nx; normals[i + 4] = ny; normals[i + 5] = nz;
      normals[i + 6] = nx; normals[i + 7] = ny; normals[i + 8] = nz;
    }

    // Skip spatial welding if mesh is enormous (>150,000 vertices) to keep frame rate fast
    if (vCount > 150000) return normals;

    // 2. Bucket vertices by quantized spatial position.
    //    The quantum follows the model extent so welding is scale independent.
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let v = 0; v < vCount; v++) {
      const idx = v * 3;
      const x = posArray[idx], y = posArray[idx + 1], z = posArray[idx + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-6);
    // Welding quantum: use an absolute CAD-scale tolerance (0.01 mm) so that
    // neighbouring facets of the same solid always weld, regardless of how
    // large the model is. A purely relative quantum (extent/4096) would be
    // 24 mm on a 100 m model and would leave visible seams between facets.
    // The upper bound keeps small models from merging distinct vertices.
    const quantum = Math.max(Math.min(extent / 4096, 1e-2), 1e-9);

    const buckets = new Map();
    for (let v = 0; v < vCount; v++) {
      const idx = v * 3;
      const key = `${Math.round(posArray[idx] / quantum)},${Math.round(posArray[idx + 1] / quantum)},${Math.round(posArray[idx + 2] / quantum)}`;
      let list = buckets.get(key);
      if (!list) {
        list = [];
        buckets.set(key, list);
      }
      list.push(v);
    }

    const cosThresh = Math.cos((creaseDeg * Math.PI) / 180.0);

    // 3. Average normals for shared vertices whose face normals are within creaseDeg
    for (const list of buckets.values()) {
      if (list.length <= 1 || list.length > 64) continue;
      for (let i = 0; i < list.length; i++) {
        const vA = list[i];
        const fA = Math.floor(vA / 3) * 3;
        const nAx = faceNormals[fA], nAy = faceNormals[fA + 1], nAz = faceNormals[fA + 2];
        let sx = nAx, sy = nAy, sz = nAz;
        for (let j = 0; j < list.length; j++) {
          if (i === j) continue;
          const vB = list[j];
          const fB = Math.floor(vB / 3) * 3;
          const nBx = faceNormals[fB], nBy = faceNormals[fB + 1], nBz = faceNormals[fB + 2];
          if (nAx * nBx + nAy * nBy + nAz * nBz >= cosThresh) {
            sx += nBx; sy += nBy; sz += nBz;
          }
        }
        const sl = Math.hypot(sx, sy, sz) || 1;
        const outIdx = vA * 3;
        normals[outIdx] = sx / sl;
        normals[outIdx + 1] = sy / sl;
        normals[outIdx + 2] = sz / sl;
      }
    }

    return normals;
  }

  function interpolateBulgePoints(p1, p2, bulge, segmentsPerCircle = 128) {
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
    // Segment budget for the arc.
    //   - at least one segment per 90 degrees of sweep (ezdxf `ConstructionEllipse`)
    //   - at least 6 segments (three-dxf uses the same floor)
    //   - `segmentsPerCircle` controls the density of a full circle
    // The previous floor of 4 segments turned a 90 degree arc into a visible
    // quadrilateral, which is exactly the kind of faceting users notice.
    const numSegs = Math.max(
      6,
      Math.min(
        256,
        Math.max(
          Math.ceil(Math.abs(includedAngle) / (Math.PI / 2)),
          Math.ceil((Math.abs(includedAngle) / (Math.PI * 2)) * segmentsPerCircle)
        )
      )
    );
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

    // Sample density follows the control polygon: a spline with many control
    // points gets a proportionally denser sampling. The cap only exists to
    // bound the worst case (a huge spline), it is not a quality setting.
    const numSamples = Math.max(baseSamples, Math.min(1024, validCP.length * 8));

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

  /**
   * Decode an ACIS SAT text stream.
   *
   * SAT bodies are obfuscated with a reversible XOR-159 scheme (implemented
   * in ezdxf as `tools/crypt.py`). Two details matter and are easy to miss:
   *
   *  1. The printable-character mapping is `159 - c`, which is equivalent to
   *     `c ^ 0x5F` for the whole printable ASCII range.
   *  2. The character `0x5E` (`^`) encodes the letter `A` and is followed by
   *     one filler character that must be skipped. Without that skip rule an
   *     extra blank survives in the token stream and breaks the
   *     `body/lump/shell/...` keyword matching.
   *
   * The special cases `0x20` (space), `0x40` (`_`) and `0x5F` (`@`) are
   * passed through as themselves.
   */
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

  function tessellatePolylineSegmentsToBatch(pts, pattern, batch, colorPair) {
    if (!pts || pts.length < 2) return;
    if (!pattern || pattern.length === 0) {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        batch.addSegment(a.x, a.y, a.z, b.x, b.y, b.z, colorPair);
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
        batch.addSegment(a.x, a.y, a.z, b.x, b.y, b.z, colorPair);
      }
      return;
    }

    let adaptScale = 1.0;
    if (totalPolyLen / patSum > 60) {
      adaptScale = (totalPolyLen / 35) / patSum;
    } else if (totalPolyLen / patSum < 0.35) {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        batch.addSegment(a.x, a.y, a.z, b.x, b.y, b.z, colorPair);
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
        if (isDraw) batch.addSegment(curX, curY, curZ, nx, ny, nz, colorPair);
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
    lines.inlineHAlign = null;
    lines.inlineVAlign = null;

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

    const validCmdRe = /^[ACcFfHWQTSpa]$/;
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
        else if (next === 'L' || next === 'l' || next === 'O' || next === 'o' || next === 'K' || next === 'k') {
          // Skip underline/overline/strike toggles so no unwanted horizontal lines cut across text
          flushBuf();
          i += 2;
        } else if (validCmdRe.test(next)) {
          const semi = text.indexOf(';', i + 2);
          if (semi !== -1 && semi - i < 72 && !text.slice(i + 2, semi).includes('\n')) {
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
                type: 'stack', upper: (parts[0] || '').trim(), lower: (parts.slice(1).join('') || '').trim(), divider, style: currentStyle()
              });
            } else if (cmd === 'A' || cmd === 'a') {
              const alignCode = parseInt(arg, 10);
              if (alignCode === 0) lines.inlineVAlign = 1; // Bottom
              else if (alignCode === 1) lines.inlineVAlign = 2; // Middle
              else if (alignCode === 2) lines.inlineVAlign = 3; // Top
            } else if (cmd === 'p') {
              if (arg.includes('qc')) lines.inlineHAlign = 1;
              else if (arg.includes('qr')) lines.inlineHAlign = 2;
              else if (arg.includes('ql')) lines.inlineHAlign = 0;
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
              if (parts[0]) top.font = parts[0].replace(/\.(shx|ttf|otf)$/i, '');
              parts.slice(1).forEach(p => {
                if (p === 'b1') top.bold = true;
                if (p === 'b0') top.bold = false;
                if (p === 'i1') top.italic = true;
                if (p === 'i0') top.italic = false;
              });
            }
            i = semi + 1;
          } else { buf += ch; i++; }
        } else { buf += ch; i++; }
      } else if (ch === '\n') { flushBuf(); lines.push([]); i++; }
      else if (ch === '\r') { i++; }
      else { buf += ch; i++; }
    }
    flushBuf();
    return lines;
  }

  // ============================================================================
  // 6. High-DPI Multi-Page Filled Text Atlas (Dual Theme Vertex Colors + Zero Clipping)
  // ============================================================================
  class MultiPageTextAtlas {
    constructor(fontFamily, onVertexAdded, nominalPx = 96, getPickId = null) {
      this.size = 4096;
      this.fontFamily = fontFamily || DEFAULT_CAD_FONT_STACK;
      this.onVertexAdded = onVertexAdded || null;
      this.nominalPx = nominalPx;
      this.getPickId = getPickId || (() => -1);
      this.hasDOM = typeof document !== 'undefined';
      this.pages = [];
      this.cache = new Map();
      this.measureCache = new Map();
      this.textRecords = [];
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
        cursorX: 8,
        cursorY: 8,
        rowHeight: 0,
        quadPositions: new Float32GrowableBuffer(4096),
        quadUVs: new Float32GrowableBuffer(2730),
        quadColLight: new Float32GrowableBuffer(4096),
        quadColDark: new Float32GrowableBuffer(4096),
        quadPickIds: new Float32GrowableBuffer(1024)
      };
      this.pages.push(page);
      return page;
    }

    getTotalVertexCount() {
      let sum = 0;
      for (const p of this.pages) sum += p.quadPositions.length / 3;
      return sum;
    }

    measureCached(ctx, fontStr, text) {
      const key = fontStr + '\0' + text;
      let w = this.measureCache.get(key);
      if (w === undefined) {
        ctx.font = fontStr;
        w = ctx.measureText(text).width;
        if (this.measureCache.size < 25000) {
          this.measureCache.set(key, w);
        }
      }
      return w;
    }

    addRichTextQuad(lines, baseHeight, colorPair, halign, valign, worldMatrix, originShift, bgMaskColorHex = null, refWidthWorld = 0, resolvedFontStack = null, textMeta = null, fitSpanWorld = 0, fitMode = 0) {
      if (!this.hasDOM || !baseHeight || baseHeight <= 0) return false;

      const baseFam = resolvedFontStack || this.fontFamily;
      const hasInlineColor = lines.some(l => l.some(r => r.style && (r.style.aciColor !== null || r.style.trueColor !== null)));
      const hasStack = lines.some(l => l.some(r => r.type === 'stack'));

      let pxBase = this.nominalPx;
      // In SimSun / Arial, capital / CJK glyph height above baseline is 0.76 * fontSize
      let capHeightPx = pxBase * 0.76;
      const maxWrapPx = (refWidthWorld && refWidthWorld > baseHeight * 12.0 && lines.length === 1)
        ? (refWidthWorld / baseHeight) * capHeightPx
        : 0;

      const cacheKey = JSON.stringify({
        lines,
        halign,
        baseFam,
        colorSalt: 0,
        maxWrapPx: Math.round(maxWrapPx)
      });
      let entry = this.cache.get(cacheKey);

      if (!entry) {
        if (this.pages.length >= 28 && this.pages[this.pages.length - 1].cursorY > this.size - 128) {
          return false;
        }
        let page = this.pages[this.pages.length - 1];
        const ctx = page.ctx;

        const buildFontStr = (runStyle, pxSize) => {
          const weight = runStyle.bold ? '700 ' : '400 ';
          const italic = runStyle.italic ? 'italic ' : '';
          const fam = runStyle.font ? mapCADFontToSystemFont(runStyle.font, '', baseFam) : baseFam;
          return `${italic}${weight}${Math.max(10, Math.min(192, Math.round(pxSize)))}px ${fam}`;
        };

        let wrappedLines = lines;
        if (maxWrapPx > 120) {
          wrappedLines = [];
          for (const srcLine of lines) {
            let curLine = [];
            let curW = 0;
            for (const run of srcLine) {
              const st = run.style || {};
              const scale = st.absHeight ? Math.min(12, Math.max(0.1, st.absHeight / baseHeight)) : (st.scale || 1.0);
              const wf = st.widthFactor || 1.0;
              if (run.type === 'stack') {
                curLine.push(run);
                curW += pxBase * scale * wf * 1.4;
              } else {
                const fStr = buildFontStr(st, pxBase * scale);
                const fullW = this.measureCached(ctx, fStr, run.text) * wf;
                if (curW + fullW <= maxWrapPx || run.text.length <= 1) {
                  curLine.push(run);
                  curW += fullW;
                } else {
                  let chunk = '';
                  for (const ch of Array.from(run.text)) {
                    const chW = this.measureCached(ctx, fStr, chunk + ch) * wf;
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
                    curW += this.measureCached(ctx, fStr, chunk) * wf;
                  }
                }
              }
            }
            wrappedLines.push(curLine);
          }
        }

        const measureAtPxBase = (curPxBase) => {
          const curCapH = curPxBase * 0.76;
          let maxW = 4;
          const metrics = wrappedLines.map(line => {
            let w = 0;
            const runs = line.map(run => {
              const st = run.style || {};
              const scale = st.absHeight ? Math.min(12, Math.max(0.1, st.absHeight / baseHeight)) : (st.scale || 1.0);
              const wf = st.widthFactor || 1.0;
              const ob = st.oblique || 0;
              const shearExtra = Math.abs(Math.tan(THREE.MathUtils.degToRad(ob))) * curCapH * scale * 0.65;
              if (run.type === 'stack') {
                const subPx = curPxBase * scale * 0.58;
                const fStr = buildFontStr(st, subPx);
                const uw = this.measureCached(ctx, fStr, run.upper) * wf;
                const lw = this.measureCached(ctx, fStr, run.lower) * wf;
                const rw = Math.max(uw, lw) + 6 + shearExtra;
                w += rw;
                return { run, rw, pxSize: curPxBase * scale, subPx, wf };
              } else {
                const pxSize = curPxBase * scale;
                const fStr = buildFontStr(st, pxSize);
                const rw = this.measureCached(ctx, fStr, run.text) * wf + shearExtra;
                w += rw;
                return { run, rw, pxSize, wf };
              }
            });
            if (w > maxW) maxW = w;
            return { width: w, runs };
          });
          return { maxW, metrics, curCapH };
        };

        let measured = measureAtPxBase(pxBase);
        if (measured.maxW > this.size - 40) {
          const shrink = (this.size - 44) / measured.maxW;
          pxBase = Math.max(12, Math.floor(pxBase * shrink));
          measured = measureAtPxBase(pxBase);
        }

        capHeightPx = measured.curCapH;
        const maxLineW = measured.maxW;
        const lineMetrics = measured.metrics;

        const topHeadroom = hasStack ? Math.ceil(capHeightPx * 0.42) : Math.ceil(capHeightPx * 0.22);
        const descenderPad = Math.ceil(capHeightPx * 0.36);
        const padX = 8;
        const padY = 6;
        const lineSpacing = capHeightPx * 1.55;

        const totalGlyphH = wrappedLines.length === 1
          ? capHeightPx
          : ((wrappedLines.length - 1) * lineSpacing + capHeightPx);
        const boxW = Math.min(this.size - 16, Math.ceil(maxLineW + padX * 2));
        const boxH = Math.min(this.size - 16, Math.ceil(topHeadroom + totalGlyphH + descenderPad + padY * 2));

        if (page.cursorX + boxW + 8 > this.size) {
          page.cursorX = 8;
          page.cursorY += page.rowHeight + 8;
          page.rowHeight = 0;
        }
        if (page.cursorY + boxH + 8 > this.size) {
          page = this.allocateNewPage();
        }

        const drawCtx = page.ctx;
        const ox = page.cursorX, oy = page.cursorY;
        page.cursorX += boxW + 8;
        if (boxH > page.rowHeight) page.rowHeight = boxH;

        const hexToCss = (hex) => '#' + new THREE.Color(hex).getHexString();
        drawCtx.textBaseline = 'alphabetic';
        drawCtx.lineJoin = 'round';

        lineMetrics.forEach((lm, lIdx) => {
          let curX = ox + padX;
          if (halign === 1 || halign === 4) curX = ox + padX + (maxLineW - lm.width) * 0.5;
          else if (halign === 2) curX = ox + padX + (maxLineW - lm.width);
          const baseY = oy + padY + topHeadroom + capHeightPx + lIdx * lineSpacing;

          lm.runs.forEach(rm => {
            const { run, rw, pxSize, subPx, wf } = rm;
            const st = run.style || {};
            // Always draw pure white #FFFFFF glyphs; theme/inline colors are applied via vertexColors!
            const fillCss = '#FFFFFF';

            drawCtx.save();
            drawCtx.fillStyle = fillCss;
            drawCtx.strokeStyle = fillCss;
            const shear = Math.tan(THREE.MathUtils.degToRad(st.oblique || 0));

            if (run.type === 'stack') {
              drawCtx.font = buildFontStr(st, subPx);
              drawCtx.translate(curX + 1, baseY);
              drawCtx.transform(wf, 0, -shear, 1, 0, 0);
              // Light stroke underlay: thickens hairline strokes (SimSun at
              // small sizes) so glyphs stay crisp over solid hatches and at
              // any zoom, matching the heavier look of CAD SHX text.
              drawCtx.lineWidth = Math.max(1, subPx * 0.024);
              drawCtx.strokeText(run.upper, 0, -capHeightPx * 0.54);
              drawCtx.strokeText(run.lower, 0, capHeightPx * 0.04);
              drawCtx.fillText(run.upper, 0, -capHeightPx * 0.54);
              drawCtx.fillText(run.lower, 0, capHeightPx * 0.04);
              if (run.divider === '/') {
                drawCtx.lineWidth = Math.max(1.2, pxSize * 0.04);
                drawCtx.beginPath();
                drawCtx.moveTo(0, -capHeightPx * 0.42);
                drawCtx.lineTo(Math.max(2, (rw - 4) / wf), -capHeightPx * 0.42);
                drawCtx.stroke();
              }
            } else {
              drawCtx.font = buildFontStr(st, pxSize);
              drawCtx.translate(curX, baseY);
              drawCtx.transform(wf, 0, -shear, 1, 0, 0);
              drawCtx.lineWidth = Math.max(1, pxSize * 0.024);
              drawCtx.strokeText(run.text, 0, 0);
              drawCtx.fillText(run.text, 0, 0);
            }
            drawCtx.restore();
            curX += rw;
          });
        });

        const uvInset = 0.5 / this.size;
        entry = {
          pageIndex: page.pageIndex,
          u0: (ox / this.size) + uvInset,
          v0: 1.0 - ((oy + boxH) / this.size) + uvInset,
          u1: ((ox + boxW) / this.size) - uvInset,
          v1: 1.0 - (oy / this.size) - uvInset,
          boxW, boxH, maxLineW, padX, padY, topHeadroom, descenderPad, totalGlyphH, capHeightPx, hasInlineColor
        };
        this.cache.set(cacheKey, entry);
      }

      const targetPage = this.pages[entry.pageIndex];
      let scaleY = baseHeight / entry.capHeightPx;
      let scaleX = scaleY;

      // Exact span fitting for Aligned (fitMode === 3) and Fit (fitMode === 5) TEXT entities
      if (fitSpanWorld > 1e-4 && entry.maxLineW > 1e-3) {
        const naturalGlyphW = entry.maxLineW * scaleY;
        const fitRatio = Math.max(0.15, Math.min(8.0, fitSpanWorld / naturalGlyphW));
        scaleX = scaleY * fitRatio;
        if (fitMode === 3) {
          scaleY = scaleX;
        }
      }

      const planeW = entry.boxW * scaleX;
      const planeH = entry.boxH * scaleY;
      const padXW = entry.padX * scaleX;
      const glyphWorldW = entry.maxLineW * scaleX;

      let x0, x1;
      if (halign === 1 || halign === 4) {
        x0 = -planeW * 0.5;
        x1 = planeW * 0.5;
      } else if (halign === 2) {
        x0 = -padXW - glyphWorldW;
        x1 = x0 + planeW;
      } else {
        x0 = -padXW;
        x1 = x0 + planeW;
      }

      // Exact vertical anchor mapping:
      // valign === 3 (Top): y=0 is top of capital/CJK glyph (padY + topHeadroom from top of box)
      // valign === 2 or halign === 4 (Middle): y=0 is middle of totalGlyphH
      // valign === 1 (Bottom): y=0 is bottom baseline of last line (padY + topHeadroom + totalGlyphH)
      // valign === 0 (Baseline): y=0 is alphabetic baseline of first line (padY + topHeadroom + capHeightPx)
      let anchorFromTopPx;
      if (valign === 3) {
        anchorFromTopPx = entry.padY + entry.topHeadroom;
      } else if (valign === 2 || halign === 4) {
        anchorFromTopPx = entry.padY + entry.topHeadroom + entry.totalGlyphH * 0.5;
      } else if (valign === 1) {
        anchorFromTopPx = entry.padY + entry.topHeadroom + entry.totalGlyphH;
      } else {
        anchorFromTopPx = entry.padY + entry.topHeadroom + entry.capHeightPx;
      }
      const y1 = anchorFromTopPx * scaleY;
      const y0 = y1 - planeH;

      // Un-mirror horizontal coordinates if inside a reflected INSERT block
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

      const p00 = new THREE.Vector3(x0, y0, 0.05).applyMatrix4(worldMatrix);
      const p10 = new THREE.Vector3(x1, y0, 0.05).applyMatrix4(worldMatrix);
      const p11 = new THREE.Vector3(x1, y1, 0.05).applyMatrix4(worldMatrix);
      const p01 = new THREE.Vector3(x0, y1, 0.05).applyMatrix4(worldMatrix);

      const ax = p00.x - sx, ay = p00.y - sy, az = p00.z - sz;
      const bx = p10.x - sx, by = p10.y - sy, bz = p10.z - sz;
      const cx = p11.x - sx, cy = p11.y - sy, cz = p11.z - sz;
      const dx = p01.x - sx, dy = p01.y - sy, dz = p01.z - sz;

      const vertexStartOffset = targetPage.quadPickIds.length;
      const pid = this.getPickId();
      for (let k = 0; k < 6; k++) targetPage.quadPickIds.push3(pid, 0, 0);

      targetPage.quadPositions.push9(ax, ay, az, bx, by, bz, cx, cy, cz);
      targetPage.quadPositions.push9(ax, ay, az, cx, cy, cz, dx, dy, dz);

      let effPair = colorPair;
      if (hasInlineColor) {
        for (const l of lines) {
          for (const r of l) {
            const st = r.style;
            if (st && st.trueColor !== null && st.trueColor !== undefined) {
              const raw = st.trueColor & 0xFFFFFF;
              effPair = { light: adaptHexForLightBackground(raw), dark: adaptHexForDarkBackground(raw) };
              break;
            } else if (st && st.aciColor !== null && st.aciColor !== undefined) {
              const aci = Math.abs(st.aciColor);
              if (aci === 7 || aci === 255) {
                effPair = { light: 0x0F172A, dark: 0xF8FAFC };
              } else if (ACI_PALETTE[aci] !== undefined) {
                const raw = ACI_PALETTE[aci];
                effPair = { light: adaptHexForLightBackground(raw), dark: adaptHexForDarkBackground(raw) };
              }
              break;
            }
          }
        }
      }
      const lHex = effPair.light;
      const dHex = effPair.dark;
      const lc = hexToLinearRgb(lHex), dc = hexToLinearRgb(dHex);
      const lr = lc.r, lg = lc.g, lb = lc.b;
      const dr = dc.r, dg = dc.g, db = dc.b;
      targetPage.quadColLight.pushRGBRepeat(lr, lg, lb, 6);
      targetPage.quadColDark.pushRGBRepeat(dr, dg, db, 6);

      if (this.onVertexAdded) {
        this.onVertexAdded(ax, ay, az);
        this.onVertexAdded(bx, by, bz);
        this.onVertexAdded(cx, cy, cz);
        this.onVertexAdded(dx, dy, dz);
      }

      const { u0, v0, u1, v1 } = entry;
      targetPage.quadUVs.push6(u0, v0, u1, v0, u1, v1);
      targetPage.quadUVs.push6(u0, v0, u1, v1, u0, v1);

      if (this.textRecords.length < 60000) {
        const plainFromLines = lines.map(l => l.map(r => r.type === 'stack' ? `${r.upper}/${r.lower}` : (r.text || '')).join('')).join(' ').trim();
        const plainText = (textMeta && textMeta.plainText) ? String(textMeta.plainText).trim() : plainFromLines;
        if (plainText) {
          const qBox = new THREE.Box3(
            new THREE.Vector3(Math.min(ax, bx, cx, dx), Math.min(ay, by, cy, dy), Math.min(az, bz, cz, dz)),
            new THREE.Vector3(Math.max(ax, bx, cx, dx), Math.max(ay, by, cy, dy), Math.max(az, bz, cz, dz))
          );
          this.textRecords.push({
            id: this.textRecords.length,
            pageIndex: entry.pageIndex,
            vertexStartOffset,
            plainText,
            rawText: (textMeta && textMeta.rawText) || plainText,
            type: (textMeta && textMeta.type) || 'TEXT',
            handle: (textMeta && textMeta.handle) || '',
            layer: (textMeta && textMeta.layer) || '0',
            displayLayer: (textMeta && textMeta.displayLayer) || (textMeta && textMeta.layer) || '0',
            parentBlock: (textMeta && textMeta.parentBlock) || null,
            resolvedFont: baseFam,
            height: baseHeight,
            colorPair,
            box: qBox,
            entity: (textMeta && textMeta.entity) || null
          });
        }
      }
      return true;
    }

    buildAtlasMeshes(isLightTheme = true) {
      if (!this.hasDOM) return [];
      const meshes = [];
      for (const page of this.pages) {
        if (page.quadPositions.length === 0) continue;
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(page.quadPositions.toTypedArray(), 3));
        geom.setAttribute('uv', new THREE.BufferAttribute(page.quadUVs.toTypedArray(), 2));
        const lightArr = new Float32Array(page.quadColLight.toTypedArray());
        const darkArr = new Float32Array(page.quadColDark.toTypedArray());
        const activeArr = new Float32Array(isLightTheme ? lightArr : darkArr);
        geom.setAttribute('color', new THREE.BufferAttribute(activeArr, 3));

        const rawPickFloats = page.quadPickIds.toTypedArray();
        const vCount = page.quadPositions.length / 3;
        const pickIds = new Int32Array(vCount);
        for (let k = 0; k < vCount; k++) pickIds[k] = rawPickFloats[k * 3];

        const texture = new THREE.CanvasTexture(page.canvas);
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.anisotropy = 8;
        texture.needsUpdate = true;
        const mat = new THREE.MeshBasicMaterial({
          map: texture,
          vertexColors: true,
          transparent: true,
          alphaTest: 0.04,
          side: THREE.DoubleSide,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2
        });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.renderOrder = 4;
        mesh.name = `Batched_Text_Atlas_Page_${page.pageIndex}`;
        mesh.userData = {
          lightColors: lightArr,
          darkColors: darkArr,
          pickIds
        };
        meshes.push(mesh);
      }
      return meshes;
    }
  }

  // ============================================================================
  // 7. Phase-Locked Fault-Tolerant DXF Parser (Sync & Async Time-Sliced)
  // ============================================================================
  class DXFParser {
    constructor() {
      this.warnings = [];
    }

    tokenizeSync(dxfString) {
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
      return { codes, values };
    }

    async tokenizeAsync(dxfString, onProgress, yieldFn) {
      const codes = [];
      const values = [];
      const len = dxfString.length;
      let pos = 0;
      let lastYield = typeof performance !== 'undefined' ? performance.now() : Date.now();

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

      let iter = 0;
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

        if ((++iter & 8191) === 0) {
          const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
          if (now - lastYield > 14) {
            const pct = Math.min(32, 8 + Math.round((pos / Math.max(1, len)) * 24));
            if (onProgress) onProgress({ percent: pct, stage: '词法扫描组码', detail: `${Math.round((pos / len) * 100)}%` });
            await yieldFn();
            lastYield = typeof performance !== 'undefined' ? performance.now() : Date.now();
          }
        }
      }
      return { codes, values };
    }

    parseFromTokens(codes, values) {
      this.warnings = [];
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
        acisSabByHandle: new Map(),
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
            else if (secName === 'ACDSDATA') idx = this.parseACDSData(codes, values, idx, data.acisSabByHandle);
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
        data.tables.styles['STANDARD'] = { name: 'STANDARD', font: 'simplex.shx', bigFont: '', height: 0, widthFactor: 1.0, obliqueAngle: 0 };
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

    parse(dxfString) {
      const { codes, values } = this.tokenizeSync(dxfString);
      return this.parseFromTokens(codes, values);
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


    /**
     * Parse ACDSDATA section (DXF R2013+). Collects ASM_Data binary SAB blobs keyed by
     * soft-pointer handle (group 320) that references the owning 3DSOLID/REGION/SURFACE.
     */
    parseACDSData(codes, values, idx, sabByHandle) {
      const n = codes.length;
      let cur = null;
      const finish = () => {
        if (!cur || !cur.hasAsm || !cur.handle || !cur.hexParts.length) return;
        try {
          const bytes = hexStringToUint8Array(cur.hexParts.join(''));
          if (!bytes.length) return;
          const key = String(cur.handle).toLowerCase();
          if (!sabByHandle.has(key)) {
            sabByHandle.set(key, { bytes, satLines: null });
          }
        } catch (err) {
          this.warnings.push('ACDSDATA SAB decode skipped for handle ' + cur.handle + ': ' + (err && err.message ? err.message : err));
        }
      };
      while (idx < n) {
        const c = codes[idx];
        const v = values[idx];
        if (c === 0 && String(v).toUpperCase() === 'ENDSEC') {
          finish();
          return idx + 1;
        }
        if (c === 0) {
          finish();
          const typ = String(v).toUpperCase();
          cur = (typ === 'ACDSRECORD')
            ? { hasAsm: false, handle: null, hexParts: [], size: 0 }
            : null;
          idx++;
          continue;
        }
        if (cur) {
          if (c === 2 && String(v) === 'ASM_Data') cur.hasAsm = true;
          else if (c === 320 && !cur.handle) cur.handle = String(v);
          else if (c === 94) cur.size = (typeof v === 'number') ? v : (parseInt(v, 10) || 0);
          else if (c === 310) cur.hexParts.push(String(v).replace(/\s+/g, ''));
        }
        idx++;
      }
      finish();
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
      let inSubDMesh = false;
      let readingVerts = false, readingFaces = false, vertsLeft = 0, faceIntsLeft = 0, curV = null;
      let vertPhaseDone = false, facePhaseDone = false;
      const faceStream = [];
      for (let i = start; i < end; i++) {
        const c = codes[i], v = values[i];
        if (c >= 1000) continue;
        if (c === 100 && String(v).toUpperCase().includes('SUBDMESH')) {
          inSubDMesh = true;
          continue;
        }
        if (this.applyCommonCode(ent, c, v)) continue;
        if (!inSubDMesh && c !== 10 && c !== 20 && c !== 30) continue;
        if (c === 92 && !vertPhaseDone && ent.vertices.length === 0) {
          vertsLeft = v; readingVerts = true; readingFaces = false; vertPhaseDone = true;
        } else if (c === 93 && !facePhaseDone && faceStream.length === 0) {
          faceIntsLeft = v; readingVerts = false; readingFaces = true; facePhaseDone = true;
        } else if (c === 94 || c === 95) {
          readingVerts = false; readingFaces = false;
        } else if ((readingVerts && vertsLeft > 0) || (!vertPhaseDone && c === 10)) {
          if (c === 10) { curV = { x: v, y: 0, z: 0 }; ent.vertices.push(curV); if (vertsLeft > 0) vertsLeft--; }
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
  // 8. High-Performance Batched Layer Collector (Dual Light/Dark Color Buffers)
  // ============================================================================
  class LayerBatchCollector {
    constructor(layerName, displayName, colorPair, linetype, visible, originShift, onVertexAdded, getPickId = null, creaseAngle = 44) {
      this.layerName = layerName;
      this.displayName = displayName || layerName;
      this.colorPair = colorPair;
      this.colorHex = colorPair.light;
      this.linetype = linetype;
      this.visible = visible;
      this.originShift = originShift || { x: 0, y: 0, z: 0 };
      this.onVertexAdded = onVertexAdded || null;
      this.getPickId = getPickId || (() => -1);
      this.creaseAngle = creaseAngle || 44;
      this.entityCount = 0;

      this.linePos = new Float32GrowableBuffer(16384);
      this.lineColLight = new Float32GrowableBuffer(16384);
      this.lineColDark = new Float32GrowableBuffer(16384);
      this.linePickIds = [];

      this.mesh2DPos = new Float32GrowableBuffer(4096);
      this.mesh2DColLight = new Float32GrowableBuffer(4096);
      this.mesh2DColDark = new Float32GrowableBuffer(4096);
      this.mesh2DPickIds = [];

      this.mesh3DPos = new Float32GrowableBuffer(4096);
      this.mesh3DColLight = new Float32GrowableBuffer(4096);
      this.mesh3DColDark = new Float32GrowableBuffer(4096);
      this.mesh3DPickIds = [];
    }

    _unpackPair(colorOrPair) {
      if (typeof colorOrPair === 'number') {
        return {
          light: adaptHexForLightBackground(colorOrPair),
          dark: adaptHexForDarkBackground(colorOrPair)
        };
      }
      return colorOrPair || this.colorPair;
    }

    addSegment(x1, y1, z1, x2, y2, z2, colorOrPair) {
      const ox = this.originShift.x, oy = this.originShift.y, oz = this.originShift.z;
      const ax = x1 - ox, ay = y1 - oy, az = z1 - oz;
      const bx = x2 - ox, by = y2 - oy, bz = z2 - oz;
      this.linePos.push6(ax, ay, az, bx, by, bz);

      const cp = this._unpackPair(colorOrPair);
      const lc = hexToLinearRgb(cp.light), dc = hexToLinearRgb(cp.dark);
      const lr = lc.r, lg = lc.g, lb = lc.b;
      const dr = dc.r, dg = dc.g, db = dc.b;
      this.lineColLight.push6(lr, lg, lb, lr, lg, lb);
      this.lineColDark.push6(dr, dg, db, dr, dg, db);

      const pid = this.getPickId();
      this.linePickIds.push(pid, pid);

      if (this.onVertexAdded) {
        this.onVertexAdded(ax, ay, az);
        this.onVertexAdded(bx, by, bz);
      }
    }

    addSegmentsArray(coords, colorOrPair) {
      if (!coords || coords.length === 0) return;
      const ox = this.originShift.x, oy = this.originShift.y, oz = this.originShift.z;
      const cp = this._unpackPair(colorOrPair);
      const lc = hexToLinearRgb(cp.light), dc = hexToLinearRgb(cp.dark);
      const lr = lc.r, lg = lc.g, lb = lc.b;
      const dr = dc.r, dg = dc.g, db = dc.b;
      const cb = this.onVertexAdded;
      const pid = this.getPickId();
      for (let i = 0; i < coords.length; i += 3) {
        const vx = coords[i] - ox, vy = coords[i + 1] - oy, vz = coords[i + 2] - oz;
        this.linePos.push3(vx, vy, vz);
        this.lineColLight.push3(lr, lg, lb);
        this.lineColDark.push3(dr, dg, db);
        this.linePickIds.push(pid);
        if (cb) cb(vx, vy, vz);
      }
    }

    addTriangle2D(x1, y1, z1, x2, y2, z2, x3, y3, z3, colorOrPair) {
      const ox = this.originShift.x, oy = this.originShift.y, oz = this.originShift.z;
      const ax = x1 - ox, ay = y1 - oy, az = z1 - oz;
      const bx = x2 - ox, by = y2 - oy, bz = z2 - oz;
      const cx = x3 - ox, cy = y3 - oy, cz = z3 - oz;
      this.mesh2DPos.push9(ax, ay, az, bx, by, bz, cx, cy, cz);

      const cp = this._unpackPair(colorOrPair);
      const lc = hexToLinearRgb(cp.light), dc = hexToLinearRgb(cp.dark);
      const lr = lc.r, lg = lc.g, lb = lc.b;
      const dr = dc.r, dg = dc.g, db = dc.b;
      this.mesh2DColLight.push9(lr, lg, lb, lr, lg, lb, lr, lg, lb);
      this.mesh2DColDark.push9(dr, dg, db, dr, dg, db, dr, dg, db);

      const pid = this.getPickId();
      this.mesh2DPickIds.push(pid, pid, pid);

      if (this.onVertexAdded) {
        this.onVertexAdded(ax, ay, az);
        this.onVertexAdded(bx, by, bz);
        this.onVertexAdded(cx, cy, cz);
      }
    }

    addTriangle3D(x1, y1, z1, x2, y2, z2, x3, y3, z3, colorOrPair) {
      const ox = this.originShift.x, oy = this.originShift.y, oz = this.originShift.z;
      const ax = x1 - ox, ay = y1 - oy, az = z1 - oz;
      const bx = x2 - ox, by = y2 - oy, bz = z2 - oz;
      const cx = x3 - ox, cy = y3 - oy, cz = z3 - oz;
      this.mesh3DPos.push9(ax, ay, az, bx, by, bz, cx, cy, cz);

      const cp = this._unpackPair(colorOrPair);
      const lc = hexToLinearRgb(cp.light), dc = hexToLinearRgb(cp.dark);
      const lr = lc.r, lg = lc.g, lb = lc.b;
      const dr = dc.r, dg = dc.g, db = dc.b;
      this.mesh3DColLight.push9(lr, lg, lb, lr, lg, lb, lr, lg, lb);
      this.mesh3DColDark.push9(dr, dg, db, dr, dg, db, dr, dg, db);

      const pid = this.getPickId();
      this.mesh3DPickIds.push(pid, pid, pid);

      if (this.onVertexAdded) {
        this.onVertexAdded(ax, ay, az);
        this.onVertexAdded(bx, by, bz);
        this.onVertexAdded(cx, cy, cz);
      }
    }

    buildLayerGroup(isLightTheme = true) {
      const group = new THREE.Group();
      group.name = `Layer_${this.layerName}`;
      group.visible = this.visible;
      group.userData = {
        layerName: this.layerName,
        displayName: this.displayName,
        colorHex: isLightTheme ? this.colorPair.light : this.colorPair.dark,
        colorPair: this.colorPair,
        linetype: this.linetype,
        entityCount: this.entityCount
      };

      if (this.mesh2DPos.length > 0) {
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(this.mesh2DPos.toTypedArray(), 3));
        const lightArr = new Float32Array(this.mesh2DColLight.toTypedArray());
        const darkArr = new Float32Array(this.mesh2DColDark.toTypedArray());
        const activeArr = new Float32Array(isLightTheme ? lightArr : darkArr);
        geom.setAttribute('color', new THREE.BufferAttribute(activeArr, 3));
        const mat = new THREE.MeshBasicMaterial({
          vertexColors: true,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.88,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: 2,
          polygonOffsetUnits: 2
        });
        geom.computeBoundingBox();
        geom.computeBoundingSphere();
        const mesh2d = new THREE.Mesh(geom, mat);
        mesh2d.renderOrder = 1;
        mesh2d.name = `BatchedMesh2D_${this.layerName}`;
        mesh2d.userData = {
          lightColors: lightArr,
          darkColors: darkArr,
          pickIds: new Int32Array(this.mesh2DPickIds)
        };
        group.add(mesh2d);
      }

      if (this.mesh3DPos.length > 0) {
        const geom = new THREE.BufferGeometry();
        const posArr = this.mesh3DPos.toTypedArray();
        geom.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
        const lightArr = new Float32Array(this.mesh3DColLight.toTypedArray());
        const darkArr = new Float32Array(this.mesh3DColDark.toTypedArray());
        const activeArr = new Float32Array(isLightTheme ? lightArr : darkArr);
        geom.setAttribute('color', new THREE.BufferAttribute(activeArr, 3));
        const smoothNormals = computeCreaseAngleNormals(posArr, this.creaseAngle || 44);
        geom.setAttribute('normal', new THREE.BufferAttribute(smoothNormals, 3));

        const mat = new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.42,
          metalness: 0.16,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1
        });
        geom.computeBoundingBox();
        geom.computeBoundingSphere();
        const mesh3d = new THREE.Mesh(geom, mat);
        mesh3d.renderOrder = 2;
        mesh3d.name = `BatchedMesh3D_${this.layerName}`;
        mesh3d.userData = {
          lightColors: lightArr,
          darkColors: darkArr,
          pickIds: new Int32Array(this.mesh3DPickIds)
        };
        group.add(mesh3d);
      }

      if (this.linePos.length > 0) {
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(this.linePos.toTypedArray(), 3));
        const lightArr = new Float32Array(this.lineColLight.toTypedArray());
        const darkArr = new Float32Array(this.lineColDark.toTypedArray());
        const activeArr = new Float32Array(isLightTheme ? lightArr : darkArr);
        geom.setAttribute('color', new THREE.BufferAttribute(activeArr, 3));
        geom.computeBoundingBox();
        geom.computeBoundingSphere();
        const lines = new THREE.LineSegments(geom, new THREE.LineBasicMaterial({ vertexColors: true }));
        lines.renderOrder = 3;
        lines.name = `BatchedLines_${this.layerName}`;
        lines.userData = {
          lightColors: lightArr,
          darkColors: darkArr,
          pickIds: new Int32Array(this.linePickIds)
        };
        group.add(lines);
      }

      return group;
    }
  }

  // ============================================================================
  // 9. Main THREE.DXFLoader Class
  // ============================================================================
  class DXFLoader {
    constructor(manager) {
      this.manager = manager || (THREE && THREE.DefaultLoadingManager ? THREE.DefaultLoadingManager : null);
      this.options = {
        fontFamily: DEFAULT_CAD_FONT_STACK,
        defaultColor: 0x0F172A,
        backgroundColor: 'light',
        dimensionMode: 'auto',
        includePaperSpace: false,
        // Number of segments used to approximate a full circle / closed curve.
        // Accuracy first: the same budget applies to every drawing, regardless
        // of its size. Lower it only if you really need a faster parse.
        curveSegments: 96,
        extrudeThickness: true,
        centerOrigin: true,
        // Crease angle (degrees) used to decide where a 3D surface breaks.
        // Smaller = smoother curved faces, larger = sharper mechanical edges.
        creaseAngle: 44,
        // Minimum number of segments used for a full circle / closed curve.
        minCurveSegments: 24,
        // Nominal pixel size of a glyph in the text atlas. Constant for every
        // drawing; extra text is handled by paging, not by lowering quality.
        textAtlasPx: 96,
        // Maximum number of segments used for a full circle / closed curve.
        maxCurveSegments: 192
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

    /**
     * Decode the ACIS payload (SAT text or binary SAB) of an entity into the
     * plain SAT record text that the reconstructor consumes. Useful for hosts
     * that want to inspect or export the underlying B-rep data.
     *
     * @param {object} ent  the parsed ACIS entity (3DSOLID / SURFACE / REGION / BODY)
     * @param {object} dxf  the parsed DXF document
     * @returns {{source:string, satLines:string[]}|{source:string, error:string}}
     */
    static decodeAcisData(ent, dxf) {
      try {
        const resolved = resolveAcisSatLines(ent, dxf);
        return { source: resolved.source, satLines: resolved.satLines };
      } catch (err) {
        return { source: 'error', error: err && err.message ? err.message : String(err) };
      }
    }

    /**
     * Instantaneous (<1ms) background theme switching without re-parsing or re-rasterizing!
     */
    static applyBackgroundTheme(rootGroup, bgTheme = 'light', selectedIdSet = null) {
      if (!rootGroup) return;
      // 'light' = White bg, 'dark' = Black bg, 'bw' = Black bg + all 2D/3D models & text in pure White (#FFFFFF)
      const isLight = bgTheme === 'light';
      const isMono = bgTheme === 'bw';
      const monoR = 1.0;
      const monoG = 1.0;
      const monoB = 1.0;

      // Highlight: purple (#8B5CF6) on white bg, lighter purple (#C4B5FD) on black bg.
      // Stored in linear-sRGB because vertex colours live in the renderer's
      // working colour space.
      const hi = isLight ? hexToLinearRgb(0x8B5CF6) : hexToLinearRgb(0xC4B5FD);
      const hiR = hi.r, hiG = hi.g, hiB = hi.b;
      const hasSel = selectedIdSet && selectedIdSet.size > 0;

      rootGroup.traverse(obj => {
        if (obj.userData && obj.userData.lightColors && obj.userData.darkColors && obj.geometry) {
          const colorAttr = obj.geometry.getAttribute('color');
          if (colorAttr) {
            const src = isLight ? obj.userData.lightColors : obj.userData.darkColors;
            const dst = colorAttr.array;
            const pickIds = obj.userData.pickIds;
            const vCount = dst.length / 3;

            if (!isMono && !hasSel) {
              dst.set(src);
            } else {
              for (let v = 0; v < vCount; v++) {
                const i3 = v * 3;
                if (hasSel && pickIds && selectedIdSet.has(pickIds[v])) {
                  dst[i3] = hiR;
                  dst[i3 + 1] = hiG;
                  dst[i3 + 2] = hiB;
                } else if (isMono) {
                  dst[i3] = monoR;
                  dst[i3 + 1] = monoG;
                  dst[i3 + 2] = monoB;
                } else {
                  dst[i3] = src[i3];
                  dst[i3 + 1] = src[i3 + 1];
                  dst[i3 + 2] = src[i3 + 2];
                }
              }
            }
            colorAttr.needsUpdate = true;
          }
        }
        if (obj.isMesh && obj.name && obj.name.startsWith('BatchedMesh3D') && obj.material && obj.material.emissive) {
          // 3D solids: selection boost via emissive so shaded geometry stays legible
          // instead of looking flat under PBR lighting.
          const boost = hasSel && obj.userData.selectionBoost === true;
          obj.material.emissive.setHex(isMono ? 0x383838 : (boost ? 0x5B21B6 : 0x000000));
          obj.material.emissiveIntensity = boost ? 0.85 : 1.0;
          obj.material.roughness = isMono ? 0.55 : 0.42;
          obj.material.metalness = isMono ? 0.05 : 0.16;
          obj.material.needsUpdate = true;
        }
        if (obj.userData && obj.userData.colorPair) {
          obj.userData.colorHex = isMono
            ? 0xFFFFFF
            : (isLight ? obj.userData.colorPair.light : obj.userData.colorPair.dark);
        }
      });
      if (rootGroup.userData && rootGroup.userData.stats && rootGroup.userData.stats.layers) {
        rootGroup.userData.stats.layers.forEach(l => {
          if (l.colorPair) {
            l.colorHex = isMono
              ? 0xFFFFFF
              : (isLight ? l.colorPair.light : l.colorPair.dark);
          }
        });
      }
    }

    load(url, onLoad, onProgress, onError) {
      const loader = new THREE.FileLoader(this.manager);
      loader.setResponseType('arraybuffer');
      loader.load(
        url,
        (buffer) => {
          this.parseAsync(buffer, null, onProgress)
            .then(result => { if (onLoad) onLoad(result); })
            .catch(err => {
              if (onError) onError(err);
              else console.error('THREE.DXFLoader parse error:', err);
            });
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

    /**
     * Asynchronous Time-Sliced Parser with Real Multi-Stage Progress Reporting
     */
    async parseAsync(dxfInput, customOptions, onProgress) {
      const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (customOptions) this.setOptions(customOptions);

      const yieldToUI = () => new Promise(resolve => setTimeout(resolve, 0));

      if (onProgress) onProgress({ percent: 4, stage: '解码文件字符集', detail: 'UTF-8 / GB18030' });
      await yieldToUI();

      const decoded = decodeDXFArrayBuffer(dxfInput);
      const dxfText = decoded.text;

      const parser = new DXFParser();
      const { codes, values } = await parser.tokenizeAsync(dxfText, onProgress, yieldToUI);

      if (onProgress) onProgress({ percent: 35, stage: '解析图层与块结构', detail: `${codes.length} 组码` });
      await yieldToUI();

      const dxf = parser.parseFromTokens(codes, values);

      if (onProgress) onProgress({ percent: 45, stage: '准备几何与字体图集', detail: `${dxf.entities.length} 图元` });
      await yieldToUI();

      return await this._buildSceneFromParsedDXF(dxf, decoded.encoding, t0, onProgress, yieldToUI);
    }

    /**
     * Synchronous Parser (for direct script calls)
     */
    parse(dxfInput, customOptions) {
      const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (customOptions) this.setOptions(customOptions);

      const decoded = decodeDXFArrayBuffer(dxfInput);
      const parser = new DXFParser();
      const dxf = parser.parse(decoded.text);
      return this._buildSceneSync(dxf, decoded.encoding, t0);
    }

    _prepareBuildContext(dxf, encoding) {
      let usePaperSpace = this.options.includePaperSpace;
      let textLikeCount = 0;
      let modelEntCount = 0;
      for (let i = 0; i < dxf.entities.length; i++) {
        const e = dxf.entities[i];
        if (!e.inPaperSpace && e.visible !== false && e.type !== 'VIEWPORT') modelEntCount++;
        if (e.type === 'TEXT' || e.type === 'MTEXT' || e.type === 'DIMENSION' || e.type === 'ATTRIB' || e.type === 'ACAD_TABLE') {
          textLikeCount++;
        }
      }
      if (modelEntCount === 0 && dxf.entities.length > 0) {
        usePaperSpace = true;
      }

      // Curve tessellation budget. Large drawings get fewer segments to keep the
      // parse fast, but the floor is raised so close-up views of big drawings do
      // not look faceted, and the ceiling is capped so tiny drawings stay cheap.
      // Curve tessellation budget.
      //
      // Accuracy always wins over parse speed here: the tessellation density
      // must not depend on how many entities a drawing happens to contain.
      // An earlier version scaled the segment count down for large drawings
      // (15000+ entities -> 75 %), which made big drawings visibly faceted
      // exactly where the user zooms in. The budget is now a fixed, high
      // value for every drawing.
      const minSegs = Math.max(8, this.options.minCurveSegments || 24);
      const maxSegs = Math.max(minSegs, this.options.maxCurveSegments || 192);
      const requested = Math.max(minSegs, Math.min(maxSegs, this.options.curveSegments || 48));
      const baseSegs = requested;
      this._activeCurveSegs = baseSegs;
      this._minCurveSegs = minSegs;
      this._maxCurveSegs = maxSegs;

      // Text atlas resolution is constant: the glyph resolution must not
      // depend on how much text a drawing contains. Large drawings simply use
      // more atlas pages (the atlas is paged), so the quality stays identical.
      const nominalTextPx = this.options.textAtlasPx || 96;
      const originShift = this.computeSceneOrigin(dxf, usePaperSpace);

      const globalBBox = new THREE.Box3();
      const sampleXs = [], sampleYs = [];
      const bState = {
        curEntMinX: Infinity, curEntMinY: Infinity, curEntMinZ: Infinity,
        curEntMaxX: -Infinity, curEntMaxY: -Infinity, curEntMaxZ: -Infinity,
        totalVertexEvents: 0,
        currentPickId: -1
      };
      const getPickId = () => bState.currentPickId;

      const onVertexAdded = (vx, vy, vz) => {
        if (!isFinite(vx) || !isFinite(vy) || !isFinite(vz)) return;
        if (Math.abs(vx) > 1e9 || Math.abs(vy) > 1e9 || Math.abs(vz) > 1e9) return;
        if (vx < bState.curEntMinX) bState.curEntMinX = vx;
        if (vy < bState.curEntMinY) bState.curEntMinY = vy;
        if (vz < bState.curEntMinZ) bState.curEntMinZ = vz;
        if (vx > bState.curEntMaxX) bState.curEntMaxX = vx;
        if (vy > bState.curEntMaxY) bState.curEntMaxY = vy;
        if (vz > bState.curEntMaxZ) bState.curEntMaxZ = vz;

        bState.totalVertexEvents++;
        if (sampleXs.length < 4096) {
          sampleXs.push(vx);
          sampleYs.push(vy);
        } else if ((bState.totalVertexEvents & 31) === 0) {
          const slot = bState.totalVertexEvents % 4096;
          sampleXs[slot] = vx;
          sampleYs[slot] = vy;
        }
      };

      const collectors = {};
      const textAtlas = new MultiPageTextAtlas(this.options.fontFamily, onVertexAdded, nominalTextPx, getPickId);
      const pickRecords = [];

      const stats = {
        totalEntities: 0,
        totalVertices: 0,
        drawCalls: 0,
        parseTimeMs: 0,
        encoding,
        acadVer: dxf.header['$ACADVER'] || 'AC1027',
        originShift,
        warnings: dxf.warnings || [],
        byType: {},
        layers: [],
        blocksCount: Object.keys(dxf.blocks).length,
        stylesCount: Object.keys(dxf.tables.styles).length,
        dimstylesCount: Object.keys(dxf.tables.dimstyles).length,
        has3D: false,
        acisEntities: 0,
        acisSabMatched: 0,
        acisSabOk: 0,
        acisSabFail: 0,
        acisSatOk: 0,
        acisEmpty: 0,
        acisEmittedEdges: 0,
        acisSabMapSize: (dxf.acisSabByHandle && dxf.acisSabByHandle.size) || 0
      };

      const getCollector = (layerKey) => {
        const key = normKey(layerKey, '0');
        if (!collectors[key]) {
          const lDef = dxf.tables.layers[key] || { name: key, displayName: key, colorIndex: 7, visible: true, linetype: 'CONTINUOUS' };
          const colPair = this.resolveColorPair({ layer: key, colorIndex: 256 }, dxf, null);
          collectors[key] = new LayerBatchCollector(
            key,
            lDef.displayName || key,
            colPair,
            lDef.linetype || 'CONTINUOUS',
            lDef.visible !== false,
            originShift,
            onVertexAdded,
            getPickId,
            this.options.creaseAngle || 44
          );
        }
        return collectors[key];
      };

      Object.keys(dxf.tables.layers).forEach(ln => getCollector(ln));

      return {
        usePaperSpace, originShift, globalBBox, sampleXs, sampleYs, bState,
        collectors, textAtlas, pickRecords, stats, getCollector
      };
    }

    _finalizeScene(dxf, ctx, t0) {
      const { globalBBox, sampleXs, sampleYs, collectors, textAtlas, pickRecords, stats, originShift } = ctx;
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

      const isLightTheme = this.options.backgroundColor === 'light';
      const rootGroup = new THREE.Group();
      rootGroup.name = 'DXF_Root';
      const layerGroups = {};

      Object.keys(collectors).forEach(ln => {
        const col = collectors[ln];
        const lg = col.buildLayerGroup(isLightTheme);
        layerGroups[ln] = lg;
        rootGroup.add(lg);
        stats.totalVertices += (col.linePos.length + col.mesh2DPos.length + col.mesh3DPos.length) / 3;
        stats.drawCalls += lg.children.length;
        stats.layers.push({
          name: ln,
          displayName: col.displayName,
          visible: col.visible,
          colorHex: isLightTheme ? col.colorPair.light : col.colorPair.dark,
          colorPair: col.colorPair,
          linetype: col.linetype,
          entityCount: col.entityCount
        });
      });

      // Link textRecords to pickRecords and expose nested block text records for fine-grained picking & search
      const textRecords = textAtlas.textRecords || [];
      for (let i = 0; i < textRecords.length; i++) {
        const tr = textRecords[i];
        if (tr.parentBlock && tr.entity && pickRecords.length < 60000) {
          const synId = pickRecords.length;
          const syntheticRec = {
            id: synId,
            isTopLevel: false,
            isNestedText: true,
            parentBlock: tr.parentBlock,
            plainText: tr.plainText,
            resolvedFont: tr.resolvedFont,
            entity: tr.entity,
            layer: tr.layer,
            displayLayer: tr.displayLayer,
            colorPair: tr.colorPair,
            box: tr.box
          };
          tr.pickRecord = syntheticRec;
          pickRecords.push(syntheticRec);
          const pg = textAtlas.pages[tr.pageIndex];
          if (pg && tr.vertexStartOffset !== undefined) {
            for (let k = 0; k < 6; k++) {
              pg.quadPickIds.data[tr.vertexStartOffset + k * 3] = synId;
            }
          }
        }
      }

      const atlasMeshes = textAtlas.buildAtlasMeshes(isLightTheme);
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
        textRecords,
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
        textRecords,
        originShift
      };
    }

    _buildSceneSync(dxf, encoding, t0) {
      const ctx = this._prepareBuildContext(dxf, encoding);
      const { usePaperSpace, originShift, globalBBox, bState, textAtlas, pickRecords, stats, getCollector } = ctx;
      const identityMat = new THREE.Matrix4();

      for (let i = 0; i < dxf.entities.length; i++) {
        const ent = dxf.entities[i];
        if (ent.inPaperSpace && !usePaperSpace) continue;
        if (ent.visible === false || ent.type === 'VIEWPORT') continue;

        const primaryBatch = getCollector(ent.layer);
        bState.curEntMinX = Infinity; bState.curEntMinY = Infinity; bState.curEntMinZ = Infinity;
        bState.curEntMaxX = -Infinity; bState.curEntMaxY = -Infinity; bState.curEntMaxZ = -Infinity;
        bState.currentPickId = pickRecords.length;

        try {
          this.emitEntity(ent, dxf, getCollector, primaryBatch, textAtlas, identityMat, originShift, null, 0, stats);
        } catch (emitErr) {
          stats.warnings.push(`Render skipped ${ent.type} (#${ent.handle}): ${emitErr.message}`);
          continue;
        }

        primaryBatch.entityCount++;
        stats.totalEntities++;
        stats.byType[ent.type] = (stats.byType[ent.type] || 0) + 1;

        if (bState.curEntMinX <= bState.curEntMaxX) {
          const entBox = new THREE.Box3(
            new THREE.Vector3(bState.curEntMinX, bState.curEntMinY, bState.curEntMinZ),
            new THREE.Vector3(bState.curEntMaxX, bState.curEntMaxY, bState.curEntMaxZ)
          );
          if (ent.type !== 'XLINE' && ent.type !== 'RAY') {
            globalBBox.union(entBox);
          }
          if (pickRecords.length < 50000) {
            const lKey = normKey(ent.layer, '0');
            const lDef = dxf.tables.layers[lKey];
            pickRecords.push({
              id: pickRecords.length,
              isTopLevel: true,
              entity: ent,
              layer: lKey,
              displayLayer: (lDef && lDef.displayName) || ent.displayLayer || ent.layer || '0',
              colorPair: this.resolveColorPair(ent, dxf, null),
              box: entBox
            });
          }
        }
      }

      return this._finalizeScene(dxf, ctx, t0);
    }

    async _buildSceneFromParsedDXF(dxf, encoding, t0, onProgress, yieldFn) {
      const ctx = this._prepareBuildContext(dxf, encoding);
      const { usePaperSpace, originShift, globalBBox, bState, textAtlas, pickRecords, stats, getCollector } = ctx;
      const identityMat = new THREE.Matrix4();
      const total = dxf.entities.length;
      let lastYield = typeof performance !== 'undefined' ? performance.now() : Date.now();

      for (let i = 0; i < total; i++) {
        const ent = dxf.entities[i];
        if (ent.inPaperSpace && !usePaperSpace) continue;
        if (ent.visible === false || ent.type === 'VIEWPORT') continue;

        const primaryBatch = getCollector(ent.layer);
        bState.curEntMinX = Infinity; bState.curEntMinY = Infinity; bState.curEntMinZ = Infinity;
        bState.curEntMaxX = -Infinity; bState.curEntMaxY = -Infinity; bState.curEntMaxZ = -Infinity;
        bState.currentPickId = pickRecords.length;

        try {
          this.emitEntity(ent, dxf, getCollector, primaryBatch, textAtlas, identityMat, originShift, null, 0, stats);
        } catch (emitErr) {
          stats.warnings.push(`Render skipped ${ent.type} (#${ent.handle}): ${emitErr.message}`);
          continue;
        }

        primaryBatch.entityCount++;
        stats.totalEntities++;
        stats.byType[ent.type] = (stats.byType[ent.type] || 0) + 1;

        if (bState.curEntMinX <= bState.curEntMaxX) {
          const entBox = new THREE.Box3(
            new THREE.Vector3(bState.curEntMinX, bState.curEntMinY, bState.curEntMinZ),
            new THREE.Vector3(bState.curEntMaxX, bState.curEntMaxY, bState.curEntMaxZ)
          );
          if (ent.type !== 'XLINE' && ent.type !== 'RAY') {
            globalBBox.union(entBox);
          }
          if (pickRecords.length < 50000) {
            const lKey = normKey(ent.layer, '0');
            const lDef = dxf.tables.layers[lKey];
            pickRecords.push({
              id: pickRecords.length,
              isTopLevel: true,
              entity: ent,
              layer: lKey,
              displayLayer: (lDef && lDef.displayName) || ent.displayLayer || ent.layer || '0',
              colorPair: this.resolveColorPair(ent, dxf, null),
              box: entBox
            });
          }
        }

        if ((i & 127) === 0) {
          const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
          if (now - lastYield > 14) {
            const pct = Math.min(88, 45 + Math.round(((i + 1) / Math.max(1, total)) * 43));
            if (onProgress) {
              onProgress({
                percent: pct,
                stage: '几何细分与文字光栅化',
                detail: `${i + 1} / ${total} 图元`
              });
            }
            await yieldFn();
            lastYield = typeof performance !== 'undefined' ? performance.now() : Date.now();
          }
        }
      }

      if (onProgress) onProgress({ percent: 94, stage: '计算曲面法线与上传显存', detail: '构建 WebGL 批次' });
      await yieldFn();

      const res = this._finalizeScene(dxf, ctx, t0);
      if (onProgress) onProgress({ percent: 100, stage: '渲染完成', detail: `${res.stats.totalEntities} 图元` });
      return res;
    }

    // ==========================================================================
    // Dual Light/Dark Color & Linetype Pattern Resolution
    // ==========================================================================
    resolveColorPair(ent, dxf, parentContext) {
      if (ent.trueColor !== null && ent.trueColor !== undefined) {
        const raw = ent.trueColor & 0xFFFFFF;
        return {
          light: adaptHexForLightBackground(raw),
          dark: adaptHexForDarkBackground(raw)
        };
      }
      let aci = ent.colorIndex !== undefined ? ent.colorIndex : 256;
      if (aci === 0 && parentContext && parentContext.colorPair) return parentContext.colorPair;
      if (aci === 256 || aci === 0) {
        const entLayer = normKey(ent.layer, '0');
        const layerName = (entLayer === '0' && parentContext && parentContext.layer) ? parentContext.layer : entLayer;
        const layer = dxf.tables.layers[layerName];
        if (layer) {
          if (layer.trueColor !== null && layer.trueColor !== undefined) {
            const raw = layer.trueColor & 0xFFFFFF;
            return {
              light: adaptHexForLightBackground(raw),
              dark: adaptHexForDarkBackground(raw)
            };
          }
          aci = Math.abs(layer.colorIndex || 7);
        } else aci = 7;
      }
      aci = Math.abs(aci);
      if (aci === 7 || aci === 255) {
        return { light: 0x0F172A, dark: 0xF8FAFC };
      }
      const baseHex = ACI_PALETTE[aci] !== undefined ? ACI_PALETTE[aci] : 0x64748B;
      return {
        light: adaptHexForLightBackground(baseHex),
        dark: adaptHexForDarkBackground(baseHex)
      };
    }

    resolveColor(ent, dxf, parentContext) {
      const pair = this.resolveColorPair(ent, dxf, parentContext);
      return this.options.backgroundColor === 'light' ? pair.light : pair.dark;
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

    /**
     * Emits a polyline / curve to the layer collector.
     * When `ent.thickness` (code 39) is non-zero AND the contour is closed (`isClosed`),
     * automatically triangulates and emits both the Bottom Cap and Top Cap (`mesh3D`) so
     * extruded 3D parts are true water-tight solid volumes (`体`) instead of hollow tubes (`面`)!
     */
    emitPolylineToBatch(pts, ent, dxf, batch, worldMat, parentContext, isClosed = false, overrideColor = undefined, isOCS = false) {
      if (!pts || pts.length < 2) return;
      const colorPair = overrideColor !== undefined
        ? batch._unpackPair(overrideColor)
        : this.resolveColorPair(ent, dxf, parentContext);
      const localPts = isClosed ? [...pts, pts[0].clone()] : pts;
      const transformed = localPts.map(p => p.clone().applyMatrix4(worldMat));

      const pattern = this.resolveLinetypePattern(ent, dxf, parentContext);
      tessellatePolylineSegmentsToBatch(transformed, pattern, batch, colorPair);

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

        tessellatePolylineSegmentsToBatch(topPts, pattern, batch, colorPair);

        // Side wall 3D triangles (smoothly shaded via crease-angle normal welding!)
        for (let i = 0; i < transformed.length - 1; i++) {
          const a = transformed[i], b = transformed[i + 1];
          const aT = topPts[i], bT = topPts[i + 1];
          batch.addTriangle3D(a.x, a.y, a.z, b.x, b.y, b.z, bT.x, bT.y, bT.z, colorPair);
          batch.addTriangle3D(a.x, a.y, a.z, bT.x, bT.y, bT.z, aT.x, aT.y, aT.z, colorPair);
        }

        // Cap the Top and Bottom if the contour is closed!
        const firstP = localPts[0];
        const lastP = localPts[localPts.length - 1];
        const effectivelyClosed = isClosed || (localPts.length >= 4 && firstP.distanceToSquared(lastP) < 1e-4);
        if (effectivelyClosed && isOCS && localPts.length >= 4) {
          const ring2D = [];
          for (let i = 0; i < localPts.length - 1; i++) {
            const pt = localPts[i];
            if (ring2D.length === 0 || Math.hypot(pt.x - ring2D[ring2D.length - 1].x, pt.y - ring2D[ring2D.length - 1].y) > 1e-5) {
              ring2D.push(new THREE.Vector2(pt.x, pt.y));
            }
          }
          if (ring2D.length >= 3) {
            try {
              const tris = THREE.ShapeUtils.triangulateShape(ring2D, []);
              const zB = firstP.z || 0;
              const zT = zB + ent.thickness;
              for (const [i0, i1, i2] of tris) {
                const b0 = new THREE.Vector3(ring2D[i0].x, ring2D[i0].y, zB).applyMatrix4(worldMat);
                const b1 = new THREE.Vector3(ring2D[i1].x, ring2D[i1].y, zB).applyMatrix4(worldMat);
                const b2 = new THREE.Vector3(ring2D[i2].x, ring2D[i2].y, zB).applyMatrix4(worldMat);
                batch.addTriangle3D(b0.x, b0.y, b0.z, b2.x, b2.y, b2.z, b1.x, b1.y, b1.z, colorPair);

                const t0 = new THREE.Vector3(ring2D[i0].x, ring2D[i0].y, zT).applyMatrix4(worldMat);
                const t1 = new THREE.Vector3(ring2D[i1].x, ring2D[i1].y, zT).applyMatrix4(worldMat);
                const t2 = new THREE.Vector3(ring2D[i2].x, ring2D[i2].y, zT).applyMatrix4(worldMat);
                batch.addTriangle3D(t0.x, t0.y, t0.z, t1.x, t1.y, t1.z, t2.x, t2.y, t2.z, colorPair);
              }
            } catch (_) {}
          }
        }
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
        case 'LOFTEDSURFACE': return this.emitACISSolid(ent, dxf, batch, worldMat, parentContext, stats);
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
      // A direction component of 0 is legitimate (a vertical ray is (0,1,0)):
      // the fallback must only apply when the code is missing, so the old
      // `ent.x1 || 1` did not turn every vertical ray into a 45-degree line.
      const dir = new THREE.Vector3(
        ent.x1 !== undefined ? ent.x1 : 1,
        ent.y1 !== undefined ? ent.y1 : 0,
        ent.z1 !== undefined ? ent.z1 : 0
      ).normalize();
      // Construction lines are infinite; AutoCAD clips them to the drawing
      // extent. A fixed 250 units overflows large drawings (and looks like a
      // stray diagonal), so the reach follows the drawing size when known.
      let reach = 250;
      const ext = dxf.header && dxf.header.$EXTMAX && dxf.header.$EXTMIN
        ? Math.max(
            Math.abs(dxf.header.$EXTMAX.x - dxf.header.$EXTMIN.x),
            Math.abs(dxf.header.$EXTMAX.y - dxf.header.$EXTMIN.y)
          )
        : 0;
      if (ext > 0) reach = Math.max(10, ext * 0.35);
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
      const colorPair = this.resolveColorPair(ent, dxf, parentContext);

      const baseShape = pdmode & 7;
      if (baseShape === 3) {
        batch.addSegment(p.x - s, p.y - s, p.z, p.x + s, p.y + s, p.z, colorPair);
        batch.addSegment(p.x - s, p.y + s, p.z, p.x + s, p.y - s, p.z, colorPair);
      } else if (baseShape === 2) {
        batch.addSegment(p.x - s, p.y, p.z, p.x + s, p.y, p.z, colorPair);
        batch.addSegment(p.x, p.y - s, p.z, p.x, p.y + s, p.z, colorPair);
      }
      if (pdmode & 32) {
        const segs = 12;
        for (let i = 0; i < segs; i++) {
          const a1 = (i / segs) * Math.PI * 2, a2 = ((i + 1) / segs) * Math.PI * 2;
          batch.addSegment(p.x + s * 0.8 * Math.cos(a1), p.y + s * 0.8 * Math.sin(a1), p.z, p.x + s * 0.8 * Math.cos(a2), p.y + s * 0.8 * Math.sin(a2), p.z, colorPair);
        }
      }
    }

    emitCircle(ent, dxf, batch, worldMat, parentContext, depth = 0) {
      const r = ent.r || 1;
      const cx = ent.x || 0, cy = ent.y || 0, cz = ent.z || 0;
      const ocsMat = getOCS2WCSMatrix(ent.extrusion);
      const combMat = new THREE.Matrix4().multiplyMatrices(worldMat, ocsMat);
      const hasThick = this.options.extrudeThickness && Math.abs(ent.thickness || 0) > 1e-4;
      const segs = hasThick ? 56 : this._activeCurveSegs;
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
      // Nested (3D) arcs keep the same density as top-level arcs: accuracy
      // must not depend on how deeply an entity is nested.
      const baseSegs = this._activeCurveSegs;
      const segs = Math.max(8, Math.ceil((sweep / (Math.PI * 2)) * baseSegs));
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
      // The major axis may have a zero component (e.g. (0, 45, 0)); only a
      // missing code should fall back to a default direction.
      const majorVec = new THREE.Vector3(
        ent.x1 !== undefined ? ent.x1 : 1,
        ent.y1 !== undefined ? ent.y1 : 0,
        ent.z1 !== undefined ? ent.z1 : 0
      );
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
      const segs = Math.max(16, Math.ceil((sweep / (Math.PI * 2)) * this._activeCurveSegs));
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

    emitVariableWidthStripToBatch(pts, widths, combMat, batch, colorPair) {
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
        batch.addTriangle2D(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, colorPair);
        batch.addTriangle2D(a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z, colorPair);
      }
    }

    emitLWPolyline(ent, dxf, batch, worldMat, parentContext) {
      const verts = ent.vertices || [];
      if (verts.length < 2) return;
      const isClosed = (ent.flags & 1) !== 0;
      const ocsMat = getOCS2WCSMatrix(ent.extrusion);
      const combMat = new THREE.Matrix4().multiplyMatrices(worldMat, ocsMat);
      const colorPair = this.resolveColorPair(ent, dxf, parentContext);

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

      this.emitPolylineToBatch(pts, ent, dxf, batch, combMat, parentContext, false, colorPair, true);

      if (hasVariableOrConstWidth && pts.length >= 2) {
        this.emitVariableWidthStripToBatch(pts, widths, combMat, batch, colorPair);
      }
    }

    emitPolyline(ent, dxf, batch, worldMat, parentContext) {
      const verts = ent.vertices || [];
      if (verts.length === 0) return;
      const flags = ent.flags || 0;
      const colorPair = this.resolveColorPair(ent, dxf, parentContext);

      // 1. Polyface Mesh (flags & 64 or VERTEX records with faceIndices)
      const hasFaceVertices = (flags & 64) !== 0 || verts.some(v => v.faceIndices && v.faceIndices.length >= 3);
      if (hasFaceVertices) {
        const coords = [], faceRecords = [];
        for (const v of verts) {
          if (v.faceIndices && v.faceIndices.length >= 3) {
            faceRecords.push(v);
          } else {
            coords.push(new THREE.Vector3(v.x, v.y, v.z).applyMatrix4(worldMat));
          }
        }
        for (const fv of faceRecords) {
          const validIdx = fv.faceIndices.filter(ix => ix !== 0);
          if (validIdx.length < 3) continue;
          let faceColor = colorPair;
          if (fv.trueColor !== null && fv.trueColor !== undefined) {
            faceColor = batch._unpackPair(fv.trueColor & 0xFFFFFF);
          } else if (fv.colorIndex !== undefined && fv.colorIndex !== 256 && fv.colorIndex !== 0) {
            faceColor = batch._unpackPair(ACI_PALETTE[Math.abs(fv.colorIndex)] || colorPair.light);
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

      // 2. 3D Polygon Mesh (flags & 16): Smooth surface without internal tessellation wireframe clutter!
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
                batch.addTriangle3D(v00.x, v00.y, v00.z, v10.x, v10.y, v10.z, v11.x, v11.y, v11.z, colorPair);
                batch.addTriangle3D(v00.x, v00.y, v00.z, v11.x, v11.y, v11.z, v01.x, v01.y, v01.z, colorPair);
              }
            }
          }
          return;
        }
      }

      // 3. 2D or 3D Polyline
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
      this.emitPolylineToBatch(pts, ent, dxf, batch, combMat, parentContext, false, colorPair, !is3D);

      if (!is3D && hasWidth && pts.length >= 2) {
        this.emitVariableWidthStripToBatch(pts, widths, combMat, batch, colorPair);
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
          ? batch._unpackPair(ACI_PALETTE[Math.abs(elem.colorIndex)] || 0x0F172A)
          : this.resolveColorPair(ent, dxf, parentContext);

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
        const colorPair = this.resolveColorPair(ent, dxf, parentContext);
        [verts[0], verts[verts.length - 1]].forEach(v => {
          const mx = v.miterX !== undefined ? v.miterX : -v.dirY;
          const my = v.miterY !== undefined ? v.miterY : v.dirX;
          const mLen = Math.hypot(mx, my) || 1;
          const pA = new THREE.Vector3(v.x + (mx / mLen) * minOff, v.y + (my / mLen) * minOff, v.z || 0).applyMatrix4(worldMat);
          const pB = new THREE.Vector3(v.x + (mx / mLen) * maxOff, v.y + (my / mLen) * maxOff, v.z || 0).applyMatrix4(worldMat);
          batch.addSegment(pA.x, pA.y, pA.z, pB.x, pB.y, pB.z, colorPair);
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
      const colorPair = this.resolveColorPair(ent, dxf, parentContext);
      const hasFour = p2.distanceToSquared(p3) > 1e-10;

      if (this.options.extrudeThickness && Math.abs(ent.thickness || 0) > 1e-4) {
        const dz = ent.thickness;
        const t0 = new THREE.Vector3(l0.x, l0.y, l0.z + dz).applyMatrix4(combMat);
        const t1 = new THREE.Vector3(l1.x, l1.y, l1.z + dz).applyMatrix4(combMat);
        const t2 = new THREE.Vector3(l2.x, l2.y, l2.z + dz).applyMatrix4(combMat);
        const t3 = new THREE.Vector3(l3.x, l3.y, l3.z + dz).applyMatrix4(combMat);

        batch.addTriangle3D(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p3.x, p3.y, p3.z, colorPair);
        batch.addTriangle3D(t0.x, t0.y, t0.z, t3.x, t3.y, t3.z, t1.x, t1.y, t1.z, colorPair);
        if (hasFour) {
          batch.addTriangle3D(p0.x, p0.y, p0.z, p3.x, p3.y, p3.z, p2.x, p2.y, p2.z, colorPair);
          batch.addTriangle3D(t0.x, t0.y, t0.z, t2.x, t2.y, t2.z, t3.x, t3.y, t3.z, colorPair);
        }

        const perimB = hasFour ? [p0, p1, p3, p2] : [p0, p1, p2];
        const perimT = hasFour ? [t0, t1, t3, t2] : [t0, t1, t2];
        for (let i = 0; i < perimB.length; i++) {
          const ni = (i + 1) % perimB.length;
          const bA = perimB[i], bB = perimB[ni];
          const uA = perimT[i], uB = perimT[ni];
          batch.addTriangle3D(bA.x, bA.y, bA.z, bB.x, bB.y, bB.z, uB.x, uB.y, uB.z, colorPair);
          batch.addTriangle3D(bA.x, bA.y, bA.z, uB.x, uB.y, uB.z, uA.x, uA.y, uA.z, colorPair);
          batch.addSegment(bA.x, bA.y, bA.z, bB.x, bB.y, bB.z, colorPair);
          batch.addSegment(uA.x, uA.y, uA.z, uB.x, uB.y, uB.z, colorPair);
          batch.addSegment(bA.x, bA.y, bA.z, uA.x, uA.y, uA.z, colorPair);
        }
      } else {
        batch.addTriangle2D(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p3.x, p3.y, p3.z, colorPair);
        if (hasFour) {
          batch.addTriangle2D(p0.x, p0.y, p0.z, p3.x, p3.y, p3.z, p2.x, p2.y, p2.z, colorPair);
        }
        batch.addSegment(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, colorPair);
        batch.addSegment(p1.x, p1.y, p1.z, p3.x, p3.y, p3.z, colorPair);
        if (hasFour) {
          batch.addSegment(p3.x, p3.y, p3.z, p2.x, p2.y, p2.z, colorPair);
          batch.addSegment(p2.x, p2.y, p2.z, p0.x, p0.y, p0.z, colorPair);
        } else {
          batch.addSegment(p3.x, p3.y, p3.z, p0.x, p0.y, p0.z, colorPair);
        }
      }
    }

    emitWipeoutOrImage(ent, dxf, batch, worldMat, parentContext) {
      if (ent.x === undefined || ent.x3 === undefined || ent.y3 === undefined) return;
      const origin = new THREE.Vector3(ent.x, ent.y || 0, ent.z || 0);
      const uVec = new THREE.Vector3(
        ent.x1 !== undefined ? ent.x1 : 1,
        ent.y1 !== undefined ? ent.y1 : 0,
        ent.z1 !== undefined ? ent.z1 : 0
      );
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
      const colorPair = this.resolveColorPair(ent, dxf, parentContext);

      batch.addTriangle3D(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, colorPair);
      if (p2.distanceToSquared(p3) > 1e-10) {
        batch.addTriangle3D(p0.x, p0.y, p0.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z, colorPair);
      }

      const flags = ent.flags || 0;
      if (!(flags & 1)) batch.addSegment(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, colorPair);
      if (!(flags & 2)) batch.addSegment(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, colorPair);
      if (!(flags & 4)) batch.addSegment(p2.x, p2.y, p2.z, p3.x, p3.y, p3.z, colorPair);
      if (!(flags & 8)) batch.addSegment(p3.x, p3.y, p3.z, p0.x, p0.y, p0.z, colorPair);
    }

    emitSubDMesh(ent, dxf, batch, worldMat, parentContext) {
      const verts = (ent.vertices || []).map(v => new THREE.Vector3(v.x, v.y, v.z || 0).applyMatrix4(worldMat));
      if (verts.length < 3) return;
      const colorPair = this.resolveColorPair(ent, dxf, parentContext);
      for (const face of (ent.faces || [])) {
        if (face.length < 3) continue;
        const p0 = verts[face[0]];
        if (!p0) continue;
        for (let i = 1; i < face.length - 1; i++) {
          const p1 = verts[face[i]], p2 = verts[face[i + 1]];
          if (p1 && p2) batch.addTriangle3D(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, colorPair);
        }
        for (let i = 0; i < face.length; i++) {
          const a = verts[face[i]], b = verts[face[(i + 1) % face.length]];
          if (a && b) batch.addSegment(a.x, a.y, a.z, b.x, b.y, b.z, colorPair);
        }
      }
    }

    emitACISSolid(ent, dxf, batch, worldMat, parentContext, stats) {
      const colorPair = this.resolveColorPair(ent, dxf, parentContext);
      if (stats) stats.acisEntities = (stats.acisEntities || 0) + 1;
      let satLines = null;
      let source = 'none';
      try {
        const resolved = resolveAcisSatLines(ent, dxf);
        satLines = resolved.satLines;
        source = resolved.source;
        if (source === 'sab' && stats) stats.acisSabMatched = (stats.acisSabMatched || 0) + 1;
      } catch (err) {
        if (stats) stats.acisSabFail = (stats.acisSabFail || 0) + 1;
        if (stats && stats.warnings) {
          stats.warnings.push('ACIS SAB convert failed #' + (ent.handle || '?') + ': ' + (err && err.message ? err.message : err));
        }
        return;
      }
      if (satLines && satLines.length > 0) {
        try {
          const result = emitReconstructedACIS(satLines, colorPair, batch, worldMat);
          if (stats) {
            if (source === 'sab') stats.acisSabOk = (stats.acisSabOk || 0) + 1;
            else stats.acisSatOk = (stats.acisSatOk || 0) + 1;
            if (result && result.emittedEdges) stats.acisEmittedEdges = (stats.acisEmittedEdges || 0) + result.emittedEdges;
            if (result) {
              stats.acisFacesTotal = (stats.acisFacesTotal || 0) + (result.facesTotal || 0);
              stats.acisFacesMeshed = (stats.acisFacesMeshed || 0) + (result.facesMeshed || 0);
              stats.acisFacesEdgeOnly = (stats.acisFacesEdgeOnly || 0) + (result.facesEdgeOnly || 0);
              stats.acisFaceTris = (stats.acisFaceTris || 0) + (result.faceTris || 0);
              if (result.faceStats) {
                if (!stats.acisFaceByType) stats.acisFaceByType = {};
                for (const k of Object.keys(result.faceStats)) {
                  const src = result.faceStats[k];
                  const dst = stats.acisFaceByType[k] || (stats.acisFaceByType[k] = { total: 0, meshed: 0, tris: 0 });
                  dst.total += src.total || 0;
                  dst.meshed += src.meshed || 0;
                  dst.tris += src.tris || 0;
                }
              }
            }
          }
        } catch (err) {
          if (stats) stats.acisSabFail = (stats.acisSabFail || 0) + 1;
          if (stats && stats.warnings) {
            stats.warnings.push('ACIS rebuild failed #' + (ent.handle || '?') + ': ' + (err && err.message ? err.message : err));
          }
        }
      } else if (stats) {
        stats.acisEmpty = (stats.acisEmpty || 0) + 1;
      }
    }

    // ==========================================================================
    // HATCH & MPOLYGON
    // ==========================================================================
    emitHatch(ent, dxf, batch, worldMat, parentContext) {
      if (!ent.loops || ent.loops.length === 0) return;
      const colorPair = this.resolveColorPair(ent, dxf, parentContext);
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
              batch.addTriangle2D(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, colorPair);
            }
          } else {
            const bgTintPair = {
              light: new THREE.Color(colorPair.light).lerp(new THREE.Color(0xFFFFFF), 0.82).getHex(),
              dark: new THREE.Color(colorPair.dark).lerp(new THREE.Color(0x0F172A), 0.78).getHex()
            };
            for (const [i0, i1, i2] of tris) {
              const p0 = new THREE.Vector3(allPts[i0].x, allPts[i0].y, zElev - 0.01).applyMatrix4(combMat);
              const p1 = new THREE.Vector3(allPts[i1].x, allPts[i1].y, zElev - 0.01).applyMatrix4(combMat);
              const p2 = new THREE.Vector3(allPts[i2].x, allPts[i2].y, zElev - 0.01).applyMatrix4(combMat);
              batch.addTriangle2D(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, bgTintPair);
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
              batch.addSegmentsArray(coords, colorPair);
            }
          } else {
            const baseAngleDeg = 45 + (ent.patternAngle || 0);
            const angleRad = THREE.MathUtils.degToRad(baseAngleDeg);
            const coords1 = this.generateClippedHatchCoords(outer, holes, angleRad, (ent.patternScale || 1.0) * 2.5, zElev, combMat);
            batch.addSegmentsArray(coords1, colorPair);
            if (patName === 'ANSI37' || patName === 'NET' || patName === 'CROSS' || patName === 'BOX') {
              const coords2 = this.generateClippedHatchCoords(outer, holes, angleRad + Math.PI / 2, (ent.patternScale || 1.0) * 2.5, zElev, combMat);
              batch.addSegmentsArray(coords2, colorPair);
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
      if (!text.trim()) return;
      const styleDef = dxf.tables.styles[normKey(ent.textStyle, 'STANDARD')] || {};
      const resolvedFontStack = mapCADFontToSystemFont(styleDef.font, styleDef.bigFont, this.options.fontFamily);
      let height = (ent.height !== undefined && ent.height > 0)
        ? ent.height
        : ((styleDef.height && styleDef.height > 0) ? styleDef.height : (dxf.header['$TEXTSIZE'] || 2.5));
      let widthFactor = (ent.xscale !== undefined && ent.xscale > 0)
        ? ent.xscale
        : ((styleDef.widthFactor && styleDef.widthFactor > 0) ? styleDef.widthFactor : 1.0);
      const obliqueDeg = ent.oblique !== undefined ? ent.oblique : (styleDef.obliqueAngle || 0);
      let rotRad = THREE.MathUtils.degToRad(ent.rotation || 0);
      const colorPair = this.resolveColorPair(ent, dxf, parentContext);

      let halign = ent.halign || 0;
      let valign = ent.valign || 0;
      const ocsMat = getOCS2WCSMatrix(ent.extrusion);

      let basePt;
      let fitSpanWorld = 0;
      let fitMode = 0;

      if ((halign === 3 || halign === 5) && ent.x1 !== undefined && ent.y1 !== undefined) {
        const p1 = new THREE.Vector3(ent.x || 0, ent.y || 0, ent.z || 0);
        const p2 = new THREE.Vector3(ent.x1 || 0, ent.y1 || 0, ent.z1 !== undefined ? ent.z1 : (ent.z || 0));
        const span = p1.distanceTo(p2);
        if (span > 1e-4) {
          rotRad = Math.atan2(p2.y - p1.y, p2.x - p1.x);
          basePt = p1.clone().add(p2).multiplyScalar(0.5);
          fitSpanWorld = span;
          fitMode = halign;
          halign = 1;
          valign = 0;
        } else {
          basePt = p1;
          halign = 0;
        }
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

      const effLayer = (normKey(ent.layer, '0') === '0' && parentContext && parentContext.layer) ? parentContext.layer : normKey(ent.layer, '0');
      const lObj = dxf.tables.layers[effLayer];
      textAtlas.addRichTextQuad(
        [[{ type: 'text', text, style: { scale: 1, widthFactor, oblique: obliqueDeg } }]],
        height, colorPair, halign, valign, finalMat, originShift, null, 0, resolvedFontStack,
        {
          plainText: text,
          rawText: raw,
          type: ent.type || 'TEXT',
          handle: ent.handle || '',
          layer: effLayer,
          displayLayer: (lObj && lObj.displayName) || ent.displayLayer || effLayer,
          parentBlock: (parentContext && parentContext.blockName) || null,
          entity: ent
        },
        fitSpanWorld,
        fitMode
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
      const colorPair = this.resolveColorPair(ent, dxf, parentContext);
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
          h, colorPair, 1, 0, charMat, originShift
        );
      });
    }

    emitMText(ent, dxf, batch, textAtlas, worldMat, originShift, parentContext) {
      const raw = ent.text;
      if (!raw || String(raw).trim() === '') return;
      const styleDef = dxf.tables.styles[normKey(ent.textStyle, 'STANDARD')] || {};
      const resolvedFontStack = mapCADFontToSystemFont(styleDef.font, styleDef.bigFont, this.options.fontFamily);
      const height = (ent.height !== undefined && ent.height > 0)
        ? ent.height
        : ((styleDef.height && styleDef.height > 0) ? styleDef.height : (dxf.header['$TEXTSIZE'] || 2.5));
      const defWf = (styleDef.widthFactor && styleDef.widthFactor > 0) ? styleDef.widthFactor : 1.0;
      const defOblique = styleDef.obliqueAngle || 0;
      const colorPair = this.resolveColorPair(ent, dxf, parentContext);
      const lines = parseMTextRichTokens(raw, defWf, defOblique);

      const ap = (ent.attachmentPoint >= 1 && ent.attachmentPoint <= 9) ? ent.attachmentPoint : 1;
      let halign = (ap - 1) % 3;
      const vRow = Math.floor((ap - 1) / 3);
      let valign = vRow === 0 ? 3 : (vRow === 1 ? 2 : 1);

      if (lines.inlineHAlign !== null && lines.inlineHAlign !== undefined) halign = lines.inlineHAlign;

      let rotRad = THREE.MathUtils.degToRad(ent.rotation || 0);
      if (ent.x1 !== undefined && ent.y1 !== undefined && (Math.abs(ent.x1) > 1e-6 || Math.abs(ent.y1) > 1e-6)) {
        rotRad = Math.atan2(ent.y1, ent.x1);
      }

      const localMat = new THREE.Matrix4()
        .makeTranslation(ent.x || 0, ent.y || 0, ent.z || 0)
        .multiply(new THREE.Matrix4().makeRotationZ(rotRad));
      const finalMat = new THREE.Matrix4().multiplyMatrices(worldMat, localMat);

      const effLayer = (normKey(ent.layer, '0') === '0' && parentContext && parentContext.layer) ? parentContext.layer : normKey(ent.layer, '0');
      const lObj = dxf.tables.layers[effLayer];
      const plainStr = lines.map(l => l.map(r => r.type === 'stack' ? `${r.upper}/${r.lower}` : (r.text || '')).join('')).join('\n').trim();
      if (!plainStr) return;

      textAtlas.addRichTextQuad(
        lines, height, colorPair, halign, valign, finalMat, originShift, null, ent.refWidth || 0, resolvedFontStack,
        {
          plainText: plainStr,
          rawText: raw,
          type: 'MTEXT',
          handle: ent.handle || '',
          layer: effLayer,
          displayLayer: (lObj && lObj.displayName) || ent.displayLayer || effLayer,
          parentBlock: (parentContext && parentContext.blockName) || null,
          entity: ent
        }
      );
    }

    emitAcadTable(ent, dxf, batch, textAtlas, worldMat, originShift, parentContext) {
      const rows = Math.max(1, ent.numRows || (ent.rowHeights ? ent.rowHeights.length : 2));
      const cols = Math.max(1, ent.numCols || (ent.colWidths ? ent.colWidths.length : 3));
      const rHeights = [];
      for (let r = 0; r < rows; r++) rHeights.push(ent.rowHeights[r] || 8.0);
      const cWidths = [];
      for (let c = 0; c < cols; c++) cWidths.push(ent.colWidths[c] || 24.0);

      const ox = ent.x || 0, oy = ent.y || 0, oz = ent.z || 0;
      const colorPair = this.resolveColorPair(ent, dxf, parentContext);
      const totalW = cWidths.reduce((a, b) => a + b, 0);
      const totalH = rHeights.reduce((a, b) => a + b, 0);

      if (rows >= 1) {
        const hdrH = rHeights[0];
        const a = new THREE.Vector3(ox, oy, oz - 0.02).applyMatrix4(worldMat);
        const b = new THREE.Vector3(ox + totalW, oy, oz - 0.02).applyMatrix4(worldMat);
        const c = new THREE.Vector3(ox + totalW, oy - hdrH, oz - 0.02).applyMatrix4(worldMat);
        const d = new THREE.Vector3(ox, oy - hdrH, oz - 0.02).applyMatrix4(worldMat);
        const hdrPair = { light: 0xE2E8F0, dark: 0x1E293B };
        batch.addTriangle2D(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, hdrPair);
        batch.addTriangle2D(a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z, hdrPair);
      }

      let curY = oy;
      for (let r = 0; r <= rows; r++) {
        const p1 = new THREE.Vector3(ox, curY, oz).applyMatrix4(worldMat);
        const p2 = new THREE.Vector3(ox + totalW, curY, oz).applyMatrix4(worldMat);
        batch.addSegment(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, colorPair);
        if (r < rows) curY -= rHeights[r];
      }
      let curX = ox;
      for (let c = 0; c <= cols; c++) {
        const p1 = new THREE.Vector3(curX, oy, oz).applyMatrix4(worldMat);
        const p2 = new THREE.Vector3(curX, oy - totalH, oz).applyMatrix4(worldMat);
        batch.addSegment(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, colorPair);
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
            this.emitLabelHelper(String(cell.text).trim(), th, colorPair, cx, cy, oz, 0, batch, textAtlas, worldMat, originShift);
          }
          colLeft += cw;
        }
        rowTop -= rh;
      }
    }

    // ==========================================================================
    // Dimensions, Leaders, MLeaders & GD&T Tolerances
    // ==========================================================================
    emitLabelHelper(labelStr, txtHeight, colorPair, x, y, z, rotRad, batch, textAtlas, worldMat, originShift, metaEnt = null, parentContext = null) {
      const mat = new THREE.Matrix4()
        .multiplyMatrices(worldMat, new THREE.Matrix4().makeTranslation(x, y, z))
        .multiply(new THREE.Matrix4().makeRotationZ(rotRad));
      const lines = parseMTextRichTokens(labelStr, 0.85, 0);
      const effLayer = metaEnt ? normKey(metaEnt.layer, '0') : ((parentContext && parentContext.layer) || batch.layerName || '0');
      textAtlas.addRichTextQuad(
        lines, txtHeight, colorPair, 1, 2, mat, originShift, null, 0, null,
        {
          plainText: decodeMIFAndSpecialChars(labelStr),
          rawText: labelStr,
          type: (metaEnt && metaEnt.type) || 'DIMENSION',
          handle: (metaEnt && metaEnt.handle) || '',
          layer: effLayer,
          displayLayer: batch.displayName || effLayer,
          parentBlock: (parentContext && parentContext.blockName) || null,
          entity: metaEnt
        }
      );
    }

    emitArrowhead(tip, dirUnit, arrowSize, colorPair, batch, worldMat, arrowType = 'CLOSED') {
      const back = dirUnit.clone().negate();
      const perp = new THREE.Vector3(-dirUnit.y, dirUnit.x, 0).multiplyScalar(arrowSize * 0.18);
      const base = tip.clone().addScaledVector(back, arrowSize);
      const tTip = tip.clone().applyMatrix4(worldMat);

      if (arrowType.includes('TICK') || arrowType.includes('OBLIQUE')) {
        const diag = dirUnit.clone().add(new THREE.Vector3(-dirUnit.y, dirUnit.x, 0)).normalize().multiplyScalar(arrowSize * 0.5);
        const a = tip.clone().sub(diag).applyMatrix4(worldMat);
        const b = tip.clone().add(diag).applyMatrix4(worldMat);
        batch.addSegment(a.x, a.y, a.z, b.x, b.y, b.z, colorPair);
        return;
      }

      const p1 = base.clone().add(perp).applyMatrix4(worldMat);
      const p2 = base.clone().sub(perp).applyMatrix4(worldMat);
      batch.addTriangle2D(tTip.x, tTip.y, tTip.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, colorPair);
      batch.addSegment(tTip.x, tTip.y, tTip.z, p1.x, p1.y, p1.z, colorPair);
      batch.addSegment(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, colorPair);
      batch.addSegment(p2.x, p2.y, p2.z, tTip.x, tTip.y, tTip.z, colorPair);
    }

    emitDimension(ent, dxf, getCollector, batch, textAtlas, worldMat, originShift, parentContext, depth, stats) {
      const ocsMat = getOCS2WCSMatrix(ent.extrusion);

      if (this.options.dimensionMode === 'auto' && ent.name && dxf.blocks[ent.name]) {
        const blk = dxf.blocks[ent.name];
        const hasVisibleGeom = (blk.entities || []).some(e => e.type !== 'POINT' && e.type !== 'ATTDEF');
        if (hasVisibleGeom) {
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
      const colorPair = this.resolveColorPair(ent, dxf, parentContext);
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
        batch.addSegment(wa.x, wa.y, wa.z, wb.x, wb.y, wb.z, colorPair);
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
        this.emitArrowhead(d1, unitSpan.clone().negate(), arrowSize, colorPair, batch, worldMat, arrowBlkName);
        this.emitArrowhead(d2, unitSpan, arrowSize, colorPair, batch, worldMat, arrowBlkName);

        const midPt = (ent.x1 !== undefined && ent.y1 !== undefined && (Math.abs(ent.x1) > 1e-5 || Math.abs(ent.y1) > 1e-5))
          ? new THREE.Vector3(ent.x1, ent.y1, ent.z1 || 0).applyMatrix4(ocsMat)
          : new THREE.Vector3().addVectors(d1, d2).multiplyScalar(0.5).addScaledVector(extNormal, gap + txtHeight * 0.72);
        let textAngle = Math.atan2(unitSpan.y, unitSpan.x);
        if (textAngle > Math.PI * 0.5 || textAngle <= -Math.PI * 0.5) textAngle += Math.PI;
        this.emitLabelHelper(formatDimText(measurement), txtHeight, colorPair, midPt.x, midPt.y, midPt.z, textAngle, batch, textAtlas, worldMat, originShift, ent, parentContext);
      } else if (dimType === 3 || dimType === 4) {
        const pt10 = new THREE.Vector3(ent.x || 0, ent.y || 0, ent.z || 0);
        const pt15 = new THREE.Vector3(ent.x5 !== undefined ? ent.x5 : (pt10.x + 10), ent.y5 !== undefined ? ent.y5 : pt10.y, ent.z5 || 0);
        const spanVec = new THREE.Vector3().subVectors(pt15, pt10);
        const dist = spanVec.length() || 10;
        const unitR = spanVec.clone().normalize();
        addWSeg(pt10, pt15);
        this.emitArrowhead(pt15, unitR, arrowSize, colorPair, batch, worldMat, arrowBlkName);
        if (dimType === 3) this.emitArrowhead(pt10, unitR.clone().negate(), arrowSize, colorPair, batch, worldMat, arrowBlkName);

        const prefix = dimType === 3 ? '⌀' : 'R';
        const measured = ent.actualMeasurement || dist;
        const txtPos = (ent.x1 !== undefined && ent.y1 !== undefined && (Math.abs(ent.x1) > 1e-5 || Math.abs(ent.y1) > 1e-5))
          ? new THREE.Vector3(ent.x1, ent.y1, ent.z1 || 0).applyMatrix4(ocsMat)
          : pt10.clone().addScaledVector(unitR, dist * 0.55);
        let textAngle = Math.atan2(unitR.y, unitR.x);
        if (textAngle > Math.PI * 0.5 || textAngle <= -Math.PI * 0.5) textAngle += Math.PI;
        const perp = new THREE.Vector3(-Math.sin(textAngle), Math.cos(textAngle), 0);
        const finalPos = txtPos.clone().addScaledVector(perp, gap + txtHeight * 0.70);
        this.emitLabelHelper(formatDimText(measured, prefix), txtHeight, colorPair, finalPos.x, finalPos.y, finalPos.z, textAngle, batch, textAtlas, worldMat, originShift, ent, parentContext);
      } else if (dimType === 2 || dimType === 5) {
        let vertex, p1, p2, arcPt;
        if (dimType === 5) {
          vertex = new THREE.Vector3(ent.x5 !== undefined ? ent.x5 : 0, ent.y5 !== undefined ? ent.y5 : 0, 0);
          p1 = new THREE.Vector3(ent.x3 !== undefined ? ent.x3 : (vertex.x + 10), ent.y3 !== undefined ? ent.y3 : vertex.y, 0);
          p2 = new THREE.Vector3(ent.x4 !== undefined ? ent.x4 : vertex.x, ent.y4 !== undefined ? ent.y4 : (vertex.y + 10), 0);
          arcPt = new THREE.Vector3(ent.x || 0, ent.y || 0, 0);
        } else {
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
        this.emitPolylineToBatch(arcPts, ent, dxf, batch, worldMat, parentContext, false, colorPair, false);
        addWSeg(vertex.clone().addScaledVector(new THREE.Vector3(Math.cos(a1), Math.sin(a1), 0), exo), arcPts[0].clone().addScaledVector(new THREE.Vector3(Math.cos(a1), Math.sin(a1), 0), exe));
        addWSeg(vertex.clone().addScaledVector(new THREE.Vector3(Math.cos(a2), Math.sin(a2), 0), exo), arcPts[steps].clone().addScaledVector(new THREE.Vector3(Math.cos(a2), Math.sin(a2), 0), exe));
        this.emitArrowhead(arcPts[0], new THREE.Vector3(Math.sin(a1), -Math.cos(a1), 0), arrowSize, colorPair, batch, worldMat, arrowBlkName);
        this.emitArrowhead(arcPts[steps], new THREE.Vector3(-Math.sin(a2), Math.cos(a2), 0), arrowSize, colorPair, batch, worldMat, arrowBlkName);

        const midA = a1 + sweep * 0.5;
        this.emitLabelHelper(
          formatDimText(THREE.MathUtils.radToDeg(sweep), '', '°'),
          txtHeight, colorPair,
          vertex.x + (rArc + gap + txtHeight * 0.55) * Math.cos(midA),
          vertex.y + (rArc + gap + txtHeight * 0.55) * Math.sin(midA),
          0, 0, batch, textAtlas, worldMat, originShift, ent, parentContext
        );
      } else if (dimType === 6) {
        const datumOrigin = new THREE.Vector3(ent.x || 0, ent.y || 0, ent.z || 0);
        const featurePt = new THREE.Vector3(ent.x3 || 0, ent.y3 || 0, ent.z3 || 0);
        const leaderEnd = new THREE.Vector3(ent.x4 !== undefined ? ent.x4 : (featurePt.x + 10), ent.y4 !== undefined ? ent.y4 : (featurePt.y + 10), ent.z4 || 0);
        const isXDatum = ((ent.flags || 0) & 64) !== 0;
        const jogPt = isXDatum
          ? new THREE.Vector3(featurePt.x, leaderEnd.y - Math.sign(leaderEnd.y - featurePt.y || 1) * arrowSize, 0)
          : new THREE.Vector3(leaderEnd.x - Math.sign(leaderEnd.x - featurePt.x || 1) * arrowSize, featurePt.y, 0);
        this.emitPolylineToBatch([featurePt, jogPt, leaderEnd], ent, dxf, batch, worldMat, parentContext, false, colorPair, false);
        const val = ent.actualMeasurement !== undefined
          ? ent.actualMeasurement
          : (isXDatum ? Math.abs(featurePt.x - datumOrigin.x) : Math.abs(featurePt.y - datumOrigin.y));
        this.emitLabelHelper(formatDimText(val), txtHeight, colorPair, leaderEnd.x + txtHeight, leaderEnd.y + txtHeight * 0.4, 0, 0, batch, textAtlas, worldMat, originShift, ent, parentContext);
      }
    }

    emitLeader(ent, dxf, batch, worldMat, parentContext) {
      const verts = ent.vertices || [];
      if (verts.length < 2) return;
      const colorPair = this.resolveColorPair(ent, dxf, parentContext);
      const ds = dxf.tables.dimstyles[normKey(ent.dimstyle, 'STANDARD')] || {};
      const arrowSize = (ds.dimasz || dxf.header['$DIMASZ'] || 2.5) * (ds.dimscale || dxf.header['$DIMSCALE'] || 1.0);
      const pts = verts.map(v => new THREE.Vector3(v.x, v.y, v.z || 0));
      this.emitPolylineToBatch(pts, ent, dxf, batch, worldMat, parentContext, false, colorPair, false);
      if (ent.hasArrow !== false) {
        const dir = new THREE.Vector3().subVectors(pts[0], pts[1]).normalize();
        this.emitArrowhead(pts[0], dir, arrowSize, colorPair, batch, worldMat);
      }
    }

    emitMLeader(ent, dxf, batch, textAtlas, worldMat, originShift, parentContext) {
      const colorPair = this.resolveColorPair(ent, dxf, parentContext);
      const arrowSize = ent.arrowSize || 2.5;
      const txtH = ent.textHeight || 2.5;

      for (const branch of (ent.leaderBranches || [])) {
        if (branch.length >= 2) {
          const pts = branch.map(v => new THREE.Vector3(v.x, v.y, v.z || 0));
          if (ent.landingPt) pts.push(new THREE.Vector3(ent.landingPt.x, ent.landingPt.y, ent.landingPt.z || 0));
          this.emitPolylineToBatch(pts, ent, dxf, batch, worldMat, parentContext, false, colorPair, false);
          const dir = new THREE.Vector3().subVectors(pts[0], pts[1]).normalize();
          this.emitArrowhead(pts[0], dir, arrowSize, colorPair, batch, worldMat);
        }
      }

      if (ent.text) {
        const tp = ent.textPos || ent.landingPt || (ent.leaderBranches[0] && ent.leaderBranches[0][ent.leaderBranches[0].length - 1]) || { x: 0, y: 0, z: 0 };
        const mat = new THREE.Matrix4().multiplyMatrices(worldMat, new THREE.Matrix4().makeTranslation(tp.x + txtH * 0.4, tp.y, tp.z || 0));
        const lines = parseMTextRichTokens(ent.text, 0.85, 0);
        textAtlas.addRichTextQuad(lines, txtH, colorPair, 0, 2, mat, originShift);
      }
    }

    emitTolerance(ent, dxf, batch, textAtlas, worldMat, originShift, parentContext) {
      const raw = ent.text || '⌖%%v⌀0.02%%vA%%vB';
      const cleaned = decodeMIFAndSpecialChars(raw).replace(/\{|\}/g, '');
      const cells = cleaned.split(/%%v/i).filter(Boolean);
      const h = (ent.height !== undefined && ent.height > 0) ? ent.height : (dxf.header['$DIMTXT'] || 2.5);
      const boxH = h * 1.8;
      const colorPair = this.resolveColorPair(ent, dxf, parentContext);
      const ox = ent.x || 0, oy = ent.y || 0, oz = ent.z || 0;

      let curX = ox;
      for (const cellText of cells) {
        const cellW = Math.max(boxH, cellText.length * h * 0.78 + h * 0.6);
        const p0 = new THREE.Vector3(curX, oy - boxH * 0.5, oz);
        const p1 = new THREE.Vector3(curX + cellW, oy - boxH * 0.5, oz);
        const p2 = new THREE.Vector3(curX + cellW, oy + boxH * 0.5, oz);
        const p3 = new THREE.Vector3(curX, oy + boxH * 0.5, oz);
        this.emitPolylineToBatch([p0, p1, p2, p3], ent, dxf, batch, worldMat, parentContext, true, colorPair, false);
        this.emitLabelHelper(cellText, h * 0.88, colorPair, curX + cellW * 0.5, oy, oz, 0, batch, textAtlas, worldMat, originShift);
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
          colorPair: this.resolveColorPair(ent, dxf, parentContext),
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
        colorPair: this.resolveColorPair(insertEnt, dxf, parentContext),
        linetype: normKey(insertEnt.linetype, 'BYLAYER'),
        blockName: blk.name || insertEnt.name || (parentContext && parentContext.blockName) || null,
        parentInsert: insertEnt
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
            // Remember which block reference this entity belongs to, so the
            // host application can select a whole INSERT when any of its
            // members is picked (AutoCAD behaves the same way).
            if (!childEnt.parentInsert) childEnt.parentInsert = insertEnt;
            if (!childEnt.parentBlockName) childEnt.parentBlockName = blk.name || insertEnt.name || null;
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
  DXFLoader.mapCADFontToSystemFont = mapCADFontToSystemFont;
  DXFLoader.sabBytesToSatLines = sabBytesToSatLines;
  DXFLoader.hexStringToUint8Array = hexStringToUint8Array;
  DXFLoader.resolveAcisSatLines = resolveAcisSatLines;

  return DXFLoader;
});
