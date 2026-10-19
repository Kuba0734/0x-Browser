import { draggableBookmark, folderDropTarget } from '../shared/bookmark-drag'
import { api } from '../shared/client'
import { icon, type IconName } from '../shared/icons'
import { applySettings } from '../shared/settings'
import type { BookmarkNode } from '../shared/types'

const list = document.getElementById('list')!
let tree: BookmarkNode | null = null
let favicons: Record<string, string> = {}
let folderId = ''
const trail: string[] = []

const hide = () => window.ox.send('panel:hide')
const move = (id: string, parentId: string, index?: number) =>
  api.bookmarks.move(id, parentId, index).catch(() => undefined)

function find(id: string, node: BookmarkNode | null = tree): BookmarkNode | null {
  if (!node) return null
  if (node.id === id) return node
  for (const child of node.children ?? []) {
    const found = find(id, child)
    if (found) return found
  }
  return null
}

function faviconFor(url: string): string {
  try {
    return favicons[new URL(url).origin] ?? ''
  } catch {
    return ''
  }
}

function item(glyph: IconName | string, label: string, className = ''): HTMLElement {
  const el = document.createElement('button')
  el.className = `item ${className}`
  el.setAttribute('role', 'menuitem')
  const iconEl = document.createElement('span')
  iconEl.className = 'icon'
  if (glyph.startsWith('data:') || glyph.startsWith('http')) {
    const img = document.createElement('img')
    img.src = glyph
    img.alt = ''
    iconEl.append(img)
  } else iconEl.innerHTML = icon(glyph as IconName)
  const text = document.createElement('span')
  text.className = 'label'
  text.textContent = label
  el.append(iconEl, text)
  return el
}

function open(id: string): void {
  folderId = id
  render()
}

function render(): void {
  const folder = find(folderId)
  if (!folder?.children) return
  const rows: HTMLElement[] = []
  if (trail.length) {
    const back = item('back', folder.title, 'back')
    back.addEventListener('click', () => open(trail.pop()!))
    rows.push(back)
  }
  folder.children.forEach((node, index) => {
    const el = node.url
      ? item(faviconFor(node.url) || 'globe', node.title || node.url)
      : item('folder', node.title)
    el.title = node.url ?? node.title
    draggableBookmark(el, node.id, {
      horizontal: false,
      folder: !node.url,
      onDrop: (id, position) =>
        position === 'into'
          ? move(id, node.id)
          : move(id, folder.id, index + (position === 'after' ? 1 : 0))
    })
    el.addEventListener('click', () => {
      if (!node.url) {
        trail.push(folder.id)
        return open(node.id)
      }
      api.nav.go(node.url)
      hide()
    })
    el.addEventListener('auxclick', (event) => {
      if (event.button === 1 && node.url) api.tabs.create(node.url)
    })
    rows.push(el)
  })
  if (!folder.children.length) {
    const empty = document.createElement('div')
    empty.className = 'empty'
    empty.textContent = 'This folder is empty'
    rows.push(empty)
  }
  list.replaceChildren(...rows)
}

folderDropTarget(list, (id) => move(id, folderId))
new ResizeObserver(() => window.ox.send('panel:resize', list.offsetHeight)).observe(list)
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') hide()
})

window.ox.on('bookmarks:menu-folder', (id) => {
  trail.length = 0
  open(id as string)
})
api.bookmarks.tree().then((next) => {
  tree = next
  render()
})
api.bookmarks.onChange((next) => {
  tree = next
  if (!find(folderId)) folderId = trail.length ? trail.pop()! : folderId
  render()
})
api.favicons.all().then((all) => {
  favicons = all
  render()
})
api.settings.get().then(applySettings)
api.settings.onChange(applySettings)
