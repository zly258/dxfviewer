import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
