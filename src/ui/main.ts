import { api } from '../shared/client'
import { icon, type IconName } from '../shared/icons'
import { applySettings, type Settings } from '../shared/settings'
import type {
  BookmarkNode,
  BrowserState,
  Completion,
  DownloadState,
  ExtensionInfo,
  TabState,
  UpdateState
} from '../shared/types'

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const chrome = byId('chrome')
const tabsEl = byId('tabs')
const backButton = byId<HTMLButtonElement>('back')
const forwardButton = byId<HTMLButtonElement>('forward')
const reloadButton = byId<HTMLButtonElement>('reload')
const addressForm = byId<HTMLFormElement>('address-form')
const address = byId<HTMLInputElement>('address')
const starButton = byId<HTMLButtonElement>('star')
const progress = byId('progress')
const bookmarkBar = byId('bookmark-bar')
const downloadsButton = byId<HTMLButtonElement>('downloads-button')
const downloadProgress = downloadsButton.querySelector('.download-progress > span') as HTMLElement
const extensionActions = byId('extension-actions')
const updateButton = byId<HTMLButtonElement>('update-button')

const INTERNAL = 'ox://'
const HOME = 'ox://home/'
const sessionStart = Date.now()

const tabEls = new Map<number, HTMLElement>()
let state: BrowserState = { tabs: [], activeId: -1 }
let completion: (Completion & { shown: string }) | null = null
let bookmarkedUrls = new Set<string>()
let barNodes: BookmarkNode[] = []
let showBar = false

for (const el of document.querySelectorAll<HTMLElement>('[data-icon]'))
  el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon as IconName))

const activeTab = (): TabState | undefined => state.tabs.find((tab) => tab.id === state.activeId)

function displayUrl(url: string): string {
  if (url === HOME) return ''
  return url.startsWith(INTERNAL) ? `0x://${url.slice(INTERNAL.length).replace(/\/$/, '')}` : url
}

function tabTitle(tab: TabState): string {
  if (tab.title) return tab.title
  if (tab.url === HOME) return 'Home'
  return displayUrl(tab.url) || 'New Tab'
}

function createTabEl(id: number): HTMLElement {
  const el = document.createElement('div')
  el.className = 'tab'
  el.setAttribute('role', 'tab')
  el.innerHTML = `<span class="tab-icon"><span class="tab-glyph"></span><img alt="" hidden><span class="spinner"></span></span><span class="tab-title"></span><button class="tab-close" title="Close tab" aria-label="Close tab">${icon('close')}</button>`
  el.addEventListener('mousedown', (event) => {
    if (event.button === 0) api.tabs.activate(id)
  })
  el.addEventListener('auxclick', (event) => {
    if (event.button === 1) api.tabs.close(id)
  })
  const close = el.querySelector('.tab-close') as HTMLButtonElement
  close.addEventListener('mousedown', (event) => event.stopPropagation())
  close.addEventListener('click', () => api.tabs.close(id))
  const img = el.querySelector('img') as HTMLImageElement
  img.addEventListener('error', () => {
    img.hidden = true
    el.classList.remove('has-favicon')
  })
  return el
}

function updateTabEl(el: HTMLElement, tab: TabState): void {
  const active = tab.id === state.activeId
  el.classList.toggle('active', active)
  el.classList.toggle('loading', tab.loading)
  el.classList.toggle('sleeping', tab.sleeping)
  el.setAttribute('aria-selected', String(active))
  const title = tabTitle(tab)
  const titleEl = el.querySelector('.tab-title') as HTMLElement
  if (titleEl.textContent !== title) titleEl.textContent = title
  el.title = tab.sleeping ? `${title} (sleeping)` : title
  const glyph = el.querySelector('.tab-glyph') as HTMLElement
  const glyphName = tab.url.startsWith(INTERNAL) ? 'logo' : 'globe'
  if (glyph.dataset.name !== glyphName) {
    glyph.dataset.name = glyphName
    glyph.innerHTML = icon(glyphName)
  }
  const img = el.querySelector('img') as HTMLImageElement
  if (img.getAttribute('src') !== tab.favicon) {
    if (tab.favicon) img.src = tab.favicon
    else img.removeAttribute('src')
    img.hidden = !tab.favicon
    el.classList.toggle('has-favicon', !!tab.favicon)
  }
}

function renderTabs(): void {
  const ids = new Set(state.tabs.map((tab) => tab.id))
  for (const [id, el] of tabEls) {
    if (ids.has(id)) continue
    tabEls.delete(id)
    el.classList.add('leaving')
    el.addEventListener('animationend', () => el.remove(), { once: true })
  }
  for (const tab of state.tabs) {
    let el = tabEls.get(tab.id)
    if (!el) {
      el = createTabEl(tab.id)
      tabEls.set(tab.id, el)
      tabsEl.append(el)
    }
    updateTabEl(el, tab)
  }
}

function renderStar(): void {
  const tab = activeTab()
  const canBookmark = !!tab && tab.url !== HOME && !!tab.url
  const bookmarked = canBookmark && bookmarkedUrls.has(tab.url)
  starButton.hidden = !canBookmark
  starButton.classList.toggle('active', bookmarked)
  starButton.setAttribute('aria-pressed', String(bookmarked))
  starButton.title = bookmarked ? 'Remove bookmark' : 'Bookmark this page'
}

function renderToolbar(activeChanged: boolean): void {
  const tab = activeTab()
  backButton.disabled = !tab?.canGoBack
  forwardButton.disabled = !tab?.canGoForward
  reloadButton.classList.toggle('loading', !!tab?.loading)
  reloadButton.title = tab?.loading ? 'Stop' : 'Reload'
  progress.classList.toggle('active', !!tab?.loading)
  const editing = document.hasFocus() && document.activeElement === address
  if (activeChanged || !editing) {
    address.value = displayUrl(tab?.url ?? '')
    completion = null
  }
  if (activeChanged && tab?.url === HOME) address.focus()
  renderStar()
}

function collectUrls(node: BookmarkNode, urls: Set<string>): Set<string> {
  if (node.url) urls.add(node.url)
  for (const child of node.children ?? []) collectUrls(child, urls)
  return urls
}

let reportedHeight = -1

// The tab view covers the UI until it knows the chrome height, and a covered UI does not render,
// so ResizeObserver alone never fires at startup. Measure synchronously instead.
function reportChromeHeight(): void {
  const height = chrome.offsetHeight
  if (height === reportedHeight) return
  reportedHeight = height
  api.ui.setChromeHeight(height)
}

function renderBookmarkBar(): void {
  bookmarkBar.hidden = !showBar || barNodes.length === 0
  bookmarkBar.replaceChildren(
    ...barNodes.map((node) => {
      const item = document.createElement('button')
      item.className = 'bookmark-item'
      item.title = node.url ? `${node.title}\n${displayUrl(node.url)}` : node.title
      item.innerHTML = icon(node.children ? 'folder' : 'globe')
      const label = document.createElement('span')
      label.textContent = node.title || displayUrl(node.url ?? '')
      item.append(label)
      item.addEventListener('click', () => {
        if (node.url) api.nav.go(node.url)
        else {
          const rect = item.getBoundingClientRect()
          api.ui.bookmarkMenu(node.id, rect.left, rect.bottom)
        }
      })
      item.addEventListener('auxclick', (event) => {
        if (event.button === 1 && node.url) api.tabs.create(node.url)
      })
      item.addEventListener('contextmenu', (event) => {
        event.preventDefault()
        api.ui.bookmarkContext(node.id, event.clientX, event.clientY)
      })
      return item
    })
  )
  reportChromeHeight()
}

function applyBookmarks(tree: BookmarkNode): void {
  bookmarkedUrls = collectUrls(tree, new Set())
  barNodes = tree.children?.find((child) => child.id === 'bar')?.children ?? []
  renderBookmarkBar()
  renderStar()
}

function applyDownloads(list: DownloadState[]): void {
  const active = list.filter((item) => item.state === 'progressing' || item.state === 'paused')
  const recent = list.some((item) => item.startTime >= sessionStart)
  downloadsButton.hidden = !recent && active.length === 0
  const total = active.reduce((sum, item) => sum + item.totalBytes, 0)
  const received = active.reduce((sum, item) => sum + item.receivedBytes, 0)
  downloadsButton.classList.toggle('active', active.length > 0)
  downloadProgress.style.transform = `scaleX(${total ? received / total : active.length ? 0.1 : 1})`
}

function applyExtensions(list: ExtensionInfo[]): void {
  extensionActions.replaceChildren(
    ...list
      .filter((extension) => extension.enabled && extension.hasPopup)
      .map((extension) => {
        const button = document.createElement('button')
        button.className = 'icon-btn extension-action'
        button.title = extension.name
        button.setAttribute('aria-label', extension.name)
        if (extension.icon) {
          const img = document.createElement('img')
          img.src = extension.icon
          img.alt = ''
          button.append(img)
        } else button.innerHTML = icon('extensions')
        button.addEventListener('click', () => {
          const rect = button.getBoundingClientRect()
          api.ui.extensionPopup(extension.id, rect.right, rect.bottom + 4)
        })
        return button
      })
  )
}

function applyUiSettings(settings: Settings): void {
  applySettings(settings)
  showBar = settings.showBookmarkBar
  renderBookmarkBar()
}

function applyUpdate(update: UpdateState): void {
  updateButton.hidden = update.status !== 'ready'
  updateButton.title = `Restart to update to ${update.version}`
}

api.tabs.onState((next) => {
  const activeChanged = next.activeId !== state.activeId
  state = next
  renderTabs()
  renderToolbar(activeChanged)
})
api.ui.onFocusAddress(() => {
  address.focus()
  address.select()
})
api.bookmarks.onChange(applyBookmarks)
api.downloads.onChange(applyDownloads)
api.extensions.onChange(applyExtensions)
api.settings.onChange(applyUiSettings)

api.updates.onChange(applyUpdate)

api.settings.get().then(applyUiSettings)
api.updates.state().then(applyUpdate)
api.bookmarks.tree().then(applyBookmarks)
api.downloads.list().then(applyDownloads)
api.extensions.list().then(applyExtensions)

address.addEventListener('mousedown', (event) => {
  if (document.activeElement === address) return
  event.preventDefault()
  address.focus()
  address.select()
})

address.addEventListener('input', async (event) => {
  completion = null
  const inputEvent = event as InputEvent
  if (inputEvent.isComposing || inputEvent.inputType.startsWith('delete')) return
  const typed = address.value
  if (address.selectionEnd !== typed.length) return
  const result = await api.history.complete(typed)
  if (!result || address.value !== typed) return
  const typedBare = typed.trim().replace(/^https?:\/\/(www\.)?/i, '')
  if (!result.bare.toLowerCase().startsWith(typedBare.toLowerCase())) return
  const rest = result.bare.slice(typedBare.length)
  if (!rest) return
  address.value = typed + rest
  address.setSelectionRange(typed.length, address.value.length)
  completion = { ...result, shown: address.value }
})

address.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return
  address.value = displayUrl(activeTab()?.url ?? '')
  completion = null
  address.select()
})

addressForm.addEventListener('submit', (event) => {
  event.preventDefault()
  const input = completion?.shown === address.value ? completion.url : address.value
  if (!input.trim()) return
  api.nav.go(input)
  completion = null
  address.blur()
})

starButton.addEventListener('click', () => {
  const tab = activeTab()
  if (tab?.url) api.bookmarks.toggle(tab.url, tab.title)
})

byId('new-tab').addEventListener('click', () => api.tabs.create())
byId('home').addEventListener('click', () => api.nav.go('0x://home'))
backButton.addEventListener('click', () => api.nav.back())
forwardButton.addEventListener('click', () => api.nav.forward())
reloadButton.addEventListener('click', () =>
  activeTab()?.loading ? api.nav.stop() : api.nav.reload()
)
updateButton.addEventListener('click', () => api.updates.install())
downloadsButton.addEventListener('click', () => api.tabs.openInternal('downloads'))
byId('menu-button').addEventListener('click', (event) => {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  api.ui.menu(rect.left, rect.bottom + 4)
})

reportChromeHeight()
new ResizeObserver(reportChromeHeight).observe(chrome)
