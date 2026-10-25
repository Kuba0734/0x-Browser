import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { promisify } from 'node:util'
import { BrowserWindow, dialog, net, session, webContents } from 'electron'
import type { ExtensionInfo } from '../shared/types'
import { storePackageUrl, storeTarget } from '../shared/stores'
import { crxId, crxPublicKeys, crxToZip, extensionId } from './crx'
import { broadcast } from './ipc'
import { log } from './logger'
import { dataPath, readJson, writeJson } from './store'

type Installed = { id: string; dir: string; enabled: boolean; pinned?: boolean }
type Manifest = Record<string, unknown> & {
  name?: string
  version?: string
  description?: string
  default_locale?: string
  icons?: Record<string, string>
  action?: { default_popup?: string }
  browser_action?: { default_popup?: string }
  options_page?: string
  options_ui?: { page?: string }
  permissions?: unknown[]
}

const FILE = 'extensions.json'
const TAR = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
const extensions = () => session.defaultSession.extensions
let installed: Installed[] = []
const changeListeners: (() => void)[] = []

function save(): void {
  writeJson(FILE, installed)
  broadcast('extensions:changed', listExtensions())
  for (const listener of changeListeners) listener()
}

export function onExtensionsChange(listener: () => void): void {
  changeListeners.push(listener)
}

function readManifest(dir: string): Manifest {
  return JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8').replace(/^\uFEFF/, ''))
}

function localize(dir: string, manifest: Manifest, value = ''): string {
  const match = /^__MSG_(\w+)__$/.exec(value)
  if (!match) return value
  try {
    const file = join(dir, '_locales', manifest.default_locale ?? 'en', 'messages.json')
    const messages = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
    const key = Object.keys(messages).find((name) => name.toLowerCase() === match[1].toLowerCase())
    return key ? messages[key].message : value
  } catch {
    return value
  }
}

function iconDataUrl(dir: string, icons: Record<string, string> = {}): string {
  const largest = Object.entries(icons).sort(([a], [b]) => Number(b) - Number(a))[0]
  if (!largest) return ''
  try {
    const file = join(dir, largest[1])
    const mime = extname(file).toLowerCase() === '.svg' ? 'image/svg+xml' : 'image/png'
    return `data:${mime};base64,${readFileSync(file).toString('base64')}`
  } catch {
    return ''
  }
}

function info(entry: Installed): ExtensionInfo {
  const manifest = readManifest(entry.dir)
  const options = manifest.options_ui?.page ?? manifest.options_page
  return {
    id: entry.id,
    name: localize(entry.dir, manifest, manifest.name) || 'Unnamed extension',
    version: manifest.version ?? '',
    description: localize(entry.dir, manifest, manifest.description),
    enabled: entry.enabled,
    pinned: !!entry.pinned,
    icon: iconDataUrl(entry.dir, manifest.icons),
    hasPopup: !!(manifest.action?.default_popup ?? manifest.browser_action?.default_popup),
    optionsUrl: options ? `chrome-extension://${entry.id}/${options.replace(/^\//, '')}` : ''
  }
}

export function listExtensions(): ExtensionInfo[] {
  return installed.flatMap((entry) => {
    try {
      return [info(entry)]
    } catch {
      return []
    }
  })
}

async function activate(entry: Installed): Promise<void> {
  const extension = await extensions().loadExtension(entry.dir, { allowFileAccess: false })
  entry.id = extension.id
}

export async function loadExtensions(): Promise<void> {
  installed = readJson<Installed[]>(FILE, [])
  for (const entry of installed.filter((item) => item.enabled)) {
    await activate(entry).catch((error: Error) =>
      log('error', 'extensions', `Extension failed to load: ${error.message}`)
    )
  }
}

async function install(dir: string): Promise<ExtensionInfo> {
  readManifest(dir)
  const entry: Installed = { id: '', dir, enabled: true }
  try {
    await activate(entry)
  } catch (error) {
    rmSync(dir, { recursive: true, force: true })
    throw error
  }
  const previous = installed.find((item) => item.id === entry.id)
  if (previous) {
    installed = installed.filter((item) => item !== previous)
    if (previous.dir !== dir) rmSync(previous.dir, { recursive: true, force: true })
  }
  installed.push(entry)
  save()
  return info(entry)
}

export async function installFromFolder(win: BrowserWindow): Promise<ExtensionInfo | null> {
  const result = await dialog.showOpenDialog(win, {
    title: 'Select extension folder',
    properties: ['openDirectory']
  })
  const source = result.filePaths[0]
  if (result.canceled || !source) return null
  if (!existsSync(join(source, 'manifest.json')))
    throw new Error('The selected folder has no manifest.json')
  // The ID of an unpacked extension derives from its path, so a stable folder per source keeps the
  // ID (and the extension's stored data) across reinstalls.
  const hash = createHash('sha256').update(source.toLowerCase()).digest('hex').slice(0, 16)
  const dir = join(dataPath('extensions'), `local-${hash}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  cpSync(source, dir, { recursive: true })
  return install(dir)
}

export async function installFromStore(input: string): Promise<ExtensionInfo> {
  const target = storeTarget(input)
  if (!target) throw new Error('Enter a Chrome Web Store, Edge Add-ons or Opera add-ons link')
  const response = await net.fetch(storePackageUrl(target, process.versions.chrome))
  if (!response.ok) throw new Error('Extension could not be downloaded')
  const crx = Buffer.from(await response.arrayBuffer())
  const zip = crxToZip(crx)
  const id = crxId(crx) ?? target.key
  const root = dataPath('extensions')
  const dir = join(root, `${id}-${randomUUID()}`)
  const zipPath = `${dir}.zip`
  mkdirSync(dir, { recursive: true })
  writeFileSync(zipPath, zip)
  try {
    // Windows bsdtar refuses absolute paths and ".." entries by default, which blocks zip-slip.
    await promisify(execFile)(TAR, ['-xf', zipPath, '-C', dir])
  } catch {
    rmSync(dir, { recursive: true, force: true })
    throw new Error('Extension package could not be extracted')
  } finally {
    rmSync(zipPath, { force: true })
  }
  // Store packages carry their public key only in the CRX header; without it in the manifest
  // the extension would get a path-based ID instead of its real store ID.
  const manifest = readManifest(dir)
  const key = crxPublicKeys(crx).find((candidate) => extensionId(candidate) === id)
  if (!manifest.key && key) {
    manifest.key = key.toString('base64')
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  }
  return install(dir)
}

function entry(id: string): Installed {
  const found = installed.find((item) => item.id === id)
  if (!found) throw new TypeError('Extension not found')
  return found
}

export function setExtensionPinned(id: string, pinned: boolean): void {
  entry(id).pinned = pinned
  save()
}

export async function setExtensionEnabled(id: string, enabled: boolean): Promise<void> {
  const item = entry(id)
  if (enabled && !item.enabled) await activate(item)
  if (!enabled && item.enabled) extensions().removeExtension(id)
  item.enabled = enabled
  save()
}

export function removeExtension(id: string): void {
  const item = entry(id)
  if (item.enabled) extensions().removeExtension(id)
  rmSync(item.dir, { recursive: true, force: true })
  installed = installed.filter((other) => other !== item)
  save()
}

export function hasWebRequestExtension(): boolean {
  return installed.some((item) => {
    if (!item.enabled) return false
    try {
      return !!readManifest(item.dir).permissions?.includes('webRequest')
    } catch {
      return false
    }
  })
}

export function extensionOptionsUrl(id: string): string {
  return info(entry(id)).optionsUrl
}

// Electron sends extensions no tab or navigation events. MV2 background pages share their world with
// the polyfill preload, so its stand-in events can be fired from here.
export function dispatchExtensionEvent(path: string, details: Record<string, unknown>): void {
  const script = `globalThis.chrome?.${path}?.dispatch?.(${JSON.stringify(details)})`
  for (const contents of webContents.getAllWebContents())
    if (contents.getType() === 'backgroundPage')
      contents.executeJavaScript(script).catch(() => undefined)
}

export function openExtensionPopup(
  win: BrowserWindow,
  id: string,
  x: number,
  y: number,
  tabId?: number
): void {
  const item = entry(id)
  const manifest = readManifest(item.dir)
  const page = manifest.action?.default_popup ?? manifest.browser_action?.default_popup
  if (!page || !item.enabled) return
  const bounds = win.getContentBounds()
  const popup = new BrowserWindow({
    parent: win,
    x: Math.round(bounds.x + x),
    y: Math.round(bounds.y + y),
    width: 360,
    height: 480,
    frame: false,
    resizable: false,
    show: false,
    skipTaskbar: true,
    backgroundColor: '#ffffff',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  popup.on('blur', () => popup.close())
  popup.webContents.once('did-finish-load', async () => {
    const [width, height] = (await popup.webContents
      .executeJavaScript(
        '[document.documentElement.scrollWidth, document.documentElement.scrollHeight]'
      )
      .catch(() => [360, 480])) as number[]
    if (popup.isDestroyed()) return
    popup.setContentSize(Math.min(Math.max(width, 120), 800), Math.min(Math.max(height, 40), 600))
    popup.setPosition(Math.round(bounds.x + x - popup.getSize()[0]), Math.round(bounds.y + y))
    popup.show()
  })
  const url = new URL(`chrome-extension://${id}/${page.replace(/^\//, '')}`)
  if (tabId !== undefined) url.searchParams.set('tabId', String(tabId))
  popup.loadURL(url.href).catch(() => popup.close())
}
