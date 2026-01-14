/**
 * Cleans MTEXT formatting codes from a string.
 * Supports \f, \H, \W, \C, \S, \P, \L, \O, etc.
 */
export function cleanMText(text: string): string {
    if (!text) return "";

    let result = text;

    // 1. Remove formatting blocks like {\fArial|b0|i0|c0|p34;...}
    // We need to be careful with nested braces, but usually DXF MTEXT is not deeply nested.
    // First, handle the common case of {\...;text}
    result = result.replace(/\{[\\].*?;/g, "");
    result = result.replace(/\}/g, "");

    // 2. Remove specific codes:
    // \f...; (Font)
    // \H...; (Height)
    // \W...; (Width)
    // \C...; (Color)
    // \T...; (Tracking)
    // \Q...; (Obliquing)
    // \A...; (Alignment)
    result = result.replace(/\\[fHWCTQA].*?;/g, "");

    // 3. Handle special characters:
    // \P (Paragraph/Newline)
    result = result.replace(/\\[P]/g, "\n");
    
    // \S...^...; (Stacking - often used for fractions)
    // For now, just simplify it by replacing with the content
    result = result.replace(/\\[S](.*?)[^](.*?);/g, "$1/$2");

    // \L, \l (Underline)
    // \O, \o (Overline)
    // \K, \k (Strike-through)
    result = result.replace(/\\[L|l|O|o|K|k]/g, "");

    // 5. Handle special escaped characters
    result = result.replace(/\\~/g, " "); // Non-breaking space

    // 4. Handle escaped characters:
    // \\ (Backslash)
    // \{ (Left brace)
    // \} (Right brace)
    result = result.replace(/\\{/g, "{");
    result = result.replace(/\\}/g, "}");
    result = result.replace(/\\\\/g, "\\");

    return result;
}
