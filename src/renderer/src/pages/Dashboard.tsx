import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  Alert,
  ConnectivityStatus,
  DashboardSnapshot,
  TrafficPoint,
  TrafficSnapshot
} from '@shared/types'
import { useI18n, useFormat, deviceTypeText, DEVICE_TYPE_COLORS } from '../i18n'
import { useSettings } from '../hooks/useSettings'
import { useInterval } from '../hooks/useAsync'
import { AreaChart, Donut, Sparkline } from '../components/charts'
import { Badge, Card, CardHead, EmptyState, ProgressBar, SectionTitle, StatCard } from '../components/ui'
import type { Route } from '../components/layout'
import {
  IconAlert,
  IconArrowDown,
  IconArrowUp,
  IconBell,
  IconCheck,
  IconDevices,
  IconDiagnostics,
  IconGlobe,
  IconMap,
  IconRadar,
  IconShield,
  IconTraffic,
  IconWifi,
  IconX
} from '../components/Icons'

export default function Dashboard({ onNavigate }: { onNavigate: (route: Route) => void }): ReactNode {
  const { t, language } = useI18n()
  const format = useFormat()
  const { settings } = useSettings()
  const [data, setData] = useState<DashboardSnapshot | null>(null)
  const [traffic, setTraffic] = useState<TrafficSnapshot | null>(null)
  const [status, setStatus] = useState<ConnectivityStatus | null>(null)
  const [history, setHistory] = useState<TrafficPoint[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const lastRefresh = useRef(0)

  const load = async (): Promise<void> => {
    const snapshot = await window.netwatch.getDashboard()
    setData(snapshot)
    setStatus(snapshot.status)
    setTraffic((current) => current ?? snapshot.traffic)
    setAlerts(snapshot.alerts)
    if (snapshot.trafficHistory.length > 0) setHistory(snapshot.trafficHistory)
  }

  useEffect(() => {
    void load()
    const offTraffic = window.netwatch.onTraffic((snapshot) => {
      setTraffic(snapshot)
      setHistory((current) => [...current, { t: snapshot.timestamp, rx: snapshot.rxRate, tx: snapshot.txRate }].slice(-150))
    })
    const offStatus = window.netwatch.onStatus((next) => setStatus(next))
    const offAlert = window.netwatch.onAlert((alert) => setAlerts((current) => [alert, ...current].slice(0, 6)))
    const offScan = window.netwatch.onScanDone(() => void load())
    return () => {
      offTraffic()
      offStatus()
      offAlert()
      offScan()
    }
  }, [])

  useInterval(() => {
    const now = Date.now()
    if (now - lastRefresh.current < 8000) return
    lastRefresh.current = now
    void load()
  }, settings?.monitoring.refreshIntervalMs ?? 5000)

  const deviceTypes = useMemo(
    () =>
      (data?.deviceTypes ?? []).map((entry) => ({
        label: deviceTypeText(language, entry.type),
        value: entry.count,
        color: DEVICE_TYPE_COLORS[entry.type] ?? '#64748b'
      })),
    [data, language]
  )

  const rxSeries = history.map((point) => point.rx)
  const txSeries = history.map((point) => point.tx)
  const labels = history.map((point) => point.t)
  const online = status?.internet ?? false
  const degraded =
    online && ((status?.latencyMs ?? 0) > (settings?.alerts.highLatencyMs ?? 120) || (status?.packetLoss ?? 0) > 5)
  const tone = status?.checking ? 'info' : online ? (degraded ? 'warn' : 'ok') : 'danger'
  const statusTitle = status?.checking
    ? t('dash.status.checking')
    : online
      ? degraded
        ? t('dash.status.degraded')
        : t('dash.status.ok')
      : t('dash.status.down')
  const statusDescription = status?.checking
    ? ''
    : online
      ? degraded
        ? t('dash.status.degradedDesc')
        : t('dash.status.okDesc')
      : t('dash.status.downDesc')

  const connectionLabel =
    data?.network.connectionType === 'wifi'
      ? t('dash.wifi')
      : data?.network.connectionType === 'ethernet'
        ? t('dash.ethernet')
        : t('dash.connectionUnknown')

  return (
    <div className="page">
      <div className="hero">
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 10 }}>
            <Badge tone={tone as 'ok'} dot>
              {statusTitle}
            </Badge>
            {data?.network.ssid ? <Badge tone="neutral">{data.network.ssid}</Badge> : null}
            {settings && !settings.monitoring.enabled ? <Badge tone="warn">{t('dash.monitoringOff')}</Badge> : null}
          </div>
          <h2 style={{ marginTop: 10 }}>{statusTitle}</h2>
          <p>{statusDescription}</p>
          <div className="hero-metrics" style={{ marginTop: 16 }}>
            <div className="hero-metric">
              <div className="label">{t('dash.localIp')}</div>
              <div className="value mono">{data?.network.localIp ?? '—'}</div>
            </div>
            <div className="hero-metric">
              <div className="label">{t('dash.gateway')}</div>
              <div className="value mono">{data?.network.gateway ?? '—'}</div>
            </div>
            <div className="hero-metric">
              <div className="label">{t('dash.connection')}</div>
              <div className="value">{connectionLabel}</div>
            </div>
            <div className="hero-metric">
              <div className="label">{t('dash.latency')}</div>
              <div className="value">{format.ms(status?.latencyMs)}</div>
            </div>
          </div>
        </div>
        <div className="radar">
          <span className="radar-core" />
        </div>
      </div>

      <div className="grid cols-4">
        <StatCard
          label={t('dash.devicesDetected')}
          value={data?.counts.total ?? 0}
          icon={<IconDevices size={16} />}
          footer={
            <>
              <span className="dot online" />
              {data?.counts.online ?? 0} {t('common.online').toLowerCase()}
            </>
          }
        />
        <StatCard
          label={t('dash.devicesActive')}
          value={data?.counts.online ?? 0}
          icon={<IconWifi size={16} />}
          tone="ok"
          footer={`${data?.counts.newDevices ?? 0} ${t('dash.newDevices').toLowerCase()}`}
        />
        <StatCard
          label={t('dash.download')}
          value={format.rate(traffic?.rxRate ?? 0)}
          icon={<IconArrowDown size={16} />}
          footer={`${t('dash.totalReceived')} · ${format.bytes(traffic?.rxTotal ?? 0)}`}
          spark={<Sparkline values={rxSeries.length > 1 ? rxSeries : [0, 0]} color="#22d3ee" />}
        />
        <StatCard
          label={t('dash.upload')}
          value={format.rate(traffic?.txRate ?? 0)}
          icon={<IconArrowUp size={16} />}
          footer={`${t('dash.totalSent')} · ${format.bytes(traffic?.txTotal ?? 0)}`}
          spark={<Sparkline values={txSeries.length > 1 ? txSeries : [0, 0]} color="#a78bfa" />}
        />
      </div>

      <div className="grid split">
        <Card>
          <CardHead
            title={t('dash.trafficTitle')}
            subtitle={t('dash.trafficSubtitle')}
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
              { name: t('traffic.download'), color: '#22d3ee', values: rxSeries },
              { name: t('traffic.upload'), color: '#a78bfa', values: txSeries }
            ]}
            labels={labels}
            height={230}
            formatValue={(value) => format.rate(value)}
            formatLabel={(value) => format.time(value)}
            emptyLabel={t('traffic.noDataHint')}
          />
        </Card>

        <Card>
          <CardHead title={t('dash.deviceTypes')} subtitle={`${data?.counts.total ?? 0} ${t('devices.count')}`} />
          {deviceTypes.length > 0 ? (
            <Donut data={deviceTypes} centerLabel={t('devices.count')} centerValue={String(data?.counts.total ?? 0)} />
          ) : (
            <EmptyState icon={<IconDevices size={20} />} title={t('devices.noDevices')} description={t('devices.noDevicesHint')} />
          )}
        </Card>
      </div>

      <div className="grid cols-3">
        <Card>
          <CardHead
            title={t('dash.latency')}
            subtitle={t('dash.internet')}
            actions={<Badge tone={online ? 'ok' : 'danger'}>{online ? t('dash.internetOk') : t('dash.internetDown')}</Badge>}
          />
          <div className="col" style={{ gap: 14 }}>
            <div className="row between">
              <span className="muted tiny">{t('dash.latency')}</span>
              <strong className="tabular" style={{ fontSize: 20 }}>{format.ms(status?.latencyMs)}</strong>
            </div>
            <div className="row between">
              <span className="muted tiny">{t('dash.gateway')}</span>
              <span className="tabular">{format.ms(status?.gatewayLatencyMs)}</span>
            </div>
            <div className="row between">
              <span className="muted tiny">{t('dash.jitter')}</span>
              <span className="tabular">{format.ms(status?.jitterMs)}</span>
            </div>
            <div className="row between">
              <span className="muted tiny">{t('dash.packetLoss')}</span>
              <span className="tabular">{format.percent(status?.packetLoss)}</span>
            </div>
            <ProgressBar value={Math.max(4, 100 - Math.min(100, ((status?.latencyMs ?? 0) / 250) * 100))} />
            <div className="tiny muted">
              {t('dash.dns')} : {data?.network.dns.length ? data.network.dns.join(', ') : '—'}
            </div>
          </div>
        </Card>

        <Card>
          <CardHead
            title={t('dash.alertsTitle')}
            actions={
              <button className="btn sm ghost" onClick={() => onNavigate('alerts')}>
                {t('dash.viewAlerts')}
              </button>
            }
          />
          {alerts.length === 0 ? (
            <EmptyState icon={<IconBell size={20} />} title={t('dash.noAlerts')} />
          ) : (
            <div className="list">
              {alerts.slice(0, 4).map((alert) => (
                <div key={alert.id} className="list-row">
                  <span
                    className="avatar sm"
                    style={{
                      color:
                        alert.severity === 'critical'
                          ? 'var(--danger)'
                          : alert.severity === 'warning'
                            ? 'var(--warn)'
                            : 'var(--info)'
                    }}
                  >
                    {alert.severity === 'critical' ? <IconX size={14} /> : alert.severity === 'warning' ? <IconAlert size={14} /> : <IconCheck size={14} />}
                  </span>
                  <div className="grow">
                    <div className="title truncate">{alert.title}</div>
                    <div className="sub truncate">{alert.message}</div>
                  </div>
                  <span className="tiny muted">{format.relative(alert.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHead title={t('dash.quickActions')} />
          <div className="col" style={{ gap: 8 }}>
            <button className="btn" onClick={() => onNavigate('scanner')}>
              <IconRadar size={16} />
              {t('dash.scanNow')}
            </button>
            <button className="btn" onClick={() => onNavigate('map')}>
              <IconMap size={16} />
              {t('dash.openMap')}
            </button>
            <button className="btn" onClick={() => onNavigate('diagnostics')}>
              <IconDiagnostics size={16} />
              {t('dash.runDiagnostic')}
            </button>
            <button className="btn" onClick={() => onNavigate('traffic')}>
              <IconTraffic size={16} />
              {t('nav.traffic')}
            </button>
          </div>
          <div className="divider" style={{ margin: '14px 0' }} />
          <dl className="kv">
            <dt>{t('dash.mac')}</dt>
            <dd className="mono">{data?.network.mac ?? '—'}</dd>
            <dt>{t('dash.publicIp')}</dt>
            <dd className="mono">
              {data?.network.publicIpEnabled ? (
                data.network.publicIp ?? '—'
              ) : (
                <span className="muted">{t('dash.publicIpOff')}</span>
              )}
            </dd>
            <dt>{t('dash.lastScan')}</dt>
            <dd>
              {data?.lastScan?.finishedAt ? (
                <span className="row" style={{ gap: 6 }}>
                  <IconShield size={13} />
                  {format.relative(data.lastScan.finishedAt)}
                </span>
              ) : (
                <span className="muted">{t('dash.noScan')}</span>
              )}
            </dd>
          </dl>
        </Card>
      </div>

      <SectionTitle title={t('traffic.interfaces')} hint={traffic?.source ?? ''} />
      <div className="grid cols-auto">
        {(traffic?.interfaces ?? []).slice(0, 4).map((iface) => (
          <Card key={iface.name} hover>
            <div className="row between">
              <span className="row" style={{ gap: 8 }}>
                <IconGlobe size={15} />
                <strong className="truncate">{iface.name}</strong>
              </span>
              <span className="tiny muted">{format.bytes(iface.rxTotal + iface.txTotal)}</span>
            </div>
            <div className="row between" style={{ marginTop: 10 }}>
              <span className="tiny muted">↓ {format.rate(iface.rxRate)}</span>
              <span className="tiny muted">↑ {format.rate(iface.txRate)}</span>
            </div>
          </Card>
        ))}
        {(traffic?.interfaces ?? []).length === 0 ? (
          <Card>
            <EmptyState icon={<IconGlobe size={20} />} title={t('traffic.noData')} description={t('traffic.noDataHint')} />
          </Card>
        ) : null}
      </div>
    </div>
  )
}
