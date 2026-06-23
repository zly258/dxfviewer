import { Point2D, Point3D } from '@/types';

export interface OcsMatrix {
  Ax: Point3D;
  Ay: Point3D;
  Az: Point3D;
}

/**
 * 根据挤出方向法线向量计算对象坐标系到世界坐标系的旋转矩阵。
 * 当法线已经与世界坐标系对齐时返回空值。
 */
export const getOcsToWcsMatrix = (Nx: number, Ny: number, Nz: number): OcsMatrix | null => {
    const len = Math.sqrt(Nx * Nx + Ny * Ny + Nz * Nz);
    if (len < 1e-6) return null; // 法线向量太短
    Nx /= len; Ny /= len; Nz /= len;

    // 已经是 WCS 坐标系
    if (Math.abs(Nx) < 1e-6 && Math.abs(Ny) < 1e-6 && Math.abs(Nz - 1) < 1e-6) return null;

    let Ax: Point3D;
    if (Math.abs(Nx) < 1 / 64 && Math.abs(Ny) < 1 / 64) {
        Ax = { x: Nz, y: 0, z: -Nx };
    } else {
        Ax = { x: -Ny, y: Nx, z: 0 };
    }

    const lenAx = Math.sqrt(Ax.x * Ax.x + Ax.y * Ax.y + Ax.z * Ax.z);
    Ax.x /= lenAx; Ax.y /= lenAx; Ax.z /= lenAx;

    const Ay: Point3D = {
        x: Ny * Ax.z - Nz * Ax.y,
        y: Nz * Ax.x - Nx * Ax.z,
        z: Nx * Ax.y - Ny * Ax.x,
    };
    const lenAy = Math.sqrt(Ay.x * Ay.x + Ay.y * Ay.y + Ay.z * Ay.z);
    Ay.x /= lenAy; Ay.y /= lenAy; Ay.z /= lenAy;

    const Az: Point3D = { x: Nx, y: Ny, z: Nz };
    return { Ax, Ay, Az };
};

/** 将二维点从对象坐标系转换到世界坐标系。 */
export const applyOcs = (p: { x: number; y: number }, matrix: OcsMatrix | null, elevation = 0): Point2D => {
    if (!matrix) return p;
    const x = p.x * matrix.Ax.x + p.y * matrix.Ay.x + elevation * matrix.Az.x;
    const y = p.x * matrix.Ax.y + p.y * matrix.Ay.y + elevation * matrix.Az.y;
    return { x, y };
};

/** 将旋转角度（度）从对象坐标系转换到世界坐标系。 */
export const getWcsRotation = (rotation: number, ocs: OcsMatrix | null): number => {
    if (!ocs) return rotation;
    const rad = rotation * Math.PI / 180;
    const lx = Math.cos(rad);
    const ly = Math.sin(rad);
    const wx = lx * ocs.Ax.x + ly * ocs.Ay.x;
    const wy = lx * ocs.Ax.y + ly * ocs.Ay.y;
    return Math.atan2(wy, wx) * 180 / Math.PI;
};

/** 计算 OCS X/Y 轴的二维行列式符号（用于镜像检测）。 */
export const getOcsDeterminant2D = (ocs: OcsMatrix | null): number => {
    if (!ocs) return 1;
    return ocs.Ax.x * ocs.Ay.y - ocs.Ax.y * ocs.Ay.x;
};
