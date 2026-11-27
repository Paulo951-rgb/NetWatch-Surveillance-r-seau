import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ConnectionSnapshot } from '@shared/types'
import { useI18n, useFormat } from '../i18n'
import { Badge, Card, CardHead, EmptyState, StatCard } from '../components/ui'
import { IconConnections, IconRefresh, IconSearch } from '../components/Icons'

type DirectionFilter = 'all' | 'inbound' | 'outbound' | 'listening' | 'local'

export default function Connections(): ReactNode {
  const { t } = useI18n()
  const format = useFormat()
  const [snapshot, setSnapshot] = useState<ConnectionSnapshot | null>(null)
  const [search, setSearch] = useState('')
  const [direction, setDirection] = useState<DirectionFilter>('all')
  const [loading, setLoading] = useState(true)

  const load = async (): Promise<void> => {
    const data = await window.netwatch.getConnections()
    setSnapshot(data)
    setLoading(false)
  }

  useEffect(() => {
    void load()
    return window.netwatch.onConnections((next) => setSnapshot(next))
  }, [])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return (snapshot?.connections ?? []).filter((connection) => {
      if (direction !== 'all' && connection.direction !== direction) return false
      if (!term) return true
      return [connection.processName, connection.remoteAddress, connection.localAddress, String(connection.localPort), String(connection.remotePort), connection.state]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    })
  }, [snapshot, search, direction])

  const directionTone = (value: string): 'info' | 'warn' | 'neutral' | 'accent' =>
    value === 'inbound' ? 'warn' : value === 'outbound' ? 'accent' : value === 'listening' ? 'info' : 'neutral'

  return (
    <div className="page">
      <div className="grid cols-4">
        <StatCard
          label={t('conn.total')}
          value={snapshot?.counts.total ?? 0}
          icon={<IconConnections size={16} />}
          footer={t('conn.refreshNote')}
        />
        <StatCard
          label={t('conn.established')}
          value={snapshot?.counts.established ?? 0}
          icon={<IconConnections size={16} />}
          tone="ok"
          footer={`TCP ${snapshot?.counts.tcp ?? 0} · UDP ${snapshot?.counts.udp ?? 0}`}
        />
        <StatCard
          label={t('conn.listeningCount')}
          value={snapshot?.counts.listening ?? 0}
          icon={<IconRefresh size={16} />}
          footer={snapshot ? format.time(snapshot.timestamp) : '—'}
        />
        <StatCard
          label={t('conn.process')}
          value={snapshot?.topProcesses[0]?.name ?? '—'}
          icon={<IconSearch size={16} />}
          footer={`${snapshot?.topProcesses[0]?.connections ?? 0} ${t('traffic.connections')}`}
        />
      </div>

      <Card>
        <div className="toolbar">
          <div className="search grow">
            <IconSearch size={15} />
            <input
              className="input"
              placeholder={t('conn.searchPlaceholder')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <select
            className="select"
            style={{ width: 170 }}
            value={direction}
            onChange={(event) => setDirection(event.target.value as DirectionFilter)}
          >
            <option value="all">{t('common.all')}</option>
            <option value="inbound">{t('conn.inbound')}</option>
            <option value="outbound">{t('conn.outbound')}</option>
            <option value="listening">{t('conn.listening')}</option>
            <option value="local">{t('conn.localOnly')}</option>
          </select>
          <button className="btn icon" onClick={() => void load()} title={t('common.refresh')}>
            <IconRefresh size={15} />
          </button>
          <span className="tiny muted">{filtered.length}</span>
        </div>
      </Card>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>{t('conn.process')}</th>
              <th>{t('conn.protocol')}</th>
              <th>{t('conn.local')}</th>
              <th>{t('conn.remote')}</th>
              <th>{t('conn.state')}</th>
              <th>{t('conn.direction')}</th>
              <th>{t('conn.pid')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <EmptyState
                    icon={<IconConnections size={20} />}
                    title={loading ? t('common.loading') : t('conn.noConnections')}
                    description={t('conn.noConnectionsHint')}
                  />
                </td>
              </tr>
            ) : (
              filtered.slice(0, 400).map((connection, index) => (
                <tr key={`${connection.protocol}-${connection.localAddress}-${connection.localPort}-${connection.remoteAddress}-${connection.remotePort}-${index}`}>
                  <td>
                    <div className="cell-main truncate">{connection.processName ?? t('conn.unknownProcess')}</div>
                    {connection.pid ? <div className="cell-sub mono">PID {connection.pid}</div> : null}
                  </td>
                  <td>
                    <Badge tone={connection.protocol === 'TCP' ? 'accent' : 'info'}>{connection.protocol}</Badge>
                  </td>
                  <td className="mono">
                    {connection.localAddress}:{connection.localPort}
                  </td>
                  <td className="mono">
                    {connection.remoteAddress === '*' ? '—' : `${connection.remoteAddress}:${connection.remotePort}`}
                  </td>
                  <td className="tiny">{connection.state}</td>
                  <td>
                    <Badge tone={directionTone(connection.direction)}>
                      {t(`conn.${connection.direction === 'local' ? 'localOnly' : connection.direction}` as never)}
                    </Badge>
                  </td>
                  <td className="mono muted">{connection.pid ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Card>
        <CardHead title={t('traffic.topApps')} subtitle={t('conn.permissionHint')} />
        <div className="grid cols-2">
          {(snapshot?.topProcesses ?? []).map((entry) => (
            <div key={entry.name} className="row between">
              <span className="tiny truncate">{entry.name}</span>
              <span className="tiny tabular muted">{entry.connections}</span>
            </div>
          ))}
          {(snapshot?.topProcesses ?? []).length === 0 ? (
            <span className="tiny muted">{t('traffic.noApps')}</span>
          ) : null}
        </div>
      </Card>
    </div>
  )
}
