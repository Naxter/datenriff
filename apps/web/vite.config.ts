import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Once a real dataset exists, the 3.4M-cell synthetic r9 tiles are only
 *  dead weight in the deploy (72 MB, ~1800 files). Drop them from the
 *  build; the demo's country LOD stays as the offline fallback. */
function dropDemoTiles(): Plugin {
  const realData = existsSync(
    fileURLToPath(new URL('./public/data/zensus/dataset.json', import.meta.url)),
  );
  return {
    name: 'drop-demo-tiles',
    apply: 'build',
    // public/ assets are copied verbatim, so pruning has to happen after
    // the bundle is written; the manifest loses the tiled LOD to match
    async closeBundle() {
      if (!realData) return;
      const { rm, readFile, writeFile } = await import('node:fs/promises');
      const dist = (p: string) => fileURLToPath(new URL(`./dist/${p}`, import.meta.url));
      await rm(dist('data/demo/r9'), { recursive: true, force: true });
      const manifestPath = dist('data/manifest.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      for (const dataset of manifest.datasets ?? []) {
        if (dataset.id === 'zensus_demo') {
          dataset.lods = dataset.lods.filter((l: { tileIndex?: string }) => !l.tileIndex);
        }
      }
      await writeFile(manifestPath, JSON.stringify(manifest));
    },
  };
}

const pkg = (name: string) =>
  fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  plugins: [react(), dropDemoTiles()],
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
