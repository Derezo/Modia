import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig(({ mode }) => {
  const projectRoot = fileURLToPath(new URL('..', import.meta.url));
  const env = loadEnv(mode, projectRoot, ['VITE_', 'PORT']);
  const apiTarget = env.VITE_API_TARGET || `http://localhost:${env.PORT || 3000}`;

  return {
    root: '.',
    publicDir: 'public',
    server: {
      port: Number(env.VITE_FRONTEND_PORT || 8080),
      proxy: {
        '/api': apiTarget,
        '/ws': {
          target: apiTarget,
          ws: true
        }
      }
    },
    resolve: {
      alias: {
        '@shared': fileURLToPath(new URL('../shared', import.meta.url))
      }
    },
    build: {
      outDir: 'dist',
      sourcemap: process.env.NODE_ENV !== 'production'
    },
    // Return 404 for missing static assets instead of SPA fallback
    appType: 'spa',
    plugins: [
      {
        name: 'cache-control-assets',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            // Set long cache duration for static assets
            // Works with Cache API to prevent unnecessary revalidation
            if (req.url?.startsWith('/assets/')) {
              res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            }
            next();
          });
        }
      },
      {
        name: 'return-404-for-missing-assets',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            // Check if request is for a static asset (images, audio, etc.)
            const assetExtensions = /\.(png|jpg|jpeg|gif|svg|webp|mp3|ogg|wav|json)$/i;
            if (assetExtensions.test(req.url)) {
              // Let Vite try to serve it; if it fails, it will 404
              // This middleware ensures we don't fall through to SPA handler for assets
              const originalEnd = res.end;
              res.end = function(...args) {
                // If response is HTML for an asset request, return 404 instead
                if (res.getHeader('content-type')?.includes('text/html') && res.statusCode === 200) {
                  res.statusCode = 404;
                  res.setHeader('content-type', 'text/plain');
                  return originalEnd.call(this, `Asset not found: ${req.url}`);
                }
                return originalEnd.apply(this, args);
              };
            }
            next();
          });
        }
      }
    ]
  };
});
