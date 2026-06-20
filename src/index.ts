// 库入口主动引入统一样式，库构建时会抽取为 dist/style.css。
import './styles/index.css';

export { default as DxfViewer } from '@/components/DxfViewer';
export { default as AppShell } from '@/components/app/AppShell';

// 向后兼容别名（标记为已弃用）
/** @deprecated 请直接使用 `DxfViewer` */
export { default as DxfViewerMain } from '@/components/DxfViewer';
/** @deprecated 请直接使用 `AppShell` */
export { default as DxfViewerApp } from '@/components/app/AppShell';

export type { DxfViewerProps } from '@/components/DxfViewer';
export type { AppShellProps } from '@/components/app/AppShell';

export { parseDxf } from '@/core/parser';

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
} from '@/types';
