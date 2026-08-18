import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const pkg = (name: string) =>
  fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Workspace packages resolve to TypeScript source — no package build step
    // needed for dev; Vite/esbuild transpile them together with the app.
    alias: {
      '@datenriff/data-contracts': pkg('data-contracts'),
      '@datenriff/color-scales': pkg('color-scales'),
      '@datenriff/sculpture-core': pkg('sculpture-core'),
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
});
