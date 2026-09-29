import { defineConfig, loadEnv } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

// The released game version lives in the root package.json (frontend/package.json
// is a workspace stub). Exposed to client code as __APP_VERSION__.
const rootPackage = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')
);

const STATIC_ASSET_EXTENSION_PATTERN =
  /\.(png|jpg|jpeg|gif|svg|webp|mp3|ogg|wav|json)$/i;

export function isStaticAssetRequest(requestUrl) {
  if (typeof requestUrl !== 'string') return false;
  try {
    return STATIC_ASSET_EXTENSION_PATTERN.test(
      new URL(requestUrl, 'http://localhost').pathname
    );
  } catch {
    return false;
  }
}

export default defineConfig(({ mode }) => {
  const projectRoot = fileURLToPath(new URL('..', import.meta.url));
  const env = loadEnv(mode, projectRoot, ['VITE_', 'PORT']);
  const apiTarget = env.VITE_API_TARGET || `http://localhost:${env.PORT || 3000}`;

  return {
    root: '.',
    publicDir: 'public',
    define: {
      __APP_VERSION__: JSON.stringify(rootPackage.version)
    },
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
            // Classify only the request pathname. Query values can legitimately
            // name JSON artifacts while the requested resource is still HTML.
            if (isStaticAssetRequest(req.url)) {
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
