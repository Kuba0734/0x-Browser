import { statSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
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
  getBookmark,
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
import { isDefaultBrowser, openDefaultAppsSettings } from './default-browser'
import { bookmarksHtml, historyCsv } from './export-format'
import { allFavicons, clearFavicons, flushFavicons, loadFavicons } from './favicons'
import {
  allVisits,
  clearHistory,
  closeHistory,
  completeHistory,
  openHistory,
  searchHistory,
  topSites
} from './history'
import { searchSuggestions } from './suggest'
import { importSources, runImport } from './importer'
import { registerInternalProtocol, rendererUrl } from './internal'
import { addUi, bool, handle, int, listen, optStr, str } from './ipc'
import { log } from './logger'
import {
  popupAppMenu,
  popupBookmarkContext,
  addSidebarSite,
  popupSidebarAddMenu,
  popupSidebarContext,
  popupExtensionsMenu,
  popupPageMenu,
  popupTabMenu
} from './menus'
import { perfSnapshot } from './performance'
import {
  answerPrompt,
  clearAllPermissions,
  clearSite,
  initPermissions,
  listPermissions,
  loadPermissions,
  setPermission,
  type PromptPresenter
} from './permissions'
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
import { internalUrl, isFileUrl, isInternalUrl, isWebUrl, resolveInput } from './url'

const TABSTRIP_HEIGHT = 40
const APP_ICON = join(app.getAppPath(), 'assets', 'icons', 'app.ico')

process.on('uncaughtException', (error) => log('error', 'main', error.stack ?? String(error)))

app.enableSandbox()
app.setAppUserModelId('com.kuba0734.0xbrowser')
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

type AppWindow = {
  win: BrowserWindow
  tabs: TabManager
  suggest: WebContentsView
  prompt: WebContentsView
  suggestOwner?: WebContents
  notice?: WebContentsView
  panels: Partial<Record<PanelName, Panel>>
}

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
      entry.prompt.webContents === sender ||
      panelViews(entry).some((view) => view.webContents === sender) ||
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

function createOverlayView(page: string, hash = ''): WebContentsView {
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
  view.webContents.loadURL(rendererUrl(page) + hash)
  return view
}

type PanelName = 'downloads' | 'bookmarks'
type Panel = { view: WebContentsView; hiddenAt: number; key: string }

const PANELS: Record<PanelName, { page: string; hash: string; width: number; height: number }> = {
  downloads: { page: 'pages/downloads/index.html', hash: '#panel', width: 380, height: 160 },
  bookmarks: { page: 'bookmark-menu/index.html', hash: '', width: 300, height: 120 }
}

function hidePanel(panel?: Panel): void {
  if (!panel?.view.getVisible()) return
  panel.view.setVisible(false)
  panel.hiddenAt = Date.now()
}

const panelViews = (entry: AppWindow) => Object.values(entry.panels).map((panel) => panel.view)

// Panels are created on first use and close when they lose focus, like a menu. Clicking the button
// that opened a panel blurs it first, so reopening the same panel right after is skipped.
function togglePanel(
  entry: AppWindow,
  name: PanelName,
  x: number,
  y: number,
  options: { key?: string; alignRight?: boolean } = {}
): Panel | null {
  const key = options.key ?? ''
  let panel = entry.panels[name]
  if (panel && panel.key === key && Date.now() - panel.hiddenAt < 250) return null
  if (!panel) {
    const view = createOverlayView(PANELS[name].page, PANELS[name].hash)
    view.webContents.on('blur', () => hidePanel(entry.panels[name]))
    panel = { view, hiddenAt: 0, key }
    entry.panels[name] = panel
  }
  panel.key = key
  const { win } = entry
  const width = Math.min(PANELS[name].width, win.getContentSize()[0] - 16)
  const height = panel.view.getBounds().height || PANELS[name].height
  const left = options.alignRight ? x - width : x
  panel.view.setBounds({ x: Math.round(left), y: Math.round(y), width, height })
  win.contentView.addChildView(panel.view)
  panel.view.setVisible(true)
  panel.view.webContents.focus()
  return panel
}

const PROMPT_WIDTH = 360
const PROMPT_LEFT = 96

function presenterFor(contents: WebContents): PromptPresenter | null {
  const entry = [...windows].find((candidate) => candidate.tabs.owns(contents))
  if (!entry) return null
  const { win, prompt, tabs } = entry
  return {
    key: entry,
    show: (request) => {
      prompt.setBounds({
        x: PROMPT_LEFT + tabs.contentLeft,
        y: tabs.contentTop,
        width: PROMPT_WIDTH,
        height: 120 + request.permissions.length * 28
      })
      win.contentView.addChildView(prompt)
      prompt.setVisible(true)
      prompt.webContents.send('prompt:show', request)
    },
    hide: () => prompt.setVisible(false)
  }
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
      // New tab views stack above existing children, so visible overlays are raised again.
      for (const overlay of [suggest, prompt, entry.notice, ...panelViews(entry)])
        if (overlay?.getVisible()) win.contentView.addChildView(overlay)
      saveSession()
    },
    onInput: (event, input) => handleShortcut(tabs, ui, event, input),
    canCloseWindow: () => windows.size > 1,
    onContextMenu: (contents, params) => popupPageMenu(win, tabs, contents, params)
  })
  const suggest = createOverlayView('suggest/index.html')
  const prompt = createOverlayView('prompt/index.html')
  win.contentView.addChildView(suggest)
  win.contentView.addChildView(prompt)
  win.on('resize', () => {
    suggest.setVisible(false)
    for (const panel of Object.values(entry.panels)) hidePanel(panel)
  })
  const entry: AppWindow = { win, tabs, suggest, prompt, panels: {} }
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
    prompt.webContents.close()
    entry.notice?.webContents.close()
    for (const view of panelViews(entry)) view.webContents.close()
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

appActions.moveTabToNewWindow = (tabs, id) => {
  const tab = tabs.detach(id)
  if (tab) createWindow({ tab })
}

appActions.newWindow = (url) => {
  createWindow({ url })
}

appActions.openFiles = async (tabs) => {
  const parent = BrowserWindow.getFocusedWindow()
  const options = {
    properties: ['openFile', 'multiSelections'] as ('openFile' | 'multiSelections')[]
  }
  const result = await (parent
    ? dialog.showOpenDialog(parent, options)
    : dialog.showOpenDialog(options))
  for (const path of result.filePaths) tabs.create(pathToFileURL(path).href)
}

function urlsFromArgs(argv: string[], cwd: string): string[] {
  return argv.slice(1).flatMap((arg) => {
    if (arg.startsWith('-')) return []
    if (isWebUrl(arg)) return [arg]
    const path = resolve(cwd, arg)
    try {
      return statSync(path).isFile() ? [pathToFileURL(path).href] : []
    } catch {
      return []
    }
  })
}

const NOTICE_WIDTH = 360
const NOTICE_HEIGHT = 160

// Created only when needed and closed for good on dismiss, so it costs nothing afterwards.
function showDefaultBrowserNotice(entry: AppWindow): void {
  const { win } = entry
  const notice = createOverlayView('notice/index.html')
  entry.notice = notice
  const place = () => {
    const { height } = win.getContentBounds()
    notice.setBounds({
      x: 0,
      y: height - NOTICE_HEIGHT,
      width: NOTICE_WIDTH,
      height: NOTICE_HEIGHT
    })
  }
  place()
  win.on('resize', place)
  win.contentView.addChildView(notice)
  notice.webContents.once('did-finish-load', () => notice.setVisible(true))
  notice.webContents.once('destroyed', () => {
    win.off('resize', place)
    if (!win.isDestroyed()) win.contentView.removeChildView(notice)
    entry.notice = undefined
  })
}

const navigable = (url: string) => isWebUrl(url) || isInternalUrl(url) || isFileUrl(url)
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

  listen('ui:insets', (sender, top, left) => {
    if (typeof top === 'number' && top >= 0 && top < 400 && typeof left === 'number')
      tabsOf(sender).setInsets(Math.round(top), Math.min(120, Math.max(0, Math.round(left))))
  })
  listen('sidebar:add', (sender, x, y) => {
    const tabs = tabsOf(sender)
    if (!addSidebarSite(tabs.activeContents?.getURL() ?? ''))
      popupSidebarAddMenu(winOf(sender), tabs, ...coords(x, y))
  })
  listen('ui:sidebar-context', (sender, url, x, y) => {
    if (getSettings().sidebarSites.includes(str(url)))
      popupSidebarContext(winOf(sender), tabsOf(sender), str(url), ...coords(x, y))
  })
  listen('ui:menu', (sender, x, y) => popupAppMenu(winOf(sender), tabsOf(sender), ...coords(x, y)))
  listen('ui:bookmark-menu', (sender, id, x, y) => {
    const folderId = str(id)
    if (!getBookmark(folderId)?.children) return
    const panel = togglePanel(windowFor(sender), 'bookmarks', ...coords(x, y), { key: folderId })
    if (!panel) return
    const contents = panel.view.webContents
    const open = () => contents.send('bookmarks:menu-folder', folderId)
    if (contents.isLoading()) contents.once('did-finish-load', open)
    else open()
  })
  listen('ui:bookmark-context', (sender, id, x, y) =>
    popupBookmarkContext(winOf(sender), tabsOf(sender), str(id), ...coords(x, y))
  )
  listen('ui:extension-popup', (sender, id, x, y) =>
    openExtensionPopup(winOf(sender), str(id), ...coords(x, y), tabsOf(sender).activeContents?.id)
  )
  listen('ui:tab-menu', (sender, id, x, y) =>
    popupTabMenu(winOf(sender), tabsOf(sender), int(id), ...coords(x, y))
  )
  listen('ui:downloads-menu', (sender, x, y) =>
    togglePanel(windowFor(sender), 'downloads', ...coords(x, y), { alignRight: true })
  )
  const panelOf = (sender: WebContents) =>
    Object.values(windowFor(sender).panels).find((panel) => panel.view.webContents === sender)
  listen('panel:resize', (sender, height) => {
    const panel = panelOf(sender)
    if (!panel || typeof height !== 'number') return
    const bounds = panel.view.getBounds()
    panel.view.setBounds({ ...bounds, height: Math.min(560, Math.max(40, Math.ceil(height))) })
  })
  listen('panel:hide', (sender) => hidePanel(panelOf(sender)))
  listen('ui:extensions-menu', (sender, x, y) =>
    popupExtensionsMenu(winOf(sender), tabsOf(sender), ...coords(x, y))
  )

  handle('history:complete', (_sender, text) => completeHistory(str(text)))
  handle('history:top', () => topSites())
  handle('history:search', (_sender, text) => searchHistory(str(text)))
  handle('search:suggest', (_sender, text) => searchSuggestions(str(text)))
  listen('suggest:show', (sender, items, selected, x, y, width) => {
    if (!Array.isArray(items) || items.length > 10) return
    const entry = windowFor(sender)
    const { win, suggest } = entry
    entry.suggestOwner = sender
    const [left, top] = coords(x, y)
    const owned = entry.tabs.owns(sender)
    const offset = owned ? entry.tabs.contentTop : 0
    suggest.setBounds({
      x: Math.round(left + (owned ? entry.tabs.contentLeft : 0)),
      y: Math.round(top + offset),
      width: Math.round(Number(width) || 400),
      height: items.length * 36 + 10
    })
    win.contentView.addChildView(suggest)
    suggest.setVisible(true)
    suggest.webContents.send('suggest:items', { items, selected: Number(selected) })
  })
  listen('suggest:hide', (sender) => {
    const entry = windowFor(sender)
    if (!entry.suggestOwner || entry.suggestOwner === sender) entry.suggest.setVisible(false)
  })
  const isNotice = (sender: WebContents) =>
    [...windows].some((entry) => entry.notice?.webContents === sender)
  listen('notice:dismiss', (sender) => {
    if (isNotice(sender)) sender.close()
  })
  listen('notice:set-default', (sender) => {
    if (!isNotice(sender)) return
    openDefaultAppsSettings()
    sender.close()
  })
  listen('permission:answer', (_sender, id, allowed) => answerPrompt(str(id), bool(allowed)))
  handle('permissions:list', () => listPermissions())
  handle('permissions:set', (_sender, origin, key, value) =>
    setPermission(str(origin), str(key), value === 'allow' || value === 'block' ? value : null)
  )
  handle('permissions:clear-site', (_sender, origin) => clearSite(str(origin)))
  listen('suggest:pick', (sender, index) => {
    const { win, suggestOwner } = windowFor(sender)
    const target = suggestOwner && !suggestOwner.isDestroyed() ? suggestOwner : win.webContents
    target.send('suggest:picked', int(index))
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
  handle('bookmarks:move', (_sender, id, parentId, index) =>
    moveBookmark(str(id), str(parentId), index === undefined ? undefined : int(index))
  )
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
    if (!(name in DEFAULT_SETTINGS) || ['design', 'downloadDir', 'sidebarSites'].includes(name))
      return
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

  handle('privacy:export', async (sender, kinds) => {
    if (!Array.isArray(kinds)) throw new TypeError('Expected list')
    const selected = new Set(kinds.map(str))
    const result = await dialog.showOpenDialog(winOf(sender), {
      title: 'Choose export folder',
      properties: ['openDirectory', 'createDirectory']
    })
    const dir = result.filePaths[0]
    if (result.canceled || !dir) return null
    const files: [string, string][] = []
    if (selected.has('bookmarks')) files.push(['0x-bookmarks.html', bookmarksHtml(bookmarkTree())])
    if (selected.has('history')) files.push(['0x-history.csv', historyCsv(allVisits())])
    if (selected.has('settings'))
      files.push(['0x-settings.json', JSON.stringify(getSettings(), null, 2)])
    await Promise.all(files.map(([name, content]) => writeFile(join(dir, name), content, 'utf8')))
    return dir
  })
  handle('privacy:clear', async (_sender, kinds) => {
    if (!Array.isArray(kinds)) throw new TypeError('Expected list')
    const selected = new Set(kinds.map(str))
    if (selected.has('history')) {
      clearHistory()
      clearFavicons()
    }
    if (selected.has('cookies')) {
      // Extension storage (e.g. pairing tokens) is not browsing data and stays untouched.
      const extensionOrigins = listExtensions().map(
        (extension) => `chrome-extension://${extension.id}`
      )
      await session.defaultSession.clearData({
        dataTypes: [
          'cookies',
          'localStorage',
          'indexedDB',
          'serviceWorkers',
          'fileSystems',
          'webSQL',
          'backgroundFetch'
        ],
        ...(extensionOrigins.length ? { excludeOrigins: extensionOrigins } : {})
      })
    }
    if (selected.has('cache')) await session.defaultSession.clearCache()
    if (selected.has('downloads')) clearDownloads()
    if (selected.has('permissions')) clearAllPermissions()
  })

  handle('import:sources', () => importSources())
  handle('import:run', (_sender, sourceId, kinds) => {
    if (!Array.isArray(kinds)) throw new TypeError('Expected list')
    return runImport(str(sourceId), kinds.map(str))
  })
}

const primaryInstance = app.requestSingleInstanceLock()
// exit() skips the quit handlers, which would overwrite the running instance's session and settings.
if (!primaryInstance) app.exit(0)

app.on('second-instance', (_event, argv, cwd) => {
  const urls = urlsFromArgs(argv, cwd)
  const focused = BrowserWindow.getFocusedWindow()
  const target = [...windows].find((entry) => entry.win === focused) ?? [...windows].at(-1)
  if (!target) return void createWindow({ url: urls[0] })
  if (!urls.length) return void createWindow()
  for (const url of urls) target.tabs.create(url)
  if (target.win.isMinimized()) target.win.restore()
  target.win.focus()
})

app.whenReady().then(async () => {
  const splash = createSplash()
  registerInternalProtocol()
  registerIpc()
  openHistory()
  loadBookmarks()
  loadFavicons()
  loadPermissions()
  initPermissions(session.defaultSession, presenterFor)
  loadDownloads()
  initDownloads(session.defaultSession)
  for (const type of ['service-worker', 'frame'] as const)
    session.defaultSession.registerPreloadScript({
      type,
      filePath: join(__dirname, '../preload/extension.js')
    })
  await loadExtensions()
  const saved = loadSession()
  const [first] = await Promise.all(
    (saved.length ? saved : [undefined]).map((entry) => createWindow({ saved: entry }))
  )
  for (const url of urlsFromArgs(process.argv, process.cwd())) first.tabs.create(url)
  if (app.isPackaged && !(await isDefaultBrowser())) showDefaultBrowserNotice(first)
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
