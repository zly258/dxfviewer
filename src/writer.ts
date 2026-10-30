/**
 * DXF 写出入口（不依赖 React / DOM）。
 *
 * 定位：以 `DxfData` 为数据源**重建**一份规范 DXF，而不是把源文件原样另存。
 * 源文件中未建模的信息（XDATA、未知表/对象、扩展词典）不会保留，
 * 不支持或降级的实体通过 `skipped` 显式报告。
 */
export { writeDxf, writeDxfBlob } from '@/core/writer/dxfWriter';
export type { WriteDxfResult, WriterContext, TableHandles } from '@/core/writer/dxfWriter';
export type { DxfVersion, SkippedEntity, WriteDxfOptions } from '@/core/writer/writerState';

// 编程式构建：从零生成 DXF 图纸
export { createDocument, DxfDocumentBuilder, EntitySink } from '@/core/writer/documentBuilder';
export type {
  ArcSpec,
  BlockSpec,
  CircleSpec,
  CommonSpec,
  CreateDocumentOptions,
  EllipseSpec,
  InsertSpec,
  LineSpec,
  MTextSpec,
  PointSpec,
  PolylineSpec,
  SolidHatchSpec,
  SolidSpec,
  SplineSpec,
  TextSpec,
} from '@/core/writer/documentBuilder';

// HATCH 内置图案定义（诊断/扩展用）
export { getHatchPattern, listHatchPatternNames } from '@/core/writer/patterns';
export type { HatchPatternLine } from '@/core/writer/patterns';

export {
  formatDouble,
  formatGroupCode,
  formatGroupValue,
  formatHandle,
  formatInt,
  getGroupValueType,
  isFloatingGroupCode,
} from '@/core/dxf/groupCodes';
export type { GroupValueType } from '@/core/dxf/groupCodes';

export { EntityType, ToolMode } from '@/types';
export type * from '@/types';
