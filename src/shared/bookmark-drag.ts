export type DropPosition = 'before' | 'after' | 'into'

const MIME = 'application/x-0x-bookmark'
const CLASSES = ['drop-before', 'drop-after', 'drop-into']

function dropTarget(
  el: HTMLElement,
  position: (event: DragEvent) => DropPosition,
  onDrop: (id: string, position: DropPosition) => void,
  ownId?: string
): void {
  const clear = () => el.classList.remove(...CLASSES)
  el.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types.includes(MIME)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    clear()
    el.classList.add(`drop-${position(event)}`)
  })
  el.addEventListener('dragleave', (event) => {
    if (!el.contains(event.relatedTarget as Node | null)) clear()
  })
  el.addEventListener('drop', (event) => {
    const id = event.dataTransfer?.getData(MIME)
    if (!id) return
    event.preventDefault()
    event.stopPropagation()
    clear()
    if (id !== ownId) onDrop(id, position(event))
  })
}

export function folderDropTarget(el: HTMLElement, onDrop: (id: string) => void): void {
  dropTarget(el, () => 'into', onDrop)
}

export function draggableBookmark(
  el: HTMLElement,
  id: string,
  options: {
    horizontal: boolean
    folder: boolean
    onDrop?: (id: string, position: DropPosition) => void
  }
): void {
  el.draggable = true
  el.addEventListener('dragstart', (event) => {
    if (!event.dataTransfer) return
    event.dataTransfer.setData(MIME, id)
    event.dataTransfer.effectAllowed = 'move'
    requestAnimationFrame(() => el.classList.add('dragging'))
  })
  el.addEventListener('dragend', () => el.classList.remove('dragging'))
  if (!options.onDrop) return
  const position = (event: DragEvent): DropPosition => {
    const rect = el.getBoundingClientRect()
    const ratio = options.horizontal
      ? (event.clientX - rect.left) / rect.width
      : (event.clientY - rect.top) / rect.height
    if (options.folder && ratio > 0.25 && ratio < 0.75) return 'into'
    return ratio < 0.5 ? 'before' : 'after'
  }
  dropTarget(el, position, options.onDrop, id)
}
