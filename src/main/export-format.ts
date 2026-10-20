import type { Cookie, CookiesSetDetails } from 'electron'
import type { BookmarkNode } from '../shared/types'

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
