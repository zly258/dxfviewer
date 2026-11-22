/**
 * @license MIT
 * threejs-dxf-loader - Main DXFLoader: scene building, per-entity geometry emitters, instant theme switching.
 */
import * as THREE from 'three';
import { ACI_PALETTE, DEFAULT_CAD_FONT_STACK, Float32GrowableBuffer, adaptHexForDarkBackground, adaptHexForLightBackground, decodeDXFArrayBuffer, decodeMIFAndSpecialChars, hexToLinearRgb, mapCADFontToSystemFont, normKey } from './00-util.js';
import { evaluateNurbsSpline, getOCS2WCSMatrix, interpolateBulgePoints } from './01-math.js';
import { emitReconstructedACIS, hexStringToUint8Array, resolveAcisSatLines, sabBytesToSatLines } from './02-acis.js';
import { classifyHatchLoops, tessellatePolylineSegmentsToBatch } from './03-hatch.js';
import { MultiPageTextAtlas, parseMTextRichTokens } from './04-text.js';
import { DXFParser } from './05-parser.js';
import { LayerBatchCollector } from './06-batch.js';

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
      // Side length (px) of each text-atlas page. 4096 keeps text crisp but is
      // ~64 MB of VRAM per page; lower it (1024-2048) on memory-constrained
      // devices. Pages are allocated lazily, only when a drawing has text.
      textAtlasPageSize: 4096,
      // Safety cap on the number of atlas pages; text beyond it is counted in
      // stats.droppedText instead of being dropped silently.
      textAtlasMaxPages: 64,
      // Maximum number of segments used for a full circle / closed curve.
      maxCurveSegments: 192,
      // Scale curve tessellation by radius relative to the model size: a tiny
      // circle does not need the full segment budget. Set false to always use
      // curveSegments for every circle/arc.
      adaptiveCurveSegments: true
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
  /**
   * Release the GPU/CPU resources held by a scene returned by parse/parseAsync.
   * Call before discarding the viewer or loading another drawing.
   */
  static dispose(rootGroup) {
    if (!rootGroup) return;
    rootGroup.traverse((obj) => {
      if (obj.geometry && typeof obj.geometry.dispose === 'function') obj.geometry.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : (obj.material ? [obj.material] : []);
      for (const m of mats) {
        if (!m) continue;
        if (m.map && typeof m.map.dispose === 'function') m.map.dispose();
        if (typeof m.dispose === 'function') m.dispose();
      }
    });
    if (rootGroup.parent) rootGroup.parent.remove(rootGroup);
  }

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

    // Model diagonal used to pick a radius-appropriate tessellation density.
    let modelSpan = 0;
    if (dxf.header && dxf.header.$EXTMAX && dxf.header.$EXTMIN) {
      const dx = Math.abs((dxf.header.$EXTMAX.x || 0) - (dxf.header.$EXTMIN.x || 0));
      const dy = Math.abs((dxf.header.$EXTMAX.y || 0) - (dxf.header.$EXTMIN.y || 0));
      modelSpan = Math.hypot(dx, dy);
    }
    this._activeModelSpan = modelSpan;

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
    const textAtlas = new MultiPageTextAtlas(
      this.options.fontFamily,
      onVertexAdded,
      nominalTextPx,
      getPickId,
      this.options.textAtlasPageSize || 4096,
      this.options.textAtlasMaxPages || 64
    );
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
      textAtlasPages: 0,
      droppedText: 0,
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
      if (tr.parentBlock && tr.entity) {
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
    stats.textAtlasPages = textAtlas.textAtlasPages;
    stats.droppedText = textAtlas.droppedTextCount;
    if (textAtlas.droppedTextCount > 0) {
      stats.warnings.push(`${textAtlas.droppedTextCount} text item(s) could not fit in the text atlas (increase textAtlasMaxPages or lower textAtlasPageSize).`);
    }

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

      // Every emitted entity MUST get a pick record: the renderer writes
      // `currentPickId` into the batch and the picker looks that id up here.
      // Capping the array at 50000 made all later entities share one missing
      // id, so point picking silently stopped working on large drawings.
      let entBox = null;
      if (bState.curEntMinX <= bState.curEntMaxX) {
        entBox = new THREE.Box3(
          new THREE.Vector3(bState.curEntMinX, bState.curEntMinY, bState.curEntMinZ),
          new THREE.Vector3(bState.curEntMaxX, bState.curEntMaxY, bState.curEntMaxZ)
        );
        if (ent.type !== 'XLINE' && ent.type !== 'RAY') {
          globalBBox.union(entBox);
        }
      }
      if (!entBox) entBox = new THREE.Box3();
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

      // Every emitted entity MUST get a pick record: the renderer writes
      // `currentPickId` into the batch and the picker looks that id up here.
      // Capping the array at 50000 made all later entities share one missing
      // id, so point picking silently stopped working on large drawings.
      let entBox = null;
      if (bState.curEntMinX <= bState.curEntMaxX) {
        entBox = new THREE.Box3(
          new THREE.Vector3(bState.curEntMinX, bState.curEntMinY, bState.curEntMinZ),
          new THREE.Vector3(bState.curEntMaxX, bState.curEntMaxY, bState.curEntMaxZ)
        );
        if (ent.type !== 'XLINE' && ent.type !== 'RAY') {
          globalBBox.union(entBox);
        }
      }
      if (!entBox) entBox = new THREE.Box3();
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

  /**
   * Segment count for a circle/arc of radius `r`. Uses a constant sagitta
   * tolerance relative to the model diagonal so small holes do not spend the
   * full segment budget, while large circles keep their full density.
   */
  _curveSegmentsForRadius(r) {
    const base = this._activeCurveSegs;
    const min = this._minCurveSegs || 8;
    const span = this._activeModelSpan || 0;
    if (!this.options.adaptiveCurveSegments || !span || !(r > 0)) return base;
    const tol = span / 3000; // max chord deviation ~ 1/3000 of the drawing
    if (r <= tol) return Math.min(base, Math.max(min, 12));
    const cosA = Math.max(-1, Math.min(1, 1 - tol / r));
    const segs = Math.ceil(Math.PI / Math.acos(cosA));
    return Math.max(min, Math.min(base, segs));
  }

  emitCircle(ent, dxf, batch, worldMat, parentContext, depth = 0) {
    const r = ent.r || 1;
    const cx = ent.x || 0, cy = ent.y || 0, cz = ent.z || 0;
    const ocsMat = getOCS2WCSMatrix(ent.extrusion);
    const combMat = new THREE.Matrix4().multiplyMatrices(worldMat, ocsMat);
    const hasThick = this.options.extrudeThickness && Math.abs(ent.thickness || 0) > 1e-4;
    const segs = hasThick ? 56 : this._curveSegmentsForRadius(r);
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
    const baseSegs = this._curveSegmentsForRadius(r);
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

export { DXFLoader };
