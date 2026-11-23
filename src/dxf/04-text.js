/**
 * @license GPL-3.0
 * threejs-dxf-loader - Rich MTEXT inline-code parser and the multi-page filled text atlas.
 */
import * as THREE from 'three';
import { ACI_PALETTE, DEFAULT_CAD_FONT_STACK, Float32GrowableBuffer, adaptHexForDarkBackground, adaptHexForLightBackground, decodeMIFAndSpecialChars, hexToLinearRgb, mapCADFontToSystemFont } from './00-util.js';

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
    strike: false,
    tracking: 1.0
  }];

  const currentStyle = () => Object.assign({}, styleStack[styleStack.length - 1]);
  let buf = '';
  const flushBuf = () => {
    if (buf.length > 0) {
      lines[lines.length - 1].push({ type: 'text', text: buf, style: currentStyle() });
      buf = '';
    }
  };

  const validCmdRe = /^[ACcFfHWQTtSpa]$/;
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
      else if (next === 'L') {
        flushBuf();
        styleStack[styleStack.length - 1].underline = true;
        i += 2;
      } else if (next === 'l') {
        flushBuf();
        styleStack[styleStack.length - 1].underline = false;
        i += 2;
      } else if (next === 'O') {
        flushBuf();
        styleStack[styleStack.length - 1].overline = true;
        i += 2;
      } else if (next === 'o') {
        flushBuf();
        styleStack[styleStack.length - 1].overline = false;
        i += 2;
      } else if (next === 'K') {
        flushBuf();
        styleStack[styleStack.length - 1].strike = true;
        i += 2;
      } else if (next === 'k') {
        flushBuf();
        styleStack[styleStack.length - 1].strike = false;
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
            // \p<args>; — paragraph formatting
            // qc/ql/qr: alignment  xl<n>: first-line indent  r<n>: remaining indent
            if (arg.includes('qc')) lines.inlineHAlign = 1;
            else if (arg.includes('qr')) lines.inlineHAlign = 2;
            else if (arg.includes('ql')) lines.inlineHAlign = 0;
            else if (arg.includes('qj')) lines.inlineHAlign = 0; // justified → left for now
            // Store indent on the current paragraph line so the layout pass
            // can offset the first run by the requested amount.
            const indentMatch = arg.match(/x\s*l([0-9.]+)/i);
            if (indentMatch) {
              const lastLine = lines[lines.length - 1];
              lastLine.paragraphIndentFirst = parseFloat(indentMatch[1]) || 0;
            }
            const hangMatch = arg.match(/r([0-9.]+)/i);
            if (hangMatch) {
              const lastLine = lines[lines.length - 1];
              lastLine.paragraphIndentRest = parseFloat(hangMatch[1]) || 0;
            }
          } else if (cmd === 'H') {
            if (arg.endsWith('x') || arg.endsWith('X')) {
              // \Hnx — height relative to the MTEXT entity's base height.
              // This is an absolute multiplier from the base, not cumulative:
              // \H1.05x; always means 1.05× the entity height regardless of
              // any previous \H command in the same span.
              const factor = parseFloat(arg);
              if (!isNaN(factor) && factor > 0) top.scale = factor;
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
          } else if (cmd === 'T' || cmd === 't') {
            // \Tn; — tracking (character spacing) factor, 1.0 = normal
            const trk = parseFloat(arg);
            if (!isNaN(trk)) top.tracking = trk;
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
  constructor(fontFamily, onVertexAdded, nominalPx = 96, getPickId = null, pageSize = 4096, maxPages = 64) {
    this.size = Math.max(512, Math.min(4096, Math.round(pageSize) || 4096));
    this.fontFamily = fontFamily || DEFAULT_CAD_FONT_STACK;
    this.onVertexAdded = onVertexAdded || null;
    this.nominalPx = nominalPx;
    this.getPickId = getPickId || (() => -1);
    this.hasDOM = typeof document !== 'undefined';
    this.pages = [];
    this.maxPages = Math.max(1, Math.round(maxPages) || 64);
    this.droppedQuads = 0;
    this.cache = new Map();
    this.measureCache = new Map();
    this.textRecords = [];
    // Pages are allocated lazily on the first glyph: a 3D or line-only drawing
    // never reserves a large atlas canvas (a 4096² page is ~64 MB of VRAM).
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

  /** Number of atlas pages actually allocated. */
  get textAtlasPages() {
    return this.pages.length;
  }

  /** Number of text items that could not fit in the atlas. */
  get droppedTextCount() {
    return this.droppedQuads;
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
    if (this.pages.length === 0) this.allocateNewPage();

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
      if (this.pages.length >= this.maxPages && this.pages[this.pages.length - 1].cursorY > this.size - 128) {
        this.droppedQuads += 1;
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
            const trk = st.tracking || 1.0;
            const ob = st.oblique || 0;
            const shearExtra = Math.abs(Math.tan(THREE.MathUtils.degToRad(ob))) * curCapH * scale * 0.65;
            if (run.type === 'stack') {
              const subPx = curPxBase * scale * 0.58;
              const fStr = buildFontStr(st, subPx);
              const uw = this.measureCached(ctx, fStr, run.upper) * wf;
              const lw = this.measureCached(ctx, fStr, run.lower) * wf;
              const rw = (Math.max(uw, lw) + 6 + shearExtra) * trk;
              w += rw;
              return { run, rw, pxSize: curPxBase * scale, subPx, wf, trk };
            } else {
              const pxSize = curPxBase * scale;
              const fStr = buildFontStr(st, pxSize);
              const rw = (this.measureCached(ctx, fStr, run.text) * wf + shearExtra) * trk;
              w += rw;
              return { run, rw, pxSize, wf, trk };
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
            // Underline / overline / strikethrough lines
            const lw = Math.max(0.8, pxSize * 0.07);
            if (st.underline) {
              drawCtx.lineWidth = lw;
              drawCtx.beginPath();
              drawCtx.moveTo(0, capHeightPx * 0.18);
              drawCtx.lineTo(rw / wf, capHeightPx * 0.18);
              drawCtx.stroke();
            }
            if (st.overline) {
              drawCtx.lineWidth = lw;
              drawCtx.beginPath();
              drawCtx.moveTo(0, -capHeightPx * 1.1);
              drawCtx.lineTo(rw / wf, -capHeightPx * 1.1);
              drawCtx.stroke();
            }
            if (st.strike) {
              drawCtx.lineWidth = lw;
              drawCtx.beginPath();
              drawCtx.moveTo(0, -capHeightPx * 0.44);
              drawCtx.lineTo(rw / wf, -capHeightPx * 0.44);
              drawCtx.stroke();
            }
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

export { parseMTextRichTokens, MultiPageTextAtlas };
