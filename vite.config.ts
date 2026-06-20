import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dts from 'vite-plugin-dts';

const libraryEntry = path.resolve(__dirname, 'src/index.ts');
const isExternalPackage = (id: string) =>
  id === 'react' ||
  id === 'react-dom' ||
  id === 'react-dom/client' ||
  id === 'react/jsx-runtime';

const normalizePath = (value: string) => value.replace(/\\/g, '/');

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: true,
    sourcemap: false,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 150,
    lib: {
      entry: libraryEntry,
      name: 'DxfViewer',
      fileName: () => 'dxfviewer.js',
      formats: ['es'],
    },
    minify: 'terser',
    terserOptions: {
      module: true,
      toplevel: true,
      compress: {
        passes: 2,
        pure_getters: true,
      },
      mangle: {
        toplevel: true,
      },
      format: {
        comments: false,
      },
    },
    rollupOptions: {
      external: isExternalPackage,
      output: {
        entryFileNames: 'dxfviewer.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        manualChunks(id) {
          const moduleId = normalizePath(id);

          if (moduleId.includes('node_modules/@mlightcad/shx-parser')) {
            return 'vendor-shx';
          }

          if (moduleId.includes('/src/renderer/services/canvasRenderService') || moduleId.includes('/src/core/text/')) {
            return 'viewer-render';
          }

          if (moduleId.includes('/src/utils/')) {
            return 'viewer-loader';
          }

          if (moduleId.includes('/src/components/ui/') || moduleId.includes('/src/components/app/')) {
            return 'viewer-ui';
          }

          return undefined;
        },
        assetFileNames: assetInfo => {
          if (assetInfo.name?.endsWith('.css')) {
            return 'style.css';
          }

          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  plugins: [
    react(),
    dts({
      rollupTypes: true,
      insertTypesEntry: true,
      include: ['src/**/*.ts', 'src/**/*.tsx']
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
