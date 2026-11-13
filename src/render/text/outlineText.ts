/**
 * 字体轮廓三角化模块（opentype.js + earcut）。
 *
 * 将 TrueType / OpenType 字形贝塞尔轮廓提取为封闭路径，
 * 处理内外孔（Outer / Hole），使用 earcut 三角化生成纯几何多边形顶点网格。
 *
 * 核心特性：
 * - 纯几何多边形管线：任意放大倍数无任何位图像素/模糊/插值失真，数学精确；
 * - 完美融合到 WebGL 现有的实心填充 (fill) 缓冲区；
 * - 全字符缓存机制（只对每个字形三角化一次）；
 * - 正确识别嵌套空洞（如“回”、“日”）。
 */

import * as opentype from 'opentype.js';
import earcut from 'earcut';
import { DxfText, DxfStyle, EntityType, Point2D } from '@/types';
import { cleanMText, cleanCadText, getEffectiveTextHeight, getStyleForText } from '@/utils/textUtils';
import { wrapTextByMeasuredWidth } from '@/core/text/textLayoutEngine';
import { setFontMetrics, OUTLINE_FONT_FAMILY } from './fontMetrics';

export interface GlyphMesh {
  /** 三角形顶点数组 [x0, y0, x1, y1, ...]，以 em 尺寸为基准，原点在字符基线(0, 0) */
  vertices: Float32Array;
  /** 字符步进宽度（em 单位） */
  advance: number;
}

let activeFont: opentype.Font | null = null;
let fallbackFont: opentype.Font | null = null;
let fontUnitsPerEm = 1000;
let fontCapHeight = 700;
let fontCjkHeight = 880;
/** 当前主字体是否收录中文（宿主的"轮廓字体"可能只是西文字体）。 */
let fontHasCjkGlyphs = false;

/** 字形三角化几何缓存：key = char */
const glyphCache = new Map<string, GlyphMesh>();

function signedArea(pts: Array<{ x: number; y: number }>): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    s += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return s / 2;
}

function ensureCCW(pts: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  if (signedArea(pts) < 0) return [...pts].reverse();
  return pts;
}

function ensureCW(pts: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  if (signedArea(pts) > 0) return [...pts].reverse();
  return pts;
}

function pointInPoly(pt: { x: number; y: number }, poly: Array<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
      (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function glyphToContours(glyph: opentype.Glyph, unitsPerEm: number): Array<Array<{ x: number; y: number }>> {
  const path = glyph.getPath(0, 0, unitsPerEm);
  const contours: Array<Array<{ x: number; y: number }>> = [];
  let currentContour: Array<{ x: number; y: number }> = [];
  let currX = 0, currY = 0;

  for (const cmd of path.commands) {
    switch (cmd.type) {
      case 'M':
        if (currentContour.length > 2) contours.push(currentContour);
        currentContour = [{ x: cmd.x, y: -cmd.y }];
        currX = cmd.x; currY = -cmd.y;
        break;
      case 'L':
        currentContour.push({ x: cmd.x, y: -cmd.y });
        currX = cmd.x; currY = -cmd.y;
        break;
      case 'Q': {
        const x1 = cmd.x1, y1 = -cmd.y1;
        const x = cmd.x, y = -cmd.y;
        const steps = 4;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const inv = 1 - t;
          const qx = inv * inv * currX + 2 * inv * t * x1 + t * t * x;
          const qy = inv * inv * currY + 2 * inv * t * y1 + t * t * y;
          currentContour.push({ x: qx, y: qy });
        }
        currX = x; currY = y;
        break;
      }
      case 'C': {
        const x1 = cmd.x1, y1 = -cmd.y1;
        const x2 = cmd.x2, y2 = -cmd.y2;
        const x = cmd.x, y = -cmd.y;
        const steps = 6;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const inv = 1 - t;
          const cx = inv * inv * inv * currX + 3 * inv * inv * t * x1 + 3 * inv * t * t * x2 + t * t * t * x;
          const cy = inv * inv * inv * currY + 3 * inv * inv * t * y1 + 3 * inv * t * t * y2 + t * t * t * y;
          currentContour.push({ x: cx, y: cy });
        }
        currX = x; currY = y;
        break;
      }
      case 'Z':
        if (currentContour.length > 0) {
          const first = currentContour[0];
          const last = currentContour[currentContour.length - 1];
          if (Math.abs(first.x - last.x) < 1e-4 && Math.abs(first.y - last.y) < 1e-4) {
            currentContour.pop();
          }
        }
        if (currentContour.length > 2) contours.push(currentContour);
        currentContour = [];
        break;
    }
  }
  if (currentContour.length > 2) contours.push(currentContour);
  return contours;
}

function triangulateGlyph(glyph: opentype.Glyph, unitsPerEm: number): Float32Array {
  const contours = glyphToContours(glyph, unitsPerEm);
  if (!contours.length) return new Float32Array(0);

  const rings = contours.map((c, id) => ({
    id,
    pts: c,
    absArea: Math.abs(signedArea(c)),
  })).sort((a, b) => b.absArea - a.absArea);

  const tree = rings.map(r => ({ ...r, parent: -1, depth: 0, children: [] as number[] }));
  for (let i = 0; i < rings.length; i++) {
    for (let j = i - 1; j >= 0; j--) {
      const pt = rings[i].pts[0];
      if (pointInPoly(pt, rings[j].pts)) {
        tree[i].parent = j;
        tree[i].depth = tree[j].depth + 1;
        tree[j].children.push(i);
        break;
      }
    }
  }

  const allTriangles: number[] = [];
  for (let i = 0; i < tree.length; i++) {
    if (tree[i].depth % 2 === 0) {
      const outerRing = ensureCCW(tree[i].pts);
      const holeIndices: number[] = [];
      const flat: number[] = [];
      for (const p of outerRing) flat.push(p.x, p.y);
      for (const chIdx of tree[i].children) {
        if (tree[chIdx].depth === tree[i].depth + 1) {
          holeIndices.push(flat.length / 2);
          const holeRing = ensureCW(tree[chIdx].pts);
          for (const hp of holeRing) flat.push(hp.x, hp.y);
        }
      }
      const indices = earcut(flat, holeIndices, 2);
      for (const idx of indices) {
        allTriangles.push(flat[idx * 2], flat[idx * 2 + 1]);
      }
    }
  }
  return new Float32Array(allTriangles);
}

/** 注册/设置轮廓字体（传入 ArrayBuffer 或已解析的 Font） */
export function setOutlineFont(fontData: ArrayBuffer | opentype.Font): void {
  if (fontData instanceof opentype.Font) {
    activeFont = fontData;
  } else {
    activeFont = opentype.parse(fontData);
  }
  glyphCache.clear();
  fontUnitsPerEm = activeFont.unitsPerEm || 1000;

  const capG = activeFont.charToGlyph('H');
  const capBox = capG.getBoundingBox();
  fontCapHeight = (capBox.y2 - capBox.y1) > 0 ? (capBox.y2 - capBox.y1) : Math.round(fontUnitsPerEm * 0.72);

  const cjkG = activeFont.charToGlyph('国');
  const cjkBox = cjkG.getBoundingBox();
  // 缺字时 opentype.js 返回 .notdef（空/方框字形）：据此判断主字体能否画中文。
  fontHasCjkGlyphs = (cjkBox.y2 - cjkBox.y1) > 0 && (cjkBox.x2 - cjkBox.x1) > 0;
  fontCjkHeight = fontHasCjkGlyphs ? (cjkBox.y2 - cjkBox.y1) : Math.round(fontUnitsPerEm * 0.88);

  // 把真实度量同步给共享模块：Canvas 引擎据此换算 font-size，
  // 从而与 WebGL 轮廓排版得到**完全相同**的字高/字宽/基线。
  setFontMetrics({
    capHeightRatio: fontCapHeight / fontUnitsPerEm,
    cjkHeightRatio: fontCjkHeight / fontUnitsPerEm,
    fromOutlineFont: true,
  });
}

/** 注册后备字体（用于当主字体缺少特殊符号例如 Ø, ², ³, ₐ 等时自动回落） */
export function setFallbackOutlineFont(fontData: ArrayBuffer | opentype.Font): void {
  if (fontData instanceof opentype.Font) {
    fallbackFont = fontData;
  } else {
    fallbackFont = opentype.parse(fontData);
  }
  glyphCache.clear();
}

/**
 * 把轮廓字体注册到浏览器，使 Canvas 引擎能用**同一个字体文件**渲染。
 *
 * 这是双引擎「大小/宽度/高度/对齐对不上」的根因修复：
 * - WebGL 用 opentype.js 解析轮廓 → 精确字形与真实度量；
 * - Canvas 此前用**系统字体**（FangSong/Arial…）+ 固定 em 系数换算。
 *   两者字形来源不同，同一字高下字高差 7%、字宽/基线也不同。
 *
 * 注册后 Canvas 直接用同一份字体文件，度量完全一致。
 */
async function registerOutlineFontFace(buffer: ArrayBuffer): Promise<boolean> {
  if (typeof document === 'undefined' || typeof FontFace === 'undefined' || !document.fonts) return false;
  try {
    // 用 ArrayBuffer 构造 FontFace（避免二次网络请求，且与 opentype 解析的是同一份字节）。
    const face = new FontFace(OUTLINE_FONT_FAMILY, buffer);
    await face.load();
    document.fonts.add(face);
    return true;
  } catch {
    return false;
  }
}

/** 异步通过 URL 加载字体 */
export async function loadOutlineFont(url: string, isFallback = false): Promise<boolean> {
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const buf = await res.arrayBuffer();
    if (isFallback) {
      setFallbackOutlineFont(buf);
    } else {
      setOutlineFont(buf);
      // 注册到浏览器：Canvas 引擎随后用同一字体渲染，两引擎完全一致。
      await registerOutlineFontFace(buf);
    }
    return true;
  } catch {
    return false;
  }
}

/** 是否已有可用的轮廓字体 */
export function hasOutlineFont(): boolean {
  return activeFont !== null;
}

/**
 * 当前轮廓字体能否承担中文图纸的文字渲染。
 *
 * 宿主的"轮廓字体"可能只是西文字体（如只放 arial.ttf，或者字体 URL 指错文件）：
 * 中文会走"合成字形"兜底，笔画断裂、句号变空心圆、字号也不一致。
 * 这种情形下应改用 Canvas 2D 文字层（浏览器原生文本引擎），而不是硬用 GPU。
 */
export function hasOutlineFontCjkCoverage(): boolean {
  return activeFont !== null && fontHasCjkGlyphs;
}

// ─────────────────────────────────────────────────────────────────────────────
// 合成字形：主/后备字体都缺字时，用已有字形拼装，避免显示 .notdef 方框
// ─────────────────────────────────────────────────────────────────────────────

const SUB_SCRIPT_BASE: Record<string, string> = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
  '₊': '+', '₋': '-', '₌': '=', '₍': '(', '₎': ')',
  'ₐ': 'a', 'ₑ': 'e', 'ₕ': 'h', 'ᵢ': 'i', 'ⱼ': 'j', 'ₖ': 'k', 'ₗ': 'l', 'ₘ': 'm', 'ₙ': 'n',
  'ₒ': 'o', 'ₚ': 'p', 'ᵣ': 'r', 'ₛ': 's', 'ₜ': 't', 'ᵤ': 'u', 'ᵥ': 'v', 'ₓ': 'x',
};
const SUPER_SCRIPT_BASE: Record<string, string> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
  '⁺': '+', '⁻': '-', '⁼': '=', '⁽': '(', '⁾': ')', 'ⁿ': 'n', 'ⁱ': 'i',
};
/** 字形无法直接显示时的等价字符（直径符号等）。 */
const CHAR_ALIASES: Record<string, string> = { '\u2300': '\u00D8', '\u2205': '\u00D8' };

/** 带圈数字的数字内容：⓪=0，⑪~⑳=11~20，⓿ 等不处理。 */
const circledNumberText = (ch: string): string | null => {
  const code = ch.codePointAt(0) ?? 0;
  if (code === 0x24EA) return '0';
  if (code >= 0x2460 && code <= 0x2473) return String(code - 0x2460 + 1);
  return null;
};

/** 把已有网格按比例缩放并平移后追加到输出。 */
const appendScaled = (out: number[], mesh: GlyphMesh, scale: number, dx: number, dy: number): void => {
  const v = mesh.vertices;
  for (let i = 0; i < v.length; i += 2) out.push(v[i] * scale + dx, v[i + 1] * scale + dy);
};

/** 圆环三角网格（半径、线宽均为字体单位）。 */
const appendRing = (out: number[], cx: number, cy: number, rOuter: number, rInner: number): void => {
  const n = 40;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    const ox0 = cx + c0 * rOuter, oy0 = cy + s0 * rOuter, ox1 = cx + c1 * rOuter, oy1 = cy + s1 * rOuter;
    const ix0 = cx + c0 * rInner, iy0 = cy + s0 * rInner, ix1 = cx + c1 * rInner, iy1 = cy + s1 * rInner;
    out.push(ox0, oy0, ox1, oy1, ix1, iy1, ox0, oy0, ix1, iy1, ix0, iy0);
  }
};

const hasRealGlyph = (ch: string): boolean =>
  !!activeFont && (activeFont.charToGlyph(ch).index !== 0 || (!!fallbackFont && fallbackFont.charToGlyph(ch).index !== 0));

const synthesizeGlyph = (char: string): GlyphMesh | null => {
  const alias = CHAR_ALIASES[char];
  if (alias && alias !== char && hasRealGlyph(alias)) return getGlyphMesh(alias);

  const sub = SUB_SCRIPT_BASE[char];
  const sup = SUPER_SCRIPT_BASE[char];
  const base = sub ?? sup;
  if (base && hasRealGlyph(base)) {
    const mesh = getGlyphMesh(base);
    if (!mesh) return null;
    const scale = 0.62;
    const out: number[] = [];
    // 上标：基线抬到约 0.45 倍大写字高；下标：基线下沉约 0.2 倍字高。
    appendScaled(out, mesh, scale, 0, sup ? fontCapHeight * 0.45 : -fontUnitsPerEm * 0.2);
    return { vertices: new Float32Array(out), advance: mesh.advance * scale };
  }

  const digits = circledNumberText(char);
  if (digits !== null) {
    const out: number[] = [];
    const advance = fontUnitsPerEm * 0.95;
    const cx = advance / 2;
    const cy = fontCapHeight / 2;
    const rOuter = Math.max(fontCapHeight * 0.58, fontUnitsPerEm * 0.4);
    appendRing(out, cx, cy, rOuter, rOuter - fontUnitsPerEm * 0.045);
    const scale = digits.length > 1 ? 0.42 : 0.55;
    const metas = Array.from(digits).map(d => getGlyphMesh(d)).filter((m): m is GlyphMesh => !!m);
    const total = metas.reduce((s, m) => s + m.advance * scale, 0);
    let x = cx - total / 2;
    for (const m of metas) {
      appendScaled(out, m, scale, x, cy - fontCapHeight * scale / 2);
      x += m.advance * scale;
    }
    return { vertices: new Float32Array(out), advance };
  }
  return null;
};

/** 获取字形网格（带缓存，支持后备字体自动回退 + 缺字合成） */
export function getGlyphMesh(char: string): GlyphMesh | null {
  if (!activeFont) return null;
  const cached = glyphCache.get(char);
  if (cached) return cached;

  let glyph = activeFont.charToGlyph(char);
  let font = activeFont;
  let upem = fontUnitsPerEm;

  // 若主字体中无该字符字形（index === 0 表示 .notdef），且配置了后备字体，尝试回退
  if ((!glyph || glyph.index === 0) && fallbackFont) {
    const fbGlyph = fallbackFont.charToGlyph(char);
    if (fbGlyph && fbGlyph.index !== 0) {
      glyph = fbGlyph;
      font = fallbackFont;
      upem = fallbackFont.unitsPerEm || 1000;
    }
  }

  // 两个字体都没有：合成（上下标/带圈数字/直径符号），仍不行则留空——
  // 绝不绘制 .notdef 方框。
  if (!glyph || glyph.index === 0) {
    glyphCache.set(char, { vertices: new Float32Array(0), advance: fontUnitsPerEm * 0.5 }); // 递归保护
    const synthetic = synthesizeGlyph(char);
    const mesh: GlyphMesh = synthetic ?? { vertices: new Float32Array(0), advance: fontUnitsPerEm * 0.5 };
    glyphCache.set(char, mesh);
    return mesh;
  }

  // 步进宽度归一化到主字体的 unitsPerEm 基准
  const rawAdvance = glyph.advanceWidth ?? upem * 0.6;
  const advance = font === activeFont ? rawAdvance : (rawAdvance * (fontUnitsPerEm / upem));
  const rawVertices = triangulateGlyph(glyph, upem);

  let vertices = rawVertices;
  if (font !== activeFont && fontUnitsPerEm !== upem) {
    const ratio = fontUnitsPerEm / upem;
    vertices = new Float32Array(rawVertices.length);
    for (let i = 0; i < rawVertices.length; i++) {
      vertices[i] = rawVertices[i] * ratio;
    }
  }

  const mesh: GlyphMesh = {
    vertices,
    advance,
  };
  glyphCache.set(char, mesh);
  return mesh;
}

export interface OutlineTextLayoutRun {
  /** 世界局部顶点（三角形，每3个点一个三角形） */
  vertices: Float32Array;
  /** 文本行总宽度（世界单位） */
  totalWidth: number;
}

/**
 * TrueType 的缩放：整段共用一个 em。
 *
 * AutoCAD 的 TTF 字高是大写字母高度，不是汉字字身。汉字比大写字母高，
 * 这是字体自己的比例，不能再逐字拉成一样高。
 */
const charScale = (height: number, widthFactor: number) => {
  const scaleY = height / Math.max(1, fontCapHeight);
  return { scaleY, scaleX: scaleY * (widthFactor > 0 ? widthFactor : 1) };
};

/**
 * 将一行文字排版为几何三角形顶点数组
 * @param text 文本字符串
 * @param height CAD 文字高度（世界单位）
 * @param widthFactor 宽度因子
 */
export function layoutOutlineToTriangles(
  text: string,
  height: number,
  widthFactor: number,
): OutlineTextLayoutRun | null {
  if (!activeFont || !text) return null;

  const chars = Array.from(text);
  const runs: Array<{ mesh: GlyphMesh; x: number; scaleY: number; scaleX: number }> = [];
  let curX = 0;

  for (const ch of chars) {
    if (ch === ' ') {
      curX += (fontUnitsPerEm * 0.35) * charScale(height, widthFactor).scaleX;
      continue;
    }
    const mesh = getGlyphMesh(ch);
    // 逐字符缩放：中英文在同一行里各自按自己的字身度量，
    // 避免英文被中文的 em 盒放大（实测 1.31×，整行字号忽大忽小）。
    const { scaleY, scaleX } = charScale(height, widthFactor);
    if (mesh) {
      runs.push({ mesh, x: curX, scaleY, scaleX });
      curX += mesh.advance * scaleX;
    } else {
      curX += (fontUnitsPerEm * 0.5) * scaleX;
    }
  }

  const totalWidth = curX;
  if (!runs.length) return { vertices: new Float32Array(0), totalWidth };

  let totalFloats = 0;
  for (const r of runs) {
    totalFloats += r.mesh.vertices.length;
  }

  const out = new Float32Array(totalFloats);
  let offset = 0;

  for (const r of runs) {
    const v = r.mesh.vertices;
    const gx = r.x;
    for (let i = 0; i < v.length; i += 2) {
      out[offset + i] = gx + v[i] * r.scaleX;
      out[offset + i + 1] = v[i + 1] * r.scaleY;
    }
    offset += v.length;
  }

  return {
    vertices: out,
    totalWidth,
  };
}

/** 测量一段文字的轮廓几何宽度（世界模型单位） */
export function measureOutlineTextWidth(
  text: string,
  height: number,
  widthFactor: number,
): number {
  if (!activeFont || !text) return 0;

  let curX = 0;
  for (const ch of Array.from(text)) {
    // 与 layoutOutlineToTriangles 保持一致：逐字符缩放。
    const { scaleX } = charScale(height, widthFactor);
    if (ch === ' ') {
      curX += (fontUnitsPerEm * 0.35) * scaleX;
      continue;
    }
    const mesh = getGlyphMesh(ch);
    curX += (mesh ? mesh.advance : fontUnitsPerEm * 0.5) * scaleX;
  }
  return curX;
}

/** 字形在基线以下的深度（世界单位）。底部对齐用它把最低点抬到对齐点。 */
const outlineInkDescent = (text: string, height: number, widthFactor: number): number => {
  const run = layoutOutlineToTriangles(text, height, widthFactor);
  if (!run) return height * 0.18;
  let minY = 0;
  const vertices = run.vertices;
  for (let i = 1; i < vertices.length; i += 2) {
    if (vertices[i] < minY) minY = vertices[i];
  }
  return -minY;
};

export interface PositionedOutlineLine {
  text: string;
  vertices: Float32Array;
  localX: number;
  localY: number;
  width: number;
}

export interface PositionedOutlineText {
  origin: Point2D;
  rotation: number;
  lines: PositionedOutlineLine[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/**
 * 完整按照 AutoCAD 规范将一个 DXF 文本实体（TEXT / MTEXT / ATTRIB / ATTDEF）
 * 排版为世界坐标系下的纯多边形几何三角形。
 * 支持：
 * - MTEXT 自动列宽换行（wrapTextByMeasuredWidth）
 * - MTEXT 附着点 1-9（attachmentPoint：Top/Middle/Bottom, Left/Center/Right）
 * - MTEXT 段落行距（lineSpacingFactor, lineSpacingStyle）
 * - 单行文字水平对齐（hAlign: 0 Left, 1 Center, 2 Right, 3 Aligned, 4 Middle, 5 Fit）
 * - 单行文字垂直对齐（vAlign: 0 Baseline, 1 Bottom, 2 Middle, 3 Top）
 * - 契合/对齐文字（hAlign=3 Aligned / hAlign=5 Fit 与 secondPosition）精确自适应
 */
export function layoutOutlineTextEntity(
  entity: DxfText,
  styles?: Record<string, DxfStyle>,
): PositionedOutlineText | null {
  if (!activeFont) return null;
  const rawValue = entity.value || '';
  if (!rawValue.trim()) return null;

  const isMText = entity.type === EntityType.MTEXT;
  const clean = isMText ? cleanMText(rawValue) : cleanCadText(rawValue);
  if (!clean.trim()) return null;

  const style = getStyleForText(entity, styles);
  const effectiveHeight = getEffectiveTextHeight(entity, styles);
  if (!(effectiveHeight > 0) || !Number.isFinite(effectiveHeight)) return null;

  // 内联宽度因子 \W...; 解析：优先于样式宽度因子
  let inlineWidthFactor = 1.0;
  if (isMText) {
    const wMatch = rawValue.match(/\\[Ww]([0-9.]+);/);
    if (wMatch && wMatch[1]) {
      const val = parseFloat(wMatch[1]);
      if (Number.isFinite(val) && val > 0) inlineWidthFactor = val;
    }
  }

  const baseWidthFactor = (entity.widthFactor && entity.widthFactor > 0)
    ? entity.widthFactor
    : (style?.widthFactor && style.widthFactor > 0 ? style.widthFactor : 1);
  const widthFactor = baseWidthFactor * inlineWidthFactor;

  if (isMText) {
    const rawParagraphs = clean.split('\n');
    const declaredWidth = entity.width && entity.width > 0 ? entity.width : 0;
    const measure = (s: string) => measureOutlineTextWidth(s, effectiveHeight, widthFactor);

    const lines: string[] = [];
    if (declaredWidth > 0) {
      for (const p of rawParagraphs) {
        lines.push(...wrapTextByMeasuredWidth(measure, p, declaredWidth * 0.985));
      }
    } else {
      lines.push(...rawParagraphs);
    }

    const lineWidths = lines.map(l => measure(l));
    const maxLineWidth = Math.max(...lineWidths, 0);
    const blockWidth = declaredWidth > 0 ? declaredWidth : maxLineWidth;

    const lineSpacingRaw = Number((entity as any).lineSpacingFactor);
    const lineSpacingFactor = Math.min(3.0, Math.max(0.5, Number.isFinite(lineSpacingRaw) && lineSpacingRaw > 0 ? lineSpacingRaw : 1));
    const lineHeight = effectiveHeight * 1.66 * lineSpacingFactor;
    const blockHeight = lines.length > 1 ? (lines.length - 1) * lineHeight + effectiveHeight : effectiveHeight;

    const ap = entity.attachmentPoint || 1;
    // 水平锚点偏移（以 position 为基点）
    let boxLeft = 0;
    if ([2, 5, 8].includes(ap)) boxLeft = -blockWidth / 2;
    else if ([3, 6, 9].includes(ap)) boxLeft = -blockWidth;

    // 垂直锚点偏移（世界坐标 Y 向上）
    let top = 0;
    if ([4, 5, 6].includes(ap)) top = blockHeight / 2;
    else if ([7, 8, 9].includes(ap)) top = blockHeight;

    // 首行基线：在 AutoCAD 中，Top-Left 插入点与首行顶边对齐，首行基线位于 top - effectiveHeight 下方
    const firstLineBaseline = top - effectiveHeight;

    const positionedLines: PositionedOutlineLine[] = [];
    let localMinX = Infinity, localMinY = Infinity, localMaxX = -Infinity, localMaxY = -Infinity;

    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i];
      if (!lineText) continue;
      const lineWidth = lineWidths[i];
      let lineX = boxLeft;
      if ([2, 5, 8].includes(ap)) {
        lineX = boxLeft + (blockWidth - lineWidth) / 2;
      } else if ([3, 6, 9].includes(ap)) {
        lineX = boxLeft + (blockWidth - lineWidth);
      }
      const lineY = firstLineBaseline - i * lineHeight;

      const run = layoutOutlineToTriangles(lineText, effectiveHeight, widthFactor);
      if (!run || run.vertices.length < 6) continue;

      positionedLines.push({
        text: lineText,
        vertices: run.vertices,
        localX: lineX,
        localY: lineY,
        width: lineWidth,
      });

      if (lineX < localMinX) localMinX = lineX;
      if (lineX + lineWidth > localMaxX) localMaxX = lineX + lineWidth;
      if (lineY < localMinY) localMinY = lineY;
      if (lineY + effectiveHeight > localMaxY) localMaxY = lineY + effectiveHeight;
    }

    if (!positionedLines.length) return null;

    return {
      origin: entity.position,
      rotation: ((entity.rotation || 0) * Math.PI) / 180,
      lines: positionedLines,
      bounds: {
        minX: Number.isFinite(localMinX) ? localMinX : boxLeft,
        minY: Number.isFinite(localMinY) ? localMinY : -blockHeight,
        maxX: Number.isFinite(localMaxX) ? localMaxX : boxLeft + blockWidth,
        maxY: Number.isFinite(localMaxY) ? localMaxY : top,
      },
    };
  }

  // 单行文字：TEXT / ATTRIB / ATTDEF
  const hAlign = entity.hAlign || 0;
  const vAlign = entity.vAlign || 0;
  const pos = entity.position;
  const sec = entity.secondPosition;

  let origin = pos;
  let rotation = ((entity.rotation || 0) * Math.PI) / 180;
  let effectiveWFactor = widthFactor;
  let effectiveH = effectiveHeight;
  let lineX = 0;
  let lineY = 0;

  if ((hAlign === 3 || hAlign === 5) && sec) {
    const dx = sec.x - pos.x;
    const dy = sec.y - pos.y;
    const targetDist = Math.hypot(dx, dy);
    rotation = Math.atan2(dy, dx);
    origin = pos;
    const rawW = measureOutlineTextWidth(clean, effectiveHeight, 1.0);
    if (rawW > 0 && targetDist > 0) {
      if (hAlign === 5) {
        // Fit 契合：仅沿 X 轴拉伸/压缩，高度保持不变
        effectiveWFactor = targetDist / rawW;
      } else {
        // Aligned 对齐：X 和 Y 按同一比例缩放
        const s = targetDist / rawW;
        effectiveH = effectiveHeight * s;
        effectiveWFactor = 1.0;
      }
    }
    lineX = 0;
    lineY = 0;
  } else {
    rotation = ((entity.rotation || 0) * Math.PI) / 180;
    origin = (hAlign !== 0 || vAlign !== 0) && sec ? sec : pos;
    const lineWidth = measureOutlineTextWidth(clean, effectiveHeight, effectiveWFactor);

    if (hAlign === 1 || hAlign === 4) lineX = -lineWidth / 2;
    else if (hAlign === 2) lineX = -lineWidth;

    // 底部对齐：把本行字形的最低点抬到对齐点上（与 Canvas 的实际下行量一致）。
    const inkDescent = outlineInkDescent(clean, effectiveH, effectiveWFactor);
    if (vAlign === 1) lineY = inkDescent;
    // 居中 / 顶部都按 CAD 字高（每个字符的墨迹高已缩放到字高），
    // 不能用「大写字高 / 中文字身」的比例：那会让顶部对齐整体上移约 1/4 字高。
    else if (vAlign === 2 || hAlign === 4) lineY = -effectiveH / 2;
    else if (vAlign === 3) lineY = -effectiveH;
  }

  const run = layoutOutlineToTriangles(clean, effectiveH, effectiveWFactor);
  if (!run || run.vertices.length < 6) return null;

  return {
    origin,
    rotation,
    lines: [{
      text: clean,
      vertices: run.vertices,
      localX: lineX,
      localY: lineY,
      width: run.totalWidth,
    }],
    bounds: {
      minX: lineX,
      minY: lineY,
      maxX: lineX + run.totalWidth,
      maxY: lineY + effectiveH,
    },
  };
}
