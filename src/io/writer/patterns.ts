/**
 * HATCH 内置图案定义库（acad.pat 常用子集）。
 *
 * 背景：解析器不保留源文件的图案定义线（HATCH 组码 78/53/49），
 * 写出非实心填充时若 78=0，CAD 只能按「预定义图案名」自行解析——
 * 对 ANSI 系列等标准名可行，对自定义图案名会得到空填充。
 * 这里内置常用图案的基定义，写出时按名称匹配输出 78 条定义线。
 *
 * 定义格式（acad.pat 语义）：
 *   角度, 基点X, 基点Y, 位移X, 位移Y[, 虚线长...]
 * 视觉为近似值（未逐条比对 AutoCAD 原库）；结构合法、可被 CAD 正常解析。
 */

export interface HatchPatternLine {
  /** 53：图案线角度（度） */
  angleDeg: number;
  /** 43：图案线基点 X */
  baseX: number;
  /** 44：图案线基点 Y */
  baseY: number;
  /** 45：相邻线位移 X */
  offsetX: number;
  /** 46：相邻线位移 Y */
  offsetY: number;
  /** 49：虚线段长（正=画线，负=空隙，0=点） */
  dashes: number[];
}

type PatternLineSpec = [number, number, number, number, number, number[]?];

const define = (specs: PatternLineSpec[]): HatchPatternLine[] =>
  specs.map(([angleDeg, baseX, baseY, offsetX, offsetY, dashes]) => ({
    angleDeg,
    baseX,
    baseY,
    offsetX,
    offsetY,
    dashes: dashes ?? [],
  }));

const PATTERNS: Record<string, HatchPatternLine[]> = {
  ANSI31: define([[45, 0, 0, 0, 3.175]]),
  ANSI32: define([
    [45, 0, 0, 0, 3.175],
    [45, 2.2455, 0, 0, 3.175],
  ]),
  ANSI33: define([
    [45, 0, 0, 0, 6.35],
    [45, 4.4901, 0, 0, 6.35, [6.35, -6.35]],
  ]),
  ANSI34: define([
    [45, 0, 0, 0, 6.35],
    [45, 2.2455, 0, 0, 6.35],
    [45, 4.4901, 0, 0, 6.35, [6.35, -6.35]],
  ]),
  ANSI35: define([
    [45, 0, 0, 0, 6.35, [6.35, -6.35]],
    [45, 2.2455, 0, 0, 6.35, [6.35, -6.35]],
  ]),
  ANSI36: define([
    [45, 0, 0, 0, 6.35, [6.35, -6.35]],
    [135, 0, 0, 0, 6.35, [6.35, -6.35]],
  ]),
  ANSI37: define([
    [45, 0, 0, 0, 3.175, [3.175, -3.175]],
    [135, 0, 0, 0, 3.175, [3.175, -3.175]],
  ]),
  ANSI38: define([
    [45, 0, 0, 0, 3.175, [3.175, -3.175]],
    [135, 0, 0, 0, 3.175, [3.175, -3.175]],
    [0, 0, 0, 3.175, 0, [0, -3.175]],
  ]),
  LINE: define([[45, 0, 0, 0, 9.525]]),
  DASHED: define([[45, 0, 0, 0, 9.525, [6.35, -3.175]]]),
  DOTTED: define([[45, 0, 0, 0, 9.525, [0, -9.525]]]),
  DOT: define([[0, 0, 0, 3.175, 0, [-3.175]]]),
  CROSS: define([
    [0, 0, 0, 0, 3.175],
    [90, 0, 0, 0, 3.175],
  ]),
  NET: define([
    [0, 0, 0, 0, 6.35, [6.35, -6.35]],
    [90, 0, 0, 0, 6.35, [6.35, -6.35]],
  ]),
};

/** 按名称查图案定义（大小写不敏感）；SOLID 走实心路径，不在库中。 */
export const getHatchPattern = (name: string): HatchPatternLine[] | undefined => {
  const key = (name || '').trim().toUpperCase();
  return PATTERNS[key];
};

/** 当前内置的图案名列表（诊断/文档用）。 */
export const listHatchPatternNames = (): string[] => Object.keys(PATTERNS);
