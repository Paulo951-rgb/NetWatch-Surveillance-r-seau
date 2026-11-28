import type {
  Alert,
  AlertSeverity,
  AlertType,
  ConnectivityStatus,
  Device,
  NetworkInfo,
  Settings,
  TrafficSnapshot
} from '@shared/types'
import { formatMs, formatRate } from '@shared/format'
import type { AlertRepository } from '../data/repositories/alerts'
import type { EventRepository } from '../data/repositories/events'
import { deviceLabel, type ScanDeviceEvent } from '../services/scanner'
import type { Logger } from '../logger'

export interface AlertEngineDeps {
  alerts: AlertRepository
  events: EventRepository
  getSettings: () => Settings
  logger: Logger
  now?: () => number
  notify?: (alert: Alert) => void
  onAlert?: (alert: Alert) => void
}

const SEVERITY_ORDER: Record<AlertSeverity, number> = { info: 1, warning: 2, critical: 3 }

/** Nombre d'échantillons conservés pour établir le comportement habituel (≈ 4 min à 2 s). */
const BASELINE_WINDOW = 120
const BASELINE_MIN_SAMPLES = 30

export class AlertEngine {
  private readonly lastRaised = new Map<string, number>()
  private readonly now: () => number
  private readonly trafficBaseline: number[] = []

  constructor(private readonly deps: AlertEngineDeps) {
    this.now = deps.now ?? Date.now
  }

  /** Crée une alerte si la règle est autorisée et hors période de repos. */
  raise(input: {
    type: AlertType
    severity: AlertSeverity
    title: string
    message: string
    deviceId?: number | null
    rule: string
  }): Alert | null {
    const settings = this.deps.getSettings()
    const cooldownMs = settings.alerts.cooldownMinutes * 60_000
    const now = this.now()
    const last = this.lastRaised.get(input.rule) ?? 0
    if (cooldownMs > 0 && now - last < cooldownMs) return null

    const previous = this.deps.alerts.lastForRule(input.rule)
    if (previous && cooldownMs > 0 && now - previous.createdAt < cooldownMs) {
      this.lastRaised.set(input.rule, previous.createdAt)
      return null
    }

    try {
      const alert = this.deps.alerts.insert({
        type: input.type,
        severity: input.severity,
        title: input.title,
        message: input.message,
        deviceId: input.deviceId ?? null,
        createdAt: now,
        rule: input.rule
      })
      this.lastRaised.set(input.rule, now)
      this.deps.events.insert({
        category: 'alert',
        type: input.type,
        message: `${input.title} — ${input.message}`,
        deviceId: input.deviceId ?? null,
        createdAt: now,
        meta: { severity: input.severity, rule: input.rule }
      })
      this.deps.onAlert?.(alert)
      const threshold = SEVERITY_ORDER[settings.notifications.minSeverity]
      if (
        settings.notifications.enabled &&
        settings.notifications.native &&
        SEVERITY_ORDER[input.severity] >= threshold
      ) {
        this.deps.notify?.(alert)
      }
      return alert
    } catch (error) {
      this.deps.logger.error("Impossible d'enregistrer l'alerte", error)
      return null
    }
  }

  handleDeviceEvent(event: ScanDeviceEvent): void {
    const settings = this.deps.getSettings()
    const device = event.device
    switch (event.kind) {
      case 'new':
        if (settings.alerts.newDevice) {
          this.raise({
            type: 'new-device',
            severity: 'info',
            title: 'Nouvel appareil détecté',
            message: `${deviceLabel(device)}${device.ip ? ` (${device.ip})` : ''}${
              device.vendor ? ` · ${device.vendor}` : ''
            } a rejoint le réseau.`,
            deviceId: device.id,
            rule: `new-device:${device.key}`
          })
        }
        break
      case 'unknown':
        if (settings.alerts.unknownDevice) {
          this.raise({
            type: 'unknown-device',
            severity: 'warning',
            title: 'Appareil non approuvé',
            message: `${deviceLabel(device)}${device.ip ? ` (${device.ip})` : ''} n’est pas approuvé. Vérifiez qu’il s’agit bien de votre matériel.`,
            deviceId: device.id,
            rule: `unknown-device:${device.key}`
          })
        }
        break
      case 'offline':
        if (settings.alerts.deviceOffline) {
          this.raise({
            type: 'device-offline',
            severity: 'warning',
            title: 'Appareil hors ligne',
            message: `${deviceLabel(device)}${device.ip ? ` (${device.ip})` : ''} ne répond plus.`,
            deviceId: device.id,
            rule: `device-offline:${device.key}`
          })
        }
        break
      default:
        break
    }
  }

  onConnectivityChange(previous: ConnectivityStatus | null, current: ConnectivityStatus): void {
    const settings = this.deps.getSettings()
    if (!previous || previous.lastCheck === 0) {
      if (!current.internet && settings.alerts.internetLost) {
        this.raise({
          type: 'internet-lost',
          severity: 'critical',
          title: 'Connexion Internet indisponible',
          message: 'Aucune connexion aux serveurs publics n’a pu être établie.',
          rule: 'internet-lost'
        })
      }
      return
    }
    if (previous.internet && !current.internet && settings.alerts.internetLost) {
      this.raise({
        type: 'internet-lost',
        severity: 'critical',
        title: 'Connexion Internet perdue',
        message: 'Le poste n’atteint plus les serveurs publics. Vérifiez la box et le lien opérateur.',
        rule: 'internet-lost'
      })
    }
    if (!previous.internet && current.internet) {
      this.raise({
        type: 'internet-restored',
        severity: 'info',
        title: 'Connexion Internet rétablie',
        message: 'La connexion aux serveurs publics fonctionne de nouveau.',
        rule: 'internet-restored'
      })
    }
    if (
      settings.alerts.highLatency &&
      current.latencyMs !== null &&
      current.latencyMs > settings.alerts.highLatencyMs
    ) {
      this.raise({
        type: 'high-latency',
        severity: 'warning',
        title: 'Latence anormalement élevée',
        message: `Latence mesurée à ${formatMs(current.latencyMs)} (seuil : ${formatMs(
          settings.alerts.highLatencyMs
        )}).`,
        rule: 'high-latency'
      })
    }
    if (settings.alerts.dnsFailure && current.internet && !current.dns) {
      this.raise({
        type: 'dns-failure',
        severity: 'warning',
        title: 'Résolution DNS en échec',
        message: 'Internet répond mais les noms de domaine ne se résolvent plus.',
        rule: 'dns-failure'
      })
    }
  }

  onTraffic(snapshot: TrafficSnapshot): void {
    const settings = this.deps.getSettings()
    const totalRate = snapshot.rxRate + snapshot.txRate
    const mbps = (totalRate * 8) / 1_000_000

    if (settings.alerts.highTraffic && mbps >= settings.alerts.highTrafficMbps) {
      this.raise({
        type: 'high-traffic',
        severity: 'info',
        title: 'Débit inhabituellement élevé',
        message: `Trafic total de ${formatRate(totalRate)} (seuil : ${
          settings.alerts.highTrafficMbps
        } Mbit/s).`,
        rule: 'high-traffic'
      })
    }

    const anomaly = this.detectTrafficAnomaly(totalRate)
    if (settings.alerts.trafficAnomaly && anomaly) {
      this.raise({
        type: 'traffic-anomaly',
        severity: 'warning',
        title: 'Variation de trafic inhabituelle',
        message: anomaly,
        rule: 'traffic-anomaly'
      })
    }
  }

  /**
   * Compare le débit courant au comportement des dernières minutes.
   * Une variation mesurée n'est pas une preuve d'attaque : le message le rappelle.
   */
  private detectTrafficAnomaly(totalRate: number): string | null {
    const window = this.trafficBaseline
    const samples = window.length
    window.push(totalRate)
    if (window.length > BASELINE_WINDOW) window.shift()
    if (samples < BASELINE_MIN_SAMPLES) return null

    const mean = window.reduce((sum, value) => sum + value, 0) / window.length
    if (mean <= 0) return null
    const variance =
      window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / window.length
    const deviation = Math.sqrt(variance)

    const significant = totalRate > mean + Math.max(3 * deviation, mean * 2)
    const aboveFloor = totalRate > 500_000 // 4 Mbit/s : évite le bruit de fond
    if (!significant || !aboveFloor) return null

    const ratio = (totalRate / mean).toFixed(1).replace('.', ',')
    return (
      `Débit de ${formatRate(totalRate)} contre ${formatRate(mean)} en moyenne sur les ` +
      `dernières minutes (×${ratio}). Un pic peut venir d’une mise à jour, d’une sauvegarde ` +
      `ou d’un téléchargement : ce n’est pas nécessairement une activité malveillante.`
    )
  }

  onNetworkInfoChange(previous: NetworkInfo | null, current: NetworkInfo): void {
    const settings = this.deps.getSettings()
    if (!previous) return
    if (settings.alerts.localIpChanged && previous.localIp && current.localIp && previous.localIp !== current.localIp) {
      this.raise({
        type: 'local-ip-changed',
        severity: 'warning',
        title: 'Changement d’adresse IP locale',
        message: `L’adresse IP du poste est passée de ${previous.localIp} à ${current.localIp}.`,
        rule: 'local-ip-changed'
      })
    }
    if (previous.gateway && current.gateway && previous.gateway !== current.gateway) {
      this.raise({
        type: 'gateway-changed',
        severity: 'warning',
        title: 'Changement de passerelle',
        message: `La passerelle par défaut est passée de ${previous.gateway} à ${current.gateway}.`,
        rule: 'gateway-changed'
      })
    }
  }

  /** Appareils hors ligne depuis plus longtemps que le seuil configuré. */
  checkOfflineDevices(devices: Device[]): void {
    const settings = this.deps.getSettings()
    if (!settings.alerts.deviceOffline) return
    const now = this.now()
    const threshold = settings.alerts.deviceOfflineMinutes * 60_000
    for (const device of devices) {
      if (device.status !== 'offline') continue
      if (now - device.lastStatusChange < threshold) continue
      if (device.isGateway || device.isLocalHost) continue
      this.raise({
        type: 'device-offline',
        severity: 'warning',
        title: 'Appareil absent depuis longtemps',
        message: `${deviceLabel(device)}${device.ip ? ` (${device.ip})` : ''} est hors ligne depuis plus de ${
          settings.alerts.deviceOfflineMinutes
        } minutes.`,
        deviceId: device.id,
        rule: `device-absent:${device.key}`
      })
    }
  }

  onScanError(message: string): void {
    this.raise({
      type: 'scan-error',
      severity: 'warning',
      title: 'Échec du scan réseau',
      message,
      rule: 'scan-error'
    })
  }
}
