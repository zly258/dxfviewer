/**
 * 清理字符串中的 MTEXT 格式化代码。
 * 支持 \f, \H, \W, \C, \S, \P, \L, \O 等。
 */
export function cleanMText(text: string): string {
    if (!text) return "";

    let result = text;
    // 1. 保护被转义的特殊字符 (使用特殊的不会在正常文本中出现的占位符)
    result = result.replace(/\\\\/g, '\x01');
    result = result.replace(/\\\{/g, '\x02');
    result = result.replace(/\\\}/g, '\x03');
    
    // 2. 转换常见 AutoCAD 符号代码
    result = result.replace(/%%[cC]/g, 'Ø');
    result = result.replace(/%%[dD]/g, '°');
    result = result.replace(/%%[pP]/g, '±');

    // 3. 处理换行符 \P (忽略大小写)
    result = result.replace(/\\[Pp]/g, '\n');

    // 4. 处理堆叠文字 (分式) \S...^...; 或 \S...#...; 或 \S.../...;
    // DXF 支持 ^, #, / 分隔符
    result = result.replace(/\\[Ss]([^;]*)[#^/]([^;]*);/g, '$1/$2');
    
    // 5. 移除所有其他带有分号的格式化代码 (\f, \C, \H, \T, \Q, \W, \A, \p 等等)
    // 格式都是 \字母数字值;
    result = result.replace(/\\[A-Za-z0-9][^;]*;/g, '');
    
    // 6. 移除不带分号的单字符格式化代码 (如 \L, \l, \O, \o, \K, \k 表示下划线、上划线删除线的开关)
    result = result.replace(/\\[L|l|O|o|K|k]/g, '');

    // 7. 特殊空格符 \~
    result = result.replace(/\\~/g, ' ');

    // 8. 移除 MTEXT 中用于组合格式的未转义花括号 {}
    result = result.replace(/[{}]/g, '');

    // 9. 恢复被保护的转义字符
    result = result.replace(/\x01/g, '\\');
    result = result.replace(/\x02/g, '{');
    result = result.replace(/\x03/g, '}');

    return result.trim();
}
