import type { BrowserState, Completion, TabState } from '../shared/types'

const api = window.api
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const chrome = byId('chrome')
const tabsEl = byId('tabs')
const backButton = byId<HTMLButtonElement>('back')
const forwardButton = byId<HTMLButtonElement>('forward')
const reloadButton = byId<HTMLButtonElement>('reload')
const addressForm = byId<HTMLFormElement>('address-form')
const address = byId<HTMLInputElement>('address')
const progress = byId('progress')
const newtab = byId('newtab')

const CLOSE_ICON = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>'

const tabEls = new Map<number, HTMLElement>()
let state: BrowserState = { tabs: [], activeId: -1 }
let completion: (Completion & { shown: string }) | null = null

const activeTab = (): TabState | undefined => state.tabs.find((tab) => tab.id === state.activeId)

function createTabEl(id: number): HTMLElement {
  const el = document.createElement('div')
  el.className = 'tab'
  el.setAttribute('role', 'tab')
  el.innerHTML = `<span class="tab-icon"><img alt="" hidden><span class="spinner"></span></span><span class="tab-title"></span><button class="tab-close" title="Close tab" aria-label="Close tab">${CLOSE_ICON}</button>`
  el.addEventListener('mousedown', (event) => {
    if (event.button === 0) api.activateTab(id)
  })
  el.addEventListener('auxclick', (event) => {
    if (event.button === 1) api.closeTab(id)
  })
  const close = el.querySelector('.tab-close') as HTMLButtonElement
  close.addEventListener('mousedown', (event) => event.stopPropagation())
  close.addEventListener('click', () => api.closeTab(id))
  const img = el.querySelector('img') as HTMLImageElement
  img.addEventListener('error', () => (img.hidden = true))
  return el
}

function updateTabEl(el: HTMLElement, tab: TabState): void {
  const active = tab.id === state.activeId
  el.classList.toggle('active', active)
  el.classList.toggle('loading', tab.loading)
  el.setAttribute('aria-selected', String(active))
  const title = tab.title || tab.url || 'New Tab'
  const titleEl = el.querySelector('.tab-title') as HTMLElement
  if (titleEl.textContent !== title) titleEl.textContent = title
  el.title = title
  const img = el.querySelector('img') as HTMLImageElement
  if (img.getAttribute('src') !== tab.favicon) {
    if (tab.favicon) img.src = tab.favicon
    else img.removeAttribute('src')
    img.hidden = !tab.favicon
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

function renderToolbar(activeChanged: boolean): void {
  const tab = activeTab()
  backButton.disabled = !tab?.canGoBack
  forwardButton.disabled = !tab?.canGoForward
  reloadButton.classList.toggle('loading', !!tab?.loading)
  reloadButton.title = tab?.loading ? 'Stop' : 'Reload'
  progress.classList.toggle('active', !!tab?.loading)
  newtab.classList.toggle('visible', !!tab && !tab.url)
  if (activeChanged || document.activeElement !== address) {
    address.value = tab?.url ?? ''
    completion = null
  }
  if (activeChanged && tab && !tab.url) address.focus()
}

api.onState((next) => {
  const activeChanged = next.activeId !== state.activeId
  state = next
  renderTabs()
  renderToolbar(activeChanged)
})

api.onFocusAddress(() => {
  address.focus()
  address.select()
})

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
  const result = await api.completeHistory(typed)
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
  address.value = activeTab()?.url ?? ''
  completion = null
  address.select()
})

addressForm.addEventListener('submit', (event) => {
  event.preventDefault()
  const input = completion?.shown === address.value ? completion.url : address.value
  if (!input.trim()) return
  api.go(input)
  completion = null
  address.blur()
})

byId('new-tab').addEventListener('click', () => api.newTab())
backButton.addEventListener('click', () => api.back())
forwardButton.addEventListener('click', () => api.forward())
reloadButton.addEventListener('click', () => (activeTab()?.loading ? api.stop() : api.reload()))

new ResizeObserver(() => api.setChromeHeight(chrome.offsetHeight)).observe(chrome)
