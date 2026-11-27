import type { SqliteDatabase } from '../database'

export class SettingsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  all(): Record<string, string> {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as {
      key: string
      value: string
    }[]
    const result: Record<string, string> = {}
    for (const row of rows) result[row.key] = row.value
    return result
  }

  set(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      )
      .run(key, value)
  }

  setMany(entries: Record<string, string>): void {
    const stmt = this.db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    const run = this.db.transaction((items: [string, string][]) => {
      for (const [key, value] of items) stmt.run(key, value)
    })
    run(Object.entries(entries))
  }
}
