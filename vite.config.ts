import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import dts from 'vite-plugin-dts';
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      build: {
        cssCodeSplit: false,
        lib: {
          entry: path.resolve(__dirname, 'src/index.tsx'),
          name: 'DxfViewer',
          fileName: (format) => `dxfviewer.${format}.js`,
          formats: ['es', 'umd']
        },
        minify: 'terser',
        rollupOptions: {
          external: ['react', 'react-dom'],
          output: {
            globals: {
              react: 'React',
              'react-dom': 'ReactDOM'
            }
          }
        }
      },
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        react(),
        cssInjectedByJsPlugin(),
        dts({ 
          rollupTypes: true,
          insertTypesEntry: true,
          include: ['src/**/*.ts', 'src/**/*.tsx'],
          exclude: ['src/main.tsx', 'src/App.tsx']
        })
      ],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, './src'),
        }
      }
    };
});
