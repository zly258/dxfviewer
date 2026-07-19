/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDxfLoader } from '@/hooks/useDxfLoader';
import { DxfLoadResult } from '@/types';

interface FakeWorkerInstance {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  terminated: boolean;
  postedMessage?: { requestId: number };
  postMessage(message: { requestId: number }): void;
  terminate(): void;
}

const workerState = vi.hoisted(() => ({ instances: [] as FakeWorkerInstance[] }));

vi.mock('@/hooks/workerFactory', () => ({
  createDxfLoaderWorker: () => new class FakeWorker implements FakeWorkerInstance {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    terminated = false;
    postedMessage?: { requestId: number };

    constructor() {
      workerState.instances.push(this);
    }

    postMessage(message: { requestId: number }) {
      this.postedMessage = message;
    }

    terminate() {
      this.terminated = true;
    }
  }(),
}));

const successData: DxfLoadResult['data'] = {
  entities: [],
  layouts: [],
  activeLayoutName: 'Model',
  layers: {},
  blocks: {},
  styles: {},
  lineTypes: {},
};

describe('useDxfLoader', () => {
  let container: HTMLDivElement;
  let root: Root;
  let loader: ReturnType<typeof useDxfLoader>;
  const onError = vi.fn();

  const Harness = () => {
    loader = useDxfLoader('en', onError);
    return null;
  };

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    workerState.instances.length = 0;
    onError.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<Harness />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('terminates and rejects the previous parse when a newer request starts', async () => {
    let firstPromise!: Promise<DxfLoadResult>;
    let secondPromise!: Promise<DxfLoadResult>;
    await act(async () => {
      firstPromise = loader.processBuffer(new ArrayBuffer(8));
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(workerState.instances).toHaveLength(1);
    const firstOutcome = firstPromise.catch(error => error as Error);
    await act(async () => {
      secondPromise = loader.processBuffer(new ArrayBuffer(8));
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(workerState.instances).toHaveLength(2);
    expect(workerState.instances[0]?.terminated).toBe(true);
    await expect(firstOutcome).resolves.toMatchObject({ name: 'AbortError' });

    const latest = workerState.instances[1]!;
    await act(async () => {
      latest.onmessage?.({
        data: {
          type: 'success',
          requestId: latest.postedMessage!.requestId,
          data: successData,
          sourceFormat: 'ascii',
        },
      } as MessageEvent);
      await secondPromise;
    });
    await expect(secondPromise).resolves.toMatchObject({ sourceFormat: 'ascii' });
  });

  it('reports a worker parse failure exactly once', async () => {
    let promise!: Promise<DxfLoadResult>;
    await act(async () => {
      promise = loader.processBuffer(new ArrayBuffer(8));
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    const outcome = promise.catch(error => error as Error);
    const worker = workerState.instances[0]!;

    await act(async () => {
      worker.onmessage?.({
        data: {
          type: 'error',
          requestId: worker.postedMessage!.requestId,
          error: 'broken',
        },
      } as MessageEvent);
      await outcome;
    });

    await expect(outcome).resolves.toBeInstanceOf(Error);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
