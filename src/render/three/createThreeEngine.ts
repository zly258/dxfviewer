/**
 * Three.js 引擎按需加载器。
 *
 * - 动态 import：把 three.js 拆成独立 chunk，首屏不含 three（更快）；
 * - WebGL 能力检测：无 WebGL 时快速失败，由调用方回退 Canvas 2D；
 * - 统一工厂：`createThreeEngine(canvas)` 返回已实现的 InteractiveRenderEngine。
 */
import type { InteractiveRenderEngine } from '@/render/engine';

/** 当前环境是否具备 WebGL（WebGL2 优先，退而求其次 WebGL1）。 */
export const supportsWebGL = (): boolean => {
  try {
    if (typeof document === 'undefined') return false;
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    return !!gl;
  } catch {
    return false;
  }
};

/**
 * 按需创建 Three 渲染引擎。
 * 动态加载 `three` 依赖；若浏览器不支持 WebGL 则抛错，调用方据此回退 Canvas 2D。
 */
export async function createThreeEngine(canvas: HTMLCanvasElement): Promise<InteractiveRenderEngine> {
  if (!supportsWebGL()) {
    throw new Error('当前环境不支持 WebGL，无法启动 Three.js 渲染引擎');
  }
  const mod = await import('./ThreeRenderEngine');
  return new mod.ThreeRenderEngine(canvas);
}
