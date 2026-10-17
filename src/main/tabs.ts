import { WebContentsView, type BrowserWindow, type Event, type Input } from 'electron'
import type { BrowserState } from '../shared/types'
import { recordVisit, updateTitle } from './history'
import { isWebUrl } from './url'

type Tab = {
  id: number
  view: WebContentsView | null
  title: string
  url: string
  favicon: string
  loading: boolean
}

type InputHandler = (event: Event, input: Input) => void

export class TabManager {
  private readonly tabs: Tab[] = []
  private readonly win: BrowserWindow
  private readonly onChange: (state: BrowserState) => void
  private readonly onInput: InputHandler
  private activeId = -1
  private nextId = 1
  private chromeHeight = 0

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

  create(url = ''): void {
    const tab: Tab = {
      id: this.nextId++,
      view: null,
      title: '',
      url: '',
      favicon: '',
      loading: false
    }
    this.tabs.push(tab)
    this.activate(tab.id)
    if (url) this.load(tab, url)
  }

  close(id: number): void {
    const index = this.tabs.findIndex((tab) => tab.id === id)
    if (index === -1) return
    const [tab] = this.tabs.splice(index, 1)
    if (tab.view) {
      this.win.contentView.removeChildView(tab.view)
      tab.view.webContents.close()
    }
    if (this.tabs.length === 0) {
      this.win.close()
      return
    }
    if (id === this.activeId) this.activate(this.tabs[Math.min(index, this.tabs.length - 1)].id)
    else this.emit()
  }

  closeActive(): void {
    this.close(this.activeId)
  }

  activate(id: number): void {
    if (!this.tabs.some((tab) => tab.id === id)) return
    this.activeId = id
    for (const tab of this.tabs) tab.view?.setVisible(tab.id === id)
    this.layout()
    const contents = this.activeContents
    if (contents) contents.focus()
    else this.win.webContents.focus()
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

  private load(tab: Tab, url: string): void {
    const view = tab.view ?? this.createView(tab)
    tab.url = url
    view.webContents.loadURL(url).catch(() => undefined)
    this.emit()
  }

  private createView(tab: Tab): WebContentsView {
    const view = new WebContentsView({
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    tab.view = view
    const contents = view.webContents
    // Popups are denied and opened as regular tabs so web content never gets a window handle of ours.
    contents.setWindowOpenHandler(({ url }) => {
      if (isWebUrl(url)) this.create(url)
      return { action: 'deny' }
    })
    contents.on('before-input-event', this.onInput)
    contents.on('did-start-loading', () => this.patch(tab, { loading: true }))
    contents.on('did-stop-loading', () => this.patch(tab, { loading: false }))
    contents.on('page-title-updated', (_event, title) => {
      updateTitle(contents.getURL(), title)
      this.patch(tab, { title })
    })
    contents.on('page-favicon-updated', (_event, icons) => {
      this.patch(tab, { favicon: icons.find(isWebUrl) ?? '' })
    })
    contents.on('did-navigate', (_event, url) => {
      recordVisit(url, '')
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
          canGoBack: history?.canGoBack() ?? false,
          canGoForward: history?.canGoForward() ?? false
        }
      })
    })
  }
}
