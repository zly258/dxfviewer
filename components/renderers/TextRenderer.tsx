import React from 'react';
import { DxfStyle, DxfText, EntityType } from '../../types';
import { AUTO_CAD_COLORS, DEFAULT_COLOR } from '../../constants';
import { getStyleFontFamily } from '../../services/fontService';

/**
 * Strips AutoCAD MTEXT formatting codes and handles special characters and Unicode escapes.
 */
export const cleanText = (text: string): string => {
    if (!text) return "";
    return text
        .replace(/\\P/g, '\n') // AutoCAD newline
        .replace(/\\p/g, '\n') // Paragraph break (lowercase variant)
        .replace(/\\\{/g, '{').replace(/\\\}/g, '}') // Escaped braces
        .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))) // Unicode \U+XXXX
        .replace(/\\[A-Z][^;]*;/gi, '') // Formatting codes like \fArial|b0|i0|c0|p34;
        .replace(/\\\{[^}]*\}/g, '') // Remove formatting blocks with braces
        .replace(/\{|\}/g, '') // Remove remaining braces
        .replace(/%%[cC]/g, 'Ø') // Diameter symbol
        .replace(/%%[dD]/g, '°') // Degree symbol
        .replace(/%%[pP]/g, '±') // Plus-minus symbol
        .replace(/%%\d{3}/g, '') // Remove other %% codes
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
 * Extract simple \H height factor from text if present (e.g., \H1x;)
 * Returns null if not found.
 */
const extractContentHeightFactor = (text: string): number | null => {
    // Matches \H1.5x; or \H2;
    const matches = text.match(/\\H(\d+(\.\d+)?)(x?);/i);
    if (matches && matches[1]) {
        const val = parseFloat(matches[1]);
        // If it ends with 'x', it's a relative factor
        if (matches[3] && matches[3].toLowerCase() === 'x') {
            return val;
        }
        // Otherwise it's an absolute height, but we return it as a factor relative to entity height?
        // Actually, in MText, \H inside a block sets the height for subsequent text.
        // For simplicity, we'll treat it as a factor if it's small, but that's risky.
        // Standard behavior is \H is absolute height.
        return val; 
    }
    return null;
}

/**
 * Extracts the first font name from MTEXT formatting codes (e.g., \fArial|...;)
 * Also extracts bold/italic info if present.
 */
const extractMTextFormatting = (text: string) => {
    // Improved regex to handle various MText font formats
    const matches = text.match(/\\f([^|;]+)([^;]*);/i);
    if (matches) {
        const fontName = matches[1].replace(/\"/g, '').trim();
        const options = matches[2].toLowerCase();
        const isBold = options.includes('|b1') || options.includes('|b 1');
        const isItalic = options.includes('|i1') || options.includes('|i 1');
        return { fontName, isBold, isItalic };
    }
    return null;
};

interface TextRendererProps {
    entity: DxfText;
    color: string;
    styles?: Record<string, DxfStyle>;
    onClick?: (e: React.MouseEvent) => void;
    isSelected?: boolean;
    offset?: Point2D;
}

export const TextRenderer: React.FC<TextRendererProps> = ({ entity: ent, color, styles, onClick, isSelected, offset }) => {
    const ox = offset?.x || 0;
    const oy = offset?.y || 0;

    const isMText = ent.type === EntityType.MTEXT;
    let fontFamily = getStyleFontFamily(ent.styleName, styles);
    let fontWeight = 'normal';
    let fontStyle = 'normal';
    
    // Check for MTEXT inline font override
    if (isMText) {
        const formatting = extractMTextFormatting(ent.value);
        if (formatting) {
            const { fontName, isBold, isItalic } = formatting;
            if (isBold) fontWeight = 'bold';
            if (isItalic) fontStyle = 'italic';

            // Map the inline font name to a web font stack
            const fontLower = fontName.toLowerCase();
            if (fontLower.includes('song') || fontLower.includes('simsun') || fontLower.includes('仿宋') || fontLower.includes('fangsong')) {
                fontFamily = '"FangSong", "仿宋", "STFangsong", "SimSun", "宋体", "Microsoft YaHei", sans-serif';
            } else if (fontLower.includes('hei') || fontLower.includes('simhei') || fontLower.includes('黑体')) {
                fontFamily = '"SimHei", "黑体", "Microsoft YaHei", "微软雅黑", sans-serif';
            } else if (fontLower === 'arial') {
                fontFamily = 'Arial, Helvetica, sans-serif';
            } else {
                fontFamily = `"${fontName}", ${fontFamily}`;
            }
        }
    }

    const content = cleanText(ent.value);

    // Resolve Style Props
    const style = styles?.[ent.styleName || 'STANDARD'];
    const styleHeight = style?.height || 0;
    const styleWidthFactor = style?.widthFactor || 1;

    // Height Logic: If Entity Height is 0, use Style Height. If both 0, default to 2.5
    let height = (ent.height > 0) ? ent.height : (styleHeight > 0 ? styleHeight : 2.5);
    
    if (isMText) {
        const heightFactor = extractContentHeightFactor(ent.value);
        if (heightFactor !== null) {
            height *= heightFactor;
        }
    }

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
            <g transform={`translate(${ent.position.x - ox}, ${ent.position.y - oy}) rotate(${ent.rotation || 0}) scale(${widthFactor}, -1)`}>
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
                            fontWeight: fontWeight,
                            fontStyle: fontStyle,
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
        <g transform={`translate(${pos.x - ox}, ${pos.y - oy}) rotate(${ent.rotation || 0}) scale(${widthFactor}, -1)`}>
            <text
                x={0}
                y={0}
                fill={color}
                fontSize={height}
                fontFamily={fontFamily}
                fontWeight={fontWeight}
                fontStyle={fontStyle}
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