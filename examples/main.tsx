import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import DxfViewerMain from '../src/DxfViewerMain';
import '../src/styles/styles.css';

const App: React.FC = () => {
    const [lang, setLang] = useState<'zh' | 'en'>('zh');

    const t = {
        title: lang === 'zh' ? 'DXF 浏览器' : 'DXF Viewer',
        langZh: '中文',
        langEn: 'English',
        hint: lang === 'zh' ? '支持拖拽本地文件至浏览器' : 'Drag local files to browser'
    };

    const containerStyle: React.CSSProperties = {
        display: 'flex',
        flexDirection: 'column',
        width: '100vw',
        height: '100vh',
        backgroundColor: '#1e1e1e',
        color: '#fff',
        fontFamily: '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    };

    const headerStyle: React.CSSProperties = {
        height: '50px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#2d2d2d',
        borderBottom: '1px solid #3d3d3d',
        zIndex: 1000,
        padding: '0 20px'
    };

    const buttonStyle = (active: boolean): React.CSSProperties => ({
        padding: '6px 16px',
        borderRadius: '4px',
        border: 'none',
        backgroundColor: active ? '#007acc' : '#3d3d3d',
        color: '#fff',
        cursor: 'pointer',
        fontSize: '13px',
        fontWeight: active ? 'bold' : 'normal',
        transition: 'background-color 0.2s'
    });

    return (
        <div style={containerStyle}>
            <div style={headerStyle}>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#007acc', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span>{t.title}</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                    <div style={{ fontSize: '12px', color: '#888' }}>
                        {t.hint}
                    </div>
                    <div style={{ display: 'flex', backgroundColor: '#1e1e1e', borderRadius: '6px', padding: '3px', gap: '2px' }}>
                        <button
                            style={buttonStyle(lang === 'zh')}
                            onClick={() => setLang('zh')}
                        >
                            {t.langZh}
                        </button>
                        <button
                            style={buttonStyle(lang === 'en')}
                            onClick={() => setLang('en')}
                        >
                            {t.langEn}
                        </button>
                    </div>
                </div>
            </div>
            
            <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <DxfViewerMain 
                    lang={lang}
                    onLanguageChange={(l) => setLang(l === 'zh' ? 'zh' : 'en')}
                    showOpenMenu={true}
                />
            </div>
        </div>
    );
};

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
