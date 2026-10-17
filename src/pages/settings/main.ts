import {
  DESIGN_TOKENS,
  SEARCH_ENGINES,
  type DesignToken,
  type SearchEngine,
  type Settings
} from '../../shared/settings'
import type { ImportSource, UpdateState } from '../../shared/types'
import { api, errorMessage, h, initPage, reveal, toast } from '../shared/kit'
import './settings.css'

const SLEEP_OPTIONS: [number, string][] = [
  [0, 'Never'],
  [1, '1 minute'],
  [3, '3 minutes'],
  [5, '5 minutes'],
  [10, '10 minutes'],
  [30, '30 minutes'],
  [60, '1 hour']
]

const page = document.getElementById('page')!
const updaters: ((settings: Settings) => void)[] = []

function setting(label: string, description: string, control: HTMLElement): HTMLElement {
  return h(
    'div',
    { class: 'row setting' },
    h(
      'div',
      { class: 'row-main' },
      h('div', { text: label }),
      h('div', { class: 'row-sub', text: description })
    ),
    control
  )
}

function toggle(
  key: 'showBookmarkBar' | 'reducedMotion' | 'askDownloadLocation' | 'forceDarkWeb'
): HTMLInputElement {
  const input = h('input', {
    class: 'switch',
    type: 'checkbox',
    onchange: () => api.settings.set(key, input.checked)
  })
  updaters.push((settings) => (input.checked = settings[key]))
  return input
}

function select<T extends string | number>(
  options: [T, string][],
  current: (settings: Settings) => T,
  change: (value: string) => void
): HTMLSelectElement {
  const input = h(
    'select',
    { class: 'input setting-select', onchange: () => change(input.value) },
    ...options.map(([value, label]) => h('option', { value: String(value), text: label }))
  )
  updaters.push((settings) => (input.value = String(current(settings))))
  return input
}

function tokenControl(token: DesignToken): HTMLElement {
  const read = (settings: Settings) => settings.design[token.key] ?? token.value
  const reset = h('button', {
    class: 'icon-btn',
    icon: 'reload',
    title: 'Reset',
    'aria-label': `Reset ${token.label}`,
    onclick: () => api.settings.setToken(token.key, null)
  })
  let input: HTMLInputElement
  let output: HTMLElement | null = null
  if (token.type === 'range') {
    output = h('span', { class: 'token-value' })
    input = h('input', {
      type: 'range',
      min: token.min,
      max: token.max,
      'aria-label': token.label,
      oninput: () => {
        output!.textContent = `${input.value}${token.unit}`
        api.settings.setToken(token.key, `${input.value}${token.unit}`)
      }
    })
  } else {
    input = h('input', {
      class: token.type === 'text' ? 'input token-text' : '',
      type: token.type,
      'aria-label': token.label,
      spellcheck: false,
      [token.type === 'color' ? 'oninput' : 'onchange']: () =>
        api.settings.setToken(token.key, input.value)
    })
  }
  updaters.push((settings) => {
    const value = read(settings)
    reset.disabled = !(token.key in settings.design)
    if (document.activeElement === input) return
    input.value = token.type === 'range' ? String(parseFloat(value)) : value
    if (output) output.textContent = value
  })
  return h('div', { class: 'token-control' }, input, output, reset)
}

function appearance(): HTMLElement[] {
  const groups = [...new Set(DESIGN_TOKENS.map((token) => token.group))]
  return groups.flatMap((group) => [
    h('h3', { class: 'token-group', text: group }),
    h(
      'div',
      { class: 'card' },
      ...DESIGN_TOKENS.filter((token) => token.group === group).map((token) =>
        h(
          'div',
          { class: 'row setting' },
          h('div', { class: 'row-main', text: token.label }),
          tokenControl(token)
        )
      )
    )
  ])
}

function downloadFolder(): HTMLElement {
  const path = h('span', { class: 'faint download-path' })
  updaters.push(
    (settings) => (path.textContent = settings.downloadDir || 'System Downloads folder')
  )
  return h(
    'div',
    { class: 'token-control' },
    path,
    h('button', {
      class: 'btn',
      text: 'Change',
      onclick: () => api.settings.chooseDownloadDir()
    })
  )
}

function importer(sources: ImportSource[]): HTMLElement {
  if (!sources.length)
    return h('div', {
      class: 'card card-body muted',
      text: 'No other browsers were found on this computer.'
    })
  const source = h(
    'select',
    { class: 'input setting-select', 'aria-label': 'Browser' },
    ...sources.map((item) => h('option', { value: item.id, text: item.name }))
  )
  const kinds = (['bookmarks', 'history', 'cookies'] as const).map((kind) => ({
    kind,
    input: h('input', { class: 'switch', type: 'checkbox', checked: kind !== 'cookies' })
  }))
  const cookieNote = h('div', { class: 'row-sub' })
  const syncCookies = () => {
    const firefox = sources.find((item) => item.id === source.value)?.kind === 'firefox'
    const cookies = kinds[2].input
    cookies.disabled = !firefox
    if (!firefox) cookies.checked = false
    cookieNote.textContent = firefox
      ? 'Keeps you signed in to websites'
      : 'Only available for Firefox. Chromium browsers encrypt cookies so other apps cannot read them.'
  }
  source.addEventListener('change', syncCookies)
  syncCookies()
  const button = h('button', { class: 'btn primary', icon: 'import', text: 'Import' })
  button.addEventListener('click', async () => {
    const selected = kinds.filter((item) => item.input.checked).map((item) => item.kind)
    if (!selected.length) return toast('Select something to import', 'error')
    button.disabled = true
    try {
      const result = await api.importer.run(source.value, selected)
      toast(
        `Imported ${result.bookmarks} bookmarks, ${result.history} history entries, ${result.cookies} cookies`,
        'success'
      )
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      button.disabled = false
    }
  })
  return h(
    'div',
    { class: 'card' },
    setting('Browser', 'Where to import from', source),
    setting('Bookmarks', 'Folders and bookmarks bar', kinds[0].input),
    setting('History', 'Improves address bar suggestions', kinds[1].input),
    h(
      'div',
      { class: 'row setting' },
      h('div', { class: 'row-main' }, h('div', { text: 'Cookies' }), cookieNote),
      kinds[2].input
    ),
    h('div', { class: 'row setting setting-end' }, button)
  )
}

function darkMode(): HTMLElement {
  const restart = h('button', {
    class: 'btn',
    text: 'Restart now',
    hidden: true,
    onclick: () => api.app.restart()
  })
  api.app.info().then((info) => {
    const update = (settings: Settings) =>
      (restart.hidden = settings.forceDarkWeb === info.forceDarkActive)
    updaters.push(update)
    api.settings.get().then(update)
  })
  return h('div', { class: 'token-control' }, restart, toggle('forceDarkWeb'))
}

const UPDATE_TEXT: Record<UpdateState['status'], (update: UpdateState) => string> = {
  idle: () => 'Updates are checked every time the browser starts',
  checking: () => 'Checking for updates…',
  none: () => 'You are using the latest version',
  downloading: (update) => `Downloading ${update.version} · ${Math.round(update.progress)} %`,
  ready: (update) => `Version ${update.version} is ready to install`,
  error: () => 'Could not check for updates'
}

function about(): HTMLElement {
  const title = h('div', { text: '0x Browser' })
  const status = h('div', { class: 'row-sub' })
  const button = h('button', { class: 'btn', icon: 'update', text: 'Check for updates' })
  let packaged = false
  let current: UpdateState | null = null
  const render = () => {
    if (!current) return
    title.textContent = `0x Browser ${current.currentVersion}`
    const ready = current.status === 'ready'
    status.textContent = packaged
      ? UPDATE_TEXT[current.status](current)
      : 'Updates are only available in the installed app'
    button.lastChild!.textContent = ready ? 'Restart to update' : 'Check for updates'
    button.classList.toggle('primary', ready)
    button.disabled = !packaged || current.status === 'checking' || current.status === 'downloading'
  }
  button.addEventListener('click', () =>
    current?.status === 'ready' ? api.updates.install() : api.updates.check()
  )
  Promise.all([api.app.info(), api.updates.state()]).then(([info, update]) => {
    packaged = info.packaged
    current = update
    render()
  })
  api.updates.onChange((update) => {
    current = update
    render()
  })
  return h(
    'div',
    { class: 'card' },
    h('div', { class: 'row setting' }, h('div', { class: 'row-main' }, title, status), button)
  )
}

const importHost = h('div', {}, h('div', { class: 'skeleton' }))

page.append(
  h(
    'header',
    { class: 'page-header' },
    h('h1', { class: 'page-title' }, h('span', { icon: 'settings' }), 'Settings')
  ),
  h('h2', { class: 'section-title', text: 'Behavior' }),
  h(
    'div',
    { class: 'card' },
    setting(
      'Search engine',
      'Used for searches from the address bar',
      select(
        Object.entries(SEARCH_ENGINES).map(([id, engine]) => [id, engine.name]),
        (settings) => settings.searchEngine,
        (value) => api.settings.set('searchEngine', value as SearchEngine)
      )
    ),
    setting('Show bookmarks bar', 'Appears once you have bookmarks', toggle('showBookmarkBar')),
    setting(
      'Dark mode for websites',
      'Makes light websites like Google dark. Applies after a restart.',
      darkMode()
    ),
    setting('Reduce animations', 'Turns off nearly all motion', toggle('reducedMotion')),
    setting(
      'Sleep inactive tabs',
      'Frees memory from tabs you have not used for a while',
      select(
        SLEEP_OPTIONS,
        (settings) => settings.sleepAfterMinutes,
        (value) => api.settings.set('sleepAfterMinutes', Number(value))
      )
    ),
    setting(
      'Ask where to save downloads',
      'Otherwise files go to the download folder',
      toggle('askDownloadLocation')
    ),
    setting('Download folder', '', downloadFolder())
  ),
  h('h2', { class: 'section-title', id: 'import', text: 'Import data' }),
  importHost,
  h(
    'div',
    { class: 'appearance-header' },
    h('h2', { class: 'section-title', text: 'Appearance' }),
    h('button', {
      class: 'btn',
      icon: 'reload',
      text: 'Reset all',
      onclick: () => api.settings.resetDesign()
    })
  ),
  ...appearance(),
  h('h2', { class: 'section-title', text: 'About & updates' }),
  about()
)

initPage()
reveal(page.querySelectorAll('.card .row'))

const apply = (settings: Settings) => updaters.forEach((update) => update(settings))
api.settings.get().then(apply)
api.settings.onChange(apply)
api.importer.sources().then((sources) => {
  importHost.replaceChildren(importer(sources))
  reveal(importHost.querySelectorAll('.row'))
})
