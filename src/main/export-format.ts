import type { Cookie, CookiesSetDetails } from 'electron'
import type { BookmarkNode } from '../shared/types'
import type { ImportedVisit } from './history'

export type Visit = { url: string; title: string; visit_count: number; last_visit: number }

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Netscape bookmark file, the format every browser imports.
export function bookmarksHtml(root: BookmarkNode): string {
  const list = (nodes: BookmarkNode[], depth: number): string => {
    const pad = '    '.repeat(depth)
    return nodes
      .map((node) =>
        node.children
          ? `${pad}<DT><H3${node.id === 'bar' ? ' PERSONAL_TOOLBAR_FOLDER="true"' : ''}>${escapeHtml(node.title)}</H3>\n${pad}<DL><p>\n${list(node.children, depth + 1)}${pad}</DL><p>\n`
          : `${pad}<DT><A HREF="${escapeHtml(node.url ?? '')}">${escapeHtml(node.title)}</A>\n`
      )
      .join('')
  }
  return `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
${list(root.children ?? [], 1)}</DL><p>
`
}

const csvField = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`

export function historyCsv(visits: Visit[]): string {
  const rows = visits.map((visit) =>
    [visit.url, visit.title, visit.visit_count, new Date(visit.last_visit).toISOString()]
      .map(csvField)
      .join(',')
  )
  return ['url,title,visit_count,last_visit', ...rows].join('\r\n') + '\r\n'
}

const SAME_SITE = new Set(['unspecified', 'no_restriction', 'lax', 'strict'])

// Exported cookie files come from disk, so every field is checked before it reaches the session.
export function cookieDetails(value: unknown, now = Date.now() / 1000): CookiesSetDetails | null {
  const cookie = value as Partial<Cookie>
  if (
    typeof cookie?.name !== 'string' ||
    typeof cookie.value !== 'string' ||
    typeof cookie.domain !== 'string' ||
    !/^\.?[a-z0-9.-]+$/i.test(cookie.domain)
  )
    return null
  if (typeof cookie.expirationDate === 'number' && cookie.expirationDate < now) return null
  const path = typeof cookie.path === 'string' && cookie.path.startsWith('/') ? cookie.path : '/'
  const secure = cookie.secure === true
  return {
    url: `${secure ? 'https' : 'http'}://${cookie.domain.replace(/^\./, '')}${path}`,
    name: cookie.name,
    value: cookie.value,
    domain: cookie.hostOnly ? undefined : cookie.domain,
    path,
    secure,
    httpOnly: cookie.httpOnly === true,
    sameSite: SAME_SITE.has(cookie.sameSite ?? '') ? cookie.sameSite : 'unspecified',
    expirationDate: typeof cookie.expirationDate === 'number' ? cookie.expirationDate : undefined
  }
}

const unescapeHtml = (text: string) =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')

// Returns [bookmarks bar, other bookmarks] from a Netscape bookmark file.
export function parseBookmarksHtml(html: string): [BookmarkNode[], BookmarkNode[]] {
  const root: BookmarkNode = { id: '', title: '', children: [] }
  const stack = [root]
  let bar: BookmarkNode | null = null
  const token = /<DT><H3([^>]*)>([^<]*)<\/H3>|<DT><A\s+HREF="([^"]*)"[^>]*>([^<]*)<\/A>|<\/DL>/gi
  for (const match of html.matchAll(token)) {
    const parent = stack[stack.length - 1]
    if (match[2] !== undefined) {
      const folder: BookmarkNode = { id: '', title: unescapeHtml(match[2]), children: [] }
      parent.children!.push(folder)
      stack.push(folder)
      if (!bar && /PERSONAL_TOOLBAR_FOLDER="true"/i.test(match[1])) bar = folder
    } else if (match[3] !== undefined) {
      const url = unescapeHtml(match[3])
      if (/^https?:\/\//i.test(url))
        parent.children!.push({ id: '', title: unescapeHtml(match[4]) || url, url })
    } else if (stack.length > 1) stack.pop()
  }
  const other = root.children!.flatMap((node) => {
    if (node === bar) return []
    if (node.children && node.title === 'Other bookmarks') return node.children
    return [node]
  })
  return [bar?.children ?? [], other]
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (char === '"') quoted = false
      else field += char
    } else if (char === '"') quoted = true
    else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += char
  }
  if (field || row.length) rows.push([...row, field])
  return rows
}

export function parseHistoryCsv(text: string): ImportedVisit[] {
  const [header, ...rows] = parseCsv(text.replace(/^\uFEFF/, ''))
  if (header?.join(',') !== 'url,title,visit_count,last_visit')
    throw new Error('This is not a 0x Browser history file')
  return rows.flatMap(([url, title, visitCount, lastVisit]) =>
    url && /^https?:\/\//i.test(url)
      ? [
          {
            url,
            title: title ?? '',
            visitCount: Math.max(1, Math.round(Number(visitCount)) || 1),
            lastVisit: Date.parse(lastVisit ?? '') || 0
          }
        ]
      : []
  )
}
