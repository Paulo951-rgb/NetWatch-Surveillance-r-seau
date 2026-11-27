/** Formatage localisé partagé (main + renderer). */

export function formatBytes(bytes: number, locale = 'fr-FR', digits = 1): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${Math.round(bytes)} o`
  const units = ['Ko', 'Mo', 'Go', 'To', 'Po']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${units[unit]}`
}

/** Débit exprimé en bits/s à partir d'un nombre d'octets par seconde. */
export function formatRate(bytesPerSecond: number, locale = 'fr-FR'): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond < 0) return '—'
  const bits = bytesPerSecond * 8
  const units = ['bit/s', 'Kbit/s', 'Mbit/s', 'Gbit/s']
  let value = bits
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit++
  }
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2
  return `${value.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${units[unit]}`
}

export function formatMs(ms: number | null | undefined, locale = 'fr-FR'): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—'
  if (ms < 10) return `${ms.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ms`
  return `${Math.round(ms).toLocaleString(locale)} ms`
}

export function formatPercent(value: number | null | undefined, locale = 'fr-FR', digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${value.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })} %`
}

export function formatDateTime(ts: number, locale = 'fr-FR'): string {
  return new Date(ts).toLocaleString(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

export function formatTime(ts: number, locale = 'fr-FR'): string {
  return new Date(ts).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function formatDate(ts: number, locale = 'fr-FR'): string {
  return new Date(ts).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function formatRelative(ts: number, now = Date.now(), locale = 'fr-FR'): string {
  const diff = Math.max(0, now - ts)
  const s = Math.round(diff / 1000)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (s < 60) return rtf.format(-s, 'second')
  const m = Math.round(s / 60)
  if (m < 60) return rtf.format(-m, 'minute')
  const h = Math.round(m / 60)
  if (h < 24) return rtf.format(-h, 'hour')
  const d = Math.round(h / 24)
  if (d < 30) return rtf.format(-d, 'day')
  return rtf.format(-Math.round(d / 30), 'month')
}

export function formatDuration(ms: number, locale = 'fr-FR'): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const totalSeconds = Math.round(ms / 1000)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`
  if (m > 0) return `${m} min ${String(s).padStart(2, '0')} s`
  return `${s.toLocaleString(locale)} s`
}

export function formatUptime(seconds: number, locale = 'fr-FR'): string {
  return formatDuration(seconds * 1000, locale)
}
