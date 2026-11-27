import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { fr, type TranslationKey } from './fr'
import { en } from './en'

export type Language = 'fr' | 'en'
export type { TranslationKey }

const DICTIONARIES: Record<Language, Record<TranslationKey, string>> = { fr, en }

export const LOCALES: Record<Language, string> = { fr: 'fr-FR', en: 'en-US' }

export function translate(
  language: Language,
  key: TranslationKey,
  vars?: Record<string, string | number>
): string {
  const dictionary = DICTIONARIES[language] ?? fr
  let value = dictionary[key] ?? fr[key] ?? key
  if (vars) {
    for (const [name, replacement] of Object.entries(vars)) {
      value = value.replaceAll(`{${name}}`, String(replacement))
    }
  }
  return value
}

interface I18nValue {
  language: Language
  locale: string
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nValue>({
  language: 'fr',
  locale: 'fr-FR',
  t: (key, vars) => translate('fr', key, vars)
})

export function I18nProvider({ language, children }: { language: Language; children: ReactNode }): ReactNode {
  const value = useMemo<I18nValue>(
    () => ({
      language,
      locale: LOCALES[language] ?? 'fr-FR',
      t: (key, vars) => translate(language, key, vars)
    }),
    [language]
  )
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  return useContext(I18nContext)
}

/** Formatage localisé lié à la langue courante. */
export function useFormat(): {
  locale: string
  bytes: (value: number) => string
  rate: (value: number) => string
  ms: (value: number | null | undefined) => string
  percent: (value: number | null | undefined, digits?: number) => string
  dateTime: (value: number) => string
  date: (value: number) => string
  time: (value: number) => string
  relative: (value: number) => string
  duration: (value: number) => string
  number: (value: number) => string
} {
  const { locale } = useI18n()
  return useMemo(() => {
    const numberFormat = new Intl.NumberFormat(locale)
    return {
      locale,
      bytes: (value: number) => formatBytesLocalized(value, locale),
      rate: (value: number) => formatRateLocalized(value, locale),
      ms: (value: number | null | undefined) => formatMsLocalized(value, locale),
      percent: (value: number | null | undefined, digits = 0) => formatPercentLocalized(value, locale, digits),
      dateTime: (value: number) => formatDateTimeLocalized(value, locale),
      date: (value: number) => formatDateLocalized(value, locale),
      time: (value: number) => formatTimeLocalized(value, locale),
      relative: (value: number) => formatRelativeLocalized(value, locale),
      duration: (value: number) => formatDurationLocalized(value, locale),
      number: (value: number) => numberFormat.format(value)
    }
  }, [locale])
}

function formatBytesLocalized(bytes: number, locale: string, digits = 1): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${Math.round(bytes)} ${locale === 'fr-FR' ? 'o' : 'B'}`
  const units = locale === 'fr-FR' ? ['Ko', 'Mo', 'Go', 'To'] : ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${units[unit]}`
}

function formatRateLocalized(bytesPerSecond: number, locale: string): string {
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

function formatMsLocalized(ms: number | null | undefined, locale: string): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—'
  if (ms < 10) return `${ms.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ms`
  return `${Math.round(ms).toLocaleString(locale)} ms`
}

function formatPercentLocalized(value: number | null | undefined, locale: string, digits: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${value.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })} %`
}

function formatDateTimeLocalized(ts: number, locale: string): string {
  return new Date(ts).toLocaleString(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function formatDateLocalized(ts: number, locale: string): string {
  return new Date(ts).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatTimeLocalized(ts: number, locale: string): string {
  return new Date(ts).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatRelativeLocalized(ts: number, locale: string): string {
  const diff = Date.now() - ts
  const seconds = Math.round(diff / 1000)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (Math.abs(seconds) < 60) return rtf.format(-seconds, 'second')
  const minutes = Math.round(seconds / 60)
  if (Math.abs(minutes) < 60) return rtf.format(-minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return rtf.format(-hours, 'hour')
  const days = Math.round(hours / 24)
  if (Math.abs(days) < 30) return rtf.format(-days, 'day')
  return rtf.format(-Math.round(days / 30), 'month')
}

function formatDurationLocalized(ms: number, locale: string): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const total = Math.round(ms / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, '0')} min`
  if (minutes > 0) return `${minutes} min ${String(seconds).padStart(2, '0')} s`
  return `${seconds.toLocaleString(locale)} s`
}

/** Utilitaire sans hook (utilisé hors composant). */
export { formatBytesLocalized as formatBytes, formatRateLocalized as formatRate }
export function useT(): (key: TranslationKey, vars?: Record<string, string | number>) => string {
  return useCallback((key: TranslationKey, vars?: Record<string, string | number>) => translate('fr', key, vars), [])
}

/* Libellés métier localisés (listes et graphiques). */

const DEVICE_TYPE_TEXT: Record<Language, Record<string, string>> = {
  fr: {
    computer: 'Ordinateur',
    smartphone: 'Smartphone',
    tablet: 'Tablette',
    printer: 'Imprimante',
    router: 'Routeur / box',
    tv: 'Téléviseur',
    console: 'Console',
    iot: 'Objet connecté',
    nas: 'NAS',
    camera: 'Caméra IP',
    speaker: 'Enceinte',
    unknown: 'Inconnu'
  },
  en: {
    computer: 'Computer',
    smartphone: 'Smartphone',
    tablet: 'Tablet',
    printer: 'Printer',
    router: 'Router',
    tv: 'TV',
    console: 'Console',
    iot: 'Smart device',
    nas: 'NAS',
    camera: 'IP camera',
    speaker: 'Speaker',
    unknown: 'Unknown'
  }
}

const CATEGORY_TEXT: Record<Language, Record<string, string>> = {
  fr: { device: 'Appareil', alert: 'Alerte', traffic: 'Trafic', network: 'Réseau', scan: 'Scan', system: 'Système' },
  en: { device: 'Device', alert: 'Alert', traffic: 'Traffic', network: 'Network', scan: 'Scan', system: 'System' }
}

export function deviceTypeText(language: Language, type: string): string {
  return DEVICE_TYPE_TEXT[language]?.[type] ?? type
}

export function categoryText(language: Language, category: string): string {
  return CATEGORY_TEXT[language]?.[category] ?? category
}

export const DEVICE_TYPE_COLORS: Record<string, string> = {
  computer: '#3b82f6',
  smartphone: '#22d3ee',
  tablet: '#0ea5e9',
  printer: '#a78bfa',
  router: '#f59e0b',
  tv: '#f472b6',
  console: '#fb7185',
  iot: '#34d399',
  nas: '#818cf8',
  camera: '#fbbf24',
  speaker: '#2dd4bf',
  unknown: '#64748b'
}
