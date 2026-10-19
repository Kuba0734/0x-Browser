import { join } from 'node:path'
import {
  WebContentsView,
  type BrowserWindow,
  type Event,
  type ContextMenuParams,
  type Input,
  type WebContents
} from 'electron'
import type { BrowserState, PerfTab } from '../shared/types'
import { applyUserAgent, entersGoogleSignIn, userAgentFor } from './compat'
import { dispatchExtensionEvent } from './extensions'
import { cachedFavicon, resolveFavicon } from './favicons'
import { recordVisit, updateTitle } from './history'
import { getSettings } from './settings'
import { HOME_URL, isInternalUrl, isWebUrl } from './url'

export type Tab = {
  id: number
  owner: TabManager
  view: WebContentsView | null
  title: string
  url: string
  favicon: string
  loading: boolean
  sleeping: boolean
  loadStart: number
  loadMs: number
  sleepTimer?: NodeJS.Timeout
}

export type SavedWindow = { tabs: { url: string; title: string }[]; activeIndex: number }

type InputHandler = (event: Event, input: Input) => void

type Options = {
  onChange: (state: BrowserState) => void
  onInput: InputHandler
  canCloseWindow: () => boolean
  onContextMenu: (contents: WebContents, params: ContextMenuParams) => void
}

const DEFAULT_CHROME_HEIGHT = 84

const originOf = (url: string) => (isWebUrl(url) ? new URL(url).origin : '')

const backgroundFor = (url: string) => (isInternalUrl(url) ? '#0a0a0b' : '#ffffff')

let nextTabId = 1

const webPreferences = () => ({
  preload: join(__dirname, '../preload/index.js'),
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  plugins: true
})

function watchNavigation(contents: WebContents): void {
  // Web pages may never navigate into internal ox:// pages.
  const guard = (event: Event, url: string) => {
    if (isInternalUrl(url) && !isInternalUrl(contents.getURL())) event.preventDefault()
  }
  const setUserAgent = (event: { url: string; isMainFrame: boolean }) => {
    if (event.isMainFrame) applyUserAgent(contents, event.url)
  }
  const navigate = (event: Event & { url: string; isMainFrame: boolean }) => {
    guard(event, event.url)
    if (event.isMainFrame && entersGoogleSignIn(contents.getURL(), event.url)) {
      event.preventDefault()
      const { url } = event
      setImmediate(() =>
        contents.loadURL(url, { userAgent: userAgentFor(url) }).catch(() => undefined)
      )
      return
    }
    setUserAgent(event)
  }
  contents.on('will-navigate', navigate)
  contents.on('will-redirect', navigate)
  contents.on('did-start-navigation', (event) => {
    if (!event.isSameDocument) setUserAgent(event)
  })
}

export class TabManager {
  private readonly tabs: Tab[] = []
  private readonly win: BrowserWindow
  private readonly options: Options
  private activeId = -1
  private chromeHeight = DEFAULT_CHROME_HEIGHT
  private sidebarWidth = 0

  constructor(win: BrowserWindow, options: Options) {
    this.win = win
    this.options = options
    win.on('resize', () => this.layout())
  }

  private get active(): Tab | undefined {
    return this.tabs.find((tab) => tab.id === this.activeId)
  }

  get activeContents() {
    return this.active?.view?.webContents
  }

  private byId(id: number): Tab | undefined {
    return this.tabs.find((tab) => tab.id === id)
  }

  has(id: number): boolean {
    return !!this.byId(id)
  }

  owns(contents: WebContents): boolean {
    return this.tabs.some((tab) => tab.view?.webContents === contents)
  }

  get contentTop(): number {
    return this.chromeHeight
  }

  get contentLeft(): number {
    return this.sidebarWidth
  }

  get size(): number {
    return this.tabs.length
  }

  private newTab(url: string, title = '', sleeping = false): Tab {
    return {
      id: nextTabId++,
      owner: this,
      view: null,
      title,
      url,
      favicon: sleeping ? cachedFavicon(url) : '',
      loading: false,
      sleeping,
      loadStart: 0,
      loadMs: 0
    }
  }

  create(url = HOME_URL, index = this.tabs.length): void {
    const tab = this.newTab(url)
    this.tabs.splice(index, 0, tab)
    this.load(tab, url)
    this.activate(tab.id)
  }

  tabInfo(id: number) {
    const tab = this.byId(id)
    if (!tab) return null
    return {
      url: tab.url,
      index: this.tabs.indexOf(tab),
      count: this.tabs.length,
      active: tab.id === this.activeId,
      sleeping: tab.sleeping,
      muted: !!tab.view?.webContents.isAudioMuted()
    }
  }

  reloadTab(id: number): void {
    const tab = this.byId(id)
    if (tab?.view) tab.view.webContents.reload()
    else if (tab) this.activate(id)
  }

  duplicate(id: number): void {
    const tab = this.byId(id)
    if (tab) this.create(tab.url, this.tabs.indexOf(tab) + 1)
  }

  setMuted(id: number, muted: boolean): void {
    this.byId(id)?.view?.webContents.setAudioMuted(muted)
  }

  closeOthers(id: number): void {
    for (const tab of [...this.tabs]) if (tab.id !== id) this.close(tab.id)
  }

  closeToRight(id: number): void {
    const index = this.tabs.findIndex((tab) => tab.id === id)
    if (index >= 0) for (const tab of this.tabs.slice(index + 1)) this.close(tab.id)
  }

  snapshot(): SavedWindow {
    return {
      tabs: this.tabs.map(({ url, title }) => ({ url, title })),
      activeIndex: Math.max(
        0,
        this.tabs.findIndex((tab) => tab.id === this.activeId)
      )
    }
  }

  restore(saved: SavedWindow): boolean {
    for (const { url, title } of saved.tabs) this.tabs.push(this.newTab(url, title, true))
    if (!this.tabs.length) return false
    this.activate(this.tabs[Math.min(saved.activeIndex, this.tabs.length - 1)].id)
    return true
  }

  openOrActivate(url: string): void {
    const existing = this.tabs.find((tab) => tab.url === url)
    if (existing) this.activate(existing.id)
    else this.create(url)
  }

  close(id: number): void {
    const tab = this.byId(id)
    if (!tab) return
    if (this.tabs.length === 1 && this.options.canCloseWindow()) {
      this.win.close()
      return
    }
    this.release(tab)
    this.destroyView(tab)
    this.emit()
  }

  closeActive(): void {
    this.close(this.activeId)
  }

  move(id: number, index: number): void {
    const tab = this.byId(id)
    if (!tab) return
    this.tabs.splice(this.tabs.indexOf(tab), 1)
    this.tabs.splice(Math.max(0, Math.min(index, this.tabs.length)), 0, tab)
    this.emit()
  }

  detach(id: number, allowLast = false): Tab | null {
    const tab = this.byId(id)
    if (!tab || (this.tabs.length < 2 && !allowLast)) return null
    if (tab.view) this.win.contentView.removeChildView(tab.view)
    if (this.tabs.length === 1) {
      this.tabs.length = 0
      clearTimeout(tab.sleepTimer)
      setImmediate(() => this.win.close())
      return tab
    }
    this.release(tab)
    this.emit()
    return tab
  }

  adopt(tab: Tab, index = this.tabs.length): void {
    tab.owner = this
    this.tabs.splice(Math.max(0, Math.min(index, this.tabs.length)), 0, tab)
    if (tab.view) this.win.contentView.addChildView(tab.view)
    this.activate(tab.id)
  }

  destroyAll(): void {
    for (const tab of this.tabs) {
      clearTimeout(tab.sleepTimer)
      tab.view?.webContents.close()
    }
    this.tabs.length = 0
  }

  activate(id: number): void {
    const tab = this.byId(id)
    if (!tab) return
    const previous = this.active
    this.activeId = id
    clearTimeout(tab.sleepTimer)
    if (previous && previous !== tab) this.scheduleSleep(previous)
    if (tab.sleeping) this.wake(tab)
    for (const other of this.tabs) other.view?.setVisible(other.id === id)
    this.layout()
    if (tab.url === HOME_URL) this.win.webContents.focus()
    else tab.view?.webContents.focus()
    this.emit()
  }

  activateRelative(offset: number): void {
    const index = this.tabs.findIndex((tab) => tab.id === this.activeId)
    const count = this.tabs.length
    this.activate(this.tabs[(index + offset + count) % count].id)
  }

  activateIndex(index: number): void {
    const tab = index < 0 ? this.tabs.at(-1) : this.tabs[index]
    if (tab) this.activate(tab.id)
  }

  navigate(url: string): void {
    const tab = this.active
    if (tab) this.load(tab, url)
  }

  goBack(): void {
    this.activeContents?.navigationHistory.goBack()
  }

  goForward(): void {
    this.activeContents?.navigationHistory.goForward()
  }

  reload(ignoreCache = false): void {
    if (ignoreCache) this.activeContents?.reloadIgnoringCache()
    else this.activeContents?.reload()
  }

  stop(): void {
    this.activeContents?.stop()
  }

  toggleDevTools(): void {
    this.activeContents?.toggleDevTools()
  }

  setInsets(top: number, left: number): void {
    this.chromeHeight = top
    this.sidebarWidth = left
    this.layout()
  }

  sleep(id: number): void {
    const tab = this.byId(id)
    if (!tab || tab.id === this.activeId || tab.sleeping) return
    this.destroyView(tab)
    tab.sleeping = true
    tab.loading = false
    this.emit()
  }

  sleepInactive(): void {
    for (const tab of this.tabs) this.sleep(tab.id)
  }

  wakeTab(id: number): void {
    const tab = this.byId(id)
    if (tab?.sleeping) {
      this.wake(tab)
      this.emit()
    }
  }

  rescheduleSleep(): void {
    for (const tab of this.tabs) if (tab.id !== this.activeId) this.scheduleSleep(tab)
  }

  perfTabs(): (PerfTab & { pid: number })[] {
    return this.tabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      url: tab.url,
      active: tab.id === this.activeId,
      sleeping: tab.sleeping,
      memoryKB: 0,
      cpu: 0,
      loadMs: tab.loadMs,
      pid: tab.view?.webContents.getOSProcessId() ?? -1
    }))
  }

  private release(tab: Tab): void {
    const index = this.tabs.indexOf(tab)
    if (this.tabs.length === 1) this.create()
    else if (tab.id === this.activeId)
      this.activate((this.tabs[index + 1] ?? this.tabs[index - 1]).id)
    this.tabs.splice(this.tabs.indexOf(tab), 1)
    clearTimeout(tab.sleepTimer)
  }

  private wake(tab: Tab): void {
    tab.sleeping = false
    this.load(tab, tab.url)
  }

  private scheduleSleep(tab: Tab): void {
    clearTimeout(tab.sleepTimer)
    const minutes = getSettings().sleepAfterMinutes
    if (minutes <= 0 || tab.sleeping) return
    tab.sleepTimer = setTimeout(() => {
      if (tab.view?.webContents.isCurrentlyAudible()) this.scheduleSleep(tab)
      else this.sleep(tab.id)
    }, minutes * 60_000)
  }

  private destroyView(tab: Tab): void {
    if (!tab.view) return
    this.win.contentView.removeChildView(tab.view)
    tab.view.webContents.close()
    tab.view = null
  }

  private load(tab: Tab, url: string): void {
    const view = tab.view ?? this.createView(tab)
    tab.url = url
    view.setBackgroundColor(backgroundFor(url))
    view.webContents.loadURL(url, { userAgent: userAgentFor(url) }).catch(() => undefined)
    this.emit()
  }

  // Tabs can move between windows, so view events always go to the tab's current owner.
  private createView(tab: Tab): WebContentsView {
    const view = new WebContentsView({ webPreferences: webPreferences() })
    tab.view = view
    const contents = view.webContents
    const openTab = ({ url }: { url: string }) => {
      if (isWebUrl(url)) tab.owner.create(url)
      return { action: 'deny' as const }
    }
    // Sign-in flows ("Sign in with Google" etc.) need a real popup with window.opener, so window.open
    // with window features gets a sandboxed popup window; everything else opens as a regular tab.
    contents.setWindowOpenHandler((details) =>
      details.disposition === 'new-window' && isWebUrl(details.url)
        ? {
            action: 'allow',
            overrideBrowserWindowOptions: {
              autoHideMenuBar: true,
              backgroundColor: '#ffffff',
              webPreferences: webPreferences()
            }
          }
        : openTab(details)
    )
    contents.on('did-create-window', (popup, { url }) => {
      popup.removeMenu()
      popup.webContents.setWindowOpenHandler(openTab)
      watchNavigation(popup.webContents)
      applyUserAgent(popup.webContents, url)
      if (entersGoogleSignIn('', url))
        popup.webContents.loadURL(url, { userAgent: userAgentFor(url) }).catch(() => undefined)
    })
    watchNavigation(contents)
    const navigation = () => ({
      tabId: contents.id,
      frameId: 0,
      parentFrameId: -1,
      url: contents.getURL(),
      timeStamp: Date.now()
    })
    contents.on('did-navigate', () =>
      dispatchExtensionEvent('webNavigation.onCommitted', {
        ...navigation(),
        transitionType: 'link',
        transitionQualifiers: []
      })
    )
    contents.on('dom-ready', () =>
      dispatchExtensionEvent('webNavigation.onDOMContentLoaded', navigation())
    )
    contents.on('before-input-event', (event, input) => tab.owner.options.onInput(event, input))
    contents.on('context-menu', (_event, params) =>
      tab.owner.options.onContextMenu(contents, params)
    )
    contents.on('did-start-loading', () =>
      tab.owner.patch(tab, { loading: true, loadStart: Date.now() })
    )
    contents.on('did-stop-loading', () => {
      const loadMs = tab.loadStart ? Date.now() - tab.loadStart : tab.loadMs
      tab.owner.patch(tab, { loading: false, loadMs })
      if (!tab.favicon) tab.owner.updateFavicon(tab, [])
    })
    contents.on('page-title-updated', (_event, title) => {
      updateTitle(contents.getURL(), title)
      tab.owner.patch(tab, { title })
    })
    contents.on('page-favicon-updated', (_event, icons) => tab.owner.updateFavicon(tab, icons))
    contents.on('did-navigate', (_event, url) => {
      recordVisit(url, '')
      view.setBackgroundColor(backgroundFor(url))
      tab.owner.patch(tab, { url, favicon: cachedFavicon(url) })
    })
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (!isMainFrame) return
      recordVisit(url, '')
      tab.owner.patch(tab, { url })
    })
    this.win.contentView.addChildView(view)
    view.setVisible(tab.id === this.activeId)
    this.layout()
    return view
  }

  private updateFavicon(tab: Tab, candidates: string[]): void {
    const origin = originOf(tab.url)
    resolveFavicon(tab.url, candidates).then((favicon) => {
      if (favicon && originOf(tab.url) === origin && tab.owner.tabs.includes(tab))
        tab.owner.patch(tab, { favicon })
    })
  }

  private patch(tab: Tab, changes: Partial<Tab>): void {
    Object.assign(tab, changes)
    if (this.tabs.includes(tab)) this.emit()
  }

  private layout(): void {
    const view = this.active?.view
    if (!view || this.win.isDestroyed()) return
    const [width, height] = this.win.getContentSize()
    view.setBounds({
      x: this.sidebarWidth,
      y: this.chromeHeight,
      width: Math.max(0, width - this.sidebarWidth),
      height: Math.max(0, height - this.chromeHeight)
    })
  }

  private emit(): void {
    this.options.onChange({
      activeId: this.activeId,
      tabs: this.tabs.map((tab) => {
        const history = tab.view?.webContents.navigationHistory
        return {
          id: tab.id,
          title: tab.title,
          url: tab.url,
          favicon: tab.favicon,
          loading: tab.loading,
          sleeping: tab.sleeping,
          canGoBack: history?.canGoBack() ?? false,
          canGoForward: history?.canGoForward() ?? false
        }
      })
    })
  }
}
