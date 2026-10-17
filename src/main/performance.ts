import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { parse } from 'node:path'
import { app, type ProcessMetric } from 'electron'
import type { PerfSnapshot } from '../shared/types'
import type { TabManager } from './tabs'

const HELPER_IDLE_MS = 10_000
const QUERY_TIMEOUT_MS = 5_000
const PROCESS_NAME = parse(process.execPath).name.replace(/'/g, '')

// Electron only exposes working set and private bytes; Task Manager shows the private working set,
// which Windows publishes through performance counters. A PowerShell helper reads them while the
// performance page asks for numbers and exits after a short idle time.
let helper: ChildProcessWithoutNullStreams | null = null
let output = ''
let nextQuery = 1
let idleTimer: NodeJS.Timeout | undefined
const waiting = new Map<number, (lines: string[]) => void>()

function startHelper(): ChildProcessWithoutNullStreams {
  const child = spawn(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'],
    {
      windowsHide: true
    }
  )
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    output += chunk
    for (let match = /---(\d+)/.exec(output); match; match = /---(\d+)/.exec(output)) {
      const lines = output.slice(0, match.index).split(/\r?\n/)
      output = output.slice(match.index + match[0].length)
      const resolve = waiting.get(Number(match[1]))
      waiting.delete(Number(match[1]))
      resolve?.(lines)
    }
  })
  child.on('error', () => undefined)
  child.on('exit', () => {
    helper = null
    output = ''
    for (const resolve of waiting.values()) resolve([])
    waiting.clear()
  })
  return child
}

function privateWorkingSets(): Promise<Map<number, number>> {
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => helper?.kill(), HELPER_IDLE_MS)
  const child = (helper ??= startHelper())
  const id = nextQuery++
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      waiting.delete(id)
      resolve(new Map())
    }, QUERY_TIMEOUT_MS)
    waiting.set(id, (lines) => {
      clearTimeout(timeout)
      const sets = new Map<number, number>()
      for (const line of lines) {
        const [pid, bytes] = line.trim().split('=').map(Number)
        if (pid && Number.isFinite(bytes)) sets.set(pid, bytes)
      }
      resolve(sets)
    })
    child.stdin.write(
      `Get-CimInstance Win32_PerfRawData_PerfProc_Process -Filter "Name like '${PROCESS_NAME}%'" | ForEach-Object { "$($_.IDProcess)=$($_.WorkingSetPrivate)" }; '---${id}'\n`
    )
  })
}

export async function perfSnapshot(managers: TabManager[]): Promise<PerfSnapshot> {
  const metrics = app.getAppMetrics()
  const privateSets = await privateWorkingSets()
  const memoryOf = (metric?: ProcessMetric) => {
    if (!metric) return 0
    const exact = privateSets.get(metric.pid)
    return exact === undefined
      ? (metric.memory.privateBytes ?? metric.memory.workingSetSize)
      : exact / 1024
  }
  const byPid = new Map(metrics.map((metric) => [metric.pid, metric]))
  return {
    memoryKB: metrics.reduce((sum, metric) => sum + memoryOf(metric), 0),
    cpu: metrics.reduce((sum, metric) => sum + metric.cpu.percentCPUUsage, 0),
    processCount: metrics.length,
    tabs: managers.flatMap((tabs) =>
      tabs.perfTabs().map(({ pid, ...tab }) => {
        const metric = byPid.get(pid)
        return { ...tab, memoryKB: memoryOf(metric), cpu: metric?.cpu.percentCPUUsage ?? 0 }
      })
    )
  }
}
