import { useEffect, useState, type ReactNode } from 'react'
import { useI18n } from '../i18n'
import { useSettings } from '../hooks/useSettings'
import {
  IconBell,
  IconDashboard,
  IconDevices,
  IconDiagnostics,
  IconHistory,
  IconMap,
  IconMaximize,
  IconMinimize,
  IconMoon,
  IconRadar,
  IconRestore,
  IconSettings,
  IconSun,
  IconTraffic,
  IconX
} from './Icons'

export type Route =
  | 'dashboard'
  | 'scanner'
  | 'devices'
  | 'traffic'
  | 'connections'
  | 'alerts'
  | 'history'
  | 'diagnostics'
  | 'map'
  | 'settings'

export const ROUTES: Route[] = [
  'dashboard',
  'scanner',
  'devices',
  'traffic',
  'connections',
  'alerts',
  'history',
  'diagnostics',
  'map',
  'settings'
]

export function parseRoute(path: string): Route {
  const clean = path.replace(/^\//, '').split('?')[0]
  return (ROUTES as string[]).includes(clean) ? (clean as Route) : 'dashboard'
}

const NAV_ICONS: Record<Route, (props: { size?: number }) => ReactNode> = {
  dashboard: IconDashboard,
  scanner: IconRadar,
  devices: IconDevices,
  traffic: IconTraffic,
  connections: IconTraffic,
  alerts: IconBell,
  history: IconHistory,
  diagnostics: IconDiagnostics,
  map: IconMap,
  settings: IconSettings
}

export function TitleBar(): ReactNode {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void window.netwatch.isWindowMaximized().then(setMaximized)
    return window.netwatch.onWindowMaximized(setMaximized)
  }, [])

  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <img src="./logo.png" alt="" />
        <span>NetWatch</span>
      </div>
      <div className="titlebar-controls">
        <button
          className="titlebar-button"
          onClick={() => void window.netwatch.minimizeWindow()}
          aria-label="Réduire"
        >
          <IconMinimize size={15} />
        </button>
        <button
          className="titlebar-button"
          onClick={() => void window.netwatch.toggleMaximizeWindow().then(setMaximized)}
          aria-label={maximized ? 'Restaurer' : 'Agrandir'}
        >
          {maximized ? <IconRestore size={14} /> : <IconMaximize size={13} />}
        </button>
        <button
          className="titlebar-button danger"
          onClick={() => void window.netwatch.closeWindow()}
          aria-label="Fermer"
        >
          <IconX size={15} />
        </button>
      </div>
    </header>
  )
}

interface SidebarProps {
  route: Route
  onNavigate: (route: Route) => void
  unreadAlerts: number
  online: boolean
}

export function Sidebar({ route, onNavigate, unreadAlerts, online }: SidebarProps): ReactNode {
  const { t } = useI18n()
  const { settings } = useSettings()
  const [version, setVersion] = useState('')

  useEffect(() => {
    void window.netwatch.getAppInfo().then((info) => setVersion(info.version))
  }, [])

  const main: Route[] = ['dashboard', 'scanner', 'devices', 'traffic', 'connections', 'alerts']
  const tools: Route[] = ['map', 'diagnostics', 'history']

  const renderItem = (item: Route): ReactNode => {
    const Icon = NAV_ICONS[item]
    const label =
      item === 'connections'
        ? t('nav.connections')
        : t(`nav.${item === 'scanner' ? 'scanner' : item}` as never)
    return (
      <button
        key={item}
        className={`nav-item${route === item ? ' active' : ''}`}
        onClick={() => onNavigate(item)}
        title={label}
      >
        <Icon size={18} />
        <span className="truncate">{label}</span>
        {item === 'alerts' && unreadAlerts > 0 ? <span className="nav-badge">{unreadAlerts > 99 ? '99+' : unreadAlerts}</span> : null}
      </button>
    )
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <img src="./logo.png" alt="NetWatch" />
        <div className="brand-text">
          <span className="brand-name">NetWatch</span>
          <span className="brand-tag">{t('app.tagline')}</span>
        </div>
      </div>

      <div className="nav-section-label">{t('nav.section.main')}</div>
      <nav className="nav">{main.map(renderItem)}</nav>

      <div className="nav-section-label">{t('nav.section.tools')}</div>
      <nav className="nav">{tools.map(renderItem)}</nav>

      <div className="nav-section-label">{t('nav.section.system')}</div>
      <nav className="nav">{renderItem('settings')}</nav>

      <div className="sidebar-footer">
        <div className="status-line">
          <span className={`dot ${online ? 'online' : 'offline'}`} />
          <span>{online ? t('common.online') : t('common.offline')}</span>
        </div>
        {settings ? (
          <div className="row between">
            <span>v{version || '1.0.0'}</span>
            <span>{settings.theme === 'dark' ? 'Sombre' : 'Clair'}</span>
          </div>
        ) : null}
      </div>
    </aside>
  )
}

interface TopBarProps {
  route: Route
  online: boolean
  unreadAlerts: number
  onNavigate: (route: Route) => void
}

export function TopBar({ route, online, unreadAlerts, onNavigate }: TopBarProps): ReactNode {
  const { t } = useI18n()
  const { settings, update } = useSettings()

  const titles: Record<Route, { title: string; subtitle: string }> = {
    dashboard: { title: t('dash.title'), subtitle: t('dash.subtitle') },
    scanner: { title: t('scan.title'), subtitle: t('scan.subtitle') },
    devices: { title: t('devices.title'), subtitle: t('devices.subtitle') },
    traffic: { title: t('traffic.title'), subtitle: t('traffic.subtitle') },
    connections: { title: t('conn.title'), subtitle: t('conn.subtitle') },
    alerts: { title: t('alerts.title'), subtitle: t('alerts.subtitle') },
    history: { title: t('history.title'), subtitle: t('history.subtitle') },
    diagnostics: { title: t('diag.title'), subtitle: t('diag.subtitle') },
    map: { title: t('map.title'), subtitle: t('map.subtitle') },
    settings: { title: t('set.title'), subtitle: t('set.subtitle') }
  }

  const meta = titles[route]

  return (
    <div className="topbar">
      <div className="topbar-title">
        <h1>{meta.title}</h1>
        <p>{meta.subtitle}</p>
      </div>
      <div className="topbar-actions">
        <span className={`badge ${online ? 'ok' : 'danger'}`} style={{ height: 26 }}>
          <span className={`dot ${online ? 'online' : 'danger'}`} />
          {online ? t('dash.internetOk') : t('dash.internetDown')}
        </span>
        <button
          className="btn icon"
          title={t('dash.scanNow')}
          onClick={() => {
            onNavigate('scanner')
            setTimeout(() => window.dispatchEvent(new CustomEvent('netwatch:start-scan')), 120)
          }}
        >
          <IconRadar size={16} />
        </button>
        <button
          className="btn icon"
          title={t('alerts.title')}
          onClick={() => onNavigate('alerts')}
          style={{ position: 'relative' }}
        >
          <IconBell size={16} />
          {unreadAlerts > 0 ? (
            <span
              style={{
                position: 'absolute',
                top: -5,
                right: -5,
                minWidth: 16,
                height: 16,
                borderRadius: 8,
                background: 'var(--danger)',
                color: '#fff',
                fontSize: 10,
                display: 'grid',
                placeItems: 'center',
                padding: '0 4px'
              }}
            >
              {unreadAlerts > 9 ? '9+' : unreadAlerts}
            </span>
          ) : null}
        </button>
        <button
          className="btn icon"
          title={settings?.theme === 'dark' ? t('set.themeLight') : t('set.themeDark')}
          onClick={() => void update({ theme: settings?.theme === 'dark' ? 'light' : 'dark' })}
        >
          {settings?.theme === 'dark' ? <IconSun size={16} /> : <IconMoon size={16} />}
        </button>
      </div>
    </div>
  )
}
