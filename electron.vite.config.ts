import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    root: 'src/ui',
    build: { rolldownOptions: { input: resolve('src/ui/index.html') } }
  }
})
