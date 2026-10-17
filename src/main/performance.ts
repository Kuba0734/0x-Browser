import { app, type ProcessMetric } from 'electron'
import type { PerfSnapshot } from '../shared/types'
import type { TabManager } from './tabs'

// Working set counts memory shared between processes once per process; Task Manager shows private memory.
const memoryOf = (metric?: ProcessMetric) =>
  metric ? (metric.memory.privateBytes ?? metric.memory.workingSetSize) : 0

export function perfSnapshot(managers: TabManager[]): PerfSnapshot {
  const metrics = app.getAppMetrics()
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
