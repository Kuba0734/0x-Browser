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

// Electron has no passkey autofill UI, so the silent "conditional" WebAuthn requests many login pages
// send on load open the Windows Hello dialog. Report conditional mediation as unavailable and keep such
// requests pending, like a browser waiting for the user to pick a passkey. Explicit requests still work.
if (location.protocol === 'https:' || location.protocol === 'http:') {
  contextBridge.executeInMainWorld({
    func: () => {
      const credentials = navigator.credentials
      if (!credentials || typeof PublicKeyCredential === 'undefined') return
      PublicKeyCredential.isConditionalMediationAvailable = () => Promise.resolve(false)
      const capabilities = PublicKeyCredential.getClientCapabilities?.bind(PublicKeyCredential)
      if (capabilities)
        PublicKeyCredential.getClientCapabilities = () =>
          capabilities().then((result) => ({ ...result, conditionalGet: false }))
      const get = credentials.get.bind(credentials)
      credentials.get = (options?: CredentialRequestOptions) => {
        if (options?.mediation !== 'conditional') return get(options)
        return new Promise((_resolve, reject) =>
          options.signal?.addEventListener('abort', () =>
            reject(options.signal?.reason ?? new DOMException('Aborted', 'AbortError'))
          )
        )
      }
    }
  })
}

// Electron reports permissions the user has not decided yet as "denied", which stops sites from ever
// asking. Report them as "default"/"prompt" like Chrome; requests then reach the permission prompt.
if (location.protocol === 'https:' || location.protocol === 'http:') {
  const undecided = ipcRenderer.sendSync('permissions:undecided') as string[]
  contextBridge.executeInMainWorld({
    func: (names: string[]) => {
      const pending = new Set(names)
      const notification = Object.getOwnPropertyDescriptor(Notification, 'permission')
      const readNotification = notification?.get
      if (readNotification && pending.has('notifications'))
        Object.defineProperty(Notification, 'permission', {
          configurable: true,
          get: () => {
            const value = readNotification.call(Notification)
            return value === 'denied' ? 'default' : value
          }
        })
      const query = navigator.permissions?.query.bind(navigator.permissions)
      if (!query) return
      navigator.permissions.query = (descriptor: PermissionDescriptor) =>
        query(descriptor).then((status) =>
          status.state === 'denied' && pending.has(descriptor.name)
            ? ({
                name: descriptor.name,
                state: 'prompt',
                onchange: null,
                addEventListener: () => undefined,
                removeEventListener: () => undefined,
                dispatchEvent: () => true
              } as unknown as PermissionStatus)
            : status
        )
    },
    args: [undecided]
  })
}

// Google sign-in gets a Firefox user agent (see main/compat.ts) and compares it with what scripts
// see, so Chromium-only navigator values and window.chrome must not give it away.
if (location.hostname === 'accounts.google.com') {
  contextBridge.executeInMainWorld({
    func: () => {
      const firefox: Record<string, unknown> = {
        userAgentData: undefined,
        vendor: '',
        productSub: '20100101',
        oscpu: 'Windows NT 10.0; Win64; x64',
        buildID: '20181001000000'
      }
      for (const [name, value] of Object.entries(firefox))
        Object.defineProperty(Navigator.prototype, name, { get: () => value, configurable: true })
      delete (window as { chrome?: unknown }).chrome
    }
  })
}
