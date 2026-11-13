// 库入口主动引入统一样式，构建时会抽取为样式文件。
import './ui/styles/index.css';

import type { DxfWorkspaceProps } from '@/ui/components/workspace/DxfWorkspace';

export { default as DxfViewer } from '@/ui/components/viewer/DxfViewer';
export { default as DxfWorkspace } from '@/ui/components/workspace/DxfWorkspace';
// 极简单文件预览组件（无工具栏/面板，便于第三方库嵌入）。
export { default as DxfPreview } from '@/ui/components/preview/DxfPreview';

// 保留旧版公开 API，避免外部示例和既有业务项目升级后失效。
export { default as AppShell } from '@/ui/components/workspace/DxfWorkspace';
export { default as DxfViewerMain } from '@/ui/components/viewer/DxfViewer';
export { default as DxfViewerApp } from '@/ui/components/workspace/DxfWorkspace';

export type { DxfViewerProps } from '@/ui/components/viewer/DxfViewer';
export type { DxfWorkspaceProps } from '@/ui/components/workspace/DxfWorkspace';
export type { DxfPreviewProps, DxfPreviewHandle, DxfPreviewSource } from '@/ui/components/preview/DxfPreview';
export type { DxfOpenSource, DxfTabSource } from '@/ui/components/workspace/drawingDocument';
export type AppShellProps = DxfWorkspaceProps;

export { parseDxf } from '@/io/parser';
export type { EngineKind, InteractiveRenderEngine, EngineSceneOptions, EngineRenderParams } from '@/render/engine';
export { EntityType, ToolMode } from '@/types';
export type * from '@/types';




