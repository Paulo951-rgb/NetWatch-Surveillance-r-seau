import type { TrafficPeriod, TrafficPoint } from '@shared/types'
import type { SqliteDatabase } from '../database'

export interface MinuteBucket {
  bucket: number
  iface: string
  rxBytes: number
  txBytes: number
  rxRate: number
  txRate: number
}

const PERIOD_CONFIG: Record<TrafficPeriod, { durationMs: number; bucketMs: number }> = {
  '1m': { durationMs: 60_000, bucketMs: 2_000 },
  '5m': { durationMs: 5 * 60_000, bucketMs: 5_000 },
  '30m': { durationMs: 30 * 60_000, bucketMs: 60_000 },
  '1h': { durationMs: 60 * 60_000, bucketMs: 60_000 },
  '24h': { durationMs: 24 * 60 * 60_000, bucketMs: 5 * 60_000 },
  '7d': { durationMs: 7 * 24 * 60 * 60_000, bucketMs: 30 * 60_000 }
}

export function periodConfig(period: TrafficPeriod): { durationMs: number; bucketMs: number } {
  return PERIOD_CONFIG[period] ?? PERIOD_CONFIG['5m']
}

export class TrafficRepository {
  constructor(private readonly db: SqliteDatabase) {}

  upsertMinute(bucket: MinuteBucket): void {
    this.db
      .prepare(
        `INSERT INTO traffic_minutes (bucket, iface, rx_bytes, tx_bytes, rx_rate, tx_rate)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(bucket, iface) DO UPDATE SET
           rx_bytes = rx_bytes + excluded.rx_bytes,
           tx_bytes = tx_bytes + excluded.tx_bytes,
           rx_rate = MAX(rx_rate, excluded.rx_rate),
           tx_rate = MAX(tx_rate, excluded.tx_rate)`
      )
      .run(bucket.bucket, bucket.iface, bucket.rxBytes, bucket.txBytes, bucket.rxRate, bucket.txRate)
  }

  getTotals(): Map<string, { rxTotal: number; txTotal: number }> {
    const rows = this.db.prepare('SELECT * FROM traffic_totals').all() as {
      iface: string
      rx_total: number
      tx_total: number
    }[]
    const map = new Map<string, { rxTotal: number; txTotal: number }>()
    for (const row of rows) map.set(row.iface, { rxTotal: row.rx_total, txTotal: row.tx_total })
    return map
  }

  setTotals(iface: string, rxTotal: number, txTotal: number, updatedAt: number): void {
    this.db
      .prepare(
        `INSERT INTO traffic_totals (iface, rx_total, tx_total, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(iface) DO UPDATE SET rx_total = excluded.rx_total, tx_total = excluded.tx_total, updated_at = excluded.updated_at`
      )
      .run(iface, Math.max(0, Math.round(rxTotal)), Math.max(0, Math.round(txTotal)), updatedAt)
  }

  /** Série agrégée sur une période, exprimée en octets par seconde. */
  series(period: TrafficPeriod, now: number): TrafficPoint[] {
    const { durationMs, bucketMs } = periodConfig(period)
    const fromBucket = Math.floor((now - durationMs) / 60_000)
    const sizeMinutes = Math.max(1, Math.round(bucketMs / 60_000))
    const rows = this.db
      .prepare(
        `SELECT (bucket / ${sizeMinutes}) * ${sizeMinutes} AS b, SUM(rx_bytes) AS rx, SUM(tx_bytes) AS tx
         FROM traffic_minutes
         WHERE bucket >= ?
         GROUP BY b
         ORDER BY b ASC`
      )
      .all(fromBucket) as { b: number; rx: number; tx: number }[]

    const secondsPerBucket = sizeMinutes * 60
    return rows.map((row) => ({
      t: row.b * 60_000,
      rx: row.rx / secondsPerBucket,
      tx: row.tx / secondsPerBucket
    }))
  }

  totalsForPeriod(period: TrafficPeriod, now: number): { rxTotal: number; txTotal: number } {
    const { durationMs } = periodConfig(period)
    const row = this.db
      .prepare(
        'SELECT COALESCE(SUM(rx_bytes), 0) AS rx, COALESCE(SUM(tx_bytes), 0) AS tx FROM traffic_minutes WHERE bucket >= ?'
      )
      .get(Math.floor((now - durationMs) / 60_000)) as { rx: number; tx: number }
    return { rxTotal: row.rx, txTotal: row.tx }
  }

  /** Lignes brutes sur une plage (export CSV/JSON). */
  listRange(from: number, to: number, limit = 20000): {
    bucket: number
    iface: string
    rxBytes: number
    txBytes: number
    rxRate: number
    txRate: number
  }[] {
    const rows = this.db
      .prepare(
        'SELECT bucket, iface, rx_bytes, tx_bytes, rx_rate, tx_rate FROM traffic_minutes WHERE bucket >= ? AND bucket <= ? ORDER BY bucket ASC LIMIT ?'
      )
      .all(Math.floor(from / 60_000), Math.floor(to / 60_000), limit) as {
      bucket: number
      iface: string
      rx_bytes: number
      tx_bytes: number
      rx_rate: number
      tx_rate: number
    }[]
    return rows.map((row) => ({
      bucket: row.bucket,
      iface: row.iface,
      rxBytes: row.rx_bytes,
      txBytes: row.tx_bytes,
      rxRate: row.rx_rate,
      txRate: row.tx_rate
    }))
  }

  deleteOlderThan(timestamp: number): number {
    const info = this.db
      .prepare('DELETE FROM traffic_minutes WHERE bucket < ?')
      .run(Math.floor(timestamp / 60_000))
    return info.changes
  }

  clearAll(): void {
    this.db.exec('DELETE FROM traffic_minutes; DELETE FROM traffic_totals;')
  }
}
