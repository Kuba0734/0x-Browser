import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { app, shell, type DownloadItem, type Session } from 'electron'
import type { DownloadState } from '../shared/types'
import { broadcast } from './ipc'
import { log } from './logger'
import { getSettings } from './settings'
import { readJson, writeJson } from './store'

const FILE = 'downloads.json'
const MAX_ENTRIES = 200
const EMIT_INTERVAL = 250

const items = new Map<string, DownloadItem>()
let list: DownloadState[] = []

export function loadDownloads(): void {
  list = readJson<DownloadState[]>(FILE, []).map((entry) =>
    entry.state === 'progressing' || entry.state === 'paused'
      ? { ...entry, state: 'interrupted', speed: 0 }
      : entry
  )
}

function persist(): void {
  writeJson(FILE, list.slice(0, MAX_ENTRIES))
}

function emit(): void {
  broadcast('downloads:changed', list)
}

function uniquePath(dir: string, filename: string): string {
  const ext = extname(filename)
  const name = basename(filename, ext)
  let candidate = join(dir, filename)
  for (let i = 1; existsSync(candidate); i++) candidate = join(dir, `${name} (${i})${ext}`)
  return candidate
}

export function initDownloads(session: Session): void {
  session.on('will-download', (_event, item) => {
    const settings = getSettings()
    if (!settings.askDownloadLocation)
      item.setSavePath(
        uniquePath(settings.downloadDir || app.getPath('downloads'), item.getFilename())
      )
    const state: DownloadState = {
      id: randomUUID(),
      filename: item.getFilename(),
      path: item.getSavePath(),
      totalBytes: item.getTotalBytes(),
      receivedBytes: 0,
      speed: 0,
      state: 'progressing',
      startTime: Date.now()
    }
    list.unshift(state)
    items.set(state.id, item)
    let lastBytes = 0
    let lastSample = Date.now()
    let lastEmit = 0

    item.on('updated', (_updateEvent, itemState) => {
      const now = Date.now()
      const path = item.getSavePath()
      if (path) Object.assign(state, { path, filename: basename(path) })
      state.receivedBytes = item.getReceivedBytes()
      state.totalBytes = item.getTotalBytes()
      state.state =
        itemState === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'progressing'
      if (now - lastSample >= 500) {
        state.speed = ((state.receivedBytes - lastBytes) * 1000) / (now - lastSample)
        lastBytes = state.receivedBytes
        lastSample = now
      }
      if (now - lastEmit >= EMIT_INTERVAL) {
        lastEmit = now
        emit()
      }
    })

    item.once('done', (_doneEvent, doneState) => {
      state.state = doneState
      state.receivedBytes = item.getReceivedBytes()
      state.speed = 0
      items.delete(state.id)
      if (doneState === 'interrupted') log('error', 'downloads', 'Download failed')
      persist()
      emit()
    })

    emit()
  })
}

function entry(id: string): DownloadState {
  const found = list.find((download) => download.id === id)
  if (!found) throw new TypeError('Download not found')
  return found
}

export function listDownloads(): DownloadState[] {
  return list
}

export function pauseDownload(id: string): void {
  items.get(id)?.pause()
  entry(id).state = 'paused'
  entry(id).speed = 0
  emit()
}

export function resumeDownload(id: string): void {
  const item = items.get(id)
  if (!item?.canResume()) return
  item.resume()
  entry(id).state = 'progressing'
  emit()
}

export function cancelDownload(id: string): void {
  items.get(id)?.cancel()
}

export function openDownload(id: string): void {
  const { path, state } = entry(id)
  if (state === 'completed' && existsSync(path)) shell.openPath(path)
}

export function openDownloadFolder(): void {
  shell.openPath(getSettings().downloadDir || app.getPath('downloads'))
}

export function showDownload(id: string): void {
  const { path } = entry(id)
  if (existsSync(path)) shell.showItemInFolder(path)
  else openDownloadFolder()
}

export function removeDownload(id: string): void {
  items.get(id)?.cancel()
  list = list.filter((download) => download.id !== id)
  persist()
  emit()
}

export function clearDownloads(): void {
  list = list.filter((download) => items.has(download.id))
  persist()
  emit()
}
