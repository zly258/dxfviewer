/**
 * 场景构建器：DXF 实体数组 → 分块 GPU 网格。
 *
 * 写入模型：每个分块持有**自己的**网格构建器（line/fill/glyph/point），
 * 几何以世界坐标写入所属分块的构建器；bake 收尾时一次性做
 * 「减分块原点 + 导出紧凑数组」——全程零合并拷贝，几十万实体的图纸
 * 构建成本严格线性。
 *
 * 顶点为分块局部坐标（世界坐标 − 分块原点），大坐标图纸在 32 位浮点下
 * 无精度损失；恢复世界坐标由 uniform 原点完成。
 */

import {
  AnyEntity,
  DxfLayer,
  DxfBlock,
  DxfStyle,
  DxfLineType,
  Point2D,
  EntityType,
  CanvasTheme,
  DrawingColorMode,
  DxfText,
  DxfHatch,
  DxfInsert,
  DxfDimension,
  DxfLeader,
  DxfMLeader,
} from '@/types';
import {
  TEXT_RENDER_CONFIG,
  LINE_RENDER_CONFIG,
  CANVAS_THEME_COLORS,
} from '@/config/viewerConfig';
import { resolveEntityColor } from '@/utils/entityColor';
import { resolveCadStrokeStyle } from '@/utils/lineStyle';
import { sampleSplinePoints, sampleHatchLoop } from '@/core/geometry/curveSampling';
import { isDimensionBlockLocal } from '@/core/geometry/transform';
import { getEffectiveTextHeight, getCadTextAnchorPosition, cleanMText, cleanCadText } from '@/utils/textUtils';
import { LineMeshBuilder, LineStyle, LinePolylineOp } from '../webgl/mesh/lineMeshBuilder';
import { FillMeshBuilder } from '../webgl/mesh/fillMeshBuilder';
import { GlyphMeshBuilder, PointMeshBuilder, TextStyle } from '../webgl/mesh/glyphPointMeshBuilders';
import { Chunk, WorldRect, ChunkDrawOp, HatchRegion, EntityGeometryRanges } from '../webgl/scene/chunkStore';
import { resolveStrokeFont } from '../text/shx/strokeFontRegistry';
import { shapeStrokeText, strokeShapingBounds } from '../text/strokeTextShaper';
import { hasOutlineFont, layoutOutlineTextEntity } from '../text/outlineText';
import { GlyphAtlas, GlyphStyleKey, RASTER_PX } from '../text/glyphAtlas';
import { getStyleFontFamily } from '../text/fontService';

export interface SceneBuildOptions {
  entities: AnyEntity[];
  /** 渲染纸张空间布局时提供模型空间实体（视口投影用）。 */
  modelEntities?: AnyEntity[];
  layers: Record<string, DxfLayer>;
  blocks: Record<string, DxfBlock>;
  styles: Record<string, DxfStyle>;
  lineTypes: Record<string, DxfLineType>;
  ltScale: number;
  theme: CanvasTheme;
  drawingColorMode: DrawingColorMode;
  hiddenLayers?: Set<string>;
  hiddenEntityIds?: ReadonlySet<string>;
  isolatedEntityIds?: ReadonlySet<string> | null;
  /**
   * 线宽补偿系数：导出画布大于 1280 物理像素基准时按比例放大线宽，
   * 保证高分辨率输出里细线视觉粗细一致（交互为 1）。
   */
  lineWidthScale?: number;
  /**
   * 跳过全部文字烘焙（不写描边/glyph、不进图集）。
   * WebGL 引擎启用文字覆盖层时使用：文字由浏览器原生文本引擎渲染，
   * 图集与字形顶点完全不需要，setScene 也更快。
   */
  skipText?: boolean;
}

/** 弧细分目标段长（模型单位）。 */
const CURVE_TOLERANCE = 2;

const arcSegmentCount = (radius: number): number =>
  Math.max(8, Math.min(720, Math.ceil((2 * Math.PI * radius) / CURVE_TOLERANCE)));

export interface BuiltScene {
  chunks: Chunk[];
  dashPatterns: number[][];
  clipRects: WorldRect[];
  stats: {
    entities: number;
    bakedEntities: number;
    lineVertices: number;
    fillVertices: number;
    glyphVertices: number;
    points: number;
    chunks: number;
  };
}

type Rgba = [number, number, number, number];

const hexToRgba = (color: string): Rgba => [
  parseInt(color.slice(1, 3), 16) || 0,
  parseInt(color.slice(3, 5), 16) || 0,
  parseInt(color.slice(5, 7), 16) || 0,
  255,
];

/**
 * 颜色解析缓存：图纸中颜色取值高度重复（BYLAYER + 索引色），
 * 100k 实体逐次 parseInt 是可见的热点。
 */
const rgbaCache = new Map<string, Rgba>();
const hexToRgbaCached = (color: string): Rgba => {
  const cached = rgbaCache.get(color);
  if (cached) return cached;
  const rgba = hexToRgba(color);
  if (rgbaCache.size < 4096) rgbaCache.set(color, rgba);
  return rgba;
};

const lineStyleOf = (color: string, dashIdx: number, widthPx: number): LineStyle => {
  const c = hexToRgbaCached(color);
  return { color: c, dashIdx, widthPx };
};

const polylineBounds = (flat: ArrayLike<number>): [number, number, number, number] => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < flat.length; i += 2) {
    const x = flat[i], y = flat[i + 1];
    if (Number.isFinite(x) && Number.isFinite(y)) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : [0, 0, 0, 0];
};

const polygonArea = (pts: Point2D[]): number => {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return area / 2;
};

const pointInPolygon = (pt: Point2D, poly: Point2D[]): boolean => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
      (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
};

interface ClassifiedHatchIsland {
  outer: Point2D[];
  holes: Point2D[][];
}

/**
 * 将 HATCH 的多个环路（可能有多个互不相交的独立外环，如多字 Logo、多零件截面）
 * 按照多边形面积和包含树分类为若干组【外环 + 对应孔洞】。
 */
const classifyHatchIslands = (loops: Point2D[][]): ClassifiedHatchIsland[] => {
  const valid = loops.filter(l => l && l.length >= 3);
  if (!valid.length) return [];
  const rings = valid.map((pts, id) => ({
    id,
    pts,
    area: polygonArea(pts),
    absArea: Math.abs(polygonArea(pts)),
  })).sort((a, b) => b.absArea - a.absArea);

  const tree = rings.map(r => ({ ...r, parent: -1, depth: 0, children: [] as number[] }));
  for (let i = 0; i < rings.length; i++) {
    const p0 = rings[i].pts[0], p1 = rings[i].pts[1];
    const pt = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
    for (let j = i - 1; j >= 0; j--) {
      if (pointInPolygon(pt, rings[j].pts)) {
        tree[i].parent = j;
        tree[i].depth = tree[j].depth + 1;
        tree[j].children.push(i);
        break;
      }
    }
  }

  const islands: ClassifiedHatchIsland[] = [];
  for (let i = 0; i < tree.length; i++) {
    if (tree[i].depth % 2 === 0) {
      const outerRing = tree[i].pts;
      const holeRings: Point2D[][] = [];
      for (const chIdx of tree[i].children) {
        if (tree[chIdx].depth === tree[i].depth + 1) {
          holeRings.push(tree[chIdx].pts);
        }
      }
      islands.push({ outer: outerRing, holes: holeRings });
    }
  }
  return islands;
};

/** 图案填充分类。 */
type PatternKind = { mode: 0 | 1 | 2 | 3; dir: [number, number]; spacing: number };
const classifyHatch = (name: string, scale: number, angleDeg: number): PatternKind => {
  const n = (name || '').toUpperCase();
  const base: PatternKind = (() => {
    if (!n || n === 'SOLID') return { mode: 0, dir: [1, 0], spacing: 0 };
    if (n.startsWith('DOTS')) return { mode: 3, dir: [1, 0], spacing: 2.5 };
    if (n.startsWith('NET') || n.startsWith('GRS')) return { mode: 2, dir: [1, 0], spacing: 2.5 };
    if (n.startsWith('AR-')) return { mode: 1, dir: [Math.SQRT1_2, Math.SQRT1_2], spacing: 1.5 };
    // ANSI31/32/36/38 与默认：45° 单向剖面线。
    return { mode: 1, dir: [Math.SQRT1_2, Math.SQRT1_2], spacing: 3.175 };
  })();
  const theta = (angleDeg || 0) * Math.PI / 180;
  const cos = Math.cos(theta), sin = Math.sin(theta);
  return {
    mode: base.mode,
    dir: [base.dir[0] * cos - base.dir[1] * sin, base.dir[0] * sin + base.dir[1] * cos],
    spacing: Math.max(base.spacing * (scale || 1), 0.01),
  };
};

const EXTENT_GUIDE = 1e6;
const MAX_BLOCK_DEPTH = 12;
/** 尺寸块局部坐标判定距离系数（与旧渲染器一致 = 5）。 */
const DIMENSION_LOCAL_DISTANCE_FACTOR = 5;

// ─────────────────────────────────────────────────────────────────────────────
// 分块烘焙器：每分块独立构建器，写出即定位，收尾一次性局部化
// ─────────────────────────────────────────────────────────────────────────────

interface EntityOpRecord {
  kind: 'line' | 'fill' | 'glyph' | 'point';
  start: number;
  count: number;
  baker: ChunkBaker;
}

class ChunkBaker {
  readonly line = new LineMeshBuilder(512);
  readonly fill = new FillMeshBuilder(128);
  readonly glyphs = new GlyphMeshBuilder(64);
  readonly points = new PointMeshBuilder(16);
  readonly drawOps: ChunkDrawOp[] = [];
  readonly hatchRegions: HatchRegion[] = [];
  readonly entityRanges = new Map<string, EntityGeometryRanges>();
  readonly bounds: WorldRect = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

  // ── 文字 LOD：文字 drawOps 独立收集，finalize 时追加到几何 op 之后 ──
  readonly textDrawOps: ChunkDrawOp[] = [];
  minTextHeight = Infinity;

  constructor(
    readonly gridIndex: number,
    readonly originX: number,
    readonly originY: number,
  ) {
    // 写入即局部化：顶点在 float64 下减去分块原点后才落入 float32，
    // 收尾无需再对全部顶点做一遍减法，大图纸少一次全量遍历。
    for (const builder of [this.line, this.fill, this.glyphs, this.points]) {
      builder.originX = originX;
      builder.originY = originY;
    }
  }

  updateBounds(minX: number, minY: number, maxX: number, maxY: number): void {
    if (minX < this.bounds.minX) this.bounds.minX = minX;
    if (minY < this.bounds.minY) this.bounds.minY = minY;
    if (maxX > this.bounds.maxX) this.bounds.maxX = maxX;
    if (maxY > this.bounds.maxY) this.bounds.maxY = maxY;
  }

  /** 追加绘制指令（相邻同参合并，控制 op 数量在百级）。 */
  pushDrawOp(
    mesh: ChunkDrawOp['mesh'],
    start: number,
    count: number,
    dashIdx: number,
    clipRectId: number,
    hatchRegionId: number,
  ): void {
    if (count <= 0) return;
    const ops = this.drawOps;
    const last = ops[ops.length - 1];
    if (last && last.mesh === mesh && last.dashIdx === dashIdx && last.clipRectId === clipRectId
      && last.hatchRegionId === hatchRegionId && last.start + last.count === start) {
      last.count += count;
      return;
    }
    ops.push({ mesh, dashIdx, start, count, clipRectId, hatchRegionId });
  }

  /** 追加文字绘制指令（相邻同字高合并；渲染时按字高逐个剔除过小文字）。 */
  pushTextDrawOp(
    mesh: ChunkDrawOp['mesh'],
    start: number,
    count: number,
    dashIdx: number,
    clipRectId: number,
    hatchRegionId: number,
    textHeight: number,
  ): void {
    if (count <= 0) return;
    const ops = this.textDrawOps;
    const last = ops[ops.length - 1];
    if (last && last.mesh === mesh && last.dashIdx === dashIdx && last.clipRectId === clipRectId
      && last.hatchRegionId === hatchRegionId && last.textHeight === textHeight
      && last.start + last.count === start) {
      last.count += count;
      return;
    }
    ops.push({ mesh, dashIdx, start, count, clipRectId, hatchRegionId, textHeight });
    if (textHeight < this.minTextHeight) this.minTextHeight = textHeight;
  }

  /** 收尾：局部化顶点 + 导出紧凑数组 → Chunk。 */
  finalize(): Chunk {
    // 顶点在写入时已局部化（见构造函数），这里只导出紧凑数组。
    const lineOut = this.line.finish();
    const fillOut = this.fill.finish();
    const glyphOut = this.glyphs.finish();
    const pointOut = this.points.finish();
    const bounds = Number.isFinite(this.bounds.minX)
      ? this.bounds
      : { minX: this.originX - 1, minY: this.originY - 1, maxX: this.originX + 1, maxY: this.originY + 1 };

    return {
      bounds,
      originX: this.originX,
      originY: this.originY,
      lineData: lineOut.vertices,
      lineColor: lineOut.colors,
      lineIndices: lineOut.indices,
      fillData: fillOut.vertices,
      fillColor: fillOut.colors,
      glyphData: glyphOut.vertices,
      glyphColor: glyphOut.colors,
      pointData: pointOut.vertices,
      pointColor: pointOut.colors,
      hatchRegions: this.hatchRegions,
      // 文字 op 追加在几何 op 之后（CAD 习惯：文字绘制在上层）；
      // 渲染端按 minTextHeight × 屏幕像素密度整批剔除过小文字。
      drawOps: Number.isFinite(this.minTextHeight)
        ? [...this.drawOps, ...this.textDrawOps]
        : this.drawOps,
      textOpsStart: Number.isFinite(this.minTextHeight) ? this.drawOps.length : -1,
      minTextHeight: Number.isFinite(this.minTextHeight) ? this.minTextHeight : 0,
      entityRanges: this.entityRanges,
      gpu: null,
    };
  }
}

/** 烘焙器。 */
class SceneBaker {
  private readonly bakers: ChunkBaker[] = [];
  private readonly dashPatterns: number[][] = [];
  private readonly dashPatternIndex = new Map<string, number>();
  private readonly clipRects: WorldRect[] = [];
  private currentBaker: ChunkBaker | null = null;
  /** 实体记录帧栈（块嵌套时父实体同时收集子几何）；帧对象复用，避免逐实体分配。 */
  private entityFrames: Array<{ id: string; ops: EntityOpRecord[] }> = [];
  private entityDepth = 0;
  /** 文字烘焙标志：期间的 drawOp 推入文字列表（渲染时按屏幕高度整批剔除）。 */
  private inTextBake = false;
  private curTextHeight = 0;
  /** 当前裁剪矩形（纸张空间视口投影时 ≥ 0）。 */
  private currentClipRectId = -1;
  private currentParentLineType: string | undefined = undefined;
  private currentParentLineweight: number | undefined = undefined;

  readonly stats = {
    entities: 0, bakedEntities: 0, lineVertices: 0, fillVertices: 0, glyphVertices: 0, points: 0, chunks: 0,
  };

  constructor(
    private readonly options: SceneBuildOptions,
    private readonly atlas: GlyphAtlas,
    private readonly grid?: { minX: number; minY: number; size: number; nx: number; ny: number },
  ) {}

  // ── 路由 ──

  private routeTo(x: number, y: number): ChunkBaker {
    const baker = this.pickBaker(x, y);
    this.currentBaker = baker;
    return baker;
  }

  private pickBaker(x: number, y: number): ChunkBaker {
    if (this.grid) {
      const { minX, minY, size, nx, ny } = this.grid;
      const cx = Math.min(nx - 1, Math.max(0, Math.floor((x - minX) / size)));
      const cy = Math.min(ny - 1, Math.max(0, Math.floor((y - minY) / size)));
      const idx = cy * nx + cx;
      let baker = this.bakers[idx];
      if (!baker) baker = this.createBaker(idx, minX + cx * size, minY + cy * size);
      return baker;
    }
    if (!this.bakers[0]) this.bakers[0] = this.createBaker(0, 0, 0);
    return this.bakers[0];
  }

  private createBaker(index: number, originX: number, originY: number): ChunkBaker {
    const baker = new ChunkBaker(index, originX, originY);
    this.bakers[index] = baker;
    return baker;
  }

  private get baker(): ChunkBaker {
    if (!this.currentBaker) throw new Error('scene chunk 未路由（routeTo 未调用）');
    return this.currentBaker;
  }

  /** 追加绘制指令（相邻同参合并）。文字烘焙期间（inTextBake）推入文字 op 列表。 */
  private pushDrawOp(
    mesh: ChunkDrawOp['mesh'],
    start: number,
    count: number,
    dashIdx = 0,
    hatchRegionId = -1,
  ): void {
    if (this.inTextBake) {
      this.baker.pushTextDrawOp(mesh, start, count, dashIdx, this.currentClipRectId, hatchRegionId, this.curTextHeight);
    } else {
      this.baker.pushDrawOp(mesh, start, count, dashIdx, this.currentClipRectId, hatchRegionId);
    }
  }

  /** 登记世界坐标裁剪矩形，返回 id。 */
  private pushClipRect(rect: WorldRect): number {
    this.clipRects.push(rect);
    return this.clipRects.length - 1;
  }

  // ── 实体范围记录 ──

  private beginEntity(id: string): void {
    let frame = this.entityFrames[this.entityDepth];
    if (!frame) {
      frame = { id, ops: [] };
      this.entityFrames[this.entityDepth] = frame;
    }
    frame.id = id;
    frame.ops.length = 0;
    this.entityDepth++;
  }

  private endEntity(): void {
    if (this.entityDepth === 0) return;
    const frame = this.entityFrames[--this.entityDepth];
    const ops = frame.ops;
    if (!ops.length) return;

    // 汇总该实体的几何范围（按分块与几何类型分组，支持 line/fill/glyph/point 高亮）。
    // 单个实体涉及的分块极少，线性查找比 Map 更省。
    let bakers: ChunkBaker[] | null = null;
    let rangesList: EntityGeometryRanges[] | null = null;
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      let slot = -1;
      if (bakers) {
        for (let k = 0; k < bakers.length; k++) if (bakers[k] === op.baker) { slot = k; break; }
      }
      if (slot < 0) {
        if (!bakers) { bakers = []; rangesList = []; }
        bakers.push(op.baker);
        rangesList!.push({});
        slot = bakers.length - 1;
      }
      const ranges = rangesList![slot];
      const existing = ranges[op.kind];
      if (!existing) {
        ranges[op.kind] = { start: op.start, count: op.count };
      } else if (existing.start + existing.count === op.start) {
        existing.count += op.count;
      } else {
        const end = Math.max(existing.start + existing.count, op.start + op.count);
        existing.start = Math.min(existing.start, op.start);
        existing.count = end - existing.start;
      }
    }
    if (bakers) {
      for (let k = 0; k < bakers.length; k++) bakers[k].entityRanges.set(frame.id, rangesList![k]);
    }
  }

  private recordEntityOp(baker: ChunkBaker, kind: 'line' | 'fill' | 'glyph' | 'point', start: number, count: number): void {
    if (this.entityDepth === 0 || count <= 0) return;
    for (let d = 0; d < this.entityDepth; d++) {
      this.entityFrames[d].ops.push({ baker, kind, start, count });
    }
  }
  // ── 线型/线宽 ──

  /**
   * 解析实体笔样式：虚线模式索引 + 屏幕线宽。
   * 一个实体只调用一次 resolveCadStrokeStyle（此前按虚线、线宽各解析一次，
   * 10 万实体图纸上直接翻倍）。
   */
  private strokeFor(ent: AnyEntity, layer: DxfLayer | undefined): { dashIdx: number; widthPx: number } {
    const stroke = resolveCadStrokeStyle({
      entity: ent, layer,
      parentLineType: this.currentParentLineType,
      parentLineweight: this.currentParentLineweight,
      lineTypes: this.options.lineTypes,
      globalLineTypeScale: this.options.ltScale,
      viewScale: 1,
      isSelected: false,
    });

    let dashIdx = 0;
    // GL 虚线着色器按弧长取模自行判开/关，必须拿到带符号段长（正=实线、负=空白），
    // 否则每段都被判为实线，所有虚线（DASHED/CENTER/HIDDEN）都渲染成实线。
    const pattern = stroke.signedDashPattern;
    if (pattern && pattern.length) {
      const key = pattern.join(',');
      const existing = this.dashPatternIndex.get(key);
      if (existing !== undefined) {
        dashIdx = existing + 1;
      } else {
        dashIdx = this.dashPatterns.length + 1;
        this.dashPatterns.push(pattern);
        this.dashPatternIndex.set(key, dashIdx - 1);
      }
    }

    let width = stroke.lineWidth;
    const constantWidth = (ent as { constantWidth?: number }).constantWidth;
    if (constantWidth !== undefined && constantWidth > 0) {
      width = Math.max(
        LINE_RENDER_CONFIG.minimumScreenLineWidth,
        Math.min(constantWidth, LINE_RENDER_CONFIG.maximumScreenLineWidth),
      );
    }
    // 导出补偿：在 CAD 钳制后的屏幕线宽基础上按输出尺寸放大。
    return { dashIdx, widthPx: width * (this.options.lineWidthScale ?? 1) };
  }

  // ── 几何写入（世界坐标；写入所属分块的构建器） ──

  /** 曲线细分复用缓冲：万级曲线时避免每条曲线分配一个新数组。 */
  private readonly flatScratch: number[] = [];

  private writePolyline(flat: number[], style: LineStyle, closed: boolean): void {
    if (flat.length < 4) return;
    const [minX, minY, maxX, maxY] = polylineBounds(flat);
    const baker = this.routeTo((minX + maxX) / 2, (minY + maxY) / 2);
    const opCountBefore = baker.line.ops.length;
    baker.line.addPolyline(flat, style, closed);
    this.recordLineOps(baker, opCountBefore);
    baker.updateBounds(minX, minY, maxX, maxY);
    this.stats.lineVertices += flat.length;
  }

  private writeSegment(ax: number, ay: number, bx: number, by: number, style: LineStyle): void {
    const baker = this.routeTo((ax + bx) / 2, (ay + by) / 2);
    const opCountBefore = baker.line.ops.length;
    baker.line.addSegment(ax, ay, bx, by, style);
    this.recordLineOps(baker, opCountBefore);
    baker.updateBounds(Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by));
    this.stats.lineVertices += 4;
  }

  /** 登记本次折线写入产生的索引段（虚线分组 + 绘制指令 + 实体范围）。 */
  private recordLineOps(baker: ChunkBaker, opCountBefore: number): void {
    const ops = baker.line.ops;
    for (let i = opCountBefore; i < ops.length; i++) {
      const op = ops[i] as LinePolylineOp;
      this.pushDrawOp('line', op.indexStart, op.indexCount, op.dashIdx);
      this.recordEntityOp(baker, 'line', op.indexStart, op.indexCount);
    }
  }

  // ── 填充写入 ──

  private writeSolidPolygon(outer: Point2D[], holes: Point2D[][], color: string): void {
    if (outer.length < 3) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of outer) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const baker = this.routeTo((minX + maxX) / 2, (minY + maxY) / 2);
    const vertexStart = baker.fill.vertexCount;
    baker.fill.addPolygon(
      outer.map(p => ({ x: p.x, y: p.y })),
      holes.map(h => h.map(p => ({ x: p.x, y: p.y }))),
      { color: hexToRgba(color) },
    );
    const appended = baker.fill.vertexCount - vertexStart;
    if (appended > 0) {
      this.pushDrawOp('fill', vertexStart, appended);
      this.stats.fillVertices += appended;
      this.recordEntityOp(baker, 'fill', vertexStart, appended);
    }
    baker.updateBounds(minX, minY, maxX, maxY);
  }

  private writePoints(x: number, y: number, color: string): void {
    const baker = this.routeTo(x, y);
    const vertexStart = baker.points.vertexCount;
    baker.points.addPoint(x, y, { color: hexToRgba(color) });
    this.pushDrawOp('point', vertexStart, 1);
    this.stats.points++;
    this.recordEntityOp(baker, 'point', vertexStart, 1);
    baker.updateBounds(x, y, x, y);
  }

  // ── 字形写入 ──

  private writeGlyphQuads(
    quads: Array<{ corners: [number, number][]; uvs: [number, number][]; page?: number }>,
    color: string,
    bounds: [number, number, number, number],
  ): void {
    if (!quads.length) return;
    const baker = this.routeTo((bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2);
    const c = hexToRgba(color);
    const style: TextStyle = { color: c };
    const vertexStart = baker.glyphs.vertexCount;
    for (const quad of quads) {
      // 顶点已旋转到世界坐标：直写四角（构建器收尾时统一减原点局部化）。
      baker.glyphs.addQuadCorners(quad.corners, quad.uvs, style, quad.page ?? 0);
    }
    const appended = baker.glyphs.vertexCount - vertexStart;
    this.pushDrawOp('glyph', vertexStart, appended);
    this.stats.glyphVertices += appended;
    this.recordEntityOp(baker, 'glyph', vertexStart, appended);
    baker.updateBounds(bounds[0], bounds[1], bounds[2], bounds[3]);
  }

  // ═══════════════════════════════════════════════════════════════════
  // 顶层烘焙
  // ═══════════════════════════════════════════════════════════════════

  bake(): BuiltScene {
    this.stats.entities = this.options.entities.length;
    for (const ent of this.options.entities) {
      this.bakeVisible(ent, undefined, undefined, 0);
    }
    const chunks: Chunk[] = [];
    for (const baker of this.bakers) {
      if (!baker) continue;
      chunks.push(baker.finalize());
    }
    this.stats.chunks = chunks.length;
    return {
      chunks,
      dashPatterns: this.dashPatterns,
      clipRects: this.clipRects,
      stats: { ...this.stats },
    };
  }

  private bakeVisible(
    ent: AnyEntity,
    parentLayerName: string | undefined,
    parentColor: string | undefined,
    depth: number,
  ): void {
    if (ent.visible === false || depth > MAX_BLOCK_DEPTH) return;
    const layerName = (ent.layer === '0' && parentLayerName) ? parentLayerName : ent.layer;
    if (this.options.hiddenLayers?.has(layerName)) return;
    const layer = this.options.layers[layerName];
    if (layer && layer.isVisible === false) return;
    if (depth === 0) {
      if (this.options.hiddenEntityIds?.has(ent.id)) return;
      if (this.options.isolatedEntityIds && !this.options.isolatedEntityIds.has(ent.id)) return;
    }
    const color = resolveEntityColor(ent, layer, parentColor, this.options.drawingColorMode, this.options.theme);
    this.beginEntity(ent.id);
    try {
      this.bakeEntity(ent, layer, color, depth, layerName);
      this.stats.bakedEntities++;
    } finally {
      this.endEntity();
    }
  }

  private bakeEntity(ent: AnyEntity, layer: DxfLayer | undefined, color: string, depth: number, layerName: string): void {
    // 文字覆盖层模式：文字完全不进 GPU 场景（由浏览器原生文本引擎绘制）。
    if (this.options.skipText) {
      switch (ent.type) {
        case EntityType.TEXT:
        case EntityType.MTEXT:
        case EntityType.ATTRIB:
        case EntityType.ATTDEF:
          return;
        default:
          break;
      }
    }
    // 笔样式（虚线索引 + 屏幕线宽）按实体解析一次，供下面各几何分支复用。
    let resolvedStroke: { dashIdx: number; widthPx: number } | null = null;
    const strokeOf = (): { dashIdx: number; widthPx: number } =>
      (resolvedStroke ??= this.strokeFor(ent, layer));

    switch (ent.type) {
      case EntityType.LINE:
        this.writeSegment(ent.start.x, ent.start.y, ent.end.x, ent.end.y,
          lineStyleOf(color, strokeOf().dashIdx, strokeOf().widthPx));
        break;
      case EntityType.RAY: {
        const style = lineStyleOf(color, strokeOf().dashIdx, strokeOf().widthPx);
        this.writeSegment(ent.basePoint.x, ent.basePoint.y,
          ent.basePoint.x + ent.direction.x * EXTENT_GUIDE, ent.basePoint.y + ent.direction.y * EXTENT_GUIDE, style);
        break;
      }
      case EntityType.XLINE: {
        const style = lineStyleOf(color, strokeOf().dashIdx, strokeOf().widthPx);
        this.writeSegment(
          ent.basePoint.x - ent.direction.x * EXTENT_GUIDE, ent.basePoint.y - ent.direction.y * EXTENT_GUIDE,
          ent.basePoint.x + ent.direction.x * EXTENT_GUIDE, ent.basePoint.y + ent.direction.y * EXTENT_GUIDE, style);
        break;
      }
      case EntityType.POINT:
        this.writePoints(ent.position.x, ent.position.y, color);
        break;
      case EntityType.CIRCLE: {
        if (ent.radius <= 0) break;
        const segs = arcSegmentCount(ent.radius);
        const flat = this.flatScratch;
        flat.length = 0;
        for (let i = 0; i < segs; i++) {
          const a = (i / segs) * Math.PI * 2;
          flat.push(ent.center.x + Math.cos(a) * ent.radius, ent.center.y + Math.sin(a) * ent.radius);
        }
        this.writePolyline(flat, lineStyleOf(color, strokeOf().dashIdx, strokeOf().widthPx), true);
        break;
      }
      case EntityType.ARC: {
        if (ent.radius <= 0) break;
        const start = (ent.startAngle || 0) * Math.PI / 180;
        let end = (ent.endAngle || 0) * Math.PI / 180;
        if (end <= start) end += Math.PI * 2;
        const sweep = end - start;
        const segs = Math.max(2, Math.ceil(sweep * ent.radius / CURVE_TOLERANCE));
        const flat = this.flatScratch;
        flat.length = 0;
        for (let i = 0; i <= segs; i++) {
          const a = start + sweep * (i / segs);
          flat.push(ent.center.x + Math.cos(a) * ent.radius, ent.center.y + Math.sin(a) * ent.radius);
        }
        this.writePolyline(flat, lineStyleOf(color, strokeOf().dashIdx, strokeOf().widthPx), false);
        break;
      }
      case EntityType.ELLIPSE: {
        const majorLen = Math.hypot(ent.majorAxis.x, ent.majorAxis.y);
        if (majorLen <= 0) break;
        const minorLen = majorLen * ent.ratio;
        const theta = Math.atan2(ent.majorAxis.y, ent.majorAxis.x);
        const cosT = Math.cos(theta), sinT = Math.sin(theta);
        const start = ent.startParam || 0;
        let end = ent.endParam ?? Math.PI * 2;
        if (end <= start) end += Math.PI * 2;
        const sweep = end - start;
        const segs = Math.max(8, Math.ceil(arcSegmentCount(majorLen) * Math.min(1, sweep / (Math.PI * 2))));
        const flat = this.flatScratch;
        flat.length = 0;
        for (let i = 0; i <= segs; i++) {
          const t = start + sweep * (i / segs);
          const ex = Math.cos(t) * majorLen;
          const ey = Math.sin(t) * minorLen;
          flat.push(ent.center.x + ex * cosT - ey * sinT, ent.center.y + ex * sinT + ey * cosT);
        }
        this.writePolyline(flat, lineStyleOf(color, strokeOf().dashIdx, strokeOf().widthPx), sweep >= Math.PI * 2 - 1e-9);
        break;
      }
      case EntityType.LWPOLYLINE:
      case EntityType.POLYLINE:
        this.writeBulgePolyline(ent.points, ent.bulges, ent.closed, strokeOf(), color);
        break;
      case EntityType.MLINE:
        this.writeBulgePolyline(ent.vertices, undefined, !!ent.closed, strokeOf(), color);
        break;
      case EntityType.SPLINE: {
        const samples = ent.calculatedPoints?.length
          ? ent.calculatedPoints
          : ent.fitPoints && ent.fitPoints.length > 1
            ? ent.fitPoints
            : sampleSplinePoints(ent.controlPoints || [], ent.degree || 3, ent.knots, ent.weights);
        if (samples && samples.length >= 2) {
          const flat = this.flatScratch;
          flat.length = 0;
          for (const p of samples) flat.push(p.x, p.y);
          this.writePolyline(flat, lineStyleOf(color, strokeOf().dashIdx, strokeOf().widthPx), false);
        }
        break;
      }
      case EntityType.TEXT:
      case EntityType.MTEXT:
      case EntityType.ATTRIB:
      case EntityType.ATTDEF:
        this.bakeText(ent, color);
        break;
      case EntityType.SOLID:
      case EntityType.THREEDFACE: {
        if (ent.points.length < 3) break;
        const p = ent.points;
        if (p.length >= 4) {
          this.writeSolidPolygon([p[0], p[1], p[3]], [], color);
          this.writeSolidPolygon([p[1], p[2], p[3]], [], color);
        } else {
          this.writeSolidPolygon([p[0], p[1], p[2]], [], color);
        }
        break;
      }
      case EntityType.HATCH:
        this.bakeHatch(ent, color);
        break;
      case EntityType.WIPEOUT: {
        if (ent.points.length >= 3) {
          this.writeSolidPolygon(ent.points, [], CANVAS_THEME_COLORS[this.options.theme]);
        }
        break;
      }
      case EntityType.INSERT:
        this.bakeInsert(ent, layer, color, depth, layerName);
        break;
      case EntityType.DIMENSION:
        this.bakeDimension(ent, layer, color, depth, layerName);
        break;
      case EntityType.LEADER:
        this.bakeLeader(ent, layer, color, depth);
        break;
      case EntityType.MLEADER:
        this.bakeMLeader(ent, layer, color, depth);
        break;
      case EntityType.ACAD_TABLE:
        this.bakeBlockRef(ent.blockName, { x: 0, y: 0 }, ent.scale ?? { x: 1, y: 1, z: 1 }, ent.rotation ?? 0, (ent as unknown as { attributes?: AnyEntity[] }).attributes, layer, color, depth, layerName);
        break;
      case EntityType.VIEWPORT:
        this.bakeViewport(ent, color, depth, layerName);
        break;
      default:
        break;
    }
  }

  private writeBulgePolyline(
    points: Point2D[],
    bulges: number[] | undefined,
    closed: boolean,
    stroke: { dashIdx: number; widthPx: number },
    color: string,
  ): void {
    if (points.length < 2) return;
    const flat = this.flatScratch;
    flat.length = 0;
    const segCount = closed ? points.length : points.length - 1;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      flat.push(p.x, p.y);
      if (i >= segCount) break;
      const bulge = bulges?.[i] || 0;
      if (bulge === 0) continue;
      const next = points[(i + 1) % points.length];
      const chord = Math.hypot(next.x - p.x, next.y - p.y);
      if (chord < 1e-9) continue;
      const theta = 4 * Math.atan(bulge);
      const radius = Math.abs(chord / (2 * Math.sin(theta / 2)));
      // 圆心：弦中点 + 垂直偏移。
      const midX = (p.x + next.x) / 2, midY = (p.y + next.y) / 2;
      const h = chord / 2 / Math.tan(theta / 2);
      const dirX = (next.x - p.x) / chord, dirY = (next.y - p.y) / chord;
      const cx = midX - dirY * h;
      const cy = midY + dirX * h;
      const a0 = Math.atan2(p.y - cy, p.x - cx);
      const a1 = Math.atan2(next.y - cy, next.x - cx);
      let sweep = a1 - a0;
      if (bulge > 0 && sweep < 0) sweep += Math.PI * 2;
      if (bulge < 0 && sweep > 0) sweep -= Math.PI * 2;
      const segs = Math.max(2, Math.ceil(Math.abs(sweep) * radius / CURVE_TOLERANCE));
      for (let s = 1; s < segs; s++) {
        const a = a0 + sweep * (s / segs);
        flat.push(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
      }
    }
    this.writePolyline(flat, lineStyleOf(color, stroke.dashIdx, stroke.widthPx), closed);
  }

  // ── HATCH ──

  private bakeHatch(ent: DxfHatch, color: string): void {
    const rawLoops = (ent.loops || [])
      .map(l => sampleHatchLoop(l))
      .filter((pts): pts is Point2D[] => !!pts && pts.length >= 3);
    if (!rawLoops.length) return;

    // 对填充环路进行包含拓扑分类：支持多岛（Multi-island）与嵌套空洞
    const islands = classifyHatchIslands(rawLoops);
    if (!islands.length) return;

    if (ent.solid) {
      for (const island of islands) {
        this.writeSolidPolygon(island.outer, island.holes, color);
      }
    } else {
      const pattern = classifyHatch(ent.patternName, ent.scale || 1, ent.angle || 0);
      if (pattern.mode === 0) {
        for (const island of islands) {
          this.writeSolidPolygon(island.outer, island.holes, color);
        }
        return;
      }
      // 图案填充：包围盒两三角形 + 片元解析着色（区域记录供 draw 设置 uniform）。
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const island of islands) {
        for (const p of island.outer) {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
      }
      const baker = this.routeTo((minX + maxX) / 2, (minY + maxY) / 2);
      const vertexStart = baker.fill.vertexCount;
      const c = hexToRgba(color);
      const fillStyle = { color: c };
      // 覆盖整个包围盒的两个三角形（6 顶点），绘制时以区域 uniform 画剖面线。
      baker.fill.addTriangle(minX, minY, maxX, minY, maxX, maxY, fillStyle);
      baker.fill.addTriangle(minX, minY, maxX, maxY, minX, maxY, fillStyle);
      const regionId = baker.hatchRegions.length;
      baker.hatchRegions.push({
        x: minX, y: minY, w: maxX - minX, h: maxY - minY,
        mode: pattern.mode, dir: pattern.dir, spacing: pattern.spacing,
        vertexStart, vertexCount: 6,
      });
      this.pushDrawOp('fill', vertexStart, 6, 0, regionId);
      this.stats.fillVertices += 6;
      baker.updateBounds(minX, minY, maxX, maxY);
    }
  }

  // ── 块引用 ──

  private bakeInsert(ent: DxfInsert, layer: DxfLayer | undefined, color: string, depth: number, layerName: string): void {
    const prevLT = this.currentParentLineType;
    const prevLW = this.currentParentLineweight;
    if (ent.lineType && ent.lineType !== 'BYLAYER' && ent.lineType !== 'BYBLOCK') {
      this.currentParentLineType = ent.lineType;
    }
    if (ent.lineweight !== undefined && ent.lineweight >= 0) {
      this.currentParentLineweight = ent.lineweight;
    }
    try {
      this.bakeBlockRef(ent.blockName, ent.position, ent.scale, ent.rotation, ent.attributes, layer, color, depth, layerName, ent.rowCount, ent.colCount, ent.rowSpacing, ent.colSpacing);
    } finally {
      this.currentParentLineType = prevLT;
      this.currentParentLineweight = prevLW;
    }
  }

  private bakeDimension(ent: DxfDimension, layer: DxfLayer | undefined, color: string, depth: number, layerName: string): void {
    const block = this.options.blocks[ent.blockName];
    if (!block) return;
    const prevLT = this.currentParentLineType;
    const prevLW = this.currentParentLineweight;
    if (ent.lineType && ent.lineType !== 'BYLAYER' && ent.lineType !== 'BYBLOCK') {
      this.currentParentLineType = ent.lineType;
    }
    if (ent.lineweight !== undefined && ent.lineweight >= 0) {
      this.currentParentLineweight = ent.lineweight;
    }
    try {
      const dp = ent.definitionPoint ?? { x: 0, y: 0 };
      const local = isDimensionBlockLocal(block, dp, DIMENSION_LOCAL_DISTANCE_FACTOR);
      this.bakeBlockInstance(block, local ? dp.x : 0, local ? dp.y : 0, 1, 1, 0, layer, layerName, color, depth + 1, !local);
    } finally {
      this.currentParentLineType = prevLT;
      this.currentParentLineweight = prevLW;
    }
  }

  private bakeBlockRef(
    blockName: string,
    position: Point2D,
    scale: { x: number; y: number; z: number },
    rotation: number,
    attributes: AnyEntity[] | undefined,
    layer: DxfLayer | undefined,
    parentColor: string,
    depth: number,
    parentLayerName: string,
    rowCount = 1,
    colCount = 1,
    rowSpacing = 0,
    colSpacing = 0,
  ): void {
    const block = this.options.blocks[blockName];
    if (!block) return;
    const rows = Math.max(1, rowCount || 1);
    const cols = Math.max(1, colCount || 1);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const ox = position.x + r * rowSpacing * -Math.sin(rotation * Math.PI / 180) + c * colSpacing * Math.cos(rotation * Math.PI / 180);
        const oy = position.y + r * rowSpacing * Math.cos(rotation * Math.PI / 180) + c * colSpacing * Math.sin(rotation * Math.PI / 180);
        this.bakeBlockInstance(block, ox, oy, scale.x, scale.y, rotation, layer, parentLayerName, parentColor, depth + 1);
        if (attributes) {
          // ATTRIB 坐标有两种导出风格：
          //  - 世界绝对坐标（DXF 规范）：恒等烘焙；
          //  - 块局部坐标（部分导出器，实测图签块位置为 -17.8M 级）：必须走块变换。
          // 判定：取「恒等」与「块变换」两个候选中更靠近 INSERT 插入点的那个
          // —— 属性必然依附于其块实例。此前一律恒等会让局部坐标的属性飞到
          // 数千万单位外，把图纸范围撑爆（fit 后必须放极大才能看到图形）。
          const theta = rotation * Math.PI / 180;
          const cosR = Math.cos(theta), sinR = Math.sin(theta);
          const sf = Math.max(Math.abs(scale.x), Math.abs(scale.y), 1e-9);
          const attribXf = (p: Point2D): Point2D => {
            const dx = (p.x - block.basePoint.x) * scale.x;
            const dy = (p.y - block.basePoint.y) * scale.y;
            return { x: ox + dx * cosR - dy * sinR, y: oy + dx * sinR + dy * cosR };
          };
          for (const attrib of attributes) {
            if (attrib.type !== EntityType.ATTRIB && attrib.type !== EntityType.TEXT) continue;
            const value = String((attrib as DxfText).value ?? '').trim();
            if (!value) continue;
            const tag = (attrib as DxfText).tag;
            if (tag && value === tag) continue;

            const textEnt = attrib as DxfText;
            const raw = textEnt.position;
            const moved = attribXf(raw);
            const distRaw = Math.hypot(raw.x - ox, raw.y - oy);
            const distMoved = Math.hypot(moved.x - ox, moved.y - oy);
            const baked = distMoved < distRaw
              ? {
                ...attrib,
                position: moved,
                height: (textEnt.height || 0) * sf,
                rotation: (textEnt.rotation || 0) + rotation,
              }
              : attrib;
            this.bakeVisible(baked, parentLayerName, parentColor, depth + 1);
          }
        }
      }
    }
  }

  /** 烘焙单个块实例（块内实体经块变换后重走烘焙路径）。 */
  private bakeBlockInstance(
    block: DxfBlock,
    tx: number, ty: number,
    sx: number, sy: number,
    rotationDeg: number,
    parentLayer: DxfLayer | undefined,
    parentLayerName: string,
    parentColor: string,
    depth: number,
    /** 尺寸块等恒等映射场景：不减块基点（world = p）。 */
    skipBasePoint = false,
  ): void {
    if (depth > MAX_BLOCK_DEPTH) return;
    const theta = rotationDeg * Math.PI / 180;
    const cos = Math.cos(theta), sin = Math.sin(theta);
    const bx = skipBasePoint ? 0 : block.basePoint.x;
    const by = skipBasePoint ? 0 : block.basePoint.y;
    const xf = (p: Point2D): Point2D => {
      const dx = (p.x - bx) * sx;
      const dy = (p.y - by) * sy;
      return { x: tx + dx * cos - dy * sin, y: ty + dx * sin + dy * cos };
    };
    for (const child of block.entities) {
      // ATTDEF 是属性模板定义，不是可见几何（与旧渲染器一致）。
      if (child.type === EntityType.ATTDEF) continue;
      const xformed = xformEntity(child, xf, sx);
      if (!xformed) continue;
      this.bakeVisible(xformed, parentLayerName || undefined, parentColor, depth);
      void parentLayer;
    }
  }

  // ── LEADER / MLEADER ──

  private bakeLeader(ent: DxfLeader, layer: DxfLayer | undefined, color: string, depth: number): void {
    void depth;
    const style = lineStyleOf(color, this.strokeFor(ent, layer).dashIdx, this.strokeFor(ent, layer).widthPx);
    if (ent.points.length >= 2) {
      const flat: number[] = [];
      for (const p of ent.points) flat.push(p.x, p.y);
      this.writePolyline(flat, style, false);
      // 箭头：末端三角形。
      const tip = ent.points[ent.points.length - 1];
      const prev = ent.points[ent.points.length - 2];
      const len = Math.hypot(prev.x - tip.x, prev.y - tip.y);
      if (len > 1e-9) {
        const ux = (prev.x - tip.x) / len, uy = (prev.y - tip.y) / len;
        const size = Math.min(len * 0.18, 3.5);
        this.writeSolidPolygon([tip,
          { x: tip.x + (ux * 0.5 - uy) * size, y: tip.y + (uy * 0.5 + ux) * size },
          { x: tip.x + (ux * 0.5 + uy) * size, y: tip.y + (uy * 0.5 - ux) * size },
        ], [], color);
      }
    }
  }

  private bakeMLeader(ent: DxfMLeader, layer: DxfLayer | undefined, color: string, depth: number): void {
    void depth;
    const mLeaderStroke = this.strokeFor(ent, layer);
    const style = lineStyleOf(color, mLeaderStroke.dashIdx, mLeaderStroke.widthPx);
    for (const line of ent.leaderLines) {
      if (line.length >= 2) {
        const flat: number[] = [];
        for (const p of line) flat.push(p.x, p.y);
        this.writePolyline(flat, style, false);
      }
    }
    if (ent.text && ent.textPosition) {
      const textEnt: DxfText = {
        id: `${ent.id}_t`,
        type: EntityType.MTEXT,
        layer: ent.layer,
        position: ent.textPosition,
        value: ent.text,
        height: ent.textHeight || 2.5,
        width: ent.textWidth || 80,
        attachmentPoint: 1,
        styleName: ent.textStyleName,
      };
      this.bakeText(textEnt, color);
    }
  }

  // ── 纸张空间视口 ──

  /**
   * 纸张空间视口：边界框 + 模型空间内容投影。
   * 模型 → 纸张：paper = viewportCenter + (model - viewCenter) × scale，
   * scale = viewportHeight / viewHeight（与旧渲染器一致）；
   * 投影内容以视口世界矩形剪裁（绘制期 scissor）。
   */
  private bakeViewport(
    ent: Extract<AnyEntity, { type: EntityType.VIEWPORT }>,
    color: string,
    depth: number,
    layerName: string,
  ): void {
    const hw = Math.abs(ent.width || 0) / 2;
    const hh = Math.abs(ent.height || 0) / 2;
    if (hw <= 0 || hh <= 0) return;

    // 边界框（细线）。
    const style = lineStyleOf(color, 0, 1);
    this.writePolyline([
      ent.center.x - hw, ent.center.y - hh, ent.center.x + hw, ent.center.y - hh,
      ent.center.x + hw, ent.center.y - hh, ent.center.x + hw, ent.center.y + hh,
      ent.center.x + hw, ent.center.y + hh, ent.center.x - hw, ent.center.y + hh,
      ent.center.x - hw, ent.center.y + hh, ent.center.x - hw, ent.center.y - hh,
    ], style, false);

    const modelEntities = this.options.modelEntities;
    if (!modelEntities || modelEntities.length === 0 || !ent.viewCenter || !ent.viewHeight || ent.viewHeight <= 0) return;
    if (depth >= 2) return; // 视口内不再嵌套视口投影

    const scale = ent.height / ent.viewHeight;
    const viewCenter = ent.viewCenter;
    const modelHalfWidth = hw / scale;
    const window = {
      minX: viewCenter.x - modelHalfWidth,
      maxX: viewCenter.x + modelHalfWidth,
      minY: viewCenter.y - ent.viewHeight / 2,
      maxY: viewCenter.y + ent.viewHeight / 2,
    };

    const clipId = this.pushClipRect({
      minX: ent.center.x - hw, minY: ent.center.y - hh,
      maxX: ent.center.x + hw, maxY: ent.center.y + hh,
    });
    const prevClip = this.currentClipRectId;
    this.currentClipRectId = clipId;
    try {
      const xf = (p: Point2D): Point2D => ({
        x: ent.center.x + (p.x - viewCenter.x) * scale,
        y: ent.center.y + (p.y - viewCenter.y) * scale,
      });
      for (const modelEntity of modelEntities) {
        if (modelEntity.visible === false) continue;
        const ext = modelEntity.extents;
        if (ext && (ext.max.x < window.minX || ext.min.x > window.maxX ||
          ext.max.y < window.minY || ext.min.y > window.maxY)) continue;
        const xformed = xformEntity(modelEntity, xf, scale);
        if (!xformed) continue;
        this.bakeVisible(xformed, layerName || undefined, undefined, depth + 2);
      }
    } finally {
      this.currentClipRectId = prevClip;
    }
  }

  // ── 文字 ──

  private bakeText(ent: DxfText, color: string): void {
    const rawValue = ent.value || '';
    if (!rawValue.trim()) return;
    const styles = this.options.styles;
    const styleName = ent.styleName || 'STANDARD';
    const style = styles?.[styleName] || styles?.[styleName.toUpperCase()];
    const effectiveHeight = getEffectiveTextHeight(ent, styles);
    if (!(effectiveHeight > 0) || !Number.isFinite(effectiveHeight)) return;

    // 文字烘焙标志：期间所有 drawOp（描边 line + glyph + fill）推入文字列表。
    this.inTextBake = true;
    this.curTextHeight = effectiveHeight;

    if (hasOutlineFont()) {
      const outlineLayout = layoutOutlineTextEntity(ent, styles);
      if (outlineLayout && outlineLayout.lines.length > 0) {
        this.writeOutlineTextEntity(outlineLayout, color);
        this.inTextBake = false;
        return;
      }
    }

    const isMText = ent.type === EntityType.MTEXT;
    // 统一走完整解码（%%130 钢筋符号、%%140 上标、%%146 圈号等 TSSD 扩展码，以及 \\U+XXXX、堆叠分数）。
    const lines = (isMText ? cleanMText(rawValue) : cleanCadText(rawValue)).split('\n');

    const position = getCadTextAnchorPosition(ent);
    const rotation = ((ent.rotation || 0) * Math.PI) / 180;
    const cos = Math.cos(rotation), sin = Math.sin(rotation);
    const widthFactor = style?.widthFactor && style.widthFactor > 0 ? style.widthFactor : 1;
    const lineStep = effectiveHeight * (isMText ? TEXT_RENDER_CONFIG.mtextDefaultLineSpacingFactor : 1);

    const hAlign = ent.hAlign || 0;
    const attachment = ent.attachmentPoint || 0;

    lines.forEach((lineText, lineIdx) => {
      if (!lineText.trim()) return;
      // 多行行堆叠沿文字局部「上」方向（旋转后仍垂直于基线）。
      const lineOffset = isMText ? (lines.length - 1 - lineIdx) * lineStep : 0;
      const originX = position.x - sin * lineOffset;
      const originY = position.y + cos * lineOffset;

      const resolution = resolveStrokeFont(style?.fontFileName, style?.bigFontFileName);
      const oblique = resolution?.obliqueAngle ?? 0;

      if (resolution) {
        // ── SHX 描边路径（含 CJK 混排） ──
        const shaping = shapeStrokeText(lineText, resolution.font, {
          height: effectiveHeight, widthFactor, oblique,
        });
        if (shaping.advance <= 0 && !shaping.hasCjk) return;
        const bounds = strokeShapingBounds(shaping);
        const totalWidth = shaping.advance;

        let alignShift = 0;
        if (isMText) {
          if (attachment % 3 === 2) alignShift = -totalWidth / 2;
          else if (attachment % 3 === 0) alignShift = -totalWidth;
        } else if (hAlign === 1 || hAlign === 4) alignShift = -totalWidth / 2;
        else if (hAlign === 2) alignShift = -totalWidth;

        const applyXf = (lx: number, ly: number): [number, number] => ([
          originX + lx * cos - ly * sin,
          originY + lx * sin + ly * cos,
        ]);

        for (const item of shaping.items) {
          if (item.kind !== 'strokes') continue;
          for (const stroke of item.strokes) {
            if (stroke.length < 4) continue;
            const worldPts: number[] = [];
            for (let k = 0; k < stroke.length; k += 2) {
              const [wx, wy] = applyXf(stroke[k] + alignShift, stroke[k + 1]);
              worldPts.push(wx, wy);
            }
            this.writePolyline(worldPts, lineStyleOf(color, 0, 1), false);
          }
        }
        for (const item of shaping.items) {
          if (item.kind !== 'cjk') continue;
          const [wx, wy] = applyXf(item.x + alignShift, 0);
          this.writeCjkGlyph(ent, item.char, wx, wy, rotation, item.height, widthFactor, color);
        }

        const corners = [
          applyXf(alignShift, bounds.minY),
          applyXf(alignShift + totalWidth, bounds.minY),
          applyXf(alignShift + totalWidth, bounds.maxY),
          applyXf(alignShift, bounds.maxY),
        ];
        const bx0 = Math.min(corners[0][0], corners[1][0], corners[2][0], corners[3][0]);
        const by0 = Math.min(corners[0][1], corners[1][1], corners[2][1], corners[3][1]);
        const bx1 = Math.max(corners[0][0], corners[1][0], corners[2][0], corners[3][0]);
        const by1 = Math.max(corners[0][1], corners[1][1], corners[2][1], corners[3][1]);
        if (this.currentBaker) {
          this.baker.updateBounds(bx0, by0, bx1, by1);
        }
      } else {
        // ── 系统字体图集路径 ──
        this.writeAtlasTextLine(ent, lineText, originX, originY, rotation, effectiveHeight, widthFactor, color, hAlign, attachment, isMText);
      }
    });
    // 文字烘焙结束：恢复几何 op 通道。
    this.inTextBake = false;
  }

  /**
   * 将一个文字实体（单行或多行）通过 opentype.js 提取轮廓并由 earcut 三角化写入实心多边形网格（fill）。
   * 遵循 AutoCAD 规范计算完整对齐方式（hAlign、vAlign、MTEXT attachmentPoint、Fit/Aligned自适应与自动折行）。
   * 纯几何渲染，无位图/图集/分辨率限制，极端放大边缘依然平滑精确。
   */
  private writeOutlineTextEntity(
    layout: NonNullable<ReturnType<typeof layoutOutlineTextEntity>>,
    color: string,
  ): void {
    const cos = Math.cos(layout.rotation);
    const sin = Math.sin(layout.rotation);
    const origin = layout.origin;
    const fillStyle = { color: hexToRgba(color) };

    for (const line of layout.lines) {
      const v = line.vertices;
      if (v.length < 6) continue;
      // 每行独立统计包围盒并独立路由：此前跨行累积的包围盒会让后续行落入其它分块，
      // 而分块包围盒只更新了最后一块——视口剔除随即把那块文字整体丢掉
      // （表现为"远处看不到文字、放大到那个位置才出现"）。
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const worldVerts = new Float64Array(v.length);
      for (let i = 0; i < v.length; i += 2) {
        const lx = line.localX + v[i], ly = line.localY + v[i + 1];
        const wx = origin.x + lx * cos - ly * sin;
        const wy = origin.y + lx * sin + ly * cos;
        worldVerts[i] = wx;
        worldVerts[i + 1] = wy;
        if (wx < minX) minX = wx;
        if (wx > maxX) maxX = wx;
        if (wy < minY) minY = wy;
        if (wy > maxY) maxY = wy;
      }

      const baker = this.routeTo((minX + maxX) / 2, (minY + maxY) / 2);
      const vertexStart = baker.fill.vertexCount;
      for (let i = 0; i + 5 < worldVerts.length; i += 6) {
        baker.fill.addTriangle(
          worldVerts[i], worldVerts[i + 1],
          worldVerts[i + 2], worldVerts[i + 3],
          worldVerts[i + 4], worldVerts[i + 5],
          fillStyle,
        );
      }
      const appended = baker.fill.vertexCount - vertexStart;
      if (appended > 0) {
        this.pushDrawOp('fill', vertexStart, appended);
        this.stats.fillVertices += appended;
        this.recordEntityOp(baker, 'fill', vertexStart, appended);
      }
      baker.updateBounds(minX, minY, maxX, maxY);
    }
  }
  /**
   * 字形世界缩放系数：CAD 字高 H 表示「大写字高」，
   * 系统字体按 em 光栅化（capHeight ≈ 0.7em），必须换算才能得到正确视觉字高。
   * 中文（bigfont 语义）按字形墨迹高度直接等于字高处理。
   */
  private glyphWorldScale(styleKey: GlyphStyleKey, char: string, glyph: { heightPx: number }, height: number): number {
    const isCjk = (char.codePointAt(0) ?? 0) > 0x7F;
    if (isCjk) {
      return height / Math.max(1, glyph.heightPx);
    }
    const capRatio = this.atlas.getCapRatio(styleKey);
    return height / Math.max(1e-6, capRatio * RASTER_PX);
  }

  private writeAtlasTextLine(
    ent: DxfText,
    text: string,
    originX: number,
    originY: number,
    rotation: number,
    height: number,
    widthFactor: number,
    color: string,
    hAlign: number,
    attachment: number,
    isMText: boolean,
  ): void {
    const styleName = ent.styleName || 'STANDARD';
    const family = getStyleFontFamily(styleName, this.options.styles);
    const styleKey: GlyphStyleKey = { fontFamily: family, bold: false, italic: false };
    const cos = Math.cos(rotation), sin = Math.sin(rotation);
    /** 拉丁字符的 em → 世界单位换算（大写字高 = 字高）。 */
    const emScale = height / Math.max(1e-6, this.atlas.getCapRatio(styleKey) * RASTER_PX);

    const chars = Array.from(text);
    const placed: Array<{ glyph: NonNullable<ReturnType<GlyphAtlas['get']>>; x: number; char: string }> = [];
    let xWorld = 0;
    for (const ch of chars) {
      if (ch === ' ') { xWorld += height * 0.30 * widthFactor; continue; }
      const glyph = this.atlas.get(styleKey, ch);
      const isCjk = (ch.codePointAt(0) ?? 0) > 0x7F;
      if (glyph) placed.push({ glyph, x: xWorld, char: ch });
      const advance = isCjk
        ? height                                       // 中文全角 = 1 倍字高
        : glyph ? glyph.advancePx * emScale : height * 0.5;
      xWorld += advance * widthFactor;
    }
    if (!placed.length) return;
    const totalWidth = xWorld;

    let alignShift = 0;
    if (isMText) {
      if (attachment % 3 === 2) alignShift = -totalWidth / 2;
      else if (attachment % 3 === 0) alignShift = -totalWidth;
    } else if (hAlign === 1 || hAlign === 4) alignShift = -totalWidth / 2;
    else if (hAlign === 2) alignShift = -totalWidth;

    const applyXf = (lx: number, ly: number): [number, number] => ([
      originX + lx * cos - ly * sin,
      originY + lx * sin + ly * cos,
    ]);

    const quads: Array<{ corners: [number, number][]; uvs: [number, number][]; page?: number }> = [];
    for (const { glyph, x: gx, char } of placed) {
      const s = this.glyphWorldScale(styleKey, char, glyph, height);
      const lx = alignShift + gx + glyph.offsetX * s * widthFactor;
      const ly = glyph.offsetY * s;
      const w = glyph.widthPx * s * widthFactor;
      const h = glyph.heightPx * s;
      const cornerLocals: [number, number][] = [
        [lx, ly + h], [lx + w, ly + h], [lx + w, ly], [lx, ly],
      ];
      const corners = cornerLocals.map(([clx, cly]) => applyXf(clx, cly)) as [number, number][];
      quads.push({
        corners,
        uvs: [[glyph.u0, glyph.v0], [glyph.u1, glyph.v0], [glyph.u1, glyph.v1], [glyph.u0, glyph.v1]],
        page: glyph.page,
      });
    }
    const c0 = applyXf(alignShift, 0);
    const c1 = applyXf(alignShift + totalWidth, 0);
    const c2 = applyXf(alignShift + totalWidth, height * 1.25);
    const c3 = applyXf(alignShift, height * 1.25);
    const bx0 = Math.min(c0[0], c1[0], c2[0], c3[0]);
    const by0 = Math.min(c0[1], c1[1], c2[1], c3[1]);
    const bx1 = Math.max(c0[0], c1[0], c2[0], c3[0]);
    const by1 = Math.max(c0[1], c1[1], c2[1], c3[1]);
    this.writeGlyphQuads(quads, color, [bx0, by0, bx1, by1]);
  }

  private writeCjkGlyph(
    ent: DxfText,
    char: string,
    worldX: number,
    worldY: number,
    rotation: number,
    height: number,
    widthFactor: number,
    color: string,
  ): void {
    const styleName = ent.styleName || 'STANDARD';
    const family = getStyleFontFamily(styleName, this.options.styles);
    const styleKey: GlyphStyleKey = { fontFamily: family, bold: false, italic: false };
    const glyph = this.atlas.get(styleKey, char);
    if (!glyph) return;
    const cos = Math.cos(rotation), sin = Math.sin(rotation);
    const s = this.glyphWorldScale(styleKey, char, glyph, height);
    const lx = glyph.offsetX * s * widthFactor;
    const ly = glyph.offsetY * s;
    const w = glyph.widthPx * s * widthFactor;
    const h = glyph.heightPx * s;
    const cornerLocals: [number, number][] = [
      [lx, ly + h], [lx + w, ly + h], [lx + w, ly], [lx, ly],
    ];
    const corners = cornerLocals.map(([clx, cly]) => ([
      worldX + clx * cos - cly * sin,
      worldY + clx * sin + cly * cos,
    ])) as [number, number][];
    this.writeGlyphQuads([{
      corners,
      uvs: [[glyph.u0, glyph.v0], [glyph.u1, glyph.v0], [glyph.u1, glyph.v1], [glyph.u0, glyph.v1]],
      page: glyph.page,
    }], color, [worldX, worldY - height, worldX + w + height, worldY + height]);
  }
}

/** 块内实体变换特化（返回 null 表示不支持，跳过）。 */
const xformEntity = (ent: AnyEntity, xf: (p: Point2D) => Point2D, sx: number): AnyEntity | null => {
  switch (ent.type) {
    case EntityType.LINE:
      return { ...ent, start: xf(ent.start), end: xf(ent.end) };
    case EntityType.LWPOLYLINE:
    case EntityType.POLYLINE:
      return { ...ent, points: ent.points.map(xf) };
    case EntityType.MLINE:
      return { ...ent, vertices: ent.vertices.map(xf) };
    case EntityType.SPLINE:
      return {
        ...ent,
        controlPoints: ent.controlPoints?.map(xf) ?? [],
        fitPoints: ent.fitPoints?.map(xf),
        calculatedPoints: ent.calculatedPoints?.map(xf),
      };
    case EntityType.CIRCLE:
    case EntityType.ARC: {
      const c = xf(ent.center);
      const r0 = xf({ x: ent.center.x, y: ent.center.y });
      const r1 = xf({ x: ent.center.x + ent.radius, y: ent.center.y });
      return { ...ent, center: c, radius: Math.hypot(r1.x - r0.x, r1.y - r0.y) * Math.sign(sx || 1) };
    }
    case EntityType.ELLIPSE: {
      const c = xf(ent.center);
      const major = xf({ x: ent.center.x + ent.majorAxis.x, y: ent.center.y + ent.majorAxis.y });
      const minorEnd = xf({ x: ent.center.x + ent.majorAxis.x * ent.ratio, y: ent.center.y + ent.majorAxis.y * ent.ratio });
      return {
        ...ent,
        center: c,
        majorAxis: { x: major.x - c.x, y: major.y - c.y },
        ratio: Math.hypot(minorEnd.x - major.x, minorEnd.y - major.y) / (Math.hypot(major.x - c.x, major.y - c.y) || 1),
        startParam: ent.startParam,
        endParam: ent.endParam,
      };
    }
    case EntityType.SOLID:
    case EntityType.THREEDFACE:
      return { ...ent, points: ent.points.map(xf) };
    case EntityType.POINT:
      return { ...ent, position: xf(ent.position) };
    case EntityType.INSERT: {
      const p = xf(ent.position);
      const q = xf({ x: ent.position.x + 1, y: ent.position.y });
      const scale = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      const rotDelta = Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI;
      const curScale = ent.scale || { x: 1, y: 1, z: 1 };
      return {
        ...ent,
        position: p,
        scale: {
          x: curScale.x * scale,
          y: curScale.y * scale,
          z: curScale.z * scale,
        },
        rotation: (ent.rotation || 0) + rotDelta,
      };
    }
    case EntityType.TEXT:
    case EntityType.MTEXT:
    case EntityType.ATTRIB:
    case EntityType.ATTDEF: {
      const p = xf(ent.position);
      const q = xf({ x: ent.position.x + 1, y: ent.position.y });
      const scale = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      return {
        ...ent,
        position: p,
        secondPosition: ent.secondPosition ? xf(ent.secondPosition) : undefined,
        height: ent.height * scale,
        width: ent.width !== undefined && ent.width > 0 ? ent.width * scale : ent.width,
        boxHeight: ent.boxHeight !== undefined && ent.boxHeight > 0 ? ent.boxHeight * scale : ent.boxHeight,
        actualWidth: ent.actualWidth !== undefined && ent.actualWidth > 0 ? ent.actualWidth * scale : ent.actualWidth,
        rotation: (ent.rotation || 0) + Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI,
      };
    }
    case EntityType.HATCH: {
      return {
        ...ent,
        loops: ent.loops.map(loop => ({
          ...loop,
          points: loop.points?.map(xf),
          edges: loop.edges.map(edge => ({
            ...edge,
            start: edge.start ? xf(edge.start) : undefined,
            end: edge.end ? xf(edge.end) : undefined,
            center: edge.center ? xf(edge.center) : undefined,
            controlPoints: edge.controlPoints?.map(xf),
            calculatedPoints: edge.calculatedPoints?.map(xf),
          })),
        })),
      };
    }
    case EntityType.LEADER:
      return { ...ent, points: ent.points.map(xf) };
    case EntityType.SHAPE:
      return null;
    default:
      return null;
  }
};

/** 创建并执行场景烘焙。 */
export const buildScene = (options: SceneBuildOptions, atlas: GlyphAtlas): BuiltScene => {
  const all = options.entities;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ent of all) {
    const ext = ent.extents;
    if (!ext || !Number.isFinite(ext.min.x) || !Number.isFinite(ext.max.x)) continue;
    if (ext.min.x < minX) minX = ext.min.x;
    if (ext.min.y < minY) minY = ext.min.y;
    if (ext.max.x > maxX) maxX = ext.max.x;
    if (ext.max.y > maxY) maxY = ext.max.y;
  }
  if (!Number.isFinite(minX)) { minX = -100; minY = -100; maxX = 100; maxY = 100; }

  // 分块策略：目标 ~512 实体/块，上限 32×32 网格。
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  const targetChunks = Math.max(1, Math.min(1024, Math.ceil(all.length / 512)));
  const side = Math.max(1, Math.ceil(Math.sqrt(targetChunks)));
  const size = Math.max(spanX, spanY) / side;

  const baker = new SceneBaker(options, atlas, {
    minX: minX - size * 0.25,
    minY: minY - size * 0.25,
    size,
    nx: side + 1,
    ny: side + 1,
  });
  return baker.bake();
};






