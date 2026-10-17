const SEARCH_URL = 'https://www.google.com/search?q='
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i
const DOMAIN = /^([a-z0-9-]+\.)+([a-z]{2,}|xn--[a-z0-9-]+)(:\d+)?$/i
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/

export function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

export function resolveInput(input: string): string | null {
  const text = input.trim()
  if (!text) return null
  if (/^https?:\/\//i.test(text)) return isWebUrl(text) ? text : searchUrl(text)
  if (!/\s/.test(text)) {
    const host = text.split(/[/?#]/)[0]
    if (LOCAL_HOST.test(host)) return `http://${text}`
    if (DOMAIN.test(host) || IPV4.test(host)) {
      const url = `https://${text}`
      if (isWebUrl(url)) return url
    }
  }
  return searchUrl(text)
}

function searchUrl(text: string): string {
  return SEARCH_URL + encodeURIComponent(text)
}
