import LoaderWorker from './dxfLoader.worker?worker&inline';

/** 独立懒加载 chunk 中创建 Worker，避免宿主构建遗漏外部 Worker 资源。 */
export const createDxfLoaderWorker = (): Worker => new LoaderWorker();
