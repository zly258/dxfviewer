/**
 * DXF 写出器状态机与写缓冲。
 *
 * 负责：
 * - 组码分块写缓冲（内存聚合与统一格式化）
 * - 句柄（Handle）统一自增分配与 $HANDSEED 跟踪
 * - AC1015 (AutoCAD 2000) 与 AC1009 (AutoCAD R12) 语法分支管理
 * - 表对象/块记录句柄映射
 * - 坐标逆平移偏移量注入
 * - 跳过项（skipped）登记
 */
import { Point2D } from '@/types';
import {
  formatGroupCode,
  formatGroupValue,
  formatHandle,
} from '@/core/dxf/groupCodes';

export type DxfVersion = 'AC1015' | 'AC1009';

export interface SkippedEntity {
  type: string;
  id?: string;
  reason: string;
}

export interface WriteDxfOptions {
  /** 目标 DXF 版本，默认 AC1015 (AutoCAD 2000) */
  version?: DxfVersion;
  /** 是否保留图纸在查看器中被平移后的坐标（默认 false：自动加回 data.offset 还原绝对坐标） */
  preserveOffset?: boolean;
  /**
   * 保真回放：实体带 `raw` 组码快照（parseDxf({ preserveRaw: true }) 采集）时
   * 原样回放，保留解析器未建模的组码与 XDATA；句柄/归属仍由写出器统一重编
   * 以保证唯一性与结构正确。默认 false（重建式写出）。
   */
  preserveRaw?: boolean;
}

export class WriterState {
  public readonly version: DxfVersion;
  public readonly offset: Point2D;
  public readonly skipped: SkippedEntity[] = [];

  private handleCounter = 0x30;
  private readonly chunks: string[] = [];

  /**
   * 当前写出的布局名。
   * 写入图纸空间块或 ENTITIES 段前设置，实体公共组码据此输出 410 组码，
   * 让解析器把实体准确归回布局（否则只能靠块名后缀索引推断，容易错位）。
   */
  public currentLayoutName: string | null = null;

  /** 保真回放开关（来自 WriteDxfOptions.preserveRaw）。 */
  public readonly preserveRaw: boolean;

  constructor(options: WriteDxfOptions = {}, dataOffset?: Point2D) {
    this.version = options.version ?? 'AC1015';
    this.offset = options.preserveOffset ? { x: 0, y: 0 } : (dataOffset ?? { x: 0, y: 0 });
    this.preserveRaw = options.preserveRaw ?? false;
  }

  public isR12(): boolean {
    return this.version === 'AC1009';
  }

  /**
   * 分配下一个十六进制句柄。
   */
  public allocHandle(): string {
    const handle = this.handleCounter.toString(16).toUpperCase();
    this.handleCounter++;
    return handle;
  }

  /**
   * 获取下一个即将分配的句柄，用于 HEADER 中的 $HANDSEED。
   */
  public getHandseed(): string {
    return this.handleCounter.toString(16).toUpperCase();
  }

  /**
   * 写入一个组码及其取值。
   */
  public writeGroup(code: number, value: string | number | boolean): void {
    this.chunks.push(`${formatGroupCode(code)}\n${formatGroupValue(code, value)}\n`);
  }

  /**
   * 写入子类标记（100 AcDbXxx）。R12 模式下自动忽略。
   */
  public writeSubclass(subclassName: string): void {
    if (!this.isR12()) {
      this.writeGroup(100, subclassName);
    }
  }

  /**
   * 写入句柄（5 <handle>）。R12 模式下自动忽略。
   * @param preferred 可选偏好句柄，未提供则自增分配
   */
  public writeHandle(preferred?: string | number): string {
    if (this.isR12()) return '';
    const handle = preferred !== undefined && preferred !== ''
      ? formatHandle(preferred)
      : this.allocHandle();
    this.writeGroup(5, handle);
    return handle;
  }

  /**
   * 写入所有者句柄（330 <handle>）。R12 模式下自动忽略。
   */
  public writeOwner(ownerHandle: string): void {
    if (!this.isR12() && ownerHandle) {
      this.writeGroup(330, ownerHandle);
    }
  }

  /**
   * 登记暂不支持或被降级处理的实体。
   */
  public addSkipped(type: string, reason: string, id?: string): void {
    this.skipped.push({ type, id, reason });
  }

  /**
   * 汇总写出字符串。
   */
  public toString(): string {
    return this.chunks.join('');
  }
}
