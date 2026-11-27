import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import type { MonitoringProfile, Settings } from '@shared/types'

interface SettingsApi {
  settings: Settings | null
  profiles: MonitoringProfile[]
  loading: boolean
  update: (patch: Record<string, unknown>) => Promise<void>
  reset: () => Promise<void>
  refresh: () => Promise<void>
  applyProfile: (id: string) => Promise<void>
  saveProfile: (input: { name: string; description: string; overrides: MonitoringProfile['overrides'] }) => Promise<void>
  deleteProfile: (id: string) => Promise<void>
}

const SettingsContext = createContext<SettingsApi>({
  settings: null,
  profiles: [],
  loading: true,
  update: async () => undefined,
  reset: async () => undefined,
  refresh: async () => undefined,
  applyProfile: async () => undefined,
  saveProfile: async () => undefined,
  deleteProfile: async () => undefined
})

export function SettingsProvider({ children }: { children: ReactNode }): ReactNode {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [profiles, setProfiles] = useState<MonitoringProfile[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const [next, profileList] = await Promise.all([
        window.netwatch.getSettings(),
        window.netwatch.getProfiles()
      ])
      setSettings(next)
      setProfiles(profileList)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    return window.netwatch.onSettings((next) => setSettings(next))
  }, [refresh])

  useEffect(() => {
    if (!settings) return
    document.documentElement.dataset.theme = settings.theme
    document.documentElement.lang = settings.language
  }, [settings])

  const update = useCallback(async (patch: Record<string, unknown>) => {
    const next = await window.netwatch.updateSettings(patch)
    setSettings(next)
  }, [])

  const reset = useCallback(async () => {
    const next = await window.netwatch.resetSettings()
    setSettings(next)
  }, [])

  const applyProfile = useCallback(async (id: string) => {
    const next = await window.netwatch.applyProfile(id)
    setSettings(next)
  }, [])

  const saveProfile = useCallback(
    async (input: { name: string; description: string; overrides: MonitoringProfile['overrides'] }) => {
      const list = await window.netwatch.saveProfile(input)
      setProfiles(list)
    },
    []
  )

  const deleteProfile = useCallback(async (id: string) => {
    const list = await window.netwatch.deleteProfile(id)
    setProfiles(list)
  }, [])

  const value = useMemo<SettingsApi>(
    () => ({ settings, profiles, loading, update, reset, refresh, applyProfile, saveProfile, deleteProfile }),
    [settings, profiles, loading, update, reset, refresh, applyProfile, saveProfile, deleteProfile]
  )

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsApi {
  return useContext(SettingsContext)
}
