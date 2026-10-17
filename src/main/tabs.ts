import { join } from 'node:path'
import { WebContentsView, type BrowserWindow, type Event, type Input } from 'electron'
import type { BrowserState, PerfTab } from '../shared/types'
import { userAgentFor } from './compat'
import { recordVisit, updateTitle } from './history'
import { getSettings } from './settings'
import { HOME_URL, isInternalUrl, isWebUrl } from './url'

type Tab = {
  id: number
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

const DEFAULT_CHROME_HEIGHT = 84

const backgroundFor = (url: string) => (isInternalUrl(url) ? '#0a0a0b' : '#ffffff')

type InputHandler = (event: Event, input: Input) => void

export class TabManager {
  private readonly tabs: Tab[] = []
  private readonly win: BrowserWindow
  private readonly onChange: (state: BrowserState) => void
  private readonly onInput: InputHandler
  private activeId = -1
  private nextId = 1
  private chromeHeight = DEFAULT_CHROME_HEIGHT

  constructor(win: BrowserWindow, onChange: (state: BrowserState) => void, onInput: InputHandler) {
    this.win = win
    this.onChange = onChange
    this.onInput = onInput
    win.on('resize', () => this.layout())
  }

  private get active(): Tab | undefined {
    return this.tabs.find((tab) => tab.id === this.activeId)
  }

  private get activeContents() {
    return this.active?.view?.webContents
  }

  private byId(id: number): Tab | undefined {
    return this.tabs.find((tab) => tab.id === id)
  }

  create(url = HOME_URL): void {
    const tab: Tab = {
      id: this.nextId++,
      view: null,
      title: '',
      url,
      favicon: '',
      loading: false,
      sleeping: false,
      loadStart: 0,
      loadMs: 0
    }
    this.tabs.push(tab)
    this.load(tab, url)
    this.activate(tab.id)
  }

  openOrActivate(url: string): void {
    const existing = this.tabs.find((tab) => tab.url === url)
    if (existing) this.activate(existing.id)
    else this.create(url)
  }

  close(id: number): void {
    const index = this.tabs.findIndex((tab) => tab.id === id)
    if (index === -1) return
    const tab = this.tabs[index]
    if (this.tabs.length === 1) this.create()
    else if (id === this.activeId) this.activate((this.tabs[index + 1] ?? this.tabs[index - 1]).id)
    this.tabs.splice(this.tabs.indexOf(tab), 1)
    clearTimeout(tab.sleepTimer)
    this.destroyView(tab)
    this.emit()
  }

  closeActive(): void {
    this.close(this.activeId)
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

  setChromeHeight(height: number): void {
    this.chromeHeight = height
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
    view.webContents.loadURL(url).catch(() => undefined)
    this.emit()
  }

  private createView(tab: Tab): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    tab.view = view
    const contents = view.webContents
    // Popups are denied and opened as regular tabs so web content never gets a window handle of ours.
    contents.setWindowOpenHandler(({ url }) => {
      if (isWebUrl(url)) this.create(url)
      return { action: 'deny' }
    })
    // Web pages may never navigate into internal ox:// pages.
    const guard = (event: Event, url: string) => {
      if (isInternalUrl(url) && !isInternalUrl(contents.getURL())) event.preventDefault()
    }
    contents.on('will-navigate', (event) => guard(event, event.url))
    contents.on('will-redirect', (event) => guard(event, event.url))
    contents.on('did-start-navigation', (event) => {
      if (event.isMainFrame && !event.isSameDocument) contents.setUserAgent(userAgentFor(event.url))
    })
    contents.on('before-input-event', this.onInput)
    contents.on('did-start-loading', () =>
      this.patch(tab, { loading: true, loadStart: Date.now() })
    )
    contents.on('did-stop-loading', () => {
      const loadMs = tab.loadStart ? Date.now() - tab.loadStart : tab.loadMs
      this.patch(tab, { loading: false, loadMs })
    })
    contents.on('page-title-updated', (_event, title) => {
      updateTitle(contents.getURL(), title)
      this.patch(tab, { title })
    })
    contents.on('page-favicon-updated', (_event, icons) => {
      this.patch(tab, { favicon: icons.find(isWebUrl) ?? '' })
    })
    contents.on('did-navigate', (_event, url) => {
      recordVisit(url, '')
      view.setBackgroundColor(backgroundFor(url))
      this.patch(tab, { url, favicon: '' })
    })
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (!isMainFrame) return
      recordVisit(url, '')
      this.patch(tab, { url })
    })
    this.win.contentView.addChildView(view)
    view.setVisible(tab.id === this.activeId)
    this.layout()
    return view
  }

  private patch(tab: Tab, changes: Partial<Tab>): void {
    Object.assign(tab, changes)
    this.emit()
  }

  private layout(): void {
    const view = this.active?.view
    if (!view) return
    const [width, height] = this.win.getContentSize()
    view.setBounds({
      x: 0,
      y: this.chromeHeight,
      width,
      height: Math.max(0, height - this.chromeHeight)
    })
  }

  private emit(): void {
    this.onChange({
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
