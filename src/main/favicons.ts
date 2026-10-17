import { net } from 'electron'
import { broadcast } from './ipc'
import { createSaver, readJson } from './store'
import { isWebUrl } from './url'

const FILE = 'favicons.json'
const MAX_BYTES = 64 * 1024
const MAX_ORIGINS = 500

let byOrigin: Record<string, string> = {}
const byUrl = new Map<string, Promise<string | null>>()
const saver = createSaver(FILE, () => byOrigin)

export function loadFavicons(): void {
  byOrigin = readJson<Record<string, string>>(FILE, {})
}

export function flushFavicons(): void {
  saver.flush()
}

export function allFavicons(): Record<string, string> {
  return byOrigin
}

export function cachedFavicon(pageUrl: string): string {
  return isWebUrl(pageUrl) ? (byOrigin[new URL(pageUrl).origin] ?? '') : ''
}

async function download(url: string): Promise<string | null> {
  if (url.startsWith('data:image/')) return url.length <= MAX_BYTES * 1.4 ? url : null
  if (!isWebUrl(url)) return null
  const response = await net.fetch(url)
  if (!response.ok) return null
  const type = (response.headers.get('content-type') ?? '').split(';')[0].trim()
  const mime = type.startsWith('image/')
    ? type
    : type === 'application/octet-stream' || type === ''
      ? 'image/x-icon'
      : null
  if (!mime) return null
  const bytes = Buffer.from(await response.arrayBuffer())
  if (!bytes.length || bytes.length > MAX_BYTES) return null
  return `data:${mime};base64,${bytes.toString('base64')}`
}

function fetchOnce(url: string): Promise<string | null> {
  let pending = byUrl.get(url)
  if (!pending) {
    pending = download(url).catch(() => null)
    byUrl.set(url, pending)
  }
  return pending
}

function remember(origin: string, icon: string): void {
  if (byOrigin[origin] === icon) return
  delete byOrigin[origin]
  byOrigin[origin] = icon
  const origins = Object.keys(byOrigin)
  for (const old of origins.slice(0, Math.max(0, origins.length - MAX_ORIGINS)))
    delete byOrigin[old]
  saver.schedule()
  broadcast('favicons:updated', [origin, icon])
}

export async function resolveFavicon(pageUrl: string, candidates: string[]): Promise<string> {
  if (!isWebUrl(pageUrl)) return ''
  const origin = new URL(pageUrl).origin
  for (const candidate of [...candidates, `${origin}/favicon.ico`]) {
    const icon = await fetchOnce(candidate)
    if (icon) {
      remember(origin, icon)
      return icon
    }
  }
  return ''
}

export function clearFavicons(): void {
  byOrigin = {}
  byUrl.clear()
  saver.schedule()
}
