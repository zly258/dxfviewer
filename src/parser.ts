export { parseDxf } from '@/io/parser';
export { EntityType, ToolMode } from '@/types';
export type * from '@/types';

// 文字转义解码：AutoCAD 标准码与 TSSD 扩展码（%%130 钢筋、%%140 上下标、
// %%146 圈号等）。渲染与二次开发共用同一实现，导出便于校验与自定义排版。
export { decodeCadSpecialCodes, cleanCadText, cleanMText } from '@/utils/textUtils';

// 组码值类型注册表：读写共用，导出便于校验脚本与二次开发使用。
export {
  formatDouble,
  formatGroupCode,
  formatGroupValue,
  formatHandle,
  formatInt,
  getGroupValueType,
  isFloatingGroupCode,
} from '@/io/dxf/groupCodes';
export type { GroupValueType } from '@/io/dxf/groupCodes';

