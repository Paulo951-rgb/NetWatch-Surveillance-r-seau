import { useEffect, useState, type ReactNode } from 'react'
import type { Device, DeviceDetail, DeviceType } from '@shared/types'
import { useI18n, useFormat, deviceTypeText } from '../i18n'
import { useToast } from '../hooks/useToast'
import { useInterval } from '../hooks/useAsync'
import { Badge, Card, DeviceAvatar, Drawer, EmptyState, Switch } from '../components/ui'
import { IconDevices, IconRefresh, IconSearch, IconTag, IconTrash } from '../components/Icons'

const TYPES: DeviceType[] = [
  'computer',
  'smartphone',
  'tablet',
  'printer',
  'router',
  'tv',
  'console',
  'iot',
  'nas',
  'camera',
  'speaker',
  'unknown'
]

export default function Devices(): ReactNode {
  const { t, language } = useI18n()
  const format = useFormat()
  const toast = useToast()
  const [devices, setDevices] = useState<Device[]>([])
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | 'online' | 'offline'>('all')
  const [type, setType] = useState<string>('all')
  const [approval, setApproval] = useState<'all' | 'yes' | 'no'>('all')
  const [selected, setSelected] = useState<DeviceDetail | null>(null)
  const [draft, setDraft] = useState({ customName: '', description: '', tags: '', type: 'unknown' as DeviceType })
  const [loading, setLoading] = useState(true)

  const load = async (): Promise<void> => {
    const list = await window.netwatch.listDevices({ search, status, type, approved: approval, limit: 800 })
    setDevices(list)
    setLoading(false)
  }

  useEffect(() => {
    void load()
    return window.netwatch.onDevices(() => void load())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, status, type, approval])

  useInterval(() => void load(), 15000)

  const openDetail = async (id: number): Promise<void> => {
    const detail = await window.netwatch.getDeviceDetail(id)
    setSelected(detail)
    if (detail) {
      setDraft({
        customName: detail.device.customName ?? '',
        description: detail.device.description ?? '',
        tags: detail.device.tags.join(', '),
        type: detail.device.deviceType
      })
    }
  }

  const save = async (): Promise<void> => {
    if (!selected) return
    const updated = await window.netwatch.updateDevice({
      id: selected.device.id,
      customName: draft.customName.trim() || null,
      description: draft.description.trim() || null,
      tags: draft.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      deviceType: draft.type
    })
    if (updated) {
      toast.success(t('devices.saved'))
      await openDetail(updated.id)
      await load()
    }
  }

  const toggleApproval = async (device: Device, approved: boolean): Promise<void> => {
    await window.netwatch.updateDevice({ id: device.id, approved })
    if (selected?.device.id === device.id) await openDetail(device.id)
    await load()
  }

  const remove = async (): Promise<void> => {
    if (!selected) return
    await window.netwatch.removeDevice(selected.device.id)
    setSelected(null)
    await load()
  }

  return (
    <div className="page">
      <Card>
        <div className="toolbar">
          <div className="search grow">
            <IconSearch size={15} />
            <input
              className="input"
              placeholder={t('devices.searchPlaceholder')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <select className="select" style={{ width: 140 }} value={status} onChange={(e) => setStatus(e.target.value as never)}>
            <option value="all">{t('common.all')}</option>
            <option value="online">{t('common.online')}</option>
            <option value="offline">{t('common.offline')}</option>
          </select>
          <select className="select" style={{ width: 160 }} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="all">{t('common.all')} · {t('common.type')}</option>
            {TYPES.map((entry) => (
              <option key={entry} value={entry}>
                {deviceTypeText(language, entry)}
              </option>
            ))}
          </select>
          <select className="select" style={{ width: 160 }} value={approval} onChange={(e) => setApproval(e.target.value as never)}>
            <option value="all">{t('common.all')}</option>
            <option value="yes">{t('devices.approved')}</option>
            <option value="no">{t('devices.notApproved')}</option>
          </select>
          <button className="btn icon" onClick={() => void load()} title={t('common.refresh')}>
            <IconRefresh size={15} />
          </button>
          <span className="tiny muted">
            {devices.length} {t('devices.count')}
          </span>
        </div>
      </Card>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>{t('common.name')}</th>
              <th>{t('dash.localIp')}</th>
              <th>{t('dash.mac')}</th>
              <th className="col-secondary">{t('devices.vendor')}</th>
              <th className="col-secondary">{t('common.type')}</th>
              <th>{t('common.status')}</th>
              <th>{t('devices.approve')}</th>
              <th>{t('devices.lastSeen')}</th>
            </tr>
          </thead>
          <tbody>
            {devices.length === 0 ? (
              <tr>
                <td colSpan={8}>
                  <EmptyState
                    icon={<IconDevices size={20} />}
                    title={search || status !== 'all' || type !== 'all' || approval !== 'all' ? t('devices.noMatch') : t('devices.noDevices')}
                    description={t('devices.noDevicesHint')}
                  />
                </td>
              </tr>
            ) : (
              devices.map((device) => (
                <tr key={device.id} className="clickable" onClick={() => void openDetail(device.id)}>
                  <td>
                    <div className="row" style={{ gap: 9 }}>
                      <DeviceAvatar type={device.deviceType} small />
                      <div style={{ minWidth: 0 }}>
                        <div className="row" style={{ gap: 6 }}>
                          <span className="cell-main truncate">
                            {device.customName ?? device.hostname ?? device.mac ?? device.ip ?? '—'}
                          </span>
                          {device.isNew ? <span className="tag">{t('devices.newBadge')}</span> : null}
                          {device.isGateway ? <span className="tag">{t('devices.gateway')}</span> : null}
                          {device.isLocalHost ? <span className="tag">{t('devices.localHost')}</span> : null}
                        </div>
                        <div className="cell-sub truncate">{device.hostname ?? device.description ?? '—'}</div>
                      </div>
                    </div>
                  </td>
                  <td className="mono">{device.ip ?? '—'}</td>
                  <td className="mono">{device.mac ?? '—'}</td>
                  <td className="truncate col-secondary">{device.vendor ?? '—'}</td>
                  <td className="col-secondary">{deviceTypeText(language, device.deviceType)}</td>
                  <td>
                    <Badge tone={device.status === 'online' ? 'ok' : 'neutral'} dot>
                      {device.status === 'online' ? t('common.online') : t('common.offline')}
                    </Badge>
                  </td>
                  <td onClick={(event) => event.stopPropagation()}>
                    <Switch checked={device.approved} onChange={(value) => void toggleApproval(device, value)} />
                  </td>
                  <td className="tiny muted">{format.relative(device.lastSeen)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {loading ? <span className="tiny muted">{t('common.loading')}</span> : null}

      {selected ? (
        <Drawer
          title={selected.device.customName ?? selected.device.hostname ?? selected.device.ip ?? t('devices.detail')}
          subtitle={`${selected.device.ip ?? '—'} · ${selected.device.mac ?? '—'}`}
          onClose={() => setSelected(null)}
          footer={
            <>
              <button className="btn danger" onClick={() => void remove()}>
                <IconTrash size={15} />
                {t('devices.remove')}
              </button>
              <button className="btn primary" onClick={() => void save()}>
                {t('common.save')}
              </button>
            </>
          }
        >
          <div className="row" style={{ gap: 12 }}>
            <DeviceAvatar type={selected.device.deviceType} />
            <div className="col" style={{ gap: 4 }}>
              <div className="row" style={{ gap: 6 }}>
                <Badge tone={selected.device.status === 'online' ? 'ok' : 'neutral'} dot>
                  {selected.device.status === 'online' ? t('common.online') : t('common.offline')}
                </Badge>
                {!selected.device.approved ? <Badge tone="warn">{t('devices.unapprovedBadge')}</Badge> : null}
              </div>
              <span className="tiny muted">
                {selected.device.vendor ?? t('common.unknown')} · {deviceTypeText(language, selected.device.deviceType)}
              </span>
            </div>
            <div style={{ marginLeft: 'auto' }}>
              <Switch
                checked={selected.device.approved}
                onChange={(value) => void toggleApproval(selected.device, value)}
                label={t('devices.approve')}
              />
            </div>
          </div>

          <div className="field">
            <label>{t('devices.customName')}</label>
            <input
              className="input"
              value={draft.customName}
              placeholder={t('devices.customNamePlaceholder')}
              onChange={(event) => setDraft({ ...draft, customName: event.target.value })}
            />
          </div>
          <div className="field">
            <label>{t('common.description')}</label>
            <textarea
              className="input"
              value={draft.description}
              placeholder={t('devices.descriptionPlaceholder')}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </div>
          <div className="field">
            <label>{t('common.tags')}</label>
            <input
              className="input"
              value={draft.tags}
              placeholder={t('devices.tagsPlaceholder')}
              onChange={(event) => setDraft({ ...draft, tags: event.target.value })}
            />
          </div>
          <div className="field">
            <label>{t('common.type')}</label>
            <select
              className="select"
              value={draft.type}
              onChange={(event) => setDraft({ ...draft, type: event.target.value as DeviceType })}
            >
              {TYPES.map((entry) => (
                <option key={entry} value={entry}>
                  {deviceTypeText(language, entry)}
                </option>
              ))}
            </select>
          </div>

          <dl className="kv">
            <dt>{t('devices.firstSeen')}</dt>
            <dd>{format.dateTime(selected.device.firstSeen)}</dd>
            <dt>{t('devices.lastSeen')}</dt>
            <dd>{format.dateTime(selected.device.lastSeen)}</dd>
            <dt>{t('devices.sessions')}</dt>
            <dd>{selected.device.presenceCount}</dd>
            <dt>{t('devices.openPorts')}</dt>
            <dd className="mono">{selected.device.openPorts.length ? selected.device.openPorts.join(', ') : '—'}</dd>
            <dt>{t('devices.hostname')}</dt>
            <dd className="mono">{selected.device.hostname ?? '—'}</dd>
          </dl>

          <div>
            <div className="row between" style={{ marginBottom: 8 }}>
              <strong style={{ fontSize: 13 }}>{t('devices.presence')}</strong>
              <span className="tiny muted">{selected.presence.length}</span>
            </div>
            {selected.presence.length === 0 ? (
              <div className="tiny muted">{t('devices.noPresence')}</div>
            ) : (
              <div className="list">
                {selected.presence.slice(0, 12).map((entry) => (
                  <div key={entry.id} className="list-row">
                    <span className={`dot ${entry.status === 'online' ? 'online' : 'offline'}`} />
                    <div className="grow">
                      <div className="title">{entry.status === 'online' ? t('common.online') : t('common.offline')}</div>
                      <div className="sub mono">{entry.ip ?? '—'}</div>
                    </div>
                    <span className="tiny muted">{format.dateTime(entry.changedAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {selected.recentAlerts.length > 0 ? (
            <div>
              <div className="row between" style={{ marginBottom: 8 }}>
                <strong style={{ fontSize: 13 }}>{t('alerts.title')}</strong>
              </div>
              <div className="list">
                {selected.recentAlerts.map((alert) => (
                  <div key={alert.id} className="list-row">
                    <span className={`severity-bar ${alert.severity}`} />
                    <div className="grow">
                      <div className="title truncate">{alert.title}</div>
                      <div className="sub truncate">{alert.message}</div>
                    </div>
                    <span className="tiny muted">{format.relative(alert.createdAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="row wrap" style={{ gap: 6 }}>
            {selected.device.tags.map((tag) => (
              <span key={tag} className="chip">
                <IconTag size={11} />
                {tag}
              </span>
            ))}
            {selected.device.tags.length === 0 ? <span className="tiny muted">{t('common.none')}</span> : null}
          </div>
        </Drawer>
      ) : null}
    </div>
  )
}
