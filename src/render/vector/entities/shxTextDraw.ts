/**
 * Canvas 上的 SHX / 大字体文字。
 *
 * 与 WebGL 的描边路径同一套整形：西文单线、汉字占「字高 × 宽度因子」的方格。
 * 这样两个引擎和 AutoCAD 的形字体字高、字宽、对齐一致。
 */
import type { VectorContext } from '@/render/vector/context';
import { DxfStyle, DxfText, EntityType } from '@/types';
import { TEXT_RENDER_CONFIG } from '@/config/viewerConfig';
import { cleanCadText, cleanMText, getEffectiveTextWidthFactor } from '@/utils/textUtils';
import { getBuiltinStrokeFont, resolveStrokeFont } from '@/render/text/shx/strokeFontRegistry';
import { shapeStrokeText } from '@/render/text/strokeTextShaper';
import { getFontMetrics, isOutlineFontAvailable, OUTLINE_FONT_FAMILY } from '@/render/text/fontMetrics';

const drawCjkCell = (
  ctx: VectorContext,
  ch: string,
  x: number,
  baselineY: number,
  height: number,
  widthFactor: number,
): void => {
  ctx.save();
  const px = height / Math.max(0.05, getFontMetrics().cjkHeightRatio);
  const family = isOutlineFontAvailable()
    ? `"${OUTLINE_FONT_FAMILY}", sans-serif`
    : 'sans-serif';
  ctx.font = `normal normal ${px}px ${family}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.translate(x, baselineY);
  const measured = ctx.measureText(ch).width || px;
  const cell = height * widthFactor;
  if (measured > 0) ctx.scale(cell / measured, 1);
  ctx.fillText(ch, 0, 0);
  ctx.restore();
};

/** 调用前 ctx 已经平移到锚点并转好角度，y 向下。 */
export const drawShxText = (
  ctx: VectorContext,
  ent: DxfText,
  styles: Record<string, DxfStyle> | undefined,
  screenTextHeight: number,
): void => {
  const widthFactor = Math.abs(getEffectiveTextWidthFactor(ent, styles)) || 1;
  const styleName = ent.styleName || 'STANDARD';
  const style = styles?.[styleName] || styles?.[styleName.toUpperCase()];
  const resolved = resolveStrokeFont(style?.fontFileName, style?.bigFontFileName, true);
  const font = resolved?.font ?? getBuiltinStrokeFont();
  const oblique = resolved?.obliqueAngle ?? 0;
  const isMText = ent.type === EntityType.MTEXT;
  const raw = isMText ? cleanMText(ent.value || '') : cleanCadText(ent.value || '');
  const lines = raw.split('\n');
  if (!lines.some(line => line.length > 0)) return;

  const lineStep = screenTextHeight * (isMText ? TEXT_RENDER_CONFIG.mtextDefaultLineSpacingFactor : 1);
  const hAlign = ent.hAlign || 0;
  const vAlign = ent.vAlign || 0;
  const attachment = ent.attachmentPoint || 0;

  // 正值 = 基线移到锚点下方（canvas y 向下）。顶部对齐时字顶贴住锚点。
  let boxShift = 0;
  if (isMText) {
    const middle = attachment >= 4 && attachment <= 6;
    const bottom = attachment >= 7;
    boxShift = bottom ? 0 : middle ? screenTextHeight / 2 : screenTextHeight;
  } else if (vAlign === 3) boxShift = screenTextHeight;
  else if (vAlign === 2 || hAlign === 4) boxShift = screenTextHeight / 2;
  else if (vAlign === 1) boxShift = -screenTextHeight * 0.15;

  ctx.lineWidth = 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  lines.forEach((line, index) => {
    if (!line) return;
    const shaping = shapeStrokeText(line, font, { height: screenTextHeight, widthFactor, oblique });
    let align = 0;
    if (isMText) {
      if (attachment % 3 === 2) align = -shaping.advance / 2;
      else if (attachment % 3 === 0 && attachment !== 0) align = -shaping.advance;
    } else if (hAlign === 1 || hAlign === 4) align = -shaping.advance / 2;
    else if (hAlign === 2) align = -shaping.advance;
    const lineDown = isMText ? index * lineStep : 0;

    for (const item of shaping.items) {
      if (item.kind === 'strokes') {
        for (const stroke of item.strokes) {
          if (stroke.length < 4) continue;
          ctx.beginPath();
          for (let k = 0; k < stroke.length; k += 2) {
            const x = stroke[k] + align;
            const y = boxShift + lineDown - stroke[k + 1];
            if (k === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      } else {
        drawCjkCell(ctx, item.char, item.x + align, boxShift + lineDown, screenTextHeight, widthFactor);
      }
    }
  });
};
