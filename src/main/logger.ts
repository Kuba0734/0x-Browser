import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

type Level = 'error' | 'warn' | 'info'

export function log(level: Level, module: string, message: string): void {
  try {
    const dir = join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    const line = `${new Date().toISOString()} ${level.toUpperCase()} [${module}] ${message}\n`
    appendFileSync(join(dir, '0x.log'), line)
  } catch (error) {
    console.error(error)
  }
}
