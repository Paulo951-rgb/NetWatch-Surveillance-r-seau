import type { DiagnosticReport } from '@shared/types'
import type { SqliteDatabase } from '../database'

export class DiagnosticsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  save(report: DiagnosticReport): void {
    this.db
      .prepare('INSERT INTO diagnostics (run_at, score, problems, warnings, payload) VALUES (?, ?, ?, ?, ?)')
      .run(report.finishedAt, report.score, report.problemCount, report.warningCount, JSON.stringify(report))
  }

  last(): DiagnosticReport | null {
    const row = this.db
      .prepare('SELECT payload FROM diagnostics ORDER BY run_at DESC LIMIT 1')
      .get() as { payload: string } | undefined
    if (!row) return null
    try {
      return JSON.parse(row.payload) as DiagnosticReport
    } catch {
      return null
    }
  }

  clearAll(): void {
    this.db.exec('DELETE FROM diagnostics;')
  }
}
