import type { Suggestion, TopSite } from './types'

export const looksLikeAddress = (text: string): boolean =>
  /^(https?|0x|ox):\/\//i.test(text) ||
  /^[^\s/]+\.[a-z]{2,}(\/\S*)?$/i.test(text) ||
  /^localhost(:\d+)?/i.test(text)

export function buildSuggestions(
  text: string,
  engine: string,
  history: TopSite[],
  search: string[],
  faviconFor: (url: string) => string,
  displayUrl: (url: string) => string
): Suggestion[] {
  const isAddress = looksLikeAddress(text)
  const items: Suggestion[] = [
    {
      kind: isAddress ? 'go' : 'search',
      label: text,
      detail: isAddress ? 'Open' : `Search with ${engine}`,
      input: text,
      favicon: ''
    },
    ...history.slice(0, 3).map((entry): Suggestion => ({
      kind: 'history',
      label: entry.title || displayUrl(entry.url),
      detail: displayUrl(entry.url),
      input: entry.url,
      favicon: faviconFor(entry.url)
    })),
    ...search
      .filter((term) => term.toLowerCase() !== text.toLowerCase())
      .map((term): Suggestion => ({
        kind: 'search',
        label: term,
        detail: '',
        input: term,
        favicon: ''
      }))
  ]
  return items.slice(0, 8)
}
