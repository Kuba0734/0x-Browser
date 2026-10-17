import {
  app,
  clipboard,
  Menu,
  nativeImage,
  type BrowserWindow,
  type ContextMenuParams,
  type MenuItemConstructorOptions,
  type WebContents
} from 'electron'
import { SEARCH_ENGINES } from '../shared/settings'
import type { BookmarkNode, ExtensionInfo } from '../shared/types'
import { getBookmark, removeBookmark } from './bookmarks'
import { listExtensions, openExtensionPopup, setExtensionPinned } from './extensions'
import type { TabManager } from './tabs'
import { appActions } from './app-actions'
import { getSettings } from './settings'
import { internalUrl, isWebUrl } from './url'

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
      { label: 'New window', accelerator: 'Ctrl+N', click: () => appActions.newWindow() },
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

export function popupExtensionsMenu(
  win: BrowserWindow,
  tabs: TabManager,
  x: number,
  y: number
): void {
  const extensions = listExtensions().filter((extension) => extension.enabled)
  const icon = (dataUrl: string) =>
    dataUrl ? nativeImage.createFromDataURL(dataUrl).resize({ width: 16, height: 16 }) : undefined
  const open = (extension: ExtensionInfo) => {
    if (extension.hasPopup) openExtensionPopup(win, extension.id, x, y)
    else if (extension.optionsUrl) tabs.create(extension.optionsUrl)
  }
  const items: MenuItemConstructorOptions[] = extensions.length
    ? extensions.map((extension) => ({
        label: label(extension.name),
        icon: icon(extension.icon),
        enabled: extension.hasPopup || !!extension.optionsUrl,
        click: () => open(extension)
      }))
    : [{ label: 'No extensions enabled', enabled: false }]
  if (extensions.length)
    items.push(
      { type: 'separator' },
      {
        label: 'Pin to toolbar',
        submenu: extensions.map((extension) => ({
          label: label(extension.name),
          type: 'checkbox',
          checked: extension.pinned,
          click: () => setExtensionPinned(extension.id, !extension.pinned)
        }))
      }
    )
  items.push(
    { type: 'separator' },
    { label: 'Manage extensions', click: () => tabs.openOrActivate(internalUrl('extensions')!) }
  )
  popup(win, items, x - 220, y)
}

export function popupPageMenu(
  win: BrowserWindow,
  tabs: TabManager,
  contents: WebContents,
  params: ContextMenuParams
): void {
  const items: MenuItemConstructorOptions[] = []
  const separate = () => {
    if (items.length && items.at(-1)?.type !== 'separator') items.push({ type: 'separator' })
  }
  const shorten = (text: string) => (text.length > 32 ? `${text.slice(0, 32)}…` : text)

  if (params.isEditable && params.misspelledWord) {
    for (const suggestion of params.dictionarySuggestions.slice(0, 5))
      items.push({ label: label(suggestion), click: () => contents.replaceMisspelling(suggestion) })
    if (!params.dictionarySuggestions.length)
      items.push({ label: 'No suggestions', enabled: false })
    separate()
  }

  if (params.linkURL && isWebUrl(params.linkURL)) {
    const link = params.linkURL
    items.push(
      { label: 'Open link in new tab', click: () => tabs.create(link) },
      { label: 'Open link in new window', click: () => appActions.newWindow(link) },
      { label: 'Copy link address', click: () => clipboard.writeText(link) }
    )
    separate()
  }

  if (params.mediaType === 'image' && params.srcURL) {
    const src = params.srcURL
    if (isWebUrl(src)) items.push({ label: 'Open image in new tab', click: () => tabs.create(src) })
    items.push(
      { label: 'Save image as…', click: () => contents.downloadURL(src) },
      { label: 'Copy image', click: () => contents.copyImageAt(params.x, params.y) },
      { label: 'Copy image address', click: () => clipboard.writeText(src) }
    )
    separate()
  }

  if (params.isEditable) {
    const flags = params.editFlags
    items.push(
      { label: 'Undo', role: 'undo', enabled: flags.canUndo },
      { label: 'Redo', role: 'redo', enabled: flags.canRedo },
      { type: 'separator' },
      { label: 'Cut', role: 'cut', enabled: flags.canCut },
      { label: 'Copy', role: 'copy', enabled: flags.canCopy },
      { label: 'Paste', role: 'paste', enabled: flags.canPaste },
      { label: 'Select all', role: 'selectAll', enabled: flags.canSelectAll }
    )
    separate()
  } else if (params.selectionText.trim()) {
    const text = params.selectionText.trim()
    const engine = SEARCH_ENGINES[getSettings().searchEngine]
    items.push(
      { label: 'Copy', role: 'copy' },
      {
        label: label(`Search ${engine.name} for "${shorten(text)}"`),
        click: () => tabs.create(engine.url + encodeURIComponent(text))
      }
    )
    separate()
  }

  if (!items.length) {
    const history = contents.navigationHistory
    items.push(
      { label: 'Back', enabled: history.canGoBack(), click: () => history.goBack() },
      { label: 'Forward', enabled: history.canGoForward(), click: () => history.goForward() },
      { label: 'Reload', click: () => contents.reload() },
      { type: 'separator' },
      { label: 'Select all', role: 'selectAll' }
    )
    separate()
  }

  items.push({ label: 'Inspect', click: () => contents.inspectElement(params.x, params.y) })
  Menu.buildFromTemplate(items).popup({ window: win })
}

export function popupTabMenu(
  win: BrowserWindow,
  tabs: TabManager,
  id: number,
  x: number,
  y: number
): void {
  const tab = tabs.tabInfo(id)
  if (!tab) return
  popup(
    win,
    [
      {
        label: 'New tab',
        accelerator: 'Ctrl+T',
        click: () => tabs.create(undefined, tab.index + 1)
      },
      { type: 'separator' },
      { label: 'Reload', click: () => tabs.reloadTab(id) },
      { label: 'Duplicate', click: () => tabs.duplicate(id) },
      {
        label: tab.muted ? 'Unmute site' : 'Mute site',
        enabled: !tab.sleeping,
        click: () => tabs.setMuted(id, !tab.muted)
      },
      { label: 'Sleep tab', enabled: !tab.active && !tab.sleeping, click: () => tabs.sleep(id) },
      {
        label: 'Move to new window',
        enabled: tab.count > 1,
        click: () => appActions.moveTabToNewWindow(tabs, id)
      },
      { type: 'separator' },
      { label: 'Close tab', accelerator: 'Ctrl+W', click: () => tabs.close(id) },
      { label: 'Close other tabs', enabled: tab.count > 1, click: () => tabs.closeOthers(id) },
      {
        label: 'Close tabs to the right',
        enabled: tab.index < tab.count - 1,
        click: () => tabs.closeToRight(id)
      }
    ],
    x,
    y
  )
}
