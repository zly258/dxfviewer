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

  private statLineVerts = 0;
  private statTriVerts = 0;
  private statPointVerts = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: false });
    this.renderer.setClearAlpha(1);
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, WORLD_OFFSET_R * 3);
  }

  /** 相机方位（度）。elevation=90 为俯视。 */
  setOrbit(azimuth: number, elevation: number): void {
    this.azimuth = azimuth;
    this.elevation = Math.max(-89.9, Math.min(89.999, elevation === 90 ? 89.999 : elevation));
    // 允许精确 90：单独处理（用 89.999 避免 lookAt 退化）
    if (elevation >= 90) this.elevation = 89.999;
  }

  getOrbit(): { azimuth: number; elevation: number } {
    return { azimuth: this.azimuth, elevation: this.elevation };
  }

  resetOrbit(): void {
    this.azimuth = 90;
    this.elevation = 89.999;
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
    }
  }

  setTheme(theme: CanvasTheme, background: string): void {
    this.theme = theme;
    void background;
  }

  render(params: EngineRenderParams): void {
    const { viewPort, cssWidth, cssHeight, dpr } = params;
    if (cssWidth <= 0 || cssHeight <= 0) return;

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

    this.renderer.render(this.scene, cam);
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
