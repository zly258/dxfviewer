import React from 'react';
import ReactDOM from 'react-dom/client';
import DxfViewerMain from './features/dxf-viewer/DxfViewerMain';
import App from './app/App';

export { DxfViewerMain };
export type { AnyEntity, ViewPort, DxfLayer, DxfBlock, DxfStyle, DxfLineType, Point2D } from './types';

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
