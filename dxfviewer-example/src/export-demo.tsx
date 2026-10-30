/**
 * 导出效果演示页（开发辅助，不影响主入口 index.html）。
 *
 * 左侧：DxfViewer 打开本地 DXF（FilePicker / 拖拽）；右侧：四个按钮分别触发
 * PNG / 栅格 PDF / 矢量 PDF / SVG 导出，产物内联展示与下载。
 * 另提供「写出 DXF」把当前数据 writeDxf 回放，可与原文件对比。
 */
import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { DxfViewer } from '@zhangly1403/dxfviewer';
import {
  exportPng,
  exportPdf,
  exportPdfVector,
  exportSvg,
} from '@zhangly1403/dxfviewer/export';
import { writeDxf } from '@zhangly1403/dxfviewer/writer';
import '@zhangly1403/dxfviewer/style.css';
import './styles.css';

type Artifact = { name: string; url: string; kind: 'image' | 'pdf' | 'text' | 'dxf' };

const App = () => {
  const [file, setFile] = useState<File | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [dxfPreview, setDxfPreview] = useState<string | null>(null);
  const [status, setStatus] = useState('先打开一个本地 .dxf 文件，加载后即可导出');

  const track = async (name: string, task: () => Promise<Artifact>): Promise<void> => {
    setBusy(name);
    setStatus(`${name} 导出中…`);
    try {
      const artifact = await task();
      setArtifacts(previous => [artifact, ...previous].slice(0, 6));
      setStatus(`${name} 完成`);
    } catch (error) {
      setStatus(`${name} 失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(null);
    }
  };

  const makeArtifact = async (name: string, blob: Blob, kind: Artifact['kind']): Promise<Artifact> =>
    ({ name, kind, url: URL.createObjectURL(blob) });

  const [dataRef] = useState<{ current: unknown }>({ current: null });

  const run = (kind: 'png' | 'pdf' | 'vector' | 'svg' | 'dxf') => {
    const data = dataRef.current;
    if (!data) { setStatus('请先等待图纸加载完成'); return; }
    const typed = data as Parameters<typeof exportSvg>[0];

    if (kind === 'png') {
      void track('PNG', async () => {
        const blob = await exportPng(typed, { width: 1280, height: 800, background: 'white' });
        return makeArtifact('export.png（1280×800 白底）', blob, 'image');
      });
    } else if (kind === 'pdf') {
      void track('栅格 PDF', async () => {
        const blob = await exportPdf(typed, { paperSize: 'A4', orientation: 'landscape', marginMm: 8, dpi: 220, title: file?.name });
        return makeArtifact('export-raster.pdf（A4 横向）', blob, 'pdf');
      });
    } else if (kind === 'vector') {
      void track('矢量 PDF', async () => {
        const blob = await exportPdfVector(typed, { paperSize: 'A4', orientation: 'landscape', marginMm: 8, title: file?.name });
        return makeArtifact('export-vector.pdf（几何全矢量）', blob, 'pdf');
      });
    } else if (kind === 'svg') {
      void track('SVG', async () => {
        const svg = exportSvg(typed, { width: 1280, height: 800, background: 'white' });
        return makeArtifact('export.svg（矢量文本）', new Blob([svg], { type: 'image/svg+xml' }), 'text');
      });
    } else {
      void track('写出 DXF', async () => {
        const { content, skipped } = writeDxf(typed);
        setDxfPreview(content);
        setStatus(`写出 DXF 完成：${content.length} 字符，skipped ${skipped.length} 项`
          + (skipped.length ? `（${skipped.slice(0, 2).map(item => item.type).join('、')}…）` : ''));
        return makeArtifact(
          `rebuilt-${file?.name ?? 'drawing.dxf'}`,
          new Blob([content], { type: 'application/dxf' }),
          'dxf',
        );
      });
    }
  };

  const onPickFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    if (!picked) return;
    setFile(picked);
    setArtifacts([]);
    setDxfPreview(null);
    setReloadKey(key => key + 1);
  };

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      {/* 左：查看器 */}
      <div style={{ flex: 1.4, minWidth: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid #ddd' }}>
        <div style={{ padding: '8px 12px', background: '#f5f7fa', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <strong>DXF 导出演示</strong>
          <label style={{ fontSize: 13 }}>
            选择本地 DXF：
            <input
              type="file"
              accept=".dxf"
              onChange={onPickFile}
              style={{ marginLeft: 6 }}
            />
          </label>
          {file && (
            <button
              type="button"
              onClick={() => setReloadKey(key => key + 1)}
              style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #ccc', background: '#fff', cursor: 'pointer' }}
            >
              重新加载
            </button>
          )}
        </div>
        {file ? (
          <DxfViewer
            key={`${file.name}-${reloadKey}`}
            initFile={file}
            fileName={file.name}
            onLoad={loaded => { dataRef.current = loaded; setStatus(`已加载 ${file.name}，可导出`); }}
            onError={error => setStatus(`加载失败：${error.message}`)}
          />
        ) : (
          <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: '#888' }}>
            先选择一个本地 .dxf 文件
          </div>
        )}
      </div>

      {/* 右：导出面板 */}
      <div style={{ flex: 1, minWidth: 360, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
        <div style={{ padding: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, background: '#fafafa' }}>
          {([
            ['png', '导出 PNG'],
            ['svg', '导出 SVG'],
            ['pdf', '栅格 PDF'],
            ['vector', '矢量 PDF'],
            ['dxf', '写出 DXF'],
          ] as const).map(([kind, label]) => (
            <button
              key={kind}
              type="button"
              disabled={busy !== null}
              onClick={() => run(kind)}
              style={{ padding: '10px 8px', borderRadius: 8, border: '1px solid #1677ff', background: '#1677ff', color: '#fff', cursor: busy ? 'wait' : 'pointer' }}
            >
              {busy === null ? label : '导出中…'}
            </button>
          ))}
        </div>
        <div style={{ padding: '6px 12px', color: '#555', fontSize: 13 }}>{status}</div>

        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {artifacts.map((artifact, index) => (
            <div key={`${artifact.name}-${index}`} style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: '#f5f7fa' }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{artifact.name}</span>
                <a href={artifact.url} download={artifact.name.replace(/[（）()]/g, '')} style={{ fontSize: 13 }}>下载</a>
              </div>
              {artifact.kind === 'image' && <img src={artifact.url} alt={artifact.name} style={{ width: '100%', display: 'block', background: '#fff' }} />}
              {artifact.kind === 'pdf' && (
                <object data={artifact.url} type="application/pdf" width="100%" height="320">
                  <a href={artifact.url}>在新窗口打开 PDF</a>
                </object>
              )}
              {artifact.kind === 'text' && <iframe src={artifact.url} title={artifact.name} style={{ width: '100%', height: 320, border: 'none', background: '#fff' }} />}
              {artifact.kind === 'dxf' && <div style={{ padding: 8, fontSize: 12, color: '#666' }}>DXF 已生成，可下载后拖回查看器或用 CAD 打开验证</div>}
            </div>
          ))}
        </div>

        {dxfPreview && (
          <details style={{ margin: '0 12px 12px' }}>
            <summary style={{ cursor: 'pointer', fontSize: 13 }}>查看 writeDxf 输出（前 3000 字符）</summary>
            <pre style={{ maxHeight: 300, overflow: 'auto', background: '#0f172a', color: '#d1e7ff', padding: 10, fontSize: 12, borderRadius: 8 }}>{dxfPreview.slice(0, 3000)}</pre>
          </details>
        )}
      </div>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
