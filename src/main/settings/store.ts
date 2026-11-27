import type { AlertSeverity, MonitoringProfile, Settings } from '@shared/types'
import type { SettingsRepository } from '../data/repositories/settings'

const SETTINGS_KEY = 'app.settings'
const PROFILES_KEY = 'app.profiles'

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  language: 'fr',
  notifications: { enabled: true, native: true, minSeverity: 'warning' },
  scanning: {
    autoScan: true,
    intervalMinutes: 15,
    range: 'auto',
    concurrency: 24,
    resolveHostnames: true,
    probePorts: true
  },
  monitoring: {
    enabled: true,
    refreshIntervalMs: 5000,
    trafficIntervalMs: 2000,
    latencyIntervalMs: 15000,
    connectionsIntervalMs: 5000,
    backgroundWhenMinimized: true
  },
  alerts: {
    newDevice: true,
    unknownDevice: true,
    deviceOffline: true,
    internetLost: true,
    highLatency: true,
    highTraffic: true,
    trafficAnomaly: true,
    localIpChanged: true,
    dnsFailure: true,
    highLatencyMs: 120,
    highTrafficMbps: 80,
    deviceOfflineMinutes: 10,
    cooldownMinutes: 10
  },
  retention: { days: 30, maxAlerts: 1000 },
  startup: { launchAtLogin: false, startMinimized: false, minimizeToTray: true },
  privacy: { allowPublicIp: false, allowExternalPing: true, strictLocal: false },
  advanced: { activeProfileId: 'balanced', showExperimental: false },
  export: { defaultFormat: 'csv', includeHeaders: true }
}

export const BUILTIN_PROFILES: MonitoringProfile[] = [
  {
    id: 'balanced',
    name: 'Équilibré',
    description: 'Scan toutes les 15 minutes, rafraîchissement toutes les 5 secondes.',
    builtin: true,
    overrides: {}
  },
  {
    id: 'discreet',
    name: 'Discret',
    description: 'Scans espacés (1 h), sans test de ports, pour un réseau sensible.',
    builtin: true,
    overrides: {
      scanning: { intervalMinutes: 60, probePorts: false, concurrency: 12 },
      monitoring: { refreshIntervalMs: 10000, connectionsIntervalMs: 15000 },
      alerts: { cooldownMinutes: 30 }
    }
  },
  {
    id: 'intensive',
    name: 'Intensif',
    description: 'Scan toutes les 5 minutes avec test de ports et suivi rapproché.',
    builtin: true,
    overrides: {
      scanning: { intervalMinutes: 5, probePorts: true, concurrency: 32 },
      monitoring: { refreshIntervalMs: 3000, connectionsIntervalMs: 3000, latencyIntervalMs: 10000 },
      alerts: { cooldownMinutes: 5 }
    }
  },
  {
    id: 'always-on',
    name: 'Veille 24/7',
    description: 'Surveillance continue avec conservation étendue de l’historique.',
    builtin: true,
    overrides: {
      scanning: { intervalMinutes: 30, probePorts: false },
      monitoring: { refreshIntervalMs: 8000, backgroundWhenMinimized: true },
      alerts: { deviceOfflineMinutes: 20 }
    }
  }
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function int(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.trunc(Math.min(max, Math.max(min, parsed)))
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

function text(value: unknown, fallback: string, maxLength = 64): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > maxLength) return fallback
  return trimmed
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** Valide et normalise des paramètres quelconques (données de disque comprises). */
export function sanitizeSettings(raw: unknown, defaults: Settings = DEFAULT_SETTINGS): Settings {
  const base = defaults
  if (!isRecord(raw)) return clone(base)
  const notifications = isRecord(raw.notifications) ? raw.notifications : {}
  const scanning = isRecord(raw.scanning) ? raw.scanning : {}
  const monitoring = isRecord(raw.monitoring) ? raw.monitoring : {}
  const alerts = isRecord(raw.alerts) ? raw.alerts : {}
  const retention = isRecord(raw.retention) ? raw.retention : {}
  const startup = isRecord(raw.startup) ? raw.startup : {}
  const privacy = isRecord(raw.privacy) ? raw.privacy : {}
  const advanced = isRecord(raw.advanced) ? raw.advanced : {}
  const exportSettings = isRecord(raw.export) ? raw.export : {}

  return {
    theme: oneOf(raw.theme, ['dark', 'light'] as const, base.theme),
    language: oneOf(raw.language, ['fr', 'en'] as const, base.language),
    notifications: {
      enabled: bool(notifications.enabled, base.notifications.enabled),
      native: bool(notifications.native, base.notifications.native),
      minSeverity: oneOf<AlertSeverity>(
        notifications.minSeverity,
        ['info', 'warning', 'critical'],
        base.notifications.minSeverity
      )
    },
    scanning: {
      autoScan: bool(scanning.autoScan, base.scanning.autoScan),
      intervalMinutes: int(scanning.intervalMinutes, base.scanning.intervalMinutes, 1, 1440),
      range: text(scanning.range, base.scanning.range, 32),
      concurrency: int(scanning.concurrency, base.scanning.concurrency, 1, 64),
      resolveHostnames: bool(scanning.resolveHostnames, base.scanning.resolveHostnames),
      probePorts: bool(scanning.probePorts, base.scanning.probePorts)
    },
    monitoring: {
      enabled: bool(monitoring.enabled, base.monitoring.enabled),
      refreshIntervalMs: int(monitoring.refreshIntervalMs, base.monitoring.refreshIntervalMs, 1000, 60000),
      trafficIntervalMs: int(monitoring.trafficIntervalMs, base.monitoring.trafficIntervalMs, 1000, 60000),
      latencyIntervalMs: int(monitoring.latencyIntervalMs, base.monitoring.latencyIntervalMs, 5000, 600000),
      connectionsIntervalMs: int(
        monitoring.connectionsIntervalMs,
        base.monitoring.connectionsIntervalMs,
        2000,
        300000
      ),
      backgroundWhenMinimized: bool(
        monitoring.backgroundWhenMinimized,
        base.monitoring.backgroundWhenMinimized
      )
    },
    alerts: {
      newDevice: bool(alerts.newDevice, base.alerts.newDevice),
      unknownDevice: bool(alerts.unknownDevice, base.alerts.unknownDevice),
      deviceOffline: bool(alerts.deviceOffline, base.alerts.deviceOffline),
      internetLost: bool(alerts.internetLost, base.alerts.internetLost),
      highLatency: bool(alerts.highLatency, base.alerts.highLatency),
      highTraffic: bool(alerts.highTraffic, base.alerts.highTraffic),
      trafficAnomaly: bool(alerts.trafficAnomaly, base.alerts.trafficAnomaly),
      localIpChanged: bool(alerts.localIpChanged, base.alerts.localIpChanged),
      dnsFailure: bool(alerts.dnsFailure, base.alerts.dnsFailure),
      highLatencyMs: int(alerts.highLatencyMs, base.alerts.highLatencyMs, 10, 5000),
      highTrafficMbps: int(alerts.highTrafficMbps, base.alerts.highTrafficMbps, 1, 100000),
      deviceOfflineMinutes: int(alerts.deviceOfflineMinutes, base.alerts.deviceOfflineMinutes, 1, 1440),
      cooldownMinutes: int(alerts.cooldownMinutes, base.alerts.cooldownMinutes, 0, 1440)
    },
    retention: {
      days: int(retention.days, base.retention.days, 1, 3650),
      maxAlerts: int(retention.maxAlerts, base.retention.maxAlerts, 50, 100000)
    },
    startup: {
      launchAtLogin: bool(startup.launchAtLogin, base.startup.launchAtLogin),
      startMinimized: bool(startup.startMinimized, base.startup.startMinimized),
      minimizeToTray: bool(startup.minimizeToTray, base.startup.minimizeToTray)
    },
    privacy: {
      allowPublicIp: bool(privacy.allowPublicIp, base.privacy.allowPublicIp),
      allowExternalPing: bool(privacy.allowExternalPing, base.privacy.allowExternalPing),
      strictLocal: bool(privacy.strictLocal, base.privacy.strictLocal)
    },
    advanced: {
      activeProfileId: text(advanced.activeProfileId, base.advanced.activeProfileId, 64),
      showExperimental: bool(advanced.showExperimental, base.advanced.showExperimental)
    },
    export: {
      defaultFormat: oneOf(exportSettings.defaultFormat, ['csv', 'json'] as const, base.export.defaultFormat),
      includeHeaders: bool(exportSettings.includeHeaders, base.export.includeHeaders)
    }
  }
}

/** Fusion profonde de deux objets de paramètres (les scalaires écrasent). */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isRecord(base) || !isRecord(patch)) return (patch === undefined ? base : (patch as T))
  const result: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    const current = (base as Record<string, unknown>)[key]
    result[key] = isRecord(current) && isRecord(value) ? deepMerge(current, value) : value
  }
  return result as T
}

export class SettingsStore {
  private current: Settings
  private customProfiles: MonitoringProfile[] = []
  private readonly listeners: ((settings: Settings) => void)[] = []

  constructor(private readonly repo: SettingsRepository) {
    const stored = repo.all()
    this.current = sanitizeSettings(safeParse(stored[SETTINGS_KEY]))
    this.customProfiles = parseProfiles(safeParse(stored[PROFILES_KEY]))
    if (!this.profiles().some((profile) => profile.id === this.current.advanced.activeProfileId)) {
      this.current.advanced.activeProfileId = 'balanced'
    }
  }

  get(): Settings {
    return clone(this.current)
  }

  onChange(listener: (settings: Settings) => void): () => void {
    this.listeners.push(listener)
    return () => {
      const index = this.listeners.indexOf(listener)
      if (index >= 0) this.listeners.splice(index, 1)
    }
  }

  update(patch: unknown): Settings {
    // Les valeurs invalides conservent le réglage courant au lieu de revenir au défaut.
    this.current = sanitizeSettings(deepMerge(this.current, patch), this.current)
    this.persist()
    this.emit()
    return this.get()
  }

  replace(settings: Settings): Settings {
    this.current = sanitizeSettings(settings)
    this.persist()
    this.emit()
    return this.get()
  }

  reset(): Settings {
    this.current = clone(DEFAULT_SETTINGS)
    this.persist()
    this.emit()
    return this.get()
  }

  profiles(): MonitoringProfile[] {
    return [...BUILTIN_PROFILES, ...this.customProfiles]
  }

  saveProfile(input: {
    name: string
    description: string
    overrides: MonitoringProfile['overrides']
  }): MonitoringProfile {
    const profile: MonitoringProfile = {
      id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: input.name.trim().slice(0, 40) || 'Profil personnalisé',
      description: input.description.trim().slice(0, 160),
      builtin: false,
      overrides: input.overrides
    }
    this.customProfiles.push(profile)
    this.persistProfiles()
    return profile
  }

  deleteProfile(id: string): boolean {
    if (BUILTIN_PROFILES.some((profile) => profile.id === id)) return false
    const before = this.customProfiles.length
    this.customProfiles = this.customProfiles.filter((profile) => profile.id !== id)
    if (this.customProfiles.length === before) return false
    this.persistProfiles()
    if (this.current.advanced.activeProfileId === id) {
      this.current.advanced.activeProfileId = 'balanced'
      this.persist()
      this.emit()
    }
    return true
  }

  applyProfile(id: string): Settings {
    const profile = this.profiles().find((entry) => entry.id === id)
    if (!profile) return this.get()
    const merged = deepMerge(this.current, profile.overrides)
    merged.advanced = { ...this.current.advanced, activeProfileId: id }
    this.current = sanitizeSettings(merged)
    this.persist()
    this.emit()
    return this.get()
  }

  private persist(): void {
    this.repo.set(SETTINGS_KEY, JSON.stringify(this.current))
  }

  private persistProfiles(): void {
    this.repo.set(PROFILES_KEY, JSON.stringify(this.customProfiles))
  }

  private emit(): void {
    const snapshot = this.get()
    for (const listener of this.listeners) {
      try {
        listener(snapshot)
      } catch {
        // un auditeur défaillant ne doit pas bloquer les autres
      }
    }
  }
}

function safeParse(raw: string | undefined): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function parseProfiles(raw: unknown): MonitoringProfile[] {
  if (!Array.isArray(raw)) return []
  const profiles: MonitoringProfile[] = []
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.id !== 'string') continue
    profiles.push({
      id: entry.id,
      name: typeof entry.name === 'string' ? entry.name : 'Profil',
      description: typeof entry.description === 'string' ? entry.description : '',
      builtin: false,
      overrides: isRecord(entry.overrides) ? (entry.overrides as MonitoringProfile['overrides']) : {}
    })
  }
  return profiles
}
