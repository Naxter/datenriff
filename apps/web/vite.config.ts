import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkg = (name: string) =>
  fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

/** Serve public/<page>/index.html for /<page>/ in dev.
 *  Cloudflare Pages resolves directory indexes on its own, but Vite's SPA
 *  fallback answers first, so the standing pages would only be reachable in
 *  production — exactly the kind of difference that is found too late. */
function standingPages(): Plugin {
  return {
    name: 'datenriff-standing-pages',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0] ?? '';
        // only plain slug segments: a path with dots or percent-escapes
        // could walk out of public/ and must fall through to Vite instead
        if (!/^\/(?:[\w-]+\/)+$/.test(path) || path === '/') return next();
        const file = fileURLToPath(new URL(`./public${path}index.html`, import.meta.url));
        if (!existsSync(file)) return next();
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(readFileSync(file));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), standingPages()],
  resolve: {
    // Workspace packages resolve to TypeScript source — no package build step
    // needed for dev; Vite/esbuild transpile them together with the app.
    alias: {
      '@datenriff/data-contracts': pkg('data-contracts'),
      '@datenriff/color-scales': pkg('color-scales'),
      '@datenriff/sculpture-core': pkg('sculpture-core'),
    },
    // npm splits luma/deck between the workspace root and apps/web; two
    // physical copies break `instanceof` checks inside luma ("texture value")
    dedupe: [
      '@deck.gl/core',
      '@deck.gl/layers',
      '@deck.gl/react',
      '@luma.gl/core',
      '@luma.gl/engine',
      '@luma.gl/webgl',
      '@luma.gl/shadertools',
      '@luma.gl/constants',
    ],
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
});
