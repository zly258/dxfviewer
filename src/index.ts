// 库入口主动引入统一样式，构建时会抽取为样式文件。
import './styles/index.css';

import type { DxfWorkspaceProps } from '@/components/workspace/DxfWorkspace';

export { default as DxfViewer } from '@/components/viewer/DxfViewer';
export { default as DxfWorkspace } from '@/components/workspace/DxfWorkspace';

// 保留旧版公开 API，避免外部示例和既有业务项目升级后失效。
export { default as AppShell } from '@/components/workspace/DxfWorkspace';
export { default as DxfViewerMain } from '@/components/viewer/DxfViewer';
export { default as DxfViewerApp } from '@/components/workspace/DxfWorkspace';

export type { DxfViewerProps } from '@/components/viewer/DxfViewer';
export type { DxfWorkspaceProps } from '@/components/workspace/DxfWorkspace';
export type { DxfTabSource } from '@/components/workspace/DxfTabs';
export type AppShellProps = DxfWorkspaceProps;

export { parseDxf } from '@/core/parser';

export type {
  AnyEntity,
  CanvasTheme,
  DxfBlock,
  DxfData,
  DxfLayer,
  DxfLayout,
  DxfLineType,
  DxfStyle,
  DrawingColorMode,
  Point2D,
  ResolvedUiTheme,
  UiTheme,
  ViewPort,
} from '@/types';
