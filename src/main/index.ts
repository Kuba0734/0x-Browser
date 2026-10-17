import { join } from 'node:path'
import {
  app,
  BrowserWindow,
  dialog,
  nativeTheme,
  screen,
  session,
  WebContentsView,
  type WebContents
} from 'electron'
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
  setExtensionEnabled,
  setExtensionPinned
} from './extensions'
import { appActions } from './app-actions'
import { initCompat } from './compat'
import { allFavicons, flushFavicons, loadFavicons } from './favicons'
import { closeHistory, completeHistory, openHistory, searchHistory, topSites } from './history'
import { searchSuggestions } from './suggest'
import { importSources, runImport } from './importer'
import { registerInternalProtocol, rendererUrl } from './internal'
import { addUi, bool, handle, int, listen, optStr, str } from './ipc'
import { log } from './logger'
import {
  popupAppMenu,
  popupBookmarkContext,
  popupBookmarkFolder,
  popupExtensionsMenu,
  popupPageMenu
} from './menus'
import { perfSnapshot } from './performance'
import {
  flushSettings,
  getSettings,
  loadSettings,
  onSettingsChange,
  updateSettings
} from './settings'
import { handleShortcut } from './shortcuts'
import { createSaver, readJson } from './store'
import { TabManager, type SavedWindow, type Tab } from './tabs'
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

type AppWindow = { win: BrowserWindow; tabs: TabManager; suggest: WebContentsView }

const SESSION_FILE = 'session.json'
const windows = new Set<AppWindow>()
let sessionFrozen = false
const sessionSaver = createSaver(SESSION_FILE, () => ({
  windows: [...windows].map((entry) => entry.tabs.snapshot())
}))

function saveSession(): void {
  if (!sessionFrozen) sessionSaver.schedule()
}

function saveSessionNow(): void {
  if (sessionFrozen) return
  sessionSaver.schedule()
  sessionSaver.flush()
}

const validWindow = (saved: Partial<SavedWindow> | undefined): SavedWindow => ({
  tabs: (Array.isArray(saved?.tabs) ? saved.tabs : []).filter(
    (tab) => typeof tab?.url === 'string' && typeof tab.title === 'string' && navigable(tab.url)
  ),
  activeIndex: Number.isInteger(saved?.activeIndex) ? Number(saved?.activeIndex) : 0
})

function loadSession(): SavedWindow[] {
  const saved = readJson<{ windows?: Partial<SavedWindow>[] } & Partial<SavedWindow>>(
    SESSION_FILE,
    {}
  )
  const list = Array.isArray(saved.windows) ? saved.windows : [saved]
  return list.map(validWindow).filter((entry) => entry.tabs.length)
}

function windowFor(sender: WebContents): AppWindow {
  for (const entry of windows)
    if (
      entry.win.webContents === sender ||
      entry.suggest.webContents === sender ||
      entry.tabs.owns(sender)
    )
      return entry
  const focused = BrowserWindow.getFocusedWindow()
  const fallback = [...windows].find((entry) => entry.win === focused) ?? [...windows][0]
  if (!fallback) throw new TypeError('No window')
  return fallback
}

function windowForTab(id: number): AppWindow | undefined {
  return [...windows].find((entry) => entry.tabs.has(id))
}

function createSuggestView(): WebContentsView {
  const view = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      additionalArguments: ['--ox-ui'],
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  view.setBackgroundColor('#00000000')
  view.setVisible(false)
  addUi(view.webContents)
  view.webContents.loadURL(rendererUrl('suggest/index.html'))
  return view
}

type WindowOptions = { saved?: SavedWindow; tab?: Tab; url?: string; x?: number; y?: number }

function createWindow(options: WindowOptions = {}): Promise<AppWindow> {
  const source = BrowserWindow.getFocusedWindow()?.getBounds()
  const win = new BrowserWindow({
    width: source?.width ?? 1280,
    height: source?.height ?? 800,
    x: options.x,
    y: options.y,
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
  addUi(ui)
  const tabs: TabManager = new TabManager(win, {
    onChange: (state) => {
      if (!ui.isDestroyed()) ui.send('tabs:state', state)
      saveSession()
    },
    onInput: (event, input) => handleShortcut(tabs, ui, event, input),
    canCloseWindow: () => windows.size > 1,
    onContextMenu: (contents, params) => popupPageMenu(win, tabs, contents, params)
  })
  const suggest = createSuggestView()
  win.contentView.addChildView(suggest)
  win.on('resize', () => suggest.setVisible(false))
  const entry: AppWindow = { win, tabs, suggest }
  windows.add(entry)

  ui.on('will-navigate', (event) => event.preventDefault())
  ui.setWindowOpenHandler(() => ({ action: 'deny' }))
  ui.on('before-input-event', (event, input) => handleShortcut(tabs, ui, event, input))
  win.on('close', () => {
    if (windows.size === 1) {
      saveSessionNow()
      sessionFrozen = true
    }
  })
  win.on('closed', () => {
    suggest.webContents.close()
    windows.delete(entry)
    tabs.destroyAll()
    saveSession()
  })

  ui.loadURL(rendererUrl('ui/index.html'))
  return new Promise((resolve) =>
    ui.once('did-finish-load', () => {
      if (options.tab) tabs.adopt(options.tab)
      else if (!options.saved || !tabs.restore(options.saved)) tabs.create(options.url)
      win.show()
      resolve(entry)
    })
  )
}

let previousSleep = getSettings().sleepAfterMinutes
onSettingsChange((settings) => {
  for (const { win, tabs } of windows) {
    win.setTitleBarOverlay(titleBarOverlay())
    win.setBackgroundColor(token('--bg'))
    if (settings.sleepAfterMinutes !== previousSleep) tabs.rescheduleSleep()
  }
  previousSleep = settings.sleepAfterMinutes
})

appActions.newWindow = (url) => {
  createWindow({ url })
}

const navigable = (url: string) => isWebUrl(url) || isInternalUrl(url)
const coords = (x: unknown, y: unknown): [number, number] => [Number(x) || 0, Number(y) || 0]

function registerIpc(): void {
  const tabsOf = (sender: WebContents) => windowFor(sender).tabs
  const winOf = (sender: WebContents) => windowFor(sender).win

  listen('tabs:new', (sender, url) => {
    const target = optStr(url)
    tabsOf(sender).create(target && navigable(target) ? target : undefined)
  })
  listen('tabs:close', (sender, id) => tabsOf(sender).close(int(id)))
  listen('tabs:activate', (sender, id) => tabsOf(sender).activate(int(id)))
  listen('tabs:move', (sender, id, index) => tabsOf(sender).move(int(id), int(index)))
  listen('tabs:detach', (sender, id) => {
    const source = windowFor(sender)
    const cursor = screen.getCursorScreenPoint()
    const bounds = source.win.getBounds()
    const overStrip =
      cursor.x >= bounds.x &&
      cursor.x <= bounds.x + bounds.width &&
      cursor.y >= bounds.y &&
      cursor.y <= bounds.y + TABSTRIP_HEIGHT * 2
    if (overStrip) return
    const position = { x: cursor.x - 120, y: cursor.y - 20 }
    if (source.tabs.size === 1) {
      source.win.setPosition(position.x, position.y)
      return
    }
    const tab = source.tabs.detach(int(id))
    if (tab) createWindow({ tab, ...position })
  })
  listen('tabs:attach', (sender, id, index) => {
    const target = windowFor(sender)
    const source = windowForTab(int(id))
    if (!source) return
    if (source === target) {
      target.tabs.move(int(id), int(index))
      return
    }
    const tab = source.tabs.detach(int(id), true)
    if (!tab) return
    target.tabs.adopt(tab, int(index))
    target.win.focus()
  })
  listen('tabs:open-internal', (sender, page) => {
    const url = internalUrl(str(page))
    if (url) tabsOf(sender).openOrActivate(url)
  })

  listen('nav:go', (sender, input) => {
    const url = resolveInput(str(input), SEARCH_ENGINES[getSettings().searchEngine].url)
    if (url) tabsOf(sender).navigate(url)
  })
  listen('nav:back', (sender) => tabsOf(sender).goBack())
  listen('nav:forward', (sender) => tabsOf(sender).goForward())
  listen('nav:reload', (sender) => tabsOf(sender).reload())
  listen('nav:stop', (sender) => tabsOf(sender).stop())

  listen('ui:chrome-height', (sender, height) => {
    if (typeof height === 'number' && height >= 0 && height < 400)
      tabsOf(sender).setChromeHeight(Math.round(height))
  })
  listen('ui:menu', (sender, x, y) => popupAppMenu(winOf(sender), tabsOf(sender), ...coords(x, y)))
  listen('ui:bookmark-menu', (sender, id, x, y) =>
    popupBookmarkFolder(winOf(sender), tabsOf(sender), str(id), ...coords(x, y))
  )
  listen('ui:bookmark-context', (sender, id, x, y) =>
    popupBookmarkContext(winOf(sender), tabsOf(sender), str(id), ...coords(x, y))
  )
  listen('ui:extension-popup', (sender, id, x, y) =>
    openExtensionPopup(winOf(sender), str(id), ...coords(x, y))
  )
  listen('ui:extensions-menu', (sender, x, y) =>
    popupExtensionsMenu(winOf(sender), tabsOf(sender), ...coords(x, y))
  )

  handle('history:complete', (_sender, text) => completeHistory(str(text)))
  handle('history:top', () => topSites())
  handle('history:search', (_sender, text) => searchHistory(str(text)))
  handle('search:suggest', (_sender, text) => searchSuggestions(str(text)))
  listen('suggest:show', (sender, items, selected, x, y, width) => {
    if (!Array.isArray(items) || items.length > 10) return
    const { win, suggest } = windowFor(sender)
    const [left, top] = coords(x, y)
    suggest.setBounds({
      x: Math.round(left),
      y: Math.round(top),
      width: Math.round(Number(width) || 400),
      height: items.length * 36 + 10
    })
    win.contentView.addChildView(suggest)
    suggest.setVisible(true)
    suggest.webContents.send('suggest:items', { items, selected: Number(selected) })
  })
  listen('suggest:hide', (sender) => windowFor(sender).suggest.setVisible(false))
  listen('suggest:pick', (sender, index) => {
    const { win } = windowFor(sender)
    win.webContents.send('suggest:picked', int(index))
  })
  handle('favicons:all', () => allFavicons())

  handle('bookmarks:tree', () => bookmarkTree())
  handle('bookmarks:add', (_sender, parentId, title, url) => {
    const target = optStr(url)
    if (target !== undefined && !navigable(target)) throw new TypeError('Invalid URL')
    return addBookmark(str(parentId), str(title), target)
  })
  handle('bookmarks:update', (_sender, id, title, url) => {
    const target = optStr(url)
    if (target !== undefined && !navigable(target)) throw new TypeError('Invalid URL')
    updateBookmark(str(id), str(title), target)
  })
  handle('bookmarks:remove', (_sender, id) => removeBookmark(str(id)))
  handle('bookmarks:move', (_sender, id, parentId) => moveBookmark(str(id), str(parentId)))
  handle('bookmarks:toggle', (_sender, url, title) => {
    const target = str(url)
    if (!navigable(target)) throw new TypeError('Invalid URL')
    return toggleBookmark(target, str(title))
  })

  handle('downloads:list', () => listDownloads())
  listen('downloads:pause', (_sender, id) => pauseDownload(str(id)))
  listen('downloads:resume', (_sender, id) => resumeDownload(str(id)))
  listen('downloads:cancel', (_sender, id) => cancelDownload(str(id)))
  listen('downloads:open', (_sender, id) => openDownload(str(id)))
  listen('downloads:show', (_sender, id) => showDownload(str(id)))
  listen('downloads:remove', (_sender, id) => removeDownload(str(id)))
  listen('downloads:clear', () => clearDownloads())
  listen('downloads:open-folder', () => openDownloadFolder())

  handle('settings:get', () => getSettings())
  listen('settings:set', (_sender, key, value) => {
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
  listen('settings:set-token', (_sender, key, value) => {
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
  handle('settings:choose-download-dir', async (sender) => {
    const result = await dialog.showOpenDialog(winOf(sender), {
      title: 'Choose download folder',
      properties: ['openDirectory', 'createDirectory']
    })
    if (!result.canceled && result.filePaths[0])
      updateSettings({ downloadDir: result.filePaths[0] })
    return getSettings().downloadDir
  })

  handle('perf:snapshot', () => perfSnapshot([...windows].map((entry) => entry.tabs)))
  listen('perf:sleep', (_sender, id) => windowForTab(int(id))?.tabs.sleep(int(id)))
  listen('perf:wake', (_sender, id) => windowForTab(int(id))?.tabs.wakeTab(int(id)))
  listen('perf:sleep-inactive', () => {
    for (const entry of windows) entry.tabs.sleepInactive()
  })

  handle('extensions:list', () => listExtensions())
  handle('extensions:install-folder', (sender) => installFromFolder(winOf(sender)))
  handle('extensions:install-store', (_sender, input) => installFromStore(str(input)))
  handle('extensions:set-enabled', (_sender, id, enabled) =>
    setExtensionEnabled(str(id), bool(enabled))
  )
  listen('extensions:set-pinned', (_sender, id, pinned) =>
    setExtensionPinned(str(id), bool(pinned))
  )
  handle('extensions:remove', (_sender, id) => removeExtension(str(id)))
  listen('extensions:options', (sender, id) => {
    const url = extensionOptionsUrl(str(id))
    if (url) tabsOf(sender).create(url)
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
  handle('import:run', (_sender, sourceId, kinds) => {
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
  registerIpc()
  openHistory()
  loadBookmarks()
  loadFavicons()
  loadDownloads()
  initDownloads(session.defaultSession)
  initCompat(session.defaultSession)
  session.defaultSession.registerPreloadScript({
    type: 'service-worker',
    filePath: join(__dirname, '../preload/service-worker.js')
  })
  await loadExtensions()
  const saved = loadSession()
  await Promise.all(
    (saved.length ? saved : [undefined]).map((entry) => createWindow({ saved: entry }))
  )
  if (!splash.isDestroyed()) splash.destroy()
  initUpdater()
})

app.on('before-quit', () => {
  saveSessionNow()
  sessionFrozen = true
})
app.on('window-all-closed', () => app.quit())
app.on('will-quit', () => {
  flushSettings()
  sessionSaver.flush()
  flushFavicons()
  closeHistory()
})
