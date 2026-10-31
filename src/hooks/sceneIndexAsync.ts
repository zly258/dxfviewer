import type { AnyEntity } from '@/types';
import { createSceneIndexWorker } from './workerFactory';
import type { SceneIndexBuildResponse } from './sceneIndex.worker';
import type { FlatBvh } from '@/renderer/services/flatBvh';
import {
  collectSceneIndexBuildInput,
  finalizeSceneIndex,
  SceneIndexBuildInput,
} from '@/renderer/services/sceneIndexBuilder';
import type { SceneIndex } from '@/renderer/services/sceneIndex';

/**
 * 场景索引 Worker 编排（hooks 层）。
 *
 * 与 renderer/services/sceneIndexBuilder.ts（纯函数）分离：
 * render 公共入口只引纯函数部分，避免被动内嵌 Worker 代码。
 */

export interface SceneIndexBuildHandle {
  /** 终止后台构建（实体已切换或组件卸载时调用）。 */
  cancel: () => void;
}

/**
 * 异步构建场景索引；完成后通过 onReady 交付，构建期间可 cancel。
 * Worker 失败时由调用方决定回退策略（通常为同步构建）。
 */
export const buildSceneIndexAsync = (
  entities: AnyEntity[],
  onReady: (index: SceneIndex) => void,
  onError?: (error: Error) => void,
): SceneIndexBuildHandle => {
  const input: SceneIndexBuildInput = collectSceneIndexBuildInput(entities);
  const worker = createSceneIndexWorker();
  let settled = false;

  const cancel = () => {
    if (settled) return;
    settled = true;
    worker.terminate();
  };

  worker.onmessage = (e: MessageEvent<SceneIndexBuildResponse>) => {
    if (settled) return;
    const message = e.data;
    if (!message || message.type !== 'built') {
      settled = true;
      worker.terminate();
      onError?.(new Error((message as { error?: string })?.error || 'scene index worker failed'));
      return;
    }
    settled = true;
    worker.terminate();
    const flat: FlatBvh = {
      nodeBounds: message.nodeBounds,
      nodeLeft: message.nodeLeft,
      nodeRight: message.nodeRight,
      leafStart: message.leafStart,
      leafCount: message.leafCount,
      order: message.order,
    };
    onReady(finalizeSceneIndex(entities, input, flat, message.samples));
  };

  worker.onerror = event => {
    if (settled) return;
    settled = true;
    worker.terminate();
    onError?.(new Error(event.message || 'scene index worker error'));
  };

  const buildId = 1;
  worker.postMessage(
    { type: 'build', buildId, bounds: input.bounds, indices: input.indices, splines: input.splines },
    [input.bounds.buffer as ArrayBuffer, input.indices.buffer as ArrayBuffer],
  );

  return { cancel };
};
