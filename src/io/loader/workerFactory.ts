import LoaderWorker from './dxfLoader.worker?worker&inline';
import IndexWorker from '@/render/picking/sceneIndex.worker?worker&inline';

/**
 * Worker 工厂：必须静态导入，不要用 `await import('./workerFactory')`。
 *
 * Rollup 打包本库时会把动态导入的内部模块拆成 chunk，并生成
 * `import('./chunk.js').then((ns) => ns.xxx)` 这种命名空间取值写法；
 * 宿主再次构建（Vite/Rollup/Webpack）时，动态导入分析会把该 chunk 的
 * 命名空间包装成 `{ createDxfLoaderWorker }`，而库里的 `.then((ns) => ns.xxx)`
 * 读的还是命名空间上的导出名，于是拿到 undefined，报错：
 *   Cannot destructure property 'createDxfLoaderWorker' of '(intermediate value)' as it is undefined.
 * 静态导入不会产生这种再导出垫片，宿主构建后行为一致。
 */
export const createDxfLoaderWorker = (): Worker => new LoaderWorker();

/** 创建场景索引构建 Worker（BVH + 样条采样在后台线程完成）。 */
export const createSceneIndexWorker = (): Worker => new IndexWorker();
