import { icon, type IconName } from '../shared/icons'
import { PERMISSIONS, type PermissionKey, type PermissionPrompt } from '../shared/permissions'
import { applySettings, type Settings } from '../shared/settings'

const ICONS: Record<PermissionKey, IconName> = {
  camera: 'camera',
  microphone: 'microphone',
  geolocation: 'location',
  notifications: 'bell',
  midi: 'performance',
  'clipboard-read': 'copy',
  'idle-detection': 'moon',
  'window-management': 'open'
}

const card = document.getElementById('card') as HTMLElement
const title = document.getElementById('title') as HTMLElement
const list = document.getElementById('permissions') as HTMLUListElement
let current: PermissionPrompt | null = null

window.ox.invoke('settings:get').then((settings) => applySettings(settings as Settings))
window.ox.on('settings:changed', (settings) => applySettings(settings as Settings))

window.ox.on('prompt:show', (value) => {
  current = value as PermissionPrompt
  title.textContent = `${new URL(current.origin).host} wants to`
  list.replaceChildren(
    ...current.permissions.map((key) => {
      const item = document.createElement('li')
      item.innerHTML = icon(ICONS[key])
      item.append(PERMISSIONS[key])
      return item
    })
  )
  card.hidden = false
  card.style.animation = 'none'
  void card.offsetWidth
  card.style.animation = ''
  ;(document.getElementById('allow') as HTMLButtonElement).focus()
})

const answer = (allowed: boolean) => {
  if (!current) return
  window.ox.send('permission:answer', current.id, allowed)
  current = null
}

document.getElementById('allow')!.addEventListener('click', () => answer(true))
document.getElementById('block')!.addEventListener('click', () => answer(false))
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') answer(false)
})
