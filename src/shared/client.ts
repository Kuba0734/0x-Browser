import type { Decision, PermissionKey, SitePermissions } from './permissions'
import type { Settings } from './settings'
import type {
  BookmarkNode,
  BrowserState,
  Completion,
  DownloadState,
  ExtensionInfo,
  ImportResult,
  AppInfo,
  ImportSource,
  PerfSnapshot,
  Suggestion,
  TopSite,
  UpdateState
} from './types'

type Bridge = {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  send: (channel: string, ...args: unknown[]) => void
  on: (channel: string, listener: (value: unknown) => void) => void
}

declare global {
  interface Window {
    ox: Bridge
  }
}

const invoke = <T>(channel: string, ...args: unknown[]) =>
  window.ox.invoke(channel, ...args) as Promise<T>
const send = (channel: string, ...args: unknown[]) => window.ox.send(channel, ...args)
const on =
  <T>(channel: string) =>
  (listener: (value: T) => void) =>
    window.ox.on(channel, (value) => listener(value as T))

export type InternalPage =
  'home' | 'bookmarks' | 'downloads' | 'settings' | 'extensions' | 'performance'

export const api = {
  tabs: {
    create: (url?: string) => send('tabs:new', url),
    close: (id: number) => send('tabs:close', id),
    activate: (id: number) => send('tabs:activate', id),
    move: (id: number, index: number) => send('tabs:move', id, index),
    detach: (id: number) => send('tabs:detach', id),
    attach: (id: number, index: number) => send('tabs:attach', id, index),
    openInternal: (page: InternalPage) => send('tabs:open-internal', page),
    onState: on<BrowserState>('tabs:state')
  },
  nav: {
    go: (input: string) => send('nav:go', input),
    back: () => send('nav:back'),
    forward: () => send('nav:forward'),
    reload: () => send('nav:reload'),
    stop: () => send('nav:stop')
  },
  ui: {
    setChromeHeight: (height: number) => send('ui:chrome-height', height),
    menu: (x: number, y: number) => send('ui:menu', x, y),
    bookmarkMenu: (id: string, x: number, y: number) => send('ui:bookmark-menu', id, x, y),
    bookmarkContext: (id: string, x: number, y: number) => send('ui:bookmark-context', id, x, y),
    extensionPopup: (id: string, x: number, y: number) => send('ui:extension-popup', id, x, y),
    extensionsMenu: (x: number, y: number) => send('ui:extensions-menu', x, y),
    onFocusAddress: on<void>('ui:focus-address'),
    showSuggestions: (items: Suggestion[], selected: number, x: number, y: number, width: number) =>
      send('suggest:show', items, selected, x, y, width),
    hideSuggestions: () => send('suggest:hide'),
    onSuggestionPicked: on<number>('suggest:picked')
  },
  history: {
    complete: (text: string) => invoke<Completion | null>('history:complete', text),
    top: () => invoke<TopSite[]>('history:top'),
    search: (text: string) => invoke<TopSite[]>('history:search', text)
  },
  search: {
    suggest: (text: string) => invoke<string[]>('search:suggest', text)
  },
  favicons: {
    all: () => invoke<Record<string, string>>('favicons:all'),
    onUpdate: on<[string, string]>('favicons:updated')
  },
  bookmarks: {
    tree: () => invoke<BookmarkNode>('bookmarks:tree'),
    add: (parentId: string, title: string, url?: string) =>
      invoke<BookmarkNode>('bookmarks:add', parentId, title, url),
    update: (id: string, title: string, url?: string) =>
      invoke<void>('bookmarks:update', id, title, url),
    remove: (id: string) => invoke<void>('bookmarks:remove', id),
    move: (id: string, parentId: string) => invoke<void>('bookmarks:move', id, parentId),
    toggle: (url: string, title: string) => invoke<boolean>('bookmarks:toggle', url, title),
    onChange: on<BookmarkNode>('bookmarks:changed')
  },
  downloads: {
    list: () => invoke<DownloadState[]>('downloads:list'),
    pause: (id: string) => send('downloads:pause', id),
    resume: (id: string) => send('downloads:resume', id),
    cancel: (id: string) => send('downloads:cancel', id),
    open: (id: string) => send('downloads:open', id),
    show: (id: string) => send('downloads:show', id),
    remove: (id: string) => send('downloads:remove', id),
    clear: () => send('downloads:clear'),
    openFolder: () => send('downloads:open-folder'),
    onChange: on<DownloadState[]>('downloads:changed')
  },
  settings: {
    get: () => invoke<Settings>('settings:get'),
    set: <K extends keyof Settings>(key: K, value: Settings[K]) => send('settings:set', key, value),
    setToken: (key: string, value: string | null) => send('settings:set-token', key, value),
    resetDesign: () => send('settings:reset-design'),
    chooseDownloadDir: () => invoke<string>('settings:choose-download-dir'),
    onChange: on<Settings>('settings:changed')
  },
  perf: {
    snapshot: () => invoke<PerfSnapshot>('perf:snapshot'),
    sleep: (id: number) => send('perf:sleep', id),
    wake: (id: number) => send('perf:wake', id),
    sleepInactive: () => send('perf:sleep-inactive')
  },
  extensions: {
    list: () => invoke<ExtensionInfo[]>('extensions:list'),
    installFolder: () => invoke<ExtensionInfo | null>('extensions:install-folder'),
    installStore: (input: string) => invoke<ExtensionInfo>('extensions:install-store', input),
    setEnabled: (id: string, enabled: boolean) =>
      invoke<void>('extensions:set-enabled', id, enabled),
    remove: (id: string) => invoke<void>('extensions:remove', id),
    setPinned: (id: string, pinned: boolean) => send('extensions:set-pinned', id, pinned),
    options: (id: string) => send('extensions:options', id),
    onChange: on<ExtensionInfo[]>('extensions:changed')
  },
  app: {
    info: () => invoke<AppInfo>('app:info'),
    restart: () => send('app:restart')
  },
  updates: {
    state: () => invoke<UpdateState>('update:state'),
    check: () => send('update:check'),
    install: () => send('update:install'),
    onChange: on<UpdateState>('update:changed')
  },
  permissions: {
    list: () => invoke<SitePermissions[]>('permissions:list'),
    set: (origin: string, key: PermissionKey, value: Decision | null) =>
      invoke<void>('permissions:set', origin, key, value),
    clearSite: (origin: string) => invoke<void>('permissions:clear-site', origin),
    onChange: on<SitePermissions[]>('permissions:changed')
  },
  importer: {
    sources: () => invoke<ImportSource[]>('import:sources'),
    run: (sourceId: string, kinds: string[]) => invoke<ImportResult>('import:run', sourceId, kinds)
  }
}
