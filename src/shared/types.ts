export type TabState = {
  id: number
  title: string
  url: string
  favicon: string
  loading: boolean
  sleeping: boolean
  audible: boolean
  muted: boolean
  canGoBack: boolean
  canGoForward: boolean
}

export type BrowserState = {
  tabs: TabState[]
  activeId: number
}

export type Completion = {
  url: string
  bare: string
}

export type TopSite = {
  url: string
  title: string
}

export type BookmarkNode = {
  id: string
  title: string
  url?: string
  children?: BookmarkNode[]
}

export type DownloadState = {
  id: string
  filename: string
  path: string
  totalBytes: number
  receivedBytes: number
  speed: number
  state: 'progressing' | 'paused' | 'completed' | 'cancelled' | 'interrupted'
  startTime: number
}

export type PerfTab = {
  id: number
  title: string
  url: string
  active: boolean
  sleeping: boolean
  memoryKB: number
  cpu: number
  loadMs: number
}

export type PerfSnapshot = {
  memoryKB: number
  cpu: number
  processCount: number
  tabs: PerfTab[]
}

export type ExtensionInfo = {
  id: string
  name: string
  version: string
  description: string
  enabled: boolean
  pinned: boolean
  icon: string
  hasPopup: boolean
  optionsUrl: string
}

export type UpdateState = {
  status: 'idle' | 'checking' | 'none' | 'downloading' | 'ready' | 'error'
  currentVersion: string
  version: string
  progress: number
}

export type AppInfo = {
  version: string
  packaged: boolean
  forceDarkActive: boolean
}

export type ImportSource = {
  id: string
  name: string
  kind: 'chromium' | 'firefox'
}

export type ImportResult = {
  bookmarks: number
  history: number
  cookies: number
}

export type ExportImportResult = ImportResult & { settings: number }

export type Suggestion = {
  kind: 'go' | 'history' | 'search'
  label: string
  detail: string
  input: string
  favicon: string
}
