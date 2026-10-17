import { DEFAULT_SETTINGS, type Settings } from '../shared/settings'
import { broadcast } from './ipc'
import { createSaver, readJson } from './store'

let current: Settings = DEFAULT_SETTINGS
const saver = createSaver('settings.json', () => current)
const listeners: ((settings: Settings) => void)[] = []

export function loadSettings(): void {
  const stored = readJson<Partial<Settings>>('settings.json', {})
  current = { ...DEFAULT_SETTINGS, ...stored, design: { ...stored.design } }
}

export function getSettings(): Settings {
  return current
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch }
  saver.schedule()
  broadcast('settings:changed', current)
  for (const listener of listeners) listener(current)
}

export function onSettingsChange(listener: (settings: Settings) => void): void {
  listeners.push(listener)
}

export function flushSettings(): void {
  saver.flush()
}
