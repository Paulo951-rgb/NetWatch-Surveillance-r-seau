import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, LIVE_CHANNELS, type NetWatchApi } from '@shared/ipc'

const invoke = <T>(channel: string, payload?: unknown): Promise<T> =>
  ipcRenderer.invoke(channel, payload) as Promise<T>

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: NetWatchApi = {
  getAppInfo: () => invoke(IPC.appInfo),
  openLogs: () => invoke(IPC.appOpenLogs),
  openDataFolder: () => invoke(IPC.appOpenData),
  checkDatabase: () => invoke(IPC.appIntegrity),
  backupDatabase: () => invoke(IPC.appBackup),
  restoreDatabase: () => invoke(IPC.appRestore),
  minimizeWindow: () => invoke(IPC.windowMinimize),
  toggleMaximizeWindow: () => invoke(IPC.windowToggleMaximize),
  closeWindow: () => invoke(IPC.windowClose),
  isWindowMaximized: () => invoke(IPC.windowIsMaximized),

  getSettings: () => invoke(IPC.settingsGet),
  updateSettings: (patch) => invoke(IPC.settingsUpdate, patch),
  resetSettings: () => invoke(IPC.settingsReset),
  getProfiles: () => invoke(IPC.settingsProfiles),
  applyProfile: (id) => invoke(IPC.settingsApplyProfile, id),
  saveProfile: (input) => invoke(IPC.settingsSaveProfile, input),
  deleteProfile: (id) => invoke(IPC.settingsDeleteProfile, id),

  getDashboard: () => invoke(IPC.dashboard),
  getNetworkInfo: () => invoke(IPC.networkInfo),
  refreshNetworkInfo: () => invoke(IPC.networkRefresh),
  getNetworkInterfaces: () => invoke(IPC.networkInterfaces),

  getTrafficSnapshot: () => invoke(IPC.trafficSnapshot),
  getTrafficSeries: (period) => invoke(IPC.trafficSeries, period),

  startScan: (options) => invoke(IPC.scanStart, options),
  cancelScan: () => invoke(IPC.scanCancel),
  getScanStatus: () => invoke(IPC.scanStatus),
  getScanHistory: (limit) => invoke(IPC.scanHistory, limit),
  compareScans: () => invoke(IPC.scanCompare),

  listDevices: (query) => invoke(IPC.devicesList, query),
  getDeviceDetail: (id) => invoke(IPC.deviceDetail, id),
  updateDevice: (patch) => invoke(IPC.deviceUpdate, patch),
  removeDevice: (id) => invoke(IPC.deviceRemove, id),

  listAlerts: (query) => invoke(IPC.alertsList, query),
  markAlertRead: (id) => invoke(IPC.alertsMarkRead, id),
  markAllAlertsRead: () => invoke(IPC.alertsMarkAllRead),
  clearAlerts: () => invoke(IPC.alertsClear),

  getConnections: () => invoke(IPC.connections),

  getHistory: (query) => invoke(IPC.history, query),

  runDiagnostics: () => invoke(IPC.diagnosticsRun),
  runDiagnostic: (key) => invoke(IPC.diagnosticsRunOne, key),
  getLastDiagnostics: () => invoke(IPC.diagnosticsLast),
  runTraceroute: (target) => invoke(IPC.diagnosticsTraceroute, target),

  exportData: (request) => invoke(IPC.exportData, request),
  getDataStats: () => invoke(IPC.dataStats),
  purgeData: (days) => invoke(IPC.dataPurge, days),
  resetData: () => invoke(IPC.dataReset),

  onTraffic: (callback) => subscribe(LIVE_CHANNELS.traffic, callback),
  onStatus: (callback) => subscribe(LIVE_CHANNELS.status, callback),
  onLatency: (callback) => subscribe(LIVE_CHANNELS.latency, callback),
  onScanProgress: (callback) => subscribe(LIVE_CHANNELS.scanProgress, callback),
  onScanDone: (callback) => subscribe(LIVE_CHANNELS.scanDone, callback),
  onAlert: (callback) => subscribe(LIVE_CHANNELS.alert, callback),
  onDevices: (callback) => subscribe(LIVE_CHANNELS.devices, callback),
  onConnections: (callback) => subscribe(LIVE_CHANNELS.connections, callback),
  onSettings: (callback) => subscribe(LIVE_CHANNELS.settings, callback),
  onNavigate: (callback) => subscribe(LIVE_CHANNELS.navigate, callback),
  onWindowMaximized: (callback) => subscribe(LIVE_CHANNELS.windowMaximized, callback)
}

contextBridge.exposeInMainWorld('netwatch', api)
