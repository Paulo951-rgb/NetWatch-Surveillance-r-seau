import { createSocket } from 'node:dgram'
import type {
  Device,
  NetworkInfo,
  ScanOptions,
  ScanProgress,
  ScanSummary,
  Settings
} from '@shared/types'
import {
  cidrToRange,
  isMulticastMac,
  isPrivateIpv4,
  isSpecialIpv4,
  normalizeMac
} from '@shared/iputil'
import { mapLimit, sleep, tcpProbe } from '@shared/async'
import type { DeviceRepository } from '../data/repositories/devices'
import type { ScanRepository } from '../data/repositories/scans'
import type { EventRepository } from '../data/repositories/events'
import type { OuiDatabase } from './oui'
import { classifyDevice } from './device-classifier'
import { reverseLookup } from './platform/dns'
import type { PlatformAdapter } from './platform'
import type { Logger } from '../logger'

export const DEFAULT_PROBE_PORTS = [22, 80, 443, 445, 3389, 631, 9100, 554, 62078, 8080]
const MAX_HOSTS = 1024
const MAX_OPEN_PORTS = 8

export class ScanError extends Error {}

export type ScanDeviceEvent =
  | { kind: 'new'; device: Device }
  | { kind: 'unknown'; device: Device }
  | { kind: 'online'; device: Device }
  | { kind: 'offline'; device: Device }
  | { kind: 'ip-changed'; device: Device; previousIp: string | null }

export interface ScanDeps {
  adapter: PlatformAdapter
  devices: DeviceRepository
  scans: ScanRepository
  events: EventRepository
  oui: OuiDatabase
  getSettings: () => Settings
  getNetworkInfo: () => Promise<NetworkInfo>
  logger: Logger
  now?: () => number
  reverseLookup?: (ip: string) => Promise<string | null>
  probePort?: (ip: string, port: number, timeoutMs: number) => Promise<boolean>
  nudge?: (hosts: string[]) => Promise<void>
  onProgress?: (progress: ScanProgress) => void
  onDeviceEvent?: (event: ScanDeviceEvent) => void
}

interface HostResult {
  ip: string
  alive: boolean
  latencyMs: number | null
  openPorts: number[]
  hostname: string | null
}

export function deviceLabel(device: Device): string {
  return device.customName || device.hostname || device.vendor || device.mac || device.ip || 'Appareil'
}

export class NetworkScanner {
  private running: Promise<ScanSummary> | null = null
  private cancelRequested = false
  private progress: ScanProgress = {
    scanId: 0,
    phase: 'idle',
    processed: 0,
    total: 0,
    found: 0,
    currentIp: null,
    message: null,
    startedAt: 0,
    error: null
  }
  private readonly now: () => number

  constructor(private readonly deps: ScanDeps) {
    this.now = deps.now ?? Date.now
  }

  isRunning(): boolean {
    return this.running !== null
  }

  getProgress(): ScanProgress {
    return { ...this.progress }
  }

  cancel(): void {
    if (this.running) this.cancelRequested = true
  }

  scan(options: ScanOptions = {}): Promise<ScanSummary> {
    if (this.running) return this.running
    this.cancelRequested = false
    this.running = this.runScan(options).finally(() => {
      this.running = null
    })
    return this.running
  }

  private setProgress(patch: Partial<ScanProgress>): void {
    this.progress = { ...this.progress, ...patch }
    this.deps.onProgress?.({ ...this.progress })
  }

  async resolveRange(requested?: string): Promise<string> {
    const settings = this.deps.getSettings()
    let candidate = (requested ?? settings.scanning.range ?? 'auto').trim()
    if (!candidate || candidate === 'auto') {
      const info = await this.deps.getNetworkInfo()
      if (!info.subnet) {
        throw new ScanError(
          'Impossible de déterminer automatiquement le réseau local. Vérifiez votre connexion ou saisissez une plage (ex. 192.168.1.0/24).'
        )
      }
      candidate = info.subnet
    }
    const range = cidrToRange(candidate, MAX_HOSTS)
    if (!range) {
      throw new ScanError(`Plage invalide : « ${candidate} ». Format attendu : 192.168.1.0/24.`)
    }
    if (!isPrivateIpv4(range.network)) {
      throw new ScanError(
        'Par sécurité, NetWatch ne scanne que les plages privées (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16).'
      )
    }
    if (range.hostCount > MAX_HOSTS) {
      throw new ScanError(
        `Plage trop grande (${range.hostCount} hôtes). Utilisez un masque /22 ou plus petit pour un scan raisonnable.`
      )
    }
    if (range.hostCount === 0) {
      throw new ScanError('La plage ne contient aucun hôte analysable.')
    }
    return `${range.network}/${range.prefix}`
  }

  private async runScan(options: ScanOptions): Promise<ScanSummary> {
    const startedAt = this.now()
    const settings = this.deps.getSettings()
    const trigger = options.trigger ?? 'manual'
    let scanId = 0

    this.setProgress({
      scanId: 0,
      phase: 'discovering',
      processed: 0,
      total: 0,
      found: 0,
      currentIp: null,
      message: 'Préparation du scan',
      startedAt,
      error: null
    })

    try {
      const cidr = await this.resolveRange(options.range)
      const range = cidrToRange(cidr, MAX_HOSTS)
      if (!range) throw new ScanError('Plage invalide')
      scanId = this.deps.scans.create(startedAt, cidr, trigger)

      const hosts = range.hosts.filter((ip) => !isSpecialIpv4(ip))
      const info = await this.deps.getNetworkInfo()
      const localIp = info.localIp
      const gateway = info.gateway

      this.setProgress({
        scanId,
        phase: 'discovering',
        total: hosts.length,
        message: 'Lecture de la table ARP et éveil des hôtes',
        currentIp: null
      })

      const arpBefore = await this.safeArp()
      const nudge = this.deps.nudge ?? defaultNudge
      try {
        await nudge(hosts)
      } catch (error) {
        this.deps.logger.debug('Éveil ARP partiel', error)
      }

      this.setProgress({ phase: 'probing', message: 'Test de présence des hôtes' })
      const concurrency = Math.max(1, Math.min(settings.scanning.concurrency, 64))
      let processed = 0
      let found = 0
      const probe =
        this.deps.probePort ?? (async (ip: string, port: number, timeout: number) => (await tcpProbe(ip, port, timeout)) !== null)

      const arpBeforeMap = new Map<string, string>()
      for (const entry of arpBefore) arpBeforeMap.set(entry.ip, entry.mac)

      const results = await mapLimit<string, HostResult>(hosts, concurrency, async (ip) => {
        if (this.cancelRequested) {
          return { ip, alive: false, latencyMs: null, openPorts: [], hostname: null }
        }
        const ping = await this.deps.adapter.ping(ip, { count: 1, timeoutMs: 700 })
        let alive = ping.received > 0
        let openPorts: number[] = []
        // Un hôte déjà connu dans la table ARP mais qui filtre l'ICMP est testé
        // sur quelques ports : une réponse TCP prouve sa présence.
        const knownInArp = arpBeforeMap.has(ip)
        if (settings.scanning.probePorts && (alive || knownInArp)) {
          const ports = await mapLimit(DEFAULT_PROBE_PORTS, 5, async (port) =>
            (await probe(ip, port, 350)) ? port : 0
          )
          openPorts = ports
            .filter((port): port is number => typeof port === 'number' && port > 0)
            .slice(0, MAX_OPEN_PORTS)
          if (!alive && openPorts.length > 0) alive = true
        }
        processed++
        if (alive) found++
        if (processed % 3 === 0 || processed === hosts.length) {
          this.setProgress({
            processed,
            found,
            currentIp: ip,
            message: `Test de présence : ${processed}/${hosts.length}`
          })
        }
        return { ip, alive, latencyMs: ping.rttMs, openPorts, hostname: null }
      })

      const aliveByPing = new Map<string, HostResult>()
      for (const result of results) {
        if (result && result.alive) aliveByPing.set(result.ip, result)
      }

      const arpAfter = await this.safeArp()
      const arpMap = new Map<string, string>()
      for (const entry of arpAfter) {
        if (isMulticastMac(entry.mac)) continue
        if (!arpMap.has(entry.ip)) arpMap.set(entry.ip, entry.mac)
      }
      // Une nouvelle entrée ARP prouve la présence d'un hôte même si l'ICMP est filtré.
      for (const [ip, mac] of arpMap) {
        if (aliveByPing.has(ip)) continue
        if (!hosts.includes(ip)) continue
        const previous = arpBeforeMap.get(ip)
        if (previous !== undefined && previous === mac) continue
        aliveByPing.set(ip, { ip, alive: true, latencyMs: null, openPorts: [], hostname: null })
      }

      const alive = [...aliveByPing.values()]
      this.setProgress({ phase: 'resolving', found: alive.length, message: 'Résolution des noms d’hôtes' })

      if (settings.scanning.resolveHostnames) {
        const lookup = this.deps.reverseLookup ?? ((ip: string) => reverseLookup(ip, 1200))
        await mapLimit(alive, 8, async (entry) => {
          const known = this.deps.devices.findByIp(entry.ip)?.hostname ?? null
          entry.hostname = known ?? (await lookup(entry.ip))
        })
      } else {
        for (const entry of alive) {
          entry.hostname = this.deps.devices.findByIp(entry.ip)?.hostname ?? null
        }
      }

      if (this.cancelRequested) {
        const finishedAt = this.now()
        this.deps.scans.finish(scanId, {
          finishedAt,
          found: alive.length,
          newDevices: 0,
          offlineDevices: 0,
          durationMs: finishedAt - startedAt,
          error: 'Scan annulé par l’utilisateur'
        })
        this.setProgress({ phase: 'done', message: 'Scan annulé', currentIp: null })
        return {
          id: scanId,
          startedAt,
          finishedAt,
          range: cidr,
          trigger,
          found: alive.length,
          newDevices: 0,
          offlineDevices: 0,
          durationMs: finishedAt - startedAt,
          error: 'Scan annulé par l’utilisateur'
        }
      }

      return this.persist(scanId, startedAt, cidr, trigger, alive, arpMap, info, hosts, gateway, localIp)
    } catch (error) {
      const finishedAt = this.now()
      const message = error instanceof Error ? error.message : 'Erreur inconnue pendant le scan'
      this.deps.logger.error('Échec du scan réseau', error)
      if (scanId > 0) {
        this.deps.scans.finish(scanId, {
          finishedAt,
          found: 0,
          newDevices: 0,
          offlineDevices: 0,
          durationMs: finishedAt - startedAt,
          error: message
        })
      }
      this.setProgress({ phase: 'error', error: message, message, currentIp: null })
      throw error instanceof ScanError ? error : new ScanError(message)
    }
  }

  private persist(
    scanId: number,
    startedAt: number,
    cidr: string,
    trigger: ScanSummary['trigger'],
    alive: HostResult[],
    arpMap: Map<string, string>,
    info: NetworkInfo,
    hosts: string[],
    gateway: string | null,
    localIp: string | null
  ): ScanSummary {
    this.setProgress({ phase: 'saving', message: 'Enregistrement des appareils' })
    const localMac = normalizeMac(info.mac)
    let newDevices = 0
    let offlineDevices = 0
    const seenKeys = new Set<string>()

    for (const entry of alive) {
      const mac = arpMap.get(entry.ip) ?? (entry.ip === localIp ? localMac : '')
      const vendor = mac ? this.deps.oui.lookup(mac) : null
      const isGateway = gateway === entry.ip
      const isLocalHost = localIp === entry.ip
      const deviceType = classifyDevice({
        vendor,
        hostname: entry.hostname,
        openPorts: entry.openPorts,
        isGateway
      })
      const key = mac ? `mac:${mac}` : `ip:${entry.ip}`

      if (mac) {
        const stale = this.deps.devices.getByKey(`ip:${entry.ip}`)
        if (stale && !stale.mac && stale.key !== key) {
          this.deps.devices.rekey(stale.id, key, mac)
        }
      }

      const previous = this.deps.devices.getByKey(key)
      const { device, created } = this.deps.devices.upsert({
        key,
        ip: entry.ip,
        mac: mac || null,
        vendor,
        hostname: entry.hostname,
        deviceType,
        status: 'online',
        openPorts: entry.openPorts,
        isLocalHost,
        isGateway,
        seenAt: this.now()
      })
      seenKeys.add(device.key)
      this.deps.scans.recordDevice(scanId, device.id, 'online', entry.ip)

      if (created) {
        newDevices++
        this.deps.events.insert({
          category: 'device',
          type: 'new-device',
          message: `Nouvel appareil détecté : ${deviceLabel(device)} (${entry.ip})`,
          deviceId: device.id,
          createdAt: this.now(),
          meta: { ip: entry.ip, mac: mac || null, vendor }
        })
        this.deps.onDeviceEvent?.({ kind: 'new', device })
        if (!device.approved) this.deps.onDeviceEvent?.({ kind: 'unknown', device })
      } else if (previous && previous.status === 'offline') {
        this.deps.events.insert({
          category: 'device',
          type: 'device-online',
          message: `${deviceLabel(device)} est de nouveau en ligne (${entry.ip})`,
          deviceId: device.id,
          createdAt: this.now()
        })
        this.deps.onDeviceEvent?.({ kind: 'online', device })
      }

      if (previous && previous.ip && previous.ip !== entry.ip) {
        this.deps.events.insert({
          category: 'network',
          type: 'ip-changed',
          message: `${deviceLabel(device)} a changé d’adresse IP : ${previous.ip} → ${entry.ip}`,
          deviceId: device.id,
          createdAt: this.now(),
          meta: { from: previous.ip, to: entry.ip }
        })
        this.deps.onDeviceEvent?.({ kind: 'ip-changed', device, previousIp: previous.ip })
      }
    }

    const previouslyOnline = this.deps.devices
      .listOnline()
      .filter((device) => device.ip !== null && hosts.includes(device.ip))
    for (const device of previouslyOnline) {
      if (seenKeys.has(device.key)) continue
      this.deps.devices.setStatus(device.id, 'offline', this.now(), device.ip)
      offlineDevices++
      this.deps.events.insert({
        category: 'device',
        type: 'device-offline',
        message: `${deviceLabel(device)} n’est plus joignable (${device.ip ?? 'adresse inconnue'})`,
        deviceId: device.id,
        createdAt: this.now()
      })
      const updated = this.deps.devices.get(device.id)
      if (updated) this.deps.onDeviceEvent?.({ kind: 'offline', device: updated })
    }

    const finishedAt = this.now()
    const durationMs = finishedAt - startedAt
    this.deps.scans.finish(scanId, {
      finishedAt,
      found: alive.length,
      newDevices,
      offlineDevices,
      durationMs
    })
    this.deps.events.insert({
      category: 'scan',
      type: 'scan-complete',
      message: `Scan terminé sur ${cidr} : ${alive.length} appareil(s) actif(s), ${newDevices} nouveau(x)`,
      createdAt: finishedAt,
      meta: { range: cidr, found: alive.length, newDevices, offlineDevices, durationMs }
    })
    this.setProgress({
      phase: 'done',
      processed: hosts.length,
      found: alive.length,
      currentIp: null,
      message: 'Scan terminé'
    })

    return {
      id: scanId,
      startedAt,
      finishedAt,
      range: cidr,
      trigger,
      found: alive.length,
      newDevices,
      offlineDevices,
      durationMs,
      error: null
    }
  }

  private async safeArp(): Promise<{ ip: string; mac: string; iface: string | null }[]> {
    try {
      return await this.deps.adapter.getArpTable()
    } catch (error) {
      this.deps.logger.warn('Lecture de la table ARP impossible', error)
      return []
    }
  }
}

/** Envoie un datagramme UDP minimal pour forcer la résolution ARP des hôtes. */
export async function defaultNudge(hosts: string[]): Promise<void> {
  if (hosts.length === 0) return
  const socket = createSocket({ type: 'udp4' })
  socket.unref()
  await new Promise<void>((resolve) => {
    socket.once('error', () => resolve())
    socket.bind(() => resolve())
  })
  const payload = Buffer.alloc(1)
  for (const host of hosts) {
    for (const port of [9, 137, 5353]) {
      try {
        socket.send(payload, port, host, () => undefined)
      } catch {
        // hôte injoignable : sans importance, on continue
      }
    }
  }
  await sleep(250)
  try {
    socket.close()
  } catch {
    // déjà fermé
  }
}
