import '../../ui/tokens.css'
import './page.css'
import { api } from '../../shared/client'
import { icon, type IconName } from '../../shared/icons'
import { applySettings } from '../../shared/settings'

export { api, icon }

type Props = Record<string, unknown> & { class?: string; text?: string; icon?: IconName }

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: (Node | string | null | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue
    if (key === 'class') el.className = String(value)
    else if (key === 'text') el.append(String(value))
    else if (key === 'icon') el.insertAdjacentHTML('beforeend', icon(value as IconName))
    else if (key.startsWith('on') && typeof value === 'function')
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener)
    else if (key in el) (el as unknown as Record<string, unknown>)[key] = value
    else el.setAttribute(key, String(value))
  }
  for (const child of children) if (child) el.append(child)
  return el
}

export function fillIcons(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-icon]')) {
    if (!el.querySelector('svg'))
      el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon as IconName))
  }
}

const MAX_STAGGERED = 8

const observer = new IntersectionObserver((entries) => {
  let index = 0
  for (const entry of entries) {
    if (!entry.isIntersecting) continue
    const el = entry.target as HTMLElement
    el.style.setProperty('--index', String(Math.min(index++, MAX_STAGGERED)))
    el.classList.add('visible')
    observer.unobserve(el)
  }
})

export function reveal(elements: Iterable<Element>): void {
  for (const el of elements) {
    if (el.classList.contains('reveal')) continue
    el.classList.add('reveal')
    observer.observe(el)
  }
}

export function initPage(): void {
  api.settings.get().then(applySettings)
  api.settings.onChange(applySettings)
  fillIcons()
  reveal(document.querySelectorAll('.page > *'))
}

let toastHost: HTMLElement | null = null

export function toast(message: string, kind: 'info' | 'success' | 'error' = 'info'): void {
  toastHost ??= document.body.appendChild(h('div', { class: 'toasts', role: 'status' }))
  const progress = h('div', { class: 'toast-progress' })
  const el = h(
    'div',
    { class: `toast ${kind}` },
    h('span', { icon: kind === 'error' ? 'alert' : kind === 'success' ? 'check' : 'zap' }),
    h('span', { text: message }),
    progress
  )
  progress.addEventListener('animationend', () => {
    el.classList.add('leaving')
    el.addEventListener('animationend', () => el.remove(), { once: true })
  })
  toastHost.append(el)
}

export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')
}

type Field = {
  name: string
  label: string
  value?: string
  type?: 'text' | 'url' | 'select'
  options?: [string, string][]
}

export function modal(options: {
  title: string
  fields?: Field[]
  confirm: string
  danger?: boolean
}): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    const inputs = (options.fields ?? []).map((field) => {
      const input =
        field.type === 'select'
          ? h(
              'select',
              { class: 'input', name: field.name },
              ...(field.options ?? []).map(([value, label]) =>
                h('option', { value, text: label, selected: value === field.value })
              )
            )
          : h('input', {
              class: 'input',
              name: field.name,
              type: field.type ?? 'text',
              value: field.value ?? '',
              spellcheck: false
            })
      return { field, input }
    })
    const form = h(
      'form',
      { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': options.title },
      h('h2', { text: options.title }),
      ...inputs.map(({ field, input }) => h('label', { text: field.label }, input)),
      h(
        'div',
        { class: 'modal-actions' },
        h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => close(null) }),
        h('button', {
          class: options.danger ? 'btn danger' : 'btn primary',
          type: 'submit',
          text: options.confirm
        })
      )
    )
    const backdrop = h('div', { class: 'modal-backdrop' }, form)
    const close = (result: Record<string, string> | null) => {
      document.removeEventListener('keydown', onKey)
      backdrop.classList.remove('open')
      backdrop.addEventListener('transitionend', () => backdrop.remove(), { once: true })
      resolve(result)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close(null)
    }
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      close(Object.fromEntries(inputs.map(({ field, input }) => [field.name, input.value.trim()])))
    })
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) close(null)
    })
    document.addEventListener('keydown', onKey)
    document.body.append(backdrop)
    requestAnimationFrame(() => {
      backdrop.classList.add('open')
      ;(inputs[0]?.input ?? form.querySelector('[type=submit]'))?.focus()
    })
  })
}

export async function confirmDialog(title: string, confirm: string): Promise<boolean> {
  return (await modal({ title, confirm, danger: true })) !== null
}

const reducedMotion = () =>
  document.documentElement.hasAttribute('data-reduced-motion') ||
  matchMedia('(prefers-reduced-motion: reduce)').matches

export function countUp(el: HTMLElement, target: number, format: (value: number) => string): void {
  const from = Number(el.dataset.value ?? 0)
  el.dataset.value = String(target)
  if (reducedMotion() || from === target) {
    el.textContent = format(target)
    return
  }
  const start = performance.now()
  const duration = 700
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / duration)
    const eased = 1 - Math.pow(1 - t, 4)
    el.textContent = format(from + (target - from) * eased)
    if (t < 1 && el.dataset.value === String(target)) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`
}

export function skeletons(count: number): HTMLElement[] {
  return Array.from({ length: count }, () => h('div', { class: 'skeleton' }))
}

export function displayUrl(url: string): string {
  return url.startsWith('ox://') ? `0x://${url.slice(5).replace(/\/$/, '')}` : url
}

export async function loadFavicons(): Promise<(url?: string) => string> {
  const favicons = await api.favicons.all()
  return (url) => {
    try {
      return url ? (favicons[new URL(url).origin] ?? '') : ''
    } catch {
      return ''
    }
  }
}
