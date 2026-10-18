import { icon } from '../shared/icons'
import { applySettings, type Settings } from '../shared/settings'

window.ox.invoke('settings:get').then((settings) => applySettings(settings as Settings))
window.ox.on('settings:changed', (settings) => applySettings(settings as Settings))

const dismiss = document.getElementById('dismiss') as HTMLButtonElement
dismiss.innerHTML = icon('close')
dismiss.addEventListener('click', () => window.ox.send('notice:dismiss'))
document
  .getElementById('set-default')!
  .addEventListener('click', () => window.ox.send('notice:set-default'))
