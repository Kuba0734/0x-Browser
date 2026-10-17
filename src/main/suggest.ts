import { net } from 'electron'
import { SEARCH_ENGINES } from '../shared/settings'
import { getSettings } from './settings'

const MAX_SUGGESTIONS = 6
const TIMEOUT_MS = 1500

export async function searchSuggestions(text: string): Promise<string[]> {
  const query = text.trim()
  const settings = getSettings()
  if (!settings.searchSuggestions || !query || query.length > 200) return []
  if (/^[a-z][a-z0-9+.-]*:/i.test(query)) return []
  try {
    const engine = SEARCH_ENGINES[settings.searchEngine]
    const response = await net.fetch(engine.suggest + encodeURIComponent(query), {
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (!response.ok) return []
    const data = (await response.json()) as unknown
    const list = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : []
    return list.filter((item): item is string => typeof item === 'string').slice(0, MAX_SUGGESTIONS)
  } catch {
    return []
  }
}
