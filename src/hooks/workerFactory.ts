import LoaderWorker from './dxfLoader.worker?worker&inline';
import IndexWorker from './sceneIndex.worker?worker&inline';

/** 独立懒加载 chunk 中创建 Worker，避免宿主构建遗漏外部 Worker 资源。 */
export const createDxfLoaderWorker = (): Worker => new LoaderWorker();

/** 创建场景索引构建 Worker（BVH + 样条采样在后台线程完成）。 */
export const createSceneIndexWorker = (): Worker => new IndexWorker();
