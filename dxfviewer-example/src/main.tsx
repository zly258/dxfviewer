import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppShell } from '@zhangly1403/dxfviewer';
import '@zhangly1403/dxfviewer/style.css';
import './styles.css';

const rootElement = document.getElementById('root');

if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <AppShell />
    </React.StrictMode>,
  );
}
