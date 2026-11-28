import type { AlertSeverity, AlertType, DeviceType, DiagnosticStatus, EventCategory } from './types'

export const DEVICE_TYPE_LABELS: Record<DeviceType, string> = {
  computer: 'Ordinateur',
  smartphone: 'Smartphone',
  tablet: 'Tablette',
  printer: 'Imprimante',
  router: 'Routeur / box',
  tv: 'Téléviseur',
  console: 'Console de jeu',
  iot: 'Objet connecté',
  nas: 'Serveur NAS',
  camera: 'Caméra IP',
  speaker: 'Enceinte connectée',
  unknown: 'Inconnu'
}

export const SEVERITY_LABELS: Record<AlertSeverity, string> = {
  info: 'Information',
  warning: 'Avertissement',
  critical: 'Critique'
}

export const ALERT_TYPE_LABELS: Record<AlertType, string> = {
  'new-device': 'Nouvel appareil',
  'unknown-device': 'Appareil non approuvé',
  'device-offline': 'Appareil hors ligne',
  'device-online': 'Appareil de retour en ligne',
  'internet-lost': 'Perte de connexion',
  'internet-restored': 'Connexion rétablie',
  'high-latency': 'Latence élevée',
  'high-traffic': 'Débit élevé',
  'traffic-anomaly': 'Variation de trafic inhabituelle',
  'local-ip-changed': 'Adresse IP modifiée',
  'gateway-changed': 'Passerelle modifiée',
  'dns-failure': 'Échec DNS',
  'scan-error': 'Erreur de scan'
}

export const CATEGORY_LABELS: Record<EventCategory, string> = {
  device: 'Appareil',
  alert: 'Alerte',
  traffic: 'Trafic',
  network: 'Réseau',
  scan: 'Scan',
  system: 'Système'
}

export const DIAGNOSTIC_STATUS_LABELS: Record<DiagnosticStatus, string> = {
  ok: 'OK',
  warning: 'Attention',
  error: 'Problème',
  skipped: 'Ignoré',
  running: 'En cours'
}

export const DIRECTION_LABELS: Record<'inbound' | 'outbound' | 'listening' | 'local', string> = {
  inbound: 'Entrante',
  outbound: 'Sortante',
  listening: 'Écoute',
  local: 'Locale'
}
