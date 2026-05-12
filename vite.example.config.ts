import { defineConfig } from 'vite';

export default defineConfig({
  base: '/dxfviewer/',
  build: {
    outDir: 'dist-example',
    emptyOutDir: true
  }
});