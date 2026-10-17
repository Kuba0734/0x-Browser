import { randomUUID } from 'node:crypto'
import { ipcMain, type Session, type WebContents } from 'electron'
import {
  isPermissionKey,
  type Decision,
  type PermissionKey,
  type PermissionPrompt,
  type SitePermissions
} from '../shared/permissions'
import { broadcast } from './ipc'
import { readJson, writeJson } from './store'
import { isWebUrl } from './url'

export type PromptPresenter = {
  key: object
  show: (prompt: PermissionPrompt) => void
  hide: () => void
}

type Pending = PermissionPrompt & { resolve: (allowed: boolean) => void; cleanup: () => void }

const FILE = 'permissions.json'
const ALWAYS_ALLOWED = new Set([
  'fullscreen',
  'clipboard-sanitized-write',
  'pointerLock',
  'keyboardLock',
  'mediaKeySystem',
  'persistent-storage',
  'screen-wake-lock',
  'speaker-selection'
])

const QUERYABLE: PermissionKey[] = ['camera', 'microphone', 'geolocation', 'notifications', 'midi']

let store: Record<string, Partial<Record<PermissionKey, Decision>>> = {}
const queues = new Map<object, { presenter: PromptPresenter; items: Pending[] }>()

const originOf = (url = '') => (isWebUrl(url) ? new URL(url).origin : '')

function keysFor(permission: string, mediaTypes: string[] = []): PermissionKey[] {
  if (permission === 'media')
    return [
      ...(mediaTypes.includes('video') ? ['camera' as const] : []),
      ...(mediaTypes.includes('audio') ? ['microphone' as const] : [])
    ]
  if (permission === 'midiSysex') return ['midi']
  if (permission === 'geolocation-approximate') return ['geolocation']
  return isPermissionKey(permission) ? [permission] : []
}

function decision(origin: string, key: PermissionKey): Decision | undefined {
  return store[origin]?.[key]
}

export function loadPermissions(): void {
  store = readJson(FILE, {})
}

export function listPermissions(): SitePermissions[] {
  return Object.entries(store)
    .filter(([, permissions]) => Object.keys(permissions).length)
    .map(([origin, permissions]) => ({ origin, permissions }))
}

function save(): void {
  writeJson(FILE, store)
  broadcast('permissions:changed', listPermissions())
}

export function setPermission(origin: string, key: string, value: Decision | null): void {
  if (!originOf(origin) || !isPermissionKey(key)) throw new TypeError('Invalid permission')
  const site = (store[origin] ??= {})
  if (value) site[key] = value
  else delete site[key]
  if (!Object.keys(site).length) delete store[origin]
  save()
}

export function clearSite(origin: string): void {
  delete store[origin]
  save()
}

const toPrompt = ({ id, origin, permissions }: Pending): PermissionPrompt => ({
  id,
  origin,
  permissions
})

function settle(item: Pending, allowed: boolean): void {
  item.cleanup()
  item.resolve(allowed)
}

function showNext(queue: { presenter: PromptPresenter; items: Pending[] }): void {
  const next = queue.items[0]
  if (next) queue.presenter.show(toPrompt(next))
  else queue.presenter.hide()
}

export function answerPrompt(id: string, allowed: boolean, remember = true): void {
  for (const queue of queues.values()) {
    const item = queue.items.find((entry) => entry.id === id)
    if (!item) continue
    const wasShown = queue.items[0] === item
    queue.items = queue.items.filter((entry) => entry !== item)
    if (remember) {
      const site = (store[item.origin] ??= {})
      for (const key of item.permissions) site[key] = allowed ? 'allow' : 'block'
      save()
    }
    settle(item, allowed)
    // Other requests from the same site may now be decided as well.
    for (const other of [...queue.items]) {
      const decisions = other.permissions.map((key) => decision(other.origin, key))
      if (decisions.some((value) => !value)) continue
      queue.items = queue.items.filter((entry) => entry !== other)
      settle(
        other,
        decisions.every((value) => value === 'allow')
      )
    }
    if (wasShown || !queue.items.length) showNext(queue)
    return
  }
}

function ask(
  contents: WebContents,
  presenter: PromptPresenter,
  origin: string,
  permissions: PermissionKey[]
): Promise<boolean> {
  return new Promise((resolve) => {
    let queue = queues.get(presenter.key)
    if (!queue) {
      queue = { presenter, items: [] }
      queues.set(presenter.key, queue)
    }
    const id = randomUUID()
    const cancel = () => answerPrompt(id, false, false)
    const onNavigate = (_event: unknown, url: string) => {
      if (originOf(url) !== origin) cancel()
    }
    contents.once('destroyed', cancel)
    contents.on('did-navigate', onNavigate)
    const cleanup = () => {
      contents.removeListener('destroyed', cancel)
      contents.removeListener('did-navigate', onNavigate)
    }
    queue.items.push({ id, origin, permissions, resolve, cleanup })
    if (queue.items.length === 1) presenter.show(toPrompt(queue.items[0]))
  })
}

export function initPermissions(
  session: Session,
  presenterFor: (contents: WebContents) => PromptPresenter | null
): void {
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (ALWAYS_ALLOWED.has(permission)) return callback(true)
    const mediaTypes = 'mediaTypes' in details ? (details.mediaTypes ?? []) : []
    const keys = keysFor(permission, mediaTypes)
    const origin = originOf(details.requestingUrl)
    const presenter = presenterFor(contents)
    if (!keys.length || !origin || !presenter) return callback(false)
    const decisions = keys.map((key) => decision(origin, key))
    if (decisions.includes('block')) return callback(false)
    if (decisions.every((value) => value === 'allow')) return callback(true)
    ask(contents, presenter, origin, keys).then(callback)
  })

  session.setPermissionCheckHandler((_contents, permission, requestingOrigin, details) => {
    if (ALWAYS_ALLOWED.has(permission)) return true
    const origin = originOf(requestingOrigin)
    const keys = keysFor(permission, details.mediaType ? [details.mediaType] : [])
    return !!origin && keys.length > 0 && keys.every((key) => decision(origin, key) === 'allow')
  })

  // Electron reports undecided permissions as "denied", so sites would never ask. Pages read their
  // own origin's undecided permissions here and report them as "prompt" instead.
  ipcMain.on('permissions:undecided', (event) => {
    const origin = originOf(event.senderFrame?.url)
    event.returnValue = origin ? QUERYABLE.filter((key) => !decision(origin, key)) : []
  })
}

export function clearAllPermissions(): void {
  store = {}
  save()
}
