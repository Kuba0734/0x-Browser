import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { join } from 'node:path'
import { app } from 'electron'
import type { Completion } from '../shared/types'

let db: DatabaseSync | null = null
let upsertVisit: StatementSync
let setTitle: StatementSync
let findPrefix: StatementSync

export function bareUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/i, '')
}

export function openHistory(): void {
  db = new DatabaseSync(join(app.getPath('userData'), 'history.db'))
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS visits (
      url TEXT PRIMARY KEY,
      bare TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      visit_count INTEGER NOT NULL DEFAULT 1,
      last_visit INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS visits_bare ON visits (bare);
  `)
  upsertVisit = db.prepare(`
    INSERT INTO visits (url, bare, title, last_visit) VALUES (?, ?, ?, ?)
    ON CONFLICT (url) DO UPDATE SET
      visit_count = visit_count + 1,
      last_visit = excluded.last_visit,
      title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE title END
  `)
  setTitle = db.prepare('UPDATE visits SET title = ? WHERE url = ?')
  findPrefix = db.prepare(`
    SELECT url, bare FROM visits WHERE bare LIKE ? ESCAPE '\\'
    ORDER BY visit_count DESC, last_visit DESC LIMIT 1
  `)
}

export function closeHistory(): void {
  db?.close()
  db = null
}

export function recordVisit(url: string, title: string): void {
  if (!db || !/^https?:/i.test(url)) return
  upsertVisit.run(url, bareUrl(url), title, Date.now())
}

export function updateTitle(url: string, title: string): void {
  if (db) setTitle.run(title, url)
}

export function completeHistory(text: string): Completion | null {
  const typed = bareUrl(text.trim())
  if (!db || !typed || /\s/.test(typed)) return null
  const row = findPrefix.get(typed.replace(/[\\%_]/g, '\\$&') + '%') as Completion | undefined
  if (!row) return null
  if (typed.includes('/')) return row
  const { origin, host } = new URL(row.url)
  return { url: `${origin}/`, bare: bareUrl(`https://${host}`) }
}
