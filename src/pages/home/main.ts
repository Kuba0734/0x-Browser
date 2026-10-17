import type { InternalPage } from '../../shared/client'
import type { IconName } from '../../shared/icons'
import { SEARCH_ENGINES, type Settings } from '../../shared/settings'
import { buildSuggestions } from '../../shared/suggestions'
import type { Suggestion } from '../../shared/types'
import { api, displayUrl, h, initPage, loadFavicons, reveal } from '../shared/kit'
import './home.css'

const TILES: [InternalPage, string, IconName][] = [
  ['bookmarks', 'Bookmarks', 'bookmarks'],
  ['downloads', 'Downloads', 'download'],
  ['extensions', 'Extensions', 'extensions'],
  ['performance', 'Performance', 'performance'],
  ['settings', 'Settings', 'settings']
]

const page = document.getElementById('page')!
const search = h('input', {
  class: 'home-search-input',
  type: 'text',
  placeholder: 'Search the web or enter an address',
  spellcheck: false,
  'aria-label': 'Search'
})
const sites = h('div', { class: 'home-sites' })

page.append(
  h('div', { class: 'home-logo', text: '0x' }),
  h(
    'form',
    {
      class: 'home-search',
      onsubmit: (event: Event) => {
        event.preventDefault()
        const input = suggestions[selected]?.input ?? search.value
        hideSuggestions()
        if (input.trim()) api.nav.go(input)
      }
    },
    h('span', { icon: 'search' }),
    search
  ),
  h(
    'nav',
    { class: 'home-tiles', 'aria-label': 'Browser pages' },
    ...TILES.map(([target, label, iconName]) =>
      h(
        'button',
        { class: 'home-tile', onclick: () => api.tabs.openInternal(target) },
        h('span', { class: 'home-tile-icon', icon: iconName }),
        h('span', { text: label })
      )
    )
  ),
  sites
)

initPage()
reveal(page.querySelectorAll('.home-tile'))
search.focus()

let settings: Settings | null = null
const applyHomeSettings = (next: Settings) => {
  settings = next
  sites.hidden = !next.showMostVisited
}
api.settings.get().then(applyHomeSettings)
api.settings.onChange(applyHomeSettings)

const faviconsReady = loadFavicons()
let suggestions: Suggestion[] = []
let selected = -1
let typedText = ''
let suggestRequest = 0

function showSuggestions(): void {
  if (!suggestions.length || document.activeElement !== search) return hideSuggestions()
  const rect = search.parentElement!.getBoundingClientRect()
  api.ui.showSuggestions(suggestions, selected, rect.left, rect.bottom + 6, rect.width)
}

function hideSuggestions(): void {
  suggestRequest++
  if (!suggestions.length) return
  suggestions = []
  selected = -1
  api.ui.hideSuggestions()
}

search.addEventListener('input', async () => {
  const request = ++suggestRequest
  const typed = search.value
  const text = typed.trim()
  if (!text) return hideSuggestions()
  const [history, terms, faviconFor] = await Promise.all([
    api.history.search(text),
    api.search.suggest(text),
    faviconsReady
  ])
  if (request !== suggestRequest) return
  const engine = SEARCH_ENGINES[settings?.searchEngine ?? 'google'].name
  suggestions = buildSuggestions(text, engine, history, terms, (url) => faviconFor(url), displayUrl)
  selected = -1
  typedText = typed
  showSuggestions()
})

search.addEventListener('keydown', (event) => {
  if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && suggestions.length) {
    event.preventDefault()
    const step = event.key === 'ArrowDown' ? 1 : -1
    const count = suggestions.length
    selected = ((selected + 1 + step + count + 1) % (count + 1)) - 1
    search.value = selected < 0 ? typedText : suggestions[selected].input
    showSuggestions()
  } else if (event.key === 'Escape' && suggestions.length) {
    search.value = typedText
    hideSuggestions()
  }
})

search.addEventListener('blur', () => setTimeout(hideSuggestions, 150))
window.addEventListener('blur', hideSuggestions)
window.addEventListener('resize', hideSuggestions)
api.ui.onSuggestionPicked((index) => {
  const item = suggestions[index]
  hideSuggestions()
  if (item) api.nav.go(item.input)
})

Promise.all([api.history.top(), faviconsReady]).then(([top, faviconFor]) => {
  if (!top.length) return
  sites.append(
    h('h2', { class: 'section-title', text: 'Most visited' }),
    h(
      'div',
      { class: 'home-site-grid' },
      ...top.map((site) => {
        const host = new URL(site.url).hostname.replace(/^www\./, '')
        return h(
          'button',
          {
            class: 'home-site',
            title: site.url,
            onclick: () => api.nav.go(site.url),
            onauxclick: (event: MouseEvent) => {
              if (event.button === 1) api.tabs.create(site.url)
            }
          },
          faviconFor(site.url)
            ? h(
                'span',
                { class: 'home-site-letter' },
                h('img', { src: faviconFor(site.url), alt: '' })
              )
            : h('span', { class: 'home-site-letter', text: host.charAt(0).toUpperCase() }),
          h('span', { class: 'home-site-title', text: site.title || host })
        )
      })
    )
  )
  reveal(sites.querySelectorAll('.home-site, .section-title'))
})
