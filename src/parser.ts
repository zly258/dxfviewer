export { parseDxf } from '@/core/parser';
export { EntityType, ToolMode } from '@/types';
export type * from '@/types';

// 组码值类型注册表：读写共用，导出便于校验脚本与二次开发使用。
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
