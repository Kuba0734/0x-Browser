import { icon } from '../shared/icons'
import { applySettings, type Settings } from '../shared/settings'
import type { Suggestion } from '../shared/types'

const list = document.getElementById('list') as HTMLUListElement

window.ox.invoke('settings:get').then((settings) => applySettings(settings as Settings))
window.ox.on('settings:changed', (settings) => applySettings(settings as Settings))

window.ox.on('suggest:items', (value) => {
  const { items, selected } = value as { items: Suggestion[]; selected: number }
  list.replaceChildren(
    ...items.map((item, index) => {
      const row = document.createElement('li')
      row.className = `item${index === selected ? ' selected' : ''}`
      row.setAttribute('role', 'option')
      row.setAttribute('aria-selected', String(index === selected))
      const glyph = document.createElement('span')
      glyph.className = 'icon'
      if (item.favicon) {
        const img = document.createElement('img')
        img.src = item.favicon
        img.alt = ''
        glyph.append(img)
      } else glyph.innerHTML = icon(item.kind === 'search' ? 'search' : 'globe')
      const label = document.createElement('span')
      label.className = 'label'
      label.textContent = item.label
      const detail = document.createElement('span')
      detail.className = 'detail'
      detail.textContent = item.detail
      row.append(glyph, label, detail)
      row.addEventListener('mousedown', (event) => {
        event.preventDefault()
        window.ox.send('suggest:pick', index)
      })
      row.addEventListener('mouseenter', () => {
        for (const other of list.children) other.classList.toggle('selected', other === row)
      })
      return row
    })
  )
})
