import { app, Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import type { BookmarkNode } from '../shared/types'
import { getBookmark, removeBookmark } from './bookmarks'
import type { TabManager } from './tabs'
import { internalUrl } from './url'

const label = (text: string) => (text || 'Untitled').replace(/&/g, '&&').slice(0, 80)

function popup(
  win: BrowserWindow,
  items: MenuItemConstructorOptions[],
  x: number,
  y: number
): void {
  Menu.buildFromTemplate(items).popup({ window: win, x: Math.round(x), y: Math.round(y) })
}

export function popupAppMenu(win: BrowserWindow, tabs: TabManager, x: number, y: number): void {
  const open = (page: string) => () => tabs.openOrActivate(internalUrl(page)!)
  popup(
    win,
    [
      { label: 'New tab', accelerator: 'Ctrl+T', click: () => tabs.create() },
      { type: 'separator' },
      { label: 'Bookmarks', click: open('bookmarks') },
      { label: 'Downloads', click: open('downloads') },
      { label: 'Extensions', click: open('extensions') },
      { label: 'Performance', click: open('performance') },
      { label: 'Settings', click: open('settings') },
      { type: 'separator' },
      { label: 'Exit', click: () => app.quit() }
    ],
    x,
    y
  )
}

function folderItems(folder: BookmarkNode, tabs: TabManager): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = (folder.children ?? []).map((child) =>
    child.children
      ? { label: label(child.title), submenu: folderItems(child, tabs) }
      : { label: label(child.title), click: () => tabs.navigate(child.url!) }
  )
  return items.length ? items : [{ label: 'Empty', enabled: false }]
}

export function popupBookmarkFolder(
  win: BrowserWindow,
  tabs: TabManager,
  id: string,
  x: number,
  y: number
): void {
  const folder = getBookmark(id)
  if (folder?.children) popup(win, folderItems(folder, tabs), x, y)
}

export function popupBookmarkContext(
  win: BrowserWindow,
  tabs: TabManager,
  id: string,
  x: number,
  y: number
): void {
  const node = getBookmark(id)
  if (!node) return
  const url = node.url
  const items: MenuItemConstructorOptions[] = url
    ? [
        { label: 'Open', click: () => tabs.navigate(url) },
        { label: 'Open in new tab', click: () => tabs.create(url) },
        { type: 'separator' }
      ]
    : []
  items.push(
    { label: 'Edit in bookmarks', click: () => tabs.openOrActivate(internalUrl('bookmarks')!) },
    { label: 'Delete', click: () => removeBookmark(node.id) }
  )
  popup(win, items, x, y)
}
