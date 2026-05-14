import { ShxFont, ShxShape } from '@mlightcad/shx-parser';
import { DxfStyle, DxfText, Point2D } from '../../types';
import { CAD_DEFAULT_TEXT_STYLE } from '../../shared/constants/cadConstants';
import { TEXT_RENDER_CONFIG } from '../../shared/config/viewerConfig';

export interface ShxGlyphProfile {
  width: number;
  advanceWidth: number;
  height: number;
  bbox: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
  polylines: Point2D[][];
}

export interface ShxTextMeasureResult {
  width: number;
  loadedFontCount: number;
  glyphCount: number;
  fallbackCount: number;
}

interface LoadedShxFont {
  font: ShxFont;
  cache: Map<string, ShxGlyphProfile | null>;
}

const SHX_FONT_ROOT = '/fonts/shx/';
const COMMON_SHX_FONTS = ['simplex.shx', 'txt.shx', 'romans.shx', 'hztxt.shx'];
const loadedFontPromises = new Map<string, Promise<LoadedShxFont | null>>();
const loadedFontValues = new Map<string, LoadedShxFont | null>();
const fetchNameCache = new Map<string, string[]>();
const listeners = new Set<() => void>();

const notifyFontChanged = () => {
  listeners.forEach(listener => listener());
};

export const subscribeShxFontChanged = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const normalizeShxFontName = (fontName?: string): string => {
  const rawName = (fontName || '').trim().replace(/\\/g, '/').split('/').pop() || '';
  if (!rawName) return '';
  return rawName.toLowerCase().endsWith('.shx') ? rawName : `${rawName}.shx`;
};

const getStyle = (styleName: string | undefined, styles?: Record<string, DxfStyle>): DxfStyle | undefined => {
  const effectiveName = styleName || CAD_DEFAULT_TEXT_STYLE;
  const direct = styles?.[effectiveName] || styles?.[effectiveName.toUpperCase()] || styles?.[effectiveName.toLowerCase()];
  if (direct) return direct;
  return Object.values(styles || {}).find(style => style.name?.toLowerCase() === effectiveName.toLowerCase());
};

const pushFontName = (target: string[], value?: string) => {
  if (!value) return;

  // STYLE 或 MTEXT 内联字体有时会写成“Wcad.shx | HZtxt.shx”，这里拆成真实文件名。
  const candidates = value
    .replace(/["']/g, '')
    .split(/[|,;]+/)
    .map(part => part.trim())
    .filter(Boolean)
    .filter(part => part.toLowerCase().endsWith('.shx') || /^[\w\-.]+$/i.test(part));

  candidates.forEach(candidate => {
    const normalized = normalizeShxFontName(candidate);
    if (normalized && !target.some(name => name.toLowerCase() === normalized.toLowerCase())) {
      target.push(normalized);
    }
  });
};

const getInlineShxFontNames = (rawText?: string): string[] => {
  const names: string[] = [];
  if (!rawText) return names;

  const regex = /\\[Ff]([^;{}]+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(rawText)) !== null) {
    const firstPart = (match[1] || '').split('|')[0];
    pushFontName(names, firstPart);
  }
  return names;
};

export const getTextShxFontNames = (entity: DxfText, styles?: Record<string, DxfStyle>): string[] => {
  const style = getStyle(entity.styleName, styles);
  const names: string[] = [];
  pushFontName(names, style?.fontFileName);
  pushFontName(names, style?.bigFontFileName);
  getInlineShxFontNames(entity.value).forEach(name => pushFontName(names, name));
  return names;
};

export const isShxTextStyle = (entity: DxfText, styles?: Record<string, DxfStyle>): boolean => {
  return getTextShxFontNames(entity, styles).length > 0;
};

const addCandidate = (target: string[], value?: string) => {
  if (!value) return;
  const name = value.trim();
  if (!name) return;
  if (!target.includes(name)) target.push(name);
};

const titleCaseFileName = (name: string): string => {
  const dot = name.lastIndexOf('.');
  const base = dot >= 0 ? name.slice(0, dot) : name;
  const ext = dot >= 0 ? name.slice(dot) : '.shx';
  if (!base) return name;
  return `${base.charAt(0).toUpperCase()}${base.slice(1).toLowerCase()}${ext.toUpperCase()}`;
};

const getKnownCaseCandidates = (normalized: string): string[] => {
  const base = normalized.replace(/\.shx$/i, '').toLowerCase();
  const known: Record<string, string[]> = {
    wcad: ['Wcad.shx', 'WCAD.SHX', 'wcad.shx'],
    hztxt: ['HZtxt.SHX', 'HZTXT.SHX', 'hztxt.shx'],
    hz_fs: ['HZ_FS.SHX', 'hz_fs.shx'],
    hzdf2: ['Hzdf2.shx', 'HZDF2.SHX', 'hzdf2.shx'],
    hzsmcad: ['Hzsmcad.shx', 'HZSMCAD.SHX', 'hzsmcad.shx'],
    romans: ['romans.shx', 'ROMANS.SHX'],
    romans2: ['romans2.shx', 'ROMANS2.SHX'],
    simplex1: ['SIMPLEX1.SHX', 'simplex1.shx'],
    tssdchn: ['TSSDCHN.SHX', 'tssdchn.shx'],
    tssdeng: ['TSSDENG.SHX', 'tssdeng.shx'],
    pdfhz: ['PDFHZ.SHX', 'pdfhz.shx'],
    greeks: ['greeks.shx', 'GREEKS.SHX'],
    cad1: ['CAD1.shx', 'cad1.shx', 'CAD1.SHX'],
  };
  return known[base] || [];
};

const getFetchCandidates = (fontName: string): string[] => {
  const normalized = normalizeShxFontName(fontName);
  if (!normalized) return [];
  const cacheKey = normalized.toLowerCase();
  const cached = fetchNameCache.get(cacheKey);
  if (cached) return cached;

  const candidates: string[] = [];
  const withoutExt = normalized.replace(/\.shx$/i, '');
  addCandidate(candidates, normalized);
  addCandidate(candidates, normalized.toLowerCase());
  addCandidate(candidates, normalized.toUpperCase());
  addCandidate(candidates, `${withoutExt}.shx`);
  addCandidate(candidates, `${withoutExt}.SHX`);
  addCandidate(candidates, titleCaseFileName(normalized));
  getKnownCaseCandidates(normalized).forEach(candidate => addCandidate(candidates, candidate));

  fetchNameCache.set(cacheKey, candidates);
  return candidates;
};

const fetchShxFontBuffer = async (fontName: string): Promise<ArrayBuffer | null> => {
  for (const candidate of getFetchCandidates(fontName)) {
    try {
      const response = await fetch(`${SHX_FONT_ROOT}${encodeURIComponent(candidate)}`);
      if (response.ok) return await response.arrayBuffer();
    } catch {
      // 字体不存在或读取失败时继续尝试下一个候选文件名。
    }
  }
  return null;
};

export const loadShxFont = async (fontName: string): Promise<LoadedShxFont | null> => {
  const normalizedName = normalizeShxFontName(fontName);
  if (!normalizedName) return null;

  if (!loadedFontPromises.has(normalizedName)) {
    const promise = fetchShxFontBuffer(normalizedName)
      .then(buffer => {
        const loaded = buffer ? { font: new ShxFont(buffer), cache: new Map<string, ShxGlyphProfile | null>() } : null;
        loadedFontValues.set(normalizedName, loaded);
        notifyFontChanged();
        return loaded;
      })
      .catch(() => {
        loadedFontValues.set(normalizedName, null);
        notifyFontChanged();
        return null;
      });
    loadedFontPromises.set(normalizedName, promise);
  }

  return loadedFontPromises.get(normalizedName) || null;
};

export const getLoadedShxFontSync = (fontName: string): LoadedShxFont | null => {
  const normalizedName = normalizeShxFontName(fontName);
  if (!normalizedName) return null;
  if (!loadedFontPromises.has(normalizedName)) void loadShxFont(normalizedName);
  return loadedFontValues.get(normalizedName) || null;
};

const toFiniteNumber = (value: unknown, fallback = 0): number => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
};

const shapeToGlyphProfile = (shape: ShxShape | null | undefined, size: number): ShxGlyphProfile | null => {
  if (!shape) return null;
  const polylines = (shape.polylines || [])
    .filter(polyline => Array.isArray(polyline) && polyline.length > 0)
    .map(polyline => polyline.map(point => ({ x: toFiniteNumber(point.x), y: toFiniteNumber(point.y) })));

  const bbox = {
    minX: toFiniteNumber(shape.bbox?.minX),
    minY: toFiniteNumber(shape.bbox?.minY),
    maxX: toFiniteNumber(shape.bbox?.maxX),
    maxY: toFiniteNumber(shape.bbox?.maxY),
  };
  const bboxWidth = Math.max(0, bbox.maxX - bbox.minX);
  const bboxHeight = Math.max(0, bbox.maxY - bbox.minY);
  const lastPointX = toFiniteNumber(shape.lastPoint?.x);
  const advanceWidth = Math.max(
    lastPointX > 0 ? lastPointX : 0,
    bboxWidth,
    size * TEXT_RENDER_CONFIG.spaceCharacterWidthFactor,
  );

  return {
    width: bboxWidth || advanceWidth,
    advanceWidth,
    height: bboxHeight || size,
    bbox,
    polylines,
  };
};

const getGlyphProfileFromFont = (loaded: LoadedShxFont, charCode: number, size: number): ShxGlyphProfile | null => {
  const cacheKey = `${charCode}:${size.toFixed(3)}`;
  if (loaded.cache.has(cacheKey)) return loaded.cache.get(cacheKey) || null;

  const profile = loaded.font.hasChar(charCode)
    ? shapeToGlyphProfile(loaded.font.getCharShape(charCode, size), size)
    : null;
  loaded.cache.set(cacheKey, profile);
  return profile;
};

export const getShxGlyphProfile = async (fontName: string, charCode: number, size: number): Promise<ShxGlyphProfile | null> => {
  const loaded = await loadShxFont(fontName);
  return loaded ? getGlyphProfileFromFont(loaded, charCode, size) : null;
};

export const getShxGlyphProfileSync = (fontNames: string[], charCode: number, size: number): ShxGlyphProfile | null => {
  for (const fontName of fontNames) {
    const loaded = getLoadedShxFontSync(fontName);
    if (!loaded) continue;
    const profile = getGlyphProfileFromFont(loaded, charCode, size);
    if (profile) return profile;
  }
  return null;
};

export const measureShxTextRunSync = (
  text: string,
  fontNames: string[],
  size: number,
  fallbackWidth: (char: string) => number = () => size * TEXT_RENDER_CONFIG.averageCharacterWidthFactor,
): ShxTextMeasureResult | null => {
  if (!text || fontNames.length === 0) return null;
  const loadedFontCount = fontNames.reduce((count, fontName) => count + (getLoadedShxFontSync(fontName) ? 1 : 0), 0);
  if (loadedFontCount === 0) return null;

  let width = 0;
  let glyphCount = 0;
  let fallbackCount = 0;
  for (const char of text) {
    if (char === '\n' || char === '\r') continue;
    if (char === ' ' || char === '\t') {
      width += size * TEXT_RENDER_CONFIG.spaceCharacterWidthFactor;
      continue;
    }
    const code = char.codePointAt(0) || char.charCodeAt(0);
    const profile = getShxGlyphProfileSync(fontNames, code, size);
    if (profile) {
      width += profile.advanceWidth;
      glyphCount++;
    } else {
      width += Math.max(fallbackWidth(char), size * TEXT_RENDER_CONFIG.averageCharacterWidthFactor);
      fallbackCount++;
    }
  }

  return { width, loadedFontCount, glyphCount, fallbackCount };
};

export const measureShxTextWidthSync = (text: string, fontNames: string[], size: number): number | null => {
  return measureShxTextRunSync(text, fontNames, size)?.width ?? null;
};

export const preloadShxFontsForStyles = (styles?: Record<string, DxfStyle>) => {
  const names = new Set<string>(COMMON_SHX_FONTS);
  Object.values(styles || {}).forEach(style => {
    const collected: string[] = [];
    pushFontName(collected, style.fontFileName);
    pushFontName(collected, style.bigFontFileName);
    collected.forEach(name => names.add(name));
  });
  names.forEach(name => { void loadShxFont(name); });
};
