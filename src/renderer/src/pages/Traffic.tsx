import { useEffect, useState, type ReactNode } from 'react'
import type { ConnectionSnapshot, TrafficPeriod, TrafficSeries, TrafficSnapshot } from '@shared/types'
import { useI18n, useFormat } from '../i18n'
import { useSettings } from '../hooks/useSettings'
import { useInterval } from '../hooks/useAsync'
import { AreaChart, BarList } from '../components/charts'
import { Badge, Card, CardHead, EmptyState, Segmented, StatCard } from '../components/ui'
import { IconArrowDown, IconArrowUp, IconGlobe, IconRefresh, IconTraffic } from '../components/Icons'

const PERIODS: TrafficPeriod[] = ['1m', '5m', '30m', '1h', '24h', '7d']

export default function Traffic(): ReactNode {
  const { t } = useI18n()
  const format = useFormat()
  const { settings } = useSettings()
  const [period, setPeriod] = useState<TrafficPeriod>('5m')
  const [series, setSeries] = useState<TrafficSeries | null>(null)
  const [snapshot, setSnapshot] = useState<TrafficSnapshot | null>(null)
  const [connections, setConnections] = useState<ConnectionSnapshot | null>(null)

  const loadSeries = async (next: TrafficPeriod): Promise<void> => {
    const data = await window.netwatch.getTrafficSeries(next)
    setSeries(data)
  }

  useEffect(() => {
    void loadSeries(period)
    void window.netwatch.getTrafficSnapshot().then(setSnapshot)
    void window.netwatch.getConnections().then(setConnections)
    const offTraffic = window.netwatch.onTraffic(setSnapshot)
    return () => offTraffic()
  }, [period])

  useInterval(() => {
    void loadSeries(period)
    void window.netwatch.getConnections().then(setConnections)
  }, Math.max(5000, settings?.monitoring.refreshIntervalMs ?? 5000))

  const points = series?.points ?? []
  const labels = points.map((point) => point.t)

  return (
    <div className="page">
      <Card>
        <div className="row between wrap" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 8 }}>
            <Badge tone="accent" dot>
              {t('common.live')}
            </Badge>
            <span className="tiny muted">{snapshot?.source ?? '—'}</span>
          </div>
          <Segmented
            value={period}
            onChange={(next) => setPeriod(next)}
            options={PERIODS.map((entry) => ({ value: entry, label: t(`traffic.period.${entry}` as never) }))}
          />
        </div>
        <div className="grid cols-4" style={{ marginTop: 16 }}>
          <StatCard
            label={t('traffic.received')}
            value={format.bytes(series?.rxTotal ?? 0)}
            icon={<IconArrowDown size={16} />}
            footer={t(series?.live ? 'traffic.liveNote' : 'traffic.historyNote')}
          />
          <StatCard
            label={t('traffic.sent')}
            value={format.bytes(series?.txTotal ?? 0)}
            icon={<IconArrowUp size={16} />}
            footer={`${t('traffic.avg')} ↓ ${format.rate(series?.avgRx ?? 0)}`}
          />
          <StatCard
            label={t('traffic.peakDown')}
            value={format.rate(series?.peakRx ?? 0)}
            icon={<IconTraffic size={16} />}
            tone="ok"
            footer={`${t('traffic.avg')} ↑ ${format.rate(series?.avgTx ?? 0)}`}
          />
          <StatCard
            label={t('traffic.peakUp')}
            value={format.rate(series?.peakTx ?? 0)}
            icon={<IconRefresh size={16} />}
            footer={`${points.length} points`}
          />
        </div>
      </Card>

      <Card>
        <CardHead
          title={`${t('traffic.title')} · ${t(`traffic.period.${period}` as never)}`}
          subtitle={series?.live ? t('traffic.liveNote') : t('traffic.historyNote')}
          actions={
            <div className="chart-legend">
              <span>
                <span className="legend-swatch" style={{ background: '#22d3ee' }} />
                {t('traffic.download')}
              </span>
              <span>
                <span className="legend-swatch" style={{ background: '#a78bfa' }} />
                {t('traffic.upload')}
              </span>
            </div>
          }
        />
        <AreaChart
          series={[
            { name: t('traffic.download'), color: '#22d3ee', values: points.map((point) => point.rx) },
            { name: t('traffic.upload'), color: '#a78bfa', values: points.map((point) => point.tx) }
          ]}
          labels={labels}
          height={300}
          formatValue={(value) => format.rate(value)}
          formatLabel={(value) =>
            period === '24h' || period === '7d' ? format.dateTime(value) : format.time(value)
          }
          emptyLabel={t('traffic.noDataHint')}
        />
      </Card>

      <div className="grid split">
        <Card>
          <CardHead title={t('traffic.interfaces')} subtitle={snapshot?.source} />
          {snapshot && snapshot.interfaces.length > 0 ? (
            <div className="table-wrap" style={{ border: 0 }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('common.name')}</th>
                    <th>{t('traffic.download')}</th>
                    <th>{t('traffic.upload')}</th>
                    <th>{t('traffic.received')}</th>
                    <th>{t('traffic.sent')}</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.interfaces.map((iface) => (
                    <tr key={iface.name}>
                      <td>
                        <span className="row" style={{ gap: 8 }}>
                          <IconGlobe size={14} />
                          <span className="cell-main">{iface.name}</span>
                        </span>
                      </td>
                      <td className="tabular">{format.rate(iface.rxRate)}</td>
                      <td className="tabular">{format.rate(iface.txRate)}</td>
                      <td className="tabular muted">{format.bytes(iface.rxTotal)}</td>
                      <td className="tabular muted">{format.bytes(iface.txTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={<IconGlobe size={20} />} title={t('traffic.noData')} description={t('traffic.noDataHint')} />
          )}
        </Card>

        <Card>
          <CardHead title={t('traffic.topApps')} subtitle={t('traffic.topAppsHint')} />
          <BarList
            items={(connections?.topProcesses ?? []).map((entry) => ({
              label: entry.name,
              value: entry.connections,
              hint: `${entry.connections} ${t('traffic.connections')}`
            }))}
            color="var(--accent-2)"
            emptyLabel={t('traffic.noApps')}
          />
        </Card>
      </div>
    </div>
  )
}
