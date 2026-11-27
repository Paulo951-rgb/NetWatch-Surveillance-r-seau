import type { LatencySnapshot } from '@shared/types'
import type { SqliteDatabase } from '../database'

export class LatencyRepository {
  constructor(private readonly db: SqliteDatabase) {}

  insert(sample: LatencySnapshot): void {
    this.db
      .prepare(
        'INSERT INTO latency_samples (ts, gateway_ms, internet_ms, jitter_ms, loss_percent) VALUES (?, ?, ?, ?, ?)'
      )
      .run(sample.timestamp, sample.gatewayMs, sample.internetMs, sample.jitterMs, sample.lossPercent)
  }

  recent(limit = 120): LatencySnapshot[] {
    const rows = this.db
      .prepare(
        'SELECT ts, gateway_ms, internet_ms, jitter_ms, loss_percent FROM latency_samples ORDER BY ts DESC LIMIT ?'
      )
      .all(limit) as {
      ts: number
      gateway_ms: number | null
      internet_ms: number | null
      jitter_ms: number | null
      loss_percent: number | null
    }[]
    return rows
      .map((row) => ({
        timestamp: row.ts,
        gatewayMs: row.gateway_ms,
        internetMs: row.internet_ms,
        jitterMs: row.jitter_ms,
        lossPercent: row.loss_percent
      }))
      .reverse()
  }

  averageByBucket(from: number, to: number, bucketMs: number): { t: number; internetMs: number | null }[] {
    const size = Math.max(1, Math.trunc(bucketMs))
    const rows = this.db
      .prepare(
        `SELECT (ts / ${size}) * ${size} AS b, AVG(internet_ms) AS avg_ms
         FROM latency_samples
         WHERE ts >= ? AND ts <= ? AND internet_ms IS NOT NULL
         GROUP BY b ORDER BY b ASC`
      )
      .all(from, to) as { b: number; avg_ms: number | null }[]
    return rows.map((row) => ({ t: row.b, internetMs: row.avg_ms }))
  }

  deleteOlderThan(timestamp: number): number {
    const info = this.db.prepare('DELETE FROM latency_samples WHERE ts < ?').run(timestamp)
    return info.changes
  }

  clearAll(): void {
    this.db.exec('DELETE FROM latency_samples;')
  }
}
