import type { ConnectivityStatus, LatencySnapshot, Settings } from '@shared/types'
import { anyTcpReachable, tcpProbe } from '@shared/async'
import type { LatencyRepository } from '../data/repositories/latency'
import type { PlatformAdapter } from './platform'
import type { NetworkInfoService } from './network-info'
import type { Logger } from '../logger'

const HISTORY_SIZE = 120

export interface ConnectivityDeps {
  adapter: PlatformAdapter
  networkInfo: NetworkInfoService
  getSettings: () => Settings
  repo: LatencyRepository
  logger: Logger
  now?: () => number
  reachable?: (targets: { host: string; port: number }[], timeoutMs: number) => Promise<boolean>
  tcpLatency?: (host: string, port: number) => Promise<number | null>
}

export function computeJitter(values: number[]): number | null {
  if (values.length < 2) return null
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

export class ConnectivityMonitor {
  private current: ConnectivityStatus
  private history: LatencySnapshot[] = []
  private gatewayCache: { value: string | null; at: number } = { value: null, at: 0 }
  private readonly now: () => number
  private running = false

  constructor(private readonly deps: ConnectivityDeps) {
    this.now = deps.now ?? Date.now
    this.current = {
      internet: false,
      gateway: false,
      dns: false,
      latencyMs: null,
      gatewayLatencyMs: null,
      jitterMs: null,
      packetLoss: null,
      lastCheck: 0,
      checking: true
    }
  }

  getStatus(): ConnectivityStatus {
    return { ...this.current }
  }

  getHistory(): LatencySnapshot[] {
    return [...this.history]
  }

  getLatest(): LatencySnapshot {
    return (
      this.history[this.history.length - 1] ?? {
        timestamp: this.now(),
        gatewayMs: null,
        internetMs: null,
        jitterMs: null,
        lossPercent: null
      }
    )
  }

  async check(): Promise<ConnectivityStatus> {
    if (this.running) return this.getStatus()
    this.running = true
    this.current = { ...this.current, checking: true }
    const startedAt = this.now()
    const settings = this.deps.getSettings()
    const { adapter, logger } = this.deps

    try {
      const gateway = await this.resolveGateway()
      let gatewayMs: number | null = null
      let gatewayOk = false
      if (gateway) {
        const ping = await adapter.ping(gateway, { count: 2, timeoutMs: 700 })
        gatewayMs = ping.rttMs
        gatewayOk = ping.received > 0
      }

      const strictLocal = settings.privacy.strictLocal
      const reachable = this.deps.reachable ?? anyTcpReachable
      // En mode strictement local, seul le réseau local est testé : aucune socket vers Internet.
      const internet = strictLocal
        ? gatewayOk
        : await reachable(
            [
              { host: '1.1.1.1', port: 443 },
              { host: '8.8.8.8', port: 53 }
            ],
            1500
          )

      let dnsOk = false
      try {
        const dns = await adapter.resolveDns('cloudflare.com')
        dnsOk = dns.ok
      } catch {
        dnsOk = false
      }

      let internetMs: number | null = null
      let loss: number | null = null
      if (strictLocal) {
        internetMs = null
        loss = null
      } else if (settings.privacy.allowExternalPing && internet) {
        const ping = await adapter.ping('1.1.1.1', { count: 3, timeoutMs: 1000 })
        internetMs = ping.rttMs
        loss = ping.sent > 0 ? ping.lossPercent : null
        if (internetMs === null && gatewayOk) internetMs = gatewayMs
      } else if (internet) {
        const probe = this.deps.tcpLatency ?? tcpProbe
        internetMs = await probe('1.1.1.1', 443)
        loss = 0
      }

      const sample: LatencySnapshot = {
        timestamp: this.now(),
        gatewayMs,
        internetMs,
        jitterMs: null,
        lossPercent: loss
      }
      const recentValues = this.history
        .slice(-9)
        .map((entry) => entry.internetMs)
        .filter((value): value is number => value !== null)
      if (internetMs !== null) recentValues.push(internetMs)
      sample.jitterMs = computeJitter(recentValues)

      this.history.push(sample)
      if (this.history.length > HISTORY_SIZE) this.history.shift()

      this.current = {
        internet,
        gateway: gatewayOk,
        dns: dnsOk,
        latencyMs: internetMs,
        gatewayLatencyMs: gatewayMs,
        jitterMs: sample.jitterMs,
        packetLoss: loss,
        lastCheck: this.now(),
        checking: false
      }

      try {
        this.deps.repo.insert(sample)
      } catch (error) {
        logger.warn('Enregistrement de la latence impossible', error)
      }
      return this.getStatus()
    } catch (error) {
      logger.warn('Test de connectivité en échec', error)
      this.current = {
        ...this.current,
        internet: false,
        gateway: false,
        dns: false,
        lastCheck: this.now(),
        checking: false
      }
      return this.getStatus()
    } finally {
      this.running = false
      void startedAt
    }
  }

  private async resolveGateway(): Promise<string | null> {
    if (this.now() - this.gatewayCache.at < 60_000 && this.gatewayCache.value) {
      return this.gatewayCache.value
    }
    try {
      const info = await this.deps.networkInfo.get()
      this.gatewayCache = { value: info.gateway, at: this.now() }
      return info.gateway
    } catch {
      return this.gatewayCache.value
    }
  }

  async measurePacketLoss(target: string, count = 10): Promise<{ lossPercent: number; rttMs: number | null; jitterMs: number | null; sent: number; received: number }> {
    const ping = await this.deps.adapter.ping(target, { count, timeoutMs: 1000 })
    return {
      lossPercent: ping.lossPercent,
      rttMs: ping.rttMs,
      jitterMs: computeJitter(ping.times),
      sent: ping.sent,
      received: ping.received
    }
  }
}
