import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Device, DeviceDetail } from '@shared/types'
import { useI18n, useFormat, deviceTypeText } from '../i18n'
import { Badge, Card, DeviceAvatar, Drawer, EmptyState } from '../components/ui'
import { IconMap, IconRadar, IconRouter } from '../components/Icons'

interface Node {
  device: Device
  x: number
  y: number
  radius: number
}

export default function NetworkMap(): ReactNode {
  const { t, language } = useI18n()
  const format = useFormat()
  const [devices, setDevices] = useState<Device[]>([])
  const [selected, setSelected] = useState<DeviceDetail | null>(null)

  const load = async (): Promise<void> => {
    const list = await window.netwatch.listDevices({ limit: 200 })
    setDevices(list)
  }

  useEffect(() => {
    void load()
    const off = window.netwatch.onDevices(() => void load())
    return () => off()
  }, [])

  const gateway = devices.find((device) => device.isGateway)
  const others = devices.filter((device) => !device.isGateway)

  const nodes = useMemo<Node[]>(() => {
    const width = 1000
    const height = 620
    const cx = width / 2
    const cy = height / 2
    const count = others.length
    const innerCount = Math.min(count, 14)
    return others.map((device, index) => {
      const ring = index < innerCount ? 0 : 1
      const indexInRing = ring === 0 ? index : index - innerCount
      const ringSize = ring === 0 ? innerCount : Math.max(1, count - innerCount)
      const radius = ring === 0 ? 210 : 285
      const angle = (indexInRing / ringSize) * Math.PI * 2 - Math.PI / 2 + (ring === 0 ? 0 : Math.PI / ringSize)
      return {
        device,
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius * 0.72,
        radius: device.deviceType === 'router' ? 20 : 16
      }
    })
  }, [others])

  const openDevice = async (id: number): Promise<void> => {
    const detail = await window.netwatch.getDeviceDetail(id)
    setSelected(detail)
  }

  return (
    <div className="page">
      <Card>
        <div className="row between wrap" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 14 }}>
            <span className="badge accent">
              <IconMap size={13} />
              {devices.length} {t('map.devices')}
            </span>
            <span className="tiny muted">{t('map.clickHint')}</span>
          </div>
          <div className="chart-legend">
            <span>
              <span className="legend-swatch" style={{ background: 'var(--ok)' }} />
              {t('map.online')}
            </span>
            <span>
              <span className="legend-swatch" style={{ background: 'var(--faint)' }} />
              {t('map.offline')}
            </span>
            <span>
              <span className="legend-swatch" style={{ background: 'var(--warn)' }} />
              {t('map.gateway')}
            </span>
          </div>
        </div>
      </Card>

      <div className="netmap">
        {devices.length === 0 ? (
          <EmptyState icon={<IconRadar size={22} />} title={t('map.noDevices')} description={t('map.noDevicesHint')} />
        ) : (
          <svg viewBox="0 0 1000 620" role="img" aria-label={t('map.title')}>
            <defs>
              <radialGradient id="map-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.22" />
                <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
              </radialGradient>
              <linearGradient id="map-gateway" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#f59e0b" />
                <stop offset="100%" stopColor="#f97316" />
              </linearGradient>
            </defs>
            <circle cx="500" cy="310" r="300" fill="url(#map-glow)" />
            <circle cx="500" cy="310" r="210" fill="none" stroke="rgba(148,175,220,0.12)" strokeDasharray="3 6" />
            <circle cx="500" cy="310" r="285" fill="none" stroke="rgba(148,175,220,0.08)" strokeDasharray="3 6" />

            {nodes.map((node) => (
              <line
                key={`link-${node.device.id}`}
                className="link"
                x1={500}
                y1={310}
                x2={node.x}
                y2={node.y}
                stroke={node.device.status === 'online' ? 'rgba(59,130,246,0.32)' : 'rgba(148,175,220,0.12)'}
              />
            ))}

            <g className="node" onClick={() => (gateway ? void openDevice(gateway.id) : undefined)}>
              <circle cx="500" cy="310" r="34" fill="rgba(245,158,11,0.12)" stroke="rgba(245,158,11,0.4)" />
              <circle cx="500" cy="310" r="24" fill="url(#map-gateway)" />
              <text x="500" y="316" textAnchor="middle" style={{ fill: '#1a1206', fontSize: 13, fontWeight: 700 }}>
                GW
              </text>
              <text x="500" y="366" textAnchor="middle" style={{ fill: 'var(--text)', fontSize: 13, fontWeight: 600 }}>
                {gateway?.vendor ?? t('map.gateway')}
              </text>
              <text x="500" y="384" textAnchor="middle" className="mono" style={{ fill: 'var(--muted)', fontSize: 11 }}>
                {gateway?.ip ?? '—'}
              </text>
            </g>

            {nodes.map((node) => {
              const online = node.device.status === 'online'
              const color = online ? '#22d3ee' : '#64748b'
              const label = node.device.customName ?? node.device.hostname ?? node.device.ip ?? '—'
              return (
                <g key={node.device.id} className="node" onClick={() => void openDevice(node.device.id)}>
                  <circle cx={node.x} cy={node.y} r={node.radius + 7} fill={online ? 'rgba(34,211,238,0.1)' : 'transparent'} />
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={node.radius}
                    fill={online ? 'rgba(11,18,32,0.95)' : 'rgba(15,23,42,0.8)'}
                    stroke={color}
                    strokeWidth={online ? 2 : 1.4}
                    strokeDasharray={online ? undefined : '4 3'}
                  />
                  <circle cx={node.x} cy={node.y} r={5} fill={color} />
                  <text
                    x={node.x}
                    y={node.y + node.radius + 16}
                    textAnchor="middle"
                    style={{ fill: 'var(--text-soft)', fontSize: 11.5 }}
                  >
                    {label.length > 18 ? `${label.slice(0, 17)}…` : label}
                  </text>
                  <text
                    x={node.x}
                    y={node.y + node.radius + 30}
                    textAnchor="middle"
                    className="mono"
                    style={{ fill: 'var(--faint)', fontSize: 10 }}
                  >
                    {node.device.ip ?? ''}
                  </text>
                </g>
              )
            })}
          </svg>
        )}
      </div>

      <div className="grid cols-auto">
        {devices.slice(0, 12).map((device) => (
          <Card key={device.id} hover className="card">
            <div className="row" style={{ gap: 10 }}>
              <DeviceAvatar type={device.deviceType} small />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 6 }}>
                  <strong className="truncate" style={{ fontSize: 13 }}>
                    {device.customName ?? device.hostname ?? device.ip}
                  </strong>
                  <span className={`dot ${device.status === 'online' ? 'online' : 'offline'}`} />
                </div>
                <div className="tiny muted mono">{device.ip ?? '—'}</div>
              </div>
              {device.isGateway ? <IconRouter size={15} /> : null}
            </div>
            <div className="row between" style={{ marginTop: 8 }}>
              <span className="tiny muted">{deviceTypeText(language, device.deviceType)}</span>
              <Badge tone={device.approved ? 'ok' : 'warn'}>
                {device.approved ? t('devices.approved') : t('devices.notApproved')}
              </Badge>
            </div>
          </Card>
        ))}
      </div>

      {selected ? (
        <Drawer
          title={selected.device.customName ?? selected.device.hostname ?? selected.device.ip ?? ''}
          subtitle={`${selected.device.ip ?? '—'} · ${deviceTypeText(language, selected.device.deviceType)}`}
          onClose={() => setSelected(null)}
        >
          <dl className="kv">
            <dt>{t('dash.mac')}</dt>
            <dd className="mono">{selected.device.mac ?? '—'}</dd>
            <dt>{t('devices.vendor')}</dt>
            <dd>{selected.device.vendor ?? '—'}</dd>
            <dt>{t('common.status')}</dt>
            <dd>{selected.device.status === 'online' ? t('common.online') : t('common.offline')}</dd>
            <dt>{t('devices.firstSeen')}</dt>
            <dd>{format.dateTime(selected.device.firstSeen)}</dd>
            <dt>{t('devices.lastSeen')}</dt>
            <dd>{format.dateTime(selected.device.lastSeen)}</dd>
            <dt>{t('devices.openPorts')}</dt>
            <dd className="mono">{selected.device.openPorts.length ? selected.device.openPorts.join(', ') : '—'}</dd>
            <dt>{t('common.description')}</dt>
            <dd>{selected.device.description ?? '—'}</dd>
          </dl>
        </Drawer>
      ) : null}
    </div>
  )
}
