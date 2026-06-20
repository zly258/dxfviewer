import { DxfMLeader, Point2D } from '@/types';
import { LEADER_RENDER_CONFIG } from '@/config/viewerConfig';

/** 将二维向量归一化为单位长度，无效时使用备用方向符号。 */
export const normalizeVector = (vector: Point2D | undefined, fallbackSign: number): Point2D => {
    if (vector && Number.isFinite(vector.x) && Number.isFinite(vector.y)) {
        const length = Math.hypot(vector.x, vector.y);
        if (length > 1e-9) return { x: vector.x / length, y: vector.y / length };
    }
    return { x: fallbackSign >= 0 ? 1 : -1, y: 0 };
};

/** 计算 MLeader 第一条引线的终端（着陆）点，包括折线段。 */
export const getMLeaderTerminalPoint = (entity: DxfMLeader): Point2D | null => {
    const firstLine = entity.leaderLines.find(line => line.length > 0);
    if (!firstLine) return entity.textPosition || null;
    const last = firstLine[firstLine.length - 1];
    if (!entity.enableDogleg) return last;
    const prev = firstLine.length > 1 ? firstLine[firstLine.length - 2] : null;
    const fallbackSign = entity.textPosition
        ? (entity.textPosition.x >= last.x ? 1 : -1)
        : (prev && last.x < prev.x ? -1 : 1);
    const direction = normalizeVector(entity.doglegVector, fallbackSign);
    const length = Math.max(0, entity.doglegLength || LEADER_RENDER_CONFIG.defaultMLeaderDoglegLength);
    return { x: last.x + direction.x * length, y: last.y + direction.y * length };
};

/** 计算 MLeader 文字的有效位置。 */
export const getMLeaderTextPosition = (entity: DxfMLeader): Point2D | null => {
    if (entity.textPosition) return entity.textPosition;
    const terminal = getMLeaderTerminalPoint(entity);
    if (!terminal) return null;
    const direction = normalizeVector(entity.doglegVector, 1);
    return {
        x: terminal.x + direction.x * LEADER_RENDER_CONFIG.mleaderTextGapFactor,
        y: terminal.y + direction.y * LEADER_RENDER_CONFIG.mleaderTextGapFactor,
    };
};

/** 确定 MLeader 文字的 MTEXT 附着点（1–9）。 */
export const getMLeaderTextAttachment = (entity: DxfMLeader, textPosition: Point2D): number => {
    if (entity.textAttachment && entity.textAttachment >= 1 && entity.textAttachment <= 9) return entity.textAttachment;
    const terminal = getMLeaderTerminalPoint(entity);
    if (!terminal) return 4;
    return textPosition.x >= terminal.x ? 4 : 6;
};
