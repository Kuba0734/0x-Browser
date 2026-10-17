import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, net, protocol } from 'electron'
import { INTERNAL_PAGES, INTERNAL_SCHEME } from './url'

protocol.registerSchemesAsPrivileged([
  { scheme: INTERNAL_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

export const devServerUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
const rendererDir = join(__dirname, '../renderer')

export function rendererUrl(page: string): string {
  return devServerUrl
    ? `${devServerUrl}/${page}`
    : pathToFileURL(join(rendererDir, page)).toString()
}

export function registerInternalProtocol(): void {
  protocol.handle(INTERNAL_SCHEME, async (request) => {
    const { host, pathname } = new URL(request.url)
    if (!INTERNAL_PAGES.includes(host)) return new Response('Not found', { status: 404 })
    const path =
      pathname === '/' ? `pages/${host}/index.html` : decodeURIComponent(pathname.slice(1))
    let response: Response
    if (devServerUrl) {
      response = await net.fetch(`${devServerUrl}/${path}`)
    } else {
      const file = resolve(rendererDir, path)
      if (!file.startsWith(rendererDir + sep)) return new Response('Not found', { status: 404 })
      response = await net.fetch(pathToFileURL(file).toString())
    }
    const headers = new Headers(response.headers)
    // Internal pages must never be framed by web content.
    headers.set('X-Frame-Options', 'DENY')
    return new Response(response.body, { status: response.status, headers })
  })
}
