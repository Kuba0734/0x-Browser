import type { TabManager } from './tabs'

type AppActions = {
  newWindow: (url?: string) => void
  moveTabToNewWindow: (tabs: TabManager, id: number) => void
  openFiles: (tabs: TabManager) => void
}

export const appActions: AppActions = {
  newWindow: () => undefined,
  moveTabToNewWindow: () => undefined,
  openFiles: () => undefined
}
