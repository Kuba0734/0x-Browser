import {
  DESIGN_TOKENS,
  SEARCH_ENGINES,
  type DesignToken,
  type SearchEngine,
  type Settings
} from '../../shared/settings'
import type { InternalPage } from '../../shared/client'
import type { IconName } from '../../shared/icons'
import {
  PERMISSION_NAMES,
  PERMISSIONS,
  type Decision,
  type PermissionKey,
  type SitePermissions
} from '../../shared/permissions'
import type { ImportSource, UpdateState } from '../../shared/types'
import { api, confirmDialog, errorMessage, h, initPage, reveal, toast } from '../shared/kit'
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
  key:
    | 'showBookmarkBar'
    | 'showSidebar'
    | 'reducedMotion'
    | 'askDownloadLocation'
    | 'forceDarkWeb'
    | 'searchSuggestions'
    | 'showMostVisited'
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
  const input = h('input', {
    class: token.type === 'text' ? 'input token-text' : '',
    type: token.type,
    'aria-label': token.label,
    spellcheck: false,
    [token.type === 'color' ? 'oninput' : 'onchange']: () =>
      api.settings.setToken(token.key, input.value)
  })
  updaters.push((settings) => {
    reset.disabled = !(token.key in settings.design)
    if (document.activeElement !== input) input.value = read(settings)
  })
  return h('div', { class: 'token-control' }, input, reset)
}

function appearance(): HTMLElement {
  return h(
    'div',
    { class: 'card' },
    ...DESIGN_TOKENS.map((token) =>
      h(
        'div',
        { class: 'row setting' },
        h('div', { class: 'row-main', text: token.label }),
        tokenControl(token)
      )
    )
  )
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

function sitePermissions(): HTMLElement {
  const host = h('div', {}, h('div', { class: 'skeleton' }))
  const control = (origin: string, key: PermissionKey, value: Decision) => {
    const input = h(
      'select',
      {
        class: 'input permission-select',
        'aria-label': `${PERMISSION_NAMES[key]} for ${origin}`,
        onchange: () =>
          api.permissions.set(origin, key, input.value === 'ask' ? null : (input.value as Decision))
      },
      h('option', { value: 'allow', text: 'Allow', selected: value === 'allow' }),
      h('option', { value: 'block', text: 'Block', selected: value === 'block' }),
      h('option', { value: 'ask', text: 'Ask' })
    )
    return h(
      'label',
      { class: 'site-permission', title: PERMISSIONS[key] },
      h('span', { class: 'faint', text: PERMISSION_NAMES[key] }),
      input
    )
  }
  const render = (sites: SitePermissions[]) => {
    host.replaceChildren(
      sites.length
        ? h(
            'div',
            { class: 'card' },
            ...sites.map((site) =>
              h(
                'div',
                { class: 'row setting site-row' },
                h(
                  'div',
                  { class: 'row-main' },
                  h('div', { text: new URL(site.origin).host }),
                  h('div', { class: 'row-sub', text: site.origin })
                ),
                h(
                  'div',
                  { class: 'site-controls' },
                  ...Object.entries(site.permissions).map(([key, value]) =>
                    control(site.origin, key as PermissionKey, value)
                  ),
                  h('button', {
                    class: 'icon-btn danger',
                    icon: 'trash',
                    title: 'Reset permissions for this site',
                    'aria-label': `Reset permissions for ${site.origin}`,
                    onclick: () => api.permissions.clearSite(site.origin)
                  })
                )
              )
            )
          )
        : h(
            'div',
            { class: 'card' },
            h(
              'div',
              { class: 'row setting' },
              h('div', {
                class: 'row-main muted',
                text: 'Sites that ask for your camera, microphone, location or notifications appear here.'
              })
            )
          )
    )
    filterSettings()
  }
  api.permissions.list().then(render)
  api.permissions.onChange(render)
  return host
}

const CLEARABLE: [string, string, string, boolean][] = [
  ['history', 'Browsing history', 'Visited pages, address bar suggestions and site icons', true],
  [
    'cookies',
    'Cookies and site data',
    'Signs you out of most websites. Extension data is kept.',
    true
  ],
  ['cache', 'Cached images and files', 'Pages may load a little slower the next time', true],
  ['downloads', 'Download list', 'The files themselves stay on your computer', false],
  [
    'permissions',
    'Site permissions',
    'Camera, microphone, location and notification choices',
    false
  ]
]

function clearData(): HTMLElement {
  const choices = CLEARABLE.map(([kind, label, description, checked]) => {
    const input = h('input', { class: 'switch', type: 'checkbox', checked, 'aria-label': label })
    return { kind, input, row: setting(label, description, input) }
  })
  const button = h('button', { class: 'btn danger', icon: 'trash', text: 'Clear data' })
  button.addEventListener('click', async () => {
    const kinds = choices.filter((choice) => choice.input.checked).map((choice) => choice.kind)
    if (!kinds.length) return toast('Select something to clear', 'error')
    if (!(await confirmDialog('Clear the selected browsing data?', 'Clear data'))) return
    button.disabled = true
    try {
      await api.privacy.clear(kinds)
      toast('Browsing data cleared', 'success')
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      button.disabled = false
    }
  })
  return h(
    'div',
    { class: 'card' },
    ...choices.map((choice) => choice.row),
    h('div', { class: 'row setting setting-end' }, button)
  )
}

const importHost = h('div', {}, h('div', { class: 'skeleton' }))

const LINKS: [InternalPage, string, IconName][] = [
  ['bookmarks', 'Bookmarks', 'bookmarks'],
  ['downloads', 'Downloads', 'download'],
  ['extensions', 'Extensions', 'extensions'],
  ['performance', 'Performance', 'performance']
]

const searchInput = h('input', {
  class: 'input settings-search-input',
  type: 'search',
  placeholder: 'Search settings',
  spellcheck: false,
  'aria-label': 'Search settings'
})
const noResults = h(
  'div',
  { class: 'card empty', hidden: true },
  h('span', { icon: 'search' }),
  h('p', { text: 'No settings match your search' })
)
const section = (...children: HTMLElement[]) =>
  h('section', { class: 'settings-section' }, ...children)

function filterSettings(): void {
  const query = searchInput.value.trim().toLowerCase()
  for (const row of page.querySelectorAll<HTMLElement>('.row.setting'))
    row.hidden = !!query && !(row.textContent ?? '').toLowerCase().includes(query)
  for (const container of page.querySelectorAll<HTMLElement>('.settings-group, .settings-section'))
    container.hidden = !!query && !container.querySelector('.row.setting:not([hidden])')
  noResults.hidden = !query || !!page.querySelector('.row.setting:not([hidden])')
}

searchInput.addEventListener('input', filterSettings)

page.append(
  h(
    'header',
    { class: 'page-header' },
    h('h1', { class: 'page-title' }, h('span', { icon: 'settings' }), 'Settings'),
    h(
      'nav',
      { class: 'actions', 'aria-label': 'Browser pages' },
      ...LINKS.map(([target, text, iconName]) =>
        h('button', {
          class: 'btn',
          icon: iconName,
          text,
          onclick: () => api.tabs.openInternal(target)
        })
      )
    )
  ),
  h('label', { class: 'settings-search' }, h('span', { icon: 'search' }), searchInput),
  noResults,
  section(
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
      setting(
        'Search suggestions',
        'Shows suggestions while you type. What you type is sent to your search engine.',
        toggle('searchSuggestions')
      ),
      setting(
        'Show most visited sites',
        'Shortcuts to your most visited sites on the home page',
        toggle('showMostVisited')
      ),
      setting('Show bookmarks bar', 'Appears once you have bookmarks', toggle('showBookmarkBar')),
      setting(
        'Show sidebar',
        'Shortcuts to your favorite websites on the left edge',
        toggle('showSidebar')
      ),
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
      setting('Download folder', 'Where downloaded files are saved', downloadFolder())
    )
  ),
  section(
    h('h2', { class: 'section-title', id: 'permissions', text: 'Site permissions' }),
    sitePermissions()
  ),
  section(
    h('h2', { class: 'section-title', id: 'privacy', text: 'Clear browsing data' }),
    clearData()
  ),
  section(h('h2', { class: 'section-title', id: 'import', text: 'Import data' }), importHost),
  section(
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
    appearance()
  ),
  section(h('h2', { class: 'section-title', text: 'About & updates' }), about())
)

initPage()
reveal(page.querySelectorAll('.card .row'))

const apply = (settings: Settings) => updaters.forEach((update) => update(settings))
api.settings.get().then(apply)
api.settings.onChange(apply)
api.importer.sources().then((sources) => {
  importHost.replaceChildren(importer(sources))
  reveal(importHost.querySelectorAll('.row'))
  filterSettings()
})
