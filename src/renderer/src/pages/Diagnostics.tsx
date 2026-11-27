import { useEffect, useState, type ReactNode } from 'react'
import type { DiagnosticReport, DiagnosticResult, NetworkInterfaceInfo, TracerouteResult } from '@shared/types'
import { useI18n, useFormat } from '../i18n'
import { Badge, Card, CardHead, EmptyState, ProgressBar } from '../components/ui'
import { IconAlert, IconCheck, IconDiagnostics, IconInfo, IconRefresh, IconX } from '../components/Icons'

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'neutral' | 'info'> = {
  ok: 'ok',
  warning: 'warn',
  error: 'danger',
  skipped: 'neutral',
  running: 'info'
}

export default function Diagnostics(): ReactNode {
  const { t } = useI18n()
  const format = useFormat()
  const [report, setReport] = useState<DiagnosticReport | null>(null)
  const [running, setRunning] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [interfaces, setInterfaces] = useState<NetworkInterfaceInfo[]>([])
  const [traceroute, setTraceroute] = useState<TracerouteResult | null>(null)
  const [tracing, setTracing] = useState(false)
  const [target, setTarget] = useState('')

  useEffect(() => {
    void window.netwatch.getLastDiagnostics().then(setReport)
    void window.netwatch.getNetworkInterfaces().then(setInterfaces)
  }, [])

  const runAll = async (): Promise<void> => {
    setRunning(true)
    try {
      const result = await window.netwatch.runDiagnostics()
      setReport(result)
    } finally {
      setRunning(false)
    }
  }

  const runTraceroute = async (): Promise<void> => {
    setTracing(true)
    try {
      const result = await window.netwatch.runTraceroute(target.trim() || undefined)
      setTraceroute(result)
    } finally {
      setTracing(false)
    }
  }

  const resultIcon = (result: DiagnosticResult): ReactNode => {
    if (result.status === 'ok') return <IconCheck size={16} />
    if (result.status === 'warning') return <IconAlert size={16} />
    if (result.status === 'error') return <IconX size={16} />
    return <IconInfo size={16} />
  }

  const scoreTone = (score: number): string => (score >= 80 ? 'var(--ok)' : score >= 50 ? 'var(--warn)' : 'var(--danger)')

  return (
    <div className="page">
      <Card>
        <div className="row between wrap" style={{ gap: 16 }}>
          <div className="col" style={{ gap: 6 }}>
            <div className="row" style={{ gap: 10 }}>
              <Badge tone={report ? (report.problemCount > 0 ? 'danger' : report.warningCount > 0 ? 'warn' : 'ok') : 'neutral'} dot>
                {report
                  ? report.problemCount > 0
                    ? `${report.problemCount} ${t('diag.problems')}`
                    : report.warningCount > 0
                      ? `${report.warningCount} ${t('diag.warnings')}`
                      : t('diag.ok')
                  : t('diag.noReport')}
              </Badge>
              {report ? <span className="tiny muted">{format.dateTime(report.finishedAt)}</span> : null}
            </div>
            <h2 style={{ fontSize: 17 }}>
              {running ? t('diag.running') : report ? t('diag.score') : t('diag.noReport')}
            </h2>
          </div>
          <div className="row" style={{ gap: 14 }}>
            {report ? (
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 34, fontWeight: 700, color: scoreTone(report.score), lineHeight: 1 }}>
                  {report.score}
                </div>
                <div className="tiny muted">/ 100</div>
              </div>
            ) : null}
            <button className="btn primary" onClick={() => void runAll()} disabled={running}>
              {running ? <span className="spinner" /> : <IconDiagnostics size={16} />}
              {running ? t('diag.running') : t('diag.runAll')}
            </button>
          </div>
        </div>
        {report ? (
          <div style={{ marginTop: 14 }}>
            <ProgressBar value={report.score} />
          </div>
        ) : null}
      </Card>

      {report ? (
        <div className="col" style={{ gap: 10 }}>
          {report.results.map((result) => (
            <Card key={result.key} hover className="pad-0">
              <button
                className="row between"
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 0,
                  padding: '14px 16px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  color: 'inherit'
                }}
                onClick={() => setExpanded(expanded === result.key ? null : result.key)}
              >
                <span className="row" style={{ gap: 12, minWidth: 0 }}>
                  <span
                    className="avatar sm"
                    style={{
                      color:
                        result.status === 'ok'
                          ? 'var(--ok)'
                          : result.status === 'warning'
                            ? 'var(--warn)'
                            : result.status === 'error'
                              ? 'var(--danger)'
                              : 'var(--muted)'
                    }}
                  >
                    {resultIcon(result)}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span className="row" style={{ gap: 8 }}>
                      <strong style={{ fontSize: 13.5 }}>{result.label}</strong>
                      <Badge tone={STATUS_TONE[result.status] ?? 'neutral'}>{t(`diag.status.${result.status}` as never)}</Badge>
                    </span>
                    <div className="tiny muted truncate" style={{ marginTop: 2 }}>
                      {result.summary}
                      {result.detail ? ` · ${result.detail}` : ''}
                    </div>
                  </span>
                </span>
                <span className="tiny muted tabular">{format.duration(result.durationMs)}</span>
              </button>
              {expanded === result.key ? (
                <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--border)' }}>
                  {result.explanation ? (
                    <div className="row" style={{ gap: 8, alignItems: 'flex-start', marginTop: 12 }}>
                      <IconInfo size={15} />
                      <p className="tiny soft" style={{ lineHeight: 1.6 }}>{result.explanation}</p>
                    </div>
                  ) : null}
                  {result.metrics.length > 0 ? (
                    <dl className="kv" style={{ marginTop: 12 }}>
                      {result.metrics.map((metric) => (
                        <div key={metric.label} style={{ display: 'contents' }}>
                          <dt>{metric.label}</dt>
                          <dd className="mono">{metric.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState icon={<IconDiagnostics size={22} />} title={t('diag.noReport')} description={t('diag.noReportHint')} />
        </Card>
      )}

      <div className="grid split">
        <Card>
          <CardHead
            title={t('diag.traceroute')}
            subtitle={traceroute?.target ? `${t('diag.target')} : ${traceroute.target}` : undefined}
            actions={
              <>
                <input
                  className="input mono"
                  style={{ width: 160 }}
                  placeholder="1.1.1.1"
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                />
                <button className="btn sm" onClick={() => void runTraceroute()} disabled={tracing}>
                  {tracing ? <span className="spinner" /> : <IconRefresh size={14} />}
                  {t('diag.runTest')}
                </button>
              </>
            }
          />
          {traceroute && traceroute.hops.length > 0 ? (
            <div className="col" style={{ gap: 6 }}>
              <div className="row" style={{ gap: 8 }}>
                <Badge tone={traceroute.reached ? 'ok' : 'warn'}>
                  {traceroute.reached ? t('diag.reached') : t('diag.notReached')}
                </Badge>
                <span className="tiny muted">{format.duration(traceroute.durationMs)}</span>
              </div>
              <div className="list">
                {traceroute.hops.map((hop) => (
                  <div key={hop.hop} className="list-row">
                    <span className="tiny mono muted" style={{ width: 26 }}>{hop.hop}</span>
                    <span className="grow mono tiny">{hop.host ?? '* * *'}</span>
                    <span className="tiny tabular muted">{hop.rttMs !== null ? format.ms(hop.rttMs) : '—'}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <EmptyState
              icon={<IconRefresh size={20} />}
              title={traceroute?.error ?? t('diag.traceroute')}
              description={t('diag.noReportHint')}
            />
          )}
        </Card>

        <Card>
          <CardHead title={t('diag.interfaces')} subtitle={`${interfaces.length}`} />
          <div className="list">
            {interfaces.map((entry) => (
              <div key={`${entry.name}-${entry.address}`} className="list-row">
                <span className="avatar sm">
                  <IconDiagnostics size={14} />
                </span>
                <div className="grow">
                  <div className="title truncate">{entry.name}</div>
                  <div className="sub mono">{entry.address} · {entry.netmask}</div>
                </div>
                <span className="tag">{entry.virtual ? 'virtuelle' : entry.cidr ?? '—'}</span>
              </div>
            ))}
            {interfaces.length === 0 ? <div className="tiny muted">{t('common.noData')}</div> : null}
          </div>
        </Card>
      </div>
    </div>
  )
}
