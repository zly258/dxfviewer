import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  root: path.resolve(__dirname),
  base: process.env.NODE_ENV === 'production' ? '/dxfviewer/' : '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../src'),
    },
  },
  server: {
    port: 5174,
  },
  build: {
    outDir: path.resolve(__dirname, '../dist-example'),
    emptyOutDir: true,
  },
});
