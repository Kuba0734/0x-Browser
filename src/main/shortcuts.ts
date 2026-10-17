import type { Event, Input, WebContents } from 'electron'
import type { TabManager } from './tabs'

export function handleShortcut(
  tabs: TabManager,
  ui: WebContents,
  event: Event,
  input: Input
): void {
  if (input.type !== 'keyDown') return
  const action = resolveAction(tabs, ui, input)
  if (!action) return
  event.preventDefault()
  action()
}

function resolveAction(tabs: TabManager, ui: WebContents, input: Input): (() => void) | null {
  const key = input.key.toLowerCase()
  const focusAddress = () => {
    ui.focus()
    ui.send('ui:focus-address')
  }
  if (input.control && !input.alt) {
    if (key === 't') return () => tabs.create()
    if (key === 'w') return () => tabs.closeActive()
    if (key === 'l') return focusAddress
    if (key === 'r') return () => tabs.reload(input.shift)
    if (key === 'tab') return () => tabs.activateRelative(input.shift ? -1 : 1)
    if (key === 'i' && input.shift) return () => tabs.toggleDevTools()
    if (/^[1-9]$/.test(key)) return () => tabs.activateIndex(key === '9' ? -1 : Number(key) - 1)
  }
  if (input.alt && !input.control) {
    if (key === 'arrowleft') return () => tabs.goBack()
    if (key === 'arrowright') return () => tabs.goForward()
    if (key === 'd') return focusAddress
  }
  if (key === 'f5') return () => tabs.reload(input.control)
  if (key === 'f6') return focusAddress
  if (key === 'f12') return () => tabs.toggleDevTools()
  return null
}
