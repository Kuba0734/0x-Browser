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
