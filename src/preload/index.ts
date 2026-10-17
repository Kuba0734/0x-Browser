import { contextBridge, ipcRenderer } from 'electron'

const CHANNEL = /^[a-z]+:[a-z-]+$/

function check(channel: unknown): string {
  if (typeof channel !== 'string' || !CHANNEL.test(channel)) throw new Error('Invalid channel')
  return channel
}

// Web tabs share this preload; only the browser UI (flagged via argv) and internal ox:// pages get the bridge.
// The main process re-checks every sender, so this is defense in depth.
if (process.argv.includes('--ox-ui') || location.protocol === 'ox:') {
  contextBridge.exposeInMainWorld('ox', {
    invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(check(channel), ...args),
    send: (channel: string, ...args: unknown[]) => ipcRenderer.send(check(channel), ...args),
    on: (channel: string, listener: (value: unknown) => void) =>
      ipcRenderer.on(check(channel), (_event, value) => listener(value))
  })
}

// Google sign-in gets a Firefox user agent (see main/compat.ts); Firefox has no userAgentData,
// so the Chromium client hints must not leak through JavaScript either.
if (location.hostname === 'accounts.google.com') {
  contextBridge.executeInMainWorld({
    func: () =>
      Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined })
  })
}
