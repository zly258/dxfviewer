import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dts from 'vite-plugin-dts';

const libraryEntries = {
  dxfviewer: path.resolve(__dirname, 'src/index.ts'),
  parser: path.resolve(__dirname, 'src/parser.ts'),
};
const isExternalPackage = (id: string) =>
  id === 'react' ||
  id === 'react-dom' ||
  id === 'react-dom/client' ||
  id === 'react/jsx-runtime';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: true,
    sourcemap: false,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 150,
    lib: {
      entry: libraryEntries,
      name: 'DxfViewer',
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
        entryFileNames: chunkInfo => chunkInfo.facadeModuleId?.replace(/\\/g, '/').endsWith('/src/parser.ts')
          ? 'parser.js'
          : 'dxfviewer.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
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
