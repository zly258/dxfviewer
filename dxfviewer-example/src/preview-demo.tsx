/**
 * 极简预览演示（`/preview.html`）。
 *
 * 目的：展示 `DxfPreview` 的接入方式——一个组件、一块画布、无工具栏，
 * 填满父容器即可预览单个图纸文件。全部状态都由宿主自己掌控。
 */
import React, { useCallback, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import type { DxfPreviewHandle } from '@zhangly1403/dxfviewer/preview';
import { DxfPreview } from '@zhangly1403/dxfviewer/preview';
import '@zhangly1403/dxfviewer/style.css';
import './styles.css';

const PAGE: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  background: '#e8ebef',
};

const BAR: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  height: 42,
  padding: '0 12px',
  background: '#ffffff',
  borderBottom: '1px solid #cdd3da',
  font: '12.5px/1 "Microsoft YaHei", Arial, sans-serif',
  color: '#14181d',
  flex: '0 0 auto',
};

const BTN: React.CSSProperties = {
  height: 26,
  padding: '0 10px',
  border: '1px solid #cdd3da',
  borderRadius: 3,
  background: '#ffffff',
  color: '#14181d',
  fontSize: 12.5,
  cursor: 'pointer',
};

function PreviewDemo() {
  const previewRef = useRef<DxfPreviewHandle>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | undefined>(undefined);
  const [dark, setDark] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback(() => inputRef.current?.click(), []);
  const onPick = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    event.target.value = '';
    if (!picked) return;
    setError(null);
    setFile(picked);
  }, []);

  return (
    <div style={PAGE}>
      <div style={BAR}>
        <strong style={{ fontSize: 13 }}>DxfPreview</strong>
        <span style={{ color: '#5c636c' }}>极简单文件预览 · 一个组件一块画布</span>
        <span style={{ flex: 1 }} />
        <input ref={inputRef} type="file" accept=".dxf" onChange={onPick} style={{ display: 'none' }} />
        <button type="button" style={BTN} onClick={open}>打开图纸</button>
        <button type="button" style={BTN} onClick={() => previewRef.current?.fit()} disabled={!file}>适应视图</button>
        <button type="button" style={BTN} onClick={() => setDark(v => !v)}>{dark ? '浅色' : '深色'}</button>
      </div>
      <div style={{ flex: '1 1 auto', minHeight: 0, position: 'relative' }}>
        {!file && (
          <div
            style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
              justifyContent: 'center', color: '#5c636c', font: '13px/1.6 "Microsoft YaHei", Arial, sans-serif',
              textAlign: 'center', pointerEvents: 'none',
            }}
          >
            <div>
              尚未选择图纸<br />
              <span style={{ fontSize: 12 }}>点击「打开图纸」，或直接把文件拖到窗口内</span>
            </div>
          </div>
        )}
        <DxfPreview
          ref={previewRef}
          src={file}
          theme={dark ? 'dark' : 'light'}
          interactive
          onError={err => setError(err.message)}
        />
        {error && (
          <div style={{ position: 'absolute', left: 12, bottom: 12, color: '#b3261e', font: '12px/1.5 "Microsoft YaHei", Arial, sans-serif' }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

const root = document.getElementById('root');
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <PreviewDemo />
    </React.StrictMode>,
  );
}