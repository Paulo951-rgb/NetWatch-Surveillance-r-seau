import type { NetWatchApi } from '@shared/ipc'

declare global {
  interface Window {
    netwatch: NetWatchApi
  }
}

export {}
