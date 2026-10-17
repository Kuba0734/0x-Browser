import { contextBridge, ipcRenderer } from 'electron'
import type { BrowserState, Completion } from '../shared/types'

const api = {
  newTab: () => ipcRenderer.send('tabs:new'),
  closeTab: (id: number) => ipcRenderer.send('tabs:close', id),
  activateTab: (id: number) => ipcRenderer.send('tabs:activate', id),
  go: (input: string) => ipcRenderer.send('nav:go', input),
  back: () => ipcRenderer.send('nav:back'),
  forward: () => ipcRenderer.send('nav:forward'),
  reload: () => ipcRenderer.send('nav:reload'),
  stop: () => ipcRenderer.send('nav:stop'),
  setChromeHeight: (height: number) => ipcRenderer.send('ui:chrome-height', height),
  completeHistory: (text: string): Promise<Completion | null> =>
    ipcRenderer.invoke('history:complete', text),
  onState: (callback: (state: BrowserState) => void) =>
    ipcRenderer.on('tabs:state', (_event, state: BrowserState) => callback(state)),
  onFocusAddress: (callback: () => void) => ipcRenderer.on('ui:focus-address', () => callback())
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
