import type { ConnectionSnapshot, ExportRequest, Settings } from '@shared/types'
import {
  ALERT_TYPE_LABELS,
  CATEGORY_LABELS,
  DEVICE_TYPE_LABELS,
  SEVERITY_LABELS
} from '@shared/labels'
import { formatDateTime } from '@shared/format'
import type { DeviceRepository } from './repositories/devices'
import type { AlertRepository } from './repositories/alerts'
import type { EventRepository } from './repositories/events'
import type { TrafficRepository } from './repositories/traffic'
import type { DiagnosticsService } from '../services/diagnostics'

export interface ExportColumn {
  key: string
  label: string
}

const CSV_SEPARATOR = ';'
const BOM = '\uFEFF'

export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  if (/["\n\r;]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export function toCsv(rows: Record<string, unknown>[], columns: ExportColumn[], includeHeaders = true): string {
  const lines: string[] = []
  if (includeHeaders) lines.push(columns.map((column) => csvEscape(column.label)).join(CSV_SEPARATOR))
  for (const row of rows) {
    lines.push(columns.map((column) => csvEscape(row[column.key])).join(CSV_SEPARATOR))
  }
  return BOM + lines.join('\r\n') + '\r\n'
}

export function toJson(rows: Record<string, unknown>[]): string {
  return JSON.stringify({ exportedAt: new Date().toISOString(), count: rows.length, rows }, null, 2)
}

export interface ExportServiceDeps {
  devices: DeviceRepository
  alerts: AlertRepository
  events: EventRepository
  traffic: TrafficRepository
  diagnostics: DiagnosticsService
  connections: () => Promise<ConnectionSnapshot>
  getSettings: () => Settings
  now?: () => number
}

export interface ExportPayload {
  content: string
  rows: number
  fileName: string
}

export class ExportService {
  private readonly now: () => number

  constructor(private readonly deps: ExportServiceDeps) {
    this.now = deps.now ?? Date.now
  }

  async build(request: ExportRequest): Promise<ExportPayload> {
    const settings = this.deps.getSettings()
    const format = request.format ?? settings.export.defaultFormat
    const stamp = new Date(this.now()).toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const baseName = request.suggestedName?.trim() || `netwatch-${request.dataset}-${stamp}`
    const { rows, columns } = await this.collect(request)
    const content =
      format === 'csv' ? toCsv(rows, columns, settings.export.includeHeaders) : toJson(rows)
    return { content, rows: rows.length, fileName: `${baseName}.${format}` }
  }

  private async collect(request: ExportRequest): Promise<{ rows: Record<string, unknown>[]; columns: ExportColumn[] }> {
    switch (request.dataset) {
      case 'devices':
        return this.devicesExport()
      case 'alerts':
        return this.alertsExport(request)
      case 'events':
        return this.eventsExport(request)
      case 'traffic':
        return this.trafficExport(request)
      case 'connections':
        return this.connectionsExport()
      case 'diagnostics':
        return this.diagnosticsExport()
      default:
        return { rows: [], columns: [] }
    }
  }

  private devicesExport(): { rows: Record<string, unknown>[]; columns: ExportColumn[] } {
    const columns: ExportColumn[] = [
      { key: 'id', label: 'Identifiant' },
      { key: 'ip', label: 'Adresse IP' },
      { key: 'mac', label: 'Adresse MAC' },
      { key: 'vendor', label: 'Fabricant' },
      { key: 'hostname', label: 'Nom d’hôte' },
      { key: 'customName', label: 'Nom personnalisé' },
      { key: 'type', label: 'Type' },
      { key: 'status', label: 'Statut' },
      { key: 'approved', label: 'Approuvé' },
      { key: 'firstSeen', label: 'Première détection' },
      { key: 'lastSeen', label: 'Dernière activité' },
      { key: 'presenceCount', label: 'Sessions détectées' },
      { key: 'tags', label: 'Étiquettes' },
      { key: 'description', label: 'Description' }
    ]
    const rows = this.deps.devices.listAll().map((device) => ({
      id: device.id,
      ip: device.ip,
      mac: device.mac,
      vendor: device.vendor,
      hostname: device.hostname,
      customName: device.customName,
      type: DEVICE_TYPE_LABELS[device.deviceType],
      status: device.status === 'online' ? 'En ligne' : 'Hors ligne',
      approved: device.approved ? 'Oui' : 'Non',
      firstSeen: formatDateTime(device.firstSeen),
      lastSeen: formatDateTime(device.lastSeen),
      presenceCount: device.presenceCount,
      tags: device.tags.join(', '),
      description: device.description
    }))
    return { rows, columns }
  }

  private alertsExport(request: ExportRequest): { rows: Record<string, unknown>[]; columns: ExportColumn[] } {
    const columns: ExportColumn[] = [
      { key: 'id', label: 'Identifiant' },
      { key: 'createdAt', label: 'Date' },
      { key: 'type', label: 'Type' },
      { key: 'severity', label: 'Priorité' },
      { key: 'title', label: 'Titre' },
      { key: 'message', label: 'Description' },
      { key: 'device', label: 'Appareil' },
      { key: 'read', label: 'Lue' }
    ]
    const rows = this.deps.alerts
      .list({ limit: 2000, from: request.from, to: request.to })
      .map((alert) => ({
        id: alert.id,
        createdAt: formatDateTime(alert.createdAt),
        type: ALERT_TYPE_LABELS[alert.type],
        severity: SEVERITY_LABELS[alert.severity],
        title: alert.title,
        message: alert.message,
        device: alert.deviceName,
        read: alert.read ? 'Oui' : 'Non'
      }))
    return { rows, columns }
  }

  private eventsExport(request: ExportRequest): { rows: Record<string, unknown>[]; columns: ExportColumn[] } {
    const columns: ExportColumn[] = [
      { key: 'id', label: 'Identifiant' },
      { key: 'createdAt', label: 'Date' },
      { key: 'category', label: 'Catégorie' },
      { key: 'type', label: 'Type' },
      { key: 'message', label: 'Message' },
      { key: 'device', label: 'Appareil' }
    ]
    const rows = this.deps.events
      .list({ limit: 5000, from: request.from, to: request.to })
      .map((event) => ({
        id: event.id,
        createdAt: formatDateTime(event.createdAt),
        category: CATEGORY_LABELS[event.category],
        type: event.type,
        message: event.message,
        device: event.deviceName
      }))
    return { rows, columns }
  }

  private trafficExport(request: ExportRequest): { rows: Record<string, unknown>[]; columns: ExportColumn[] } {
    const to = request.to ?? this.now()
    const from = request.from ?? to - 24 * 60 * 60_000
    const columns: ExportColumn[] = [
      { key: 'date', label: 'Minute' },
      { key: 'iface', label: 'Interface' },
      { key: 'rxBytes', label: 'Octets reçus' },
      { key: 'txBytes', label: 'Octets envoyés' },
      { key: 'rxRate', label: 'Débit descendant max (o/s)' },
      { key: 'txRate', label: 'Débit montant max (o/s)' }
    ]
    const rows = this.deps.traffic.listRange(from, to).map((row) => ({
      date: formatDateTime(row.bucket * 60_000),
      iface: row.iface,
      rxBytes: row.rxBytes,
      txBytes: row.txBytes,
      rxRate: Math.round(row.rxRate),
      txRate: Math.round(row.txRate)
    }))
    return { rows, columns }
  }

  private async connectionsExport(): Promise<{ rows: Record<string, unknown>[]; columns: ExportColumn[] }> {
    const snapshot = await this.deps.connections()
    const columns: ExportColumn[] = [
      { key: 'protocol', label: 'Protocole' },
      { key: 'local', label: 'Adresse locale' },
      { key: 'remote', label: 'Adresse distante' },
      { key: 'state', label: 'État' },
      { key: 'direction', label: 'Sens' },
      { key: 'pid', label: 'PID' },
      { key: 'process', label: 'Processus' }
    ]
    const rows = snapshot.connections.map((connection) => ({
      protocol: connection.protocol,
      local: `${connection.localAddress}:${connection.localPort}`,
      remote: connection.remoteAddress === '*' ? '*' : `${connection.remoteAddress}:${connection.remotePort}`,
      state: connection.state,
      direction: connection.direction,
      pid: connection.pid,
      process: connection.processName
    }))
    return { rows, columns }
  }

  private diagnosticsExport(): { rows: Record<string, unknown>[]; columns: ExportColumn[] } {
    const report = this.deps.diagnostics.getLastReport()
    const columns: ExportColumn[] = [
      { key: 'label', label: 'Test' },
      { key: 'status', label: 'Résultat' },
      { key: 'summary', label: 'Résumé' },
      { key: 'detail', label: 'Détail' },
      { key: 'explanation', label: 'Explication' },
      { key: 'durationMs', label: 'Durée (ms)' }
    ]
    const rows = (report?.results ?? []).map((result) => ({
      label: result.label,
      status: result.status,
      summary: result.summary,
      detail: result.detail,
      explanation: result.explanation,
      durationMs: result.durationMs
    }))
    return { rows, columns }
  }
}
