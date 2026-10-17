import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, session } from 'electron'
import { closeHistory, completeHistory, openHistory } from './history'
import { log } from './logger'
import { handleShortcut } from './shortcuts'
import { TabManager } from './tabs'
import { resolveInput } from './url'

const BACKGROUND = '#0a0a0b'
const TABSTRIP_HEIGHT = 40
const ALLOWED_PERMISSIONS = new Set(['fullscreen', 'clipboard-sanitized-write'])

process.on('uncaughtException', (error) => log('error', 'main', error.stack ?? String(error)))

app.enableSandbox()

app.on('render-process-gone', (_event, _contents, details) => {
  if (details.reason !== 'clean-exit')
    log('error', 'renderer', `${details.reason} (${details.exitCode})`)
})

app.on('child-process-gone', (_event, details) => {
  if (details.reason !== 'clean-exit')
    log('error', 'process', `${details.type} ${details.reason} (${details.exitCode})`)
})

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 480,
    minHeight: 320,
    show: false,
    backgroundColor: BACKGROUND,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: BACKGROUND, symbolColor: '#f2f2f3', height: TABSTRIP_HEIGHT },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  const ui = win.webContents
  const tabs: TabManager = new TabManager(
    win,
    (state) => ui.send('tabs:state', state),
    (event, input) => handleShortcut(tabs, ui, event, input)
  )

  ui.on('will-navigate', (event) => event.preventDefault())
  ui.setWindowOpenHandler(() => ({ action: 'deny' }))
  ui.on('before-input-event', (event, input) => handleShortcut(tabs, ui, event, input))
  ui.once('did-finish-load', () => tabs.create())
  win.once('ready-to-show', () => win.show())

  registerIpc(win, tabs)

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL)
    ui.loadURL(process.env.ELECTRON_RENDERER_URL)
  else ui.loadFile(join(__dirname, '../renderer/index.html'))
}

function registerIpc(win: BrowserWindow, tabs: TabManager): void {
  const ui = win.webContents
  // Only the browser UI may drive the core; anything else sending on these channels is ignored.
  const on = (channel: string, handler: (arg: unknown) => void) =>
    ipcMain.on(channel, (event, arg) => {
      if (event.sender === ui) handler(arg)
    })
  const isId = (value: unknown): value is number => Number.isInteger(value)

  on('tabs:new', () => tabs.create())
  on('tabs:close', (id) => isId(id) && tabs.close(id))
  on('tabs:activate', (id) => isId(id) && tabs.activate(id))
  on('nav:go', (input) => {
    const url = typeof input === 'string' ? resolveInput(input) : null
    if (url) tabs.navigate(url)
  })
  on('nav:back', () => tabs.goBack())
  on('nav:forward', () => tabs.goForward())
  on('nav:reload', () => tabs.reload())
  on('nav:stop', () => tabs.stop())
  on('ui:chrome-height', (height) => {
    if (typeof height === 'number' && height >= 0 && height < 400)
      tabs.setChromeHeight(Math.round(height))
  })
  ipcMain.handle('history:complete', (event, text) =>
    event.sender === ui && typeof text === 'string' ? completeHistory(text) : null
  )
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) =>
    callback(ALLOWED_PERMISSIONS.has(permission))
  )
  session.defaultSession.setPermissionCheckHandler((_contents, permission) =>
    ALLOWED_PERMISSIONS.has(permission)
  )
  openHistory()
  createWindow()
})

app.on('window-all-closed', () => app.quit())
app.on('will-quit', () => closeHistory())
