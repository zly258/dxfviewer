import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import dts from 'vite-plugin-dts';
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const isExample = mode === 'example';

    return {
      base: isExample ? '/dxfviewer/' : '/',
      build: {
        outDir: isExample ? 'dist-example' : 'dist',
        cssCodeSplit: false,
        lib: isExample ? undefined : {
          entry: path.resolve(__dirname, 'src/index.tsx'),
          name: 'DxfViewer',
          fileName: (format) => `dxfviewer.${format}.js`,
          formats: ['es', 'umd']
        },
        minify: 'terser',
        rollupOptions: {
          external: isExample ? [] : ['react', 'react-dom'],
          output: isExample ? {} : {
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
        !isExample && dts({ 
          rollupTypes: true,
          insertTypesEntry: true,
          include: ['src/**/*.ts', 'src/**/*.tsx'],
          exclude: ['src/main.tsx', 'src/App.tsx']
        })
      ].filter(Boolean),
      resolve: {
        alias: {
          '@': path.resolve(__dirname, './src'),
        }
      }
    };
});
