import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  server: {
    port: 8080,
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true
      }
    }
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, '../shared')
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
});
