import type { ExtensionInfo } from '../../shared/types'
import {
  api,
  confirmDialog,
  errorMessage,
  h,
  initPage,
  reveal,
  skeletons,
  toast
} from '../shared/kit'
import './extensions.css'

const page = document.getElementById('page')!
const list = h('div', { class: 'ext-list' }, ...skeletons(3))
const storeInput = h('input', {
  class: 'input',
  type: 'text',
  placeholder: 'Paste a Chrome Web Store, Edge Add-ons or Opera add-ons link',
  spellcheck: false,
  'aria-label': 'Extension store link'
})
const installButton = h('button', {
  class: 'btn primary',
  type: 'submit',
  icon: 'download',
  text: 'Install'
})
const seen = new Set<string>()

async function busy(button: HTMLButtonElement, action: () => Promise<unknown>): Promise<void> {
  button.disabled = true
  try {
    await action()
  } catch (error) {
    toast(errorMessage(error), 'error')
  } finally {
    button.disabled = false
  }
}

function card(extension: ExtensionInfo): HTMLElement {
  const enabled = h('input', {
    class: 'switch',
    type: 'checkbox',
    checked: extension.enabled,
    'aria-label': `Enable ${extension.name}`,
    onchange: () =>
      api.extensions
        .setEnabled(extension.id, enabled.checked)
        .catch((error) => toast(errorMessage(error), 'error'))
  })
  const el = h(
    'div',
    { class: `card ext-card${extension.enabled ? '' : ' disabled'}` },
    extension.icon
      ? h('img', { class: 'ext-icon', src: extension.icon, alt: '' })
      : h('span', { class: 'ext-icon', icon: 'extensions' }),
    h(
      'div',
      { class: 'row-main' },
      h(
        'div',
        { class: 'ext-name' },
        h('span', { text: extension.name }),
        h('span', { class: 'faint', text: extension.version })
      ),
      h('p', { class: 'ext-description', text: extension.description || 'No description' })
    ),
    h(
      'div',
      { class: 'ext-actions' },
      h('button', {
        class: `icon-btn ext-pin${extension.pinned ? ' active' : ''}`,
        icon: 'pin',
        title: extension.pinned ? 'Unpin from toolbar' : 'Pin to toolbar',
        'aria-pressed': String(extension.pinned),
        disabled: !extension.enabled,
        onclick: () => api.extensions.setPinned(extension.id, !extension.pinned)
      }),
      extension.optionsUrl
        ? h('button', {
            class: 'icon-btn',
            icon: 'settings',
            title: 'Options',
            disabled: !extension.enabled,
            onclick: () => api.extensions.options(extension.id)
          })
        : null,
      h('button', {
        class: 'icon-btn danger',
        icon: 'trash',
        title: 'Remove',
        onclick: async () => {
          if (await confirmDialog(`Remove "${extension.name}"?`, 'Remove'))
            api.extensions
              .remove(extension.id)
              .then(() => toast('Extension removed', 'success'))
              .catch((error) => toast(errorMessage(error), 'error'))
        }
      }),
      enabled
    )
  )
  if (seen.has(extension.id)) el.classList.add('reveal', 'visible')
  seen.add(extension.id)
  return el
}

function apply(extensions: ExtensionInfo[]): void {
  if (!extensions.length) {
    list.replaceChildren(
      h(
        'div',
        { class: 'card empty' },
        h('span', { icon: 'extensions' }),
        h('p', { text: 'No extensions installed yet' })
      )
    )
    return
  }
  list.replaceChildren(...extensions.map(card))
  reveal(list.querySelectorAll('.ext-card:not(.reveal)'))
}

const loadButton = h('button', { class: 'btn', icon: 'folder', text: 'Load from folder' })
loadButton.addEventListener('click', () =>
  busy(loadButton, async () => {
    const installed = await api.extensions.installFolder()
    if (installed) toast(`${installed.name} installed`, 'success')
  })
)

page.append(
  h(
    'header',
    { class: 'page-header' },
    h('h1', { class: 'page-title' }, h('span', { icon: 'extensions' }), 'Extensions'),
    h('div', { class: 'actions' }, loadButton)
  ),
  h(
    'form',
    {
      class: 'card ext-store',
      onsubmit: (event: Event) => {
        event.preventDefault()
        if (!storeInput.value.trim()) return
        busy(installButton, async () => {
          const installed = await api.extensions.installStore(storeInput.value)
          storeInput.value = ''
          toast(`${installed.name} installed`, 'success')
        })
      }
    },
    storeInput,
    installButton
  ),
  h('p', {
    class: 'faint ext-note',
    text: 'Most Chrome extensions work, but some browser APIs are not available yet, so a few features of an extension may not work.'
  }),
  list
)

initPage()
api.extensions.list().then(apply)
api.extensions.onChange(apply)
