import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import dts from 'vite-plugin-dts';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      build: {
        lib: {
          entry: path.resolve(__dirname, 'src/index.tsx'),
          name: 'DxfViewer',
          fileName: (format) => `dxfviewer.${format}.js`,
          formats: ['es', 'umd']
        },
        minify: false,
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
