import { randomUUID } from 'node:crypto'
import type { BookmarkNode } from '../shared/types'
import { broadcast } from './ipc'
import { readJson, writeJson } from './store'

const FIXED_IDS = new Set(['root', 'bar', 'other'])
const FILE = 'bookmarks.json'

let root: BookmarkNode = createRoot()

function createRoot(): BookmarkNode {
  return {
    id: 'root',
    title: '',
    children: [
      { id: 'bar', title: 'Bookmarks bar', children: [] },
      { id: 'other', title: 'Other bookmarks', children: [] }
    ]
  }
}

export function loadBookmarks(): void {
  root = readJson(FILE, createRoot())
}

function save(): void {
  writeJson(FILE, root)
  broadcast('bookmarks:changed', root)
}

function find(
  id: string,
  node: BookmarkNode = root,
  parent: BookmarkNode | null = null
): { node: BookmarkNode; parent: BookmarkNode | null } | null {
  if (node.id === id) return { node, parent }
  for (const child of node.children ?? []) {
    const found = find(id, child, node)
    if (found) return found
  }
  return null
}

function folder(id: string): BookmarkNode {
  const node = find(id)?.node
  if (!node?.children) throw new TypeError('Folder not found')
  return node
}

export function bookmarkTree(): BookmarkNode {
  return root
}

export function getBookmark(id: string): BookmarkNode | null {
  return find(id)?.node ?? null
}

export function addBookmark(parentId: string, title: string, url?: string): BookmarkNode {
  const node: BookmarkNode =
    url === undefined ? { id: randomUUID(), title, children: [] } : { id: randomUUID(), title, url }
  folder(parentId).children!.push(node)
  save()
  return node
}

export function updateBookmark(id: string, title: string, url?: string): void {
  const node = find(id)?.node
  if (!node || FIXED_IDS.has(id)) throw new TypeError('Bookmark not found')
  node.title = title
  if (node.url !== undefined && url) node.url = url
  save()
}

export function removeBookmark(id: string): void {
  const found = find(id)
  if (!found?.parent || FIXED_IDS.has(id)) throw new TypeError('Bookmark not found')
  found.parent.children = found.parent.children!.filter((child) => child.id !== id)
  save()
}

export function moveBookmark(id: string, parentId: string, index?: number): void {
  const found = find(id)
  if (!found?.parent || FIXED_IDS.has(id)) throw new TypeError('Bookmark not found')
  const target = folder(parentId)
  if (find(parentId, found.node)) throw new TypeError('Cannot move a folder into itself')
  const from = found.parent.children!.indexOf(found.node)
  found.parent.children!.splice(from, 1)
  let at = index ?? target.children!.length
  if (target === found.parent && from < at) at--
  target.children!.splice(Math.max(0, Math.min(at, target.children!.length)), 0, found.node)
  save()
}

export function findByUrl(url: string, node: BookmarkNode = root): BookmarkNode | null {
  if (node.url === url) return node
  for (const child of node.children ?? []) {
    const found = findByUrl(url, child)
    if (found) return found
  }
  return null
}

export function toggleBookmark(url: string, title: string): boolean {
  const existing = findByUrl(url)
  if (existing) {
    removeBookmark(existing.id)
    return false
  }
  addBookmark('bar', title || url, url)
  return true
}

function withNewIds(node: BookmarkNode): BookmarkNode {
  return node.children
    ? { id: randomUUID(), title: node.title, children: node.children.map(withNewIds) }
    : { id: randomUUID(), title: node.title, url: node.url }
}

export function importBookmarks(
  source: string,
  bar: BookmarkNode[],
  other: BookmarkNode[]
): number {
  const barFolder = folder('bar')
  const imported = {
    id: randomUUID(),
    title: `Imported from ${source}`,
    children: [] as BookmarkNode[]
  }
  if (barFolder.children!.length === 0) barFolder.children!.push(...bar.map(withNewIds))
  else if (bar.length)
    imported.children.push({
      id: randomUUID(),
      title: 'Bookmarks bar',
      children: bar.map(withNewIds)
    })
  imported.children.push(...other.map(withNewIds))
  if (imported.children.length) folder('other').children!.push(imported)
  save()
  const count = (nodes: BookmarkNode[]): number =>
    nodes.reduce((sum, node) => sum + (node.children ? count(node.children) : 1), 0)
  return count(bar) + count(other)
}
