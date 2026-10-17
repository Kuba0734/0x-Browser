import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'

const PAGES = ['home', 'bookmarks', 'downloads', 'settings', 'extensions', 'performance']

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    root: 'src',
    build: {
      rolldownOptions: {
        input: {
          ui: resolve('src/ui/index.html'),
          splash: resolve('src/splash/index.html'),
          ...Object.fromEntries(
            PAGES.map((page) => [page, resolve(`src/pages/${page}/index.html`)])
          )
        }
      }
    }
  }
})
