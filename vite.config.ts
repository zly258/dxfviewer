import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dts from 'vite-plugin-dts';

const libraryEntries = {
  dxfviewer: path.resolve(__dirname, 'src/index.ts'),
  parser: path.resolve(__dirname, 'src/parser.ts'),
  writer: path.resolve(__dirname, 'src/writer.ts'),
  render: path.resolve(__dirname, 'src/render.ts'),
  export: path.resolve(__dirname, 'src/export.ts'),
};

/** 入口 → 产物文件名。新增入口时同步维护，避免全部落到 dxfviewer.js。 */
const ENTRY_FILE_NAMES: Record<string, string> = {
  '/src/parser.ts': 'parser.js',
  '/src/writer.ts': 'writer.js',
  '/src/render.ts': 'render.js',
  '/src/export.ts': 'export.js',
};

const resolveEntryFileName = (facadeModuleId?: string): string => {
  const normalized = facadeModuleId?.replace(/\\/g, '/') ?? '';
  for (const [suffix, fileName] of Object.entries(ENTRY_FILE_NAMES)) {
    if (normalized.endsWith(suffix)) return fileName;
  }
  return 'dxfviewer.js';
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
        entryFileNames: chunkInfo => resolveEntryFileName(chunkInfo.facadeModuleId),
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
