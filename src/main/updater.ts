import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '../shared/types'
import { broadcast } from './ipc'
import { log } from './logger'

let state: UpdateState = {
  status: 'idle',
  currentVersion: app.getVersion(),
  version: '',
  progress: 0
}

function set(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch }
  broadcast('update:changed', state)
}

export function updateState(): UpdateState {
  return state
}

export function checkForUpdates(): void {
  if (!app.isPackaged || state.status === 'checking' || state.status === 'downloading') return
  autoUpdater.checkForUpdates().catch(() => undefined)
}

export function initUpdater(): void {
  if (!app.isPackaged) return
  autoUpdater.logger = null
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => set({ status: 'checking' }))
  autoUpdater.on('update-not-available', () => set({ status: 'none' }))
  autoUpdater.on('update-available', (info) =>
    set({ status: 'downloading', version: info.version, progress: 0 })
  )
  autoUpdater.on('download-progress', ({ percent }) => {
    if (Math.floor(percent) !== Math.floor(state.progress)) set({ progress: percent })
  })
  autoUpdater.on('update-downloaded', (info) => set({ status: 'ready', version: info.version }))
  autoUpdater.on('error', (error) => {
    log('error', 'updater', `Update failed: ${error.name}`)
    set({ status: 'error' })
  })
  checkForUpdates()
}

export function installUpdate(): void {
  if (state.status === 'ready') autoUpdater.quitAndInstall(true, true)
}
