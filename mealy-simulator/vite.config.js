import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { writeServiceWorker } from './pwa-build.mjs'

/**
 * Emits dist/sw.js with a precache list and a content-hashed version once the
 * bundle is written. Build only — the dev server is left alone so hot reload
 * can never be shadowed by a cached shell.
 */
function pwaServiceWorker() {
  let options = { root: process.cwd(), outDir: 'dist' }
  return {
    name: 'mealy-pwa',
    apply: 'build',
    configResolved(config) {
      options = { root: config.root, outDir: config.build.outDir }
    },
    closeBundle() {
      const { version, files } = writeServiceWorker(options)
      this.info?.(`service worker ${version} · ${files.length} files precached`)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // Relative so the build works both at a domain root and under the
  // /mealy-simulator/ path that GitHub Pages serves project sites from.
  base: './',
  plugins: [vue(), pwaServiceWorker()],
})
