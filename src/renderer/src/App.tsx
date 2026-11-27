import { useEffect, useState, type ReactNode } from 'react'
import type { ConnectivityStatus } from '@shared/types'
import { I18nProvider, useI18n } from './i18n'
import { SettingsProvider, useSettings } from './hooks/useSettings'
import { ToastProvider, useToast } from './hooks/useToast'
import { Sidebar, TitleBar, TopBar, parseRoute, type Route } from './components/layout'
import Dashboard from './pages/Dashboard'
import Scanner from './pages/Scanner'
import Devices from './pages/Devices'
import Traffic from './pages/Traffic'
import Connections from './pages/Connections'
import Alerts from './pages/Alerts'
import History from './pages/History'
import Diagnostics from './pages/Diagnostics'
import NetworkMap from './pages/NetworkMap'
import Settings from './pages/Settings'

function Splash(): ReactNode {
  return (
    <div
      className="app"
      style={{ alignItems: 'center', justifyContent: 'center', display: 'flex', height: '100%' }}
    >
      <div className="col" style={{ alignItems: 'center', gap: 14 }}>
        <img src="./logo.png" alt="NetWatch" style={{ width: 72, height: 72, borderRadius: 18 }} />
        <div className="row" style={{ gap: 8 }}>
          <span className="spinner" />
          <span className="muted">NetWatch</span>
        </div>
      </div>
    </div>
  )
}

function Shell(): ReactNode {
  const { t } = useI18n()
  const toast = useToast()
  const [route, setRoute] = useState<Route>('dashboard')
  const [status, setStatus] = useState<ConnectivityStatus | null>(null)
  const [unreadAlerts, setUnreadAlerts] = useState(0)

  useEffect(() => {
    void window.netwatch.listAlerts({ limit: 1, unreadOnly: true }).then(() => undefined)
    void window.netwatch.getDashboard().then((data) => {
      setStatus(data.status)
      setUnreadAlerts(data.unreadAlerts)
    })
  }, [])

  useEffect(() => window.netwatch.onStatus(setStatus), [])

  useEffect(
    () =>
      window.netwatch.onAlert((alert) => {
        setUnreadAlerts((current) => current + 1)
        const type = alert.severity === 'critical' ? 'error' : alert.severity === 'warning' ? 'warning' : 'info'
        toast.push(type, alert.title, alert.message)
      }),
    [toast]
  )

  useEffect(() => window.netwatch.onNavigate((path) => setRoute(parseRoute(path))), [])

  useEffect(() => {
    if (route !== 'alerts') return
    void window.netwatch.listAlerts({ limit: 200 }).then(() => {
      void window.netwatch.getDashboard().then((data) => setUnreadAlerts(data.unreadAlerts))
    })
  }, [route])

  const navigate = (next: Route): void => setRoute(next)
  const online = status?.internet ?? false

  return (
    <div className="app">
      <TitleBar />
      <div className="app-body">
        <Sidebar route={route} onNavigate={navigate} unreadAlerts={unreadAlerts} online={online} />
        <div className="main-area">
          <TopBar route={route} online={online} unreadAlerts={unreadAlerts} onNavigate={navigate} />
          <main className="content">
            {route === 'dashboard' ? <Dashboard onNavigate={navigate} /> : null}
            {route === 'scanner' ? <Scanner /> : null}
            {route === 'devices' ? <Devices /> : null}
            {route === 'traffic' ? <Traffic /> : null}
            {route === 'connections' ? <Connections /> : null}
            {route === 'alerts' ? <Alerts onUnreadChange={setUnreadAlerts} /> : null}
            {route === 'history' ? <History /> : null}
            {route === 'diagnostics' ? <Diagnostics /> : null}
            {route === 'map' ? <NetworkMap /> : null}
            {route === 'settings' ? <Settings /> : null}
          </main>
        </div>
      </div>
      <span className="tiny muted" style={{ display: 'none' }}>
        {t('app.name')}
      </span>
    </div>
  )
}

function AppInner(): ReactNode {
  const { settings, loading } = useSettings()
  return (
    <I18nProvider language={settings?.language ?? 'fr'}>
      <ToastProvider>{loading || !settings ? <Splash /> : <Shell />}</ToastProvider>
    </I18nProvider>
  )
}

export default function App(): ReactNode {
  return (
    <SettingsProvider>
      <AppInner />
    </SettingsProvider>
  )
}
