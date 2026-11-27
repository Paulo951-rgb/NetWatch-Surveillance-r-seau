import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type SqliteDatabase } from '../src/main/data/database'
import { SettingsRepository } from '../src/main/data/repositories/settings'
import {
  BUILTIN_PROFILES,
  DEFAULT_SETTINGS,
  SettingsStore,
  deepMerge,
  sanitizeSettings
} from '../src/main/settings/store'

let db: SqliteDatabase
let repo: SettingsRepository

beforeEach(() => {
  db = openDatabase(':memory:')
  repo = new SettingsRepository(db)
})

describe('valeurs par défaut', () => {
  it('démarre avec des paramètres complets et cohérents', () => {
    const store = new SettingsStore(repo)
    const settings = store.get()
    expect(settings.theme).toBe('dark')
    expect(settings.language).toBe('fr')
    expect(settings.scanning.autoScan).toBe(true)
    expect(settings.monitoring.enabled).toBe(true)
    expect(settings.privacy.allowPublicIp).toBe(false)
    expect(settings.privacy.strictLocal).toBe(false)
    expect(settings.alerts.trafficAnomaly).toBe(true)
    expect(settings.alerts.cooldownMinutes).toBe(10)
    expect(Object.keys(settings.alerts).length).toBeGreaterThanOrEqual(12)
  })

  it('persiste le mode local strict et refuse les valeurs non booléennes', () => {
    const store = new SettingsStore(repo)
    expect(store.update({ privacy: { strictLocal: true } }).privacy.strictLocal).toBe(true)
    expect(new SettingsStore(repo).get().privacy.strictLocal).toBe(true)
    expect(store.update({ privacy: { strictLocal: 'oui' } }).privacy.strictLocal).toBe(true)
  })

  it('expose des profils intégrés', () => {
    const store = new SettingsStore(repo)
    const profiles = store.profiles()
    expect(profiles.length).toBe(BUILTIN_PROFILES.length)
    expect(profiles.every((profile) => profile.builtin)).toBe(true)
  })
})

describe('normalisation', () => {
  it('remplace les valeurs invalides par les valeurs par défaut', () => {
    const settings = sanitizeSettings({
      theme: 'rose',
      language: 'de',
      scanning: { concurrency: 999, intervalMinutes: 0, range: 42 },
      monitoring: { trafficIntervalMs: 'abc' },
      alerts: { highLatencyMs: -10, minSeverity: 'x' },
      retention: { days: 0 }
    })
    expect(settings.theme).toBe('dark')
    expect(settings.language).toBe('fr')
    expect(settings.scanning.concurrency).toBe(64)
    expect(settings.scanning.intervalMinutes).toBe(1)
    expect(settings.scanning.range).toBe('auto')
    expect(settings.monitoring.trafficIntervalMs).toBe(DEFAULT_SETTINGS.monitoring.trafficIntervalMs)
    expect(settings.alerts.highLatencyMs).toBe(10)
    expect(settings.retention.days).toBe(1)
  })

  it('ignore les données corrompues', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(sanitizeSettings('texte')).toEqual(DEFAULT_SETTINGS)
    expect(sanitizeSettings([1, 2, 3])).toEqual(DEFAULT_SETTINGS)
  })

  it('fusionne profondément un patch partiel', () => {
    const merged = deepMerge({ a: { b: 1, c: 2 }, d: 3 }, { a: { c: 9 } })
    expect(merged).toEqual({ a: { b: 1, c: 9 }, d: 3 })
  })
})

describe('mise à jour et persistance', () => {
  it('applique un patch partiel sans écraser le reste', () => {
    const store = new SettingsStore(repo)
    const updated = store.update({ alerts: { highLatencyMs: 250 } })
    expect(updated.alerts.highLatencyMs).toBe(250)
    expect(updated.alerts.newDevice).toBe(true)
    expect(updated.theme).toBe('dark')
  })

  it('conserve les paramètres entre deux instances', () => {
    const first = new SettingsStore(repo)
    first.update({ theme: 'light', language: 'en', monitoring: { enabled: false } })
    const second = new SettingsStore(repo)
    const settings = second.get()
    expect(settings.theme).toBe('light')
    expect(settings.language).toBe('en')
    expect(settings.monitoring.enabled).toBe(false)
  })

  it('notifie les auditeurs à chaque changement', () => {
    const store = new SettingsStore(repo)
    const received: string[] = []
    const unsubscribe = store.onChange((settings) => received.push(settings.theme))
    store.update({ theme: 'light' })
    store.update({ theme: 'dark' })
    unsubscribe()
    store.update({ theme: 'light' })
    expect(received).toEqual(['light', 'dark'])
  })

  it('rétablit les valeurs par défaut', () => {
    const store = new SettingsStore(repo)
    store.update({ theme: 'light', scanning: { autoScan: false } })
    const reset = store.reset()
    expect(reset.theme).toBe('dark')
    expect(reset.scanning.autoScan).toBe(true)
  })
})

describe('profils de surveillance', () => {
  it('applique un profil intégré', () => {
    const store = new SettingsStore(repo)
    const settings = store.applyProfile('discreet')
    expect(settings.scanning.intervalMinutes).toBe(60)
    expect(settings.scanning.probePorts).toBe(false)
    expect(settings.advanced.activeProfileId).toBe('discreet')
  })

  it('ignore un profil inconnu', () => {
    const store = new SettingsStore(repo)
    const before = store.get()
    const after = store.applyProfile('inexistant')
    expect(after).toEqual(before)
  })

  it('enregistre et supprime un profil personnalisé', () => {
    const store = new SettingsStore(repo)
    const created = store.saveProfile({
      name: 'Maison',
      description: 'Profil du domicile',
      overrides: { scanning: { intervalMinutes: 45 } }
    })
    expect(store.profiles().some((profile) => profile.id === created.id)).toBe(true)
    expect(store.applyProfile(created.id).scanning.intervalMinutes).toBe(45)
    expect(store.deleteProfile(created.id)).toBe(true)
    expect(store.profiles().some((profile) => profile.id === created.id)).toBe(false)
  })

  it('refuse de supprimer un profil intégré', () => {
    const store = new SettingsStore(repo)
    expect(store.deleteProfile('balanced')).toBe(false)
  })

  it('persiste les profils personnalisés', () => {
    const first = new SettingsStore(repo)
    const created = first.saveProfile({ name: 'Bureau', description: '', overrides: {} })
    const second = new SettingsStore(repo)
    expect(second.profiles().some((profile) => profile.id === created.id)).toBe(true)
  })
})
