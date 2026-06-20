import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const normalizePath = (value: string) => value.replace(/\\/g, '/');

export default defineConfig({
  base: process.env.VITE_BASE_PATH || './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: true,
    sourcemap: false,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const moduleId = normalizePath(id);

          if (moduleId.includes('node_modules/react-dom/')) {
            return 'vendor-react-dom';
          }

          if (moduleId.includes('node_modules/react/')) {
            return 'vendor-react';
          }

          if (moduleId.includes('node_modules/@mlightcad/shx-parser')) {
            return 'vendor-shx';
          }

          if (moduleId.includes('/dist/chunks/viewer-loader-')) {
            return 'viewer-loader';
          }

          if (moduleId.includes('/dist/chunks/viewer-render-')) {
            return 'viewer-render';
          }

          if (moduleId.includes('/dist/chunks/viewer-ui-')) {
            return 'viewer-ui';
          }

          return undefined;
        },
      },
    },
  },
  server: {
    port: 3001,
    host: '0.0.0.0',
  },
  resolve: {
    alias: {
      '@zhangly1403/dxfviewer/style.css': path.resolve(__dirname, '../dist/style.css'),
      '@zhangly1403/dxfviewer': path.resolve(__dirname, '../dist/dxfviewer.js'),
    },
  },
});
