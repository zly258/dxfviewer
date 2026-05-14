// 库入口主动引入统一样式，库构建时会抽取为 dist/style.css。
import './styles/index.css';

export { default as DxfViewer } from './viewer/DxfViewer';
export { default as DxfViewerMain } from './viewer/DxfViewer';
export { default as AppShell } from './app/AppShell';
export { default as DxfViewerApp } from './app/AppShell';
export type { DxfViewerProps } from './viewer/DxfViewer';
export type { AppShellProps } from './app/AppShell';
export type { AnyEntity, ViewPort, DxfLayer, DxfBlock, DxfStyle, DxfLineType, Point2D } from './types';
