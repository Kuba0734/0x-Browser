import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { session } from 'electron'
import type { BookmarkNode, ImportResult, ImportSource } from '../shared/types'
import { importBookmarks } from './bookmarks'
import { importVisits, type ImportedVisit } from './history'
import { isWebUrl } from './url'

type Source = ImportSource & { dir: string }
type ChromiumNode = { type: string; name: string; url?: string; children?: ChromiumNode[] }
type FirefoxRow = {
  id: number
  type: number
  parent: number
  title: string
  url: string | null
  guid: string
}
type FirefoxCookie = {
  name: string
  value: string
  host: string
  path: string
  expiry: number
  isSecure: number
  isHttpOnly: number
  sameSite: number
}

const HISTORY_LIMIT = 20000
const local = process.env.LOCALAPPDATA ?? ''
const roaming = process.env.APPDATA ?? ''
const CHROMIUM: [string, string, string][] = [
  ['chrome', 'Google Chrome', join(local, 'Google', 'Chrome', 'User Data', 'Default')],
  ['edge', 'Microsoft Edge', join(local, 'Microsoft', 'Edge', 'User Data', 'Default')],
  ['brave', 'Brave', join(local, 'BraveSoftware', 'Brave-Browser', 'User Data', 'Default')],
  ['vivaldi', 'Vivaldi', join(local, 'Vivaldi', 'User Data', 'Default')],
  ['opera', 'Opera', join(roaming, 'Opera Software', 'Opera Stable')],
  ['opera-gx', 'Opera GX', join(roaming, 'Opera Software', 'Opera GX Stable')]
]

function chromiumProfile(dir: string): string | null {
  for (const candidate of [dir, join(dir, 'Default')]) {
    if (existsSync(join(candidate, 'Bookmarks')) || existsSync(join(candidate, 'History')))
      return candidate
  }
  return null
}

function firefoxProfile(): string | null {
  const base = join(roaming, 'Mozilla', 'Firefox')
  let ini: string
  try {
    ini = readFileSync(join(base, 'profiles.ini'), 'utf8')
  } catch {
    return null
  }
  const sections = ini.split(/\r?\n(?=\[)/).map((block) => {
    const values: Record<string, string> = {}
    for (const line of block.split(/\r?\n/)) {
      const index = line.indexOf('=')
      if (index > 0) values[line.slice(0, index).trim()] = line.slice(index + 1).trim()
    }
    return { name: /^\[([^\]]+)\]/.exec(block)?.[1] ?? '', values }
  })
  const install = sections.find(
    (section) => section.name.startsWith('Install') && section.values.Default
  )
  const profiles = sections.filter((section) => section.name.startsWith('Profile'))
  const profile = profiles.find((section) => section.values.Default === '1') ?? profiles[0]
  const path = install?.values.Default ?? profile?.values.Path
  if (!path) return null
  const dir = install || profile?.values.IsRelative !== '0' ? join(base, path) : path
  return existsSync(join(dir, 'places.sqlite')) ? dir : null
}

function detect(): Source[] {
  const sources: Source[] = []
  for (const [id, name, dir] of CHROMIUM) {
    const profile = chromiumProfile(dir)
    if (profile) sources.push({ id, name, kind: 'chromium', dir: profile })
  }
  const firefox = firefoxProfile()
  if (firefox) sources.push({ id: 'firefox', name: 'Firefox', kind: 'firefox', dir: firefox })
  return sources
}

export function importSources(): ImportSource[] {
  return detect().map(({ id, name, kind }) => ({ id, name, kind }))
}

function readDb<T>(file: string, read: (db: DatabaseSync) => T): T {
  const temp = mkdtempSync(join(tmpdir(), '0x-import-'))
  try {
    const copy = join(temp, 'data.sqlite')
    try {
      copyFileSync(file, copy)
    } catch {
      throw new Error('Close the other browser and try again')
    }
    if (existsSync(`${file}-wal`)) copyFileSync(`${file}-wal`, `${copy}-wal`)
    const db = new DatabaseSync(copy)
    try {
      return read(db)
    } finally {
      db.close()
    }
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

function chromiumBookmarks(dir: string): [BookmarkNode[], BookmarkNode[]] {
  const file = join(dir, 'Bookmarks')
  if (!existsSync(file)) return [[], []]
  const { roots } = JSON.parse(readFileSync(file, 'utf8'))
  const convert = (nodes: ChromiumNode[] = []): BookmarkNode[] =>
    nodes.flatMap((node): BookmarkNode[] => {
      if (node.type === 'folder')
        return [{ id: '', title: node.name, children: convert(node.children) }]
      return node.url && isWebUrl(node.url) ? [{ id: '', title: node.name, url: node.url }] : []
    })
  return [
    convert(roots.bookmark_bar?.children),
    [...convert(roots.other?.children), ...convert(roots.synced?.children)]
  ]
}

function chromiumHistory(dir: string): ImportedVisit[] {
  const file = join(dir, 'History')
  if (!existsSync(file)) return []
  return readDb(
    file,
    (db) =>
      db
        .prepare(
          `SELECT url, title, visit_count AS visitCount,
          CAST(last_visit_time / 1000 - 11644473600000 AS INTEGER) AS lastVisit
        FROM urls WHERE hidden = 0 ORDER BY last_visit_time DESC LIMIT ?`
        )
        .all(HISTORY_LIMIT) as ImportedVisit[]
  )
}

function firefoxBookmarks(dir: string): [BookmarkNode[], BookmarkNode[]] {
  const rows = readDb(
    join(dir, 'places.sqlite'),
    (db) =>
      db
        .prepare(
          `SELECT b.id, b.type, b.parent, COALESCE(b.title, '') AS title, p.url, b.guid
          FROM moz_bookmarks b LEFT JOIN moz_places p ON p.id = b.fk ORDER BY b.parent, b.position`
        )
        .all() as FirefoxRow[]
  )
  const children = new Map<number, FirefoxRow[]>()
  for (const row of rows) children.set(row.parent, [...(children.get(row.parent) ?? []), row])
  const convert = (parent: number): BookmarkNode[] =>
    (children.get(parent) ?? []).flatMap((row): BookmarkNode[] => {
      if (row.type === 2) return [{ id: '', title: row.title, children: convert(row.id) }]
      return row.type === 1 && row.url && isWebUrl(row.url)
        ? [{ id: '', title: row.title || row.url, url: row.url }]
        : []
    })
  const root = (guid: string) => rows.find((row) => row.guid === guid)
  const folder = (guid: string, title: string): BookmarkNode[] => {
    const row = root(guid)
    const nodes = row ? convert(row.id) : []
    return nodes.length ? [{ id: '', title, children: nodes }] : []
  }
  const toolbar = root('toolbar_____')
  return [
    toolbar ? convert(toolbar.id) : [],
    [
      ...folder('menu________', 'Bookmarks menu'),
      ...folder('unfiled_____', 'Other bookmarks'),
      ...folder('mobile______', 'Mobile bookmarks')
    ]
  ]
}

function firefoxHistory(dir: string): ImportedVisit[] {
  return readDb(
    join(dir, 'places.sqlite'),
    (db) =>
      db
        .prepare(
          `SELECT url, COALESCE(title, '') AS title, visit_count AS visitCount,
            CAST(COALESCE(last_visit_date, 0) / 1000 AS INTEGER) AS lastVisit
          FROM moz_places WHERE hidden = 0 AND visit_count > 0
          ORDER BY last_visit_date DESC LIMIT ?`
        )
        .all(HISTORY_LIMIT) as ImportedVisit[]
  )
}

const SAME_SITE = ['no_restriction', 'lax', 'strict'] as const

async function firefoxCookies(dir: string): Promise<number> {
  const file = join(dir, 'cookies.sqlite')
  if (!existsSync(file)) return 0
  const cookies = readDb(
    file,
    (db) =>
      db
        .prepare(
          `SELECT name, value, host, path, expiry, isSecure, isHttpOnly, sameSite
          FROM moz_cookies WHERE originAttributes = ''`
        )
        .all() as FirefoxCookie[]
  )
  const now = Date.now() / 1000
  const results = await Promise.allSettled(
    cookies.map((cookie) => {
      const expirationDate = cookie.expiry > 1e11 ? cookie.expiry / 1000 : cookie.expiry
      if (expirationDate < now) return Promise.reject(new Error('expired'))
      const domain = cookie.host.replace(/^\./, '')
      return session.defaultSession.cookies.set({
        url: `${cookie.isSecure ? 'https' : 'http'}://${domain}${cookie.path}`,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.host.startsWith('.') ? cookie.host : undefined,
        path: cookie.path,
        secure: !!cookie.isSecure,
        httpOnly: !!cookie.isHttpOnly,
        sameSite: SAME_SITE[cookie.sameSite] ?? 'unspecified',
        expirationDate
      })
    })
  )
  return results.filter((result) => result.status === 'fulfilled').length
}

export async function runImport(sourceId: string, kinds: string[]): Promise<ImportResult> {
  const source = detect().find((item) => item.id === sourceId)
  if (!source) throw new Error('Browser not found')
  const result: ImportResult = { bookmarks: 0, history: 0, cookies: 0 }
  const firefox = source.kind === 'firefox'
  if (kinds.includes('bookmarks')) {
    const [bar, other] = firefox ? firefoxBookmarks(source.dir) : chromiumBookmarks(source.dir)
    result.bookmarks = importBookmarks(source.name, bar, other)
  }
  if (kinds.includes('history'))
    result.history = importVisits(
      firefox ? firefoxHistory(source.dir) : chromiumHistory(source.dir)
    )
  if (kinds.includes('cookies') && firefox) result.cookies = await firefoxCookies(source.dir)
  return result
}
