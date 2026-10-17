import { contextBridge } from 'electron'

// Electron lacks several Chrome extension APIs; extensions that touch them at startup crash their
// service worker. This fills in only what is missing, in the worker's own world.
contextBridge.executeInMainWorld({
  func: () => {
    type Listener = (...args: unknown[]) => void
    type Chrome = Record<string, unknown> & {
      runtime?: { getManifest: () => Record<string, unknown> }
    }
    const scope = globalThis as unknown as { chrome?: Chrome; browser?: Chrome }
    const chrome = scope.chrome
    if (!chrome?.runtime) return
    const roots = [...new Set([chrome, scope.browser])].filter((root): root is Chrome => !!root)

    const event = () => {
      const listeners = new Set<Listener>()
      return {
        addListener: (listener: Listener) => listeners.add(listener),
        removeListener: (listener: Listener) => listeners.delete(listener),
        hasListener: (listener: Listener) => listeners.has(listener),
        hasListeners: () => listeners.size > 0,
        dispatch: (...args: unknown[]) => listeners.forEach((listener) => listener(...args))
      }
    }
    const api =
      <T>(result: () => T) =>
      (...args: unknown[]) => {
        const value = result()
        const callback = args.at(-1)
        if (typeof callback === 'function') {
          callback(value)
          return undefined
        }
        return Promise.resolve(value)
      }
    const fill = (name: string, value: Record<string, unknown>) => {
      for (const root of roots) {
        const target = (root[name] ??= {}) as Record<string, unknown>
        for (const [key, member] of Object.entries(value))
          if (!(key in target)) target[key] = member
      }
    }

    fill('contextMenus', {
      create: (properties: { id?: string }, callback?: () => void) => {
        callback?.()
        return properties?.id ?? ''
      },
      update: api(() => undefined),
      remove: api(() => undefined),
      removeAll: api(() => undefined),
      onClicked: event()
    })

    fill('commands', { getAll: api(() => []), onCommand: event() })

    const manifest = chrome.runtime.getManifest()
    fill('permissions', {
      contains: api(() => false),
      getAll: api(() => ({
        permissions: manifest.permissions ?? [],
        origins: manifest.host_permissions ?? []
      })),
      request: api(() => false),
      remove: api(() => false),
      onAdded: event(),
      onRemoved: event()
    })

    const browserWindow = {
      id: 1,
      focused: true,
      type: 'normal',
      state: 'normal',
      incognito: false
    }
    fill('windows', {
      WINDOW_ID_NONE: -1,
      WINDOW_ID_CURRENT: -2,
      get: api(() => browserWindow),
      getCurrent: api(() => browserWindow),
      getLastFocused: api(() => browserWindow),
      getAll: api(() => [browserWindow]),
      onCreated: event(),
      onRemoved: event(),
      onFocusChanged: event(),
      onBoundsChanged: event()
    })

    {
      type Alarm = { name: string; scheduledTime: number; periodInMinutes?: number }
      const alarms = new Map<string, { alarm: Alarm; timer: ReturnType<typeof setTimeout> }>()
      const onAlarm = event()
      const clear = (name = '') => {
        const entry = alarms.get(name)
        if (entry) clearTimeout(entry.timer)
        return alarms.delete(name)
      }
      const schedule = (alarm: Alarm) => {
        const timer = setTimeout(
          () => {
            onAlarm.dispatch({ ...alarm })
            if (!alarm.periodInMinutes) return void alarms.delete(alarm.name)
            schedule({ ...alarm, scheduledTime: Date.now() + alarm.periodInMinutes * 60_000 })
          },
          Math.max(0, alarm.scheduledTime - Date.now())
        )
        alarms.set(alarm.name, { alarm, timer })
      }
      fill('alarms', {
        create: (
          nameOrInfo?: string | Record<string, number>,
          maybeInfo?: Record<string, number>
        ) => {
          const name = typeof nameOrInfo === 'string' ? nameOrInfo : ''
          const info = (typeof nameOrInfo === 'string' ? maybeInfo : nameOrInfo) ?? {}
          clear(name)
          const delay = info.when
            ? info.when - Date.now()
            : (info.delayInMinutes ?? info.periodInMinutes ?? 0) * 60_000
          schedule({
            name,
            scheduledTime: Date.now() + delay,
            periodInMinutes: info.periodInMinutes
          })
          return Promise.resolve()
        },
        get: (name?: string, callback?: Listener) => {
          const alarm = alarms.get(typeof name === 'string' ? name : '')?.alarm
          const handler = typeof name === 'function' ? (name as Listener) : callback
          return handler ? handler(alarm) : Promise.resolve(alarm)
        },
        getAll: api(() => [...alarms.values()].map((entry) => entry.alarm)),
        clear: (name?: string, callback?: Listener) => {
          const handler = typeof name === 'function' ? (name as Listener) : callback
          const result = clear(typeof name === 'string' ? name : '')
          return handler ? handler(result) : Promise.resolve(result)
        },
        clearAll: api(() => {
          for (const name of [...alarms.keys()]) clear(name)
          return true
        }),
        onAlarm
      })
    }
  }
})
