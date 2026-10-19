import { draggableBookmark, folderDropTarget } from '../shared/bookmark-drag'
import { api } from '../shared/client'
import { icon, type IconName } from '../shared/icons'
import { applySettings, SEARCH_ENGINES, type Settings } from '../shared/settings'
import { storeTarget, type StoreTarget } from '../shared/stores'
import { buildSuggestions } from '../shared/suggestions'
import type {
  BookmarkNode,
  BrowserState,
  Completion,
  DownloadState,
  ExtensionInfo,
  Suggestion,
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
const downloadLabel = downloadsButton.querySelector('.download-label') as HTMLElement
const seenFinished = new Set<string>()
let downloadsInitialized = false
const extensionActions = byId('extension-actions')
const extensionsButton = byId<HTMLButtonElement>('extensions-button')
const updateButton = byId<HTMLButtonElement>('update-button')
const updateLabel = updateButton.querySelector('.update-label') as HTMLElement
const updateProgress = updateButton.querySelector('.update-progress > span') as HTMLElement
const storeButton = byId<HTMLButtonElement>('store-install')
const storeLabel = storeButton.querySelector('.store-label') as HTMLElement
const sidebar = byId('sidebar')
const sidebarList = byId('sidebar-sites')
const sidebarAdd = byId<HTMLButtonElement>('sidebar-add')
let sidebarSites: string[] | null = null

const INTERNAL = 'ox://'
const HOME = 'ox://home/'

const tabEls = new Map<number, HTMLElement>()
let state: BrowserState = { tabs: [], activeId: -1 }
let completion: (Completion & { shown: string }) | null = null
let bookmarkedUrls = new Set<string>()
let barNodes: BookmarkNode[] = []
let showBar = false
let installedIds = new Set<string>()
let storeBusy = false
const installedPages = new Set<string>()

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
  el.draggable = true
  el.addEventListener('mousedown', (event) => {
    if (event.button === 0) api.tabs.activate(id)
  })
  el.addEventListener('dragstart', (event) => startTabDrag(id, el, event))
  el.addEventListener('dragend', endTabDrag)
  el.addEventListener('animationend', () => el.classList.add('settled'), { once: true })
  el.addEventListener('auxclick', (event) => {
    if (event.button === 1) closeTab(id)
  })
  el.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    api.ui.tabMenu(id, event.clientX, event.clientY)
  })
  const close = el.querySelector('.tab-close') as HTMLButtonElement
  close.addEventListener('mousedown', (event) => event.stopPropagation())
  close.draggable = false
  close.addEventListener('click', () => closeTab(id))
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

function flipTabs(change: () => void): void {
  const before = new Map([...tabEls].map(([id, el]) => [id, el.getBoundingClientRect().left]))
  change()
  const style = getComputedStyle(document.documentElement)
  const duration = parseFloat(style.getPropertyValue('--duration-base')) || 0
  const easing = style.getPropertyValue('--ease').trim()
  for (const [id, el] of tabEls) {
    const left = before.get(id)
    if (left === undefined) continue
    const dx = left - el.getBoundingClientRect().left
    if (Math.abs(dx) < 1) continue
    el.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration, easing })
  }
}

let tabWidthsLocked = false

function lockTabWidths(): void {
  if (tabWidthsLocked) return
  tabWidthsLocked = true
  for (const el of tabEls.values()) el.style.flex = `0 0 ${el.offsetWidth}px`
}

function unlockTabWidths(): void {
  if (!tabWidthsLocked) return
  tabWidthsLocked = false
  flipTabs(() => {
    for (const el of tabEls.values()) el.style.flex = ''
  })
}

function closeTab(id: number): void {
  lockTabWidths()
  api.tabs.close(id)
}

function renderTabs(): void {
  flipTabs(() => {
    const ids = new Set(state.tabs.map((tab) => tab.id))
    for (const [id, el] of tabEls) {
      if (ids.has(id)) continue
      tabEls.delete(id)
      const { offsetLeft, offsetWidth } = el
      Object.assign(el.style, {
        position: 'absolute',
        left: `${offsetLeft}px`,
        width: `${offsetWidth}px`
      })
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
    if (draggedTab) return
    const ordered = state.tabs.map((tab) => tabEls.get(tab.id)!)
    const current = [...tabsEl.querySelectorAll('.tab:not(.leaving)')]
    if (ordered.some((el, index) => current[index] !== el)) tabsEl.append(...ordered)
  })
}

// Native drag and drop keeps working outside the window and across windows, unlike pointer events.
const TAB_MIME = 'application/x-0x-tab'
let draggedTab: { id: number; el: HTMLElement; dropped: boolean } | null = null
const dropMarker = document.createElement('div')
dropMarker.className = 'drop-marker'

const visibleTabs = () => [...tabsEl.querySelectorAll<HTMLElement>('.tab:not(.leaving)')]
const middle = (el: HTMLElement) => el.getBoundingClientRect().left + el.offsetWidth / 2

function dropIndex(clientX: number, tabs = visibleTabs()): number {
  return tabs.filter((el) => middle(el) < clientX).length
}

function startTabDrag(id: number, el: HTMLElement, event: DragEvent): void {
  if (!event.dataTransfer) return
  draggedTab = { id, el, dropped: false }
  event.dataTransfer.setData(TAB_MIME, String(id))
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setDragImage(el, event.offsetX, event.offsetY)
  requestAnimationFrame(() => el.classList.add('dragging'))
}

function endTabDrag(event: DragEvent): void {
  const drag = draggedTab
  draggedTab = null
  if (!drag) return
  drag.el.classList.remove('dragging')
  if (!drag.dropped && event.dataTransfer?.dropEffect === 'none') api.tabs.detach(drag.id)
  renderTabs()
}

function reorderDragged(clientX: number): void {
  const drag = draggedTab!
  const others = visibleTabs().filter((el) => el !== drag.el)
  const index = dropIndex(clientX, others)
  if (visibleTabs().indexOf(drag.el) === index) return
  flipTabs(() => {
    const reference = others[index]
    if (reference) reference.before(drag.el)
    else others.at(-1)?.after(drag.el)
  })
}

function showDropMarker(clientX: number): void {
  const tabs = visibleTabs()
  const index = dropIndex(clientX, tabs)
  const strip = tabsEl.getBoundingClientRect()
  const edge =
    tabs[index]?.getBoundingClientRect().left ?? tabs.at(-1)?.getBoundingClientRect().right
  dropMarker.style.transform = `translateX(${(edge ?? strip.left) - strip.left - 1}px)`
  if (!dropMarker.isConnected) tabsEl.append(dropMarker)
}

tabsEl.addEventListener('dragover', (event) => {
  if (!event.dataTransfer?.types.includes(TAB_MIME)) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
  if (draggedTab) reorderDragged(event.clientX)
  else showDropMarker(event.clientX)
})

tabsEl.addEventListener('dragleave', (event) => {
  if (!tabsEl.contains(event.relatedTarget as Node | null)) dropMarker.remove()
})

tabsEl.addEventListener('drop', (event) => {
  const id = Number(event.dataTransfer?.getData(TAB_MIME))
  dropMarker.remove()
  if (!Number.isInteger(id) || id <= 0) return
  event.preventDefault()
  if (draggedTab) {
    draggedTab.dropped = true
    api.tabs.move(id, visibleTabs().indexOf(draggedTab.el))
  } else api.tabs.attach(id, dropIndex(event.clientX))
})

function renderStar(): void {
  const tab = activeTab()
  const canBookmark = !!tab && tab.url !== HOME && !!tab.url
  const bookmarked = canBookmark && bookmarkedUrls.has(tab.url)
  starButton.hidden = !canBookmark
  starButton.classList.toggle('active', bookmarked)
  starButton.setAttribute('aria-pressed', String(bookmarked))
  starButton.title = bookmarked ? 'Remove bookmark' : 'Bookmark this page'
}

const storeKey = (target: StoreTarget) => `${target.store}:${target.key}`

function renderStoreButton(): void {
  const url = activeTab()?.url ?? ''
  const target = url.startsWith('https://') ? storeTarget(url) : null
  const installed =
    !!target &&
    (installedPages.has(storeKey(target)) ||
      (target.store !== 'opera' && installedIds.has(target.key)))
  storeButton.hidden = !target || installed
  storeButton.dataset.url = target ? url : ''
  if (storeBusy) return
  storeButton.disabled = false
  storeLabel.textContent = 'Add to 0x'
}

function renderToolbar(activeChanged: boolean): void {
  const tab = activeTab()
  backButton.disabled = !tab?.canGoBack
  forwardButton.disabled = !tab?.canGoForward
  reloadButton.classList.toggle('loading', !!tab?.loading)
  reloadButton.title = tab?.loading ? 'Stop' : 'Reload'
  progress.classList.toggle('active', !!tab?.loading)
  updateSidebarAdd()
  const editing = document.hasFocus() && document.activeElement === address
  if (activeChanged || !editing) {
    address.value = displayUrl(tab?.url ?? '')
    completion = null
  }
  if (activeChanged && tab?.url === HOME) address.focus()
  renderStar()
  renderStoreButton()
}

function collectUrls(node: BookmarkNode, urls: Set<string>): Set<string> {
  if (node.url) urls.add(node.url)
  for (const child of node.children ?? []) collectUrls(child, urls)
  return urls
}

let favicons: Record<string, string> = {}

function faviconFor(url: string): string {
  try {
    return favicons[new URL(url).origin] ?? ''
  } catch {
    return ''
  }
}

let reportedInsets = ''

// The tab view covers the UI until it knows the chrome height, and a covered UI does not render,
// so ResizeObserver alone never fires at startup. Measure synchronously instead.
function reportChromeHeight(): void {
  const height = chrome.offsetHeight
  const left = sidebar.hidden ? 0 : sidebar.offsetWidth
  if (`${height},${left}` === reportedInsets) return
  reportedInsets = `${height},${left}`
  document.documentElement.style.setProperty('--chrome-height', `${height}px`)
  api.ui.setInsets(height, left)
}

function updateSidebarAdd(): void {
  const url = activeTab()?.url ?? ''
  const added = !!sidebarSites?.includes(url)
  sidebarAdd.disabled = !/^https?:/.test(url) || added
  sidebarAdd.title = added
    ? 'This site is already in the sidebar'
    : sidebarAdd.disabled
      ? 'Open a website to add it to the sidebar'
      : 'Add current site to sidebar'
}

function renderSidebar(): void {
  updateSidebarAdd()
  sidebar.hidden = !sidebarSites
  sidebarList.replaceChildren(
    ...(sidebarSites ?? []).map((url) => {
      const item = document.createElement('button')
      item.className = 'icon-btn sidebar-site'
      item.title = displayUrl(url)
      item.setAttribute('aria-label', displayUrl(url))
      const favicon = faviconFor(url)
      if (favicon) {
        const img = document.createElement('img')
        img.src = favicon
        img.alt = ''
        item.append(img)
      } else item.innerHTML = icon('globe')
      item.addEventListener('click', () => api.nav.go(url))
      item.addEventListener('auxclick', (event) => {
        if (event.button === 1) api.tabs.create(url)
      })
      item.addEventListener('contextmenu', (event) => {
        event.preventDefault()
        api.ui.sidebarContext(url, event.clientX, event.clientY)
      })
      return item
    })
  )
  reportChromeHeight()
}

const moveBookmark = (id: string, parentId: string, index?: number) =>
  api.bookmarks.move(id, parentId, index).catch(() => undefined)

folderDropTarget(bookmarkBar, (id) => moveBookmark(id, 'bar'))

function renderBookmarkBar(): void {
  bookmarkBar.hidden = !showBar || barNodes.length === 0
  bookmarkBar.replaceChildren(
    ...barNodes.map((node, index) => {
      const item = document.createElement('button')
      item.className = 'bookmark-item'
      draggableBookmark(item, node.id, {
        horizontal: true,
        folder: !!node.children,
        onDrop: (id, position) =>
          moveBookmark(
            id,
            position === 'into' ? node.id : 'bar',
            position === 'into' ? undefined : index + (position === 'after' ? 1 : 0)
          )
      })
      item.title = node.url ? `${node.title}\n${displayUrl(node.url)}` : node.title
      const favicon = node.url ? faviconFor(node.url) : ''
      if (favicon) {
        const img = document.createElement('img')
        img.className = 'bookmark-favicon'
        img.src = favicon
        img.alt = ''
        item.append(img)
      } else item.innerHTML = icon(node.children ? 'folder' : 'globe')
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
  const total = active.reduce((sum, item) => sum + item.totalBytes, 0)
  const received = active.reduce((sum, item) => sum + item.receivedBytes, 0)
  const busy = active.length > 0
  const percent = total ? Math.floor((received / total) * 100) : 0
  downloadsButton.classList.toggle('active', busy)
  downloadProgress.style.transform = `scaleX(${total ? received / total : busy ? 0.1 : 1})`
  downloadLabel.textContent = busy
    ? `${active.length > 1 ? `${active.length} · ` : ''}${percent} %`
    : ''
  const speed = active.reduce((sum, item) => sum + item.speed, 0)
  const names = active.map((item) => item.filename).join(', ')
  downloadsButton.title = busy
    ? `${names}${speed ? ` · ${(speed / 1048576).toFixed(1)} MB/s` : ''}`
    : 'Downloads'
  const finished = list.some((item) => item.state === 'completed' && !seenFinished.has(item.id))
  for (const item of list) if (item.state === 'completed') seenFinished.add(item.id)
  if (finished && downloadsInitialized) {
    downloadsButton.classList.remove('done')
    void downloadsButton.offsetWidth
    downloadsButton.classList.add('done')
  }
  downloadsInitialized = true
}

function applyExtensions(list: ExtensionInfo[]): void {
  installedIds = new Set(list.map((extension) => extension.id))
  renderStoreButton()
  extensionsButton.hidden = !list.some((extension) => extension.enabled)
  extensionActions.replaceChildren(
    ...list
      .filter((extension) => extension.enabled && extension.pinned)
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
          if (extension.hasPopup) api.ui.extensionPopup(extension.id, rect.right, rect.bottom + 4)
          else if (extension.optionsUrl) api.extensions.options(extension.id)
        })
        return button
      })
  )
}

let currentSettings: Settings | null = null

function applyUiSettings(settings: Settings): void {
  currentSettings = settings
  applySettings(settings)
  showBar = settings.showBookmarkBar
  renderBookmarkBar()
  sidebarSites = settings.showSidebar ? settings.sidebarSites : null
  renderSidebar()
}

function applyUpdate(update: UpdateState): void {
  const downloading = update.status === 'downloading'
  const ready = update.status === 'ready'
  updateButton.hidden = !downloading && !ready
  updateButton.disabled = !ready
  updateButton.classList.toggle('ready', ready)
  updateLabel.textContent = ready
    ? 'Restart to update'
    : `Downloading ${update.version} · ${Math.round(update.progress)} %`
  updateButton.title = ready
    ? `Version ${update.version} is ready. Restart to install it.`
    : `Version ${update.version} is downloading in the background`
  updateProgress.style.transform = `scaleX(${ready ? 1 : update.progress / 100})`
}

api.tabs.onState((next) => {
  const activeChanged = next.activeId !== state.activeId
  state = next
  if (activeChanged) hideSuggestions()
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
api.favicons.all().then((all) => {
  favicons = all
  renderBookmarkBar()
  renderSidebar()
})
api.favicons.onUpdate(([origin, favicon]) => {
  favicons[origin] = favicon
  if (barNodes.some((node) => node.url && faviconFor(node.url) === favicon)) renderBookmarkBar()
  if (sidebarSites?.some((url) => faviconFor(url) === favicon)) renderSidebar()
})
sidebarAdd.addEventListener('click', () => api.ui.addToSidebar())
api.downloads.list().then(applyDownloads)
api.extensions.list().then(applyExtensions)

address.addEventListener('mousedown', (event) => {
  if (document.activeElement === address) return
  event.preventDefault()
  address.focus()
  address.select()
})

let suggestions: Suggestion[] = []
let selectedSuggestion = -1
let typedText = ''
let suggestRequest = 0

function showSuggestions(): void {
  if (!suggestions.length || document.activeElement !== address) return hideSuggestions()
  const rect = address.getBoundingClientRect()
  api.ui.showSuggestions(
    suggestions,
    selectedSuggestion,
    rect.left - 4,
    rect.bottom + 4,
    rect.width + 8
  )
}

function hideSuggestions(): void {
  suggestRequest++
  if (!suggestions.length) return
  suggestions = []
  selectedSuggestion = -1
  api.ui.hideSuggestions()
}

async function updateSuggestions(typed: string): Promise<void> {
  const request = ++suggestRequest
  const text = typed.trim()
  if (!text) return hideSuggestions()
  const [history, search] = await Promise.all([api.history.search(text), api.search.suggest(text)])
  if (request !== suggestRequest) return
  const engine = SEARCH_ENGINES[currentSettings?.searchEngine ?? 'google'].name
  suggestions = buildSuggestions(text, engine, history, search, faviconFor, displayUrl)
  selectedSuggestion = -1
  typedText = typed
  showSuggestions()
}

address.addEventListener('input', async (event) => {
  completion = null
  updateSuggestions(address.value)
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
  if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && suggestions.length) {
    event.preventDefault()
    const step = event.key === 'ArrowDown' ? 1 : -1
    const count = suggestions.length
    selectedSuggestion = ((selectedSuggestion + 1 + step + count + 1) % (count + 1)) - 1
    completion = null
    address.value = selectedSuggestion < 0 ? typedText : suggestions[selectedSuggestion].input
    showSuggestions()
    return
  }
  if (event.key !== 'Escape') return
  if (suggestions.length) {
    address.value = typedText
    hideSuggestions()
    return
  }
  address.value = displayUrl(activeTab()?.url ?? '')
  completion = null
  address.select()
})

addressForm.addEventListener('submit', (event) => {
  event.preventDefault()
  const picked = suggestions[selectedSuggestion]
  const input = picked
    ? picked.input
    : completion?.shown === address.value
      ? completion.url
      : address.value
  if (!input.trim()) return
  api.nav.go(input)
  completion = null
  hideSuggestions()
  address.blur()
})

starButton.addEventListener('click', () => {
  const tab = activeTab()
  if (tab?.url) api.bookmarks.toggle(tab.url, tab.title)
})

byId('new-tab').addEventListener('click', () => api.tabs.create())
byId('tabstrip').addEventListener('mouseleave', unlockTabWidths)
byId('home').addEventListener('click', () => api.nav.go('0x://home'))
backButton.addEventListener('click', () => api.nav.back())
forwardButton.addEventListener('click', () => api.nav.forward())
reloadButton.addEventListener('click', () =>
  activeTab()?.loading ? api.nav.stop() : api.nav.reload()
)
updateButton.addEventListener('click', () => api.updates.install())
storeButton.addEventListener('click', async () => {
  const url = storeButton.dataset.url
  const target = url ? storeTarget(url) : null
  if (!url || !target || storeBusy) return
  storeBusy = true
  storeButton.disabled = true
  storeLabel.textContent = 'Installing…'
  try {
    await api.extensions.installStore(url)
    installedPages.add(storeKey(target))
    storeBusy = false
    renderStoreButton()
  } catch {
    storeBusy = false
    storeButton.disabled = false
    storeLabel.textContent = 'Install failed, retry'
  }
})
extensionsButton.addEventListener('click', () => {
  const rect = extensionsButton.getBoundingClientRect()
  api.ui.extensionsMenu(rect.right, rect.bottom + 4)
})
downloadsButton.addEventListener('click', () => {
  const rect = downloadsButton.getBoundingClientRect()
  api.ui.downloadsMenu(rect.right, rect.bottom + 4)
})
byId('menu-button').addEventListener('click', (event) => {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  api.ui.menu(rect.left, rect.bottom + 4)
})

reportChromeHeight()
new ResizeObserver(reportChromeHeight).observe(chrome)

address.addEventListener('blur', () => setTimeout(hideSuggestions, 150))
api.ui.onSuggestionPicked((index) => {
  const item = suggestions[index]
  if (!item) return
  api.nav.go(item.input)
  completion = null
  hideSuggestions()
  address.blur()
})
