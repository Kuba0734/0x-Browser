export type TabState = {
  id: number
  title: string
  url: string
  favicon: string
  loading: boolean
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
