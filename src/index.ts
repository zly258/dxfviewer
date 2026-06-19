// 库入口主动引入统一样式，库构建时会抽取为 dist/style.css。
import './styles/index.css';

export { default as DxfViewer } from './viewer/DxfViewer';
export { default as AppShell } from './app/AppShell';

// 向后兼容别名（标记为已弃用）
/** @deprecated 请直接使用 `DxfViewer` */
export { default as DxfViewerMain } from './viewer/DxfViewer';
/** @deprecated 请直接使用 `AppShell` */
export { default as DxfViewerApp } from './app/AppShell';

export type { DxfViewerProps } from './viewer/DxfViewer';
export type { AppShellProps } from './app/AppShell';

export { parseDxf } from './core/parser';
export { serializeDxf } from './core/writer';

export type { 
  AnyEntity, 
  ViewPort, 
  DxfLayer, 
  DxfBlock, 
  DxfStyle, 
  DxfLineType, 
  Point2D,
  CanvasTheme,
  UiTheme,
  DrawingColorMode
} from './types';
