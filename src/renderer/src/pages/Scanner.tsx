import { useEffect, useState, type ReactNode } from 'react'
import type {
  Device,
  ScanComparison,
  ScanProgress,
  ScanSummary
} from '@shared/types'
import { useI18n, useFormat, deviceTypeText } from '../i18n'
import { useSettings } from '../hooks/useSettings'
import { useToast } from '../hooks/useToast'
import { Badge, Card, CardHead, DeviceAvatar, EmptyState, ProgressBar, SectionTitle, StatCard } from '../components/ui'
import { IconCheck, IconDevices, IconPlay, IconRadar, IconRefresh, IconStop, IconX } from '../components/Icons'

const PHASE_LABEL: Record<string, string> = {
  idle: 'scan.phase.idle',
  discovering: 'scan.phase.discovering',
  probing: 'scan.phase.probing',
  resolving: 'scan.phase.resolving',
  saving: 'scan.phase.saving',
  done: 'scan.phase.done',
  error: 'scan.phase.error'
}

export default function Scanner(): ReactNode {
  const { t, language } = useI18n()
  const format = useFormat()
  const toast = useToast()
  const { settings } = useSettings()
  const [range, setRange] = useState('auto')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [summary, setSummary] = useState<ScanSummary | null>(null)
  const [devices, setDevices] = useState<Device[]>([])
  const [comparison, setComparison] = useState<ScanComparison | null>(null)
  const [history, setHistory] = useState<ScanSummary[]>([])

  const reload = async (): Promise<void> => {
    const [status, scans, compare, list] = await Promise.all([
      window.netwatch.getScanStatus(),
      window.netwatch.getScanHistory(12),
      window.netwatch.compareScans(),
      window.netwatch.listDevices({ limit: 500 })
    ])
    setProgress(status)
    setHistory(scans)
    setSummary(scans[0] ?? null)
    setComparison(compare)
    setDevices(list)
    setRunning(status.phase !== 'idle' && status.phase !== 'done' && status.phase !== 'error')
  }

  const start = async (): Promise<void> => {
    if (running) return
    setRunning(true)
    try {
      const result = await window.netwatch.startScan({
        range: range === 'auto' ? undefined : range,
        trigger: 'manual'
      })
      setSummary(result)
      toast.success(t('toast.scanDone'), t('toast.scanDoneBody', { found: result.found, new: result.newDevices }))
      await reload()
    } catch (error) {
      toast.error(t('toast.scanFailed'), error instanceof Error ? error.message : undefined)
      await reload()
    } finally {
      setRunning(false)
    }
  }

  useEffect(() => {
    void reload()
    const offProgress = window.netwatch.onScanProgress((next) => {
      setProgress(next)
      setRunning(next.phase !== 'done' && next.phase !== 'error' && next.phase !== 'idle')
    })
    const offDone = window.netwatch.onScanDone(() => void reload())
    const startHandler = (): void => void start()
    window.addEventListener('netwatch:start-scan', startHandler)
    return () => {
      offProgress()
      offDone()
      window.removeEventListener('netwatch:start-scan', startHandler)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (settings?.scanning.range) setRange(settings.scanning.range)
  }, [settings?.scanning.range])

  const total = progress?.total ?? 0
  const processed = progress?.processed ?? 0
  const percent = total > 0 ? (processed / total) * 100 : progress?.phase === 'done' ? 100 : 0
  const phaseKey = PHASE_LABEL[progress?.phase ?? 'idle'] ?? 'scan.phase.idle'

  return (
    <div className="page">
      <Card>
        <div className="row between wrap" style={{ gap: 16 }}>
          <div className="col" style={{ gap: 6, flex: 1, minWidth: 260 }}>
            <label className="tiny muted" htmlFor="scan-range">
              {t('scan.range')}
            </label>
            <div className="row" style={{ gap: 8 }}>
              <input
                id="scan-range"
                className="input mono"
                style={{ maxWidth: 260 }}
                value={range}
                onChange={(event) => setRange(event.target.value)}
                placeholder="192.168.1.0/24"
                disabled={running}
              />
              <button className="btn sm ghost" onClick={() => setRange('auto')} disabled={running}>
                {t('scan.rangeAuto')}
              </button>
            </div>
            <span className="tiny muted">{t('scan.rangeHelp')}</span>
          </div>
          <div className="row" style={{ gap: 9 }}>
            <button className="btn primary" onClick={() => void start()} disabled={running}>
              {running ? <span className="spinner" /> : <IconPlay size={15} />}
              {running ? t('scan.phase.probing') : t('scan.start')}
            </button>
            <button
              className="btn"
              onClick={() => void window.netwatch.cancelScan()}
              disabled={!running}
            >
              <IconStop size={15} />
              {t('scan.cancel')}
            </button>
          </div>
        </div>

        <div className="col" style={{ gap: 8, marginTop: 18 }}>
          <div className="row between">
            <span className="row" style={{ gap: 8 }}>
              <Badge tone={progress?.phase === 'error' ? 'danger' : running ? 'info' : 'ok'}>
                {t(phaseKey as never)}
              </Badge>
              <span className="tiny muted">{progress?.message ?? ''}</span>
            </span>
            <span className="tiny tabular muted">
              {processed}/{total || '—'}
            </span>
          </div>
          <ProgressBar value={percent} />
          {progress?.error ? <span className="tiny" style={{ color: 'var(--danger)' }}>{progress.error}</span> : null}
        </div>
      </Card>

      <div className="grid cols-4">
        <StatCard
          label={t('scan.found')}
          value={summary?.found ?? 0}
          icon={<IconRadar size={16} />}
          footer={summary?.range ?? t('dash.noScan')}
        />
        <StatCard
          label={t('scan.new')}
          value={summary?.newDevices ?? 0}
          icon={<IconDevices size={16} />}
          tone="ok"
          footer={summary?.finishedAt ? format.relative(summary.finishedAt) : '—'}
        />
        <StatCard
          label={t('scan.offline')}
          value={summary?.offlineDevices ?? 0}
          icon={<IconX size={16} />}
          tone="warn"
          footer={summary?.trigger ? t(`scan.trigger.${summary.trigger}` as never) : '—'}
        />
        <StatCard
          label={t('scan.duration')}
          value={summary?.durationMs ? format.duration(summary.durationMs) : '—'}
          icon={<IconRefresh size={16} />}
          footer={`${t('scan.interval')} : ${settings?.scanning.intervalMinutes ?? 15} min`}
        />
      </div>

      <div className="grid cols-2">
        <Card>
          <CardHead title={t('scan.compareTitle')} />
          {comparison?.previous && comparison?.current ? (
            <div className="col" style={{ gap: 14 }}>
              <div className="row" style={{ gap: 22 }}>
                <div>
                  <div className="tiny muted">{t('scan.appeared')}</div>
                  <strong style={{ color: 'var(--ok)', fontSize: 20 }}>{comparison.appeared.length}</strong>
                </div>
                <div>
                  <div className="tiny muted">{t('scan.disappeared')}</div>
                  <strong style={{ color: 'var(--warn)', fontSize: 20 }}>{comparison.disappeared.length}</strong>
                </div>
                <div>
                  <div className="tiny muted">{t('scan.unchanged')}</div>
                  <strong style={{ fontSize: 20 }}>{comparison.unchanged}</strong>
                </div>
              </div>
              <div className="list">
                {comparison.appeared.slice(0, 4).map((device) => (
                  <div key={`a-${device.id}`} className="list-row">
                    <DeviceAvatar type={device.deviceType} small />
                    <div className="grow">
                      <div className="title truncate">{device.customName ?? device.hostname ?? device.ip}</div>
                      <div className="sub mono">{device.ip}</div>
                    </div>
                    <Badge tone="ok">{t('scan.appeared')}</Badge>
                  </div>
                ))}
                {comparison.disappeared.slice(0, 4).map((device) => (
                  <div key={`d-${device.id}`} className="list-row">
                    <DeviceAvatar type={device.deviceType} small />
                    <div className="grow">
                      <div className="title truncate">{device.customName ?? device.hostname ?? device.ip}</div>
                      <div className="sub mono">{device.ip}</div>
                    </div>
                    <Badge tone="warn">{t('scan.disappeared')}</Badge>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <EmptyState icon={<IconRefresh size={20} />} title={t('scan.noComparison')} />
          )}
        </Card>

        <Card>
          <CardHead
            title={t('scan.autoTitle')}
            subtitle={settings?.scanning.autoScan ? t('scan.autoEnabled') : t('scan.autoDisabled')}
            actions={
              <Badge tone={settings?.scanning.autoScan ? 'ok' : 'neutral'}>
                {settings?.scanning.autoScan ? t('common.enabled') : t('common.disabled')}
              </Badge>
            }
          />
          <dl className="kv">
            <dt>{t('scan.interval')}</dt>
            <dd>{settings?.scanning.intervalMinutes ?? 15} min</dd>
            <dt>{t('set.concurrency')}</dt>
            <dd>{settings?.scanning.concurrency ?? 24}</dd>
            <dt>{t('set.probePorts')}</dt>
            <dd>{settings?.scanning.probePorts ? t('common.yes') : t('common.no')}</dd>
            <dt>{t('set.resolveHostnames')}</dt>
            <dd>{settings?.scanning.resolveHostnames ? t('common.yes') : t('common.no')}</dd>
          </dl>
        </Card>
      </div>

      <SectionTitle title={t('scan.results')} hint={`${devices.length} ${t('devices.count')}`} />
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>{t('common.name')}</th>
              <th>{t('dash.localIp')}</th>
              <th>{t('dash.mac')}</th>
              <th>{t('devices.vendor')}</th>
              <th>{t('common.type')}</th>
              <th>{t('common.status')}</th>
              <th>{t('devices.lastSeen')}</th>
            </tr>
          </thead>
          <tbody>
            {devices.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <EmptyState icon={<IconRadar size={20} />} title={t('scan.noResults')} description={t('scan.noResultsHint')} />
                </td>
              </tr>
            ) : (
              devices.map((device) => (
                <tr key={device.id}>
                  <td>
                    <div className="row" style={{ gap: 9 }}>
                      <DeviceAvatar type={device.deviceType} small />
                      <div style={{ minWidth: 0 }}>
                        <div className="cell-main truncate">
                          {device.customName ?? device.hostname ?? device.mac ?? device.ip ?? '—'}
                        </div>
                        {device.hostname && device.customName ? <div className="cell-sub truncate">{device.hostname}</div> : null}
                      </div>
                    </div>
                  </td>
                  <td className="mono">{device.ip ?? '—'}</td>
                  <td className="mono">{device.mac ?? '—'}</td>
                  <td className="truncate">{device.vendor ?? '—'}</td>
                  <td>{deviceTypeText(language, device.deviceType)}</td>
                  <td>
                    <Badge tone={device.status === 'online' ? 'ok' : 'neutral'} dot>
                      {device.status === 'online' ? t('common.online') : t('common.offline')}
                    </Badge>
                  </td>
                  <td className="tiny muted">{format.relative(device.lastSeen)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Card>
        <CardHead title={t('scan.history')} subtitle={`${history.length}`} />
        {history.length === 0 ? (
          <EmptyState icon={<IconRefresh size={20} />} title={t('dash.noScan')} />
        ) : (
          <div className="list">
            {history.map((scan) => (
              <div key={scan.id} className="list-row">
                <span className="avatar sm">
                  {scan.error ? <IconX size={14} /> : <IconCheck size={14} />}
                </span>
                <div className="grow">
                  <div className="title mono">{scan.range}</div>
                  <div className="sub">
                    {scan.finishedAt ? format.dateTime(scan.finishedAt) : '—'} · {t(`scan.trigger.${scan.trigger}` as never)}
                  </div>
                </div>
                <span className="tiny muted">{scan.found} {t('devices.count')}</span>
                <span className="tiny muted">{format.duration(scan.durationMs)}</span>
                {scan.error ? <Badge tone="danger">{scan.error.slice(0, 40)}</Badge> : <Badge tone="ok">{t('scan.phase.done')}</Badge>}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
