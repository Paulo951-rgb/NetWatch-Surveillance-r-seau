import Database from 'better-sqlite3'
import { dirname } from 'node:path'
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'

export type SqliteDatabase = Database.Database

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  ip TEXT,
  mac TEXT,
  vendor TEXT,
  hostname TEXT,
  device_type TEXT NOT NULL DEFAULT 'unknown',
  status TEXT NOT NULL DEFAULT 'offline',
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  last_status_change INTEGER NOT NULL,
  custom_name TEXT,
  description TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  approved INTEGER NOT NULL DEFAULT 0,
  is_new INTEGER NOT NULL DEFAULT 1,
  is_local_host INTEGER NOT NULL DEFAULT 0,
  is_gateway INTEGER NOT NULL DEFAULT 0,
  presence_count INTEGER NOT NULL DEFAULT 0,
  open_ports TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_devices_mac ON devices(mac);
CREATE INDEX IF NOT EXISTS idx_devices_ip ON devices(ip);
CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);

CREATE TABLE IF NOT EXISTS device_presence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  ip TEXT,
  changed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_presence_device ON device_presence(device_id, changed_at DESC);

CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  range TEXT NOT NULL,
  trigger TEXT NOT NULL,
  found INTEGER NOT NULL DEFAULT 0,
  new_devices INTEGER NOT NULL DEFAULT 0,
  offline_devices INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_scans_started ON scans(started_at DESC);

CREATE TABLE IF NOT EXISTS scan_devices (
  scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  ip TEXT,
  PRIMARY KEY (scan_id, device_id)
);

CREATE TABLE IF NOT EXISTS traffic_minutes (
  bucket INTEGER NOT NULL,
  iface TEXT NOT NULL,
  rx_bytes INTEGER NOT NULL DEFAULT 0,
  tx_bytes INTEGER NOT NULL DEFAULT 0,
  rx_rate REAL NOT NULL DEFAULT 0,
  tx_rate REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, iface)
);
CREATE INDEX IF NOT EXISTS idx_traffic_bucket ON traffic_minutes(bucket);

CREATE TABLE IF NOT EXISTS traffic_totals (
  iface TEXT PRIMARY KEY,
  rx_total INTEGER NOT NULL DEFAULT 0,
  tx_total INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  device_id INTEGER,
  created_at INTEGER NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  rule TEXT
);
CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_read ON alerts(read);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  device_id INTEGER,
  created_at INTEGER NOT NULL,
  meta TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_category ON events(category, created_at DESC);

CREATE TABLE IF NOT EXISTS latency_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  gateway_ms REAL,
  internet_ms REAL,
  jitter_ms REAL,
  loss_percent REAL
);
CREATE INDEX IF NOT EXISTS idx_latency_ts ON latency_samples(ts DESC);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS diagnostics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_at INTEGER NOT NULL,
  score INTEGER NOT NULL,
  problems INTEGER NOT NULL,
  warnings INTEGER NOT NULL,
  payload TEXT NOT NULL
);
`

const MIGRATIONS: ((db: SqliteDatabase) => void)[] = [
  (db) => {
    db.exec(SCHEMA_V1)
  }
]

export const SCHEMA_VERSION = MIGRATIONS.length

export function migrate(db: SqliteDatabase): void {
  const current = Number(db.pragma('user_version', { simple: true }) ?? 0)
  for (let version = current; version < MIGRATIONS.length; version++) {
    const apply = db.transaction(() => {
      MIGRATIONS[version](db)
      db.pragma(`user_version = ${version + 1}`)
    })
    apply()
  }
}

/** Sauvegarde à chaud, cohérente même avec le mode WAL actif. */
export async function backupDatabase(db: SqliteDatabase, destination: string): Promise<number> {
  await db.backup(destination)
  return statSync(destination).size
}

/**
 * Remplace la base courante par un fichier de sauvegarde vérifié.
 * L'appelant doit avoir fermé la base ; un redémarrage est nécessaire ensuite.
 */
export function replaceDatabaseFile(source: string, target: string): void {
  copyFileSync(source, target)
  for (const suffix of ['-wal', '-shm']) rmSync(`${target}${suffix}`, { force: true })
}

export interface OpenDatabaseOptions {
  readonly?: boolean
  inMemory?: boolean
  /** Déplace une base corrompue avant de la recréer (par défaut : oui). */
  recoverCorrupt?: boolean
}

export interface IntegrityReport {
  ok: boolean
  messages: string[]
  sizeBytes: number
  pageCount: number
}

export function integrityCheck(db: SqliteDatabase): IntegrityReport {
  const rows = db.pragma('quick_check') as { quick_check?: string }[]
  const messages = rows
    .map((row) => row.quick_check ?? Object.values(row)[0])
    .filter((value): value is string => typeof value === 'string')
  const pageCount = Number(db.pragma('page_count', { simple: true }) ?? 0)
  const pageSize = Number(db.pragma('page_size', { simple: true }) ?? 0)
  return {
    ok: messages.length === 1 && messages[0].toLowerCase() === 'ok',
    messages,
    pageCount,
    sizeBytes: pageCount * pageSize
  }
}

function quarantine(file: string): string | null {
  if (!existsSync(file)) return null
  const target = `${file}.corrupt-${Date.now()}`
  try {
    renameSync(file, target)
    return target
  } catch {
    return null
  }
}

export function openDatabase(path: string, options: OpenDatabaseOptions = {}): SqliteDatabase {
  const isFile = !options.inMemory && path !== ':memory:'
  if (isFile) mkdirSync(dirname(path), { recursive: true })

  const connect = (): SqliteDatabase => {
    const db = new Database(path, { readonly: options.readonly ?? false })
    try {
      db.pragma('journal_mode = WAL')
      db.pragma('synchronous = NORMAL')
      db.pragma('foreign_keys = ON')
      db.pragma('busy_timeout = 5000')
      if (!options.readonly) migrate(db)
      return db
    } catch (error) {
      // Windows refuse de renommer un fichier encore ouvert : sans cette fermeture,
      // une base corrompue ne pourrait jamais être mise de côté.
      try {
        db.close()
      } catch {
        // handle déjà invalidé par l'erreur SQLite
      }
      throw error
    }
  }

  if (!isFile || options.readonly || options.recoverCorrupt === false) return connect()

  try {
    const db = connect()
    const report = integrityCheck(db)
    if (!report.ok) {
      db.close()
      throw new Error(`Base corrompue : ${report.messages.join('; ')}`)
    }
    return db
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Une base illisible ne doit pas empêcher l'application de démarrer : on la met de côté.
    if (!/corrupt|malformed|not a database/i.test(message)) throw error
    quarantine(path)
    quarantine(`${path}-wal`)
    quarantine(`${path}-shm`)
    return connect()
  }
}
