import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  backupDatabase,
  integrityCheck,
  openDatabase,
  replaceDatabaseFile,
  SCHEMA_VERSION,
  type SqliteDatabase
} from '../src/main/data/database'

const dirs: string[] = []
const dbs: SqliteDatabase[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'netwatch-db-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const db of dbs.splice(0)) {
    try {
      db.close()
    } catch {
      // déjà fermée par le test
    }
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('intégrité de la base', () => {
  it('signale une base saine après migration', () => {
    const db = openDatabase(join(tempDir(), 'netwatch.db'))
    dbs.push(db)
    const report = integrityCheck(db)
    expect(report.ok).toBe(true)
    expect(report.pageCount).toBeGreaterThan(0)
    expect(report.sizeBytes).toBeGreaterThan(0)
    expect(Number(db.pragma('user_version', { simple: true }))).toBe(SCHEMA_VERSION)
  })

  it('met de côté un fichier corrompu et repart sur une base neuve', () => {
    const dir = tempDir()
    const path = join(dir, 'netwatch.db')
    writeFileSync(path, 'ceci n’est pas une base SQLite')

    const db = openDatabase(path)
    dbs.push(db)

    expect(integrityCheck(db).ok).toBe(true)
    expect(readdirSync(dir).some((file) => file.includes('.corrupt-'))).toBe(true)
    expect(db.prepare('SELECT COUNT(*) AS n FROM devices').get()).toEqual({ n: 0 })
  })
})

describe('sauvegarde et restauration', () => {
  it('produit une copie complète et restaurable', async () => {
    const dir = tempDir()
    const live = join(dir, 'live.db')
    const copy = join(dir, 'backup.db')
    const db = openDatabase(live)
    dbs.push(db)
    db.prepare(
      'INSERT INTO devices (key, ip, mac, first_seen, last_seen, last_status_change) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('mac:aa:bb:cc:dd:ee:ff', '192.168.1.30', 'aa:bb:cc:dd:ee:ff', 1, 2, 1)

    const bytes = await backupDatabase(db, copy)
    expect(bytes).toBeGreaterThan(0)

    db.close()
    replaceDatabaseFile(copy, live)

    const restored = openDatabase(live, { recoverCorrupt: false })
    dbs.push(restored)
    expect(integrityCheck(restored).ok).toBe(true)
    const row = restored.prepare('SELECT ip FROM devices WHERE key = ?').get('mac:aa:bb:cc:dd:ee:ff')
    expect(row).toEqual({ ip: '192.168.1.30' })
  })
})
