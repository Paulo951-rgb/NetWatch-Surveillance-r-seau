import type { ConnectivityStatus, NetworkInfo } from '@shared/types'
import type { AppContext } from './context'

export interface SchedulerOptions {
  ctx: AppContext
  emit: (channel: string, payload: unknown) => void
}

const NETWORK_INFO_INTERVAL = 60_000
const PURGE_INTERVAL = 6 * 60 * 60_000

/**
 * Orchestration des tâches périodiques. Chaque tâche possède son propre
 * minuteur et un verrou pour éviter les exécutions concurrentes.
 */
export class Scheduler {
  private timers = new Map<string, NodeJS.Timeout>()
  private busy = new Set<string>()
  private paused = false
  private lastStatus: ConnectivityStatus | null = null
  private lastNetworkInfo: NetworkInfo | null = null
  private started = false

  constructor(private readonly options: SchedulerOptions) {}

  start(): void {
    if (this.started) return
    this.started = true
    const settings = this.options.ctx.settings.get()

    this.schedule('traffic', settings.monitoring.trafficIntervalMs, () => this.sampleTraffic())
    this.schedule('connectivity', settings.monitoring.latencyIntervalMs, () => this.checkConnectivity())
    this.schedule('connections', settings.monitoring.connectionsIntervalMs, () => this.refreshConnections())
    this.schedule('scan', settings.scanning.intervalMinutes * 60_000, () => this.autoScan())
    this.schedule('network', NETWORK_INFO_INTERVAL, () => this.refreshNetworkInfo())
    this.schedule('purge', PURGE_INTERVAL, () => this.purge())

    // Premières mesures immédiates pour ne pas afficher une interface vide.
    void this.sampleTraffic()
    void this.checkConnectivity()
    void this.refreshNetworkInfo()
    if (settings.scanning.autoScan) {
      setTimeout(() => {
        void this.autoScan('startup')
      }, 4000)
    }
  }

  private schedule(name: string, intervalMs: number, task: () => Promise<void>): void {
    const existing = this.timers.get(name)
    if (existing) clearInterval(existing)
    const safeInterval = Math.max(1000, Math.trunc(intervalMs))
    const timer = setInterval(() => {
      void this.runTask(name, task)
    }, safeInterval)
    timer.unref?.()
    this.timers.set(name, timer)
  }

  private async runTask(name: string, task: () => Promise<void>): Promise<void> {
    if (this.paused || this.busy.has(name)) return
    this.busy.add(name)
    try {
      await task()
    } catch (error) {
      this.options.ctx.logger.warn(`Tâche périodique « ${name} » en échec`, error)
    } finally {
      this.busy.delete(name)
    }
  }

  restart(): void {
    this.stop()
    this.started = false
    this.start()
  }

  stop(): void {
    for (const timer of this.timers.values()) clearInterval(timer)
    this.timers.clear()
    this.started = false
  }

  setPaused(paused: boolean): void {
    this.paused = paused
  }

  isPaused(): boolean {
    return this.paused
  }

  async sampleTraffic(): Promise<void> {
    const snapshot = await this.options.ctx.trafficMonitor.sample()
    this.options.emit('live:traffic', snapshot)
    this.options.ctx.alertEngine.onTraffic(snapshot)
  }

  async checkConnectivity(): Promise<void> {
    const previous = this.lastStatus
    const status = await this.options.ctx.connectivity.check()
    this.lastStatus = status
    this.options.emit('live:status', status)
    this.options.emit('live:latency', this.options.ctx.connectivity.getLatest())
    this.options.ctx.alertEngine.onConnectivityChange(previous, status)
  }

  async refreshConnections(): Promise<void> {
    const snapshot = await this.options.ctx.connections.snapshot()
    this.options.emit('live:connections', snapshot)
  }

  async refreshNetworkInfo(): Promise<void> {
    const info = await this.options.ctx.networkInfo.refresh()
    this.options.ctx.alertEngine.onNetworkInfoChange(this.lastNetworkInfo, info)
    this.lastNetworkInfo = info
  }

  async autoScan(trigger: 'auto' | 'startup' = 'auto'): Promise<void> {
    const ctx = this.options.ctx
    const settings = ctx.settings.get()
    if (!settings.scanning.autoScan || ctx.scanner.isRunning()) return
    const info = await ctx.networkInfo.get().catch(() => null)
    if (!info?.subnet) {
      ctx.logger.info('Scan automatique ignoré : aucun réseau local exploitable détecté')
      return
    }
    try {
      const summary = await ctx.scanner.scan({ trigger })
      this.options.emit('live:scan-done', summary)
      ctx.alertEngine.checkOfflineDevices(ctx.devices.listAll())
      this.options.emit('live:devices', ctx.devices.list({ limit: 1000 }))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Échec du scan automatique'
      ctx.logger.warn('Scan automatique en échec', error)
      ctx.alertEngine.onScanError(message)
    }
  }

  private async purge(): Promise<void> {
    const ctx = this.options.ctx
    const days = ctx.settings.get().retention.days
    const cutoff = Date.now() - days * 24 * 60 * 60_000
    const removed =
      ctx.events.deleteOlderThan(cutoff) +
      ctx.alerts.deleteOlderThan(cutoff) +
      ctx.scans.deleteOlderThan(cutoff) +
      ctx.trafficRepo.deleteOlderThan(cutoff) +
      ctx.latencyRepo.deleteOlderThan(cutoff)
    ctx.alerts.trimTo(ctx.settings.get().retention.maxAlerts)
    if (removed > 0) ctx.logger.info(`Purge automatique : ${removed} enregistrements (${days} jours)`)
  }
}
