import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import DxfViewerMain from '../src/DxfViewerMain';
import '../src/styles/styles.css';

const ExampleApp = () => {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (error) {
    return (
      <div style={{ padding: '20px', color: 'red', textAlign: 'center' }}>
        <h3>错误: {error}</h3>
        <p>请按照以下步骤操作：</p>
        <ol style={{ display: 'inline-block', textAlign: 'left' }}>
          <li>运行 <code>npm run example</code> 启动</li>
          <li>刷新此页面</li>
        </ol>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'sans-serif', overflow: 'hidden' }}>
      <div style={{ 
        padding: '0 15px', 
        height: '40px',
        display: 'flex',
        alignItems: 'center',
        background: '#f8f9fa', 
        borderBottom: '1px solid #dee2e6',
        boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
        zIndex: 10
      }}>
        <div style={{ fontSize: '13px', fontWeight: 'bold', display: 'flex', gap: '20px' }}>
          <span>标题: DXF Viewer</span>
          <span>作者: zhangly1403</span>
        </div>
      </div>
      <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <DxfViewerMain 
          initFile={selectedFile ? `/dxf/${encodeURIComponent(selectedFile)}` : undefined} 
          showOpenMenu={true}
        />
      </div>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(<ExampleApp />);
