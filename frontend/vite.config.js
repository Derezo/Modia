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
});
