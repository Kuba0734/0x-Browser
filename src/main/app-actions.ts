import type { TabManager } from './tabs'

type AppActions = {
  newWindow: (url?: string) => void
  moveTabToNewWindow: (tabs: TabManager, id: number) => void
}

export const appActions: AppActions = {
  newWindow: () => undefined,
  moveTabToNewWindow: () => undefined
}
