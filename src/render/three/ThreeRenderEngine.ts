/**
 * Three.js 渲染引擎（替代原自研 WebGL 管线）。
 *
 * - 正交相机：沿用查看器既有的 (targetX, targetY, zoom) 视口语义，
 *   默认俯视（elevation=90°）时与 Canvas 2D 引擎像素对齐、无回归。
 * - 三维：支持 setOrbit(方位角, 仰角) 倾斜相机，3DFACE / SOLID 使用真实 z，
 *   可直接查看三维构件。
 * - 图元覆盖：见 threeGeometry（全部已解析 DXF 图元）。
 * - 文字：由独立 Canvas 2D 文字覆盖层绘制（与 WebGL 老引擎一致），此处不画字。
 */
import * as THREE from 'three';
import type { EngineRenderParams, EngineSceneOptions, InteractiveRenderEngine } from '@/render/engine';
import type { CanvasTheme } from '@/types';
import { CANVAS_THEME_COLORS } from '@/config/viewerConfig';
import { buildThreeGeometry, hexToRgb } from './threeGeometry';
import type { ThreeEntityRange } from './threeGeometry';

const WORLD_OFFSET_R = 1e6;

export class ThreeRenderEngine implements InteractiveRenderEngine {
  readonly kind = 'webgl' as const;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.OrthographicCamera;

  private lineObj: THREE.LineSegments | null = null;
  private triObj: THREE.Mesh | null = null;
  private pointObj: THREE.Points | null = null;

  private theme: CanvasTheme = 'black';
  private azimuth = 90;   // 绕 Z 轴
  private elevation = 90; // 90 = 俯视（2D）

  // 最近一帧视口参数（用于计算文字覆盖层的平面仿射变换）。
  private lastW = 0;
  private lastH = 0;
  private lastTargetX = 0;
  private lastTargetY = 0;
  private lastZoom = 1;

  private statLineVerts = 0;
  private statTriVerts = 0;
  private statPointVerts = 0;

  // 选中高亮：逐实体几何区间 + 对应顶点缓冲 + 高亮叠加对象。
  private ranges = new Map<string, ThreeEntityRange>();
  private lineArr: Float32Array | null = null;
  private triArr: Float32Array | null = null;
  private ptArr: Float32Array | null = null;
  private highlightGroup: THREE.Group | null = null;
  private selKey = '';

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: false });
    this.renderer.setClearAlpha(1);
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, WORLD_OFFSET_R * 3);
  }

  /** 相机方位（度）。elevation=90 为俯视（2D CAD 视图，默认）。 */
  setOrbit(azimuth: number, elevation: number): void {
    this.azimuth = azimuth;
    this.elevation = Math.max(-89.9, Math.min(89.999, elevation === 90 ? 89.999 : elevation));
    if (elevation >= 90) this.elevation = 89.999;
  }

  getOrbit(): { azimuth: number; elevation: number } {
    return { azimuth: this.azimuth, elevation: this.elevation };
  }

  resetOrbit(): void {
    this.azimuth = 90;
    this.elevation = 89.999;
  }

  /**
   * 计算「俯视文字覆盖层屏幕坐标 → 当前相机屏幕坐标」的平面仿射变换（CSS matrix）。
   * 正交投影下 z=0 平面到屏幕是仿射映射，故用 CSS 变换即可让 2D 文字随三维平面正确倾斜。
   * 返回 null 表示当前为俯视（无需变换）。
   */
  getTextTransform(): number[] | null {
    const W = this.lastW;
    const H = this.lastH;
    if (!W || !H) return null;
    const isTop = Math.abs(this.elevation - 89.999) < 1e-6 && Math.abs(this.azimuth - 90) < 1e-9;
    if (isTop) return null;
    const tx = this.lastTargetX;
    const ty = this.lastTargetY;
    const zoom = this.lastZoom;
    const cam = this.camera;
    const project = (x: number, y: number) => {
      const v = new THREE.Vector3(x, y, 0).project(cam);
      return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H };
    };
    const A = project(tx, ty);
    const B = project(tx + 1, ty);
    const C = project(tx, ty + 1);
    const dx = { x: B.x - A.x, y: B.y - A.y };
    const dy = { x: C.x - A.x, y: C.y - A.y };
    // 当前 世界→屏幕 仿射
    const a2 = dx.x, c2 = dy.x, e2 = A.x - dx.x * tx - dy.x * ty;
    const b2 = dx.y, d2 = dy.y, f2 = A.y - dx.y * tx - dy.y * ty;
    // 俯视 世界→屏幕 仿射
    const a1 = zoom, c1 = 0, e1 = -zoom * tx + W / 2;
    const b1 = 0, d1 = -zoom, f1 = zoom * ty + H / 2;
    const det = a1 * d1 - b1 * c1;
    if (Math.abs(det) < 1e-12) return null;
    // inv(Ptop)
    const ia = d1 / det, ic = -c1 / det, ie = (c1 * f1 - d1 * e1) / det;
    const ib = -b1 / det, id = a1 / det, iff = (b1 * e1 - a1 * f1) / det;
    // M = Pcur ∘ inv(Ptop)
    return [
      a2 * ia + c2 * ib,
      b2 * ia + d2 * ib,
      a2 * ic + c2 * id,
      b2 * ic + d2 * id,
      a2 * ie + c2 * iff + e2,
      b2 * ie + d2 * iff + f2,
    ];
  }

  setScene(options: EngineSceneOptions): void {
    this.disposeObjects();
    const geo = buildThreeGeometry({
      entities: options.entities,
      blocks: options.blocks,
      layers: options.layers,
      theme: options.theme,
      drawingColorMode: options.drawingColorMode,
      hiddenLayers: options.hiddenLayers,
      hiddenEntityIds: options.hiddenEntityIds,
      isolatedEntityIds: options.isolatedEntityIds,
    });
    this.theme = options.theme;
    this.ranges = geo.ranges;
    this.lineArr = null; this.triArr = null; this.ptArr = null;
    // 线段
    if (geo.linePos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(geo.linePos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(geo.lineCol, 3));
      const m = new THREE.LineBasicMaterial({ vertexColors: true });
      this.lineObj = new THREE.LineSegments(g, m);
      this.lineObj.frustumCulled = false;
      this.lineObj.renderOrder = 1;
      this.scene.add(this.lineObj);
      this.statLineVerts = geo.linePos.length / 3;
      this.lineArr = (g.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    }
    // 三角面
    if (geo.triPos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(geo.triPos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(geo.triCol, 3));
      const m = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
      this.triObj = new THREE.Mesh(g, m);
      this.triObj.frustumCulled = false;
      this.triObj.renderOrder = 0;
      this.scene.add(this.triObj);
      this.statTriVerts = geo.triPos.length / 3;
      this.triArr = (g.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    }
    // 点
    if (geo.ptPos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(geo.ptPos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(geo.ptCol, 3));
      const m = new THREE.PointsMaterial({ vertexColors: true, size: 3, sizeAttenuation: false });
      this.pointObj = new THREE.Points(g, m);
      this.pointObj.frustumCulled = false;
      this.pointObj.renderOrder = 2;
      this.scene.add(this.pointObj);
      this.statPointVerts = geo.ptPos.length / 3;
      this.ptArr = (g.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    }
  }

  setTheme(theme: CanvasTheme, background: string): void {
    this.theme = theme;
    void background;
  }

  render(params: EngineRenderParams): void {
    const { viewPort, cssWidth, cssHeight, dpr } = params;
    if (cssWidth <= 0 || cssHeight <= 0) return;

    this.lastW = cssWidth;
    this.lastH = cssHeight;
    this.lastTargetX = viewPort.targetX;
    this.lastTargetY = viewPort.targetY;
    this.lastZoom = viewPort.zoom;

    this.renderer.setPixelRatio(dpr || 1);
    this.renderer.setSize(cssWidth, cssHeight, false);

    const halfW = cssWidth / 2 / viewPort.zoom;
    const halfH = cssHeight / 2 / viewPort.zoom;
    const cam = this.camera;
    cam.left = -halfW; cam.right = halfW; cam.top = halfH; cam.bottom = -halfH;
    cam.near = 1; cam.far = WORLD_OFFSET_R * 3;

    const elevRad = this.elevation * Math.PI / 180;
    const azimRad = this.azimuth * Math.PI / 180;
    const dx = WORLD_OFFSET_R * Math.cos(elevRad) * Math.cos(azimRad);
    const dy = WORLD_OFFSET_R * Math.cos(elevRad) * Math.sin(azimRad);
    const dz = WORLD_OFFSET_R * Math.sin(elevRad);
    cam.position.set(viewPort.targetX + dx, viewPort.targetY + dy, dz);
    cam.up.set(0, 1, 0);
    cam.lookAt(viewPort.targetX, viewPort.targetY, 0);
    cam.updateProjectionMatrix();

    // 背景
    if (params.background === null) {
      this.scene.background = null;
      this.renderer.setClearAlpha(0);
    } else {
      const bg = params.background ?? CANVAS_THEME_COLORS[this.theme];
      const [r, g, b] = hexToRgb(bg);
      this.scene.background = new THREE.Color(r, g, b);
      this.renderer.setClearAlpha(1);
    }

    this.updateHighlight(params.selectedIds);
    this.renderer.render(this.scene, cam);
  }

  /** 重建选中高亮叠加层（仅在选中集合变化时重建）。 */
  private updateHighlight(selected: ReadonlySet<string> | undefined): void {
    if (!selected || selected.size === 0) {
      if (this.selKey) { this.clearHighlight(); this.selKey = ''; }
      return;
    }
    let key = '';
    for (const id of selected) key += id + '|';
    if (key === this.selKey) return;
    this.clearHighlight();
    this.selKey = key;

    const group = new THREE.Group();
    const hColor = new THREE.Color('#ffab00');
    const lineChunks: number[] = [];
    const triChunks: number[] = [];
    const ptChunks: number[] = [];
    const collect = (target: number[], src: Float32Array | null, r: { start: number; count: number } | undefined) => {
      if (!src || !r) return;
      const s = r.start * 3;
      const e = s + r.count * 3;
      for (let i = s; i < e; i++) target.push(src[i]);
    };
    for (const id of selected) {
      const r = this.ranges.get(id);
      if (!r) continue;
      collect(lineChunks, this.lineArr, r.line);
      collect(triChunks, this.triArr, r.tri);
      collect(ptChunks, this.ptArr, r.pt);
    }
    const attr = (arr: number[]) => new THREE.Float32BufferAttribute(arr, 3);
    if (triChunks.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', attr(triChunks));
      const m = new THREE.MeshBasicMaterial({ color: hColor, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
      const mesh = new THREE.Mesh(g, m);
      mesh.renderOrder = 10;
      group.add(mesh);
    }
    if (lineChunks.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', attr(lineChunks));
      const m = new THREE.LineBasicMaterial({ color: hColor, depthTest: false });
      const ls = new THREE.LineSegments(g, m);
      ls.renderOrder = 11;
      group.add(ls);
    }
    if (ptChunks.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', attr(ptChunks));
      const m = new THREE.PointsMaterial({ color: hColor, size: 8, sizeAttenuation: false, depthTest: false });
      const pts = new THREE.Points(g, m);
      pts.renderOrder = 12;
      group.add(pts);
    }
    this.highlightGroup = group;
    this.scene.add(group);
  }

  private clearHighlight(): void {
    const group = this.highlightGroup;
    if (!group) return;
    this.scene.remove(group);
    group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = (mesh as unknown as { material?: THREE.Material | THREE.Material[] }).material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) mat.dispose();
    });
    this.highlightGroup = null;
  }

  /** 读回当前帧像素（自上而下 RGBA，供 PNG 导出）。 */
  readCanvasPixels(width: number, height: number): Uint8Array {
    const gl = this.renderer.getContext();
    const data = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    const flipped = new Uint8Array(data.length);
    const rowBytes = width * 4;
    for (let y = 0; y < height; y++) {
      flipped.set(data.subarray((height - 1 - y) * rowBytes, (height - y) * rowBytes), y * rowBytes);
    }
    return flipped;
  }

  get stats(): Record<string, number> {
    return {
      entities: this.statTriVerts + this.statPointVerts,
      lineVertices: this.statLineVerts,
      fillVertices: this.statTriVerts,
      pointVertices: this.statPointVerts,
      threeObjects: (this.lineObj ? 1 : 0) + (this.triObj ? 1 : 0) + (this.pointObj ? 1 : 0),
    };
  }

  private disposeObjects(): void {
    this.clearHighlight();
    this.selKey = '';
    this.ranges = new Map();
    this.lineArr = this.triArr = this.ptArr = null;
    for (const obj of [this.lineObj, this.triObj, this.pointObj]) {
      if (!obj) continue;
      this.scene.remove(obj);
      obj.geometry.dispose();
      const mat = obj.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) mat.forEach(m => m.dispose());
      else mat.dispose();
    }
    this.lineObj = null;
    this.triObj = null;
    this.pointObj = null;
    this.statLineVerts = this.statTriVerts = this.statPointVerts = 0;
  }

  dispose(): void {
    this.disposeObjects();
    this.renderer.dispose();
  }
}
