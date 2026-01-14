import React from 'react';
import DxfViewerMain from './DxfViewerMain';

function App() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <DxfViewerMain 
        showOpenMenu={true}
        onError={(err) => console.error('DXF Viewer Error:', err)}
        onLoad={(data) => console.log('DXF Data Loaded:', data)}
      />
    </div>
  );
}

export default App;
