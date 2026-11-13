/**
 * 纸张空间视口边框的显示判据（Canvas / WebGL 双引擎共用一处，避免不一致）。
 *
 * - 图纸自带视口（viewportId / status = 1）AutoCAD 不显示边框：它常常覆盖
 *   整张纸，画出来就是一条横贯全图的巨大矩形（实测纸张布局里非常显眼）。
 * - 其余真实视口按图层「可打印」标志决定：Defpoints / `*-NPLT` 等不打印图层
 *   上的视口边框不出图，与打印结果一致。
 */
import type { DxfLayer, DxfViewport } from '@/types';

export const shouldDrawViewportBorder = (
    ent: Pick<DxfViewport, 'viewportId' | 'status'>,
    layer: DxfLayer | undefined,
): boolean => {
    if (ent.viewportId === 1 || ent.status === 1) return false;
    if (layer && layer.isPlottable === false) return false;
    return true;
};
