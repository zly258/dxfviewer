/**
 * @license GPL-3.0
 * threejs-dxf-loader - Fault-tolerant DXF tokeniser, section parser and per-entity parsers.
 */
import { normKey } from './00-util.js';
import { hexStringToUint8Array } from './02-acis.js';

/** Fast all-ASCII-digits test (replaces a per-line regex in the tokeniser). */
function allDigits(s) {
  const n = s.length;
  if (n === 0) return false;
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
}

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

      if (!allDigits(trimmedCode)) {
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

      if (!allDigits(trimmedCode)) {
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

export { DXFParser };
