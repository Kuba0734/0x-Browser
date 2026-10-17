import { app } from 'electron'
import type { PerfSnapshot } from '../shared/types'
import type { TabManager } from './tabs'

export function perfSnapshot(tabs: TabManager): PerfSnapshot {
  const metrics = app.getAppMetrics()
  const byPid = new Map(metrics.map((metric) => [metric.pid, metric]))
  return {
    memoryKB: metrics.reduce((sum, metric) => sum + metric.memory.workingSetSize, 0),
    cpu: metrics.reduce((sum, metric) => sum + metric.cpu.percentCPUUsage, 0),
    processCount: metrics.length,
    tabs: tabs.perfTabs().map(({ pid, ...tab }) => {
      const metric = byPid.get(pid)
      return {
        ...tab,
        memoryKB: metric?.memory.workingSetSize ?? 0,
        cpu: metric?.cpu.percentCPUUsage ?? 0
      }
    })
  }
}
