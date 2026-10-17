import {
  ipcMain,
  webContents,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents
} from 'electron'
import { INTERNAL_PREFIX } from './url'

const uis = new Set<WebContents>()

export function addUi(contents: WebContents): void {
  uis.add(contents)
  contents.once('destroyed', () => uis.delete(contents))
}

// Core access is limited to the browser UI and the main frame of internal ox:// pages.
function isTrusted(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  if (uis.has(event.sender)) return true
  const frame = event.senderFrame
  return !!frame && frame === event.sender.mainFrame && frame.url.startsWith(INTERNAL_PREFIX)
}

type Handler<T> = (sender: WebContents, ...args: unknown[]) => T

export function handle(channel: string, handler: Handler<unknown>): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrusted(event)) throw new Error('Forbidden')
    return handler(event.sender, ...args)
  })
}

export function listen(channel: string, handler: Handler<void>): void {
  ipcMain.on(channel, (event, ...args) => {
    if (!isTrusted(event)) return
    try {
      handler(event.sender, ...args)
    } catch (error) {
      if (!(error instanceof TypeError)) throw error
    }
  })
}

export function broadcast(channel: string, payload: unknown): void {
  for (const contents of webContents.getAllWebContents()) {
    if (uis.has(contents) || contents.getURL().startsWith(INTERNAL_PREFIX))
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
