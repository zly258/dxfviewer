/**
 * 清理字符串中的 MTEXT 格式化代码。
 * 支持 \f, \H, \W, \C, \S, \P, \L, \O 等。
 */
export function cleanMText(text: string): string {
    if (!text) return "";

    let result = text;

    // 1. 移除类似 {\fArial|b0|i0|c0|p34;...} 的格式化块
    // 我们需要小心处理嵌套花括号，但通常 DXF MTEXT 不会深度嵌套。
    // 首先，处理常见的 {\...;text} 情况
    result = result.replace(/\{[\\].*?;/g, "");
    result = result.replace(/\}/g, "");

    // 2. 移除特定代码：
    // \f...; (字体)
    // \H...; (高度)
    // \W...; (宽度)
    // \C...; (颜色)
    // \T...; (字间距)
    // \Q...; (倾斜度)
    // \A...; (对齐)
    // 安全地支持带或不带分号的代码
    result = result.replace(/\\[fHWCTQA][^;\\}]*(?:;|(?=[\\}]|$))/gi, "");

    // 3. 处理特殊字符：
    // \P (段落/换行)
    result = result.replace(/\\[P]/g, "\n");
    
    // \S...^...; (堆叠 - 常用于分数)
    // 目前通过将其替换为内容来简化它
    result = result.replace(/\\[S](.*?)[^](.*?);/g, "$1/$2");

    // \L, \l (下划线)
    // \O, \o (上划线)
    // \K, \k (删除线)
    result = result.replace(/\\[L|l|O|o|K|k]/g, "");

    // 5. 处理特殊转义字符
    result = result.replace(/\\~/g, " "); // 不换行空格

    // 4. 处理转义字符：
    // \\ (反斜杠)
    // \{ (左花括号)
    // \} (右花括号)
    result = result.replace(/\\{/g, "{");
    result = result.replace(/\\}/g, "}");
    result = result.replace(/\\\\/g, "\\");

    return result;
}
