import React from 'react';
import { DxfStyle, DxfText, EntityType } from '../../types';
import { AUTO_CAD_COLORS, DEFAULT_COLOR } from '../../constants';

/**
 * Strips AutoCAD MTEXT formatting codes and handles special characters and Unicode escapes.
 */
export const cleanText = (text: string): string => {
    if (!text) return "";
    return text
        .replace(/\\P/g, '\n') // AutoCAD newline
        .replace(/\\\{/g, '{').replace(/\\\}/g, '}') 
        .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))) // Unicode \U+XXXX
        .replace(/\\[A-Z][^;]*;/gi, '') // Formatting codes like \fArial|b0|i0|c0|p34;
        .replace(/\{|\}/g, '') 
        .replace(/%%[cC]/g, 'Ø')
        .replace(/%%[dD]/g, '°')
        .replace(/%%[pP]/g, '±')
        .trim();
};

/**
 * Extract simple \W width factor from text if present (e.g., \W0.8;)
 * Returns null if not found.
 */
const extractContentWidthFactor = (text: string): number | null => {
    const matches = text.match(/\\W(\d+(\.\d+)?);/);
    if (matches && matches[1]) {
        return parseFloat(matches[1]);
    }
    return null;
}

/**
 * Returns a CSS font stack optimized for Chinese and standard CAD fonts.
 */
export const getFontFamily = (styleName: string | undefined, styles: Record<string, DxfStyle> | undefined): string => {
    const CHINESE_FONTS = '"Microsoft YaHei", "微软雅黑", "SimSun", "宋体"';
    // Fallback hierarchy: specific fonts -> generic sans/serif -> system fallback
    const FALLBACK = `sans-serif, ${CHINESE_FONTS}, "Segoe UI", Arial`;

    if (!styleName || !styles || !styles[styleName]) return FALLBACK;
    
    const style = styles[styleName];
    const fontName = (style.fontFileName || "").toLowerCase();

    // Map common AutoCAD SHX/TTF names to web-safe equivalents
    // Romans, Simplex are vector stroke fonts, often look like thin sans-serif
    if (fontName.includes('roman') || fontName.includes('simplex') || fontName.includes('complex')) 
        return `"Times New Roman", "SimSun", serif`; // Use serif for Roman, but Simplex is usually sans... stick to simple mappings
    
    // Txt.shx is very blocky/ugly, Courier is a common fallback for "tech" look
    if (fontName.includes('txt') || fontName.includes('mono')) 
        return '"Courier New", monospace';
        
    if (fontName.includes('arial')) return `Arial, ${FALLBACK}`;
    if (fontName.includes('hz') || fontName.includes('gb') || fontName.includes('bigfont')) 
        return CHINESE_FONTS;
    
    return FALLBACK;
};

interface TextRendererProps {
    entity: DxfText;
    color: string;
    styles?: Record<string, DxfStyle>;
    onClick?: (e: React.MouseEvent) => void;
    isSelected?: boolean;
}

export const TextRenderer: React.FC<TextRendererProps> = ({ entity: ent, color, styles, onClick, isSelected }) => {
    const isMText = ent.type === EntityType.MTEXT;
    const fontFamily = getFontFamily(ent.styleName, styles);
    const content = cleanText(ent.value);

    // Resolve Style Props
    const style = styles?.[ent.styleName || 'STANDARD'];
    const styleHeight = style?.height || 0;
    const styleWidthFactor = style?.widthFactor || 1;

    // Height Logic: If Entity Height is 0, use Style Height. If both 0, default to 2.5
    const height = (ent.height > 0) ? ent.height : (styleHeight > 0 ? styleHeight : 2.5);

    // Width Factor Logic
    // MTEXT: Visual width factor comes from Style (or content \W overrides).
    // TEXT: Visual width factor comes from Entity (if set), else Style.
    let widthFactor = 1;
    if (isMText) {
        const contentW = extractContentWidthFactor(ent.value);
        widthFactor = contentW !== null ? contentW : styleWidthFactor;
    } else {
        widthFactor = (ent.widthFactor && ent.widthFactor > 0) ? ent.widthFactor : styleWidthFactor;
    }

    // MTEXT Attachment Point (Group 71)
    const ap = ent.attachmentPoint || 1;

    let xPercent = '0%';
    let yPercent = '0%';
    let textAlign: 'left' | 'center' | 'right' = 'left';

    // Horizontal Alignment Mapping
    if ([2, 5, 8].includes(ap)) { textAlign = 'center'; xPercent = '-50%'; }
    if ([3, 6, 9].includes(ap)) { textAlign = 'right'; xPercent = '-100%'; }

    // Vertical Alignment Mapping
    if ([4, 5, 6].includes(ap)) yPercent = '-50%';
    if ([7, 8, 9].includes(ap)) yPercent = '-100%';

    // Width Constraint (Group 41) for MText
    const wrapWidth = (isMText && ent.width && ent.width > 0) ? ent.width : undefined;

    const selectionStyle = isSelected ? { outline: '1px solid #3B82F6', background: 'rgba(59, 130, 246, 0.1)' } : {};

    if (isMText) {
        return (
            <g transform={`translate(${ent.position.x}, ${ent.position.y}) rotate(${ent.rotation || 0}) scale(${widthFactor}, -1)`}>
                <foreignObject 
                    x={0} 
                    y={0} 
                    width={1} 
                    height={1} 
                    overflow="visible" 
                    style={{ pointerEvents: 'none' }}
                >
                    <div 
                        style={{
                            position: 'absolute',
                            left: 0, 
                            top: 0,
                            transform: `scale(1, -1) translate(${xPercent}, ${yPercent})`, 
                            transformOrigin: '0 0',
                            fontSize: `${height}px`,
                            color: color,
                            width: wrapWidth ? `${wrapWidth}px` : 'max-content',
                            textAlign: textAlign,
                            lineHeight: '1.25',
                            fontFamily: fontFamily,
                            pointerEvents: 'auto',
                            whiteSpace: wrapWidth ? 'pre-wrap' : 'pre',
                            wordBreak: 'break-word',
                            overflowWrap: 'anywhere',
                            ...selectionStyle
                        }}
                        onClick={(e) => { e.stopPropagation(); onClick && onClick(e); }}
                        className="cursor-pointer select-none"
                    >
                        {content}
                    </div>
                </foreignObject>
            </g>
        );
    }

    // Single line TEXT (Group 72/73)
    const hAlign = ent.hAlign || 0;
    const vAlign = ent.vAlign || 0;
    const pos = (hAlign !== 0 || vAlign !== 0) ? (ent.secondPosition || ent.position) : ent.position;

    let textAnchor: 'start' | 'middle' | 'end' = 'start';
    if (hAlign === 1 || hAlign === 4) textAnchor = 'middle';
    if (hAlign === 2) textAnchor = 'end';

    let alignmentBaseline: 'alphabetic' | 'middle' | 'hanging' = 'alphabetic';
    if (vAlign === 1) alignmentBaseline = 'alphabetic'; 
    if (vAlign === 2) alignmentBaseline = 'middle'; 
    if (vAlign === 3) alignmentBaseline = 'hanging'; 

    return (
        <g transform={`translate(${pos.x}, ${pos.y}) rotate(${ent.rotation || 0}) scale(${widthFactor}, -1)`}>
            <text
                x={0}
                y={0}
                fill={color}
                fontSize={height}
                fontFamily={fontFamily}
                textAnchor={textAnchor}
                dominantBaseline={alignmentBaseline}
                style={{ pointerEvents: 'auto', ...selectionStyle }}
                onClick={(e) => { e.stopPropagation(); onClick && onClick(e); }}
                className="cursor-pointer select-none"
            >
                {content}
            </text>
        </g>
    );
};

export const MTextRenderer = TextRenderer;