/**
 * @license GPL-3.0
 * threejs-dxf-loader - Batched per-layer geometry collector with dual light/dark colour buffers.
 */
import * as THREE from 'three';
import { Float32GrowableBuffer, adaptHexForDarkBackground, adaptHexForLightBackground, hexToLinearRgb } from './00-util.js';
import { computeCreaseAngleNormals } from './01-math.js';

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
    this._pairCache = new Map();
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
      let pair = this._pairCache.get(colorOrPair);
      if (pair === undefined) {
        pair = {
          light: adaptHexForLightBackground(colorOrPair),
          dark: adaptHexForDarkBackground(colorOrPair)
        };
        // Cache the derived pair so repeated per-vertex lookups do not allocate
        // an object for every segment on large drawings.
        if (this._pairCache.size < 4096) this._pairCache.set(colorOrPair, pair);
      }
      return pair;
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

export { LayerBatchCollector };
