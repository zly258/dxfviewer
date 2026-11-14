/**
 * 三维网格解析：POLYLINE 多面网格（PFACE）与 MESH 实体。
 *
 * 这两类是 DXF 中最常见、也是本库此前缺失的三维模型载体：
 * - PFACE：`POLYLINE`（组码 70 含 bit6=64）→ 若干 `VERTEX`：
 *   · 顶点记录：70 = 192（64|128），坐标在 10/20/30；
 *   · 面记录：70 = 128（仅 bit7），顶点索引在 10/20/30/40…（1 基，0 = 无效位）；
 * - MESH：`MESH` 实体（92 顶点数 / 93 面数，10/20/30 顶点坐标，
 *   94 面顶点数 + 90 顶点索引，索引 0 基）。
 *
 * 统一输出 `DxfMesh { vertices: Point3D[], faces: number[][] }`，供渲染端三角化。
 */
import { EntityType, Point3D } from '@/types';
import type { AnyEntity } from '@/types';
import { DxfParserState, applyCommonGroupFrom } from './parserState';

/** PFACE 顶点标志位：bit6(64)=多面网格顶点，bit7(128)=面记录。 */
const PFACE_VERTEX_BIT = 64;
const PFACE_FACE_BIT = 128;

/** 解析 POLYLINE 多面网格（PFACE）。调用方已读到 70 组码并判定为多面网格。 */
export const parsePolyfaceMesh = (state: DxfParserState, common: any): AnyEntity => {
  const vertices: Point3D[] = [];
  const faces: number[][] = [];

  while (state.hasNext) {
    const p = state.peek();
    if (!p) break;
    if (p.code === 0) {
      if (p.value === 'SEQEND') { state.next(); break; }
      if (p.value === 'VERTEX') {
        state.next();
        let flags = 0;
        let x = 0, y = 0, z = 0;
        // 面记录索引在 71/72/73/74…（子类 AcDbFaceRecord，flag 128）；
        // 顶点坐标为 10/20/30（flag 192）。
        const faceIdx: number[] = [];
        while (state.hasNext) {
          const vp = state.peek();
          if (!vp || vp.code === 0) break;
          const vg = state.next()!;
          switch (vg.code) {
            case 70: flags = vg.float | 0; break;
            case 10: x = vg.float; break;
            case 20: y = vg.float; break;
            case 30: z = vg.float; break;
            default:
              if (vg.code >= 71 && vg.code <= 80) faceIdx.push(vg.float);
              break;
          }
        }

        const isFace = (flags & PFACE_FACE_BIT) !== 0 && (flags & PFACE_VERTEX_BIT) === 0;
        if (isFace) {
          const idx = faceIdx.map((n) => (n | 0) - 1).filter((i) => i >= 0);
          if (idx.length >= 3) faces.push(idx);
        } else if ((flags & PFACE_VERTEX_BIT) !== 0) {
          vertices.push({ x, y, z });
        }
        continue;
      }
      break;
    }
    state.next();
  }

  return { ...common, type: EntityType.MESH, vertices, faces };
};

/**
 * 解析 MESH 实体。
 *
 * 组码：
 *  - 92 顶点数、10/20/30 顶点坐标；
 *  - 93 面数；随后每面：94 面顶点数、90 顶点索引（0 基）。
 */
export const parseMesh = (state: DxfParserState, common: any): AnyEntity => {
  const vertices: Point3D[] = [];
  const faces: number[][] = [];
  let current: number[] = [];
  let pendingVertex: { x: number; y: number; z: number } | null = null;
  let expectFaceSize = 0;

  const flushVertex = () => {
    if (pendingVertex) { vertices.push(pendingVertex); pendingVertex = null; }
  };
  const flushFace = () => {
    if (current.length >= 3) faces.push(current);
    current = [];
    expectFaceSize = 0;
  };

  while (state.hasNext) {
    const p = state.peek();
    if (!p || p.code === 0) break;
    const g = state.next()!;
    applyCommonGroupFrom(common, g);
    switch (g.code) {
      case 10: flushVertex(); pendingVertex = { x: g.float, y: 0, z: 0 }; break;
      case 20: if (pendingVertex) pendingVertex.y = g.float; break;
      case 30: if (pendingVertex) pendingVertex.z = g.float; break;
      case 94: flushFace(); expectFaceSize = g.float | 0; break;
      case 90: {
        const idx = g.float | 0;
        if (expectFaceSize > 0) {
          current.push(idx);
          if (current.length >= expectFaceSize) flushFace();
        }
        break;
      }
      default:
        break;
    }
  }
  flushVertex();
  if (current.length >= 3) faces.push(current);

  return { ...common, type: EntityType.MESH, vertices, faces };
};
