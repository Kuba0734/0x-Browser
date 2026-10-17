import {
  ipcMain,
  webContents,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents
} from 'electron'
import { INTERNAL_PREFIX } from './url'

let ui: WebContents | null = null

export function setUi(contents: WebContents): void {
  ui = contents
}

// Core access is limited to the browser UI and the main frame of internal ox:// pages.
function isTrusted(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  if (event.sender === ui) return true
  const frame = event.senderFrame
  return !!frame && frame === event.sender.mainFrame && frame.url.startsWith(INTERNAL_PREFIX)
}

export function handle(channel: string, handler: (...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrusted(event)) throw new Error('Forbidden')
    return handler(...args)
  })
}

export function listen(channel: string, handler: (...args: unknown[]) => void): void {
  ipcMain.on(channel, (event, ...args) => {
    if (!isTrusted(event)) return
    try {
      handler(...args)
    } catch (error) {
      if (!(error instanceof TypeError)) throw error
    }
  })
}

export function broadcast(channel: string, payload: unknown): void {
  for (const contents of webContents.getAllWebContents()) {
    if (contents === ui || contents.getURL().startsWith(INTERNAL_PREFIX))
      contents.send(channel, payload)
  }
}

export function str(value: unknown): string {
  if (typeof value !== 'string' || value.length > 8192) throw new TypeError('Expected string')
  return value
}

export function optStr(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : str(value)
}

export function int(value: unknown): number {
  if (!Number.isInteger(value)) throw new TypeError('Expected integer')
  return value as number
}

export function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new TypeError('Expected boolean')
  return value
}
