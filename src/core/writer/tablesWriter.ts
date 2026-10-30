/**
 * TABLES 段写出器。
 *
 * AC1015 顺序：VPORT / LTYPE / LAYER / STYLE / DIMSTYLE / APPID / BLOCK_RECORD。
 * AC1009 (R12)：仅 LTYPE / LAYER / STYLE（无句柄体系、无 BLOCK_RECORD）。
 *
 * 所有表记录句柄在 dxfWriter 的第一遍分配中预先登记到 WriterContext，
 * 因为 BLOCK_RECORD 需要引用 LAYOUT 对象句柄、实体需要引用 BLOCK_RECORD 句柄。
 */
import { DxfData } from '@/types';
import { WriterState } from './writerState';
import type { WriterContext } from './dxfWriter';

const writeTableStart = (state: WriterState, name: string, count: number, handle: string): void => {
  state.writeGroup(0, 'TABLE');
  // 组码 2（表名）紧跟 TABLE：R12 与 R2000 都是这个顺序，
  // 且万能解析器（含本项目 parser）都按「0 TABLE → 2 <表名>」识别表。
  state.writeGroup(2, name);
  state.writeHandle(handle);
  state.writeSubclass('AcDbSymbolTable');
  state.writeGroup(70, count);
};

/**
 * VPORT 表（仅 *Active 一条，取默认值即可）。
 */
const writeVportTable = (state: WriterState, tableHandle: string, recordHandle: string): void => {
  writeTableStart(state, 'VPORT', 1, tableHandle);
  state.writeGroup(0, 'VPORT');
  state.writeHandle(recordHandle);
  state.writeOwner(tableHandle);
  state.writeSubclass('AcDbSymbolTableRecord');
  state.writeSubclass('AcDbViewportTableRecord');
  state.writeGroup(2, '*Active');
  state.writeGroup(70, 0);
  state.writeGroup(10, 0);
  state.writeGroup(20, 0);
  state.writeGroup(11, 1);
  state.writeGroup(21, 1);
  state.writeGroup(12, 0);
  state.writeGroup(22, 0);
  state.writeGroup(13, 0);
  state.writeGroup(23, 0);
  state.writeGroup(14, 10);
  state.writeGroup(24, 10);
  state.writeGroup(15, -10);
  state.writeGroup(25, -10);
  state.writeGroup(16, 0);
  state.writeGroup(26, 0);
  state.writeGroup(36, 1);
  state.writeGroup(17, 0);
  state.writeGroup(27, 0);
  state.writeGroup(37, 0);
  state.writeGroup(40, 0);
  state.writeGroup(41, 1);
  state.writeGroup(42, 50);
  state.writeGroup(43, 0);
  state.writeGroup(44, 0);
  state.writeGroup(45, 0);
  state.writeGroup(46, 0);
  state.writeGroup(47, 0);
  state.writeGroup(48, 0);
  state.writeGroup(49, 0);
  state.writeGroup(50, 0);
  state.writeGroup(51, 0);
  state.writeGroup(71, 0);
  state.writeGroup(72, 1000);
  state.writeGroup(73, 0);
  state.writeGroup(74, 0);
  state.writeGroup(75, 0);
  state.writeGroup(76, 0);
  state.writeGroup(77, 0);
  state.writeGroup(78, 0);
  state.writeGroup(79, 0);
  state.writeGroup(146, 0);
  state.writeGroup(0, 'ENDTAB');
};

const writeLtypeTable = (state: WriterState, data: DxfData, ctx: WriterContext): void => {
  // AutoCAD 要求 ByBlock / ByLayer / CONTINUOUS 三个内建线型必须存在。
  const userNames = Object.keys(data.lineTypes || {}).filter(n => n !== 'CONTINUOUS' && n !== 'ByLayer' && n !== 'ByBlock');
  const names = ['ByBlock', 'ByLayer', 'CONTINUOUS', ...userNames];
  writeTableStart(state, 'LTYPE', names.length, ctx.tableHandles.ltype);

  for (const name of names) {
    const lineType = data.lineTypes?.[name];
    state.writeGroup(0, 'LTYPE');
    state.writeHandle(ctx.ltypeHandles.get(name));
    state.writeOwner(ctx.tableHandles.ltype);
    state.writeSubclass('AcDbSymbolTableRecord');
    state.writeSubclass('AcDbLinetypeTableRecord');
    state.writeGroup(2, name);
    state.writeGroup(70, 0);
    state.writeGroup(3, lineType?.description || (name === 'CONTINUOUS' ? 'Solid line' : ''));
    state.writeGroup(72, 65); // 对齐方式：始终居中于文字
    const pattern = lineType?.pattern || [];
    state.writeGroup(73, pattern.length);
    state.writeGroup(40, lineType?.totalLength || 0);
    for (const dash of pattern) {
      state.writeGroup(49, dash);
      state.writeGroup(45, 0); // 元素旋转角
    }
  }
  state.writeGroup(0, 'ENDTAB');
};

const writeLayerTable = (state: WriterState, data: DxfData, ctx: WriterContext): void => {
  const names = Object.keys(data.layers || {});
  if (!names.includes('0')) names.unshift('0');
  writeTableStart(state, 'LAYER', names.length, ctx.tableHandles.layer);

  for (const name of names) {
    const layer = data.layers?.[name] || { name, color: 7 };
    const visible = layer.isVisible !== false;
    state.writeGroup(0, 'LAYER');
    state.writeHandle(ctx.layerHandles.get(name));
    state.writeOwner(ctx.tableHandles.layer);
    state.writeSubclass('AcDbSymbolTableRecord');
    state.writeSubclass('AcDbLayerTableRecord');
    state.writeGroup(2, name);
    // 本项目解析器约定：70 bit0 = 1 表示不可见（冻结/关闭）。
    state.writeGroup(70, visible ? 0 : 1);
    state.writeGroup(62, visible ? (layer.color ?? 7) : -Math.abs(layer.color ?? 7));
    if (layer.trueColor !== undefined && !state.isR12()) {
      state.writeGroup(420, layer.trueColor);
    }
    state.writeGroup(6, layer.lineType || 'CONTINUOUS');
    if (layer.lineweight !== undefined) {
      state.writeGroup(370, layer.lineweight);
    }
    if (!state.isR12()) {
      if (layer.transparency !== undefined) {
        state.writeGroup(440, layer.transparency);
      }
      state.writeGroup(290, visible ? 1 : 0); // 是否打印
    }
  }
  state.writeGroup(0, 'ENDTAB');
};

const writeStyleTable = (state: WriterState, data: DxfData, ctx: WriterContext): void => {
  const names = Object.keys(data.styles || {});
  if (!data.styles?.STANDARD && !data.styles?.Standard) names.unshift('STANDARD');
  writeTableStart(state, 'STYLE', names.length, ctx.tableHandles.style);

  for (const name of names) {
    const style = data.styles?.[name] || { name, fontFileName: 'txt', height: 0, widthFactor: 1 };
    state.writeGroup(0, 'STYLE');
    state.writeHandle(ctx.styleHandles.get(name));
    state.writeOwner(ctx.tableHandles.style);
    state.writeSubclass('AcDbSymbolTableRecord');
    state.writeSubclass('AcDbTextStyleTableRecord');
    state.writeGroup(2, name);
    state.writeGroup(70, 0);
    state.writeGroup(40, style.height ?? 0);
    state.writeGroup(41, style.widthFactor ?? 1);
    state.writeGroup(50, 0);
    state.writeGroup(71, 0);
    state.writeGroup(42, 2.5);
    state.writeGroup(3, style.fontFileName || 'txt');
    if (style.bigFontFileName) {
      state.writeGroup(4, style.bigFontFileName);
    }
  }
  state.writeGroup(0, 'ENDTAB');
};

/**
 * DIMSTYLE 表：仅写 STANDARD（本项目不建模标注样式变量）。
 */
const writeDimStyleTable = (state: WriterState, ctx: WriterContext): void => {
  writeTableStart(state, 'DIMSTYLE', 1, ctx.tableHandles.dimstyle);
  state.writeGroup(0, 'DIMSTYLE');
  state.writeHandle(ctx.dimStyleStandardHandle);
  state.writeOwner(ctx.tableHandles.dimstyle);
  state.writeSubclass('AcDbSymbolTableRecord');
  state.writeSubclass('AcDbDimStyleTableRecord');
  state.writeGroup(2, 'Standard');
  state.writeGroup(70, 0);
  // 常用默认值，保证 CAD 打开后标注可渲染
  state.writeGroup(40, 1); // 全局比例
  state.writeGroup(41, 2.5); // 箭头大小
  state.writeGroup(42, 0.625); // 尺寸线偏移
  state.writeGroup(44, 1.25); // 超出标记
  state.writeGroup(140, 2.5); // 文字高度
  state.writeGroup(141, 2.5); // 圆柱半径
  state.writeGroup(142, 0); // 尺寸线长度
  state.writeGroup(143, 25.4); // 四舍五入
  state.writeGroup(144, 1); // 测量比例
  state.writeGroup(147, 0.625); // 箭头间距
  state.writeGroup(174, 0);
  state.writeGroup(175, 0);
  state.writeGroup(176, 0);
  state.writeGroup(177, 8);
  state.writeGroup(178, 6);
  state.writeGroup(271, 2); // 小数精度
  state.writeGroup(272, 0);
  state.writeGroup(273, 2);
  state.writeGroup(274, 0);
  state.writeGroup(281, 0);
  state.writeGroup(282, 0);
  state.writeGroup(283, 0);
  state.writeGroup(284, 0);
  state.writeGroup(285, 0);
  state.writeGroup(286, 0);
  state.writeGroup(289, 3);
  state.writeGroup(371, -2);
  state.writeGroup(372, -2);
  state.writeGroup(0, 'ENDTAB');
};

const writeAppIdTable = (state: WriterState, ctx: WriterContext): void => {
  writeTableStart(state, 'APPID', 1, ctx.tableHandles.appid);
  state.writeGroup(0, 'APPID');
  state.writeHandle(ctx.appIdAcadHandle);
  state.writeOwner(ctx.tableHandles.appid);
  state.writeSubclass('AcDbSymbolTableRecord');
  state.writeSubclass('AcDbRegAppTableRecord');
  state.writeGroup(2, 'ACAD');
  state.writeGroup(70, 0);
  state.writeGroup(0, 'ENDTAB');
};

/**
 * BLOCK_RECORD 表（AC1015+）：每个块一条，模型/图纸空间记录需回填 LAYOUT 句柄。
 */
const writeBlockRecordTable = (
  state: WriterState,
  ctx: WriterContext,
): void => {
  const records = [...ctx.blockRecordHandles.entries()];
  writeTableStart(state, 'BLOCK_RECORD', records.length, ctx.tableHandles.blockRecord);

  for (const [name, handle] of records) {
    state.writeGroup(0, 'BLOCK_RECORD');
    state.writeHandle(handle);
    state.writeOwner(ctx.tableHandles.blockRecord);
    state.writeSubclass('AcDbSymbolTableRecord');
    state.writeSubclass('AcDbBlockTableRecord');
    state.writeGroup(2, name);
    const layoutHandle = ctx.blockLayoutHandles.get(name);
    if (layoutHandle) {
      state.writeGroup(340, layoutHandle);
    }
    state.writeGroup(70, isAnonymousBlock(name) ? 1 : 0);
    state.writeGroup(280, 0); // 保留（R14 布局类型）
    state.writeGroup(281, 1); // 块探索率
  }
  state.writeGroup(0, 'ENDTAB');
};

export const isAnonymousBlock = (name: string): boolean => name.startsWith('*');

/**
 * 写出 TABLES 段。
 */
export const writeTablesSection = (
  state: WriterState,
  data: DxfData,
  ctx: WriterContext,
): void => {
  state.writeGroup(0, 'SECTION');
  state.writeGroup(2, 'TABLES');

  if (!state.isR12()) {
    writeVportTable(state, ctx.tableHandles.vport, ctx.vportActiveHandle);
  }
  writeLtypeTable(state, data, ctx);
  writeLayerTable(state, data, ctx);
  writeStyleTable(state, data, ctx);
  if (!state.isR12()) {
    writeDimStyleTable(state, ctx);
    writeAppIdTable(state, ctx);
    writeBlockRecordTable(state, ctx);
  }

  state.writeGroup(0, 'ENDSEC');
};
