/**
 * 清理字符串中的 MTEXT 格式化代码。
 * 参考 DXF MTEXT 规范，尽量保留内容并移除格式控制码。
 */
export function cleanMText(text: string): string {
    if (!text) return "";

    let result = "";
    const len = text.length;

    const readUntil = (start: number, terminator: string): { value: string; end: number } => {
        let i = start;
        let value = "";
        while (i < len) {
            const ch = text[i];
            if (ch === terminator) break;
            if (ch === "\\" || ch === "{" || ch === "}") {
                return { value, end: i - 1 };
            }
            value += ch;
            i += 1;
        }
        return { value, end: i };
    };

    for (let i = 0; i < len; i += 1) {
        const ch = text[i];
        if (ch === "\\") {
            const next = text[i + 1];
            if (!next) break;
            if (next === "\\" || next === "{" || next === "}") {
                result += next;
                i += 1;
                continue;
            }
            if (next === "P" || next === "X") {
                result += "\n";
                i += 1;
                continue;
            }
            if (next === "~") {
                result += " ";
                i += 1;
                continue;
            }
            if (next === "U" && text[i + 2] === "+") {
                const hex = text.slice(i + 3, i + 7);
                if (/^[0-9A-Fa-f]{4}$/.test(hex)) {
                    result += String.fromCharCode(parseInt(hex, 16));
                    i += 6;
                    continue;
                }
            }
            if (next === "S") {
                const stack = readUntil(i + 2, ";");
                const raw = stack.value;
                const sepMatch = raw.match(/(\^|#|\/)/);
                if (sepMatch) {
                    const idx = raw.indexOf(sepMatch[1]);
                    result += `${raw.slice(0, idx)}/${raw.slice(idx + 1)}`;
                } else {
                    result += raw;
                }
                i = stack.end;
                continue;
            }
            if (/[fFhHwWcCtTqQaA]/.test(next)) {
                const info = readUntil(i + 2, ";");
                i = info.end;
                continue;
            }
            if (/[lLoOkK]/.test(next)) {
                i += 1;
                continue;
            }
            result += next;
            i += 1;
            continue;
        }
        if (ch === "{" || ch === "}") {
            continue;
        }
        result += ch;
    }

    return result
        .replace(/%%[cC]/g, "Ø")
        .replace(/%%[dD]/g, "°")
        .replace(/%%[pP]/g, "±")
        .replace(/%%[uU]/g, "")
        .trim();
}
