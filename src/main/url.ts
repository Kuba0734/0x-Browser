export const INTERNAL_SCHEME = 'ox'
export const INTERNAL_PREFIX = `${INTERNAL_SCHEME}://`
export const HOME_URL = `${INTERNAL_PREFIX}home/`
export const INTERNAL_PAGES = [
  'home',
  'bookmarks',
  'downloads',
  'settings',
  'extensions',
  'performance'
]

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i
const DOMAIN = /^([a-z0-9-]+\.)+([a-z]{2,}|xn--[a-z0-9-]+)(:\d+)?$/i
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/
const INTERNAL_INPUT = /^(0x|ox):\/\/([a-z]+)\/?$/i

export function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

export function isInternalUrl(url: string): boolean {
  return url.startsWith(INTERNAL_PREFIX)
}

export function internalUrl(page: string): string | null {
  return INTERNAL_PAGES.includes(page) ? `${INTERNAL_PREFIX}${page}/` : null
}

export function resolveInput(input: string, searchUrl: string): string | null {
  const text = input.trim()
  if (!text) return null
  const internal = INTERNAL_INPUT.exec(text)
  if (internal)
    return internalUrl(internal[2].toLowerCase()) ?? searchUrl + encodeURIComponent(text)
  if (/^https?:\/\//i.test(text))
    return isWebUrl(text) ? text : searchUrl + encodeURIComponent(text)
  if (!/\s/.test(text)) {
    const host = text.split(/[/?#]/)[0]
    if (LOCAL_HOST.test(host)) return `http://${text}`
    if (DOMAIN.test(host) || IPV4.test(host)) {
      const url = `https://${text}`
      if (isWebUrl(url)) return url
    }
  }
  return searchUrl + encodeURIComponent(text)
}
