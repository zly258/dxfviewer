/**
 * 最小 PDF 1.4 写出器（零依赖）。
 *
 * 能力范围：多页文档，每页嵌入一张 JPEG 图像（/DCTDecode），页面尺寸与放置
 * 矩形以 PostScript 点（1pt = 1/72 inch）为单位。
 *
 * 不支持：矢量路径、文字对象、透明通道（/SMask）—— 那些属于 M7 矢量后端。
 *
 * 之所以自己写：栅格出图只需要「一页一图」，用 pdf-lib 引入几百 KB 依赖不划算，
 * 而本项目对外卖点是零运行时依赖。PDF 的交叉引用表要求字节级偏移准确，
 * 所有长度都必须先算好再落盘。
 */

export interface PdfImagePlacement {
  /** JPEG 编码字节（必须是 JFIF/DCTDecode 可解码的数据） */
  jpeg: Uint8Array;
  /** 图像像素宽（写入 XObject 的 /Width） */
  widthPx: number;
  /** 图像像素高（写入 XObject 的 /Height） */
  heightPx: number;
  /** 页面宽（pt） */
  pageWidthPt: number;
  /** 页面高（pt） */
  pageHeightPt: number;
  /** 图像左下角 X（pt，PDF 坐标原点在左下） */
  xPt: number;
  /** 图像左下角 Y（pt） */
  yPt: number;
  /** 图像绘制宽（pt） */
  drawWidthPt: number;
  /** 图像绘制高（pt） */
  drawHeightPt: number;
}

export interface PdfBuildOptions {
  title?: string;
  producer?: string;
  creationDate?: Date;
}

const DEFAULT_PRODUCER = 'dxfviewer';
const COORDINATE_PRECISION = 4;

/** PDF 文本结构全部是 latin-1 字节；数值与关键字不会超过 0xFF。 */
const latin1Bytes = (text: string): Uint8Array => {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
};

const formatNumber = (value: number): string => {
  if (!Number.isFinite(value)) return '0';
  const factor = 10 ** COORDINATE_PRECISION;
  return String(Math.round(value * factor) / factor);
};

/** PDF 字符串字面量转义（ASCII 可见字符范围）。 */
const escapePdfString = (value: string): string =>
  value.replace(/([\\()])/g, '\\$1');

/** UTF-16BE + BOM 的十六进制串（PDF 非 ASCII 元数据的标准写法，中文标题必需）。 */
const encodeUtf16BeHex = (value: string): string => {
  const units: number[] = [];
  for (const character of Array.from(value)) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0xffff) {
      units.push(code);
    } else {
      const surrogate = code - 0x10000;
      units.push(0xd800 + (surrogate >> 10), 0xdc00 + (surrogate & 0x3ff));
    }
  }
  return `FEFF${units.map(unit => unit.toString(16).padStart(4, '0').toUpperCase()).join('')}`;
};

/**
 * 元数据字符串：纯 ASCII 用 `(...)`，含非 ASCII（如中文标题）用 `<FEFF...>`。
 * 直接对 CJK 走 latin-1 写出会得到乱码或被替换成 `?`。
 */
const pdfString = (value: string): string =>
  /^[\x20-\x7E]*$/.test(value)
    ? `(${escapePdfString(value)})`
    : `<${encodeUtf16BeHex(value)}>`;

const formatPdfDate = (date: Date): string => {
  const pad = (value: number, width = 2): string =>
    String(Math.max(0, Math.trunc(value))).padStart(width, '0');
  return `(D:${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`
    + `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z)`;
};

const assertPlacement = (placement: PdfImagePlacement, index: number): void => {
  if (placement.jpeg.length === 0) throw new Error(`第 ${index + 1} 页图像数据为空`);
  const numericFields: Array<[string, number]> = [
    ['widthPx', placement.widthPx],
    ['heightPx', placement.heightPx],
    ['pageWidthPt', placement.pageWidthPt],
    ['pageHeightPt', placement.pageHeightPt],
    ['drawWidthPt', placement.drawWidthPt],
    ['drawHeightPt', placement.drawHeightPt],
  ];
  for (const [name, value] of numericFields) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`第 ${index + 1} 页的 ${name} 无效：${value}`);
    }
  }
  if (!Number.isFinite(placement.xPt) || !Number.isFinite(placement.yPt)) {
    throw new Error(`第 ${index + 1} 页的放置坐标无效`);
  }
};

/**
 * 由 JPEG 页面列表构造 PDF 文档字节。
 *
 * 对象编号布局（固定，便于交叉引用表计算）：
 * 1=Catalog, 2=Pages, 3=Info, 第 i 页：page=4+3i、image=5+3i、content=6+3i。
 */
export const buildPdfFromJpegPages = (
  placements: PdfImagePlacement[],
  options: PdfBuildOptions = {},
): Uint8Array => {
  if (!Array.isArray(placements) || placements.length === 0) {
    throw new Error('PDF 至少需要一页');
  }
  placements.forEach(assertPlacement);

  const pageCount = placements.length;
  const objectCount = 3 + pageCount * 3;
  const chunks: Uint8Array[] = [];
  const offsets = new Uint32Array(objectCount + 1); // 1-based
  let cursor = 0;

  const writeBytes = (bytes: Uint8Array): void => {
    chunks.push(bytes);
    cursor += bytes.length;
  };
  const writeText = (text: string): void => writeBytes(latin1Bytes(text));
  const startObject = (objectNumber: number): void => {
    offsets[objectNumber] = cursor;
    writeText(`${objectNumber} 0 obj\n`);
  };

  // 文件头：版本 + 二进制标记注释（要求阅读器把后续按二进制处理）。
  writeText('%PDF-1.4\n');
  writeText('%\u00e2\u00e3\u00cf\u00d3\n');

  // 1 Catalog
  startObject(1);
  writeText(`<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);

  // 2 Pages
  const kids = placements
    .map((_, index) => `${4 + index * 3} 0 R`)
    .join(' ');
  startObject(2);
  writeText(`<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>\nendobj\n`);

  // 3 Info
  const title = options.title ? ` /Title ${pdfString(options.title)}` : '';
  const producer = ` /Producer ${pdfString(options.producer ?? DEFAULT_PRODUCER)}`;
  startObject(3);
  writeText(`<<${title}${producer} /CreationDate ${formatPdfDate(options.creationDate ?? new Date())} >>\nendobj\n`);

  // 每页：Page → Image XObject → Contents
  placements.forEach((placement, index) => {
    const pageNumber = 4 + index * 3;
    const imageNumber = pageNumber + 1;
    const contentNumber = pageNumber + 2;

    startObject(pageNumber);
    writeText(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${formatNumber(placement.pageWidthPt)} ${formatNumber(placement.pageHeightPt)}] `
      + `/Resources << /ProcSet [/PDF /ImageC] /XObject << /Im0 ${imageNumber} 0 R >> >> `
      + `/Contents ${contentNumber} 0 R >>\nendobj\n`,
    );

    startObject(imageNumber);
    writeText(
      `<< /Type /XObject /Subtype /Image /Width ${Math.trunc(placement.widthPx)} /Height ${Math.trunc(placement.heightPx)} `
      + `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${placement.jpeg.length} >>\nstream\n`,
    );
    writeBytes(placement.jpeg);
    writeText('\nendstream\nendobj\n');

    // 内容流：cm 的平移量按 PDF 左下原点计算。
    const content =
      `q\n${formatNumber(placement.drawWidthPt)} 0 0 ${formatNumber(placement.drawHeightPt)} `
      + `${formatNumber(placement.xPt)} ${formatNumber(placement.yPt)} cm\n/Im0 Do\nQ\n`;
    startObject(contentNumber);
    writeText(`<< /Length ${latin1Bytes(content).length} >>\nstream\n`);
    writeText(content);
    writeText('endstream\nendobj\n');
  });

  // 交叉引用表
  const xrefOffset = cursor;
  writeText(`xref\n0 ${objectCount + 1}\n`);
  writeText('0000000000 65535 f \n');
  for (let objectNumber = 1; objectNumber <= objectCount; objectNumber++) {
    writeText(`${String(offsets[objectNumber]).padStart(10, '0')} 00000 n \n`);
  }

  writeText(
    `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R /Info 3 0 R >>\n`
    + `startxref\n${xrefOffset}\n%%EOF\n`,
  );

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let position = 0;
  for (const chunk of chunks) {
    output.set(chunk, position);
    position += chunk.length;
  }
  return output;
};

/** Blob 兼容包装：把 PDF 字节包成 Blob（浏览器 / Node 18+ 均可用）。 */
export const pdfBytesToBlob = (bytes: Uint8Array): Blob =>
  new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });

// ---------------------------------------------------------------------------
// 矢量构建器（M7）：内容由内容流描述，文字为可选的 Flate 压缩图像（带 /SMask）。
// ---------------------------------------------------------------------------

export interface VectorTextImage {
  widthPx: number;
  heightPx: number;
  /** RGB（3 字节/像素，透明处置白） */
  rgb: Uint8Array;
  rgbCompressed: boolean;
  /** 灰度 alpha（1 字节/像素，作为 /SMask） */
  alpha: Uint8Array;
  alphaCompressed: boolean;
}

export interface VectorPdfPage {
  pageWidthPt: number;
  pageHeightPt: number;
  /** 页面内容流（已含坐标变换与绘制操作符，不含文字图像放置） */
  contentStream: string;
  /** 文字图层（整页一张，透明底，最后绘制） */
  textImage?: VectorTextImage;
}

const concatBytes = (parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let position = 0;
  for (const part of parts) {
    output.set(part, position);
    position += part.length;
  }
  return output;
};

const objectRawBytes = (objectNumber: number, content: string): Uint8Array =>
  latin1Bytes(`${objectNumber} 0 obj\n${content}endobj\n`);

const objectStreamBytes = (objectNumber: number, dict: string, payload: Uint8Array): Uint8Array =>
  concatBytes([
    latin1Bytes(`${objectNumber} 0 obj\n${dict}stream\n`),
    payload,
    latin1Bytes('\nendstream\nendobj\n'),
  ]);

/**
 * 通用装配：对象体（下标 = 对象号-1）+ xref + trailer。
 * /Root 与 /Info 由调用方指定（矢量布局的对象编号不再固定 1/2/3）。
 */
export const assemblePdfDocument = (
  bodies: Uint8Array[],
  meta: { rootNumber: number; infoNumber: number; creationDate?: Date },
): Uint8Array => {
  const objectCount = bodies.length;
  const chunks: Uint8Array[] = [];
  const offsets = new Uint32Array(objectCount + 1);
  let cursor = 0;

  const writeBytes = (bytes: Uint8Array): void => {
    chunks.push(bytes);
    cursor += bytes.length;
  };
  const writeText = (text: string): void => writeBytes(latin1Bytes(text));

  writeText('%PDF-1.4\n');
  writeText('%\u00e2\u00e3\u00cf\u00d3\n');

  for (let i = 0; i < objectCount; i++) {
    offsets[i + 1] = cursor;
    writeBytes(bodies[i]);
  }

  const xrefOffset = cursor;
  writeText(`xref\n0 ${objectCount + 1}\n`);
  writeText('0000000000 65535 f \n');
  for (let objectNumber = 1; objectNumber <= objectCount; objectNumber++) {
    writeText(`${String(offsets[objectNumber]).padStart(10, '0')} 00000 n \n`);
  }
  writeText(
    `trailer\n<< /Size ${objectCount + 1} /Root ${meta.rootNumber} 0 R /Info ${meta.infoNumber} 0 R >>\n`
    + `startxref\n${xrefOffset}\n%%EOF\n`,
  );

  return concatBytes(chunks);
};

/**
 * 由矢量页面构建 PDF。
 *
 * 对象编号动态分配（Catalog/Pages 不再固定为 1/2），交叉引用表按实际偏移生成。
 */
export const buildVectorPdf = (
  pages: VectorPdfPage[],
  options: PdfBuildOptions = {},
): Uint8Array => {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error('PDF 至少需要一页');
  }

  const bodies: Uint8Array[] = [];
  const pushObject = (build: (objectNumber: number) => Uint8Array): number => {
    const objectNumber = bodies.length + 1;
    bodies.push(build(objectNumber));
    return objectNumber;
  };

  const pageNumbers: number[] = [];

  for (const page of pages) {
    if (!Number.isFinite(page.pageWidthPt) || !Number.isFinite(page.pageHeightPt)
      || page.pageWidthPt <= 0 || page.pageHeightPt <= 0) {
      throw new Error(`页面尺寸无效：${page.pageWidthPt}×${page.pageHeightPt}`);
    }

    const contentPayload = latin1Bytes(page.contentStream);
    const contentNumber = pushObject(number =>
      objectStreamBytes(number, `<< /Length ${contentPayload.length} >>\n`, contentPayload));

    let imageResource = '';
    if (page.textImage) {
      const { widthPx, heightPx, rgb, alpha, rgbCompressed, alphaCompressed } = page.textImage;
      if (rgb.length === 0 || alpha.length === 0) {
        throw new Error('文字图像数据为空');
      }

      const smaskNumber = pushObject(number =>
        objectStreamBytes(
          number,
          `<< /Type /XObject /Subtype /Image /Width ${widthPx} /Height ${heightPx} `
          + `/ColorSpace /DeviceGray /BitsPerComponent 8${alphaCompressed ? ' /Filter /FlateDecode' : ''} `
          + `/Length ${alpha.length} >>\n`,
          alpha,
        ));

      const rgbNumber = pushObject(number =>
        objectStreamBytes(
          number,
          `<< /Type /XObject /Subtype /Image /Width ${widthPx} /Height ${heightPx} `
          + `/ColorSpace /DeviceRGB /BitsPerComponent 8${rgbCompressed ? ' /Filter /FlateDecode' : ''} `
          + `/SMask ${smaskNumber} 0 R /Length ${rgb.length} >>\n`,
          rgb,
        ));

      imageResource = ` /XObject << /Im0 ${rgbNumber} 0 R >>`;
    }

    const pageNumber = pushObject(number =>
      objectRawBytes(
        number,
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${formatNumber(page.pageWidthPt)} ${formatNumber(page.pageHeightPt)}] `
        + `/Resources << /ProcSet [/PDF /ImageC]${imageResource} >> `
        + `/Contents ${contentNumber} 0 R >>\n`,
      ));
    pageNumbers.push(pageNumber);
  }

  const kids = pageNumbers.map(number => `${number} 0 R`).join(' ');
  const pagesNumber = pushObject(number =>
    objectRawBytes(number, `<< /Type /Pages /Kids [${kids}] /Count ${pageNumbers.length} >>\n`));

  const catalogNumber = pushObject(number =>
    objectRawBytes(number, `<< /Type /Catalog /Pages ${pagesNumber} 0 R >>\n`));

  const infoNumber = pushObject(number => {
    const title = options.title ? ` /Title ${pdfString(options.title)}` : '';
    const producer = ` /Producer ${pdfString(options.producer ?? DEFAULT_PRODUCER)}`;
    return objectRawBytes(
      number,
      `<<${title}${producer} /CreationDate ${formatPdfDate(options.creationDate ?? new Date())} >>\n`,
    );
  });

  return assemblePdfDocument(bodies, {
    rootNumber: catalogNumber,
    infoNumber,
    creationDate: options.creationDate,
  });
};
