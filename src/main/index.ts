import { join } from 'node:path'
import { app, BrowserWindow, dialog, nativeTheme, session } from 'electron'
import {
  DEFAULT_SETTINGS,
  DESIGN_TOKENS,
  isValidTokenValue,
  SEARCH_ENGINES,
  type Settings
} from '../shared/settings'
import {
  addBookmark,
  bookmarkTree,
  loadBookmarks,
  moveBookmark,
  removeBookmark,
  toggleBookmark,
  updateBookmark
} from './bookmarks'
import {
  cancelDownload,
  clearDownloads,
  initDownloads,
  listDownloads,
  loadDownloads,
  openDownloadFolder,
  openDownload,
  pauseDownload,
  removeDownload,
  resumeDownload,
  showDownload
} from './downloads'
import {
  extensionOptionsUrl,
  installFromFolder,
  installFromStore,
  listExtensions,
  loadExtensions,
  openExtensionPopup,
  removeExtension,
  setExtensionEnabled
} from './extensions'
import { closeHistory, completeHistory, openHistory, topSites } from './history'
import { importSources, runImport } from './importer'
import { registerInternalProtocol, rendererUrl } from './internal'
import { bool, handle, int, listen, optStr, setUi, str } from './ipc'
import { log } from './logger'
import { popupAppMenu, popupBookmarkContext, popupBookmarkFolder } from './menus'
import { perfSnapshot } from './performance'
import {
  flushSettings,
  getSettings,
  loadSettings,
  onSettingsChange,
  updateSettings
} from './settings'
import { handleShortcut } from './shortcuts'
import { TabManager } from './tabs'
import { checkForUpdates, initUpdater, installUpdate, updateState } from './updater'
import { internalUrl, isInternalUrl, isWebUrl, resolveInput } from './url'

const TABSTRIP_HEIGHT = 40
const ALLOWED_PERMISSIONS = new Set(['fullscreen', 'clipboard-sanitized-write'])
const APP_ICON = join(app.getAppPath(), 'assets', 'icons', 'app.ico')

process.on('uncaughtException', (error) => log('error', 'main', error.stack ?? String(error)))

app.enableSandbox()
app.userAgentFallback = app.userAgentFallback
  .replace(/ Electron\/\S+/, '')
  .replace(/ \S+\/[\d.]+(?= Chrome\/)/, '')
nativeTheme.themeSource = 'dark'
loadSettings()
const forceDarkActive = getSettings().forceDarkWeb
if (forceDarkActive) app.commandLine.appendSwitch('enable-features', 'WebContentsForceDark')

app.on('render-process-gone', (_event, _contents, details) => {
  if (details.reason !== 'clean-exit')
    log('error', 'renderer', `${details.reason} (${details.exitCode})`)
})

app.on('child-process-gone', (_event, details) => {
  if (details.reason !== 'clean-exit')
    log('error', 'process', `${details.type} ${details.reason} (${details.exitCode})`)
})

function token(key: string): string {
  return getSettings().design[key] || DESIGN_TOKENS.find((item) => item.key === key)!.value
}

function titleBarOverlay() {
  return { color: token('--bg'), symbolColor: token('--text'), height: TABSTRIP_HEIGHT }
}

function createSplash(): BrowserWindow {
  const splash = new BrowserWindow({
    width: 320,
    height: 220,
    frame: false,
    resizable: false,
    center: true,
    show: false,
    icon: APP_ICON,
    backgroundColor: token('--bg'),
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  splash.once('ready-to-show', () => splash.show())
  splash.loadURL(rendererUrl('splash/index.html'))
  return splash
}

function createWindow(): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 480,
    minHeight: 320,
    show: false,
    icon: APP_ICON,
    backgroundColor: token('--bg'),
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBarOverlay(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      additionalArguments: ['--ox-ui'],
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  const ui = win.webContents
  setUi(ui)
  const tabs: TabManager = new TabManager(
    win,
    (state) => ui.send('tabs:state', state),
    (event, input) => handleShortcut(tabs, ui, event, input)
  )

  ui.on('will-navigate', (event) => event.preventDefault())
  ui.setWindowOpenHandler(() => ({ action: 'deny' }))
  ui.on('before-input-event', (event, input) => handleShortcut(tabs, ui, event, input))
  let previousSleep = getSettings().sleepAfterMinutes
  onSettingsChange((settings) => {
    win.setTitleBarOverlay(titleBarOverlay())
    win.setBackgroundColor(token('--bg'))
    if (settings.sleepAfterMinutes !== previousSleep) tabs.rescheduleSleep()
    previousSleep = settings.sleepAfterMinutes
  })

  registerIpc(win, tabs)
  ui.loadURL(rendererUrl('ui/index.html'))
  return new Promise((resolve) =>
    ui.once('did-finish-load', () => {
      tabs.create()
      resolve(win)
    })
  )
}

const navigable = (url: string) => isWebUrl(url) || isInternalUrl(url)
const coords = (x: unknown, y: unknown): [number, number] => [Number(x) || 0, Number(y) || 0]

function registerIpc(win: BrowserWindow, tabs: TabManager): void {
  listen('tabs:new', (url) => {
    const target = optStr(url)
    tabs.create(target && navigable(target) ? target : undefined)
  })
  listen('tabs:close', (id) => tabs.close(int(id)))
  listen('tabs:activate', (id) => tabs.activate(int(id)))
  listen('tabs:open-internal', (page) => {
    const url = internalUrl(str(page))
    if (url) tabs.openOrActivate(url)
  })

  listen('nav:go', (input) => {
    const url = resolveInput(str(input), SEARCH_ENGINES[getSettings().searchEngine].url)
    if (url) tabs.navigate(url)
  })
  listen('nav:back', () => tabs.goBack())
  listen('nav:forward', () => tabs.goForward())
  listen('nav:reload', () => tabs.reload())
  listen('nav:stop', () => tabs.stop())

  listen('ui:chrome-height', (height) => {
    if (typeof height === 'number' && height >= 0 && height < 400)
      tabs.setChromeHeight(Math.round(height))
  })
  listen('ui:menu', (x, y) => popupAppMenu(win, tabs, ...coords(x, y)))
  listen('ui:bookmark-menu', (id, x, y) => popupBookmarkFolder(win, tabs, str(id), ...coords(x, y)))
  listen('ui:bookmark-context', (id, x, y) =>
    popupBookmarkContext(win, tabs, str(id), ...coords(x, y))
  )
  listen('ui:extension-popup', (id, x, y) => openExtensionPopup(win, str(id), ...coords(x, y)))

  handle('history:complete', (text) => completeHistory(str(text)))
  handle('history:top', () => topSites())

  handle('bookmarks:tree', () => bookmarkTree())
  handle('bookmarks:add', (parentId, title, url) => {
    const target = optStr(url)
    if (target !== undefined && !navigable(target)) throw new TypeError('Invalid URL')
    return addBookmark(str(parentId), str(title), target)
  })
  handle('bookmarks:update', (id, title, url) => {
    const target = optStr(url)
    if (target !== undefined && !navigable(target)) throw new TypeError('Invalid URL')
    updateBookmark(str(id), str(title), target)
  })
  handle('bookmarks:remove', (id) => removeBookmark(str(id)))
  handle('bookmarks:move', (id, parentId) => moveBookmark(str(id), str(parentId)))
  handle('bookmarks:toggle', (url, title) => {
    const target = str(url)
    if (!navigable(target)) throw new TypeError('Invalid URL')
    return toggleBookmark(target, str(title))
  })

  handle('downloads:list', () => listDownloads())
  listen('downloads:pause', (id) => pauseDownload(str(id)))
  listen('downloads:resume', (id) => resumeDownload(str(id)))
  listen('downloads:cancel', (id) => cancelDownload(str(id)))
  listen('downloads:open', (id) => openDownload(str(id)))
  listen('downloads:show', (id) => showDownload(str(id)))
  listen('downloads:remove', (id) => removeDownload(str(id)))
  listen('downloads:clear', () => clearDownloads())
  listen('downloads:open-folder', () => openDownloadFolder())

  handle('settings:get', () => getSettings())
  listen('settings:set', (key, value) => {
    const name = str(key) as keyof Settings
    if (!(name in DEFAULT_SETTINGS) || name === 'design' || name === 'downloadDir') return
    if (typeof value !== typeof DEFAULT_SETTINGS[name]) return
    if (name === 'searchEngine' && !(str(value) in SEARCH_ENGINES)) return
    if (name === 'sleepAfterMinutes') {
      updateSettings({ sleepAfterMinutes: Math.min(240, Math.max(0, Math.round(Number(value)))) })
      return
    }
    updateSettings({ [name]: value })
  })
  listen('settings:set-token', (key, value) => {
    const name = str(key)
    if (!DESIGN_TOKENS.some((item) => item.key === name)) return
    const design = { ...getSettings().design }
    const next = optStr(value)
    if (next === undefined) delete design[name]
    else if (isValidTokenValue(next)) design[name] = next
    else return
    updateSettings({ design })
  })
  listen('settings:reset-design', () => updateSettings({ design: {} }))
  handle('settings:choose-download-dir', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose download folder',
      properties: ['openDirectory', 'createDirectory']
    })
    if (!result.canceled && result.filePaths[0])
      updateSettings({ downloadDir: result.filePaths[0] })
    return getSettings().downloadDir
  })

  handle('perf:snapshot', () => perfSnapshot(tabs))
  listen('perf:sleep', (id) => tabs.sleep(int(id)))
  listen('perf:wake', (id) => tabs.wakeTab(int(id)))
  listen('perf:sleep-inactive', () => tabs.sleepInactive())

  handle('extensions:list', () => listExtensions())
  handle('extensions:install-folder', () => installFromFolder(win))
  handle('extensions:install-store', (input) => installFromStore(str(input)))
  handle('extensions:set-enabled', (id, enabled) => setExtensionEnabled(str(id), bool(enabled)))
  handle('extensions:remove', (id) => removeExtension(str(id)))
  listen('extensions:options', (id) => {
    const url = extensionOptionsUrl(str(id))
    if (url) tabs.create(url)
  })

  handle('app:info', () => ({
    version: app.getVersion(),
    packaged: app.isPackaged,
    forceDarkActive
  }))
  listen('app:restart', () => {
    app.relaunch()
    app.quit()
  })
  handle('update:state', () => updateState())
  listen('update:check', () => checkForUpdates())
  listen('update:install', () => installUpdate())

  handle('import:sources', () => importSources())
  handle('import:run', (sourceId, kinds) => {
    if (!Array.isArray(kinds)) throw new TypeError('Expected list')
    return runImport(str(sourceId), kinds.map(str))
  })
}

app.whenReady().then(async () => {
  const splash = createSplash()
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) =>
    callback(ALLOWED_PERMISSIONS.has(permission))
  )
  session.defaultSession.setPermissionCheckHandler((_contents, permission) =>
    ALLOWED_PERMISSIONS.has(permission)
  )
  registerInternalProtocol()
  openHistory()
  loadBookmarks()
  loadDownloads()
  initDownloads(session.defaultSession)
  session.defaultSession.registerPreloadScript({
    type: 'service-worker',
    filePath: join(__dirname, '../preload/service-worker.js')
  })
  await loadExtensions()
  const win = await createWindow()
  win.show()
  if (!splash.isDestroyed()) splash.destroy()
  initUpdater()
})

app.on('window-all-closed', () => app.quit())
app.on('will-quit', () => {
  flushSettings()
  closeHistory()
})
