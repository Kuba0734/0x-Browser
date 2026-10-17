import type { PerfSnapshot, PerfTab } from '../../shared/types'
import {
  api,
  countUp,
  displayUrl,
  formatBytes,
  h,
  initPage,
  reveal,
  skeletons
} from '../shared/kit'
import './performance.css'

const REFRESH_MS = 2000

const page = document.getElementById('page')!
const stat = (label: string) => {
  const value = h('div', { class: 'stat-value', text: '0' })
  return {
    value,
    el: h('div', { class: 'card stat' }, value, h('div', { class: 'faint', text: label }))
  }
}
const memory = stat('Memory used')
const cpu = stat('CPU usage')
const processes = stat('Processes')
const sleeping = stat('Sleeping tabs')
const list = h('div', { class: 'card' }, ...skeletons(4))
const rows = new Map<number, { el: HTMLElement; update: (tab: PerfTab) => void }>()

function createRow(id: number) {
  const title = h('div', { class: 'row-title' })
  const sub = h('div', { class: 'row-sub' })
  const mem = h('span', { class: 'perf-cell' })
  const cpuCell = h('span', { class: 'perf-cell' })
  const load = h('span', { class: 'perf-cell' })
  const action = h('button', { class: 'btn perf-action' })
  const el = h(
    'div',
    { class: 'row' },
    h('div', { class: 'row-main' }, title, sub),
    mem,
    cpuCell,
    load,
    action
  )
  let sleepingNow = false
  action.addEventListener('click', () => (sleepingNow ? api.perf.wake(id) : api.perf.sleep(id)))
  const update = (tab: PerfTab) => {
    sleepingNow = tab.sleeping
    title.textContent = tab.title || displayUrl(tab.url) || 'New Tab'
    sub.textContent = tab.active ? 'Active tab' : tab.sleeping ? 'Sleeping' : displayUrl(tab.url)
    el.classList.toggle('sleeping', tab.sleeping)
    countUp(mem, tab.memoryKB * 1024, (value) => (tab.sleeping ? '—' : formatBytes(value)))
    cpuCell.textContent = tab.sleeping ? '—' : `${tab.cpu.toFixed(1)} %`
    load.textContent = tab.loadMs ? `${(tab.loadMs / 1000).toFixed(2)} s` : '—'
    action.textContent = tab.sleeping ? 'Wake' : 'Sleep'
    action.disabled = tab.active
  }
  return { el, update }
}

function apply(snapshot: PerfSnapshot): void {
  countUp(memory.value, snapshot.memoryKB * 1024, formatBytes)
  countUp(cpu.value, snapshot.cpu, (value) => `${value.toFixed(1)} %`)
  countUp(processes.value, snapshot.processCount, (value) => String(Math.round(value)))
  countUp(sleeping.value, snapshot.tabs.filter((tab) => tab.sleeping).length, (value) =>
    String(Math.round(value))
  )
  const ids = new Set(snapshot.tabs.map((tab) => tab.id))
  for (const [id, row] of rows) {
    if (ids.has(id)) continue
    rows.delete(id)
    row.el.remove()
  }
  list.querySelectorAll('.skeleton').forEach((el) => el.remove())
  for (const tab of snapshot.tabs) {
    let row = rows.get(tab.id)
    if (!row) {
      row = createRow(tab.id)
      rows.set(tab.id, row)
      list.append(row.el)
    }
    row.update(tab)
  }
  reveal(list.querySelectorAll('.row:not(.reveal)'))
}

const refresh = () => api.perf.snapshot().then(apply)

page.append(
  h(
    'header',
    { class: 'page-header' },
    h('h1', { class: 'page-title' }, h('span', { icon: 'performance' }), 'Performance'),
    h(
      'div',
      { class: 'actions' },
      h('button', {
        class: 'btn',
        icon: 'moon',
        text: 'Sleep inactive tabs',
        onclick: () => {
          api.perf.sleepInactive()
          setTimeout(refresh, 150)
        }
      })
    )
  ),
  h('div', { class: 'stats' }, memory.el, cpu.el, processes.el, sleeping.el),
  h(
    'div',
    { class: 'perf-head faint' },
    h('span', { text: 'Tab' }),
    h('span', { class: 'perf-cell', text: 'Memory' }),
    h('span', { class: 'perf-cell', text: 'CPU' }),
    h('span', { class: 'perf-cell', text: 'Load time' }),
    h('span', { class: 'perf-action' })
  ),
  list
)

initPage()
refresh()

// Live numbers need sampling; it only runs while this page is visible and stops when hidden.
let timer = setInterval(refresh, REFRESH_MS)
document.addEventListener('visibilitychange', () => {
  clearInterval(timer)
  if (document.visibilityState === 'visible') {
    refresh()
    timer = setInterval(refresh, REFRESH_MS)
  }
})
