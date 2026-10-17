import type { BookmarkNode } from '../../shared/types'
import {
  api,
  confirmDialog,
  displayUrl,
  errorMessage,
  h,
  initPage,
  modal,
  reveal,
  skeletons,
  toast
} from '../shared/kit'
import './bookmarks.css'

const page = document.getElementById('page')!
const searchInput = h('input', {
  class: 'input',
  type: 'search',
  placeholder: 'Search bookmarks',
  'aria-label': 'Search bookmarks'
})
const sidebar = h('nav', { class: 'bm-sidebar card', 'aria-label': 'Folders' })
const list = h('div', { class: 'card bm-list' }, ...skeletons(5))
const heading = h('h2', { class: 'section-title bm-heading' })

let tree: BookmarkNode = { id: 'root', title: '', children: [] }
let currentId = 'bar'
const seen = new Set<string>()

function folders(node: BookmarkNode, depth = 0): [BookmarkNode, number][] {
  if (!node.children) return []
  const own: [BookmarkNode, number][] = node.id === 'root' ? [] : [[node, depth]]
  return [
    ...own,
    ...node.children.flatMap((child) => folders(child, node.id === 'root' ? 0 : depth + 1))
  ]
}

function find(id: string, node: BookmarkNode = tree): BookmarkNode | null {
  if (node.id === id) return node
  for (const child of node.children ?? []) {
    const found = find(id, child)
    if (found) return found
  }
  return null
}

function allBookmarks(node: BookmarkNode = tree): BookmarkNode[] {
  return node.children ? node.children.flatMap(allBookmarks) : [node]
}

const folderOptions = (excludeId?: string): [string, string][] =>
  folders(tree)
    .filter(([folder]) => folder.id !== excludeId)
    .map(([folder, depth]) => [folder.id, `${'  '.repeat(depth)}${folder.title}`])

async function run(action: Promise<unknown>, success?: string): Promise<void> {
  try {
    await action
    if (success) toast(success, 'success')
  } catch (error) {
    toast(errorMessage(error), 'error')
  }
}

async function addBookmark(): Promise<void> {
  const values = await modal({
    title: 'Add bookmark',
    confirm: 'Add',
    fields: [
      { name: 'title', label: 'Name' },
      { name: 'url', label: 'URL', type: 'url', value: 'https://' },
      {
        name: 'parent',
        label: 'Folder',
        type: 'select',
        value: currentId,
        options: folderOptions()
      }
    ]
  })
  if (values)
    run(api.bookmarks.add(values.parent, values.title || values.url, values.url), 'Bookmark added')
}

async function addFolder(): Promise<void> {
  const values = await modal({
    title: 'New folder',
    confirm: 'Create',
    fields: [{ name: 'title', label: 'Name', value: 'New folder' }]
  })
  if (values) run(api.bookmarks.add(currentId, values.title || 'New folder'), 'Folder created')
}

async function edit(node: BookmarkNode): Promise<void> {
  const values = await modal({
    title: node.url ? 'Edit bookmark' : 'Rename folder',
    confirm: 'Save',
    fields: [
      { name: 'title', label: 'Name', value: node.title },
      ...(node.url ? [{ name: 'url', label: 'URL', type: 'url' as const, value: node.url }] : [])
    ]
  })
  if (values) run(api.bookmarks.update(node.id, values.title, values.url), 'Saved')
}

async function move(node: BookmarkNode): Promise<void> {
  const values = await modal({
    title: `Move "${node.title}"`,
    confirm: 'Move',
    fields: [
      {
        name: 'parent',
        label: 'Folder',
        type: 'select',
        value: currentId,
        options: folderOptions(node.id)
      }
    ]
  })
  if (values) run(api.bookmarks.move(node.id, values.parent), 'Moved')
}

async function remove(node: BookmarkNode): Promise<void> {
  const label = node.children ? `folder "${node.title}" and its contents` : `"${node.title}"`
  if (await confirmDialog(`Delete ${label}?`, 'Delete'))
    run(api.bookmarks.remove(node.id), 'Deleted')
}

function row(node: BookmarkNode): HTMLElement {
  const open = () => (node.url ? api.tabs.create(node.url) : select(node.id))
  const el = h(
    'div',
    { class: 'row bm-row', ondblclick: open },
    h('span', { class: 'bm-icon', icon: node.children ? 'folder' : 'globe' }),
    h(
      'div',
      { class: 'row-main', onclick: open },
      h('div', { class: 'row-title', text: node.title || displayUrl(node.url ?? '') }),
      h('div', {
        class: 'row-sub',
        text: node.url ? displayUrl(node.url) : `${node.children?.length ?? 0} items`
      })
    ),
    h(
      'div',
      { class: 'row-actions' },
      node.url
        ? h('button', {
            class: 'icon-btn',
            icon: 'open',
            title: 'Open in new tab',
            onclick: () => api.tabs.create(node.url)
          })
        : null,
      h('button', { class: 'icon-btn', icon: 'edit', title: 'Edit', onclick: () => edit(node) }),
      h('button', { class: 'icon-btn', icon: 'move', title: 'Move', onclick: () => move(node) }),
      h('button', {
        class: 'icon-btn danger',
        icon: 'trash',
        title: 'Delete',
        onclick: () => remove(node)
      })
    )
  )
  if (seen.has(node.id)) el.classList.add('reveal', 'visible')
  seen.add(node.id)
  return el
}

function renderSidebar(): void {
  sidebar.replaceChildren(
    ...folders(tree).map(([folder, depth]) =>
      h(
        'button',
        {
          class: `bm-folder${folder.id === currentId ? ' active' : ''}`,
          style: `padding-left: calc(var(--space-3) + ${depth * 14}px)`,
          onclick: () => select(folder.id)
        },
        h('span', { icon: 'folder' }),
        h('span', { class: 'bm-folder-title', text: folder.title })
      )
    )
  )
}

function renderList(): void {
  const query = searchInput.value.trim().toLowerCase()
  const items = query
    ? allBookmarks().filter(
        (node) =>
          node.title.toLowerCase().includes(query) || (node.url ?? '').toLowerCase().includes(query)
      )
    : (find(currentId)?.children ?? [])
  heading.textContent = query
    ? `Results for "${searchInput.value.trim()}"`
    : (find(currentId)?.title ?? '')
  if (!items.length) {
    list.replaceChildren(
      h(
        'div',
        { class: 'empty' },
        h('span', { icon: query ? 'search' : 'bookmarks' }),
        h('p', { text: query ? 'No bookmarks found' : 'This folder is empty' })
      )
    )
    return
  }
  list.replaceChildren(...items.map(row))
  reveal(list.querySelectorAll('.row:not(.reveal)'))
}

function select(id: string): void {
  currentId = id
  searchInput.value = ''
  renderSidebar()
  renderList()
}

function apply(next: BookmarkNode): void {
  tree = next
  if (!find(currentId)) currentId = 'bar'
  renderSidebar()
  renderList()
}

page.append(
  h(
    'header',
    { class: 'page-header' },
    h('h1', { class: 'page-title' }, h('span', { icon: 'bookmarks' }), 'Bookmarks'),
    h(
      'div',
      { class: 'actions' },
      h('button', { class: 'btn', icon: 'folder', text: 'New folder', onclick: addFolder }),
      h('button', {
        class: 'btn primary',
        icon: 'plus',
        text: 'Add bookmark',
        onclick: addBookmark
      })
    )
  ),
  searchInput,
  h('div', { class: 'bm-layout' }, sidebar, h('section', {}, heading, list))
)

searchInput.addEventListener('input', renderList)
initPage()
api.bookmarks.tree().then(apply)
api.bookmarks.onChange(apply)
