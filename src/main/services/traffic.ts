import type {
  InterfaceTraffic,
  TrafficPeriod,
  TrafficPoint,
  TrafficSeries,
  TrafficSnapshot
} from '@shared/types'
import type { TrafficRepository } from '../data/repositories/traffic'
import { periodConfig } from '../data/repositories/traffic'
import type { PlatformAdapter } from './platform'
import type { Logger } from '../logger'

const LIVE_HISTORY_MS = 5 * 60_000
const FLUSH_INTERVAL_MS = 10_000
const TOTALS_INTERVAL_MS = 60_000

export interface TrafficMonitorDeps {
  adapter: PlatformAdapter
  repo: TrafficRepository
  logger: Logger
  now?: () => number
  isExcluded?: (name: string) => boolean
}

/** Agrège des mesures instantanées dans des tranches régulières. */
export function bucketLivePoints(points: TrafficPoint[], from: number, bucketMs: number): TrafficPoint[] {
  if (points.length === 0) return []
  const size = Math.max(1, Math.trunc(bucketMs))
  const buckets = new Map<number, { rx: number; tx: number; count: number }>()
  for (const point of points) {
    if (point.t < from) continue
    const key = Math.floor(point.t / size) * size
    const current = buckets.get(key) ?? { rx: 0, tx: 0, count: 0 }
    current.rx += point.rx
    current.tx += point.tx
    current.count++
    buckets.set(key, current)
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, value]) => ({ t, rx: value.rx / value.count, tx: value.tx / value.count }))
}

export function summarizeSeries(
  period: TrafficPeriod,
  points: TrafficPoint[],
  live: boolean,
  exactTotals?: { rxTotal: number; txTotal: number }
): TrafficSeries {
  const { bucketMs } = periodConfig(period)
  const bucketSeconds = Math.max(1, bucketMs / 1000)
  const peakRx = points.reduce((max, point) => Math.max(max, point.rx), 0)
  const peakTx = points.reduce((max, point) => Math.max(max, point.tx), 0)
  const avgRx = points.length > 0 ? points.reduce((sum, point) => sum + point.rx, 0) / points.length : 0
  const avgTx = points.length > 0 ? points.reduce((sum, point) => sum + point.tx, 0) / points.length : 0
  const rxTotal =
    exactTotals?.rxTotal ?? Math.round(points.reduce((sum, point) => sum + point.rx * bucketSeconds, 0))
  const txTotal =
    exactTotals?.txTotal ?? Math.round(points.reduce((sum, point) => sum + point.tx * bucketSeconds, 0))
  return { period, bucketMs, points, rxTotal, txTotal, peakRx, peakTx, avgRx, avgTx, live }
}

export class TrafficMonitor {
  private last: { at: number; counters: Map<string, { rx: number; tx: number }> } | null = null
  private readonly base = new Map<string, { rx: number; tx: number }>()
  private readonly persisted: Map<string, { rxTotal: number; txTotal: number }>
  private readonly pending = new Map<string, { rx: number; tx: number; rxRate: number; txRate: number; bucket: number }>()
  private history: TrafficPoint[] = []
  private lastFlushAt = 0
  private lastTotalsAt = 0
  private lastSnapshot: TrafficSnapshot | null = null
  private readonly now: () => number

  constructor(private readonly deps: TrafficMonitorDeps) {
    this.now = deps.now ?? Date.now
    this.persisted = deps.repo.getTotals()
  }

  async sample(): Promise<TrafficSnapshot> {
    const now = this.now()
    const { adapter, logger } = this.deps
    let counters: { name: string; rxBytes: number; txBytes: number }[] = []
    let source = 'indisponible'
    try {
      const result = await adapter.getInterfaceCounters()
      counters = result.counters
      source = result.source
    } catch (error) {
      logger.warn('Lecture des compteurs réseau impossible', error)
      return this.emptySnapshot(now, source)
    }

    const isExcluded = this.deps.isExcluded ?? (() => false)
    const included = counters.filter(
      (entry) => !isExcluded(entry.name) && !/^(lo|loopback)/i.test(entry.name) && entry.rxBytes >= 0
    )
    if (included.length === 0) return this.emptySnapshot(now, source)

    const current = new Map(included.map((entry) => [entry.name, { rx: entry.rxBytes, tx: entry.txBytes }]))
    for (const [name, value] of current) {
      if (!this.base.has(name)) this.base.set(name, { ...value })
    }

    const interfaces: InterfaceTraffic[] = []
    let rxRate = 0
    let txRate = 0
    const elapsed = this.last ? Math.max(0.5, (now - this.last.at) / 1000) : 0
    const minuteBucket = Math.floor(now / 60_000)

    for (const [name, value] of current) {
      let deltaRx = 0
      let deltaTx = 0
      if (this.last && elapsed > 0) {
        const previous = this.last.counters.get(name)
        if (previous) {
          deltaRx = value.rx - previous.rx
          deltaTx = value.tx - previous.tx
          // Un compteur qui recule signifie une réinitialisation (débranchement, veille)
          if (deltaRx < 0) deltaRx = 0
          if (deltaTx < 0) deltaTx = 0
        }
      }
      const ifaceRxRate = elapsed > 0 ? deltaRx / elapsed : 0
      const ifaceTxRate = elapsed > 0 ? deltaTx / elapsed : 0
      rxRate += ifaceRxRate
      txRate += ifaceTxRate

      if (deltaRx > 0 || deltaTx > 0) {
        const pending = this.pending.get(name) ?? { rx: 0, tx: 0, rxRate: 0, txRate: 0, bucket: minuteBucket }
        if (pending.bucket !== minuteBucket) {
          pending.rx = 0
          pending.tx = 0
          pending.rxRate = 0
          pending.txRate = 0
          pending.bucket = minuteBucket
        }
        pending.rx += deltaRx
        pending.tx += deltaTx
        pending.rxRate = Math.max(pending.rxRate, ifaceRxRate)
        pending.txRate = Math.max(pending.txRate, ifaceTxRate)
        this.pending.set(name, pending)
      }

      const base = this.base.get(name) ?? value
      let sessionRx = value.rx - base.rx
      let sessionTx = value.tx - base.tx
      if (sessionRx < 0) {
        this.base.set(name, { ...value })
        sessionRx = 0
      }
      if (sessionTx < 0) sessionTx = 0
      const persisted = this.persisted.get(name) ?? { rxTotal: 0, txTotal: 0 }

      interfaces.push({
        name,
        rxRate: ifaceRxRate,
        txRate: ifaceTxRate,
        rxTotal: persisted.rxTotal + sessionRx,
        txTotal: persisted.txTotal + sessionTx
      })
    }

    this.last = { at: now, counters: current }
    this.history.push({ t: now, rx: rxRate, tx: txRate })
    const cutoff = now - LIVE_HISTORY_MS
    if (this.history.length > 1 && this.history[0].t < cutoff) {
      this.history = this.history.filter((point) => point.t >= cutoff)
    }

    const snapshot: TrafficSnapshot = {
      timestamp: now,
      rxRate,
      txRate,
      rxTotal: interfaces.reduce((sum, entry) => sum + entry.rxTotal, 0),
      txTotal: interfaces.reduce((sum, entry) => sum + entry.txTotal, 0),
      interfaces: interfaces.sort((a, b) => b.rxRate + b.txRate - (a.rxRate + a.txRate)),
      source
    }
    this.lastSnapshot = snapshot
    this.flushIfNeeded(now)
    return snapshot
  }

  private emptySnapshot(now: number, source: string): TrafficSnapshot {
    const snapshot: TrafficSnapshot = {
      timestamp: now,
      rxRate: 0,
      txRate: 0,
      rxTotal: 0,
      txTotal: 0,
      interfaces: [],
      source
    }
    this.lastSnapshot = snapshot
    return snapshot
  }

  private flushIfNeeded(now: number): void {
    if (now - this.lastFlushAt < FLUSH_INTERVAL_MS) return
    this.lastFlushAt = now
    try {
      for (const [name, pending] of this.pending) {
        if (pending.rx === 0 && pending.tx === 0) continue
        this.deps.repo.upsertMinute({
          bucket: pending.bucket,
          iface: name,
          rxBytes: pending.rx,
          txBytes: pending.tx,
          rxRate: pending.rxRate,
          txRate: pending.txRate
        })
        pending.rx = 0
        pending.tx = 0
        pending.rxRate = 0
        pending.txRate = 0
      }
      if (now - this.lastTotalsAt >= TOTALS_INTERVAL_MS && this.lastSnapshot) {
        this.lastTotalsAt = now
        for (const iface of this.lastSnapshot.interfaces) {
          this.deps.repo.setTotals(iface.name, iface.rxTotal, iface.txTotal, now)
          this.persisted.set(iface.name, { rxTotal: iface.rxTotal, txTotal: iface.txTotal })
        }
      }
    } catch (error) {
      this.deps.logger.warn("Enregistrement du trafic impossible", error)
    }
  }

  /** Force l'écriture des données en attente (arrêt de l'application). */
  flush(): void {
    this.lastFlushAt = 0
    this.lastTotalsAt = 0
    this.flushIfNeeded(this.now())
  }

  getHistory(): TrafficPoint[] {
    return [...this.history]
  }

  getLastSnapshot(): TrafficSnapshot | null {
    return this.lastSnapshot
  }

  series(period: TrafficPeriod): TrafficSeries {
    const now = this.now()
    const { durationMs, bucketMs } = periodConfig(period)
    const from = now - durationMs
    if (durationMs <= LIVE_HISTORY_MS) {
      const live = bucketLivePoints(this.history, from, bucketMs)
      if (live.length > 0) return summarizeSeries(period, live, true)
    }
    const points = this.deps.repo.series(period, now)
    const totals = this.deps.repo.totalsForPeriod(period, now)
    return summarizeSeries(period, points, false, totals)
  }
}
