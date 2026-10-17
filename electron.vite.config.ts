import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'

const PAGES = ['home', 'bookmarks', 'downloads', 'settings', 'extensions', 'performance']

export default defineConfig({
  main: {},
  preload: {
    build: {
      rolldownOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          extension: resolve('src/preload/extension.ts')
        }
      }
    }
  },
  renderer: {
    root: 'src',
    build: {
      rolldownOptions: {
        input: {
          ui: resolve('src/ui/index.html'),
          splash: resolve('src/splash/index.html'),
          suggest: resolve('src/suggest/index.html'),
          prompt: resolve('src/prompt/index.html'),
          ...Object.fromEntries(
            PAGES.map((page) => [page, resolve(`src/pages/${page}/index.html`)])
          )
        }
      }
    }
  }
})
