import { useEffect, useState, type ReactNode } from 'react'
import type { AppInfo, MonitoringProfile } from '@shared/types'
import { useI18n } from '../i18n'
import { useSettings } from '../hooks/useSettings'
import { useToast } from '../hooks/useToast'
import type { DataStats } from '@shared/ipc'
import { Badge, Card, CardHead, Modal, Segmented, SettingRow, Switch } from '../components/ui'
import {
  IconAlert,
  IconDatabase,
  IconFile,
  IconFolder,
  IconLock,
  IconMoon,
  IconPlus,
  IconRefresh,
  IconSun,
  IconTrash
} from '../components/Icons'

export default function Settings(): ReactNode {
  const { t } = useI18n()
  const toast = useToast()
  const { settings, profiles, update, reset, applyProfile, saveProfile, deleteProfile } = useSettings()
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [stats, setStats] = useState<DataStats | null>(null)
  const [purgeDays, setPurgeDays] = useState(30)
  const [confirm, setConfirm] = useState<'reset' | 'resetData' | null>(null)
  const [profileName, setProfileName] = useState('')
  const [profileDesc, setProfileDesc] = useState('')

  const loadStats = async (): Promise<void> => {
    setStats(await window.netwatch.getDataStats())
  }

  useEffect(() => {
    void window.netwatch.getAppInfo().then(setInfo)
    void loadStats()
  }, [])

  const save = async (patch: Record<string, unknown>): Promise<void> => {
    await update(patch)
    toast.success(t('set.settingsSaved'))
  }

  if (!settings) return null

  return (
    <div className="page">
      <div className="grid cols-2">
        <Card>
          <CardHead title={t('set.section.general')} />
          <div className="settings-group">
            <SettingRow label={t('set.theme')}>
              <Segmented
                value={settings.theme}
                onChange={(value) => void save({ theme: value })}
                options={[
                  { value: 'dark', label: <span className="row" style={{ gap: 5 }}><IconMoon size={13} />{t('set.themeDark')}</span> },
                  { value: 'light', label: <span className="row" style={{ gap: 5 }}><IconSun size={13} />{t('set.themeLight')}</span> }
                ]}
              />
            </SettingRow>
            <SettingRow label={t('set.language')} wide>
              <select
                className="select"
                value={settings.language}
                onChange={(event) => void save({ language: event.target.value })}
              >
                <option value="fr">{t('set.french')}</option>
                <option value="en">{t('set.english')}</option>
              </select>
            </SettingRow>
          </div>
        </Card>

        <Card>
          <CardHead title={t('set.section.monitoring')} />
          <div className="settings-group">
            <SettingRow label={t('set.monitoringEnabled')} description={t('set.monitoringEnabledDesc')}>
              <Switch
                checked={settings.monitoring.enabled}
                onChange={(value) => void save({ monitoring: { enabled: value } })}
              />
            </SettingRow>
            <SettingRow label={t('set.background')} description={t('set.backgroundDesc')}>
              <Switch
                checked={settings.monitoring.backgroundWhenMinimized}
                onChange={(value) => void save({ monitoring: { backgroundWhenMinimized: value } })}
              />
            </SettingRow>
            <SettingRow label={t('set.trafficInterval')} wide>
              <input
                type="number"
                className="input"
                min={500}
                max={60000}
                step={500}
                value={settings.monitoring.trafficIntervalMs}
                onChange={(event) => void save({ monitoring: { trafficIntervalMs: Number(event.target.value) } })}
              />
            </SettingRow>
            <SettingRow label={t('set.latencyInterval')} wide>
              <input
                type="number"
                className="input"
                min={2000}
                max={300000}
                step={1000}
                value={settings.monitoring.latencyIntervalMs}
                onChange={(event) => void save({ monitoring: { latencyIntervalMs: Number(event.target.value) } })}
              />
            </SettingRow>
            <SettingRow label={t('set.connectionsInterval')} wide>
              <input
                type="number"
                className="input"
                min={1000}
                max={300000}
                step={1000}
                value={settings.monitoring.connectionsIntervalMs}
                onChange={(event) => void save({ monitoring: { connectionsIntervalMs: Number(event.target.value) } })}
              />
            </SettingRow>
            <SettingRow label={t('set.refreshInterval')} wide>
              <input
                type="number"
                className="input"
                min={1000}
                max={60000}
                step={500}
                value={settings.monitoring.refreshIntervalMs}
                onChange={(event) => void save({ monitoring: { refreshIntervalMs: Number(event.target.value) } })}
              />
            </SettingRow>
          </div>
        </Card>
      </div>

      <Card>
        <CardHead title={t('set.section.scanning')} subtitle={t('set.autoScanDesc')} />
        <div className="settings-group">
          <SettingRow label={t('set.autoScan')} description={t('set.autoScanDesc')}>
            <Switch
              checked={settings.scanning.autoScan}
              onChange={(value) => void save({ scanning: { autoScan: value } })}
            />
          </SettingRow>
          <SettingRow label={t('set.scanInterval')} wide>
            <input
              type="number"
              className="input"
              min={1}
              max={1440}
              value={settings.scanning.intervalMinutes}
              onChange={(event) => void save({ scanning: { intervalMinutes: Number(event.target.value) } })}
            />
          </SettingRow>
          <SettingRow label={t('set.scanRange')} wide>
            <input
              className="input mono"
              placeholder="auto"
              value={settings.scanning.range}
              onChange={(event) => void save({ scanning: { range: event.target.value } })}
            />
          </SettingRow>
          <SettingRow label={t('set.concurrency')} wide>
            <input
              type="number"
              className="input"
              min={1}
              max={64}
              value={settings.scanning.concurrency}
              onChange={(event) => void save({ scanning: { concurrency: Number(event.target.value) } })}
            />
          </SettingRow>
          <SettingRow label={t('set.resolveHostnames')} description={t('set.resolveHostnamesDesc')}>
            <Switch
              checked={settings.scanning.resolveHostnames}
              onChange={(value) => void save({ scanning: { resolveHostnames: value } })}
            />
          </SettingRow>
          <SettingRow label={t('set.probePorts')} description={t('set.probePortsDesc')}>
            <Switch
              checked={settings.scanning.probePorts}
              onChange={(value) => void save({ scanning: { probePorts: value } })}
            />
          </SettingRow>
        </div>
      </Card>

      <div className="grid cols-2">
        <Card>
          <CardHead title={t('set.section.startup')} />
          <div className="settings-group">
            <SettingRow label={t('set.launchAtLogin')}>
              <Switch
                checked={settings.startup.launchAtLogin}
                onChange={(value) => void save({ startup: { launchAtLogin: value } })}
              />
            </SettingRow>
            <SettingRow label={t('set.startMinimized')}>
              <Switch
                checked={settings.startup.startMinimized}
                onChange={(value) => void save({ startup: { startMinimized: value } })}
              />
            </SettingRow>
            <SettingRow label={t('set.minimizeToTray')} description={t('set.minimizeToTrayDesc')}>
              <Switch
                checked={settings.startup.minimizeToTray}
                onChange={(value) => void save({ startup: { minimizeToTray: value } })}
              />
            </SettingRow>
          </div>
        </Card>

        <Card>
          <CardHead title={t('set.section.privacy')} subtitle={t('set.aboutText')} />
          <div className="settings-group">
            <SettingRow label={t('set.allowPublicIp')} description={t('set.allowPublicIpDesc')}>
              <Switch
                checked={settings.privacy.allowPublicIp}
                onChange={(value) => void save({ privacy: { allowPublicIp: value } })}
              />
            </SettingRow>
            <SettingRow label={t('set.allowExternalPing')} description={t('set.allowExternalPingDesc')}>
              <Switch
                checked={settings.privacy.allowExternalPing}
                onChange={(value) => void save({ privacy: { allowExternalPing: value } })}
              />
            </SettingRow>
            <SettingRow label={t('set.notifications')}>
              <Switch
                checked={settings.notifications.enabled}
                onChange={(value) => void save({ notifications: { enabled: value } })}
              />
            </SettingRow>
            <SettingRow label={t('set.nativeNotifications')}>
              <Switch
                checked={settings.notifications.native}
                onChange={(value) => void save({ notifications: { native: value } })}
              />
            </SettingRow>
            <SettingRow label={t('set.minSeverity')} wide>
              <select
                className="select"
                value={settings.notifications.minSeverity}
                onChange={(event) => void save({ notifications: { minSeverity: event.target.value } })}
              >
                <option value="info">{t('alerts.severity.info')}</option>
                <option value="warning">{t('alerts.severity.warning')}</option>
                <option value="critical">{t('alerts.severity.critical')}</option>
              </select>
            </SettingRow>
          </div>
        </Card>
      </div>

      <Card>
        <CardHead
          title={t('set.section.retention')}
          subtitle={`${t('set.database')} : ${stats ? Math.round(stats.databaseSizeBytes / 1024) : 0} Ko`}
          actions={
            <button className="btn sm" onClick={() => void window.netwatch.openDataFolder()}>
              <IconFolder size={14} />
              {t('set.openDataFolder')}
            </button>
          }
        />
        <div className="settings-group">
          <SettingRow label={t('set.retentionDays')} wide>
            <input
              type="number"
              className="input"
              min={1}
              max={3650}
              value={settings.retention.days}
              onChange={(event) => void save({ retention: { days: Number(event.target.value) } })}
            />
          </SettingRow>
          <SettingRow label={t('set.maxAlerts')} wide>
            <input
              type="number"
              className="input"
              min={100}
              max={100000}
              step={100}
              value={settings.retention.maxAlerts}
              onChange={(event) => void save({ retention: { maxAlerts: Number(event.target.value) } })}
            />
          </SettingRow>
          <SettingRow label={t('set.purge')} description={t('set.purgeDesc')}>
            <input
              type="number"
              className="input"
              style={{ width: 80 }}
              min={1}
              max={3650}
              value={purgeDays}
              onChange={(event) => setPurgeDays(Number(event.target.value))}
            />
            <button
              className="btn sm"
              onClick={() =>
                void window.netwatch.purgeData(purgeDays).then((removed) => {
                  toast.success(t('set.purgeDone'), `${removed}`)
                  void loadStats()
                })
              }
            >
              <IconRefresh size={14} />
              {t('set.purgeNow')}
            </button>
          </SettingRow>
          <SettingRow label={t('set.resetData')} description={t('set.resetDataDesc')}>
            <button className="btn sm danger" onClick={() => setConfirm('resetData')}>
              <IconTrash size={14} />
              {t('set.resetData')}
            </button>
          </SettingRow>
        </div>
        {stats ? (
          <div className="grid cols-4" style={{ marginTop: 14 }}>
            <div>
              <div className="tiny muted">{t('set.events')}</div>
              <strong className="tabular">{stats.events}</strong>
            </div>
            <div>
              <div className="tiny muted">{t('set.scans')}</div>
              <strong className="tabular">{stats.scans}</strong>
            </div>
            <div>
              <div className="tiny muted">{t('set.trafficRows')}</div>
              <strong className="tabular">{stats.trafficRows}</strong>
            </div>
            <div>
              <div className="tiny muted">{t('set.latencySamples')}</div>
              <strong className="tabular">{stats.latencySamples}</strong>
            </div>
          </div>
        ) : null}
      </Card>

      <Card>
        <CardHead title={t('set.profiles')} subtitle={t('set.activeProfile')} />
        <div className="list">
          {profiles.map((profile: MonitoringProfile) => (
            <div key={profile.id} className="list-row">
              <span className="avatar sm">
                <IconLock size={14} />
              </span>
              <div className="grow">
                <div className="title">{profile.name}</div>
                <div className="sub">{profile.description || '—'}</div>
              </div>
              {profile.builtin ? <Badge tone="neutral">builtin</Badge> : null}
              <button
                className="btn sm"
                onClick={() =>
                  void applyProfile(profile.id).then(() => {
                    toast.success(t('set.profileApplied'), profile.name)
                  })
                }
              >
                {t('set.applyProfile')}
              </button>
              {!profile.builtin ? (
                <button
                  className="btn icon sm ghost"
                  onClick={() =>
                    void deleteProfile(profile.id).then(() => toast.success(t('set.profileDeleted')))
                  }
                >
                  <IconTrash size={13} />
                </button>
              ) : null}
            </div>
          ))}
        </div>
        <div className="divider" style={{ margin: '12px 0' }} />
        <div className="row wrap" style={{ gap: 8 }}>
          <input
            className="input"
            style={{ maxWidth: 220 }}
            placeholder={t('set.profileName')}
            value={profileName}
            onChange={(event) => setProfileName(event.target.value)}
          />
          <input
            className="input"
            style={{ maxWidth: 300 }}
            placeholder={t('set.profileDesc')}
            value={profileDesc}
            onChange={(event) => setProfileDesc(event.target.value)}
          />
          <button
            className="btn"
            disabled={!profileName.trim()}
            onClick={() =>
              void saveProfile({
                name: profileName.trim(),
                description: profileDesc.trim(),
                overrides: {
                  monitoring: { ...settings.monitoring },
                  scanning: { ...settings.scanning },
                  alerts: { ...settings.alerts }
                }
              }).then(() => {
                setProfileName('')
                setProfileDesc('')
                toast.success(t('set.profileSaved'))
              })
            }
          >
            <IconPlus size={14} />
            {t('set.saveProfile')}
          </button>
        </div>
      </Card>

      <div className="grid cols-2">
        <Card>
          <CardHead title={t('set.section.about')} subtitle={t('set.aboutText')} />
          <dl className="kv">
            <dt>{t('set.version')}</dt>
            <dd>{info?.version ?? '—'}</dd>
            <dt>{t('set.electron')}</dt>
            <dd className="mono">{info?.electronVersion ?? '—'}</dd>
            <dt>{t('set.node')}</dt>
            <dd className="mono">{info?.nodeVersion ?? '—'}</dd>
            <dt>{t('set.platform')}</dt>
            <dd className="mono">{info ? `${info.platform} ${info.arch}` : '—'}</dd>
            <dt>{t('set.ouiEntries')}</dt>
            <dd className="tabular">{info?.ouiEntries ?? 0}</dd>
            <dt>{t('set.database')}</dt>
            <dd className="mono tiny">{info?.databasePath ?? '—'}</dd>
          </dl>
          <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
            <button className="btn sm" onClick={() => void window.netwatch.openLogs()}>
              <IconFile size={14} />
              {t('set.openLogs')}
            </button>
            <button className="btn sm" onClick={() => void window.netwatch.openDataFolder()}>
              <IconFolder size={14} />
              {t('set.openDataFolder')}
            </button>
            <button className="btn sm danger" onClick={() => setConfirm('reset')}>
              <IconAlert size={14} />
              {t('set.resetSettings')}
            </button>
          </div>
        </Card>

        <Card>
          <CardHead title={t('set.stats')} subtitle={stats?.databasePath} />
          <dl className="kv">
            <dt>{t('devices.title')}</dt>
            <dd>{stats ? `${stats.devices} (${stats.onlineDevices} ${t('common.online').toLowerCase()})` : '—'}</dd>
            <dt>{t('alerts.title')}</dt>
            <dd>{stats?.alerts ?? 0}</dd>
            <dt>{t('set.events')}</dt>
            <dd>{stats?.events ?? 0}</dd>
            <dt>{t('set.scans')}</dt>
            <dd>{stats?.scans ?? 0}</dd>
            <dt>{t('set.trafficRows')}</dt>
            <dd>{stats?.trafficRows ?? 0}</dd>
            <dt>{t('set.oldestEvent')}</dt>
            <dd>{stats?.oldestEventAt ? new Date(stats.oldestEventAt).toLocaleString() : '—'}</dd>
          </dl>
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <IconDatabase size={15} />
            <span className="tiny muted">SQLite · WAL · local</span>
          </div>
        </Card>
      </div>

      {confirm ? (
        <Modal
          title={confirm === 'reset' ? t('set.resetSettings') : t('set.resetData')}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirm(null)}>
                {t('common.cancel')}
              </button>
              <button
                className="btn danger"
                onClick={() => {
                  if (confirm === 'reset') {
                    void reset().then(() => {
                      setConfirm(null)
                      toast.success(t('set.settingsReset'))
                    })
                  } else {
                    void window.netwatch.resetData().then(() => {
                      setConfirm(null)
                      toast.success(t('set.dataReset'))
                      void loadStats()
                    })
                  }
                }}
              >
                {t('common.confirm')}
              </button>
            </>
          }
        >
          <p>{confirm === 'reset' ? t('set.confirmReset') : t('set.confirmResetData')}</p>
        </Modal>
      ) : null}
    </div>
  )
}
