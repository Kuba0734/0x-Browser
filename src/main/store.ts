import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { log } from './logger'

export function dataPath(name: string): string {
  return join(app.getPath('userData'), name)
}

export function readJson<T>(name: string, fallback: T): T {
  const file = dataPath(name)
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      log('error', 'store', `${name} unreadable, kept as ${name}.corrupt`)
      renameSync(file, `${file}.corrupt`)
    }
    return fallback
  }
}

export function writeJson(name: string, data: unknown): void {
  const file = dataPath(name)
  const temp = `${file}.tmp`
  writeFileSync(temp, JSON.stringify(data))
  renameSync(temp, file)
}

export function createSaver(name: string, get: () => unknown) {
  let timer: NodeJS.Timeout | undefined
  const flush = () => {
    if (!timer) return
    clearTimeout(timer)
    timer = undefined
    writeJson(name, get())
  }
  return {
    schedule: () => {
      clearTimeout(timer)
      timer = setTimeout(flush, 300)
    },
    flush
  }
}
