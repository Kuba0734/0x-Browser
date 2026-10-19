export const SEARCH_ENGINES = {
  google: {
    name: 'Google',
    url: 'https://www.google.com/search?q=',
    suggest: 'https://suggestqueries.google.com/complete/search?client=firefox&ie=UTF-8&oe=UTF-8&q='
  },
  duckduckgo: {
    name: 'DuckDuckGo',
    url: 'https://duckduckgo.com/?q=',
    suggest: 'https://duckduckgo.com/ac/?type=list&q='
  },
  bing: {
    name: 'Bing',
    url: 'https://www.bing.com/search?q=',
    suggest: 'https://api.bing.com/osjson.aspx?query='
  },
  brave: {
    name: 'Brave Search',
    url: 'https://search.brave.com/search?q=',
    suggest: 'https://search.brave.com/api/suggest?q='
  },
  ecosia: {
    name: 'Ecosia',
    url: 'https://www.ecosia.org/search?q=',
    suggest: 'https://ac.ecosia.org/autocomplete?type=list&q='
  }
}

export type SearchEngine = keyof typeof SEARCH_ENGINES

export type Settings = {
  searchEngine: SearchEngine
  searchSuggestions: boolean
  showBookmarkBar: boolean
  showSidebar: boolean
  sidebarSites: string[]
  showMostVisited: boolean
  reducedMotion: boolean
  forceDarkWeb: boolean
  sleepAfterMinutes: number
  askDownloadLocation: boolean
  downloadDir: string
  design: Record<string, string>
}

export const DEFAULT_SETTINGS: Settings = {
  searchEngine: 'google',
  searchSuggestions: true,
  showBookmarkBar: true,
  showSidebar: false,
  sidebarSites: [],
  showMostVisited: true,
  reducedMotion: false,
  forceDarkWeb: true,
  sleepAfterMinutes: 3,
  askDownloadLocation: false,
  downloadDir: '',
  design: {}
}

export type DesignToken = {
  key: string
  label: string
  type: 'color' | 'text'
  value: string
}

const color = (key: string, label: string, value: string): DesignToken => ({
  key,
  label,
  type: value.startsWith('#') ? 'color' : 'text',
  value
})

export const DESIGN_TOKENS: DesignToken[] = [
  color('--bg', 'Background', '#0a0a0b'),
  color('--surface', 'Surface', '#121214'),
  color('--surface-raised', 'Raised surface', '#1a1a1d'),
  color('--glass', 'Glass panels', 'rgba(18, 18, 20, 0.72)'),
  color('--border', 'Border', 'rgba(255, 255, 255, 0.08)'),
  color('--text', 'Text', '#f2f2f3'),
  color('--text-muted', 'Muted text', '#9a9aa1'),
  color('--text-faint', 'Faint text', '#5c5c63'),
  color('--accent', 'Accent', '#ffffff'),
  color('--on-accent', 'Text on accent', '#0a0a0b'),
  color('--accent-glow', 'Accent glow', 'rgba(255, 255, 255, 0.14)'),
  color('--danger', 'Danger', '#ff5c5c'),
  color('--success', 'Success', '#3ddc84')
]

export function isValidTokenValue(value: string): boolean {
  return /^[#a-z0-9.,()%\s-]{1,40}$/i.test(value)
}

export function applySettings(settings: Settings, root = document.documentElement): void {
  for (const token of DESIGN_TOKENS) {
    const value = settings.design[token.key]
    if (value) root.style.setProperty(token.key, value)
    else root.style.removeProperty(token.key)
  }
  root.toggleAttribute('data-reduced-motion', settings.reducedMotion)
}
