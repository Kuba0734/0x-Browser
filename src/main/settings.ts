import {
  DEFAULT_SETTINGS,
  DESIGN_TOKENS,
  SEARCH_ENGINES,
  isValidTokenValue,
  type Settings
} from '../shared/settings'
import { broadcast } from './ipc'
import { createSaver, readJson } from './store'
import { isWebUrl } from './url'

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

// Imported settings come from a file on disk, so only known keys with valid values are applied.
// downloadDir is machine specific and stays untouched.
export function importSettings(value: unknown): number {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('This is not a 0x Browser settings file')
  const input = value as Record<string, unknown>
  const patch: Record<string, unknown> = {}
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const next = input[key]
    if (key === 'downloadDir' || next === undefined) continue
    if (key === 'design') {
      if (!next || typeof next !== 'object' || Array.isArray(next)) continue
      const design: Record<string, string> = {}
      for (const token of DESIGN_TOKENS) {
        const tokenValue = (next as Record<string, unknown>)[token.key]
        if (typeof tokenValue === 'string' && isValidTokenValue(tokenValue))
          design[token.key] = tokenValue
      }
      patch.design = design
    } else if (key === 'sidebarSites') {
      if (Array.isArray(next))
        patch.sidebarSites = [
          ...new Set(
            next.filter((site): site is string => typeof site === 'string' && isWebUrl(site))
          )
        ]
    } else if (typeof next !== typeof DEFAULT_SETTINGS[key]) continue
    else if (key === 'searchEngine') {
      if (typeof next === 'string' && next in SEARCH_ENGINES) patch.searchEngine = next
    } else if (key === 'sleepAfterMinutes')
      patch.sleepAfterMinutes = Math.min(240, Math.max(0, Math.round(Number(next)) || 0))
    else patch[key] = next
  }
  updateSettings(patch as Partial<Settings>)
  return Object.keys(patch).length
}
