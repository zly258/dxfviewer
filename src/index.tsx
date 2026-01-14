import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/styles.css';
import DxfViewerMain from './DxfViewerMain';

// Export for library use
export { DxfViewerMain };
export type { AnyEntity, ViewPort, DxfLayer, DxfBlock, DxfStyle, DxfLineType, Point2D } from './types';

// Default entry point for dev
const rootElement = document.getElementById('root');
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <DxfViewerMain 
        showOpenMenu={true}
        onError={(err) => console.error('DXF Viewer Error:', err)}
        onLoad={(data) => console.log('DXF Data Loaded:', data)}
      />
    </React.StrictMode>
  );
}
