import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig(({ mode }) => {
  const projectRoot = fileURLToPath(new URL('..', import.meta.url));
  const env = loadEnv(mode, projectRoot, ['VITE_', 'PORT']);
  const apiTarget = env.VITE_API_TARGET || `http://localhost:${env.PORT || 3000}`;
  const frontendTarget = `http://localhost:${env.VITE_FRONTEND_PORT || 8080}`;

  return {
    plugins: [react()],
    root: '.',
    publicDir: 'public',
    server: {
      port: Number(env.VITE_ADMIN_PORT || 8081),
      proxy: {
        '/api': apiTarget,
        '/ws': {
          target: apiTarget,
          ws: true,
          changeOrigin: true
        },
        // Proxy asset requests to the frontend dev server
        '/assets': frontendTarget
      }
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@shared': fileURLToPath(new URL('../shared', import.meta.url))
      }
    },
    build: {
      outDir: 'dist',
      sourcemap: process.env.NODE_ENV !== 'production'
    }
  };
});
