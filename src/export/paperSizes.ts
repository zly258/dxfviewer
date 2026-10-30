/**
 * 纸张规格与单位换算。
 *
 * CAD 出图以 mm 思考，PDF 以 PostScript 点（1/72 inch）表达页面尺寸，
 * 这里统一换算，避免各处手写 2.834645 魔数。
 */

export interface PaperSpec {
  /** 宽（mm，纵向未旋转前） */
  widthMm: number;
  /** 高（mm） */
  heightMm: number;
}

export type StandardPaperSize =
  | 'A5' | 'A4' | 'A3' | 'A2' | 'A1' | 'A0'
  | 'Letter' | 'Legal' | 'Tabloid';

/** ISO 216 A 系列 + 常用美式纸张（mm）。 */
export const PAPER_SIZES: Record<StandardPaperSize, PaperSpec> = {
  A5: { widthMm: 148, heightMm: 210 },
  A4: { widthMm: 210, heightMm: 297 },
  A3: { widthMm: 297, heightMm: 420 },
  A2: { widthMm: 420, heightMm: 594 },
  A1: { widthMm: 594, heightMm: 841 },
  A0: { widthMm: 841, heightMm: 1189 },
  Letter: { widthMm: 215.9, heightMm: 279.4 },
  Legal: { widthMm: 215.9, heightMm: 355.6 },
  Tabloid: { widthMm: 279.4, heightMm: 431.8 },
};

export const MM_PER_INCH = 25.4;
/** 1 mm = 72/25.4 pt。 */
export const MM_TO_PT = 72 / MM_PER_INCH;

export const mmToPt = (mm: number): number => mm * MM_TO_PT;
export const ptToMm = (pt: number): number => pt / MM_TO_PT;
/** 在指定 DPI 下，mm 对应的像素数。 */
export const mmToPixels = (mm: number, dpi: number): number => Math.round(mm / MM_PER_INCH * dpi);

export type PaperSizeInput = StandardPaperSize | readonly [number, number] | [number, number];
export type PaperOrientation = 'portrait' | 'landscape';

export interface ResolvedPage {
  widthMm: number;
  heightMm: number;
  widthPt: number;
  heightPt: number;
}

/**
 * 解析纸张：标准名或自定义 [宽, 高]（mm），并按方向调整。
 * 自定义尺寸始终以给定宽高为准；标准名在 landscape 下交换宽高。
 */
export const resolvePage = (
  paperSize: PaperSizeInput = 'A4',
  orientation: PaperOrientation = 'portrait',
): ResolvedPage => {
  let spec: PaperSpec;
  const custom = typeof paperSize !== 'string';
  if (custom) {
    const [widthMm, heightMm] = paperSize as readonly [number, number];
    if (!Number.isFinite(widthMm) || !Number.isFinite(heightMm) || widthMm <= 0 || heightMm <= 0) {
      throw new Error(`无效的自定义纸张尺寸：[${widthMm}, ${heightMm}]（mm）`);
    }
    spec = { widthMm, heightMm };
  } else {
    const named = PAPER_SIZES[paperSize as StandardPaperSize];
    if (!named) throw new Error(`未知的纸张规格：${String(paperSize)}`);
    spec = named;
  }

  const landscape = orientation === 'landscape';
  const widthMm = custom ? spec.widthMm : (landscape ? spec.heightMm : spec.widthMm);
  const heightMm = custom ? spec.heightMm : (landscape ? spec.widthMm : spec.heightMm);

  return {
    widthMm,
    heightMm,
    widthPt: mmToPt(widthMm),
    heightPt: mmToPt(heightMm),
  };
};
