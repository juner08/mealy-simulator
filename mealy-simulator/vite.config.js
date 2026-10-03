import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative so the build works both at a domain root and under the
  // /mealy-simulator/ path that GitHub Pages serves project sites from.
  base: './',
  plugins: [vue()],
})
