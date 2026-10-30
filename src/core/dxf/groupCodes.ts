/**
 * DXF 组码值类型注册表（读 / 写共用）。
 *
 * 解析器此前是「按需 parseFloat/parseInt」，写出器若再各写一套格式化规则，
 * 两边的类型认知必然漂移：读的时候把 370 当数字、写的时候误当成字符串，
 * 生成的文件在 CAD 端可能被静默忽略。这里按 DXF 规范把组码区间的值类型
 * 集中定义一次，parser / writer / 校验脚本都从这里取。
 *
 * 说明：本文件只负责「值类型」与「文本序列化」，不负责语义（语义仍在各
 * entityParser / entityWriter 中）。
 */

export type GroupValueType =
  | 'string'
  | 'double'
  | 'int16'
  | 'int32'
  | 'int64'
  | 'bool'
  | 'handle'
  | 'binary';

/** 组码区间定义，按 code 升序排列，命中即返回。 */
interface GroupCodeRange {
  from: number;
  to: number;
  type: GroupValueType;
}

const GROUP_CODE_RANGES: readonly GroupCodeRange[] = [
  { from: 0, to: 9, type: 'string' },
  { from: 10, to: 59, type: 'double' },
  { from: 60, to: 79, type: 'int16' },
  { from: 90, to: 99, type: 'int32' },
  { from: 100, to: 102, type: 'string' },
  { from: 105, to: 105, type: 'handle' },
  { from: 110, to: 149, type: 'double' },
  { from: 160, to: 169, type: 'int64' },
  { from: 170, to: 179, type: 'int16' },
  { from: 210, to: 239, type: 'double' },
  { from: 270, to: 289, type: 'int16' },
  { from: 290, to: 299, type: 'bool' },
  { from: 300, to: 309, type: 'string' },
  { from: 310, to: 319, type: 'binary' },
  { from: 320, to: 369, type: 'handle' },
  { from: 370, to: 389, type: 'int16' },
  { from: 390, to: 399, type: 'handle' },
  { from: 400, to: 409, type: 'int16' },
  { from: 410, to: 419, type: 'string' },
  { from: 420, to: 429, type: 'int32' },
  { from: 430, to: 439, type: 'string' },
  { from: 440, to: 459, type: 'int32' },
  { from: 460, to: 469, type: 'double' },
  { from: 470, to: 481, type: 'string' },
  { from: 999, to: 999, type: 'string' },
  { from: 1000, to: 1009, type: 'string' },
  { from: 1010, to: 1059, type: 'double' },
  { from: 1060, to: 1070, type: 'int16' },
  { from: 1071, to: 1071, type: 'int32' },
];

/**
 * 查询组码对应的值类型。
 * 未在规范区间内的扩展组码（如自定义 XDATA 之外的私有码）按字符串处理，
 * 保证写出时不因未知组码而报错。
 */
export const getGroupValueType = (code: number): GroupValueType => {
  for (const range of GROUP_CODE_RANGES) {
    if (code >= range.from && code <= range.to) return range.type;
  }
  return 'string';
};

/** 组码是否需要十进制小数位（写出时补 `.0`，避免聚合器把整数值当整数输出）。 */
export const isFloatingGroupCode = (code: number): boolean => getGroupValueType(code) === 'double';

/**
 * 浮点数文本化。
 *
 * 目标：不引入精度损失、不产生 DXF 解析器不兼容的科学计数法、整数值补 `.0`。
 * - 用 `String()` 得到最短往返表示（JS 数字的这一性质已是规范行为）；
 * - 若含指数（|v| < 1e-6 或 >= 1e21），退化为 `toFixed` 固定小数展开；
 * - 整数补 `.0`：部分读取器（含本项目的 parseInt/parseFloat 混合路径）依赖小数点判定浮点。
 */
export const formatDouble = (value: number): string => {
  if (!Number.isFinite(value)) return '0.0';

  // 极小值归零，避免输出 1e-17 这类噪声坐标。
  const normalized = Math.abs(value) < 1e-12 ? 0 : value;
  const raw = String(normalized);

  if (!raw.includes('e') && !raw.includes('E')) {
    return raw.includes('.') ? raw : `${raw}.0`;
  }

  // 指数形式：展开为定点小数（保留 12 位，足以覆盖 CAD 图纸精度）。
  const fixed = normalized.toFixed(12).replace(/0+$/, '');
  return fixed.endsWith('.') ? `${fixed}0` : fixed || '0.0';
};

/** 整数文本化：截断小数部分（DXF 的 int 组码不应出现小数点）。 */
export const formatInt = (value: number): string => {
  if (!Number.isFinite(value)) return '0';
  return String(Math.trunc(value));
};

/** 句柄文本化：DXF 句柄为大写十六进制字符串。 */
export const formatHandle = (value: number | string): string => {
  if (typeof value === 'string') return value.trim().toUpperCase();
  if (!Number.isFinite(value)) return '0';
  return Math.max(0, Math.trunc(value)).toString(16).toUpperCase();
};

/**
 * 按组码的值类型把 JS 值序列化为 DXF 文本行内容。
 * 布尔按 DXF 惯例输出 1 / 0。
 */
export const formatGroupValue = (code: number, value: string | number | boolean): string => {
  const type = getGroupValueType(code);

  switch (type) {
    case 'double':
      return formatDouble(typeof value === 'number' ? value : Number.parseFloat(String(value)));
    case 'int16':
    case 'int32':
    case 'int64':
      return formatInt(typeof value === 'number' ? value : Number.parseInt(String(value), 10));
    case 'bool':
      return value === true || value === 1 || value === '1' ? '1' : '0';
    case 'handle':
      return formatHandle(value as number | string);
    case 'string':
    case 'binary':
    default:
      return String(value);
  }
};

/** 组码行本身：DXF 组码为右对齐的三位数字（如 `  0`、` 10`、`210`）。 */
export const formatGroupCode = (code: number): string => String(code).padStart(3, ' ');
