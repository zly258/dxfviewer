/**
 * 编程式 DXF 构建器。
 *
 * 让本库不只是「转换器」：不读任何文件也能生成合法图纸。
 *
 * ```ts
 * const doc = createDocument({ version: 'AC1015', units: 4 }); // 4 = mm
 * doc.addLayer({ name: 'WALL', color: 1 })
 *    .addLine({ layer: 'WALL', start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } })
 *    .addCircle({ center: { x: 500, y: 500 }, radius: 200 });
 * const dxf: string = doc.toDxfString();
 * const data: DxfData = doc.toDxfData();   // 可直接喂给 <DxfViewer>
 * ```
 */
import {
  AnyEntity,
  DxfBlock,
  DxfData,
  DxfLayer,
  DxfLayout,
  EntityType,
  Point2D,
} from '@/types';
import { calculateExtents } from '@/core/geometry/extents';
import { DxfVersion, WriteDxfOptions } from './writerState';
import { writeDxf } from './dxfWriter';

export interface CreateDocumentOptions {
  /** 目标 DXF 版本，默认 AC1015 */
  version?: DxfVersion;
  /** $INSUNITS：0=无单位 1=英寸 2=英尺 4=毫米 5=厘米 6=米，默认 4（毫米） */
  units?: number;
}

export interface CommonSpec {
  layer?: string;
  color?: number;
  trueColor?: number;
  lineType?: string;
  lineTypeScale?: number;
  lineweight?: number;
}

export interface LineSpec extends CommonSpec { start: Point2D; end: Point2D; }
export interface PointSpec extends CommonSpec { position: Point2D; }
export interface CircleSpec extends CommonSpec { center: Point2D; radius: number; }
export interface ArcSpec extends CommonSpec { center: Point2D; radius: number; startAngle: number; endAngle: number; }
export interface EllipseSpec extends CommonSpec { center: Point2D; majorAxis: Point2D; ratio: number; startParam?: number; endParam?: number; }
export interface PolylineSpec extends CommonSpec {
  points: Point2D[];
  bulges?: number[];
  closed?: boolean;
  constantWidth?: number;
  /** 强制输出传统 POLYLINE（默认 LWPOLYLINE，R12 写出时自动降级） */
  legacy?: boolean;
}
export interface SplineSpec extends CommonSpec {
  controlPoints: Point2D[];
  degree?: number;
  knots?: number[];
  weights?: number[];
  fitPoints?: Point2D[];
}
export interface TextSpec extends CommonSpec {
  position: Point2D;
  height: number;
  value: string;
  rotation?: number;
  styleName?: string;
  widthFactor?: number;
  hAlign?: number;
  vAlign?: number;
}
export interface MTextSpec extends CommonSpec {
  position: Point2D;
  height: number;
  value: string;
  /** 换行宽度（图纸单位，0=不换行） */
  width?: number;
  attachmentPoint?: number;
  rotation?: number;
  styleName?: string;
}
export interface InsertSpec extends CommonSpec {
  blockName: string;
  position: Point2D;
  scale?: { x?: number; y?: number; z?: number };
  rotation?: number;
  rowCount?: number;
  colCount?: number;
  rowSpacing?: number;
  colSpacing?: number;
}
export interface SolidSpec extends CommonSpec {
  /** 显示顺序四边形 [p0,p1,p2,p3]（3 点三角形亦可），内部按 DXF 蝴蝶结顺序存储 */
  points: Point2D[];
}
export interface SolidHatchSpec extends CommonSpec {
  /** 外环顶点（自动闭合） */
  outer: Point2D[];
  patternName?: string;
}
export interface DimensionSpec extends CommonSpec {
  /** 引用的标注几何块名（通常为匿名 *D 块，需先 addBlock 注册） */
  blockName: string;
  definitionPoint: Point2D;
  textMidPoint: Point2D;
  /** 70 组码：0-6 为类型位，|32 表示引用外部几何块 */
  dimType?: number;
  text?: string;
  styleName?: string;
  measurement?: number;
  linearP1?: Point2D;
  linearP2?: Point2D;
  arcP1?: Point2D;
  arcP2?: Point2D;
}
export interface BlockSpec {
  name: string;
  basePoint?: Point2D;
  /** 在块内添加实体；与 entities 二选一 */
  build?: (block: EntitySink) => void;
  entities?: AnyEntity[];
}

const nextId = (): string => {
  const cryptoRef = typeof crypto !== 'undefined' ? crypto : undefined;
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') {
    return cryptoRef.randomUUID();
  }
  return `ent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const buildCommon = (spec: CommonSpec | undefined) => ({
  id: nextId(),
  layer: spec?.layer || '0',
  color: spec?.color,
  trueColor: spec?.trueColor,
  lineType: spec?.lineType,
  lineTypeScale: spec?.lineTypeScale,
  lineweight: spec?.lineweight,
  visible: true,
});

/**
 * 实体收集器：文档与块共用的 add* 方法集。
 */
export class EntitySink {
  protected readonly collected: AnyEntity[] = [];

  addLine(spec: LineSpec): this {
    this.collected.push({ ...buildCommon(spec), type: EntityType.LINE, start: { ...spec.start }, end: { ...spec.end } } as AnyEntity);
    return this;
  }

  addPoint(spec: PointSpec): this {
    this.collected.push({ ...buildCommon(spec), type: EntityType.POINT, position: { ...spec.position } } as AnyEntity);
    return this;
  }

  addCircle(spec: CircleSpec): this {
    this.collected.push({ ...buildCommon(spec), type: EntityType.CIRCLE, center: { ...spec.center }, radius: spec.radius } as AnyEntity);
    return this;
  }

  addArc(spec: ArcSpec): this {
    this.collected.push({
      ...buildCommon(spec),
      type: EntityType.ARC,
      center: { ...spec.center },
      radius: spec.radius,
      startAngle: spec.startAngle,
      endAngle: spec.endAngle,
      isCounterClockwise: true,
    } as AnyEntity);
    return this;
  }

  addEllipse(spec: EllipseSpec): this {
    this.collected.push({
      ...buildCommon(spec),
      type: EntityType.ELLIPSE,
      center: { ...spec.center },
      majorAxis: { ...spec.majorAxis },
      ratio: spec.ratio,
      startParam: spec.startParam ?? 0,
      endParam: spec.endParam ?? Math.PI * 2,
    } as AnyEntity);
    return this;
  }

  addPolyline(spec: PolylineSpec): this {
    this.collected.push({
      ...buildCommon(spec),
      type: spec.legacy ? EntityType.POLYLINE : EntityType.LWPOLYLINE,
      points: spec.points.map(point => ({ ...point })),
      bulges: spec.bulges ? [...spec.bulges] : undefined,
      closed: spec.closed ?? false,
      constantWidth: spec.constantWidth,
    } as AnyEntity);
    return this;
  }

  addSpline(spec: SplineSpec): this {
    this.collected.push({
      ...buildCommon(spec),
      type: EntityType.SPLINE,
      controlPoints: spec.controlPoints.map(point => ({ ...point })),
      fitPoints: spec.fitPoints?.map(point => ({ ...point })),
      degree: spec.degree ?? 3,
      knots: spec.knots ? [...spec.knots] : [],
      weights: spec.weights ? [...spec.weights] : [],
      flags: 8,
    } as AnyEntity);
    return this;
  }

  addText(spec: TextSpec): this {
    this.collected.push({
      ...buildCommon(spec),
      type: EntityType.TEXT,
      position: { ...spec.position },
      height: spec.height,
      value: spec.value,
      rotation: spec.rotation ?? 0,
      widthFactor: spec.widthFactor,
      hAlign: spec.hAlign ?? 0,
      vAlign: spec.vAlign ?? 0,
      styleName: spec.styleName || 'Standard',
    } as AnyEntity);
    return this;
  }

  addMText(spec: MTextSpec): this {
    this.collected.push({
      ...buildCommon(spec),
      type: EntityType.MTEXT,
      position: { ...spec.position },
      height: spec.height,
      value: spec.value,
      width: spec.width ?? 0,
      attachmentPoint: spec.attachmentPoint ?? 1,
      drawingDirection: 1,
      rotation: spec.rotation ?? 0,
      styleName: spec.styleName || 'Standard',
    } as AnyEntity);
    return this;
  }

  addInsert(spec: InsertSpec): this {
    this.collected.push({
      ...buildCommon(spec),
      type: EntityType.INSERT,
      blockName: spec.blockName,
      position: { ...spec.position },
      scale: {
        x: spec.scale?.x ?? 1,
        y: spec.scale?.y ?? 1,
        z: spec.scale?.z ?? 1,
      },
      rotation: spec.rotation ?? 0,
      rowCount: spec.rowCount ?? 1,
      colCount: spec.colCount ?? 1,
      rowSpacing: spec.rowSpacing ?? 0,
      colSpacing: spec.colSpacing ?? 0,
    } as AnyEntity);
    return this;
  }

  addSolid(spec: SolidSpec): this {
    const points = spec.points.map(point => ({ ...point }));
    // 解析器/写出器的内部约定：[p0, p1, p3, p2]（显示顺序），这里做同构转换
    const stored = points.length >= 4
      ? [points[0], points[1], points[3], points[2]]
      : points;
    this.collected.push({ ...buildCommon(spec), type: EntityType.SOLID, points: stored } as AnyEntity);
    return this;
  }

  addSolidHatch(spec: SolidHatchSpec): this {
    if (spec.outer.length < 3) {
      throw new Error('addSolidHatch: 外环至少需要 3 个顶点');
    }
    this.collected.push({
      ...buildCommon(spec),
      type: EntityType.HATCH,
      patternName: spec.patternName || 'SOLID',
      solid: true,
      scale: 1,
      angle: 0,
      loops: [{
        type: 2, // polyline 边界
        edges: [],
        isPolyline: true,
        points: spec.outer.map(point => ({ ...point })),
        bulges: spec.outer.map(() => 0),
      }],
    } as AnyEntity);
    return this;
  }

  /**
   * 添加标注实体。
   *
   * 注意：DIMENSION 的可见几何存放在 `blockName` 指向的块（通常匿名 *D 块），
   * 需先 `addBlock({ name: '*D1', ... })` 注册几何；`dimType|32` 表示引用外部块。
   */
  addDimension(spec: DimensionSpec): this {
    this.collected.push({
      ...buildCommon(spec),
      type: EntityType.DIMENSION,
      blockName: spec.blockName,
      definitionPoint: { ...spec.definitionPoint },
      textMidPoint: { ...spec.textMidPoint },
      dimType: spec.dimType ?? 0,
      text: spec.text,
      styleName: spec.styleName || 'Standard',
      measurement: spec.measurement,
      linearP1: spec.linearP1 ? { ...spec.linearP1 } : undefined,
      linearP2: spec.linearP2 ? { ...spec.linearP2 } : undefined,
      arcP1: spec.arcP1 ? { ...spec.arcP1 } : undefined,
      arcP2: spec.arcP2 ? { ...spec.arcP2 } : undefined,
    } as AnyEntity);
    return this;
  }

  /** 当前已收集的实体（只读快照）。 */
  getEntities(): readonly AnyEntity[] {
    return this.collected;
  }
}

/**
 * DXF 文档构建器。
 */
export class DxfDocumentBuilder extends EntitySink {
  private readonly version: DxfVersion;
  private readonly insUnits: number;
  private readonly layerMap = new Map<string, DxfLayer>();
  private readonly blockMap = new Map<string, DxfBlock>();

  constructor(options: CreateDocumentOptions = {}) {
    super();
    this.version = options.version ?? 'AC1015';
    this.insUnits = options.units ?? 4;
    this.layerMap.set('0', { name: '0', color: 7, isVisible: true, lineType: 'CONTINUOUS' });
  }

  /** 新增（或覆盖）图层。 */
  addLayer(layer: { name: string; color?: number; lineType?: string; lineweight?: number; isVisible?: boolean }): this {
    if (!layer.name || !layer.name.trim()) {
      throw new Error('addLayer: 图层名不能为空');
    }
    this.layerMap.set(layer.name, {
      name: layer.name,
      color: layer.color ?? 7,
      isVisible: layer.isVisible ?? true,
      lineType: layer.lineType || 'CONTINUOUS',
      lineweight: layer.lineweight,
    });
    return this;
  }

  /**
   * 定义块。块内实体通过 `build` 回调的独立收集器添加：
   * ```ts
   * doc.addBlock({ name: 'BOLT', basePoint: { x: 0, y: 0 }, build: b => {
   *   b.addCircle({ center: { x: 0, y: 0 }, radius: 5 });
   * } });
   * ```
   */
  addBlock(spec: BlockSpec): this {
    if (!spec.name || !spec.name.trim()) {
      throw new Error('addBlock: 块名不能为空');
    }
    if (this.blockMap.has(spec.name)) {
      throw new Error(`addBlock: 块 "${spec.name}" 已定义`);
    }
    const sink = new EntitySink();
    if (spec.build) spec.build(sink);
    const entities = [...(spec.entities ?? []), ...sink.getEntities()];
    this.blockMap.set(spec.name, {
      name: spec.name,
      basePoint: spec.basePoint ? { ...spec.basePoint } : { x: 0, y: 0 },
      entities,
    });
    return this;
  }

  /** 汇总为 DxfData（可放大转 DxfString，也可直接喂给 <DxfViewer> 预览）。 */
  toDxfData(): DxfData {
    const entities = [...this.collected];
    const blocks: Record<string, DxfBlock> = {};
    for (const [name, block] of this.blockMap) blocks[name] = block;

    const styles = {
      Standard: { name: 'Standard', fontFileName: 'txt', height: 0, widthFactor: 1 },
    };
    const lineTypes = {
      CONTINUOUS: { name: 'CONTINUOUS', pattern: [] as number[], totalLength: 0 },
    };
    const layers: Record<string, DxfLayer> = {};
    for (const [name, layer] of this.layerMap) layers[name] = layer;

    const extents = calculateExtents(entities, blocks, styles);

    const modelLayout: DxfLayout = {
      id: 'Model',
      name: 'Model',
      displayName: 'Model',
      isModel: true,
      entities,
      tabOrder: -1,
      extents,
    };

    return {
      header: {
        extMin: extents?.min ?? { x: 0, y: 0 },
        extMax: extents?.max ?? { x: 0, y: 0 },
        insUnits: this.insUnits,
        ltScale: 1,
        celtscale: 1,
      },
      entities,
      allEntities: entities,
      layouts: [modelLayout],
      activeLayoutName: 'Model',
      layers,
      blocks,
      styles,
      lineTypes,
      extents,
    };
  }

  /** 写出 DXF 文本（重建式写出，与 writeDxf 相同管线）。 */
  toDxfString(options: Omit<WriteDxfOptions, 'version'> = {}): { content: string; skipped: ReturnType<typeof writeDxf>['skipped'] } {
    const result = writeDxf(this.toDxfData(), { ...options, version: this.version });
    return { content: result.content, skipped: result.skipped };
  }

  /** 写出 DXF Blob（浏览器下载用）。 */
  toDxfBlob(options: Omit<WriteDxfOptions, 'version'> = {}): Blob {
    const { content } = this.toDxfString(options);
    return new Blob([content], { type: 'application/dxf' });
  }
}

/** 创建文档构建器。 */
export const createDocument = (options?: CreateDocumentOptions): DxfDocumentBuilder =>
  new DxfDocumentBuilder(options);
