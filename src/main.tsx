import React from 'react';
import ReactDOM from 'react-dom/client';
import AppShell from './app/AppShell';

const rootElement = document.getElementById('root');

if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <AppShell />
    </React.StrictMode>,
  );
}
