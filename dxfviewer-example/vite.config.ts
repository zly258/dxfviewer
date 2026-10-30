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
      // 子入口必须列在主入口之前（Vite 对象别名按声明序精确匹配）
      '@zhangly1403/dxfviewer/parser': path.resolve(__dirname, '../dist/parser.js'),
      '@zhangly1403/dxfviewer/writer': path.resolve(__dirname, '../dist/writer.js'),
      '@zhangly1403/dxfviewer/render': path.resolve(__dirname, '../dist/render.js'),
      '@zhangly1403/dxfviewer/export': path.resolve(__dirname, '../dist/export.js'),
      '@zhangly1403/dxfviewer': path.resolve(__dirname, '../dist/dxfviewer.js'),
    },
  },
});
