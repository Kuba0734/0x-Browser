import type { IconName } from '../../shared/icons'
import type { DownloadState } from '../../shared/types'
import { api, formatBytes, h, initPage, reveal, skeletons } from '../shared/kit'
import './downloads.css'

const page = document.getElementById('page')!
// The toolbar's downloads dropdown loads this page with #panel as a compact overlay.
const panel = location.hash === '#panel'
const PANEL_ITEMS = 6
document.documentElement.classList.toggle('panel', panel)
const list = h('div', { class: 'card' }, ...skeletons(4))
const rows = new Map<string, { el: HTMLElement; update: (item: DownloadState) => void }>()

function status(item: DownloadState): string {
  const size = item.totalBytes
    ? `${formatBytes(item.receivedBytes)} of ${formatBytes(item.totalBytes)}`
    : formatBytes(item.receivedBytes)
  switch (item.state) {
    case 'progressing':
      return `${size}${item.speed ? ` · ${formatBytes(item.speed)}/s` : ''}`
    case 'paused':
      return `Paused · ${size}`
    case 'completed':
      return `${formatBytes(item.totalBytes || item.receivedBytes)} · ${new Date(item.startTime).toLocaleString()}`
    case 'cancelled':
      return 'Cancelled'
    default:
      return 'Failed'
  }
}

function createRow(id: string) {
  const title = h('div', { class: 'row-title' })
  const sub = h('div', { class: 'row-sub' })
  const bar = h('span')
  const track = h('div', { class: 'dl-track' }, bar)
  const actions = h('div', { class: 'row-actions' })
  const el = h(
    'div',
    { class: 'row dl-row' },
    h('span', { class: 'dl-icon', icon: 'download' }),
    h('div', { class: 'row-main' }, title, sub, track),
    actions
  )
  let lastState = ''
  const button = (iconName: IconName, label: string, action: () => void, danger = false) =>
    h('button', {
      class: `icon-btn${danger ? ' danger' : ''}`,
      icon: iconName,
      title: label,
      'aria-label': label,
      onclick: action
    })
  const update = (item: DownloadState) => {
    if (title.textContent !== item.filename) title.textContent = item.filename
    sub.textContent = status(item)
    const active = item.state === 'progressing' || item.state === 'paused'
    el.classList.toggle('active', active)
    el.classList.toggle('failed', item.state === 'interrupted' || item.state === 'cancelled')
    bar.style.transform = `scaleX(${item.totalBytes ? item.receivedBytes / item.totalBytes : 0})`
    if (item.state === lastState) return
    lastState = item.state
    const controls: HTMLElement[] = []
    if (item.state === 'progressing')
      controls.push(button('pause', 'Pause', () => api.downloads.pause(id)))
    if (item.state === 'paused' || item.state === 'interrupted')
      controls.push(button('play', 'Resume', () => api.downloads.resume(id)))
    if (active) controls.push(button('close', 'Cancel', () => api.downloads.cancel(id), true))
    if (item.state === 'completed') {
      controls.push(button('open', 'Open', () => api.downloads.open(id)))
      controls.push(button('folder', 'Show in folder', () => api.downloads.show(id)))
    }
    if (!active)
      controls.push(button('trash', 'Remove from list', () => api.downloads.remove(id), true))
    actions.replaceChildren(...controls)
  }
  return { el, update }
}

function apply(all: DownloadState[]): void {
  const items = panel ? all.slice(0, PANEL_ITEMS) : all
  if (!items.length) {
    rows.clear()
    list.replaceChildren(
      h(
        'div',
        { class: 'empty' },
        h('span', { icon: 'download' }),
        h('p', { text: 'Files you download appear here' })
      )
    )
    return
  }
  const ids = new Set(items.map((item) => item.id))
  for (const [id, row] of rows) {
    if (ids.has(id)) continue
    rows.delete(id)
    row.el.remove()
  }
  const ordered = items.map((item) => {
    let row = rows.get(item.id)
    if (!row) {
      row = createRow(item.id)
      rows.set(item.id, row)
    }
    row.update(item)
    return row.el
  })
  list.querySelectorAll('.skeleton, .empty').forEach((el) => el.remove())
  ordered.forEach((el, index) => {
    if (list.children[index] !== el) list.insertBefore(el, list.children[index] ?? null)
  })
  reveal(list.querySelectorAll('.row:not(.reveal)'))
}

const hidePanel = () => window.ox.send('panel:hide')

page.append(
  h(
    'header',
    { class: 'page-header' },
    h('h1', { class: 'page-title' }, h('span', { icon: 'download' }), 'Downloads'),
    h(
      'div',
      { class: 'actions' },
      h('button', {
        class: panel ? 'icon-btn' : 'btn',
        icon: 'folder',
        text: panel ? undefined : 'Open folder',
        title: 'Open folder',
        'aria-label': 'Open folder',
        onclick: () => api.downloads.openFolder()
      }),
      h('button', {
        class: panel ? 'icon-btn danger' : 'btn',
        icon: 'trash',
        text: panel ? undefined : 'Clear list',
        title: 'Clear list',
        'aria-label': 'Clear list',
        onclick: () => api.downloads.clear()
      })
    )
  ),
  list
)

if (panel) {
  page.append(
    h('button', {
      class: 'btn panel-all',
      text: 'Show all downloads',
      onclick: () => {
        api.tabs.openInternal('downloads')
        hidePanel()
      }
    })
  )
  new ResizeObserver(() => window.ox.send('panel:resize', page.offsetHeight)).observe(page)
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hidePanel()
  })
}

initPage()
api.downloads.list().then(apply)
api.downloads.onChange(apply)
