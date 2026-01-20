import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/styles.css';
import DxfViewerMain from './DxfViewerMain';
import App from './App';

// 作为库使用时的导出
export { DxfViewerMain };
export type { AnyEntity, ViewPort, DxfLayer, DxfBlock, DxfStyle, DxfLineType, Point2D } from './types';

// 开发环境的默认入口点
const rootElement = document.getElementById('root');
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
