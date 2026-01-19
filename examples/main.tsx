import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import DxfViewerMain from '../src/DxfViewerMain';
import '../src/styles/styles.css';

const ExampleApp = () => {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 既然去除了 server，我们直接指定 public/dxf 目录下的文件
    // 在实际应用中，可以通过接口获取或直接硬编码
    const availableFiles = ['test.dxf']; 
    setFiles(availableFiles);
    if (availableFiles.length > 0) {
      setSelectedFile(availableFiles[0]);
    }
  }, []);

  if (error) {
    return (
      <div style={{ padding: '20px', color: 'red', textAlign: 'center' }}>
        <h3>错误: {error}</h3>
        <p>请按照以下步骤操作：</p>
        <ol style={{ display: 'inline-block', textAlign: 'left' }}>
          <li>确保在 <code>examples/public/dxf</code> 目录下有 DXF 文件</li>
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
        <label style={{ fontSize: '13px', fontWeight: 'bold', marginRight: '10px' }}>
          示例：从服务器加载 DXF
        </label>
        <select 
          style={{ 
            padding: '4px 8px', 
            borderRadius: '4px', 
            border: '1px solid #ced4da',
            fontSize: '13px',
            outline: 'none'
          }}
          onChange={(e) => setSelectedFile(e.target.value)} 
          value={selectedFile || ''}
        >
          {files.length === 0 && <option>未发现 DXF 文件</option>}
          {files.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <span style={{ marginLeft: '15px', fontSize: '12px', color: '#6c757d' }}>
          文件目录: <code>/examples/public/dxf/</code>
        </span>
      </div>
      <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {selectedFile ? (
          <DxfViewerMain 
            key={selectedFile}
            initFile={`/dxf/${encodeURIComponent(selectedFile)}`} 
            showOpenMenu={true}
          />
        ) : (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#999' }}>
            请在 examples/public/dxf 目录下放入 DXF 文件后刷新
          </div>
        )}
      </div>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(<ExampleApp />);
