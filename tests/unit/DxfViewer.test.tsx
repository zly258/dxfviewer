/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DxfViewer from '@/components/viewer/DxfViewer';
import { DxfLoadResult, EntityType } from '@/types';

const loaderMocks = vi.hoisted(() => ({
  loadFromUrl: vi.fn(),
  loadFromFile: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock('@/hooks/useDxfLoader', () => ({
  isAbortError: (error: unknown) => error instanceof Error && error.name === 'AbortError',
  useDxfLoader: () => ({
    isLoading: false,
    loadingProgress: 0,
    loadingFileName: '',
    loadFromUrl: loaderMocks.loadFromUrl,
    loadFromFile: loaderMocks.loadFromFile,
    cancel: loaderMocks.cancel,
  }),
}));

vi.mock('@/components/viewer/CanvasViewer', () => ({
  default: () => <div data-testid="canvas-viewer" />,
}));

const entity = {
  id: 'line-1',
  type: EntityType.LINE,
  layer: '0',
  start: { x: 0, y: 0 },
  end: { x: 10, y: 10 },
  extents: { min: { x: 0, y: 0 }, max: { x: 10, y: 10 } },
} as const;

const loadResult: DxfLoadResult = {
  sourceFormat: 'ascii',
  data: {
    entities: [entity],
    layouts: [{
      id: 'Model',
      name: 'Model',
      displayName: 'Model',
      isModel: true,
      entities: [entity],
      extents: { center: { x: 5, y: 5 }, width: 10, height: 10, min: { x: 0, y: 0 }, max: { x: 10, y: 10 } },
    }],
    activeLayoutName: 'Model',
    layers: { 0: { name: '0', color: 7, isVisible: true } },
    blocks: {},
    styles: {},
    lineTypes: {},
  },
};

describe('DxfViewer loading lifecycle', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    loaderMocks.loadFromUrl.mockReset().mockResolvedValue(loadResult);
    loaderMocks.loadFromFile.mockReset().mockResolvedValue(loadResult);
    loaderMocks.cancel.mockReset();
    localStorage.setItem('dxfviewer.uiSettings.v1', JSON.stringify({ showLayerPanel: false, showProperties: false }));
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    });
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0),
    });
    Object.defineProperty(window, 'cancelAnimationFrame', {
      configurable: true,
      value: (id: number) => window.clearTimeout(id),
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    localStorage.clear();
  });

  it('loads one initFile exactly once', async () => {
    await act(async () => {
      root.render(<DxfViewer initFile="/drawing.dxf" fileName="drawing.dxf" showOpenMenu={false} />);
      await new Promise(resolve => setTimeout(resolve, 20));
    });

    expect(loaderMocks.loadFromUrl).toHaveBeenCalledTimes(1);
    expect(loaderMocks.loadFromUrl).toHaveBeenCalledWith('/drawing.dxf', 'drawing.dxf');
  });

  it('does not load while inactive and starts once when activated', async () => {
    await act(async () => {
      root.render(<DxfViewer active={false} initFile="/drawing.dxf" showOpenMenu={false} />);
      await Promise.resolve();
    });
    expect(loaderMocks.loadFromUrl).not.toHaveBeenCalled();

    await act(async () => {
      root.render(<DxfViewer active initFile="/drawing.dxf" showOpenMenu={false} />);
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    expect(loaderMocks.loadFromUrl).toHaveBeenCalledTimes(1);
  });
});
