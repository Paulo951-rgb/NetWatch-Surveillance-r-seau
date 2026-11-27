import { useEffect, useState, type ReactNode } from 'react'
import type { Alert, AlertSeverity, Settings } from '@shared/types'
import { useI18n, useFormat } from '../i18n'
import { useSettings } from '../hooks/useSettings'
import { useToast } from '../hooks/useToast'
import { Badge, Card, CardHead, EmptyState, Modal, SettingRow, Switch } from '../components/ui'
import { IconAlert, IconBell, IconCheck, IconTrash } from '../components/Icons'

const RULES: { key: keyof Settings['alerts']; label: string }[] = [
  { key: 'newDevice', label: 'alerts.newDevice' },
  { key: 'unknownDevice', label: 'alerts.unknownDevice' },
  { key: 'deviceOffline', label: 'alerts.deviceOffline' },
  { key: 'internetLost', label: 'alerts.internetLost' },
  { key: 'highLatency', label: 'alerts.highLatency' },
  { key: 'highTraffic', label: 'alerts.highTraffic' },
  { key: 'trafficAnomaly', label: 'alerts.trafficAnomaly' },
  { key: 'localIpChanged', label: 'alerts.localIpChanged' },
  { key: 'dnsFailure', label: 'alerts.dnsFailure' }
]

export default function Alerts({ onUnreadChange }: { onUnreadChange: (count: number) => void }): ReactNode {
  const { t } = useI18n()
  const format = useFormat()
  const toast = useToast()
  const { settings, update } = useSettings()
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [severity, setSeverity] = useState<AlertSeverity | 'all'>('all')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  const load = async (): Promise<void> => {
    const list = await window.netwatch.listAlerts({ limit: 300, severity, unreadOnly })
    setAlerts(list)
    const dashboard = await window.netwatch.getDashboard()
    onUnreadChange(dashboard.unreadAlerts)
  }

  useEffect(() => {
    void load()
    const off = window.netwatch.onAlert(() => void load())
    return () => off()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [severity, unreadOnly])

  const patchAlerts = async (patch: Record<string, unknown>): Promise<void> => {
    await update({ alerts: patch })
  }

  const tone = (value: AlertSeverity): 'info' | 'warn' | 'danger' =>
    value === 'critical' ? 'danger' : value === 'warning' ? 'warn' : 'info'

  return (
    <div className="page">
      <div className="grid split">
        <Card>
          <CardHead
            title={t('alerts.title')}
            subtitle={`${alerts.length} · ${t('common.priority')}`}
            actions={
              <>
                <select
                  className="select"
                  style={{ width: 150 }}
                  value={severity}
                  onChange={(event) => setSeverity(event.target.value as AlertSeverity | 'all')}
                >
                  <option value="all">{t('common.all')}</option>
                  <option value="info">{t('alerts.severity.info')}</option>
                  <option value="warning">{t('alerts.severity.warning')}</option>
                  <option value="critical">{t('alerts.severity.critical')}</option>
                </select>
                <Switch checked={unreadOnly} onChange={setUnreadOnly} label={t('alerts.unreadOnly')} />
              </>
            }
          />
          <div className="row" style={{ gap: 8, marginBottom: 10 }}>
            <button
              className="btn sm"
              onClick={() =>
                void window.netwatch.markAllAlertsRead().then(() => {
                  toast.success(t('alerts.allRead'))
                  void load()
                })
              }
            >
              <IconCheck size={14} />
              {t('alerts.markAllRead')}
            </button>
            <button className="btn sm danger" onClick={() => setConfirmClear(true)}>
              <IconTrash size={14} />
              {t('alerts.clear')}
            </button>
          </div>

          {alerts.length === 0 ? (
            <EmptyState icon={<IconBell size={20} />} title={t('alerts.noAlerts')} description={t('alerts.noAlertsHint')} />
          ) : (
            <div>
              {alerts.map((alert) => (
                <div key={alert.id} className={`alert-row${alert.read ? '' : ' unread'}`}>
                  <span className={`severity-bar ${alert.severity}`} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <span className="title truncate">{alert.title}</span>
                      <Badge tone={tone(alert.severity)}>{t(`alerts.severity.${alert.severity}` as never)}</Badge>
                      {!alert.read ? <span className="dot warn" /> : null}
                    </div>
                    <div className="msg">{alert.message}</div>
                    <div className="meta">
                      <span>{format.dateTime(alert.createdAt)}</span>
                      {alert.deviceName ? <span>· {alert.deviceName}</span> : null}
                    </div>
                  </div>
                  {!alert.read ? (
                    <button
                      className="btn icon sm ghost"
                      title={t('alerts.markRead')}
                      onClick={() => void window.netwatch.markAlertRead(alert.id).then(() => load())}
                    >
                      <IconCheck size={14} />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="col" style={{ gap: 16 }}>
          <Card>
            <CardHead title={t('alerts.rules')} />
            <div className="settings-group">
              {RULES.map((rule) => (
                <SettingRow key={rule.key} label={t(rule.label as never)}>
                  <Switch
                    checked={Boolean(settings?.alerts[rule.key])}
                    onChange={(value) => void patchAlerts({ [rule.key]: value })}
                  />
                </SettingRow>
              ))}
              <SettingRow label={t('alerts.highLatencyMs')} wide>
                <input
                  type="number"
                  className="input"
                  style={{ width: 100 }}
                  min={10}
                  max={5000}
                  value={settings?.alerts.highLatencyMs ?? 120}
                  onChange={(event) => void patchAlerts({ highLatencyMs: Number(event.target.value) })}
                />
              </SettingRow>
              <SettingRow label={t('alerts.highTrafficMbps')} wide>
                <input
                  type="number"
                  className="input"
                  style={{ width: 100 }}
                  min={1}
                  max={100000}
                  value={settings?.alerts.highTrafficMbps ?? 80}
                  onChange={(event) => void patchAlerts({ highTrafficMbps: Number(event.target.value) })}
                />
              </SettingRow>
              <SettingRow label={t('alerts.offlineMinutes')} wide>
                <input
                  type="number"
                  className="input"
                  style={{ width: 100 }}
                  min={1}
                  max={1440}
                  value={settings?.alerts.deviceOfflineMinutes ?? 10}
                  onChange={(event) => void patchAlerts({ deviceOfflineMinutes: Number(event.target.value) })}
                />
              </SettingRow>
              <SettingRow label={t('alerts.cooldown')} wide>
                <input
                  type="number"
                  className="input"
                  style={{ width: 100 }}
                  min={0}
                  max={1440}
                  value={settings?.alerts.cooldownMinutes ?? 10}
                  onChange={(event) => void patchAlerts({ cooldownMinutes: Number(event.target.value) })}
                />
              </SettingRow>
            </div>
          </Card>

          <Card>
            <CardHead title={t('alerts.notifications')} />
            <div className="settings-group">
              <SettingRow label={t('alerts.enableNotifications')}>
                <Switch
                  checked={settings?.notifications.enabled ?? true}
                  onChange={(value) => void update({ notifications: { enabled: value } })}
                />
              </SettingRow>
              <SettingRow label={t('alerts.nativeNotifications')}>
                <Switch
                  checked={settings?.notifications.native ?? true}
                  onChange={(value) => void update({ notifications: { native: value } })}
                />
              </SettingRow>
              <SettingRow label={t('alerts.minSeverity')} wide>
                <select
                  className="select"
                  value={settings?.notifications.minSeverity ?? 'warning'}
                  onChange={(event) => void update({ notifications: { minSeverity: event.target.value } })}
                >
                  <option value="info">{t('alerts.severity.info')}</option>
                  <option value="warning">{t('alerts.severity.warning')}</option>
                  <option value="critical">{t('alerts.severity.critical')}</option>
                </select>
              </SettingRow>
            </div>
          </Card>
        </div>
      </div>

      {confirmClear ? (
        <Modal
          title={t('alerts.clear')}
          onClose={() => setConfirmClear(false)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmClear(false)}>
                {t('common.cancel')}
              </button>
              <button
                className="btn danger"
                onClick={() => {
                  void window.netwatch.clearAlerts().then(() => {
                    setConfirmClear(false)
                    toast.success(t('alerts.cleared'))
                    void load()
                  })
                }}
              >
                <IconAlert size={15} />
                {t('common.confirm')}
              </button>
            </>
          }
        >
          <p>{t('alerts.confirmClear')}</p>
        </Modal>
      ) : null}
    </div>
  )
}
